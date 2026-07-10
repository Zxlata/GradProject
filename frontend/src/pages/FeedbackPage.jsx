import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import Navbar from '../components/Navbar';
import apiService from '../services/apiService';
import { useTheme } from '../context/ThemeContext';
import { Chart as ChartJS, ArcElement, Tooltip, Legend, CategoryScale, LinearScale, BarElement } from 'chart.js';
import { Doughnut, Bar } from 'react-chartjs-2';

ChartJS.register(ArcElement, Tooltip, Legend, CategoryScale, LinearScale, BarElement);

const FeedbackPage = () => {
  const navigate = useNavigate();
  // Route is /feedback/:id  — useParams key must match the param name in App.js
  const { id: interviewId } = useParams();
  const location = useLocation();
  const { isDark } = useTheme();
  
  const [feedback, setFeedback] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [animatedScore, setAnimatedScore] = useState(0);
  const [expandedQuestion, setExpandedQuestion] = useState(null);
  const scoreAnimationRef = useRef(null);

  useEffect(() => {
    // If feedback is passed via location state (just submitted)
    if (location.state?.feedback) {
      setFeedback(location.state.feedback);
      setLoading(false);
    } 
    // Otherwise fetch from API
    else if (interviewId) {
      fetchFeedback();
    }
  }, [interviewId, location.state]);

  // Animate score counting up
  useEffect(() => {
    if (feedback && !loading) {
      const performance = feedback.performance || {};
      const aiAnalysis = feedback.aiAnalysis || {};
      const targetScore = (aiAnalysis.matchScore || performance.confidence || 0) / 10; // Convert to 0-10 scale
      
      let currentScore = 0;
      const duration = 2000; // 2 seconds
      const steps = 60;
      const increment = targetScore / steps;
      const stepDuration = duration / steps;
      
      scoreAnimationRef.current = setInterval(() => {
        currentScore += increment;
        if (currentScore >= targetScore) {
          currentScore = targetScore;
          clearInterval(scoreAnimationRef.current);
        }
        setAnimatedScore(currentScore);
      }, stepDuration);
      
      return () => {
        if (scoreAnimationRef.current) {
          clearInterval(scoreAnimationRef.current);
        }
      };
    }
  }, [feedback, loading]);

  const fetchFeedback = async () => {
    try {
      setLoading(true);
      const response = await apiService.getInterviewFeedback(interviewId);
      
      if (response.success) {
        setFeedback(response.data.interview);
      } else {
        setError('Failed to load feedback');
      }
    } catch (err) {
      console.error('Feedback fetch error:', err);
      setError('Failed to load feedback');
    } finally {
      setLoading(false);
    }
  };

  const getScoreColor = (score) => {
    if (score >= 80) return 'success';
    if (score >= 60) return 'warning';
    return 'danger';
  };

  const getScoreEmoji = (score) => {
    if (score >= 90) return '🎉';
    if (score >= 80) return '🌟';
    if (score >= 70) return '👍';
    if (score >= 60) return '👌';
    return '💪';
  };

  const getPerformanceLabel = (score) => {
    if (score >= 8) return { text: 'Excellent', color: 'success', emoji: '🌟' };
    if (score >= 5) return { text: 'Good', color: 'info', emoji: '👍' };
    return { text: 'Needs Improvement', color: 'warning', emoji: '💪' };
  };

  const normalizeData = (data) => {
    if (!data) return [];
    if (Array.isArray(data)) return data;
    if (typeof data === 'string') return [data];
    return [];
  };

  const generateAISummary = (aiAnalysis) => {
    if (!aiAnalysis) return '';
    
    const strengths = normalizeData(aiAnalysis.strengths);
    const improvements = normalizeData(aiAnalysis.areasForImprovement);
    
    let summary = '';
    
    if (strengths.length > 0) {
      summary += `You demonstrated strong ${strengths.slice(0, 2).join(' and ')}. `;
    }
    
    if (improvements.length > 0) {
      summary += `To improve, focus on ${improvements.slice(0, 2).join(' and ')}.`;
    }
    
    return summary || 'Keep practicing to enhance your interview skills!';
  };

  // ── Multimodal analytics helpers ────────────────────────────────────────
  // Normalise a raw metric that may arrive as 0-1 (proportion) or 0-100
  // (percentage) into a rounded integer 0-100, or null when absent/invalid.
  const normalizeMetric = (val) => {
    if (typeof val !== 'number' || !isFinite(val)) return null;
    const v = (val >= 0 && val <= 1) ? val * 100 : val;
    return Math.round(Math.min(100, Math.max(0, v)));
  };

  // Bootstrap contextual colour name for a 0-100 percentage.
  const metricBsColor = (pct) => {
    if (pct === null || pct === undefined) return 'secondary';
    if (pct >= 75) return 'success';
    if (pct >= 50) return 'info';
    if (pct >= 30) return 'warning';
    return 'danger';
  };

  // Hex colour for SVG / custom elements where a Bootstrap class won't work.
  const metricHex = (pct) => {
    if (pct === null || pct === undefined) return '#9ca3af';
    if (pct >= 75) return '#10b981';
    if (pct >= 50) return '#3b82f6';
    if (pct >= 30) return '#f59e0b';
    return '#ef4444';
  };

  // ── Emotion helpers ──────────────────────────────────────────────────────
  // Maps a raw emotion label (from the AI) to a display emoji.
  const emotionEmoji = (label) => {
    const map = {
      happy:     '😊', joy: '😊',
      sad:       '😢', sadness: '😢',
      neutral:   '😐',
      angry:     '😠', anger: '😠',
      fearful:   '😨', fear: '😨',
      surprised: '😲', surprise: '😲',
      disgusted: '😒', disgust: '😒',
      excited:   '🤩',
    };
    return map[(label || '').toLowerCase()] || '🎭';
  };

  // Maps an emotion label to a Bootstrap contextual colour name.
  const emotionBsColor = (label) => {
    const map = {
      happy: 'success', joy: 'success', excited: 'success',
      sad: 'primary', sadness: 'primary',
      neutral: 'secondary',
      angry: 'danger', anger: 'danger', disgusted: 'danger', disgust: 'danger',
      fearful: 'warning', fear: 'warning',
      surprised: 'info', surprise: 'info',
    };
    return map[(label || '').toLowerCase()] || 'secondary';
  };

  // Given an array of per-answer emotion objects { dominant, ... } returns
  // the single most-frequent dominant label, or null when there is nothing.
  const dominantEmotion = (emotionArr) => {
    if (!Array.isArray(emotionArr) || emotionArr.length === 0) return null;
    const freq = {};
    for (const e of emotionArr) {
      const lbl = (e?.dominant || '').toLowerCase().trim();
      if (lbl) freq[lbl] = (freq[lbl] || 0) + 1;
    }
    const keys = Object.keys(freq);
    if (keys.length === 0) return null;
    return keys.reduce((a, b) => (freq[a] >= freq[b] ? a : b));
  };
  // ────────────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="bg-body min-vh-100">
        <Navbar />
        <div className="container py-5">
          <div className="text-center">
            <div className="spinner-border text-primary mb-3" role="status">
              <span className="visually-hidden">Loading...</span>
            </div>
            <p className="text-muted">Loading your feedback...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error || !feedback) {
    return (
      <div className="bg-body min-vh-100">
        <Navbar />
        <div className="container py-5">
          <div className="alert alert-danger">
            {error || 'Feedback not found'}
          </div>
          <button className="btn btn-primary" onClick={() => navigate('/dashboard')}>
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  const performance = feedback.performance || {};
  const aiAnalysis = feedback.aiAnalysis || {};
  const completionRate = performance.completionRate || 0;
  const overallScore = (aiAnalysis.matchScore || performance.confidence || 0) / 10; // 0-10 scale
  const performanceLabel = getPerformanceLabel(overallScore);
  const questions = feedback.questions || [];
  const answers = feedback.answers || [];

  // ── Multimodal metric data ───────────────────────────────────────────────
  const avgAudio = aiAnalysis.avgAudioMetrics || null;
  const avgVideo = aiAnalysis.avgVideoMetrics || null;

  // Per-metric normalised values (0-100 integer or null when absent)
  const confidencePct       = normalizeMetric(avgAudio?.confidence_score);
  const speechClarityPct    = normalizeMetric(avgAudio?.clarity_score);
  const pacingPct           = normalizeMetric(avgAudio?.pacing_score);
  const energyPct           = normalizeMetric(avgAudio?.energy_score);
  const eyeContactPct       = normalizeMetric(avgVideo?.eye_contact_score);
  const engagementPct       = normalizeMetric(avgVideo?.engagement_score);
  const emotionStabilityPct = normalizeMetric(avgVideo?.emotion_stability);

  const hasVoiceMetrics = [confidencePct, speechClarityPct, pacingPct, energyPct].some(v => v !== null);
  const hasVideoMetrics = [eyeContactPct, engagementPct, emotionStabilityPct].some(v => v !== null);
  // SVG ring circumference for r=28: 2π×28 ≈ 175.9
  const RING_CIRC = 175.9;

  // ── Session-level emotion summary ────────────────────────────────────────
  // Collect per-answer emotion objects from answers[].
  const allAudioEmotions = answers
    .map(a => a?.audio_emotion)
    .filter(e => e && typeof e === 'object');
  const allVideoEmotions = answers
    .map(a => a?.video_emotion)
    .filter(e => e && typeof e === 'object');

  // ---- TEMP EMOTION DEBUG: confirm emotion data reached FeedbackPage ----
  console.log('[EMOTION DEBUG] FeedbackPage answers emotion check:', answers.map((a, i) => ({
    q: i + 1,
    has_audio_emotion: Boolean(a?.audio_emotion),
    has_video_emotion: Boolean(a?.video_emotion),
    audio_dominant: a?.audio_emotion?.dominant,
    video_dominant: a?.video_emotion?.dominant,
  })));
  console.log('[EMOTION DEBUG] allAudioEmotions.length:', allAudioEmotions.length,
              'allVideoEmotions.length:', allVideoEmotions.length);

  const dominantSpeechEmotion = dominantEmotion(allAudioEmotions);
  const dominantFacialEmotion = dominantEmotion(allVideoEmotions);

  // Average speech emotion confidence across all answers that have it.
  const speechEmotionConfidences = allAudioEmotions
    .map(e => {
      const v = e?.confidence ?? e?.dominant_confidence ?? null;
      return normalizeMetric(v);
    })
    .filter(v => v !== null);
  const avgSpeechEmotionConf = speechEmotionConfidences.length > 0
    ? Math.round(speechEmotionConfidences.reduce((a, b) => a + b, 0) / speechEmotionConfidences.length)
    : null;

  // Check if any emotion source is a fallback (speech or facial).
  const hasFallbackSpeechEmotion = allAudioEmotions.some(
    e => typeof e?.source === 'string' && e.source.startsWith('fallback')
  );
  const hasFallbackFacialEmotion = allVideoEmotions.some(
    e => typeof e?.source === 'string' && e.source.startsWith('fallback')
  );

  const hasAnyEmotionData =
    dominantSpeechEmotion !== null || dominantFacialEmotion !== null;
  // ────────────────────────────────────────────────────────────────────────

  // ---- TEMP SCORE AUDIT LOG: rendered values on FeedbackPage ----
  console.log('[SCORE AUDIT] FeedbackPage render:', {
    matchScore_from_server_0_100: aiAnalysis.matchScore,
    overallScore_rendered_0_10: overallScore,
    performanceLabel: performanceLabel.text,
    detailedScores_rendered: (aiAnalysis.detailedScores || []).map((s, i) => ({
      q: i + 1,
      stored_0_100: s.score,
      rendered_0_10: ((s.score || 0) / 10).toFixed(2),
      quality_from_server: s.quality,
    })),
    note: 'overallScore = matchScore / 10; per-question rendered = score / 10',
  });

  // ── Theme-aware chart colours ────────────────────────────────────────────
  const chartTrack    = isDark ? 'rgba(255,255,255,0.08)' : '#e5e7eb';
  const chartGridClr  = isDark ? 'rgba(255,255,255,0.06)' : '#f3f4f6';
  const chartTickClr  = isDark ? '#94a3b8' : '#6b7280';
  const chartTooltipBg= isDark ? '#1e293b' : '#1f2937';

  // Chart data for performance visualization
  const scoreChartData = {
    labels: ['Your Score', 'Remaining'],
    datasets: [{
      data: [animatedScore, Math.max(0, 10 - animatedScore)],
      backgroundColor: [
        animatedScore >= 8 ? '#10b981' : animatedScore >= 5 ? '#3b82f6' : '#f59e0b',
        chartTrack,
      ],
      borderWidth: 0,
    }],
  };

  const scoreChartOptions = {
    cutout: '75%',
    plugins: {
      legend: { display: false },
      tooltip: { enabled: false },
    },
    maintainAspectRatio: false,
  };

  // Category performance chart (if detailed scores available)
  const categoryChartData = aiAnalysis.detailedScores && aiAnalysis.detailedScores.length > 0 ? {
    labels: aiAnalysis.detailedScores.map((_, i) => `Q${i + 1}`),
    datasets: [{
      label: 'Score',
      data: aiAnalysis.detailedScores.map(s => (s.score || 0) / 10),
      backgroundColor: aiAnalysis.detailedScores.map(s => {
        const score = (s.score || 0) / 10;
        return score >= 8 ? '#10b981' : score >= 5 ? '#3b82f6' : '#f59e0b';
      }),
      borderRadius: 6,
    }],
  } : null;

  const categoryChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      y: {
        beginAtZero: true,
        max: 10,
        ticks: { stepSize: 2, color: chartTickClr },
        grid: { color: chartGridClr },
      },
      x: {
        ticks: { color: chartTickClr },
        grid: { display: false },
      },
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: chartTooltipBg,
        titleColor: '#fff',
        bodyColor: '#e2e8f0',
        borderColor: '#6366f1',
        borderWidth: 1,
        callbacks: {
          label: (context) => `Score: ${context.parsed.y.toFixed(1)}/10`,
        },
      },
    },
  };

  return (
    <div className="bg-body min-vh-100">
      <Navbar />
      
      <div className="container py-5">
        {/* Success Header */}
        <div className="text-center mb-5">
          <div className="display-1 mb-3">
            {performanceLabel.emoji}
          </div>
          <h1 className="fw-bold mb-2">Interview Complete!</h1>
          <p className="text-muted lead">
            Here's your AI-powered performance analysis
          </p>
        </div>

        {/* Animated Score Section */}
        <div className="row mb-5">
          <div className="col-lg-8 mx-auto">
            <div className="card border-0 shadow-lg">
              <div className="card-body p-5">
                <div className="row align-items-center">
                  <div className="col-md-5 text-center mb-4 mb-md-0">
                    <div className="position-relative d-inline-block">
                      <div style={{ width: '200px', height: '200px', position: 'relative' }}>
                        <Doughnut data={scoreChartData} options={scoreChartOptions} />
                        <div style={{
                          position: 'absolute',
                          top: '50%',
                          left: '50%',
                          transform: 'translate(-50%, -50%)',
                          textAlign: 'center'
                        }}>
                          <div className="display-3 fw-bold text-gradient">
                            {animatedScore.toFixed(1)}
                          </div>
                          <div className="text-muted fw-semibold">out of 10</div>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="col-md-7">
                    <h2 className="fw-bold mb-3">Overall Score</h2>
                    <div className={`badge bg-${performanceLabel.color} bg-opacity-10 text-${performanceLabel.color} px-4 py-2 mb-3`} style={{ fontSize: '1.1rem' }}>
                      {performanceLabel.emoji} {performanceLabel.text}
                    </div>
                    <div className="progress mb-3" style={{ height: '12px' }}>
                      <div 
                        className={`progress-bar bg-${performanceLabel.color}`}
                        style={{ 
                          width: `${(animatedScore / 10) * 100}%`,
                          transition: 'width 2s ease-out'
                        }}
                      ></div>
                    </div>
                    <p className="text-muted mb-0">
                      <i className="bi bi-check-circle-fill text-success me-2"></i>
                      {performance.answeredQuestions || 0} of {performance.totalQuestions || 0} questions answered
                    </p>
                    <p className="text-muted mb-0">
                      <i className="bi bi-clock-fill text-info me-2"></i>
                      Completed in {Math.floor((performance.timeSpent || 0) / 60)} minutes
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Performance Metrics */}
        <div className="row mb-4">
          <div className="col-lg-10 mx-auto">
            <h3 className="fw-bold mb-4">
              <i className="bi bi-graph-up text-primary me-2"></i>
              Performance Metrics
            </h3>
            <div className="row g-4">
              {/* Time Spent */}
              <div className="col-md-3">
                <div className="card border-0 shadow-sm h-100">
                  <div className="card-body text-center">
                    <div className="icon-circle bg-primary bg-opacity-10 mx-auto mb-3">
                      <i className="bi bi-clock text-primary"></i>
                    </div>
                    <h4 className="fw-bold mb-1">
                      {Math.floor((performance.timeSpent || 0) / 60)}m
                    </h4>
                    <small className="text-muted">Time Spent</small>
                  </div>
                </div>
              </div>

              {/* Questions Answered */}
              <div className="col-md-3">
                <div className="card border-0 shadow-sm h-100">
                  <div className="card-body text-center">
                    <div className="icon-circle bg-success bg-opacity-10 mx-auto mb-3">
                      <i className="bi bi-check-circle text-success"></i>
                    </div>
                    <h4 className="fw-bold mb-1">
                      {performance.answeredQuestions}
                    </h4>
                    <small className="text-muted">Answered</small>
                  </div>
                </div>
              </div>

              {/* Questions Skipped */}
              <div className="col-md-3">
                <div className="card border-0 shadow-sm h-100">
                  <div className="card-body text-center">
                    <div className="icon-circle bg-warning bg-opacity-10 mx-auto mb-3">
                      <i className="bi bi-skip-forward text-warning"></i>
                    </div>
                    <h4 className="fw-bold mb-1">
                      {performance.skippedQuestions}
                    </h4>
                    <small className="text-muted">Skipped</small>
                  </div>
                </div>
              </div>

              {/* Avg Answer Length */}
              <div className="col-md-3">
                <div className="card border-0 shadow-sm h-100">
                  <div className="card-body text-center">
                    <div className="icon-circle bg-info bg-opacity-10 mx-auto mb-3">
                      <i className="bi bi-text-paragraph text-info"></i>
                    </div>
                    <h4 className="fw-bold mb-1">
                      {performance.averageAnswerLength}
                    </h4>
                    <small className="text-muted">Avg. Words</small>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── §1  Performance Overview ─────────────────────────────────── */}
        {(overallScore > 0 || hasVoiceMetrics || hasVideoMetrics) && (
          <div className="row mb-4">
            <div className="col-lg-10 mx-auto">
              <h3 className="fw-bold mb-4">
                <i className="bi bi-speedometer2 text-primary me-2"></i>
                Performance Overview
              </h3>
              <div className="row g-3 justify-content-center">

                {/* Overall Score — SVG ring */}
                {overallScore > 0 && (
                  <div className="col-6 col-sm-4 col-md-3 col-xl-2">
                    <div className="card border-0 shadow-sm h-100 text-center py-4 px-2">
                      <div className="d-flex justify-content-center mb-2">
                        <svg width="72" height="72" viewBox="0 0 72 72">
                          <circle cx="36" cy="36" r="28" fill="none" stroke={chartTrack} strokeWidth="6" />
                          <circle
                            cx="36" cy="36" r="28" fill="none"
                            stroke={metricHex(overallScore * 10)}
                            strokeWidth="6" strokeLinecap="round"
                            strokeDasharray={`${(overallScore / 10) * RING_CIRC} ${RING_CIRC}`}
                            style={{ transformOrigin: '36px 36px', transform: 'rotate(-90deg)', transition: 'stroke-dasharray 1.5s ease-out' }}
                          />
                        </svg>
                      </div>
                      <div className={`fw-bold text-${metricBsColor(overallScore * 10)}`} style={{ fontSize: '1.3rem' }}>
                        {overallScore.toFixed(1)}<span className="text-muted" style={{ fontSize: '0.8rem' }}>/10</span>
                      </div>
                      <div className="text-muted small fw-semibold mt-1">Overall Score</div>
                    </div>
                  </div>
                )}

                {/* Confidence */}
                {confidencePct !== null && (
                  <div className="col-6 col-sm-4 col-md-3 col-xl-2">
                    <div className="card border-0 shadow-sm h-100 text-center py-4 px-2">
                      <div className="icon-circle bg-primary bg-opacity-10 mx-auto mb-2">
                        <i className="bi bi-mic-fill text-primary"></i>
                      </div>
                      <div className={`fw-bold text-${metricBsColor(confidencePct)}`} style={{ fontSize: '1.3rem' }}>
                        {confidencePct}%
                      </div>
                      <div className="text-muted small fw-semibold mt-1">Confidence</div>
                      <div className="mt-2 px-2">
                        <div className="progress" style={{ height: '4px', borderRadius: '2px' }}>
                          <div className={`progress-bar bg-${metricBsColor(confidencePct)}`}
                            style={{ width: `${confidencePct}%`, transition: 'width 1.5s ease-out' }} />
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Engagement */}
                {engagementPct !== null && (
                  <div className="col-6 col-sm-4 col-md-3 col-xl-2">
                    <div className="card border-0 shadow-sm h-100 text-center py-4 px-2">
                      <div className="icon-circle bg-success bg-opacity-10 mx-auto mb-2">
                        <i className="bi bi-person-video text-success"></i>
                      </div>
                      <div className={`fw-bold text-${metricBsColor(engagementPct)}`} style={{ fontSize: '1.3rem' }}>
                        {engagementPct}%
                      </div>
                      <div className="text-muted small fw-semibold mt-1">Engagement</div>
                      <div className="mt-2 px-2">
                        <div className="progress" style={{ height: '4px', borderRadius: '2px' }}>
                          <div className={`progress-bar bg-${metricBsColor(engagementPct)}`}
                            style={{ width: `${engagementPct}%`, transition: 'width 1.5s ease-out' }} />
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Eye Contact */}
                {eyeContactPct !== null && (
                  <div className="col-6 col-sm-4 col-md-3 col-xl-2">
                    <div className="card border-0 shadow-sm h-100 text-center py-4 px-2">
                      <div className="icon-circle bg-info bg-opacity-10 mx-auto mb-2">
                        <i className="bi bi-eye-fill text-info"></i>
                      </div>
                      <div className={`fw-bold text-${metricBsColor(eyeContactPct)}`} style={{ fontSize: '1.3rem' }}>
                        {eyeContactPct}%
                      </div>
                      <div className="text-muted small fw-semibold mt-1">Eye Contact</div>
                      <div className="mt-2 px-2">
                        <div className="progress" style={{ height: '4px', borderRadius: '2px' }}>
                          <div className={`progress-bar bg-${metricBsColor(eyeContactPct)}`}
                            style={{ width: `${eyeContactPct}%`, transition: 'width 1.5s ease-out' }} />
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Speech Clarity */}
                {speechClarityPct !== null && (
                  <div className="col-6 col-sm-4 col-md-3 col-xl-2">
                    <div className="card border-0 shadow-sm h-100 text-center py-4 px-2">
                      <div className="icon-circle bg-warning bg-opacity-10 mx-auto mb-2">
                        <i className="bi bi-soundwave text-warning"></i>
                      </div>
                      <div className={`fw-bold text-${metricBsColor(speechClarityPct)}`} style={{ fontSize: '1.3rem' }}>
                        {speechClarityPct}%
                      </div>
                      <div className="text-muted small fw-semibold mt-1">Speech Clarity</div>
                      <div className="mt-2 px-2">
                        <div className="progress" style={{ height: '4px', borderRadius: '2px' }}>
                          <div className={`progress-bar bg-${metricBsColor(speechClarityPct)}`}
                            style={{ width: `${speechClarityPct}%`, transition: 'width 1.5s ease-out' }} />
                        </div>
                      </div>
                    </div>
                  </div>
                )}

              </div>
            </div>
          </div>
        )}

        {/* ── §2  Voice Analysis ───────────────────────────────────────── */}
        {avgAudio && (
          <div className="row mb-4">
            <div className="col-lg-10 mx-auto">
              <div className="card border-0 shadow-sm">
                <div className="card-body p-4">
                  <h5 className="fw-bold mb-4">
                    <i className="bi bi-mic-fill text-primary me-2"></i>
                    Voice Analysis
                  </h5>
                  {hasVoiceMetrics ? (
                    <div className="row g-4">
                      <div className="col-md-6">
                        {confidencePct !== null && (
                          <div className="mb-4">
                            <div className="d-flex justify-content-between align-items-center mb-1">
                              <span className="small fw-semibold text-muted">
                                <i className="bi bi-shield-check me-1 text-primary"></i>Confidence
                              </span>
                              <span className={`small fw-bold text-${metricBsColor(confidencePct)}`}>{confidencePct}%</span>
                            </div>
                            <div className="progress" style={{ height: '10px', borderRadius: '6px' }}>
                              <div className={`progress-bar bg-${metricBsColor(confidencePct)}`}
                                style={{ width: `${confidencePct}%`, borderRadius: '6px', transition: 'width 1.5s ease-out' }} />
                            </div>
                          </div>
                        )}
                        {speechClarityPct !== null && (
                          <div className="mb-4">
                            <div className="d-flex justify-content-between align-items-center mb-1">
                              <span className="small fw-semibold text-muted">
                                <i className="bi bi-soundwave me-1 text-info"></i>Speech Clarity
                              </span>
                              <span className={`small fw-bold text-${metricBsColor(speechClarityPct)}`}>{speechClarityPct}%</span>
                            </div>
                            <div className="progress" style={{ height: '10px', borderRadius: '6px' }}>
                              <div className={`progress-bar bg-${metricBsColor(speechClarityPct)}`}
                                style={{ width: `${speechClarityPct}%`, borderRadius: '6px', transition: 'width 1.5s ease-out' }} />
                            </div>
                          </div>
                        )}
                      </div>
                      <div className="col-md-6">
                        {pacingPct !== null && (
                          <div className="mb-4">
                            <div className="d-flex justify-content-between align-items-center mb-1">
                              <span className="small fw-semibold text-muted">
                                <i className="bi bi-speedometer me-1 text-warning"></i>Speaking Pace
                              </span>
                              <span className={`small fw-bold text-${metricBsColor(pacingPct)}`}>{pacingPct}%</span>
                            </div>
                            <div className="progress" style={{ height: '10px', borderRadius: '6px' }}>
                              <div className={`progress-bar bg-${metricBsColor(pacingPct)}`}
                                style={{ width: `${pacingPct}%`, borderRadius: '6px', transition: 'width 1.5s ease-out' }} />
                            </div>
                          </div>
                        )}
                        {energyPct !== null && (
                          <div className="mb-4">
                            <div className="d-flex justify-content-between align-items-center mb-1">
                              <span className="small fw-semibold text-muted">
                                <i className="bi bi-lightning-fill me-1 text-danger"></i>Energy Level
                              </span>
                              <span className={`small fw-bold text-${metricBsColor(energyPct)}`}>{energyPct}%</span>
                            </div>
                            <div className="progress" style={{ height: '10px', borderRadius: '6px' }}>
                              <div className={`progress-bar bg-${metricBsColor(energyPct)}`}
                                style={{ width: `${energyPct}%`, borderRadius: '6px', transition: 'width 1.5s ease-out' }} />
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <p className="text-muted mb-0 text-center py-2">
                      <i className="bi bi-info-circle me-1"></i>
                      Voice analysis data not available for this session.
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── §3  Video & Presence Analysis ───────────────────────────── */}
        {avgVideo && (
          <div className="row mb-4">
            <div className="col-lg-10 mx-auto">
              <div className="card border-0 shadow-sm">
                <div className="card-body p-4">
                  <h5 className="fw-bold mb-4">
                    <i className="bi bi-camera-video-fill text-primary me-2"></i>
                    Video &amp; Presence Analysis
                  </h5>
                  {hasVideoMetrics ? (
                    <div className="row g-4">
                      <div className="col-md-6">
                        {eyeContactPct !== null && (
                          <div className="mb-4">
                            <div className="d-flex justify-content-between align-items-center mb-1">
                              <span className="small fw-semibold text-muted">
                                <i className="bi bi-eye-fill me-1 text-info"></i>Eye Contact
                              </span>
                              <span className={`small fw-bold text-${metricBsColor(eyeContactPct)}`}>{eyeContactPct}%</span>
                            </div>
                            <div className="progress" style={{ height: '10px', borderRadius: '6px' }}>
                              <div className={`progress-bar bg-${metricBsColor(eyeContactPct)}`}
                                style={{ width: `${eyeContactPct}%`, borderRadius: '6px', transition: 'width 1.5s ease-out' }} />
                            </div>
                          </div>
                        )}
                        {engagementPct !== null && (
                          <div className="mb-4">
                            <div className="d-flex justify-content-between align-items-center mb-1">
                              <span className="small fw-semibold text-muted">
                                <i className="bi bi-person-video me-1 text-success"></i>Engagement
                              </span>
                              <span className={`small fw-bold text-${metricBsColor(engagementPct)}`}>{engagementPct}%</span>
                            </div>
                            <div className="progress" style={{ height: '10px', borderRadius: '6px' }}>
                              <div className={`progress-bar bg-${metricBsColor(engagementPct)}`}
                                style={{ width: `${engagementPct}%`, borderRadius: '6px', transition: 'width 1.5s ease-out' }} />
                            </div>
                          </div>
                        )}
                      </div>
                      <div className="col-md-6">
                        {emotionStabilityPct !== null ? (
                          <div className="mb-4">
                            <div className="d-flex justify-content-between align-items-center mb-1">
                              <span className="small fw-semibold text-muted">
                                <i className="bi bi-emoji-smile me-1 text-warning"></i>Emotion Stability
                              </span>
                              <span className={`small fw-bold text-${metricBsColor(emotionStabilityPct)}`}>{emotionStabilityPct}%</span>
                            </div>
                            <div className="progress" style={{ height: '10px', borderRadius: '6px' }}>
                              <div className={`progress-bar bg-${metricBsColor(emotionStabilityPct)}`}
                                style={{ width: `${emotionStabilityPct}%`, borderRadius: '6px', transition: 'width 1.5s ease-out' }} />
                            </div>
                          </div>
                        ) : (
                          <div className="d-flex align-items-start gap-2 p-3 rounded"
                            style={{ backgroundColor: 'var(--color-upload-bg)', border: '1px dashed var(--color-border)' }}>
                            <i className="bi bi-info-circle text-muted mt-1 flex-shrink-0"></i>
                            <span className="small text-muted">Advanced emotion analysis unavailable</span>
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <p className="text-muted mb-0 text-center py-2">
                      <i className="bi bi-info-circle me-1"></i>
                      Video analysis data not available for this session.
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── §4  Emotion Summary ─────────────────────────────────────── */}
        {hasAnyEmotionData && (
          <div className="row mb-4">
            <div className="col-lg-10 mx-auto">
              <div className="card border-0 shadow-sm">
                <div className="card-body p-4">
                  <h5 className="fw-bold mb-4">
                    <i className="bi bi-emoji-smile text-warning me-2"></i>
                    Emotion Summary
                  </h5>
                  <div className="row g-3">

                    {/* Dominant Speech Emotion */}
                    {dominantSpeechEmotion && !hasFallbackSpeechEmotion ? (
                      <div className="col-6 col-md-3">
                        <div className="p-3 rounded text-center h-100" style={{ background: 'var(--color-upload-bg)' }}>
                          <div style={{ fontSize: '2rem', lineHeight: 1 }} className="mb-1">
                            {emotionEmoji(dominantSpeechEmotion)}
                          </div>
                          <div className={`fw-bold text-capitalize text-${emotionBsColor(dominantSpeechEmotion)}`}
                            style={{ fontSize: '0.95rem' }}>
                            {dominantSpeechEmotion}
                          </div>
                          <div className="text-muted" style={{ fontSize: '0.72rem' }}>Dominant Speech Emotion</div>
                        </div>
                      </div>
                    ) : dominantSpeechEmotion && hasFallbackSpeechEmotion ? (
                      <div className="col-6 col-md-3">
                        <div className="p-3 rounded text-center h-100" style={{ background: 'var(--color-upload-bg)' }}>
                          <div style={{ fontSize: '1.6rem', lineHeight: 1 }} className="mb-1">🎭</div>
                          <div className="text-muted small">Advanced emotion analysis unavailable</div>
                          <div className="text-muted" style={{ fontSize: '0.72rem' }}>Speech Emotion</div>
                        </div>
                      </div>
                    ) : null}

                    {/* Dominant Facial Emotion */}
                    {dominantFacialEmotion && !hasFallbackFacialEmotion ? (
                      <div className="col-6 col-md-3">
                        <div className="p-3 rounded text-center h-100" style={{ background: 'var(--color-upload-bg)' }}>
                          <div style={{ fontSize: '2rem', lineHeight: 1 }} className="mb-1">
                            {emotionEmoji(dominantFacialEmotion)}
                          </div>
                          <div className={`fw-bold text-capitalize text-${emotionBsColor(dominantFacialEmotion)}`}
                            style={{ fontSize: '0.95rem' }}>
                            {dominantFacialEmotion}
                          </div>
                          <div className="text-muted" style={{ fontSize: '0.72rem' }}>Dominant Facial Emotion</div>
                        </div>
                      </div>
                    ) : dominantFacialEmotion && hasFallbackFacialEmotion ? (
                      <div className="col-6 col-md-3">
                        <div className="p-3 rounded text-center h-100" style={{ background: 'var(--color-upload-bg)' }}>
                          <div style={{ fontSize: '1.6rem', lineHeight: 1 }} className="mb-1">🎭</div>
                          <div className="text-muted small">Advanced emotion analysis unavailable</div>
                          <div className="text-muted" style={{ fontSize: '0.72rem' }}>Facial Emotion</div>
                        </div>
                      </div>
                    ) : null}

                    {/* Avg Speech Emotion Confidence */}
                    {avgSpeechEmotionConf !== null && !hasFallbackSpeechEmotion && (
                      <div className="col-6 col-md-3">
                        <div className="p-3 rounded text-center h-100" style={{ background: 'var(--color-upload-bg)' }}>
                          <div className={`fw-bold text-${metricBsColor(avgSpeechEmotionConf)}`}
                            style={{ fontSize: '1.5rem' }}>
                            {avgSpeechEmotionConf}%
                          </div>
                          <div className="mt-1">
                            <div className="progress mx-auto" style={{ height: '5px', borderRadius: '3px', maxWidth: '80px' }}>
                              <div className={`progress-bar bg-${metricBsColor(avgSpeechEmotionConf)}`}
                                style={{ width: `${avgSpeechEmotionConf}%`, transition: 'width 1.2s ease-out' }} />
                            </div>
                          </div>
                          <div className="text-muted mt-1" style={{ fontSize: '0.72rem' }}>Avg Speech Emotion Confidence</div>
                        </div>
                      </div>
                    )}

                    {/* Emotion Stability */}
                    {emotionStabilityPct !== null && (
                      <div className="col-6 col-md-3">
                        <div className="p-3 rounded text-center h-100" style={{ background: 'var(--color-upload-bg)' }}>
                          <div className={`fw-bold text-${metricBsColor(emotionStabilityPct)}`}
                            style={{ fontSize: '1.5rem' }}>
                            {emotionStabilityPct}%
                          </div>
                          <div className="mt-1">
                            <div className="progress mx-auto" style={{ height: '5px', borderRadius: '3px', maxWidth: '80px' }}>
                              <div className={`progress-bar bg-${metricBsColor(emotionStabilityPct)}`}
                                style={{ width: `${emotionStabilityPct}%`, transition: 'width 1.2s ease-out' }} />
                            </div>
                          </div>
                          <div className="text-muted mt-1" style={{ fontSize: '0.72rem' }}>Emotion Stability</div>
                        </div>
                      </div>
                    )}

                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* AI Analysis */}
        {aiAnalysis.matchScore > 0 && (
          <div className="row mb-4">
            <div className="col-lg-10 mx-auto">
              <div className="card border-0 shadow-sm">
                <div className="card-body p-4">
                  <h3 className="fw-bold mb-4">
                    <i className="bi bi-robot text-primary me-2"></i>
                    AI Analysis
                  </h3>
                  <div className="row">
                    <div className="col-md-6 mb-3">
                      <label className="text-muted small mb-1">Match Score</label>
                      <h4 className="fw-bold">{aiAnalysis.matchScore}%</h4>
                    </div>
                    <div className="col-md-6 mb-3">
                      <label className="text-muted small mb-1">Experience Level</label>
                      <h4 className="fw-bold">{aiAnalysis.experienceLevel}</h4>
                    </div>
                  </div>
                  {aiAnalysis.skillsIdentified && aiAnalysis.skillsIdentified.length > 0 && (
                    <div className="mb-3">
                      <label className="text-muted small mb-2">Skills Identified</label>
                      <div className="d-flex flex-wrap gap-2">
                        {aiAnalysis.skillsIdentified.map((skill, index) => (
                          <span key={index} className="badge bg-primary bg-opacity-10 text-primary px-3 py-2">
                            {skill}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Strengths and Improvements */}
        <div className="row mb-4">
          <div className="col-lg-10 mx-auto">
            <div className="row g-4">
              {/* Strengths */}
              {normalizeData(aiAnalysis.strengths).length > 0 && (
                <div className="col-md-6">
                  <div className="card border-0 shadow-sm h-100">
                    <div className="card-body p-4">
                      <h5 className="fw-bold mb-4">
                        <i className="bi bi-star-fill text-warning me-2"></i>
                        Your Strengths
                      </h5>
                      <div className="d-flex flex-column gap-3">
                        {normalizeData(aiAnalysis.strengths).map((strength, index) => (
                          <div key={index} className="d-flex align-items-start">
                            <div className="icon-circle bg-success bg-opacity-10 me-3" style={{ minWidth: '40px', minHeight: '40px' }}>
                              <i className="bi bi-check-circle-fill text-success"></i>
                            </div>
                            <div>
                              <p className="mb-0 fw-semibold">{strength}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Areas for Improvement */}
              {normalizeData(aiAnalysis.areasForImprovement).length > 0 && (
                <div className="col-md-6">
                  <div className="card border-0 shadow-sm h-100">
                    <div className="card-body p-4">
                      <h5 className="fw-bold mb-4">
                        <i className="bi bi-lightbulb-fill text-primary me-2"></i>
                        Areas to Improve
                      </h5>
                      <div className="d-flex flex-column gap-3">
                        {normalizeData(aiAnalysis.areasForImprovement).map((area, index) => (
                          <div key={index} className="d-flex align-items-start">
                            <div className="icon-circle bg-primary bg-opacity-10 me-3" style={{ minWidth: '40px', minHeight: '40px' }}>
                              <i className="bi bi-arrow-up-circle-fill text-primary"></i>
                            </div>
                            <div>
                              <p className="mb-0 fw-semibold">{area}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Missing Keywords */}
        {aiAnalysis.missingKeywords && normalizeData(aiAnalysis.missingKeywords).length > 0 && (
          <div className="row mb-4">
            <div className="col-lg-10 mx-auto">
              <div className="card border-0 shadow-sm card-tint-warning">
                <div className="card-body p-4">
                  <h5 className="fw-bold mb-3">
                    <i className="bi bi-tag-fill text-warning me-2"></i>
                    Missing Keywords
                  </h5>
                  <p className="text-muted small mb-3">
                    Consider incorporating these keywords in future responses
                  </p>
                  <div className="d-flex flex-wrap gap-2">
                    {normalizeData(aiAnalysis.missingKeywords).map((keyword, index) => (
                      <span 
                        key={index} 
                        className="badge bg-warning bg-opacity-10 text-warning px-3 py-2"
                        style={{ fontSize: '0.9rem' }}
                      >
                        <i className="bi bi-tag me-1"></i>
                        {keyword}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* AI Performance Summary */}
        <div className="row mb-4">
          <div className="col-lg-10 mx-auto">
            <div className="card border-0 shadow-sm card-tint-info">
              <div className="card-body p-4">
                <h5 className="fw-bold mb-3">
                  <i className="bi bi-robot text-primary me-2"></i>
                  AI Interview Summary
                </h5>
                <p className="lead mb-0">
                  {aiAnalysis.overallFeedback || generateAISummary(aiAnalysis)}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Performance Chart */}
        {categoryChartData && (
          <div className="row mb-4">
            <div className="col-lg-10 mx-auto">
              <div className="card border-0 shadow-sm">
                <div className="card-body p-4">
                  <h5 className="fw-bold mb-4">
                    <i className="bi bi-bar-chart-fill text-primary me-2"></i>
                    Question-by-Question Performance
                  </h5>
                  <div style={{ height: '300px' }}>
                    <Bar data={categoryChartData} options={categoryChartOptions} />
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Detailed Answer Scores */}
        {aiAnalysis.detailedScores && aiAnalysis.detailedScores.length > 0 && (
          <div className="row mb-4">
            <div className="col-lg-10 mx-auto">
              <div className="card border-0 shadow-sm">
                <div className="card-body p-4">
                  <h5 className="fw-bold mb-4">
                    <i className="bi bi-clipboard-check text-primary me-2"></i>
                    Detailed Question Review
                  </h5>
                  <div className="d-flex flex-column gap-3">
                    {aiAnalysis.detailedScores.map((scoreData, index) => {
                      const answerScore  = (scoreData.score || 0) / 10;
                      const questionText = scoreData.question || questions[index]?.text || `Question ${index + 1}`;
                      const userAnswer   = scoreData.user_answer || answers[index]?.answer || 'No answer provided';
                      const isExpanded   = expandedQuestion === index;

                      // ── Per-question multimodal data ─────────────────────────────
                      const answerRow    = answers[index] || {};
                      const qAudio       = answerRow.audio_metrics || null;
                      const qVideo       = answerRow.video_metrics || null;
                      const qTranscript  = typeof answerRow.transcript === 'string' && answerRow.transcript.trim()
                        ? answerRow.transcript.trim() : null;

                      const qConfPct  = normalizeMetric(qAudio?.confidence_score);
                      const qClarPct  = normalizeMetric(qAudio?.clarity_score);
                      const qPacePct  = normalizeMetric(qAudio?.pacing_score);
                      const qEnerPct  = normalizeMetric(qAudio?.energy_score);
                      const qEyePct   = normalizeMetric(qVideo?.eye_contact_score);
                      const qEngPct   = normalizeMetric(qVideo?.engagement_score);
                      const qEmotPct  = normalizeMetric(qVideo?.emotion_stability);

                      const hasQVoice = [qConfPct, qClarPct, qPacePct, qEnerPct].some(v => v !== null);
                      const hasQVideo = [qEyePct,  qEngPct,  qEmotPct].some(v => v !== null);

                      // ── Coaching tips derived from per-question metrics ──────────
                      const coachingTips = [];
                      if (qConfPct !== null && qConfPct < 55)
                        coachingTips.push({ icon: 'bi-mic-fill',    color: 'primary', tip: 'Speak with more confidence and certainty in your delivery.' });
                      if (qEyePct  !== null && qEyePct  < 55)
                        coachingTips.push({ icon: 'bi-eye-fill',    color: 'info',    tip: 'Maintain steadier eye contact with the camera.' });
                      if (qPacePct !== null && qPacePct < 45)
                        coachingTips.push({ icon: 'bi-speedometer', color: 'warning', tip: 'Slow down slightly to improve clarity and let your ideas land.' });
                      if (qEngPct  !== null && qEngPct  < 55)
                        coachingTips.push({ icon: 'bi-person-video',color: 'success', tip: 'Show more facial engagement and expression while answering.' });
                      if (qClarPct !== null && qClarPct < 55)
                        coachingTips.push({ icon: 'bi-soundwave',   color: 'info',    tip: 'Articulate words more clearly — avoid trailing off or mumbling.' });
                      if (qEnerPct !== null && qEnerPct < 45)
                        coachingTips.push({ icon: 'bi-lightning-fill', color: 'danger', tip: 'Bring more energy and enthusiasm to your response.' });
                      // ─────────────────────────────────────────────────────────────

                      const accentColor = answerScore >= 8 ? '#10b981' : answerScore >= 5 ? '#3b82f6' : '#f59e0b';
                      const badgeColor  = answerScore >= 8 ? 'success'  : answerScore >= 5 ? 'info'    : 'warning';

                      return (
                        <div
                          key={index}
                          className="card border-0 shadow-sm"
                          style={{ borderLeft: `4px solid ${accentColor}` }}
                        >
                          <div
                            className="card-body p-3"
                            style={{ cursor: 'pointer' }}
                            onClick={() => setExpandedQuestion(isExpanded ? null : index)}
                          >
                            {/* ── Collapsed header ────────────────────────────────── */}
                            <div className="d-flex justify-content-between align-items-center">
                              <div className="d-flex align-items-center gap-3 flex-grow-1 min-width-0">
                                <div
                                  className="icon-circle bg-opacity-10 flex-shrink-0"
                                  style={{
                                    backgroundColor: accentColor,
                                    minWidth: '45px', minHeight: '45px',
                                    fontSize: '1.2rem', fontWeight: 'bold', color: accentColor,
                                  }}
                                >
                                  {index + 1}
                                </div>
                                <div className="flex-grow-1 min-width-0">
                                  <h6 className="mb-0 fw-semibold">Question {index + 1}</h6>
                                  <small className="text-muted d-block text-truncate">{questionText.substring(0, 70)}</small>
                                  {/* Modality availability badges */}
                                  <div className="d-flex flex-wrap gap-1 mt-1">
                                    {hasQVoice && (
                                      <span className="badge bg-primary bg-opacity-10 text-primary" style={{ fontSize: '0.65rem' }}>
                                        <i className="bi bi-mic-fill me-1"></i>Voice
                                      </span>
                                    )}
                                    {hasQVideo && (
                                      <span className="badge bg-success bg-opacity-10 text-success" style={{ fontSize: '0.65rem' }}>
                                        <i className="bi bi-camera-video-fill me-1"></i>Video
                                      </span>
                                    )}
                                    {qTranscript && (
                                      <span className="badge bg-secondary bg-opacity-10 text-secondary" style={{ fontSize: '0.65rem' }}>
                                        <i className="bi bi-file-text me-1"></i>Transcript
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>
                              <div className="d-flex align-items-center gap-2 flex-shrink-0 ms-2">
                                <span className={`badge bg-${badgeColor} px-3 py-2`} style={{ fontSize: '0.9rem' }}>
                                  {answerScore.toFixed(1)}/10
                                </span>
                                <i className={`bi bi-chevron-${isExpanded ? 'up' : 'down'} text-muted`}></i>
                              </div>
                            </div>

                            {/* ── Expanded content ────────────────────────────────── */}
                            {isExpanded && (
                              <div className="mt-3 pt-3 border-top">

                                {/* Question */}
                                <div className="mb-3">
                                  <div className="d-flex align-items-start gap-2 mb-2">
                                    <i className="bi bi-question-circle-fill text-primary mt-1"></i>
                                    <strong className="text-primary">Question:</strong>
                                  </div>
                                  <p className="mb-0 ps-4">{questionText}</p>
                                </div>

                                {/* User Answer */}
                                <div className="mb-3 bg-body-secondary p-3 rounded">
                                  <div className="d-flex align-items-start gap-2 mb-2">
                                    <i className="bi bi-chat-left-text-fill text-info mt-1"></i>
                                    <strong className="text-info">Your Answer:</strong>
                                  </div>
                                  <p className="mb-0 ps-4 text-muted">{userAnswer}</p>
                                </div>

                                {/* Whisper Transcript */}
                                {qTranscript ? (
                                  <div className="mb-3">
                                    <div className="d-flex align-items-center gap-2 mb-2">
                                      <i className="bi bi-file-text text-secondary"></i>
                                      <strong className="small text-secondary">Whisper Transcript:</strong>
                                    </div>
                                    <div className="ps-4">
                                      <p
                                        className="mb-0 small fst-italic text-muted p-2 rounded"
                                        style={{ background: 'var(--color-upload-bg)', borderLeft: '3px solid var(--color-border)' }}
                                      >
                                        {qTranscript}
                                      </p>
                                    </div>
                                  </div>
                                ) : (
                                  answers[index] && (
                                    <div className="mb-3 ps-4">
                                      <span className="small text-muted fst-italic">
                                        <i className="bi bi-info-circle me-1"></i>No transcript available for this answer.
                                      </span>
                                    </div>
                                  )
                                )}

                                {/* AI Feedback */}
                                {scoreData.feedback && (
                                  <div className="mb-3">
                                    <div className="d-flex align-items-start gap-2 mb-2">
                                      <i className="bi bi-lightbulb-fill text-warning mt-1"></i>
                                      <strong className="text-warning">AI Feedback:</strong>
                                    </div>
                                    <p className="mb-0 ps-4">{scoreData.feedback}</p>
                                  </div>
                                )}

                                {/* Strengths and Improvements */}
                                <div className="row g-3 mb-3">
                                  {scoreData.strengths && normalizeData(scoreData.strengths).length > 0 && (
                                    <div className="col-md-6">
                                      <div className="bg-success bg-opacity-10 p-3 rounded h-100">
                                        <strong className="text-success d-block mb-2">
                                          <i className="bi bi-check-circle-fill me-1"></i>Strengths:
                                        </strong>
                                        <ul className="mb-0 ps-3">
                                          {normalizeData(scoreData.strengths).map((s, i) => (
                                            <li key={i} className="small">{s}</li>
                                          ))}
                                        </ul>
                                      </div>
                                    </div>
                                  )}
                                  {scoreData.improvements && normalizeData(scoreData.improvements).length > 0 && (
                                    <div className="col-md-6">
                                      <div className="bg-primary bg-opacity-10 p-3 rounded h-100">
                                        <strong className="text-primary d-block mb-2">
                                          <i className="bi bi-arrow-up-circle-fill me-1"></i>To Improve:
                                        </strong>
                                        <ul className="mb-0 ps-3">
                                          {normalizeData(scoreData.improvements).map((imp, i) => (
                                            <li key={i} className="small">{imp}</li>
                                          ))}
                                        </ul>
                                      </div>
                                    </div>
                                  )}
                                </div>

                                {/* ── Voice Metrics chips ──────────────────────────── */}
                                {hasQVoice && (
                                  <div className="mb-3">
                                    <div className="d-flex align-items-center gap-2 mb-2">
                                      <i className="bi bi-mic-fill text-primary"></i>
                                      <strong className="small text-primary">Voice Metrics</strong>
                                    </div>
                                    <div className="row g-2">
                                      {[
                                        { label: 'Confidence', pct: qConfPct, icon: 'bi-shield-check' },
                                        { label: 'Clarity',    pct: qClarPct, icon: 'bi-soundwave'    },
                                        { label: 'Pace',       pct: qPacePct, icon: 'bi-speedometer'  },
                                        { label: 'Energy',     pct: qEnerPct, icon: 'bi-lightning-fill' },
                                      ].filter(m => m.pct !== null).map(({ label, pct, icon }) => (
                                        <div key={label} className="col-6 col-md-3">
                                          <div className="p-2 rounded" style={{ background: 'var(--color-upload-bg)' }}>
                                            <div className="d-flex justify-content-between align-items-center mb-1">
                                              <small className="text-muted fw-semibold">
                                                <i className={`bi ${icon} me-1`}></i>{label}
                                              </small>
                                              <small className={`fw-bold text-${metricBsColor(pct)}`}>{pct}%</small>
                                            </div>
                                            <div className="progress" style={{ height: '5px', borderRadius: '3px' }}>
                                              <div
                                                className={`progress-bar bg-${metricBsColor(pct)}`}
                                                style={{ width: `${pct}%`, transition: 'width 1s ease-out' }}
                                              />
                                            </div>
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}

                                {/* ── Video & Presence chips ───────────────────────── */}
                                {hasQVideo && (
                                  <div className="mb-3">
                                    <div className="d-flex align-items-center gap-2 mb-2">
                                      <i className="bi bi-camera-video-fill text-success"></i>
                                      <strong className="small text-success">Video &amp; Presence</strong>
                                    </div>
                                    <div className="row g-2">
                                      {[
                                        { label: 'Eye Contact', pct: qEyePct,  icon: 'bi-eye-fill'     },
                                        { label: 'Engagement',  pct: qEngPct,  icon: 'bi-person-video'  },
                                        { label: 'Emotion',     pct: qEmotPct, icon: 'bi-emoji-smile'   },
                                      ].filter(m => m.pct !== null).map(({ label, pct, icon }) => (
                                        <div key={label} className="col-6 col-md-4">
                                          <div className="p-2 rounded" style={{ background: 'var(--color-upload-bg)' }}>
                                            <div className="d-flex justify-content-between align-items-center mb-1">
                                              <small className="text-muted fw-semibold">
                                                <i className={`bi ${icon} me-1`}></i>{label}
                                              </small>
                                              <small className={`fw-bold text-${metricBsColor(pct)}`}>{pct}%</small>
                                            </div>
                                            <div className="progress" style={{ height: '5px', borderRadius: '3px' }}>
                                              <div
                                                className={`progress-bar bg-${metricBsColor(pct)}`}
                                                style={{ width: `${pct}%`, transition: 'width 1s ease-out' }}
                                              />
                                            </div>
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}

                                {/* ── Per-question Emotion Cards ───────────────────── */}
                                {(() => {
                                  const qAudioEmotion = answerRow.audio_emotion || null;
                                  const qVideoEmotion = answerRow.video_emotion || null;

                                  const speechLabel  = qAudioEmotion?.dominant || null;
                                  const speechConf   = normalizeMetric(
                                    qAudioEmotion?.confidence ?? qAudioEmotion?.dominant_confidence ?? null
                                  );
                                  const isSpeechFallback = typeof qAudioEmotion?.source === 'string' &&
                                    qAudioEmotion.source.startsWith('fallback');

                                  const facialLabel  = qVideoEmotion?.dominant || null;
                                  const facialStab   = normalizeMetric(qVideoEmotion?.emotion_stability ?? null);
                                  const facialDist   = qVideoEmotion?.distribution &&
                                    typeof qVideoEmotion.distribution === 'object'
                                    ? Object.entries(qVideoEmotion.distribution)
                                        .filter(([, v]) => typeof v === 'number' && v > 0)
                                        .sort(([, a], [, b]) => b - a)
                                        .slice(0, 4)
                                    : [];
                                  const isFacialFallback = typeof qVideoEmotion?.source === 'string' &&
                                    qVideoEmotion.source.startsWith('fallback');

                                  const hasQEmotion = speechLabel || facialLabel;
                                  if (!hasQEmotion) return null;

                                  return (
                                    <div className="mb-3">
                                      <div className="d-flex align-items-center gap-2 mb-2">
                                        <i className="bi bi-emoji-smile text-warning"></i>
                                        <strong className="small text-warning">Emotion Analysis</strong>
                                      </div>
                                      <div className="row g-2">

                                        {/* Speech Emotion card */}
                                        {speechLabel && (
                                          <div className="col-md-6">
                                            <div className="p-3 rounded" style={{ background: 'var(--color-upload-bg)' }}>
                                              <div className="small fw-semibold text-muted mb-2">
                                                <i className="bi bi-mic-fill me-1 text-primary"></i>Speech Emotion
                                              </div>
                                              {isSpeechFallback ? (
                                                <span className="small text-muted fst-italic">
                                                  Advanced emotion analysis unavailable
                                                </span>
                                              ) : (
                                                <div className="d-flex align-items-center gap-3">
                                                  <span style={{ fontSize: '1.8rem', lineHeight: 1 }}>
                                                    {emotionEmoji(speechLabel)}
                                                  </span>
                                                  <div>
                                                    <div className={`fw-bold text-capitalize text-${emotionBsColor(speechLabel)}`}>
                                                      {speechLabel}
                                                    </div>
                                                    {speechConf !== null && (
                                                      <div className="d-flex align-items-center gap-1 mt-1">
                                                        <div className="progress flex-grow-1" style={{ height: '4px', borderRadius: '2px', minWidth: '60px' }}>
                                                          <div
                                                            className={`progress-bar bg-${emotionBsColor(speechLabel)}`}
                                                            style={{ width: `${speechConf}%`, transition: 'width 1s ease-out' }}
                                                          />
                                                        </div>
                                                        <span className="small text-muted">{speechConf}%</span>
                                                      </div>
                                                    )}
                                                  </div>
                                                </div>
                                              )}
                                            </div>
                                          </div>
                                        )}

                                        {/* Facial Emotion card */}
                                        {facialLabel && (
                                          <div className="col-md-6">
                                            <div className="p-3 rounded" style={{ background: 'var(--color-upload-bg)' }}>
                                              <div className="small fw-semibold text-muted mb-2">
                                                <i className="bi bi-camera-video-fill me-1 text-success"></i>Facial Emotion
                                              </div>
                                              {isFacialFallback ? (
                                                <span className="small text-muted fst-italic">
                                                  Advanced emotion analysis unavailable
                                                </span>
                                              ) : (
                                                <>
                                                  <div className="d-flex align-items-center gap-3 mb-2">
                                                    <span style={{ fontSize: '1.8rem', lineHeight: 1 }}>
                                                      {emotionEmoji(facialLabel)}
                                                    </span>
                                                    <div>
                                                      <div className={`fw-bold text-capitalize text-${emotionBsColor(facialLabel)}`}>
                                                        {facialLabel}
                                                      </div>
                                                      {facialStab !== null && (
                                                        <div className="d-flex align-items-center gap-1 mt-1">
                                                          <div className="progress flex-grow-1" style={{ height: '4px', borderRadius: '2px', minWidth: '60px' }}>
                                                            <div
                                                              className={`progress-bar bg-${metricBsColor(facialStab)}`}
                                                              style={{ width: `${facialStab}%`, transition: 'width 1s ease-out' }}
                                                            />
                                                          </div>
                                                          <span className="small text-muted">{facialStab}% stable</span>
                                                        </div>
                                                      )}
                                                    </div>
                                                  </div>
                                                  {facialDist.length > 1 && (
                                                    <div className="d-flex flex-wrap gap-1">
                                                      {facialDist.map(([lbl, val]) => {
                                                        const pct = Math.round(
                                                          typeof val === 'number' && val <= 1 ? val * 100 : val
                                                        );
                                                        return (
                                                          <span
                                                            key={lbl}
                                                            className={`badge bg-${emotionBsColor(lbl)} bg-opacity-10 text-${emotionBsColor(lbl)}`}
                                                            style={{ fontSize: '0.7rem' }}
                                                          >
                                                            {emotionEmoji(lbl)} {lbl} {pct}%
                                                          </span>
                                                        );
                                                      })}
                                                    </div>
                                                  )}
                                                </>
                                              )}
                                            </div>
                                          </div>
                                        )}

                                      </div>
                                    </div>
                                  );
                                })()}

                                {/* ── AI Coaching Tips ─────────────────────────────── */}
                                {coachingTips.length > 0 && (
                                  <div className="mb-3">
                                    <div className="d-flex align-items-center gap-2 mb-2">
                                      <i className="bi bi-robot text-primary"></i>
                                      <strong className="small text-primary">AI Coaching Tips</strong>
                                    </div>
                                    <div className="d-flex flex-column gap-2">
                                      {coachingTips.map((ct, i) => (
                                        <div
                                          key={i}
                                          className="d-flex align-items-start gap-2 p-2 rounded card-tint-info"
                                        >
                                          <i className={`bi ${ct.icon} text-${ct.color} mt-1 flex-shrink-0`}></i>
                                          <span className="small">{ct.tip}</span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}

                                {/* Missing Keywords */}
                                {scoreData.missing_keywords && normalizeData(scoreData.missing_keywords).length > 0 && (
                                  <div className="mt-1">
                                    <strong className="text-muted small d-block mb-2">
                                      <i className="bi bi-tag me-1"></i>Missing Keywords:
                                    </strong>
                                    <div className="d-flex flex-wrap gap-2">
                                      {normalizeData(scoreData.missing_keywords).map((kw, i) => (
                                        <span key={i} className="badge bg-secondary bg-opacity-10 text-secondary">
                                          {kw}
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                                )}

                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="row">
          <div className="col-lg-10 mx-auto">
            <div className="d-flex gap-3 justify-content-center">
              <button 
                className="btn btn-lg btn-gradient px-5"
                onClick={() => navigate('/upload')}
              >
                <i className="bi bi-arrow-repeat me-2"></i>
                Practice Again
              </button>
              <button 
                className="btn btn-lg btn-outline-secondary px-5"
                onClick={() => navigate('/dashboard')}
              >
                <i className="bi bi-house me-2"></i>
                Back to Dashboard
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default FeedbackPage;
