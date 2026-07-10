import { API_BASE_URL, API_ENDPOINTS } from '../config/api';

class ApiService {
  getToken() {
    return localStorage.getItem('token');
  }

  getAuthHeaders() {
    const token = this.getToken();
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return headers;
  }

  // -------------------------------------------------------------------------
  // CV upload + interview preparation (UploadPage)
  // -------------------------------------------------------------------------
  async uploadAndPredict(cvFile, jobDescription, interviewType, settings) {
    try {
      const token = this.getToken();
      if (!token) throw new Error('Authentication required. Please login.');

      const formData = new FormData();
      formData.append('cv_file',        cvFile);
      formData.append('job_description', jobDescription);
      formData.append('interview_type', interviewType);
      formData.append('duration',       settings.duration);
      formData.append('difficulty',     settings.difficulty);
      formData.append('voice_response', settings.voiceResponse);
      // ── Interview Preferences (new fields) ──
      if (settings.role)     formData.append('role',     settings.role);
      if (settings.language) formData.append('language', settings.language);

      const url = `${API_BASE_URL}${API_ENDPOINTS.PREPARE_INTERVIEW}`;
      console.log(`[uploadAndPredict] POST ${url}  file=${cvFile?.name} (${cvFile?.size} bytes)`);
      const t0 = Date.now();

      const response = await fetch(url, {
        method: 'POST',
        body:   formData,
        headers: { 'Authorization': `Bearer ${token}` },
      });

      const rawText = await response.text();
      let parsed = null;
      try { parsed = rawText ? JSON.parse(rawText) : null; } catch (_) {}
      console.log(`[uploadAndPredict] <- status=${response.status} (${Date.now() - t0}ms)`, parsed || rawText);

      if (!response.ok) {
        const errMsg =
          (parsed && (parsed.message || parsed.detail || parsed.error)) ||
          rawText ||
          `HTTP error! status: ${response.status}`;
        throw new Error(errMsg);
      }

      return { success: true, data: parsed || {} };
    } catch (error) {
      console.error('[uploadAndPredict] error:', error);
      return { success: false, error: error.message || 'Failed to upload and process file' };
    }
  }

  // -------------------------------------------------------------------------
  // Generic helpers
  // -------------------------------------------------------------------------
  async get(endpoint) {
    try {
      const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        method:  'GET',
        headers: this.getAuthHeaders(),
      });
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const data = await response.json();
      return { success: true, data };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async post(endpoint, data) {
    try {
      const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        method:  'POST',
        headers: this.getAuthHeaders(),
        body:    JSON.stringify(data),
      });
      if (!response.ok) {
        let errorMessage = `HTTP error! status: ${response.status}`;
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorData.message || errorMessage;
        } catch (_) {}
        throw new Error(errorMessage);
      }
      const responseData = await response.json();
      return { success: true, data: responseData };
    } catch (error) {
      console.error(`POST ${endpoint} error:`, error);
      return { success: false, error: error.message };
    }
  }

  async put(endpoint, data) {
    try {
      const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        method:  'PUT',
        headers: this.getAuthHeaders(),
        body:    JSON.stringify(data),
      });
      if (!response.ok) {
        let errorMessage = `HTTP error! status: ${response.status}`;
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorData.message || errorMessage;
        } catch (_) {}
        throw new Error(errorMessage);
      }
      const responseData = await response.json();
      return { success: true, data: responseData };
    } catch (error) {
      console.error(`PUT ${endpoint} error:`, error);
      return { success: false, error: error.message };
    }
  }

  async del(endpoint) {
    try {
      const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        method:  'DELETE',
        headers: this.getAuthHeaders(),
      });
      if (!response.ok) {
        let errorMessage = `HTTP error! status: ${response.status}`;
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorData.message || errorMessage;
        } catch (_) {}
        throw new Error(errorMessage);
      }
      const responseData = await response.json();
      return { success: true, data: responseData };
    } catch (error) {
      console.error(`DELETE ${endpoint} error:`, error);
      return { success: false, error: error.message };
    }
  }

  // -------------------------------------------------------------------------
  // User / Profile
  // -------------------------------------------------------------------------
  async getUserProfile() {
    return this.get(API_ENDPOINTS.USER_PROFILE);
  }

  async updateUserProfile(profileData) {
    return this.put(API_ENDPOINTS.USER_PROFILE, profileData);
  }

  /** Stats computed from interview history (total, avg, best, practiceTime, chartData) */
  async getUserStats() {
    return this.get(API_ENDPOINTS.INTERVIEW_STATS);
  }

  // -------------------------------------------------------------------------
  // Settings
  // -------------------------------------------------------------------------
  async getSettings() {
    return this.get(API_ENDPOINTS.USER_SETTINGS);
  }

  async updateSettings(settingsData) {
    return this.put(API_ENDPOINTS.USER_SETTINGS, settingsData);
  }

  // -------------------------------------------------------------------------
  // CV file management (Profile page)
  // -------------------------------------------------------------------------
  async getUserCVs() {
    return this.get(API_ENDPOINTS.USER_CVS);
  }

  async uploadCV(file) {
    try {
      const token = this.getToken();
      if (!token) throw new Error('Authentication required.');

      const formData = new FormData();
      formData.append('cv_file', file);

      const response = await fetch(`${API_BASE_URL}${API_ENDPOINTS.USER_CVS}`, {
        method:  'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body:    formData,
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || err.message || `HTTP ${response.status}`);
      }
      const data = await response.json();
      return { success: true, data };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async deleteCV(fileId) {
    return this.del(API_ENDPOINTS.USER_CV_DELETE(fileId));
  }

  /** Returns a download URL the browser can open directly */
  getCVDownloadUrl(fileId) {
    const token = this.getToken();
    return `${API_BASE_URL}${API_ENDPOINTS.USER_CV_DOWNLOAD(fileId)}?token=${token}`;
  }

  // -------------------------------------------------------------------------
  // Interviews
  // -------------------------------------------------------------------------
  async submitInterview(interviewData) {
    return this.post(API_ENDPOINTS.SUBMIT_INTERVIEW, interviewData);
  }

  async getInterview(interviewId) {
    return this.get(API_ENDPOINTS.INTERVIEW_BY_ID(interviewId));
  }

  async getInterviewFeedback(interviewId) {
    return this.get(API_ENDPOINTS.INTERVIEW_FEEDBACK(interviewId));
  }

  async getUserInterviews() {
    return this.get(API_ENDPOINTS.INTERVIEWS);
  }

  // -------------------------------------------------------------------------
  // Video analysis (InterviewPage)
  // opts may include: face_sample_rate, emotion_sample_rate, max_frames, signal
  // -------------------------------------------------------------------------
  async analyzeVideo(videoBlob, opts = {}) {
    try {
      const token = this.getToken();
      if (!token) throw new Error('Authentication required. Please login.');
      if (!videoBlob || !(videoBlob instanceof Blob)) throw new Error('A video Blob is required');

      // MediaRecorder often returns a Blob type with codec parameters, e.g.
      // "video/webm;codecs=vp9,opus". Some multipart parsers do not preserve
      // that cleanly and multer may see it as text/plain. Normalize the upload
      // part into an actual File/Blob with a simple MIME that matches the
      // backend allowlist: video/webm or video/mp4.
      const originalType = (videoBlob.type || '').toLowerCase();
      const uploadMime = originalType.includes('mp4') ? 'video/mp4' : 'video/webm';
      const ext = uploadMime === 'video/mp4' ? 'mp4' : 'webm';
      const filename = `answer-${Date.now()}.${ext}`;
      const uploadFile = typeof File !== 'undefined'
        ? new File([videoBlob], filename, { type: uploadMime })
        : new Blob([videoBlob], { type: uploadMime });

      const formData = new FormData();
      formData.append('file', uploadFile, filename);
      if (opts.face_sample_rate    != null) formData.append('face_sample_rate',    String(opts.face_sample_rate));
      if (opts.emotion_sample_rate != null) formData.append('emotion_sample_rate', String(opts.emotion_sample_rate));
      if (opts.max_frames          != null) formData.append('max_frames',          String(opts.max_frames));

      console.log('[apiService][recording] analyzeVideo POST start', {
        endpoint: API_ENDPOINTS.ANALYZE_VIDEO,
        blobSize: videoBlob.size,
        blobType: videoBlob.type,
        uploadMime,
        uploadFileType: uploadFile.type,
        filename,
        ext,
      });
      const response = await fetch(`${API_BASE_URL}${API_ENDPOINTS.ANALYZE_VIDEO}`, {
        method:  'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body:    formData,
        signal:  opts.signal,
      });
      console.log('[apiService][recording] analyzeVideo POST response', {
        status: response.status,
        ok: response.ok,
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.message || err.error || `HTTP ${response.status}`);
      }
      const json = await response.json();
      return { success: true, data: json.data || json };
    } catch (error) {
      // Abort is an expected control-flow signal; flag it so callers
      // (the upload queue) can skip retry-on-abort.
      if (error && (error.name === 'AbortError' || error.code === 20)) {
        return { success: false, error: 'Upload aborted', aborted: true };
      }
      console.error('analyzeVideo error:', error);
      return { success: false, error: error.message || 'Failed to analyze video' };
    }
  }
}

const apiService = new ApiService();
export default apiService;
