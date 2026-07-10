import React from 'react';

const LoadingSpinner = ({ message = 'Processing...', fullScreen = false }) => {
  if (fullScreen) {
    return (
      <div
        className="loading-overlay position-fixed top-0 start-0 w-100 h-100 d-flex align-items-center justify-content-center"
        style={{ zIndex: 9999 }}
      >
        <div className="text-center">
          <div className="spinner-border text-primary mb-3" role="status" style={{ width: '3rem', height: '3rem' }}>
            <span className="visually-hidden">Loading...</span>
          </div>
          <h5 className="fw-bold text-primary">{message}</h5>
          <p className="text-muted">This may take a few moments...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="d-flex align-items-center justify-content-center py-4">
      <div className="spinner-border text-primary me-3" role="status">
        <span className="visually-hidden">Loading...</span>
      </div>
      <span className="text-muted">{message}</span>
    </div>
  );
};

export default LoadingSpinner;
