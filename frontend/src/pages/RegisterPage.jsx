import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const RegisterPage = () => {
  const navigate = useNavigate();
  const { register } = useAuth();
  
  const [formData, setFormData] = useState({
    fullName: '',
    email: '',
    password: '',
    confirmPassword: '',
    acceptTerms: false
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
    
    if (formData.password !== formData.confirmPassword) {
      setError('Passwords do not match!');
      return;
    }
    
    if (!formData.acceptTerms) {
      setError('Please accept the terms and conditions');
      return;
    }
    
    setIsLoading(true);

    try {
      const result = await register(formData.fullName, formData.email, formData.password);
      
      if (result.success) {
        navigate('/dashboard', { replace: true });
      } else {
        setError(result.error || 'Registration failed. Please try again.');
      }
    } catch (err) {
      setError('An unexpected error occurred. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="bg-gradient-page d-flex align-items-center" style={{ minHeight: '100vh', paddingTop: '2rem', paddingBottom: '2rem' }}>
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
                
                <h2 className="text-center fw-bold mb-2">Create Account</h2>
                <p className="text-center text-muted mb-4">Start your interview practice journey</p>

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
                    <label className="form-label fw-semibold">Full Name</label>
                    <div className="input-with-icon">
                      <span className="input-icon">
                        <i className="bi bi-person"></i>
                      </span>
                      <input
                        type="text"
                        className="form-control"
                        name="fullName"
                        placeholder="Enter your full name"
                        value={formData.fullName}
                        onChange={handleChange}
                        required
                        style={{ paddingLeft: '2.5rem' }}
                      />
                    </div>
                  </div>

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
                        placeholder="Create a password"
                        value={formData.password}
                        onChange={handleChange}
                        required
                        minLength="6"
                        style={{ paddingLeft: '2.5rem' }}
                      />
                    </div>
                  </div>

                  <div className="mb-3">
                    <label className="form-label fw-semibold">Confirm Password</label>
                    <div className="input-with-icon">
                      <span className="input-icon">
                        <i className="bi bi-lock"></i>
                      </span>
                      <input
                        type="password"
                        className="form-control"
                        name="confirmPassword"
                        placeholder="Confirm your password"
                        value={formData.confirmPassword}
                        onChange={handleChange}
                        required
                        style={{ paddingLeft: '2.5rem' }}
                      />
                    </div>
                  </div>

                  <div className="mb-4">
                    <div className="form-check">
                      <input
                        className="form-check-input"
                        type="checkbox"
                        name="acceptTerms"
                        id="acceptTerms"
                        checked={formData.acceptTerms}
                        onChange={handleChange}
                        required
                      />
                      <label className="form-check-label" htmlFor="acceptTerms">
                        I accept the <a href="#" className="text-decoration-none">Terms and Conditions</a>
                      </label>
                    </div>
                  </div>

                  <button type="submit" className="btn btn-gradient w-100 mb-3" disabled={isLoading}>
                    {isLoading ? (
                      <>
                        <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
                        Creating Account...
                      </>
                    ) : (
                      'Create Account'
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
                    Already have an account? <Link to="/login" className="text-decoration-none fw-semibold">Sign in</Link>
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

export default RegisterPage;
