import React, { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const LoginPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { login } = useAuth();
  
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    remember: false
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
    // Clear error when user types
    if (error) setError(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      const result = await login(formData.email, formData.password);
      
      if (result.success) {
        // Redirect to the page they tried to visit or dashboard
        const from = location.state?.from?.pathname || '/dashboard';
        navigate(from, { replace: true });
      } else {
        setError(result.error || 'Login failed. Please check your credentials.');
      }
    } catch (err) {
      setError('An unexpected error occurred. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="bg-gradient-page d-flex align-items-center" style={{ minHeight: '100vh' }}>
      <div className="container">
        <div className="row justify-content-center">
          <div className="col-12 col-md-8 col-lg-5">
            <div className="card shadow-lg border-0">
              <div className="card-body p-4 p-md-5">
                <Link to="/" className="text-decoration-none">
                  <div className="d-flex align-items-center justify-content-center mb-4">
                    <div className="icon-circle bg-gradient-secondary me-2">
                      <i className="bi bi-brain text-white fs-4"></i>
                    </div>
                    <span className="fw-bold text-gradient fs-5">AI Interview</span>
                  </div>
                </Link>
                
                <h2 className="text-center fw-bold mb-2">Welcome Back!</h2>
                <p className="text-center text-muted mb-4">Sign in to continue your practice</p>

                {error && (
                  <div className="alert alert-danger alert-dismissible fade show" role="alert">
                    <i className="bi bi-exclamation-triangle-fill me-2"></i>
                    {error}
                    <button 
                      type="button" 
                      className="btn-close" 
                      onClick={() => setError(null)}
                      aria-label="Close"
                    ></button>
                  </div>
                )}

                <form onSubmit={handleSubmit}>
                  <div className="mb-3">
                    <label className="form-label fw-semibold">Email Address</label>
                    <div className="input-with-icon">
                      <span className="input-icon">
                        <i className="bi bi-envelope"></i>
                      </span>
                      <input
                        type="email"
                        className="form-control"
                        name="email"
                        placeholder="Enter your email"
                        value={formData.email}
                        onChange={handleChange}
                        required
                        style={{ paddingLeft: '2.5rem' }}
                      />
                    </div>
                  </div>

                  <div className="mb-3">
                    <label className="form-label fw-semibold">Password</label>
                    <div className="input-with-icon">
                      <span className="input-icon">
                        <i className="bi bi-lock"></i>
                      </span>
                      <input
                        type="password"
                        className="form-control"
                        name="password"
                        placeholder="Enter your password"
                        value={formData.password}
                        onChange={handleChange}
                        required
                        style={{ paddingLeft: '2.5rem' }}
                      />
                    </div>
                  </div>

                  <div className="d-flex justify-content-between align-items-center mb-4">
                    <div className="form-check">
                      <input
                        className="form-check-input"
                        type="checkbox"
                        name="remember"
                        id="rememberMe"
                        checked={formData.remember}
                        onChange={handleChange}
                      />
                      <label className="form-check-label" htmlFor="rememberMe">
                        Remember me
                      </label>
                    </div>
                    <Link to="/forgot-password" className="text-decoration-none">
                      Forgot password?
                    </Link>
                  </div>

                  <button type="submit" className="btn btn-gradient w-100 mb-3" disabled={isLoading}>
                    {isLoading ? (
                      <>
                        <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
                        Signing In...
                      </>
                    ) : (
                      'Sign In'
                    )}
                  </button>

                  <div className="text-center mb-3">
                    <div className="d-flex align-items-center">
                      <hr className="flex-grow-1" />
                      <span className="px-3 text-muted small">Or continue with</span>
                      <hr className="flex-grow-1" />
                    </div>
                  </div>

                  <div className="row g-2 mb-4">
                    <div className="col-6">
                      <button type="button" className="btn btn-social w-100">
                        <i className="bi bi-google me-2"></i> Google
                      </button>
                    </div>
                    <div className="col-6">
                      <button type="button" className="btn btn-social w-100">
                        <i className="bi bi-github me-2"></i> GitHub
                      </button>
                    </div>
                  </div>

                  <p className="text-center text-muted mb-0">
                    Don't have an account? <Link to="/register" className="text-decoration-none fw-semibold">Sign up</Link>
                  </p>
                </form>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
