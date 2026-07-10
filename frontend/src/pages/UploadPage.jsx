import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Navbar from '../components/Navbar';
import LoadingSpinner from '../components/LoadingSpinner';
import apiService from '../services/apiService';

// ── Preference options ────────────────────────────────────────────────────────

const ROLES = [
  { value: 'auto',         label: 'Auto Detect' },
  { value: 'frontend',     label: 'Frontend Developer' },
  { value: 'backend',      label: 'Backend Developer' },
  { value: 'fullstack',    label: 'Full Stack Developer' },
  { value: 'mobile',       label: 'Mobile Developer' },
  { value: 'data_analyst', label: 'Data Analyst' },
  { value: 'data_sci',     label: 'Data Scientist' },
  { value: 'ai_engineer',  label: 'AI Engineer' },
  { value: 'devops',       label: 'DevOps Engineer' },
  { value: 'cybersec',     label: 'Cybersecurity Engineer' },
  { value: 'ux',           label: 'UI/UX Designer' },
  { value: 'dentist',      label: 'Dentist' },
  { value: 'other',        label: 'Other' },
];

const INTERVIEW_TYPES = [
  { value: 'mixed',      label: 'Mixed' },
  { value: 'technical',  label: 'Technical' },
  { value: 'hr',         label: 'HR' },
  { value: 'behavioral', label: 'Behavioral' },
];

const DIFFICULTIES = [
  { value: 'easy',   label: 'Easy' },
  { value: 'medium', label: 'Medium' },
  { value: 'hard',   label: 'Hard' },
];

const LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'ar', label: 'Arabic' },
];

// ── Defaults ──────────────────────────────────────────────────────────────────
const DEFAULT_PREFS = {
  role:          'auto',
  interviewType: 'mixed',
  difficulty:    'medium',
  language:      'en',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Small icon + label chip for the preferences card header cells */
const PrefHeader = ({ icon, label }) => (
  <div className="d-flex align-items-center gap-2 mb-2">
    <div
      style={{
        width: 28, height: 28, borderRadius: 8,
        background: 'linear-gradient(135deg,#6366f1 0%,#8b5cf6 100%)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      <i className={`bi bi-${icon} text-white`} style={{ fontSize: 13 }}></i>
    </div>
    <span className="fw-semibold" style={{ fontSize: 13 }}>{label}</span>
  </div>
);

// ═══════════════════════════════════════════════════════════════════════════════

const UploadPage = () => {
  const navigate = useNavigate();

  // ── CV / JD state ──────────────────────────────────────────────────────────
  const [cvFile,          setCvFile]          = useState(null);
  const [jobDescription,  setJobDescription]  = useState('');
  const [duration,        setDuration]        = useState('30');

  // ── Interview preference state ─────────────────────────────────────────────
  const [prefs, setPrefs] = useState({ ...DEFAULT_PREFS });

  const setPref = (key) => (e) =>
    setPrefs((prev) => ({ ...prev, [key]: e.target.value }));

  // ── UI state ───────────────────────────────────────────────────────────────
  const [isLoading, setIsLoading] = useState(false);
  const [error,     setError]     = useState(null);
  const [success,   setSuccess]   = useState(null);

  // ── File handling ──────────────────────────────────────────────────────────
  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) { setCvFile(file); setError(null); }
  };

  const handleDragOver = (e) => e.preventDefault();

  const handleDrop = (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) { setCvFile(file); setError(null); }
  };

  // ── Validation ─────────────────────────────────────────────────────────────
  const validate = () => {
    if (!cvFile) {
      setError('Please upload your CV before starting.');
      return false;
    }
    if (!jobDescription.trim()) {
      setError('Please provide a job description so the AI can generate relevant questions.');
      return false;
    }
    return true;
  };

  // ── Start interview ────────────────────────────────────────────────────────
  const handleStartInterview = async () => {
    setError(null);
    setSuccess(null);

    if (!validate()) return;

    setIsLoading(true);

    try {
      const response = await apiService.uploadAndPredict(
        cvFile,
        jobDescription,
        prefs.interviewType,
        {
          duration,
          difficulty:    prefs.difficulty,
          language:      prefs.language,
          role:          prefs.role,
          voiceResponse: false,
        }
      );

      if (!response.success) {
        throw new Error(response.error || 'Failed to process CV');
      }

      const prediction = response.data?.prediction || {};
      const questions  = prediction.recommended_questions || [];

      console.log('[UploadPage] /predict ok:', {
        message:          response.data?.message,
        ai_service_used:  response.data?.ai_service_used,
        questions_count:  questions.length,
        skills:           prediction.skills_identified,
        experience_level: prediction.experience_level,
        prefs,
      });

      if (questions.length === 0) {
        throw new Error('The AI did not return any interview questions. Please try again.');
      }

      setSuccess('CV processed! Starting your interview…');

      setTimeout(() => {
        navigate('/interview', {
          state: {
            questions,
            interviewType: prefs.interviewType,
            duration:      parseInt(duration, 10),
            cvData:        response.data,
            preferences:   { ...prefs, duration: parseInt(duration, 10) },
          },
        });
      }, 1200);

    } catch (err) {
      console.error('[UploadPage] error:', err);
      setError(err.message || 'An unexpected error occurred. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  // ── Derived state ──────────────────────────────────────────────────────────
  const step1Done    = Boolean(cvFile);
  const step2Done    = Boolean(jobDescription.trim());
  const readyToStart = step1Done && step2Done;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="bg-body min-vh-100">
      {isLoading && (
        <LoadingSpinner
          message="Analyzing your CV and generating personalized questions…"
          fullScreen={true}
        />
      )}

      <Navbar variant="dashboard" />

      <div className="container py-4">

        {/* ── Header ── */}
        <div className="mb-4">
          <button
            className="btn btn-outline-secondary mb-3"
            onClick={() => navigate('/dashboard')}
            disabled={isLoading}
          >
            <i className="bi bi-arrow-left me-2"></i>Back to Dashboard
          </button>
          <h2 className="fw-bold mb-1">Start New Interview</h2>
          <p className="text-muted">Upload your CV and paste the job description — the AI handles the rest.</p>
        </div>

        {/* ── Progress Indicator ── */}
        <div className="card border-0 shadow-sm mb-4">
          <div className="card-body">
            <div className="d-flex justify-content-between align-items-center">
              {/* Step 1 */}
              <div className="d-flex align-items-center">
                <div className={`progress-step ${step1Done ? 'completed' : 'active'} me-3`}>
                  {step1Done ? <i className="bi bi-check"></i> : '1'}
                </div>
                <div>
                  <h6 className={`mb-0 fw-semibold ${step1Done ? 'text-success' : ''}`}>Upload CV</h6>
                  <small className="text-muted">Your résumé</small>
                </div>
              </div>
              <div className="flex-grow-1 mx-3" style={{
                height: '2px',
                background: step1Done ? 'linear-gradient(90deg,#10b981 0%,#3b82f6 100%)' : '#e5e7eb',
                transition: 'background 0.3s ease',
              }}></div>
              {/* Step 2 */}
              <div className="d-flex align-items-center">
                <div className={`progress-step ${step2Done ? 'completed' : step1Done ? 'active' : 'inactive'} me-3`}>
                  {step2Done ? <i className="bi bi-check"></i> : '2'}
                </div>
                <div>
                  <h6 className={`mb-0 fw-semibold ${step2Done ? 'text-success' : ''}`}>Job Description</h6>
                  <small className="text-muted">Role details</small>
                </div>
              </div>
              <div className="flex-grow-1 mx-3" style={{
                height: '2px',
                background: readyToStart ? 'linear-gradient(90deg,#10b981 0%,#3b82f6 100%)' : '#e5e7eb',
                transition: 'background 0.3s ease',
              }}></div>
              {/* Step 3 */}
              <div className="d-flex align-items-center">
                <div className={`progress-step ${readyToStart ? 'active' : 'inactive'} me-3`}>3</div>
                <div>
                  <h6 className={`mb-0 fw-semibold ${readyToStart ? 'text-primary' : ''}`}>Start Interview</h6>
                  <small className="text-muted">Begin practice</small>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Alerts ── */}
        {error && (
          <div className="alert alert-danger alert-dismissible fade show" role="alert">
            <i className="bi bi-exclamation-triangle-fill me-2"></i>
            <strong>Error:</strong> {error}
            <button type="button" className="btn-close" onClick={() => setError(null)}></button>
          </div>
        )}
        {success && (
          <div className="alert alert-success alert-dismissible fade show" role="alert">
            <i className="bi bi-check-circle-fill me-2"></i>
            <strong>Success:</strong> {success}
            <button type="button" className="btn-close" onClick={() => setSuccess(null)}></button>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            Interview Preferences card  (NEW — above CV upload)
            ══════════════════════════════════════════════════════════════════ */}
        <div className="card border-0 shadow-sm mb-4">
          <div className="card-body">

            {/* Card title */}
            <div className="d-flex align-items-center gap-2 mb-4">
              <div
                style={{
                  width: 36, height: 36, borderRadius: 10,
                  background: 'linear-gradient(135deg,#6366f1 0%,#8b5cf6 100%)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                <i className="bi bi-sliders text-white"></i>
              </div>
              <div>
                <h5 className="fw-bold mb-0">Interview Preferences</h5>
                <small className="text-muted">Tailor the AI coaching experience</small>
              </div>
            </div>

            {/* 4-column grid: Role | Interview Type | Difficulty | Language */}
            <div className="row g-3">

              {/* ── Role ── */}
              <div className="col-12 col-sm-6 col-xl-3">
                <PrefHeader icon="person-badge" label="Role" />
                <select
                  className="form-select"
                  value={prefs.role}
                  onChange={setPref('role')}
                  disabled={isLoading}
                  aria-label="Target role"
                >
                  {ROLES.map((r) => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
                {prefs.role === 'auto' && (
                  <small className="text-muted mt-1 d-block">
                    <i className="bi bi-magic me-1"></i>Detected from your CV &amp; job description
                  </small>
                )}
              </div>

              {/* ── Interview Type ── */}
              <div className="col-12 col-sm-6 col-xl-3">
                <PrefHeader icon="chat-square-text" label="Interview Type" />
                <select
                  className="form-select"
                  value={prefs.interviewType}
                  onChange={setPref('interviewType')}
                  disabled={isLoading}
                  aria-label="Interview type"
                >
                  {INTERVIEW_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
                <small className="text-muted mt-1 d-block">
                  {{
                    mixed:      'Balanced mix of all question styles',
                    technical:  'Coding, system design, algorithms',
                    hr:         'Culture fit, motivation, background',
                    behavioral: 'Past experience, STAR-method answers',
                  }[prefs.interviewType]}
                </small>
              </div>

              {/* ── Difficulty ── */}
              <div className="col-12 col-sm-6 col-xl-3">
                <PrefHeader icon="bar-chart" label="Difficulty" />
                <select
                  className="form-select"
                  value={prefs.difficulty}
                  onChange={setPref('difficulty')}
                  disabled={isLoading}
                  aria-label="Difficulty level"
                >
                  {DIFFICULTIES.map((d) => (
                    <option key={d.value} value={d.value}>{d.label}</option>
                  ))}
                </select>
                <small className="text-muted mt-1 d-block">
                  {{
                    easy:   'Entry-level, broad conceptual questions',
                    medium: 'Mid-level, mixed depth questions',
                    hard:   'Senior-level, in-depth technical questions',
                  }[prefs.difficulty]}
                </small>
              </div>

              {/* ── Language ── */}
              <div className="col-12 col-sm-6 col-xl-3">
                <PrefHeader icon="translate" label="Language" />
                <select
                  className="form-select"
                  value={prefs.language}
                  onChange={setPref('language')}
                  disabled={isLoading}
                  aria-label="Interview language"
                >
                  {LANGUAGES.map((l) => (
                    <option key={l.value} value={l.value}>{l.label}</option>
                  ))}
                </select>
                <small className="text-muted mt-1 d-block">
                  Questions and feedback will be in{' '}
                  <strong>{LANGUAGES.find((l) => l.value === prefs.language)?.label}</strong>
                </small>
              </div>

            </div>{/* /row */}

          </div>
        </div>
        {/* ══ end Interview Preferences ══ */}

        {/* ── CV Upload + Job Description ── */}
        <div className="row g-4 mb-4">
          {/* CV Upload */}
          <div className="col-12 col-md-6">
            <div className="card border-0 shadow-sm h-100">
              <div className="card-body">
                <h5 className="fw-bold mb-3">
                  <i className="bi bi-file-earmark-text text-primary me-2"></i>
                  Upload Your CV
                </h5>
                <div
                  className="upload-zone"
                  onDragOver={handleDragOver}
                  onDrop={handleDrop}
                  onClick={() => document.getElementById('cvUpload').click()}
                  style={{ cursor: 'pointer' }}
                >
                  <i className="bi bi-cloud-upload fs-1 text-primary mb-3 d-block"></i>
                  <p className="fw-semibold mb-2">
                    {cvFile ? cvFile.name : 'Drop your CV here or click to browse'}
                  </p>
                  <small className="text-muted">PDF, DOC, DOCX — max 10 MB</small>
                  <input
                    type="file"
                    id="cvUpload"
                    className="d-none"
                    accept=".pdf,.doc,.docx"
                    onChange={handleFileChange}
                  />
                </div>
                {cvFile && (
                  <div className="alert alert-success mt-3 d-flex align-items-center mb-0">
                    <i className="bi bi-check-circle-fill me-2"></i>
                    <div className="flex-grow-1">
                      <strong>{cvFile.name}</strong>
                      <small className="text-muted ms-2">
                        ({(cvFile.size / 1024).toFixed(0)} KB)
                      </small>
                    </div>
                    <button
                      className="btn btn-sm btn-outline-danger"
                      onClick={(e) => { e.stopPropagation(); setCvFile(null); }}
                    >
                      Remove
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Job Description */}
          <div className="col-12 col-md-6">
            <div className="card border-0 shadow-sm h-100">
              <div className="card-body d-flex flex-column">
                <h5 className="fw-bold mb-3">
                  <i className="bi bi-file-text text-primary me-2"></i>
                  Job Description
                </h5>
                <textarea
                  className="form-control flex-grow-1"
                  rows="9"
                  placeholder="Provide the job description. Combined with your CV and selected preferences (role, difficulty, language, and interview type), the AI will generate a tailored interview session."
                  value={jobDescription}
                  onChange={(e) => { setJobDescription(e.target.value); setError(null); }}
                  style={{ resize: 'none' }}
                ></textarea>
                {jobDescription.trim().length > 0 && (
                  <small className="text-muted mt-2">
                    <i className="bi bi-check-circle-fill text-success me-1"></i>
                    {jobDescription.trim().split(/\s+/).length} words
                  </small>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ── Interview Duration ── */}
        <div className="card border-0 shadow-sm mb-4">
          <div className="card-body">
            <h5 className="fw-bold mb-3">
              <i className="bi bi-clock text-primary me-2"></i>
              Interview Duration
            </h5>
            <div className="row g-3 align-items-center">
              <div className="col-12 col-md-4">
                <label className="form-label fw-semibold">Session Length</label>
                <select
                  className="form-select"
                  value={duration}
                  onChange={(e) => setDuration(e.target.value)}
                  disabled={isLoading}
                >
                  <option value="10">10 minutes</option>
                  <option value="15">15 minutes</option>
                  <option value="20">20 minutes</option>
                  <option value="30">30 minutes</option>
                  <option value="45">45 minutes</option>
                  <option value="60">60 minutes</option>
                </select>
              </div>
              <div className="col-12 col-md-8">
                <div className="alert alert-info mb-0 py-2">
                  <i className="bi bi-info-circle me-2"></i>
                  <small>
                    The interview will <strong>automatically submit</strong> when the timer reaches zero.
                    You can also end it early at any time.
                  </small>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Action Buttons ── */}
        <div className="d-flex gap-3 justify-content-end">
          <button
            className="btn btn-outline-secondary"
            onClick={() => navigate('/dashboard')}
            disabled={isLoading}
          >
            Cancel
          </button>
          <button
            className="btn btn-gradient"
            onClick={handleStartInterview}
            disabled={!readyToStart || isLoading}
          >
            {isLoading ? (
              <>
                <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
                Generating questions…
              </>
            ) : (
              <>
                <i className="bi bi-play-circle-fill me-2"></i>
                Start Interview
              </>
            )}
          </button>
        </div>

      </div>
    </div>
  );
};

export default UploadPage;
