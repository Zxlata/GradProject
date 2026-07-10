import React from 'react';

const FeatureCard = ({ icon, title, description, gradient = 'primary' }) => {
  const gradients = {
    primary: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
    purple: 'linear-gradient(135deg, #8b5cf6 0%, #ec4899 100%)',
    cyan: 'linear-gradient(135deg, #06b6d4 0%, #3b82f6 100%)',
    green: 'linear-gradient(135deg, #10b981 0%, #14b8a6 100%)'
  };

  return (
    <div className="feature-card">
      <div 
        className="icon-circle-lg mx-auto mb-4" 
        style={{ background: gradients[gradient] }}
      >
        <i className={`bi bi-${icon} text-white`}></i>
      </div>
      <h5 className="fw-bold mb-3">{title}</h5>
      <p className="text-muted mb-0">{description}</p>
    </div>
  );
};

export default FeatureCard;
