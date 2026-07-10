// API Configuration
export const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000';

export const API_ENDPOINTS = {
  // Interview lifecycle
  PREPARE_INTERVIEW:   '/api/interview/predict',
  ANALYZE_VIDEO:       '/api/interview/analyze-video',
  SUBMIT_INTERVIEW:    '/api/interview/submit',
  INTERVIEW_STATS:     '/api/interview/stats',
  INTERVIEW_FEEDBACK:  (id) => `/api/interview/${id}/feedback`,
  INTERVIEWS:          '/api/interview',
  INTERVIEW_BY_ID:     (id) => `/api/interview/${id}`,

  // Authentication
  LOGIN:    '/api/auth/login',
  SIGNUP:   '/api/auth/signup',
  VERIFY:   '/api/auth/verify',

  // User / Profile
  USER_PROFILE:  '/api/users/profile',
  USER_STATS:    '/api/users/stats',
  USER_SETTINGS: '/api/users/settings',

  // CV management
  USER_CVS:              '/api/users/cvs',
  USER_CV_DOWNLOAD: (id) => `/api/users/cvs/${id}/download`,
  USER_CV_DELETE:   (id) => `/api/users/cvs/${id}`,
};

export default API_BASE_URL;
