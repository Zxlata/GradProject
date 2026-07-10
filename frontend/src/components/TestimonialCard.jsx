import React from 'react';

const TestimonialCard = ({ name, role, quote, rating = 5 }) => {
  return (
    <div className="testimonial-card">
      <div className="mb-3">
        {[...Array(rating)].map((_, i) => (
          <i key={i} className="bi bi-star-fill text-warning me-1"></i>
        ))}
      </div>
      <p className="mb-4 text-muted" style={{ fontSize: '1rem', lineHeight: '1.6' }}>
        "{quote}"
      </p>
      <div className="d-flex align-items-center">
        <div className="avatar-sm bg-gradient-secondary me-3">
          {name.split(' ').map(n => n[0]).join('')}
        </div>
        <div>
          <h6 className="fw-bold mb-0">{name}</h6>
          <small className="text-muted">{role}</small>
        </div>
      </div>
    </div>
  );
};

export default TestimonialCard;
