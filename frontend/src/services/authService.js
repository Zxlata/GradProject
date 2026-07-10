import { API_BASE_URL } from '../config/api';

/**
 * Authentication Service
 * Handles all authentication-related API calls
 */
class AuthService {
  /**
   * Get authentication token from localStorage
   */
  getToken() {
    return localStorage.getItem('token');
  }

  /**
   * Get authorization headers with token
   */
  getAuthHeaders() {
    const token = this.getToken();
    return {
      'Content-Type': 'application/json',
      'Authorization': token ? `Bearer ${token}` : ''
    };
  }

  /**
   * Get authorization headers for multipart/form-data
   */
  getAuthHeadersMultipart() {
    const token = this.getToken();
    return {
      'Authorization': token ? `Bearer ${token}` : ''
    };
  }

  /**
   * Login user
   */
  async login(email, password) {
    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ email, password })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || data.detail || 'Login failed');
      }

      // Backend returns { token, user: { id, name, email } }
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));

      return {
        success: true,
        data: data
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Register new user
   */
  async register(fullName, email, password) {
    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/signup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ name: fullName, email, password })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || data.detail || 'Registration failed');
      }

      // Backend returns { token, user: { id, name, email } }
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));

      return {
        success: true,
        data: data
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Logout user
   */
  logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
  }

  /**
   * Check if user is authenticated
   */
  isAuthenticated() {
    const token = this.getToken();
    return !!token;
  }

  /**
   * Get current user from localStorage
   */
  getCurrentUser() {
    const userStr = localStorage.getItem('user');
    if (userStr) {
      try {
        return JSON.parse(userStr);
      } catch {
        return null;
      }
    }
    return null;
  }

  /**
   * Verify token is still valid
   */
  async verifyToken() {
    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/verify`, {
        headers: this.getAuthHeaders()
      });

      if (!response.ok) {
        this.logout();
        return false;
      }

      return true;
    } catch (error) {
      this.logout();
      return false;
    }
  }
}

const authService = new AuthService();
export default authService;
