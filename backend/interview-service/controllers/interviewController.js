const Interview = require('../models/Interview');
const aiService = require('../services/aiService');

// Create interview
exports.createInterview = async (req, res) => {
  try {
    const { title, company, date, status, notes } = req.body;
    const userId = req.userId;

    if (!title) {
      return res.status(400).json({
        error: 'Title is required'
      });
    }

    const interview = await Interview.create({
      userId,
      title,
      company,
      date,
      status: status || 'pending',
      notes
    });

    res.status(201).json(interview);

  } catch (error) {
    console.error('Create interview error:', error);
    res.status(500).json({
      error: 'Error creating interview',
      message: error.message
    });
  }
};

// Get all interviews for logged-in user
exports.getInterviews = async (req, res) => {
  try {
    const userId = req.userId;
    const interviews = await Interview.find({ userId }).sort({ createdAt: -1 });
    res.status(200).json(interviews);
  } catch (error) {
    console.error('Get interviews error:', error);
    res.status(500).json({
      error: 'Error fetching interviews',
      message: error.message
    });
  }
};

// Get single interview by ID
exports.getInterviewById = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.userId;
    const interview = await Interview.findOne({ _id: id, userId });
    if (!interview) {
      return res.status(404).json({ error: 'Interview not found or access denied' });
    }
    res.status(200).json(interview);
  } catch (error) {
    console.error('Get interview by ID error:', error);
    res.status(500).json({
      error: 'Error fetching interview',
      message: error.message
    });
  }
};

// Update interview
exports.updateInterview = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.userId;
    const { title, company, date, status, notes } = req.body;
    const interview = await Interview.findOne({ _id: id, userId });
    if (!interview) {
      return res.status(404).json({ error: 'Interview not found or access denied' });
    }

    if (title !== undefined) interview.title = title;
    if (company !== undefined) interview.company = company;
    if (date !== undefined) interview.date = date;
    if (status !== undefined) interview.status = status;
    if (notes !== undefined) interview.notes = notes;

    await interview.save();
    res.status(200).json(interview);
  } catch (error) {
    console.error('Update interview error:', error);
    res.status(500).json({
      error: 'Error updating interview',
      message: error.message
    });
  }
};

// Delete interview
exports.deleteInterview = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.userId;
    const interview = await Interview.findOneAndDelete({ _id: id, userId });
    if (!interview) {
      return res.status(404).json({ error: 'Interview not found or access denied' });
    }
    res.status(200).json({ message: 'Interview deleted successfully' });
  } catch (error) {
    console.error('Delete interview error:', error);
    res.status(500).json({
      error: 'Error deleting interview',
      message: error.message
    });
  }
};

// ---------- helpers ----------

/**
 * Compute deterministic, model-independent stats from an interview payload.
 * Used for the `performance` block on the saved Interview document.
 */
function computePerformance({ questions = [], answers = [], timeSpent = 0 }) {
  const totalQuestions = questions.length || 0;
  const answeredQuestions = answers.filter(a => !a.skipped).length || 0;
  const skippedQuestions = answers.filter(a => a.skipped).length || 0;
  const completionRate = totalQuestions > 0
    ? Math.round((answeredQuestions / totalQuestions) * 100)
    : 0;

  const lengths = answers
    .filter(a => !a.skipped && a.answer)
    .map(a => a.answer.split(' ').length);
  const averageAnswerLength = lengths.length > 0
    ? Math.round(lengths.reduce((s, l) => s + l, 0) / lengths.length)
    : 0;

  return {
    totalQuestions,
    answeredQuestions,
    skippedQuestions,
    completionRate,
    timeSpent,
    averageAnswerLength,
  };
}

/**
 * Build the QA pairs payload required by AI POST /complete-interview.
 * Skipped answers are still sent (with empty string) so the AI can score
 * coverage correctly. We pre-zip questions <-> answers by questionId, then
 * by index as a safe fallback.
 */
function buildPairs(questions = [], answers = []) {
  const byId = new Map();
  answers.forEach((a, idx) => {
    if (a && a.questionId) byId.set(String(a.questionId), a);
  });

  return questions.map((q, idx) => {
    const qId = String(q.id ?? `q${idx}`);
    const answerObj = byId.get(qId) || answers[idx] || {};
    // Build the answer text the AI sees.  The frontend stores the Whisper
    // transcript in BOTH `answer` and `transcript` whenever the user only
    // spoke (no typed notes), so a naïve concatenation would feed the AI
    // the same sentence twice and inflate completeness/length signals.
    // Rule: include each non-empty source at most once, and never include
    // the transcript when it is identical to the typed answer.
    const typedText = typeof answerObj.answer     === 'string' ? answerObj.answer.trim()     : '';
    const trscrText = typeof answerObj.transcript === 'string' ? answerObj.transcript.trim() : '';
    let effectiveAnswer = '';
    let mergeMode = 'empty';
    if (!answerObj.skipped) {
      if (typedText && trscrText && typedText !== trscrText) {
        effectiveAnswer = `${typedText} ${trscrText}`;
        mergeMode = 'concat:typed+transcript';
      } else if (typedText && trscrText && typedText === trscrText) {
        effectiveAnswer = typedText;
        mergeMode = 'dedupe:identical';
      } else if (typedText) {
        effectiveAnswer = typedText;
        mergeMode = 'typed-only';
      } else if (trscrText) {
        effectiveAnswer = trscrText;
        mergeMode = 'transcript-only';
      }
    } else {
      mergeMode = 'skipped';
    }
    // ---- TEMP BUILD PAIRS DEBUG: makes the dedupe path visible at runtime ----
    console.log(`[BUILD PAIRS] Q${idx + 1}:`, {
      mergeMode,
      typedLen: typedText.length,
      trscrLen: trscrText.length,
      identical: typedText && trscrText && typedText === trscrText,
      effectiveAnswerLen: effectiveAnswer.length,
      effectiveAnswerPreview: effectiveAnswer.slice(0, 80),
    });
    const pair = {
      question: q.text || (typeof q === 'string' ? q : ''),
      answer: effectiveAnswer,
    };
    if (answerObj.audio_metrics && typeof answerObj.audio_metrics === 'object') {
      pair.audio_metrics = answerObj.audio_metrics;
    }
    if (answerObj.video_metrics && typeof answerObj.video_metrics === 'object') {
      pair.video_metrics = answerObj.video_metrics;
    }
    return pair;
  });
}

/**
 * Phase 3 helpers — multimodal persistence.
 * -------------------------------------------------------------------------
 * The frontend forwards per-answer audio_metrics / video_metrics objects in
 * varying shapes (the AI pipeline evolves). We normalise once on the way in,
 * compute session-level averages in a defensive way, and persist everything
 * as Mixed so future AI fields don't require schema migrations.
 */

/** True iff value is a finite number we can safely average. */
function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Compute the per-key average of finite numeric fields across an array of
 * flat metric objects. Non-numeric values, null, undefined, NaN, Infinity
 * and nested objects/arrays are ignored. Returns null when nothing
 * averageable was found, so callers can branch on `=== null`.
 *
 * Example:
 *   averageNumericFields([{ pitch: 110, wpm: 130 }, { pitch: 120 }, null])
 *     => { pitch: 115, wpm: 130 }
 */
function averageNumericFields(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return null;

  const sums   = Object.create(null);
  const counts = Object.create(null);

  for (const obj of arr) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) continue;
    for (const [key, val] of Object.entries(obj)) {
      if (isFiniteNumber(val)) {
        sums[key]   = (sums[key]   || 0) + val;
        counts[key] = (counts[key] || 0) + 1;
      }
    }
  }

  const keys = Object.keys(sums);
  if (keys.length === 0) return null;

  const out = {};
  for (const k of keys) {
    const avg = sums[k] / counts[k];
    if (Number.isFinite(avg)) out[k] = +avg.toFixed(4);
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Pull the audio_metrics / video_metrics objects out of the answers array
 * (skipping anything malformed) so they can be averaged.
 */
function collectMetrics(answers, key) {
  if (!Array.isArray(answers)) return [];
  const out = [];
  for (const a of answers) {
    const m = a && a[key];
    if (m && typeof m === 'object' && !Array.isArray(m)) out.push(m);
  }
  return out;
}

/**
 * Normalise a single incoming answer for persistence: keep the canonical
 * fields, plus the optional multimodal fields *iff* they look valid. This
 * guards us against arbitrary client payloads bloating the document.
 */
function normalizeAnswerForSave(a) {
  if (!a || typeof a !== 'object') return null;

  const out = {
    questionId:   a.questionId != null ? String(a.questionId) : undefined,
    questionText: typeof a.questionText === 'string' ? a.questionText : undefined,
    answer:       typeof a.answer       === 'string' ? a.answer       : '',
    timestamp:    a.timestamp ? new Date(a.timestamp) : new Date(),
    skipped:      Boolean(a.skipped),
  };

  if (a.audio_metrics && typeof a.audio_metrics === 'object' && !Array.isArray(a.audio_metrics)) {
    out.audio_metrics = a.audio_metrics;
  }
  if (a.video_metrics && typeof a.video_metrics === 'object' && !Array.isArray(a.video_metrics)) {
    out.video_metrics = a.video_metrics;
  }
  // Emotion objects (wav2vec2 for speech, DeepFace for facial) — keep if present.
  if (a.audio_emotion && typeof a.audio_emotion === 'object' && !Array.isArray(a.audio_emotion)) {
    out.audio_emotion = a.audio_emotion;
  }
  if (a.video_emotion && typeof a.video_emotion === 'object' && !Array.isArray(a.video_emotion)) {
    out.video_emotion = a.video_emotion;
  }
  if (typeof a.transcript === 'string' && a.transcript.trim()) {
    out.transcript = a.transcript;
  }
  if (typeof a.recordingMime === 'string' && a.recordingMime.trim()) {
    out.recordingMime = a.recordingMime;
  }
  if (isFiniteNumber(a.recordingDurationMs) && a.recordingDurationMs >= 0) {
    out.recordingDurationMs = a.recordingDurationMs;
  }

  return out;
}

/**
 * Derive the modality list ['text','audio','video'] from what actually
 * arrived in this submission. Falls back to whatever the AI returned in
 * scoring.modalities so we never lose that signal.
 */
function deriveModalitiesUsed(normalisedAnswers, aiModalities) {
  const set = new Set();
  if (Array.isArray(aiModalities)) {
    for (const m of aiModalities) {
      const v = String(m || '').trim().toLowerCase();
      if (v) set.add(v);
    }
  }
  for (const a of normalisedAnswers || []) {
    if (a && typeof a.answer === 'string' && a.answer.trim()) set.add('text');
    if (a && a.audio_metrics) set.add('audio');
    if (a && a.video_metrics) set.add('video');
  }
  return Array.from(set);
}

function uniqueNonEmpty(arrays) {
  const seen = new Set();
  arrays.forEach(arr => (arr || []).forEach(x => {
    const v = String(x || '').trim();
    if (v) seen.add(v);
  }));
  return Array.from(seen);
}

/**
 * Map AI POST /complete-interview response into our `aiAnalysis` schema.
 * AI shape:
 *   {
 *     role, count, average_scores: {...},
 *     per_question: [{ question, answer, evaluation, final_score }],
 *     scoring: { final_score, breakdown, effective_weights, modalities,
 *                performance_label, feedback_text }
 *   }
 *
 * Mongo schema fields produced (`Interview.aiAnalysis`):
 *   matchScore (0-100), strengths[], areasForImprovement[],
 *   overallFeedback, detailedScores[]
 */
function mapAIResultToAiAnalysis(aiResult, fallback = {}) {
  const scoring = aiResult.scoring || {};
  const perQuestion = Array.isArray(aiResult.per_question) ? aiResult.per_question : [];

  // ---- TEMP SCORE AUDIT LOG #1: raw AI evaluation output ----
  console.log('[SCORE AUDIT] raw scoring block:', {
    final_score: scoring.final_score,
    breakdown:   scoring.breakdown,
    weights:     scoring.effective_weights,
    modalities:  scoring.modalities,
    label:       scoring.performance_label,
  });

  const allStrengths = [];
  const allImprovements = [];

  const detailedScores = perQuestion.map((pq, idx) => {
    const evalObj = pq.evaluation || {};
    const strengths = Array.isArray(evalObj.strengths) ? evalObj.strengths : [];
    const improvements = Array.isArray(evalObj.areas_to_improve) ? evalObj.areas_to_improve : [];
    allStrengths.push(strengths);
    allImprovements.push(improvements);

    const rawFinal     = pq.final_score;
    const rawOverall   = evalObj.overall_text_score;
    const score = typeof rawFinal === 'number'
      ? rawFinal
      : (typeof rawOverall === 'number' ? rawOverall : 0);

    let quality = 'fair';
    if (score >= 80) quality = 'excellent';
    else if (score >= 60) quality = 'good';
    else if (score >= 40) quality = 'fair';
    else quality = 'needs_improvement';

    // ---- TEMP SCORE AUDIT LOG #2: per-question raw AI sub-scores ----
    console.log(`[SCORE AUDIT] Q${idx + 1} raw AI:`, {
      correctness: evalObj.correctness_score,
      clarity:     evalObj.clarity_score,
      completeness: evalObj.completeness_score,
      overall_text_score: rawOverall,
      pq_final_score:     rawFinal,
      mapped_score:       score,           // 0-100, persisted as-is
      mapped_quality:     quality,
      source:             evalObj.source,
      answerLen:          (pq.answer || '').length,
    });

    return {
      score,
      quality,
      question: pq.question || '',
      user_answer: pq.answer || '',
      feedback: evalObj.detailed_feedback || '',
      strengths,
      improvements,
      // Sub-scores (kept for any future UI; FeedbackPage tolerates extras).
      correctness_score: evalObj.correctness_score ?? null,
      clarity_score: evalObj.clarity_score ?? null,
      completeness_score: evalObj.completeness_score ?? null,
      source: evalObj.source || null,
    };
  });

  const matchScore = typeof scoring.final_score === 'number'
    ? Math.round(scoring.final_score)
    : 0;

  // ---- TEMP SCORE AUDIT LOG #3: final mapped values ----
  console.log('[SCORE AUDIT] mapped → aiAnalysis:', {
    matchScore_0_100: matchScore,
    detailedScores_0_100: detailedScores.map((d, i) => ({ q: i + 1, score: d.score, quality: d.quality })),
    note: 'all values are on 0-100 scale; FeedbackPage divides by 10 at render',
  });

  return {
    matchScore,
    skillsIdentified: fallback.skillsIdentified || [],
    experienceLevel: fallback.experienceLevel || 'Intermediate',
    strengths: uniqueNonEmpty(allStrengths).slice(0, 8),
    areasForImprovement: uniqueNonEmpty(allImprovements).slice(0, 8),
    overallFeedback: scoring.feedback_text
      || `Performance: ${scoring.performance_label || 'evaluated'}`,
    detailedScores,
    // Bonus metadata, will be ignored by the existing FeedbackPage UI.
    performanceLabel: scoring.performance_label || null,
    breakdown: scoring.breakdown || null,
    modalities: Array.isArray(scoring.modalities) ? scoring.modalities : [],
  };
}

// ---------- submit interview ----------

exports.submitInterview = async (req, res) => {
  try {
    const userId = req.userId;
    const {
      title,
      interviewType,
      questions = [],
      answers = [],
      timeSpent,
      confidence,
      cvData,
      aiAnalysis: clientAiAnalysisHints
    } = req.body;

    console.log('Submitting interview:', {
      userId,
      title,
      interviewType,
      questionCount: questions.length,
      answerCount: answers.length
    });

    // Normalise answers ONCE so persistence + AI payload + averaging all
    // operate on the same trusted shape.
    const normalisedAnswers = (Array.isArray(answers) ? answers : [])
      .map(normalizeAnswerForSave)
      .filter(Boolean);

    const performance = computePerformance({
      questions,
      answers: normalisedAnswers,
      timeSpent: timeSpent || 0,
    });

    // Compute session-level average modality metrics SERVER-SIDE from the
    // per-answer metrics that the frontend forwarded. Returns null when
    // there is nothing averageable; we never let NaN reach the database.
    const computedAvgAudio = averageNumericFields(collectMetrics(normalisedAnswers, 'audio_metrics'));
    const computedAvgVideo = averageNumericFields(collectMetrics(normalisedAnswers, 'video_metrics'));

    // Pre-fill aiAnalysis with whatever the upload step already gave us.
    let aiAnalysis = {
      matchScore: 0,
      skillsIdentified: cvData?.skills_identified
        || cvData?.profile?.skills
        || clientAiAnalysisHints?.skillsIdentified
        || [],
      experienceLevel: cvData?.experience_level
        || cvData?.profile?.current_role
        || clientAiAnalysisHints?.experienceLevel
        || 'Intermediate',
      strengths: [],
      areasForImprovement: [],
      overallFeedback: '',
      detailedScores: [],
    };

    let aiModalities = [];

    // Real AI evaluation via /complete-interview.
    let aiError = null;
    try {
      const allPairs = buildPairs(questions, normalisedAnswers);
      if (allPairs.length === 0) {
        throw new Error('No questions to evaluate');
      }

      // Determine which questions actually have content. A question counts
      // as "answered" only when buildPairs produced a non-empty answer
      // string (covers both typed and transcript paths after dedupe).
      const answeredMask  = allPairs.map(p => Boolean(p.answer && p.answer.trim()));
      const answeredCount = answeredMask.filter(Boolean).length;
      const answeredPairs = allPairs.filter((_, i) => answeredMask[i]);

      console.log(
        `[SUBMIT AUDIT] answered=${answeredCount}/${allPairs.length}; ` +
        `mask=${JSON.stringify(answeredMask)}`
      );

      // Hard-zero placeholder for unanswered questions.  This is the SAME
      // shape mapAIResultToAiAnalysis emits, so FeedbackPage / charts /
      // matchScore averaging all behave consistently.
      const zeroPlaceholder = (q) => ({
        score: 0,
        quality: 'No Answer',
        question: (q && (q.text || (typeof q === 'string' ? q : ''))) || '',
        user_answer: '',
        feedback: 'No answer was provided.',
        strengths: [],
        improvements: ['Answer the question directly.'],
        correctness_score: 0,
        clarity_score: 0,
        completeness_score: 0,
        source: 'no-answer',
      });

      if (answeredCount === 0) {
        // Nothing to evaluate — skip the AI call entirely; this prevents the
        // LLM evaluator from inventing scores for empty inputs.
        console.log('[SUBMIT AUDIT] no answered questions — skipping AI call');
        aiAnalysis = {
          ...aiAnalysis,
          detailedScores:      questions.map(q => zeroPlaceholder(q)),
          matchScore:          0,
          strengths:           [],
          areasForImprovement: ['Answer all interview questions to receive feedback.'],
          overallFeedback:     'No answers were provided for any question.',
          performanceLabel:    'No Answer',
          modalities:          [],
        };
        aiModalities = [];
      } else {
        // Server-computed averages take precedence; honour client-supplied
        // overrides only when the server had nothing to offer.
        const avgAudioMetrics = computedAvgAudio
          || req.body.avg_audio_metrics
          || clientAiAnalysisHints?.avg_audio_metrics
          || null;
        const avgVideoMetrics = computedAvgVideo
          || req.body.avg_video_metrics
          || clientAiAnalysisHints?.avg_video_metrics
          || null;

        console.log(
          `Calling AI /complete-interview with ${answeredPairs.length} answered pair(s) ` +
          `(skipping ${allPairs.length - answeredCount} empty)...`
        );
        const aiResult = await aiService.completeInterview(
          answeredPairs,
          aiService.mapInterviewTypeToRole(interviewType),
          avgAudioMetrics,
          avgVideoMetrics
        );

        const aiMapped = mapAIResultToAiAnalysis(aiResult, {
          skillsIdentified: aiAnalysis.skillsIdentified,
          experienceLevel: aiAnalysis.experienceLevel,
        });

        // Re-align AI per-question results with the original question order,
        // injecting hard-zero placeholders where the user did not answer.
        let aiIdx = 0;
        const fullDetailed = answeredMask.map((isAnswered, idx) => {
          if (isAnswered) {
            return aiMapped.detailedScores[aiIdx++]
              || zeroPlaceholder(questions[idx]); // defensive
          }
          return zeroPlaceholder(questions[idx]);
        });

        // matchScore counts unanswered questions as explicit zero in the
        // average — answering 2/5 must NOT score the same as 5/5.
        const finalMatchScore = fullDetailed.length > 0
          ? Math.round(fullDetailed.reduce((s, d) => s + (d.score || 0), 0) / fullDetailed.length)
          : 0;

        aiAnalysis = {
          ...aiMapped,
          detailedScores: fullDetailed,
          matchScore:     finalMatchScore,
        };
        aiModalities = Array.isArray(aiAnalysis.modalities) ? aiAnalysis.modalities : [];

        console.log(
          `AI evaluation completed. matchScore=${finalMatchScore} ` +
          `(avg over ${fullDetailed.length} including ${fullDetailed.length - answeredCount} no-answer zeros)`
        );
      }
    } catch (err) {
      aiError = err.message || String(err);
      console.error('AI /complete-interview failed:', aiError);
      // Keep aiAnalysis as the safe defaults so the UI still renders.
      aiAnalysis.overallFeedback = `AI evaluation unavailable: ${aiError}`;
    }

    // Attach the multimodal session-level fields to aiAnalysis so they
    // persist alongside the rest of the analysis. All three are optional
    // and only set when there is real data to save.
    if (computedAvgAudio) aiAnalysis.avgAudioMetrics = computedAvgAudio;
    if (computedAvgVideo) aiAnalysis.avgVideoMetrics = computedAvgVideo;
    const modalitiesUsed = deriveModalitiesUsed(normalisedAnswers, aiModalities);
    if (modalitiesUsed.length > 0) aiAnalysis.modalitiesUsed = modalitiesUsed;

    // ---- TEMP EMOTION DEBUG: confirm emotion data survives normalisation ----
    console.log('[EMOTION DEBUG] normalisedAnswers emotion check:', normalisedAnswers.map((a, i) => ({
      q: i + 1,
      has_audio_emotion: Boolean(a.audio_emotion),
      has_video_emotion: Boolean(a.video_emotion),
      audio_dominant: a.audio_emotion?.dominant,
      video_dominant: a.video_emotion?.dominant,
    })));

    // ---- TEMP SCORE AUDIT LOG #4: persisted MongoDB values ----
    console.log('[SCORE AUDIT] persisting to MongoDB:', {
      matchScore: aiAnalysis.matchScore,
      detailedScores_persisted: (aiAnalysis.detailedScores || []).map((d, i) => ({
        q: i + 1, score: d.score, quality: d.quality,
      })),
      performance_confidence: aiAnalysis.matchScore,
      modalitiesUsed,
    });

    const interview = await Interview.create({
      userId,
      title: title || `${interviewType || 'General'} Interview`,
      interviewType: interviewType || 'general',
      status: 'completed',
      date: new Date(),
      completedAt: new Date(),
      questions,
      answers: normalisedAnswers,
      performance: {
        ...performance,
        confidence: aiAnalysis.matchScore,
      },
      aiAnalysis,
      cvData: cvData || {},
    });

    console.log('Interview saved:', interview._id);

    res.status(201).json({
      success: true,
      message: aiError
        ? 'Interview saved (AI evaluation degraded)'
        : 'Interview submitted successfully',
      interview: {
        id: interview._id,
        _id: interview._id,
        title: interview.title,
        interviewType: interview.interviewType,
        status: interview.status,
        completedAt: interview.completedAt,
        performance: interview.performance,
        aiAnalysis: interview.aiAnalysis,
        questions: interview.questions,
        answers: interview.answers,
      },
      feedback: {
        completionRate: performance.completionRate,
        overallScore: aiAnalysis.matchScore,
        strengths: aiAnalysis.strengths,
        areasForImprovement: aiAnalysis.areasForImprovement,
        overallFeedback: aiAnalysis.overallFeedback,
      },
      ai_service_used: !aiError,
      ai_error: aiError,
    });

  } catch (error) {
    console.error('Submit interview error:', error);
    res.status(500).json({
      error: 'Error submitting interview',
      message: error.message
    });
  }
};

// ---------- stats ----------

exports.getStats = async (req, res) => {
  try {
    const mongoose = require('mongoose');
    const userId = new mongoose.Types.ObjectId(req.userId);

    const [agg] = await Interview.aggregate([
      { $match: { userId, status: 'completed' } },
      {
        $group: {
          _id: null,
          total:     { $sum: 1 },
          totalTime: { $sum: '$performance.timeSpent' },
          avgScore:  { $avg: '$aiAnalysis.matchScore' },
          bestScore: { $max: '$aiAnalysis.matchScore' },
          scores:    { $push: { score: '$aiAnalysis.matchScore', date: '$createdAt' } },
        }
      }
    ]);

    if (!agg) {
      return res.status(200).json({
        totalInterviews: 0,
        averageScore:    0,
        bestScore:       0,
        practiceTime:    '0h 0m',
        practiceSeconds: 0,
        chartData:       [],
      });
    }

    const totalSec = agg.totalTime || 0;
    const hours    = Math.floor(totalSec / 3600);
    const minutes  = Math.floor((totalSec % 3600) / 60);
    const practiceTime = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;

    const chartData = (agg.scores || [])
      .filter(s => s.score != null)
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .slice(-10)
      .map(s => ({ date: s.date, score: Math.round(s.score) }));

    res.status(200).json({
      totalInterviews: agg.total       || 0,
      averageScore:    Math.round(agg.avgScore  || 0),
      bestScore:       Math.round(agg.bestScore || 0),
      practiceTime,
      practiceSeconds: totalSec,
      chartData,
    });
  } catch (err) {
    console.error('getStats error:', err);
    res.status(500).json({ error: 'Error computing stats', message: err.message });
  }
};

// Get interview feedback
exports.getInterviewFeedback = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.userId;
    const interview = await Interview.findOne({ _id: id, userId });
    if (!interview) {
      return res.status(404).json({ error: 'Interview not found or access denied' });
    }

    // ---- TEMP EMOTION DEBUG: confirm emotion fields are returned from MongoDB ----
    const emotionCheck = (interview.answers || []).map((a, i) => ({
      q: i + 1,
      has_audio_emotion: Boolean(a.audio_emotion),
      has_video_emotion: Boolean(a.video_emotion),
      audio_dominant: a.audio_emotion?.dominant,
      video_dominant: a.video_emotion?.dominant,
    }));
    console.log('[EMOTION DEBUG] getInterviewFeedback returning:', emotionCheck);

    res.status(200).json({
      success: true,
      interview: {
        id: interview._id,
        title: interview.title,
        interviewType: interview.interviewType,
        status: interview.status,
        completedAt: interview.completedAt,
        performance: interview.performance,
        aiAnalysis: interview.aiAnalysis,
        questions: interview.questions,
        answers: interview.answers,
      },
    });
  } catch (error) {
    console.error('Get feedback error:', error);
    res.status(500).json({
      error: 'Error fetching feedback',
      message: error.message,
    });
  }
};
