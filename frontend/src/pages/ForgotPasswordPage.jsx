import React, { useState } from 'react';
import { Link } from 'react-router-dom';

const ForgotPasswordPage = () => {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    // Handle password reset logic here
    console.log('Reset password for:', email);
    setSubmitted(true);
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
                
                <h2 className="text-center fw-bold mb-2">Reset Password</h2>
                <p className="text-center text-muted mb-4">
                  Enter your email address and we'll send you a link to reset your password
                </p>

                {!submitted ? (
                  <form onSubmit={handleSubmit}>
                    <div className="mb-4">
                      <label className="form-label fw-semibold">Email Address</label>
                      <div className="input-with-icon">
                        <span className="input-icon">
                          <i className="bi bi-envelope"></i>
                        </span>
                        <input
                          type="email"
                          className="form-control"
                          placeholder="Enter your email"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          required
                          style={{ paddingLeft: '2.5rem' }}
                        />
                      </div>
                    </div>

                    <button type="submit" className="btn btn-gradient w-100 mb-3">
                      Send Reset Link
                    </button>

                    <div className="text-center">
                      <Link to="/login" className="text-decoration-none d-flex align-items-center justify-content-center">
                        <i className="bi bi-arrow-left me-2"></i>
                        Back to Login
                      </Link>
                    </div>
                  </form>
                ) : (
                  <div className="text-center">
                    <div className="mb-4">
                      <div className="icon-circle-lg bg-success bg-opacity-10 text-success mx-auto">
                        <i className="bi bi-check-circle"></i>
                      </div>
                    </div>
                    <h5 className="fw-bold mb-3">Check Your Email</h5>
                    <p className="text-muted mb-4">
                      We've sent a password reset link to <strong>{email}</strong>
                    </p>
                    <Link to="/login" className="btn btn-gradient w-100">
                      Back to Login
                    </Link>
                  </div>
                )}
              </div>
            </div>

            <div className="card mt-3 border-0 bg-body-secondary">
              <div className="card-body text-center">
                <p className="mb-0 text-muted">
                  Remember your password? 
                  <Link to="/login" className="text-decoration-none fw-semibold ms-1">
                    Sign in here
                  </Link>
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ForgotPasswordPage;
