const express = require("express");
const router = express.Router();
const interviewController = require("../controllers/interviewController");
const authMiddleware = require("../middleware/auth");
const multer = require("multer");
const aiService = require("../services/aiService");
const fs = require("fs");
const path = require("path");

// Configure multer for CV uploads (small)
const upload = multer({
  dest: "uploads/",
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
});

// Configure multer for video uploads (per-question recordings; can be larger).
// Phase 3 - Part A: strict MIME validation. We only accept the formats the
// browser MediaRecorder actually produces (webm preferred, mp4 fallback);
// anything else is rejected with a clear error so the client can react.
const ALLOWED_VIDEO_MIMES = new Set(["video/webm", "video/mp4"]);
const VIDEO_EXT_BY_MIME = {
  "video/webm": ".webm",
  "video/mp4": ".mp4",
};
const VIDEO_UPLOAD_DIR = "uploads/";
if (!fs.existsSync(VIDEO_UPLOAD_DIR))
  fs.mkdirSync(VIDEO_UPLOAD_DIR, { recursive: true });

const videoStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, VIDEO_UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const mime = (file.mimetype || "").toLowerCase().split(";")[0].trim();
    const ext =
      VIDEO_EXT_BY_MIME[mime] || path.extname(file.originalname).toLowerCase();
    const base =
      path
        .basename(
          file.originalname || "recording",
          path.extname(file.originalname || ""),
        )
        .replace(/[^a-zA-Z0-9_-]/g, "_")
        .slice(0, 80) || "recording";
    cb(null, `${Date.now()}_${base}${ext}`);
  },
});

const videoUpload = multer({
  storage: videoStorage,
  limits: { fileSize: 80 * 1024 * 1024 }, // 80 MB per recording
  fileFilter: (_req, file, cb) => {
    const mime = (file.mimetype || "").toLowerCase().split(";")[0].trim();
    if (ALLOWED_VIDEO_MIMES.has(mime)) {
      cb(null, true);
    } else {
      const err = new Error(
        `Unsupported video format: "${file.mimetype || "unknown"}". Only video/webm and video/mp4 are accepted.`,
      );
      err.code = "UNSUPPORTED_VIDEO_TYPE";
      cb(err);
    }
  },
});

function safeUnlink(filePath) {
  if (!filePath) return;
  try {
    fs.unlinkSync(filePath);
  } catch (_) {
    /* ignore */
  }
}

/**
 * Reduce any thrown value to a non-empty, user-readable string. axios
 * network errors sometimes have an empty `.message` but a populated `.code`
 * (e.g. ECONNREFUSED), and we never want to silently lose that signal.
 */
function describeErr(err, fallback = "Unknown error") {
  if (!err) return fallback;
  const parts = [];
  if (err.message) parts.push(err.message);
  if (err.code && !parts.join(" ").includes(err.code))
    parts.push(`(${err.code})`);
  if (err.response?.status) parts.push(`[HTTP ${err.response.status}]`);
  const msg = parts.join(" ").trim();
  return msg || fallback;
}

/**
 * Format the AI Question objects into the shape the frontend already speaks:
 * `{ id, text, category }` plus pass-through fields the InterviewPage tolerates.
 */
function normalizeAIQuestions(aiQuestions, interviewType) {
  return (aiQuestions || []).map((q, idx) => ({
    id: q.id ?? idx + 1,
    text: q.text || "",
    category: q.type || interviewType || "general",
    difficulty: q.difficulty,
    source: q.source,
  }));
}

/**
 * POST /api/interview/predict
 * One-shot CV processing: forward CV to AI /analyze-cv, then call
 * /generate-questions with the parsed profile, and return a payload the
 * existing UploadPage already understands (`prediction.recommended_questions`).
 */
router.post(
  "/predict",
  authMiddleware,
  upload.single("cv_file"),
  async (req, res) => {
    const filePath = req.file ? req.file.path : null;
    const originalFilename = req.file ? req.file.originalname : null;
    const t0 = Date.now();
    console.log(
      `[predict] start file="${originalFilename}" size=${req.file?.size}`,
    );
    try {
      const {
        interview_type,
        num_questions,
        role,
        difficulty,
        language,
        job_description,        // ← was previously received but never read
      } = req.body;

      const jobDescription = (typeof job_description === "string" ? job_description : "").trim();

      const interviewType = interview_type || "general";

      // ── Map user-facing role slugs → human-readable strings ──────────────
      const ROLE_LABELS = {
        auto:         null,               // let the AI infer from CV
        frontend:     "Frontend Developer",
        backend:      "Backend Developer",
        fullstack:    "Full Stack Developer",
        mobile:       "Mobile Developer",
        data_analyst: "Data Analyst",
        data_sci:     "Data Scientist",
        ai_engineer:  "AI Engineer",
        devops:       "DevOps Engineer",
        cybersec:     "Cybersecurity Engineer",
        ux:           "UI/UX Designer",
        dentist:      "Dentist",
        other:        null,               // infer from CV
      };
      const targetRole = ROLE_LABELS[role] || null;

      // ── Map difficulty slug → descriptive hint ────────────────────────────
      const DIFFICULTY_LABELS = {
        easy:   "entry-level",
        medium: "mid-level",
        hard:   "senior-level",
      };
      const difficultyHint = DIFFICULTY_LABELS[difficulty] || "mid-level";

      // ── Language hint (for AI prompt direction) ───────────────────────────
      const langHint = language === "ar" ? "Arabic" : "English";

      console.log("[predict] preferences:", {
        interviewType, targetRole, difficultyHint, langHint,
        jobDescriptionLen: jobDescription.length,
      });

      if (!filePath) {
        return res.status(400).json({
          error: "No CV file uploaded",
          message: 'Please attach a CV file under the "cv_file" field.',
        });
      }

      let profile = {};
      let parse = {};
      let cvAnalysisError = null;
      try {
        const cvData = await aiService.analyzeCV(filePath, originalFilename);
        profile = cvData.profile || {};
        parse = cvData.parse || {};
        console.log(
          `[predict] /analyze-cv ok skills=${(profile.skills || []).length} role="${profile.current_role || ""}"`,
        );
      } catch (err) {
        cvAnalysisError = describeErr(err, "CV analysis failed");
        console.error("[predict] /analyze-cv failed:", cvAnalysisError);
      }

      // ── Enrich the AI profile with user preferences ───────────────────────
      // These hints are merged into the profile object so the AI's
      // /generate-questions endpoint can use them to tailor questions.
      const enrichedProfile = {
        ...profile,
        // Override target role if user explicitly selected one
        ...(targetRole ? { target_role: targetRole } : {}),
        // Pass interview-type, difficulty and language as contextual hints.
        interview_type:  interviewType,
        difficulty_hint: difficultyHint,
        language_hint:   langHint,
        // Job description so the AI can generate role-specific questions.
        // Previously received from the frontend but never forwarded — now fixed.
        ...(jobDescription ? { job_description: jobDescription } : {}),
      };

      let questions = [];
      let questionsError = null;
      try {
        const qData = await aiService.generateQuestions(
          enrichedProfile,
          num_questions ? parseInt(num_questions, 10) : 5,
          jobDescription,       // also forwarded as a dedicated top-level argument
        );
        questions = normalizeAIQuestions(qData.questions || [], interviewType);
        console.log(
          `[predict] /generate-questions ok count=${questions.length}`,
        );
      } catch (err) {
        questionsError = describeErr(err, "Question generation failed");
        console.error("[predict] /generate-questions failed:", questionsError);
      }

      // If both upstream calls failed, the AI pipeline is down -- surface the
      // real reason all the way to the client (in BOTH `error` and `message`
      // so older clients that only read `error` still see something useful).
      if (cvAnalysisError && questionsError) {
        const reason = `AI service unavailable. CV: ${cvAnalysisError}; Questions: ${questionsError}`;
        console.error(`[predict] failed (${Date.now() - t0}ms): ${reason}`);
        return res.status(502).json({
          error: reason,
          message: reason,
          ai_service_used: false,
        });
      }

      // If only question generation failed (or returned nothing) we cannot
      // start an interview -- tell the user *exactly* why.
      if (questionsError || questions.length === 0) {
        const reason = questionsError
          ? `Failed to generate interview questions: ${questionsError}`
          : "The AI service did not return any interview questions.";
        console.error(`[predict] failed (${Date.now() - t0}ms): ${reason}`);
        return res.status(502).json({
          error: reason,
          message: reason,
          ai_service_used: true,
          cv_analysis: { profile, parse }, // CV data is still useful for debugging
        });
      }

      // If only CV parsing failed, we still got generic questions back -- this
      // is a soft degrade we can let through (interview can run without rich
      // CV context). Mark the partial failure in the payload.
      console.log(
        `[predict] success (${Date.now() - t0}ms) questions=${questions.length}`,
      );
      return res.status(200).json({
        message: cvAnalysisError
          ? `CV parsing failed (${cvAnalysisError}); proceeding with generic questions.`
          : "CV processed successfully",
        ai_service_used: true,
        prediction: {
          success: true,
          prediction: "analyzed",
          match_score: null, // populated after /complete-interview at submit time
          recommended_questions: questions,
          skills_identified: Array.isArray(profile.skills)
            ? profile.skills
            : [],
          experience_level:
            profile.experience_years != null
              ? `${profile.experience_years} years`
              : profile.current_role || "Unknown",
          profile,
          parse,
          cv_analysis_error: cvAnalysisError || null,
          // Echo back the effective preferences so the frontend can confirm
          preferences_used: {
            role:          targetRole || (role === "auto" ? "auto-detected" : role) || "auto-detected",
            interview_type: interviewType,
            difficulty:    difficultyHint,
            language:      langHint,
          },
        },
      });
    } catch (error) {
      // Anything unexpected (multer crash, programmer error, etc.)
      console.error(
        `[predict] unexpected error (${Date.now() - t0}ms):`,
        error,
      );
      const reason = error.message || "Unexpected error while processing CV";
      return res.status(500).json({
        error: reason,
        message: reason,
      });
    } finally {
      safeUnlink(filePath);
    }
  },
);

/**
 * POST /api/interview/upload-cv
 * Lightweight CV-only analysis (no question generation).
 */
router.post(
  "/upload-cv",
  authMiddleware,
  upload.single("cv_file"),
  async (req, res) => {
    const filePath = req.file ? req.file.path : null;
    try {
      if (!filePath) {
        return res.status(400).json({
          error: "No file uploaded",
          message: 'Please attach a CV file under the "cv_file" field.',
        });
      }
      const cvData = await aiService.analyzeCV(filePath, req.file.originalname);
      return res.status(200).json({
        message: "CV uploaded and analyzed successfully",
        file_id: "file_" + Date.now(),
        analysis: cvData,
      });
    } catch (error) {
      const reason = `Failed to analyze CV: ${describeErr(error, "AI service unavailable")}`;
      console.error("[upload-cv] failed:", reason);
      res.status(502).json({
        error: reason,
        message: reason,
      });
    } finally {
      safeUnlink(filePath);
    }
  },
);

/**
 * POST /api/interview/generate-questions
 * Generate interview questions either from a passed-in profile or directly
 * from a free-form interview_type / cv_text fallback profile.
 */
router.post("/generate-questions", authMiddleware, async (req, res) => {
  try {
    const { profile, interview_type, num_questions } = req.body;

    // Build a minimal profile if the caller did not supply one.
    const effectiveProfile =
      profile && typeof profile === "object"
        ? profile
        : { current_role: interview_type || "general", skills: [] };

    const qData = await aiService.generateQuestions(
      effectiveProfile,
      num_questions ? parseInt(num_questions, 10) : 5,
    );

    return res.status(200).json({
      ai_service_used: true,
      interview_type: interview_type || "general",
      questions: normalizeAIQuestions(qData.questions || [], interview_type),
      count: qData.count,
    });
  } catch (error) {
    const reason = `Failed to generate interview questions: ${describeErr(error, "AI service unavailable")}`;
    console.error("[generate-questions] failed:", reason);
    res.status(502).json({
      error: reason,
      message: reason,
    });
  }
});

/**
 * Wrap multer.single() so we can convert MIME / size errors into clean,
 * client-friendly responses instead of letting them fall through to the
 * generic Express error handler.
 */
function videoUploadOrFail(fieldName) {
  const handler = videoUpload.single(fieldName);
  return (req, res, next) => {
    handler(req, res, (err) => {
      if (!err) return next();
      if (err.code === "UNSUPPORTED_VIDEO_TYPE") {
        return res.status(415).json({
          error: err.message,
          message: err.message,
        });
      }
      if (err.code === "LIMIT_FILE_SIZE") {
        const msg = "Video recording is too large (80 MB max).";
        return res.status(413).json({ error: msg, message: msg });
      }
      const reason = err.message || "Failed to receive video upload";
      return res.status(400).json({ error: reason, message: reason });
    });
  };
}

/**
 * POST /api/interview/analyze-video
 * Forward a per-question video recording to the AI backend's /analyze-video
 * pipeline. Returns the unified envelope (audio_metrics, video_metrics,
 * audio_emotion, video_emotion, transcription, etc.) so the frontend can
 * surface results or pass them back at submit time.
 */
router.post(
  "/analyze-video",
  authMiddleware,
  videoUploadOrFail("file"),
  async (req, res) => {
    const filePath = req.file ? req.file.path : null;
    try {
      if (!filePath) {
        return res.status(400).json({ error: "No video file uploaded" });
      }
      console.log("[analyze-video] accepted upload:", {
        originalname: req.file.originalname,
        filename: req.file.filename,
        mimetype: req.file.mimetype,
        path: filePath,
        ext: path.extname(filePath),
        size: req.file.size,
      });
      const opts = {
        face_sample_rate: req.body.face_sample_rate,
        emotion_sample_rate: req.body.emotion_sample_rate,
        max_frames: req.body.max_frames,
      };
      const data = await aiService.analyzeVideo(filePath, opts);

      console.log("[ANALYZE VIDEO FULL]", JSON.stringify(data, null, 2));

      return res.status(200).json({
        success: true,
        ai_service_used: true,
        data,
      });
    } catch (error) {
      const reason = `Failed to analyze video: ${describeErr(error, "AI service unavailable")}`;
      console.error("[analyze-video] failed:", reason);
      res.status(502).json({
        error: reason,
        message: reason,
      });
    } finally {
      safeUnlink(filePath);
    }
  },
);

// Aggregated stats for the authenticated user (must come before /:id routes)
router.get("/stats", authMiddleware, interviewController.getStats);

// Submit interview results (must come before /:id routes)
router.post("/submit", authMiddleware, interviewController.submitInterview);

// Standard CRUD routes (all protected)
router.post("/", authMiddleware, interviewController.createInterview);
router.get("/", authMiddleware, interviewController.getInterviews);
router.get(
  "/:id/feedback",
  authMiddleware,
  interviewController.getInterviewFeedback,
);
router.get("/:id", authMiddleware, interviewController.getInterviewById);
router.put("/:id", authMiddleware, interviewController.updateInterview);
router.delete("/:id", authMiddleware, interviewController.deleteInterview);

module.exports = router;
