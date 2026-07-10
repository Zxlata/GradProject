import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import LoadingSpinner from '../components/LoadingSpinner';
import ThemeToggle from '../components/ThemeToggle';
import apiService from '../services/apiService';

const STORAGE_KEY        = 'interview_session_v1';
const CACHE_INDEX_PREFIX = 'interview_uploads_v1_index:';
const CACHE_ENTRY_PREFIX = 'interview_uploads_v1:';

// Retry backoff schedule (ms) — Phase 3-B spec: 1s, 3s, 9s, max 3 attempts.
const RETRY_DELAYS_MS = [1000, 3000, 9000];
const MAX_RETRY_ATTEMPTS = 3;

// MediaRecorder caps (Phase 3-B spec): keep recordings well under the
// 80 MB-per-file backend limit even for long answers.
const VIDEO_BPS = 800_000;
const AUDIO_BPS = 64_000;
const DEBUG_RECORDING = false;

const cacheEntryKey = (sid, qid) => `${CACHE_ENTRY_PREFIX}${sid}:${qid}`;
const cacheIndexKey = (sid)      => `${CACHE_INDEX_PREFIX}${sid}`;

const describeTrack = (track) => {
  let settings = {};
  try { settings = track.getSettings ? track.getSettings() : {}; } catch (_) { /* ignore */ }
  return {
    kind: track.kind,
    label: track.label,
    enabled: track.enabled,
    muted: track.muted,
    readyState: track.readyState,
    settings,
  };
};

const makeSessionId = () => {
  try {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  } catch (_) { /* ignore */ }
  return `s_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
};

/**
 * InterviewPage
 * -------------------------------------------------------------------------
 * Phase 3 — Part B (background upload pipeline).
 *
 * Recording lifecycle:
 *   record → onstop builds a Blob → entry stored in recordingsMapRef
 *   → sequential queue uploads to /analyze-video
 *   → metrics + transcript persisted to localStorage; Blob released
 *
 * Submit:
 *   waits up to 5 s for the in-flight upload, then composes the payload
 *   from cached metrics. No re-upload of already-analysed recordings.
 *
 * Hardening:
 *   - MediaStreamTrack.onended ⇒ camera-lost banner + Retry
 *   - document.visibilitychange ⇒ non-blocking "tab hidden" banner
 *   - AbortController per upload, all aborted on unmount
 *   - per-question retry timers tracked + cleared on unmount
 *   - bitrate caps on MediaRecorder
 */
const InterviewPage = () => {
  const navigate = useNavigate();
  const location = useLocation();

  // -------------------------------------------------------------------------
  // Restore session (navigate state takes priority over sessionStorage)
  // -------------------------------------------------------------------------
  const initial = location.state || (() => {
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY);
      return saved ? JSON.parse(saved) : {};
    } catch (_) { return {}; }
  })();

  const seedSeconds = (() => {
    if (initial.timerSeed && typeof initial.timerSeed === 'number') return initial.timerSeed;
    if (initial.duration   && typeof initial.duration   === 'number') return initial.duration * 60;
    return 1800;
  })();

  // -------------------------------------------------------------------------
  // Core interview state
  // -------------------------------------------------------------------------
  const [questions, setQuestions] = useState(
    Array.isArray(initial.questions) ? initial.questions : []
  );
  const [currentQuestion, setCurrentQuestion] = useState(initial.currentQuestion || 0);
  const [answers, setAnswers]                 = useState(initial.answers || {});
  const [currentAnswer, setCurrentAnswer]     = useState('');
  const [confidence]                          = useState(3);
  const [timer, setTimer] = useState(
    typeof initial.timer === 'number' ? initial.timer : seedSeconds
  );
  const [interviewType] = useState(initial.interviewType || 'general');
  const [cvData]        = useState(initial.cvData        || {});

  // -------------------------------------------------------------------------
  // Real duration tracking + auto-submit guard
  // -------------------------------------------------------------------------
  const startTimeRef     = useRef(initial.startTime || Date.now());
  const autoSubmittedRef = useRef(false);

  // -------------------------------------------------------------------------
  // Stable session id (survives refresh; used as cache namespace)
  // -------------------------------------------------------------------------
  const sessionIdRef = useRef(initial.sessionId || makeSessionId());

  // -------------------------------------------------------------------------
  // TTS
  // -------------------------------------------------------------------------
  const [isSpeaking,    setIsSpeaking]    = useState(false);
  const [speechEnabled, setSpeechEnabled] = useState(true);

  // -------------------------------------------------------------------------
  // Camera / recording (rich state lives in refs; UI sees only statuses)
  // -------------------------------------------------------------------------
  const videoRef     = useRef(null);
  const streamRef    = useRef(null);
  const recorderRef  = useRef(null);
  const stopPromiseRef = useRef(Promise.resolve());

  /**
   * recordingsMapRef.current : Map<qid, {
   *   blob: Blob | null,                   // released after upload success
   *   status: 'idle'|'recording'|'uploading'|'analyzed'|'failed'|'retrying',
   *   attempts: number,
   *   abortController: AbortController | null,
   *   metrics: { audio_metrics, video_metrics } | null,
   *   transcript: string | null,
   *   error: string | null,
   *   mime: string,
   *   recordingDurationMs: number,
   * }>
   */
  const recordingsMapRef = useRef(new Map());
  const queueChainRef    = useRef(Promise.resolve());      // serial upload chain
  const pendingUploadCountRef = useRef(0);                  // queued but not yet active
  const activeUploadCountRef  = useRef(0);                  // currently inside runUpload
  const retryTimersRef   = useRef(new Map());              // qid -> timeout id
  const cancelledRef     = useRef(false);                  // unmount guard

  const [cameraReady,       setCameraReady]       = useState(false);
  const [cameraError,       setCameraError]       = useState(null);
  const [permissionPending, setPermissionPending] = useState(true);
  const [isRecording,       setIsRecording]       = useState(false);

  // Lightweight, render-friendly mirror of recording status per qid.
  const [recordingStatus, setRecordingStatus] = useState({});
  const [recordingErrors, setRecordingErrors] = useState({});

  const [pageHidden, setPageHidden] = useState(false);

  // -------------------------------------------------------------------------
  // Camera-first UI state (Phase 3-C). Tiny + scoped to this page.
  // -------------------------------------------------------------------------
  const [showNotes,    setShowNotes]    = useState(false);   // collapsible text-notes panel
  const [cameraOptOut, setCameraOptOut] = useState(false);   // user chose text-only mode

  // -------------------------------------------------------------------------
  // Submit state
  // -------------------------------------------------------------------------
  const [isSubmitting,  setIsSubmitting]  = useState(false);
  const [submitMessage, setSubmitMessage] = useState('');
  const [submitError,   setSubmitError]   = useState(null);

  // =========================================================================
  // Recordings map helpers
  // =========================================================================
  const getEntry = (qid) => {
    let e = recordingsMapRef.current.get(qid);
    if (!e) {
      e = {
        blob: null, status: 'idle', attempts: 0, abortController: null,
        metrics: null, transcript: null, error: null,
        mime: '', recordingDurationMs: 0,
      };
      recordingsMapRef.current.set(qid, e);
    }
    return e;
  };

  const setStatus = (qid, status, errorMsg = undefined) => {
    const e = getEntry(qid);
    e.status = status;
    if (errorMsg !== undefined) e.error = errorMsg;
    setRecordingStatus(prev => ({ ...prev, [qid]: status }));
    if (errorMsg !== undefined) {
      setRecordingErrors(prev => ({ ...prev, [qid]: errorMsg || '' }));
    }
  };

  // =========================================================================
  // localStorage cache (only successful analyses; never raw blobs)
  // =========================================================================
  const persistAnalyzed = (qid, entry) => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    try {
      const payload = {
        metrics:    entry.metrics    || null,
        transcript: entry.transcript || null,
        mime:       entry.mime       || '',
        durationMs: entry.recordingDurationMs || 0,
        savedAt:    Date.now(),
      };
      localStorage.setItem(cacheEntryKey(sid, qid), JSON.stringify(payload));
      const idxRaw = localStorage.getItem(cacheIndexKey(sid));
      const idx = idxRaw ? JSON.parse(idxRaw) : [];
      if (!idx.includes(qid)) {
        idx.push(qid);
        localStorage.setItem(cacheIndexKey(sid), JSON.stringify(idx));
      }
    } catch (_) { /* quota / serialization — silently ignore */ }
  };

  const rehydrateFromCache = useCallback(() => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    try {
      const idxRaw = localStorage.getItem(cacheIndexKey(sid));
      if (!idxRaw) return;
      const idx = JSON.parse(idxRaw);
      const statusUpdate = {};
      for (const qid of idx) {
        const raw = localStorage.getItem(cacheEntryKey(sid, qid));
        if (!raw) continue;
        const data = JSON.parse(raw);
        const e = getEntry(qid);
        e.metrics             = data.metrics    || null;
        e.transcript          = data.transcript || null;
        e.recordingDurationMs = data.durationMs || 0;
        e.mime                = data.mime       || '';
        e.status              = 'analyzed';
        statusUpdate[qid]     = 'analyzed';
      }
      if (Object.keys(statusUpdate).length > 0) {
        setRecordingStatus(prev => ({ ...prev, ...statusUpdate }));
      }
    } catch (_) { /* ignore */ }
  }, []);

  const clearCache = () => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    try {
      const prefix = `${CACHE_ENTRY_PREFIX}${sid}:`;
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k && k.startsWith(prefix)) localStorage.removeItem(k);
      }
      localStorage.removeItem(cacheIndexKey(sid));
    } catch (_) { /* ignore */ }
  };

  // =========================================================================
  // Sequential upload queue
  // =========================================================================
  const enqueueUpload = useCallback((qid) => {
    if (DEBUG_RECORDING) {
      const entry = recordingsMapRef.current.get(qid);
      console.log('[InterviewPage][recording] enqueueUpload', {
        qid,
        hasBlob: Boolean(entry?.blob),
        blobSize: entry?.blob?.size,
        status: entry?.status,
        pendingBefore: pendingUploadCountRef.current,
      });
    }
    pendingUploadCountRef.current += 1;
    queueChainRef.current = queueChainRef.current
      .catch(() => {})                 // queue must keep flowing past failures
      .then(async () => {
        pendingUploadCountRef.current = Math.max(0, pendingUploadCountRef.current - 1);
        await runUpload(qid);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runUpload = async (qid) => {
    if (DEBUG_RECORDING) {
      console.log('[InterviewPage][recording] runUpload invoked', {
        qid,
        cancelled: cancelledRef.current,
        pending: pendingUploadCountRef.current,
        active: activeUploadCountRef.current,
      });
    }
    if (cancelledRef.current) {
      if (DEBUG_RECORDING) console.warn('[InterviewPage][recording] runUpload skipped: cancelledRef=true', { qid });
      return;
    }
    const entry = recordingsMapRef.current.get(qid);
    if (!entry) {
      if (DEBUG_RECORDING) console.warn('[InterviewPage][recording] runUpload skipped: no entry', { qid });
      return;
    }
    if (!entry.blob) {
      if (DEBUG_RECORDING) console.warn('[InterviewPage][recording] runUpload skipped: no blob', { qid, status: entry.status });
      return;                  // re-recorded / cleared
    }
    if (entry.status === 'analyzed') {
      if (DEBUG_RECORDING) console.log('[InterviewPage][recording] runUpload skipped: already analyzed', { qid });
      return;  // raced with another path
    }

    activeUploadCountRef.current += 1;
    const ctrl = new AbortController();
    entry.abortController = ctrl;
    setStatus(qid, entry.attempts > 0 ? 'retrying' : 'uploading', null);

    try {
      let result;
      try {
        if (DEBUG_RECORDING) {
          console.log('[InterviewPage][recording] analyzeVideo call start', {
            qid,
            blobSize: entry.blob.size,
            blobType: entry.blob.type,
            attempt: entry.attempts + 1,
          });
        }
        result = await apiService.analyzeVideo(entry.blob, {
          face_sample_rate:    2,
          emotion_sample_rate: 2,
          max_frames:          200,
          signal:              ctrl.signal,
        });
        if (DEBUG_RECORDING) {
          console.log('[InterviewPage][recording] analyzeVideo call result', {
            qid,
            success: result.success,
            aborted: result.aborted,
            error: result.error,
            hasAudio: Boolean(result.data?.audio_metrics),
            hasVideo: Boolean(result.data?.video_metrics),
            hasText: Boolean(result.data?.text || result.data?.transcription?.text),
          });
        }
      } catch (err) {
        // apiService is supposed to swallow errors, but be defensive.
        result = { success: false, error: err?.message || 'Upload failed' };
        if (DEBUG_RECORDING) console.error('[InterviewPage][recording] analyzeVideo call threw', { qid, error: result.error });
      }

      if (cancelledRef.current) return;
      // Guard against re-record / abort that swapped the controller out.
      if (entry.abortController !== ctrl) return;
      entry.abortController = null;

      if (result.success) {
        entry.metrics    = {
          audio_metrics: result.data?.audio_metrics || null,
          video_metrics: result.data?.video_metrics || null,
          // Emotion objects from wav2vec2 (audio) and DeepFace (video).
          // Must be preserved here so they survive into the submit payload.
          audio_emotion: result.data?.audio_emotion || null,
          video_emotion: result.data?.video_emotion || null,
        };
        console.log('[EMOTION DEBUG] runUpload stored entry.metrics for', qid, {
          has_audio_emotion: Boolean(result.data?.audio_emotion),
          has_video_emotion: Boolean(result.data?.video_emotion),
          audio_emotion_dominant: result.data?.audio_emotion?.dominant,
          video_emotion_dominant: result.data?.video_emotion?.dominant,
        });
        entry.transcript = result.data?.text
          || result.data?.transcription?.text
          || null;
        entry.error      = null;
        // Free the Blob — saves memory across long sessions.
        entry.blob       = null;
        setStatus(qid, 'analyzed', null);
        persistAnalyzed(qid, entry);
        return;
      }

      // Aborted (re-record / unmount): do NOT count as attempt, do NOT retry.
      if (result.aborted || ctrl.signal.aborted) return;

      entry.attempts = (entry.attempts || 0) + 1;
      entry.error    = result.error || 'Upload failed';

      if (entry.attempts < MAX_RETRY_ATTEMPTS) {
        const wait = RETRY_DELAYS_MS[entry.attempts - 1] || RETRY_DELAYS_MS.at(-1);
        setStatus(qid, 'retrying', entry.error);
        const tid = setTimeout(() => {
          retryTimersRef.current.delete(qid);
          if (!cancelledRef.current) enqueueUpload(qid);
        }, wait);
        retryTimersRef.current.set(qid, tid);
      } else {
        // Exhausted automatic retries; keep the Blob in memory so the user
        // can hit "Retry" manually.
        setStatus(qid, 'failed', entry.error);
      }
    } finally {
      activeUploadCountRef.current = Math.max(0, activeUploadCountRef.current - 1);
    }
  };

  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  const hasBlockingRecordingWork = () => {
    if (recorderRef.current?.state === 'recording') return true;
    if (pendingUploadCountRef.current > 0) return true;
    if (activeUploadCountRef.current > 0) return true;
    if (retryTimersRef.current.size > 0) return true;

    for (const entry of recordingsMapRef.current.values()) {
      if (['recording', 'uploading', 'retrying'].includes(entry.status)) {
        return true;
      }
    }
    return false;
  };

  /**
   * Drain the existing upload/analyze queue before final submit.
   * This waits for current uploads, queued uploads, retry timers, and status
   * transitions to leave recording/uploading/retrying. It never waits forever:
   * after maxMs the submit proceeds with whatever data is already analyzed.
   */
  const waitForUploadDrain = async (maxMs = 20000) => {
    const startedAt = Date.now();
    let lastMessageAt = 0;

    while (!cancelledRef.current && Date.now() - startedAt < maxMs) {
      if (!hasBlockingRecordingWork()) {
        return { timedOut: false };
      }

      const elapsed = Date.now() - startedAt;
      if (elapsed - lastMessageAt > 2500) {
        lastMessageAt = elapsed;
        if (activeUploadCountRef.current > 0) {
          setSubmitMessage('Waiting for AI analysis…');
        } else if (pendingUploadCountRef.current > 0) {
          setSubmitMessage('Processing last responses…');
        } else if (retryTimersRef.current.size > 0) {
          setSubmitMessage('Retrying analysis before submit…');
        } else {
          setSubmitMessage('Finalizing interview…');
        }
      }

      await Promise.race([
        queueChainRef.current.catch(() => {}),
        sleep(250),
      ]);
    }

    return {
      timedOut: hasBlockingRecordingWork(),
      pendingUploads: pendingUploadCountRef.current,
      activeUploads: activeUploadCountRef.current,
      pendingRetries: retryTimersRef.current.size,
    };
  };

  /** Manual retry triggered by the per-question UI button. */
  const manualRetry = (qid) => {
    const entry = recordingsMapRef.current.get(qid);
    if (!entry || !entry.blob) return;
    entry.attempts = 0;
    entry.error    = null;
    setRecordingErrors(prev => ({ ...prev, [qid]: '' }));
    enqueueUpload(qid);
  };

  // =========================================================================
  // 1) Guard: if no questions, go back to upload
  // =========================================================================
  useEffect(() => {
    if (!questions || questions.length === 0) {
      navigate('/upload', { replace: true });
    }
    rehydrateFromCache();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Normalise question shape once on mount.
  useEffect(() => {
    if (!Array.isArray(questions) || questions.length === 0) return;
    if (questions.every(q => q && typeof q === 'object' && q.text)) return;

    const normalized = questions.map((q, idx) => {
      if (typeof q === 'string') return { id: idx + 1, text: q, category: interviewType || 'General' };
      return {
        id:         q.id       || idx + 1,
        text:       q.text     || q.question || '',
        category:   q.category || q.type     || interviewType || 'General',
        difficulty: q.difficulty,
      };
    });
    setQuestions(normalized);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist session state (blobs excluded; sessionId included for cache reuse).
  useEffect(() => {
    if (!questions || questions.length === 0) return;
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
        questions,
        currentQuestion,
        answers,
        timer,
        timerSeed: seedSeconds,
        startTime: startTimeRef.current,
        sessionId: sessionIdRef.current,
        interviewType,
        cvData,
      }));
    } catch (_) { /* ignore quota issues */ }
  }, [questions, currentQuestion, answers, timer, interviewType, cvData, seedSeconds]);

  // =========================================================================
  // 2) Camera & microphone
  // =========================================================================
  const initMedia = useCallback(async () => {
    setCameraError(null);
    setPermissionPending(true);
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Your browser does not support media capture');
      }

      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => {
          t.onended = null;
          try { t.stop(); } catch (_) { /* ignore */ }
        });
        streamRef.current = null;
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24 } },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: { ideal: 1 },
        },
      });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;

      if (DEBUG_RECORDING) {
        console.log('[InterviewPage][audio] getUserMedia stream acquired', {
          audioTracks: stream.getAudioTracks().map(describeTrack),
          videoTracks: stream.getVideoTracks().map(describeTrack),
          totalTracks: stream.getTracks().length,
        });
      }

      const liveAudioTracks = stream.getAudioTracks().filter(t => t.readyState === 'live');
      if (liveAudioTracks.length === 0) {
        setCameraError('Microphone was not found in the media stream. Please enable microphone access and retry.');
        if (DEBUG_RECORDING) console.warn('[InterviewPage][audio] getUserMedia returned no live audio tracks');
      }

      // Phase 3-B: detect mid-interview revocation. If any track ends
      // (user closes mic/cam in the browser bar), surface a clear error
      // and offer Retry — already-recorded answers stay intact.
      stream.getTracks().forEach((track) => {
        track.onended = () => {
          if (cancelledRef.current) return;
          setCameraReady(false);
          setCameraError('Camera or microphone access was revoked. Click Retry to reconnect — your previous answers are safe.');
        };
      });

      setCameraOptOut(false);
      setCameraReady(true);
    } catch (err) {
      const msg =
        err.name === 'NotAllowedError' || err.name === 'SecurityError'
          ? 'Camera/microphone access denied. Allow access in the browser settings and click Retry.'
          : err.name === 'NotFoundError'
          ? 'No camera or microphone found on this device.'
          : `Camera unavailable: ${err.message || err.name}`;
      setCameraError(msg);
      setCameraReady(false);
    } finally {
      setPermissionPending(false);
    }
  }, []);

  useEffect(() => {
    if (cameraOptOut) return;
    initMedia();
    return () => {
      // Cleanup will run again in the dedicated unmount effect below.
    };
  }, [initMedia, cameraOptOut]);

  /**
   * Phase 3-C: graceful "text-only" path. The user can dismiss the
   * permission prompt entirely; recording stays disabled but the rest of
   * the interview (text notes, navigation, submit) keeps working.
   */
  const continueWithoutCamera = () => {
    setCameraOptOut(true);
    setCameraError(null);
    setCameraReady(false);
    setPermissionPending(false);
    setShowNotes(true);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => { t.onended = null; try { t.stop(); } catch (_) { /* */ } });
      streamRef.current = null;
    }
  };

  const reEnableCamera = () => {
    setCameraOptOut(false);
    initMedia();
  };

  // Keep the always-mounted camera preview attached if the stream arrives
  // before/after the video node is ready, or after reconnect.
  useEffect(() => {
    if (videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
    }
  }, [cameraReady, permissionPending, cameraOptOut]);

  // =========================================================================
  // 3) MediaRecorder per question (with bitrate caps + race-safe chunks)
  // =========================================================================
  const pickMimeType = () => {
    const candidates = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm',
      'video/mp4',
    ];
    for (const t of candidates) {
      try { if (window.MediaRecorder && MediaRecorder.isTypeSupported(t)) return t; } catch (_) { /* */ }
    }
    return '';
  };

  const buildRecorder = (stream, mime) => {
    const baseOpts = mime ? { mimeType: mime } : {};
    // Try with bitrate caps first — falls back to plain mime / no opts on
    // browsers that reject the unrecognised constructor options.
    try {
      return new MediaRecorder(stream, {
        ...baseOpts,
        videoBitsPerSecond: VIDEO_BPS,
        audioBitsPerSecond: AUDIO_BPS,
      });
    } catch (_) { /* fall through */ }
    try { return new MediaRecorder(stream, baseOpts); } catch (_) { /* fall through */ }
    return new MediaRecorder(stream);
  };

  const startRecording = () => {
    if (DEBUG_RECORDING) {
      console.log('[InterviewPage][recording] startRecording requested', {
        currentQuestion,
        hasStream: Boolean(streamRef.current),
        cameraReady,
        cameraOptOut,
        existingRecorderState: recorderRef.current?.state,
      });
    }
    if (!streamRef.current) {
      if (DEBUG_RECORDING) console.warn('[InterviewPage][recording] startRecording skipped: no streamRef');
      return;
    }
    if (!window.MediaRecorder) {
      setCameraError('Recording is not supported in this browser.');
      if (DEBUG_RECORDING) console.warn('[InterviewPage][recording] startRecording skipped: MediaRecorder unsupported');
      return;
    }
    const liveVideoTracks = streamRef.current.getVideoTracks().filter(t => t.readyState === 'live');
    const liveAudioTracks = streamRef.current.getAudioTracks().filter(t => t.readyState === 'live');
    const activeTracks = [...liveVideoTracks, ...liveAudioTracks];
    if (activeTracks.length === 0) {
      setCameraReady(false);
      setCameraError('Camera or microphone stream is no longer active. Click Retry to reconnect.');
      if (DEBUG_RECORDING) console.warn('[InterviewPage][recording] startRecording skipped: no live tracks');
      return;
    }
    if (liveAudioTracks.length === 0) {
      setCameraError('Microphone audio is not available. Please allow microphone access and click Retry.');
      if (DEBUG_RECORDING) {
        console.warn('[InterviewPage][audio] startRecording has no live audio tracks', {
          allAudioTracks: streamRef.current.getAudioTracks().map(describeTrack),
          allVideoTracks: streamRef.current.getVideoTracks().map(describeTrack),
        });
      }
      return;
    }
    liveAudioTracks.forEach(track => {
      if (!track.enabled) track.enabled = true;
    });
    if (recorderRef.current?.state === 'recording') {
      if (DEBUG_RECORDING) console.log('[InterviewPage][recording] startRecording skipped: already recording');
      return;
    }

    const qid       = String(questions[currentQuestion]?.id ?? currentQuestion);
    const mimeType  = pickMimeType();
    const localChunks = [];                  // per-recorder closure (race-safe)
    const startedAt   = Date.now();
    if (DEBUG_RECORDING) {
      console.log('[InterviewPage][recording] MediaRecorder init', {
        qid,
        mimeType,
        streamAudioTracks: streamRef.current.getAudioTracks().map(describeTrack),
        streamVideoTracks: streamRef.current.getVideoTracks().map(describeTrack),
      });
    }

    // Use an explicit recording stream so the recorder always receives both
    // the live video track(s) and live microphone track(s). The preview still
    // uses streamRef.current; this stream is only for MediaRecorder.
    const recordingStream = new MediaStream([...liveVideoTracks, ...liveAudioTracks]);
    if (DEBUG_RECORDING) {
      console.log('[InterviewPage][audio] recorder stream composed', {
        audioTracks: recordingStream.getAudioTracks().map(describeTrack),
        videoTracks: recordingStream.getVideoTracks().map(describeTrack),
        totalTracks: recordingStream.getTracks().length,
      });
    }

    let recorder;
    try {
      recorder = buildRecorder(recordingStream, mimeType);
    } catch (err) {
      setCameraError(`Could not start recording: ${err.message || err}`);
      if (DEBUG_RECORDING) console.error('[InterviewPage][recording] MediaRecorder init failed', { qid, error: err?.message || String(err) });
      return;
    }

    const stopPromise = new Promise(resolve => {
      recorder.__resolveStop = resolve;
    });
    recorder.__stopPromise = stopPromise;
    stopPromiseRef.current = stopPromise;

    recorder.ondataavailable = (e) => {
      if (DEBUG_RECORDING) {
        console.log('[InterviewPage][recording] ondataavailable', {
          qid,
          size: e.data?.size || 0,
          type: e.data?.type,
          chunksBefore: localChunks.length,
        });
      }
      if (e.data && e.data.size > 0) localChunks.push(e.data);
    };

    recorder.onstop = () => {
      if (DEBUG_RECORDING) {
        console.log('[InterviewPage][recording] onstop fired', {
          qid,
          chunks: localChunks.length,
          totalBytes: localChunks.reduce((sum, c) => sum + c.size, 0),
        });
      }
      try {
        if (localChunks.length === 0) {
          // Empty recording (e.g. permission revoked instantly) — nothing to upload.
          setStatus(qid, 'idle', null);
          if (DEBUG_RECORDING) console.warn('[InterviewPage][recording] onstop empty chunks: upload not enqueued', { qid });
          return;
        }
        const finalMime  = mimeType || 'video/webm';
        const blob       = new Blob(localChunks, { type: finalMime });
        const durationMs = Date.now() - startedAt;
        if (DEBUG_RECORDING) {
          console.log('[InterviewPage][recording] blob created', {
            qid,
            blobSize: blob.size,
            blobType: blob.type,
            durationMs,
            audioTracksAtStop: recorder.stream?.getAudioTracks().map(describeTrack),
            videoTracksAtStop: recorder.stream?.getVideoTracks().map(describeTrack),
          });
        }

        const entry = getEntry(qid);

        // If a stale upload is in-flight for this qid, abort it: the new blob supersedes.
        if (entry.abortController) {
          try { entry.abortController.abort(); } catch (_) { /* ignore */ }
          entry.abortController = null;
        }
        // Cancel any pending retry timer for the previous attempt.
        const tid = retryTimersRef.current.get(qid);
        if (tid) {
          clearTimeout(tid);
          retryTimersRef.current.delete(qid);
        }

        entry.blob                = blob;
        entry.mime                = finalMime;
        entry.recordingDurationMs = durationMs;
        entry.attempts            = 0;
        entry.error               = null;
        entry.metrics             = null;
        entry.transcript          = null;
        setStatus(qid, 'uploading', null);

        if (DEBUG_RECORDING) {
          console.log('[InterviewPage][recording] entry populated, enqueueing', {
            qid,
            blobSize: entry.blob?.size,
            status: entry.status,
          });
        }
        enqueueUpload(qid);
      } finally {
        recorder.__resolveStop?.();
      }
    };

    recorder.onerror = (e) => {
      console.error('MediaRecorder error:', e.error || e);
      setCameraError(`Recording error: ${e.error?.message || 'unknown'}`);
    };

    try {
      // Use a timeslice so browsers periodically flush data. Without this,
      // some WebM implementations only emit data at stop and can produce an
      // empty blob if stop/submit happens immediately after a UI transition.
      recorder.start(1000);
      if (DEBUG_RECORDING) {
        console.log('[InterviewPage][recording] MediaRecorder.start ok', {
          qid,
          state: recorder.state,
          mimeType: recorder.mimeType,
          recorderAudioTracks: recorder.stream?.getAudioTracks().map(describeTrack),
          recorderVideoTracks: recorder.stream?.getVideoTracks().map(describeTrack),
        });
      }
      recorderRef.current = recorder;
      setStatus(qid, 'recording', null);
      setIsRecording(true);
    } catch (err) {
      recorder.__resolveStop?.();
      console.error('startRecording failed:', err);
      setCameraError(`Could not start recording: ${err.message}`);
      if (DEBUG_RECORDING) console.error('[InterviewPage][recording] MediaRecorder.start failed', { qid, error: err?.message || String(err) });
    }
  };

  const stopRecording = ({ save = true } = {}) => {
    const recorder = recorderRef.current;
    if (!recorder) {
      setIsRecording(false);
      if (DEBUG_RECORDING) console.log('[InterviewPage][recording] stopRecording: no recorder', { save });
      return stopPromiseRef.current || Promise.resolve();
    }
    const done = recorder.__stopPromise || Promise.resolve();
    if (DEBUG_RECORDING) {
      console.log('[InterviewPage][recording] stopRecording requested', {
        save,
        state: recorder.state,
        mimeType: recorder.mimeType,
      });
    }
    if (recorder.state !== 'inactive') {
      if (!save) {
        recorder.ondataavailable = null;
        recorder.onstop = () => recorder.__resolveStop?.();
      } else {
        try { recorder.requestData?.(); } catch (_) { /* ignore */ }
      }
      try { recorder.stop(); } catch (_) { recorder.__resolveStop?.(); }
    } else {
      recorder.__resolveStop?.();
    }
    recorderRef.current = null;
    setIsRecording(false);
    return done;
  };

  // Auto-start recording when question changes — but skip if the answer
  // for this question was already analyzed (refresh recovery), and skip
  // entirely when the user opted into text-only mode.
  useEffect(() => {
    if (cameraOptOut) return;
    if (!cameraReady) return;
    if (!questions || questions.length === 0) return;

    const qid    = String(questions[currentQuestion]?.id ?? currentQuestion);
    const entry  = recordingsMapRef.current.get(qid);
    const skip   = entry && (
      entry.status === 'analyzed' ||
      entry.status === 'uploading' ||
      entry.status === 'retrying' ||
      entry.status === 'recording'
    );
    if (skip) return;

    const handle = setTimeout(() => {
      if (DEBUG_RECORDING) {
        console.log('[InterviewPage][recording] auto-start timer fired', { qid, currentQuestion });
      }
      startRecording();
    }, 800);
    return () => {
      clearTimeout(handle);
      if (DEBUG_RECORDING) {
        console.log('[InterviewPage][recording] auto-start cleanup: stopping current recorder if any', { qid, currentQuestion });
      }
      stopRecording({ save: true });         // hands the blob off to the queue
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentQuestion, cameraReady, questions.length, cameraOptOut]);

  // =========================================================================
  // 4) Text-to-speech
  // =========================================================================
  const speakQuestion = (text) => {
    try { window.speechSynthesis.cancel(); } catch (_) { /* */ }
    if (!speechEnabled || !text) return;
    setIsSpeaking(true);
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate   = 0.9;
    utterance.pitch  = 1.0;
    utterance.volume = 1.0;
    const voices = window.speechSynthesis.getVoices();
    const preferred = voices.find(v => v.name.includes('Female') || v.name.includes('Google US English'));
    if (preferred) utterance.voice = preferred;
    utterance.onend  = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);
    window.speechSynthesis.speak(utterance);
  };

  const stopSpeaking = () => {
    try { window.speechSynthesis.cancel(); } catch (_) { /* */ }
    setIsSpeaking(false);
  };

  useEffect(() => {
    if (questions.length > 0 && questions[currentQuestion] && speechEnabled) {
      const t = setTimeout(() => speakQuestion(questions[currentQuestion].text), 500);
      return () => { clearTimeout(t); stopSpeaking(); };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentQuestion, questions, speechEnabled]);

  // =========================================================================
  // 5) Countdown timer + auto-submit on zero
  // =========================================================================
  useEffect(() => {
    const interval = setInterval(() => {
      setTimer(prev => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (timer === 0 && !autoSubmittedRef.current && !isSubmitting) {
      autoSubmittedRef.current = true;
      const finalAnswers = { ...answers, [currentQuestion]: currentAnswer };
      setAnswers(finalAnswers);
      submitInterviewResults(finalAnswers, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timer]);

  useEffect(() => {
    setCurrentAnswer(answers[currentQuestion] || '');
  }, [currentQuestion, answers]);

  const formatTime = (seconds) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const timerColour = (() => {
    const pct = seedSeconds > 0 ? timer / seedSeconds : 1;
    if (pct < 0.1) return 'danger';
    if (pct < 0.2) return 'warning';
    return 'primary';
  })();

  // =========================================================================
  // 6) Visibility handling — non-blocking banner; recording continues.
  // =========================================================================
  useEffect(() => {
    const onVis = () => setPageHidden(document.hidden);
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  // =========================================================================
  // 7) Unmount cleanup — abort uploads, clear timers, stop tracks, cancel TTS.
  // =========================================================================
  useEffect(() => {
    // Important in React dev/StrictMode: effect cleanup can run and then the
    // effect is set up again without a real page leave. Reset the cancellation
    // flag here so the upload queue is allowed to call /analyze-video.
    cancelledRef.current = false;
    if (DEBUG_RECORDING) console.log('[InterviewPage][recording] lifecycle active: cancelledRef=false');

    return () => {
      cancelledRef.current = true;
      if (DEBUG_RECORDING) console.log('[InterviewPage][recording] lifecycle cleanup: cancelledRef=true');
      try { stopRecording({ save: false }); } catch (_) { /* ignore */ }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => {
          t.onended = null;
          try { t.stop(); } catch (_) { /* ignore */ }
        });
        streamRef.current = null;
      }
      recordingsMapRef.current.forEach((e) => {
        if (e.abortController) { try { e.abortController.abort(); } catch (_) { /* */ } }
      });
      retryTimersRef.current.forEach((tid) => clearTimeout(tid));
      retryTimersRef.current.clear();
      try { window.speechSynthesis.cancel(); } catch (_) { /* */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // =========================================================================
  // 8) Navigation handlers
  // =========================================================================
  const handleNext = async () => {
    stopSpeaking();
    await stopRecording({ save: true });
    const finalAnswers = { ...answers, [currentQuestion]: currentAnswer };
    setAnswers(finalAnswers);
    if (currentQuestion < questions.length - 1) {
      setCurrentQuestion(currentQuestion + 1);
    } else {
      await submitInterviewResults(finalAnswers);
    }
  };

  const handleFinish = async () => {
    stopSpeaking();
    await stopRecording({ save: true });
    const finalAnswers = { ...answers, [currentQuestion]: currentAnswer };
    setAnswers(finalAnswers);
    await submitInterviewResults(finalAnswers);
  };

  const handleEndInterview = async () => {
    if (!window.confirm('End the interview now? Your progress will be saved.')) return;
    stopSpeaking();
    await stopRecording({ save: true });
    const finalAnswers = { ...answers, [currentQuestion]: currentAnswer };
    setAnswers(finalAnswers);
    await submitInterviewResults(finalAnswers);
  };

  // =========================================================================
  // 9) Submit — composes payload from cached metrics; max 5 s wait for queue.
  // =========================================================================
  const submitInterviewResults = async (finalAnswersObj, timerExpired = false) => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setSubmitError(null);
    setSubmitMessage(timerExpired ? 'Time is up! Saving your interview…' : 'Saving your interview…');

    try {
      // Timer auto-submit and direct submit can happen while a recording is
      // still active. MediaRecorder.stop() finishes asynchronously, so wait
      // for onstop to enqueue the upload before waiting on the upload queue.
      await stopRecording({ save: true });

      const finalAnswers = finalAnswersObj || answers;
      const actualElapsedSeconds = Math.min(
        Math.round((Date.now() - startTimeRef.current) / 1000),
        seedSeconds
      );

      // Drain queued/in-flight analyses before building the final payload.
      // This is what ensures transcripts and multimodal metrics make it into
      // /submit instead of arriving after the feedback page has already opened.
      setSubmitMessage('Processing last responses…');
      const drainResult = await waitForUploadDrain(20000);
      if (drainResult.timedOut) {
        setSubmitMessage('AI analysis is still running; submitting available results…');
        await sleep(800);
      }

      const answersData = questions.map((q, index) => {
        const qid       = String(q.id ?? index);
        const entry     = recordingsMapRef.current.get(qid);
        const typed     = (finalAnswers[index] || '').trim();
        const transcript = entry?.transcript || null;
        const usedAnswer = typed || transcript || '';

        const row = {
          questionId:   qid,
          questionText: q.text,
          answer:       usedAnswer,
          timestamp:    new Date(),
          skipped:      !usedAnswer,
        };
        if (entry?.metrics?.audio_metrics) row.audio_metrics = entry.metrics.audio_metrics;
        if (entry?.metrics?.video_metrics) row.video_metrics = entry.metrics.video_metrics;
        // Forward emotion objects so backend can persist and FeedbackPage can render them.
        if (entry?.metrics?.audio_emotion) row.audio_emotion = entry.metrics.audio_emotion;
        if (entry?.metrics?.video_emotion) row.video_emotion = entry.metrics.video_emotion;
        if (transcript)                     row.transcript          = transcript;
        if (entry?.mime)                    row.recordingMime       = entry.mime;
        if (entry?.recordingDurationMs)     row.recordingDurationMs = entry.recordingDurationMs;
        console.log('[EMOTION DEBUG] submitInterviewResults answer row for qid', qid, {
          has_audio_emotion: Boolean(row.audio_emotion),
          has_video_emotion: Boolean(row.video_emotion),
          audio_emotion_dominant: row.audio_emotion?.dominant,
          video_emotion_dominant: row.video_emotion?.dominant,
        });
        return row;
      });

      const interviewData = {
        title:         `${interviewType || 'General'} Interview`,
        interviewType: interviewType || 'general',
        questions: questions.map((q, i) => ({
          text:     q.text,
          category: q.category || interviewType || 'general',
          id:       q.id || `q${i}`,
        })),
        answers:   answersData,
        timeSpent: actualElapsedSeconds,
        confidence,
        cvData:    cvData || {},
      };

      setSubmitMessage('Sending to the AI for evaluation…');
      const response = await apiService.submitInterview(interviewData);

      if (!response.success) {
        throw new Error(response.error || 'Failed to submit interview');
      }

      // Clean up persisted state and cache (interview is now in the DB).
      try { sessionStorage.removeItem(STORAGE_KEY); } catch (_) { /* */ }
      clearCache();
      // Release any remaining blobs.
      recordingsMapRef.current.forEach((e) => { e.blob = null; });
      recordingsMapRef.current.clear();

      const interviewId =
        response.data?.interview?._id ||
        response.data?.interview?.id;
      if (!interviewId) {
        throw new Error('Interview was saved but no ID was returned');
      }

      setSubmitMessage('Loading your feedback…');
      navigate(`/feedback/${interviewId}`, {
        state: { feedback: response.data.interview },
      });
    } catch (err) {
      console.error('[InterviewPage] submit failed:', err);
      setSubmitError(err.message || 'An error occurred while submitting your interview.');
      autoSubmittedRef.current = false;
    } finally {
      setIsSubmitting(false);
    }
  };

  // =========================================================================
  // 10) Render helpers
  // =========================================================================
  const getQuestionStatus = (index) => {
    if (index < currentQuestion) return 'completed';
    if (index === currentQuestion) return 'current';
    return 'upcoming';
  };

  const getStatusIcon = (status) => {
    if (status === 'completed') return 'check-circle-fill text-success';
    if (status === 'current')   return 'circle-fill text-primary';
    return 'circle text-muted';
  };

  /** Returns a small badge configuration for a recording status string. */
  const recordingBadge = (status) => {
    switch (status) {
      case 'recording':
        return { cls: 'bg-danger',        icon: 'record-circle-fill', label: 'Recording' };
      case 'uploading':
        return { cls: 'bg-info text-dark',icon: 'cloud-upload',       label: 'Uploading…' };
      case 'retrying':
        return { cls: 'bg-warning text-dark', icon: 'arrow-clockwise',label: 'Retrying…' };
      case 'analyzed':
        return { cls: 'bg-success bg-opacity-10 text-success', icon: 'check-circle', label: 'Analyzed' };
      case 'failed':
        return { cls: 'bg-danger bg-opacity-10 text-danger', icon: 'exclamation-triangle', label: 'Upload failed' };
      default:
        return { cls: 'bg-body-secondary text-muted', icon: 'circle', label: 'Not recording' };
    }
  };

  // =========================================================================
  // 11) Render — Camera-first AI interview experience (Phase 3-C)
  // =========================================================================
  if (!questions || questions.length === 0) {
    return (
      <div className="bg-body min-vh-100 d-flex align-items-center justify-content-center">
        <div className="text-center">
          <div className="spinner-border text-primary mb-3" role="status">
            <span className="visually-hidden">Loading…</span>
          </div>
          <p className="text-muted">Loading interview questions…</p>
        </div>
      </div>
    );
  }

  const currentQid        = String(questions[currentQuestion]?.id ?? currentQuestion);
  const currentEntry      = recordingsMapRef.current.get(currentQid);
  const currentStatus     = recordingStatus[currentQid] || currentEntry?.status || 'idle';
  const currentBadge      = recordingBadge(currentStatus);
  const currentError      = recordingErrors[currentQid] || '';
  const currentTranscript = currentEntry?.transcript || null;
  const isLastQuestion    = currentQuestion === questions.length - 1;

  // Single source of truth for what to render inside the camera stage.
  const cameraView = cameraOptOut    ? 'opted-out'
                  : permissionPending ? 'loading'
                  : !cameraReady      ? 'denied'
                  : 'ready';

  return (
    <div className="bg-body min-vh-100 interview-stage">
      {isSubmitting && (
        <LoadingSpinner
          message={submitMessage || 'Submitting your interview…'}
          fullScreen={true}
        />
      )}

      {/* Top Navigation */}
      <nav className="navbar bg-body-tertiary shadow-sm">
        <div className="container-fluid">
          <div className="d-flex align-items-center">
            <div className="icon-circle bg-gradient-secondary me-2">
              <i className="bi bi-brain text-white"></i>
            </div>
            <span className="fw-bold">AI Interview</span>
          </div>
          <div className="d-flex align-items-center gap-3">
            <ThemeToggle compact />
            <div
              className={`timer-badge${timer === 0 ? ' text-danger fw-bold' : ''}`}
              style={
                timer < seedSeconds * 0.1 ? { borderColor: '#ef4444', color: '#ef4444' } :
                timer < seedSeconds * 0.2 ? { borderColor: '#f59e0b', color: '#f59e0b' } : {}
              }
            >
              <i className={`bi bi-${timerColour === 'danger' ? 'alarm-fill' : 'clock'} me-2`}></i>
              {timer === 0 ? "Time's up!" : formatTime(timer)}
            </div>
            <button
              className="btn btn-outline-danger"
              onClick={handleEndInterview}
              disabled={isSubmitting}
            >
              End Interview
            </button>
          </div>
        </div>
      </nav>

      {/* Tab-hidden overlay — non-blocking elegant strip */}
      {pageHidden && (
        <div className="hidden-tab-banner" role="status">
          <i className="bi bi-eye-slash me-2"></i>
          Interview continues while this tab is hidden.
        </div>
      )}

      {/* Progress strip */}
      <div className="bg-body border-bottom">
        <div className="container-fluid">
          <div className="py-3">
            <div className="d-flex justify-content-between align-items-center mb-2">
              <small className="text-muted fw-semibold">
                Question {currentQuestion + 1} of {questions.length}
              </small>
              <small className="text-muted">
                {Math.round((currentQuestion / questions.length) * 100)}% complete
              </small>
            </div>
            <div className="progress" style={{ height: '8px' }}>
              <div
                className="progress-bar bg-gradient-secondary"
                style={{ width: `${(currentQuestion / questions.length) * 100}%` }}
              />
            </div>
            <div className="progress-dots mt-3">
              {questions.map((_, index) => (
                <div key={index} className={`progress-dot ${getQuestionStatus(index)}`}></div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="container-fluid py-4">
        {submitError && (
          <div className="alert alert-danger d-flex align-items-center justify-content-between" role="alert">
            <div>
              <i className="bi bi-exclamation-triangle-fill me-2"></i>
              {submitError}
            </div>
            <div className="d-flex gap-2">
              <button
                className="btn btn-sm btn-primary"
                onClick={() => {
                  setSubmitError(null);
                  const fa = { ...answers, [currentQuestion]: currentAnswer };
                  submitInterviewResults(fa);
                }}
              >
                Retry
              </button>
              <button className="btn btn-sm btn-outline-danger" onClick={() => setSubmitError(null)}>
                Dismiss
              </button>
            </div>
          </div>
        )}

        <div className="row g-4">
          {/* MAIN: Question + Camera + Actions */}
          <div className="col-12 col-lg-8">
            {/* Question card */}
            <div className="card border-0 shadow-sm mb-3 question-card">
              <div className="card-body p-4">
                <div className="d-flex align-items-start justify-content-between mb-2 flex-wrap gap-2">
                  <div className="d-flex align-items-center small fw-semibold flex-wrap gap-2">
                    <span className="ai-coach-tag">
                      <i className="bi bi-stars me-1"></i>Your Personal AI Coach
                    </span>
                    {isSpeaking && (
                      <span className="speaking-badge">
                        <i className="bi bi-soundwave me-1"></i>Speaking…
                      </span>
                    )}
                  </div>
                  <div className="d-flex gap-2">
                    <button
                      className="btn btn-sm btn-outline-primary"
                      onClick={() => speakQuestion(questions[currentQuestion]?.text)}
                      disabled={isSpeaking}
                      title="Replay question"
                      aria-label="Replay question"
                    >
                      <i className="bi bi-volume-up"></i>
                    </button>
                    <button
                      className={`btn btn-sm ${speechEnabled ? 'btn-primary' : 'btn-outline-secondary'}`}
                      onClick={() => { setSpeechEnabled(!speechEnabled); if (speechEnabled) stopSpeaking(); }}
                      title={speechEnabled ? 'Disable voice' : 'Enable voice'}
                      aria-label={speechEnabled ? 'Disable voice' : 'Enable voice'}
                    >
                      <i className={`bi bi-${speechEnabled ? 'volume-up-fill' : 'volume-mute-fill'}`}></i>
                    </button>
                  </div>
                </div>
                <h3 className="fw-bold mb-0 question-text">
                  {questions[currentQuestion]?.text || 'Loading question…'}
                </h3>
              </div>
            </div>

            {/* Camera Stage — the centerpiece */}
            <div className={`camera-stage${isRecording ? ' recording' : ''}${currentStatus === 'analyzed' ? ' analyzed' : ''}`}>
              {/* Always render the <video> so the ref stays mounted; overlays sit on top. */}
              <video
                ref={videoRef}
                autoPlay
                muted
                playsInline
                aria-label="Live camera preview"
                style={{ visibility: cameraView === 'ready' ? 'visible' : 'hidden' }}
              />

              {cameraView === 'loading' && (
                <div className="cam-overlay-fill">
                  <div className="spinner-border text-light" role="status">
                    <span className="visually-hidden">Initialising camera…</span>
                  </div>
                  <p className="text-light mt-3 small mb-0">Requesting camera &amp; microphone…</p>
                </div>
              )}

              {cameraView === 'denied' && (
                <div className="cam-overlay-fill permission-card">
                  <i className="bi bi-camera-video-off display-4 text-light mb-3"></i>
                  <h5 className="text-light fw-bold mb-2">Camera &amp; Microphone Required</h5>
                  <p className="text-light-soft small text-center mb-3" style={{ maxWidth: 380 }}>
                    {cameraError || 'Please allow camera and microphone access in your browser to record your interview answers.'}
                  </p>
                  <div className="d-flex gap-2 flex-wrap justify-content-center">
                    <button className="btn btn-light btn-sm" onClick={initMedia}>
                      <i className="bi bi-arrow-clockwise me-1"></i>Enable permissions
                    </button>
                    <button className="btn btn-outline-light btn-sm" onClick={continueWithoutCamera}>
                      Continue without camera
                    </button>
                  </div>
                </div>
              )}

              {cameraView === 'opted-out' && (
                <div className="cam-overlay-fill permission-card">
                  <i className="bi bi-pencil-square display-4 text-light mb-3"></i>
                  <h5 className="text-light fw-bold mb-2">Text-only mode</h5>
                  <p className="text-light-soft small text-center mb-3" style={{ maxWidth: 380 }}>
                    Camera is disabled. Use the notes panel below to type your answers.
                  </p>
                  <button className="btn btn-light btn-sm" onClick={reEnableCamera}>
                    <i className="bi bi-camera-video me-1"></i>Re-enable camera
                  </button>
                </div>
              )}

              {/* Top-right status badge */}
              <div className="cam-overlay-tr">
                <span className={`badge ${currentBadge.cls}`}>
                  <i className={`bi bi-${currentBadge.icon} me-1`}></i>{currentBadge.label}
                </span>
              </div>

              {/* Top-left REC pill */}
              {isRecording && (
                <div className="cam-overlay-tl">
                  <span className="rec-pill">
                    <span className="rec-dot"></span>REC
                  </span>
                </div>
              )}

              {/* Bottom: mic activity bars while recording */}
              {isRecording && (
                <div className="cam-overlay-bottom">
                  <div className="mic-bars" aria-hidden="true">
                    <span></span><span></span><span></span><span></span><span></span>
                  </div>
                  <small className="ms-2 text-light-soft">Listening…</small>
                </div>
              )}

              {/* AI Coach speaking overlay */}
              {isSpeaking && cameraView === 'ready' && (
                <div className="cam-overlay-speaking">
                  <i className="bi bi-soundwave me-2"></i>AI Coach is speaking…
                </div>
              )}
            </div>

            {/* Action bar */}
            <div className="d-flex flex-wrap gap-2 mt-3 align-items-center action-bar">
              <button
                className={`btn ${isRecording ? 'btn-danger' : 'btn-outline-primary'}`}
                onClick={() => isRecording ? stopRecording({ save: true }) : startRecording()}
                disabled={!cameraReady || isSubmitting || cameraOptOut}
                title={cameraReady ? '' : (cameraOptOut ? 'Text-only mode' : 'Camera/mic not available')}
              >
                <i className={`bi bi-mic${isRecording ? '-fill' : ''} me-2`}></i>
                {isRecording ? 'Stop Recording' : 'Start Recording'}
              </button>

              {currentStatus === 'failed' && (
                <button className="btn btn-outline-danger" onClick={() => manualRetry(currentQid)}>
                  <i className="bi bi-arrow-clockwise me-2"></i>Retry analysis
                </button>
              )}

              <button
                className="btn btn-outline-secondary"
                onClick={() => setShowNotes(!showNotes)}
                aria-expanded={showNotes}
                aria-controls="optional-notes-panel"
              >
                <i className={`bi bi-pencil${showNotes ? '-fill' : ''} me-2`}></i>
                {showNotes ? 'Hide notes' : 'Add notes (optional)'}
              </button>

              <div className="ms-auto d-flex gap-2">
                {isLastQuestion ? (
                  <button
                    className="btn btn-success"
                    onClick={handleNext}
                    disabled={isSubmitting}
                  >
                    <i className="bi bi-check-circle me-2"></i>Finish Interview
                  </button>
                ) : (
                  <button
                    className="btn btn-gradient"
                    onClick={handleNext}
                    disabled={isSubmitting}
                  >
                    Next Question<i className="bi bi-arrow-right ms-2"></i>
                  </button>
                )}
              </div>
            </div>

            {/* Optional notes panel — collapsed by default */}
            {showNotes && (
              <div id="optional-notes-panel" className="card border-0 shadow-sm mt-3 notes-card">
                <div className="card-body">
                  <label htmlFor="notes-textarea" className="form-label small fw-semibold text-muted mb-2">
                    <i className="bi bi-pencil me-1"></i>Optional notes
                  </label>
                  <textarea
                    id="notes-textarea"
                    className="form-control"
                    rows="3"
                    placeholder="Type a brief note to supplement your spoken answer…"
                    value={currentAnswer}
                    onChange={(e) => setCurrentAnswer(e.target.value)}
                    disabled={isSubmitting}
                  />
                  <div className="d-flex justify-content-between align-items-center mt-2">
                    <small className="text-muted">{currentAnswer.length} characters</small>
                    {currentAnswer && (
                      <button
                        className="btn btn-link btn-sm text-decoration-none"
                        onClick={() => setCurrentAnswer('')}
                        disabled={isSubmitting}
                      >
                        Clear
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* SIDEBAR: AI Coach + Live status + Progress */}
          <div className="col-12 col-lg-4">
            {/* AI Coach */}
            <div className="card border-0 shadow-sm mb-4 coach-card">
              <div className="card-body text-center py-4">
                <div className={`coach-avatar mx-auto mb-3${isSpeaking ? ' speaking' : ''}`}>
                  <i className="bi bi-robot text-white"></i>
                </div>
                <h5 className="fw-bold mb-1">Your Personal AI Coach</h5>
                <p className="text-muted small mb-3">AI Interviewer</p>
                <div className={isSpeaking ? 'status-speaking' : 'status-listening'}>
                  <span className="status-dot pulse"></span>
                  {isSpeaking ? 'Speaking' : 'Listening'}
                </div>
              </div>
            </div>

            {/* Live status panel */}
            <div className="card border-0 shadow-sm mb-4">
              <div className="card-body">
                <h6 className="fw-bold mb-3 d-flex align-items-center">
                  <i className="bi bi-broadcast me-2 text-primary"></i>Live Status
                </h6>
                <div className={`live-status-bar ${currentStatus}`}>
                  <i className={`bi bi-${currentBadge.icon} me-2`}></i>
                  <span className="fw-semibold">{currentBadge.label}</span>
                </div>
                {currentStatus === 'failed' && (
                  <>
                    {currentError && (
                      <div className="small text-danger mt-2">{currentError}</div>
                    )}
                    <button
                      className="btn btn-sm btn-outline-danger mt-2 w-100"
                      onClick={() => manualRetry(currentQid)}
                    >
                      <i className="bi bi-arrow-clockwise me-1"></i>Retry analysis
                    </button>
                  </>
                )}
                {currentStatus === 'analyzed' && currentTranscript && (
                  <div className="mt-3">
                    <small className="text-muted d-block mb-1">Transcript preview</small>
                    <div className="small transcript-preview">
                      &ldquo;{currentTranscript.length > 140 ? `${currentTranscript.slice(0, 140)}…` : currentTranscript}&rdquo;
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Progress / Questions */}
            <div className="card border-0 shadow-sm">
              <div className="card-body">
                <h6 className="fw-bold mb-3 d-flex align-items-center">
                  <i className="bi bi-list-task me-2 text-primary"></i>Progress
                </h6>
                {questions.map((q, index) => {
                  const qid = String(q.id ?? index);
                  const s   = recordingStatus[qid];
                  const dot = s === 'analyzed'                    ? 'check-circle-fill text-success'
                            : (s === 'uploading' || s === 'retrying') ? 'cloud-upload text-info'
                            : s === 'failed'                    ? 'exclamation-triangle-fill text-danger'
                            : null;
                  return (
                    <div
                      key={q.id}
                      className={`d-flex align-items-start mb-3 pb-3 ${index < questions.length - 1 ? 'border-bottom' : ''}`}
                    >
                      <i className={`bi bi-${getStatusIcon(getQuestionStatus(index))} me-2 mt-1`}></i>
                      <div className="flex-grow-1">
                        <small className={`${getQuestionStatus(index) === 'current' ? 'fw-bold text-primary' : 'text-muted'}`}>
                          Question {index + 1}
                          {dot && <i className={`bi bi-${dot} ms-2`} title={s} style={{ fontSize: '0.75rem' }}></i>}
                        </small>
                        {getQuestionStatus(index) === 'current' && (
                          <div className="small text-muted mt-1">{(q.text || '').substring(0, 60)}…</div>
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

      {/* Page-scoped styles for the camera-first interview UI */}
      <style>{`
        .interview-stage { --rec-color:#ef4444; --analyzed-color:#10b981; }

        .hidden-tab-banner {
          background: linear-gradient(90deg,#1e293b 0%,#0f172a 100%);
          color:#e2e8f0; padding:0.6rem 1rem; text-align:center;
          font-size:0.875rem; border-bottom:1px solid rgba(255,255,255,0.06);
        }

        .ai-coach-tag {
          display:inline-flex; align-items:center; padding:4px 10px;
          background:linear-gradient(135deg,rgba(99,102,241,0.12) 0%,rgba(139,92,246,0.12) 100%);
          color:#6366f1; border-radius:999px; font-weight:600;
          font-size:0.75rem; letter-spacing:0.02em;
        }
        .speaking-badge {
          display:inline-flex; align-items:center; padding:4px 10px;
          background:rgba(16,185,129,0.12); color:#047857;
          border-radius:999px; font-weight:600; font-size:0.75rem;
          animation: speakBadgePulse 1.4s ease-in-out infinite;
        }
        @keyframes speakBadgePulse {
          0%,100% { opacity:0.85; transform:scale(1); }
          50%     { opacity:1;    transform:scale(1.04); }
        }
        .question-card .question-text { line-height:1.4; }

        .camera-stage {
          position:relative; width:100%; aspect-ratio:16/9;
          background:linear-gradient(135deg,#0f172a 0%,#1e293b 100%);
          border-radius:18px; overflow:hidden;
          box-shadow:0 10px 30px rgba(15,23,42,0.18);
          transition: box-shadow 0.35s ease, transform 0.35s ease;
        }
        .camera-stage video {
          width:100%; height:100%; object-fit:cover; display:block;
        }
        .camera-stage.recording {
          animation: camGlow 1.6s ease-in-out infinite;
        }
        @keyframes camGlow {
          0%,100% { box-shadow:0 0 0 3px rgba(239,68,68,0.85),0 0 22px rgba(239,68,68,0.45),0 10px 40px rgba(239,68,68,0.18); }
          50%     { box-shadow:0 0 0 4px rgba(239,68,68,1),    0 0 32px rgba(239,68,68,0.65),0 12px 50px rgba(239,68,68,0.28); }
        }
        .camera-stage.analyzed:not(.recording) {
          box-shadow:0 0 0 2px rgba(16,185,129,0.55),0 10px 30px rgba(16,185,129,0.18);
        }

        .cam-overlay-fill {
          position:absolute; inset:0;
          display:flex; align-items:center; justify-content:center; flex-direction:column;
          text-align:center; padding:1.5rem;
          background:rgba(15,23,42,0.78);
          backdrop-filter: blur(2px);
          z-index:1;
        }
        .text-light-soft { color:rgba(255,255,255,0.7); }

        .cam-overlay-tr { position:absolute; top:14px; right:14px; z-index:2; }
        .cam-overlay-tl { position:absolute; top:14px; left:14px;  z-index:2; }
        .cam-overlay-bottom {
          position:absolute; bottom:14px; left:14px; right:14px;
          display:flex; align-items:center; z-index:2;
        }
        .cam-overlay-speaking {
          position:absolute; bottom:14px; right:14px;
          background:rgba(16,185,129,0.95); color:#fff;
          padding:6px 12px; border-radius:999px; font-size:0.8rem;
          display:inline-flex; align-items:center; z-index:3;
          box-shadow:0 4px 14px rgba(16,185,129,0.35);
        }

        .rec-pill {
          display:inline-flex; align-items:center;
          background:rgba(239,68,68,0.95); color:#fff;
          padding:5px 11px; border-radius:999px;
          font-size:0.75rem; font-weight:700; letter-spacing:0.08em;
          box-shadow:0 4px 14px rgba(239,68,68,0.35);
        }
        .rec-dot {
          width:8px; height:8px; background:#fff; border-radius:50%;
          margin-right:6px; animation: recBlink 1s ease-in-out infinite;
        }
        @keyframes recBlink { 0%,100%{opacity:1;} 50%{opacity:0.3;} }

        .mic-bars { display:inline-flex; align-items:flex-end; gap:3px; height:22px; }
        .mic-bars span {
          width:4px; height:100%;
          background:linear-gradient(180deg,#f87171 0%,#ef4444 100%);
          border-radius:2px; transform-origin:center bottom;
          animation: barJump 0.9s ease-in-out infinite;
        }
        .mic-bars span:nth-child(2){animation-delay:.10s}
        .mic-bars span:nth-child(3){animation-delay:.20s}
        .mic-bars span:nth-child(4){animation-delay:.30s}
        .mic-bars span:nth-child(5){animation-delay:.40s}
        @keyframes barJump { 0%,100%{transform:scaleY(0.30);} 50%{transform:scaleY(1.00);} }

        .action-bar .btn { transition: transform 0.15s ease, box-shadow 0.15s ease; }
        .action-bar .btn:active { transform: translateY(1px); }
        .notes-card textarea { resize:vertical; }

        .coach-card .coach-avatar {
          width:110px; height:110px; border-radius:50%;
          background:linear-gradient(135deg,#6366f1 0%,#8b5cf6 100%);
          display:flex; align-items:center; justify-content:center;
          font-size:3.2rem; color:#fff;
          box-shadow:0 6px 24px rgba(99,102,241,0.35);
          transition: box-shadow 0.3s ease, transform 0.3s ease;
        }
        .coach-card .coach-avatar.speaking { animation: coachPulse 1.4s ease-in-out infinite; }
        @keyframes coachPulse {
          0%,100% { box-shadow:0 6px 24px rgba(99,102,241,0.35),0 0 0 0 rgba(99,102,241,0.45); transform:scale(1); }
          50%     { box-shadow:0 6px 28px rgba(99,102,241,0.5),  0 0 0 18px rgba(99,102,241,0); transform:scale(1.03); }
        }

        .status-listening, .status-speaking {
          display:inline-flex; align-items:center; gap:8px;
          padding:6px 14px; border-radius:999px;
          font-size:0.85rem; font-weight:600;
        }
        .status-listening { background:rgba(99,102,241,0.10); color:#4f46e5; }
        .status-speaking  { background:rgba(16,185,129,0.12); color:#047857; }
        .status-listening .status-dot, .status-speaking .status-dot {
          width:8px; height:8px; border-radius:50%;
        }
        .status-listening .status-dot { background:#6366f1; }
        .status-speaking  .status-dot { background:#10b981; }

        .live-status-bar {
          display:flex; align-items:center;
          padding:12px 14px; border-radius:10px;
          background:var(--color-upload-bg,#f3f4f6); font-size:0.95rem;
          transition: background-color 0.25s ease, color 0.25s ease;
        }
        .live-status-bar.recording { background:rgba(239,68,68,0.10); color:#b91c1c; }
        .live-status-bar.uploading { background:rgba(59,130,246,0.10); color:#1d4ed8; }
        .live-status-bar.retrying  { background:rgba(245,158,11,0.12); color:#b45309; }
        .live-status-bar.analyzed  { background:rgba(16,185,129,0.12); color:#047857; }
        .live-status-bar.failed    { background:rgba(239,68,68,0.10); color:#b91c1c; }

        .transcript-preview {
          padding:10px 12px; background:var(--color-upload-bg,#f9fafb);
          border-left:3px solid #10b981; border-radius:6px;
          font-style:italic; line-height:1.5;
        }

        @media (max-width: 992px) {
          .camera-stage { aspect-ratio:4/3; }
        }
        @media (max-width: 576px) {
          .question-card .question-text { font-size:1.25rem; }
          .ai-coach-tag, .speaking-badge { font-size:0.7rem; padding:3px 8px; }
          .coach-card .coach-avatar { width:90px; height:90px; font-size:2.6rem; }
        }

        @media (prefers-reduced-motion: reduce) {
          .camera-stage.recording,
          .coach-card .coach-avatar.speaking,
          .speaking-badge,
          .rec-dot,
          .mic-bars span { animation: none !important; }
        }
      `}</style>
    </div>
  );
};

export default InterviewPage;
