/**
 * AI Service Client
 * -------------------------------------------------------------
 * Thin, reusable HTTP client for the external AI Mock-Interview API.
 *
 * The AI backend exposes (Swagger: ${AI_API_BASE_URL}/docs):
 *   - GET  /health
 *   - POST /analyze-cv          (multipart/form-data, field "file")
 *   - POST /generate-questions  (JSON: { profile, num_questions })
 *   - POST /evaluate-answer     (JSON: { question, answer, role })
 *   - POST /complete-interview  (JSON: { pairs[], role, avg_*_metrics? })
 *   - POST /analyze-video       (multipart/form-data, field "file")
 *
 * All endpoints wrap their payload in an envelope:
 *     { success: bool, message: str, data: <Schema>, errors: any }
 *
 * The methods below unwrap that envelope and either return ``data`` on
 * success or throw an Error with the API-provided message on failure.
 *
 * Configuration:
 *   AI_API_BASE_URL  Base URL of the AI backend (default http://localhost:8000)
 *   AI_TIMEOUT_MS    Request timeout in ms (default 120000)
 */

const axios = require("axios");
const FormData = require("form-data");
const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");

const AI_API_BASE_URL =
  process.env.AI_API_BASE_URL ||
  process.env.AI_SERVICE_URL || // backwards-compatible alias
  "http://127.0.0.1:8000";

// Default to 4 minutes: /analyze-cv + /generate-questions can each take 30-60s
// with a cold Ollama; /complete-interview can take significantly longer.
const AI_TIMEOUT_MS = parseInt(process.env.AI_TIMEOUT_MS || "240000", 10);

// Force IPv4 DNS lookups. On Node 18+ "localhost" resolves to IPv6 (::1)
// first, but uvicorn typically binds only to IPv4 (127.0.0.1) -- causing
// ECONNREFUSED ::1:8000. Pinning the agents to family=4 makes the client
// robust regardless of how AI_API_BASE_URL is spelled.
const httpAgent = new http.Agent({ keepAlive: true, family: 4 });
const httpsAgent = new https.Agent({ keepAlive: true, family: 4 });

const client = axios.create({
  baseURL: AI_API_BASE_URL,
  timeout: AI_TIMEOUT_MS,
  // Let us inspect non-2xx responses ourselves instead of throwing.
  validateStatus: () => true,
  maxContentLength: Infinity,
  maxBodyLength: Infinity,
  httpAgent,
  httpsAgent,
});

// Lightweight request/response logging so /predict failures surface a real
// reason in the interview-service console (not just "Failed to process CV").
client.interceptors.request.use((cfg) => {
  cfg.metadata = { start: Date.now() };
  console.log(`[AI] -> ${cfg.method?.toUpperCase()} ${cfg.url}`);
  return cfg;
});

client.interceptors.response.use(
  (res) => {
    const ms = res.config?.metadata
      ? Date.now() - res.config.metadata.start
      : -1;
    const ok =
      res.data && typeof res.data === "object" ? res.data.success : undefined;
    console.log(
      `[AI] <- ${res.config?.url} status=${res.status} success=${ok} (${ms}ms)`,
    );
    return res;
  },
  (err) => {
    const cfg = err.config || {};
    const ms = cfg.metadata ? Date.now() - cfg.metadata.start : -1;
    console.error(
      `[AI] xx ${cfg.url} ${err.code || "ERR"} ${err.message} (${ms}ms)`,
    );
    return Promise.reject(err);
  },
);

/**
 * Unwrap the AI service's standard ``ApiResponse`` envelope.
 * Throws a descriptive Error on any non-2xx status or success=false body.
 */
function unwrap(response, fallbackMsg) {
  const status = response.status;
  const body = response.data || {};

  if (status >= 200 && status < 300) {
    if (body && body.success === false) {
      const errs =
        Array.isArray(body.errors) && body.errors.length
          ? `: ${JSON.stringify(body.errors)}`
          : "";
      throw new Error((body.message || fallbackMsg) + errs);
    }
    // Normal success: data may be an object or null.
    return body && typeof body === "object" && "data" in body
      ? body.data || {}
      : body;
  }

  // Non-2xx: try to surface the most useful message.
  let msg = body.message || body.detail;
  if (!msg && Array.isArray(body.errors) && body.errors.length) {
    msg = JSON.stringify(body.errors);
  }
  throw new Error(`${fallbackMsg} (HTTP ${status}${msg ? ": " + msg : ""})`);
}

function isProviderConfigured() {
  return Boolean(AI_API_BASE_URL);
}

/**
 * GET /health
 * @returns {Promise<boolean>}
 */
async function checkAIServiceHealth() {
  try {
    const resp = await client.get("/health", { timeout: 5000 });
    return resp.status === 200 && resp.data?.success !== false;
  } catch (_) {
    return false;
  }
}

/**
 * POST /analyze-cv
 * Send a CV file (PDF/DOC/DOCX) to the AI backend for parsing + LLM analysis.
 *
 * @param {string} filePath        Local path to the CV file
 * @param {string} originalFilename Original upload filename (preserved on disk)
 * @returns {Promise<{ profile: Object, saved_path: string, parse?: Object }>}
 */
async function analyzeCV(filePath, originalFilename) {
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error("CV file not found on server");
  }

  const form = new FormData();
  form.append("file", fs.createReadStream(filePath), {
    filename: originalFilename || path.basename(filePath),
  });

  const resp = await client.post("/analyze-cv", form, {
    headers: form.getHeaders(),
  });
  return unwrap(resp, "CV analysis failed");
}

/**
 * POST /generate-questions
 *
 * @param {Object} profile          CV profile (output of /analyze-cv .profile).
 *                                  Already contains job_description, interview_type,
 *                                  difficulty_hint, language_hint, and target_role
 *                                  when called from the /predict route.
 * @param {number} [numQuestions=5] 1..10
 * @param {string} [jobDescription] The raw job description text.  Sent both nested
 *                                  inside profile (profile.job_description) AND as a
 *                                  dedicated top-level field so the external AI service
 *                                  can find it regardless of where it reads from.
 * @returns {Promise<{ questions: Array, count: number }>}
 */
async function generateQuestions(profile, numQuestions = 5, jobDescription = "") {
  const num = Math.min(Math.max(parseInt(numQuestions, 10) || 5, 1), 10);

  const body = {
    profile: profile || {},
    num_questions: num,
  };

  // Send job_description as a top-level field in addition to its presence inside
  // profile so the external service can find it regardless of which schema it reads.
  if (jobDescription && typeof jobDescription === "string" && jobDescription.trim()) {
    body.job_description = jobDescription.trim();
  }

  const resp = await client.post(
    "/generate-questions",
    body,
    { headers: { "Content-Type": "application/json" } },
  );
  return unwrap(resp, "Question generation failed");
}

/**
 * POST /evaluate-answer
 *
 * @param {string} question
 * @param {string} answer
 * @param {string} [role='Software Engineer']
 * @returns {Promise<{ question, answer, role, evaluation: Object, overall_text_score?: number }>}
 */
async function evaluateAnswer(question, answer, role = "Software Engineer") {
  if (!question) throw new Error("question is required");
  const resp = await client.post(
    "/evaluate-answer",
    {
      question,
      answer: answer || "",
      role: role || "Software Engineer",
    },
    { headers: { "Content-Type": "application/json" } },
  );
  return unwrap(resp, "Answer evaluation failed");
}

/**
 * POST /complete-interview
 * Run batch evaluation + multimodal final scoring. Returns the canonical
 * shape consumed by the controller and ultimately the FeedbackPage.
 *
 * @param {Array<{question:string, answer:string, audio_metrics?:Object, video_metrics?:Object}>} pairs
 * @param {string} [role='Software Engineer']
 * @param {Object} [avgAudioMetrics]
 * @param {Object} [avgVideoMetrics]
 * @returns {Promise<{
 *   role: string,
 *   count: number,
 *   average_scores: Object,
 *   per_question: Array,
 *   scoring: { final_score, breakdown, effective_weights, modalities, performance_label, feedback_text }
 * }>}
 */
async function completeInterview(
  pairs,
  role = "Software Engineer",
  avgAudioMetrics,
  avgVideoMetrics,
) {
  if (!Array.isArray(pairs) || pairs.length === 0) {
    throw new Error("At least one Q/A pair is required");
  }
  const body = {
    pairs: pairs.map((p) => ({
      question: String(p.question || ""),
      answer: String(p.answer || ""),
      ...(p.audio_metrics ? { audio_metrics: p.audio_metrics } : {}),
      ...(p.video_metrics ? { video_metrics: p.video_metrics } : {}),
    })),
    role: role || "Software Engineer",
  };
  if (avgAudioMetrics) body.avg_audio_metrics = avgAudioMetrics;
  if (avgVideoMetrics) body.avg_video_metrics = avgVideoMetrics;

  const resp = await client.post("/complete-interview", body, {
    headers: { "Content-Type": "application/json" },
  });
  return unwrap(resp, "Complete-interview evaluation failed");
}

/**
 * POST /analyze-video
 *
 * @param {string} filePath
 * @param {Object} [opts]  { face_sample_rate, emotion_sample_rate, max_frames }
 */
async function analyzeVideo(filePath, opts = {}) {
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error("Video file not found on server");
  }
  const form = new FormData();
  form.append("file", fs.createReadStream(filePath), {
    filename: path.basename(filePath),
  });
  if (opts.face_sample_rate != null)
    form.append("face_sample_rate", String(opts.face_sample_rate));
  if (opts.emotion_sample_rate != null)
    form.append("emotion_sample_rate", String(opts.emotion_sample_rate));
  if (opts.max_frames != null)
    form.append("max_frames", String(opts.max_frames));

  const resp = await client.post("/analyze-video", form, {
    headers: form.getHeaders(),
  });
  return unwrap(resp, "Video analysis failed");
}

/**
 * Map a frontend interview type to the role label expected by the AI backend.
 * @param {string} interviewType - hr | technical | behavioral | general | mixed
 * @returns {string}
 */
function mapInterviewTypeToRole(interviewType) {
  const map = {
    hr: "HR Specialist",
    technical: "Software Engineer",
    behavioral: "Software Engineer",
    general: "Software Engineer",
    mixed: "Software Engineer",
  };
  return map[(interviewType || "").toLowerCase()] || "Software Engineer";
}

module.exports = {
  AI_API_BASE_URL,
  isProviderConfigured,
  checkAIServiceHealth,
  analyzeCV,
  generateQuestions,
  evaluateAnswer,
  completeInterview,
  analyzeVideo,
  mapInterviewTypeToRole,
};
