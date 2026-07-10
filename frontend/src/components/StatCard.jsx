import React from 'react';

const StatCard = ({ icon, title, value, subtitle, trend, trendUp = true, color = 'primary' }) => {
  const colorClasses = {
    primary: 'text-primary bg-primary bg-opacity-10',
    success: 'text-success bg-success bg-opacity-10',
    warning: 'text-warning bg-warning bg-opacity-10',
    info: 'text-info bg-info bg-opacity-10',
    danger: 'text-danger bg-danger bg-opacity-10'
  };

  return (
    <div className="stat-card">
      <div className="d-flex justify-content-between align-items-start mb-3">
        <div className={`icon-circle ${colorClasses[color]}`}>
          <i className={`bi bi-${icon} fs-4`}></i>
        </div>
        {trend && (
          <span className={`badge ${trendUp ? 'bg-success' : 'bg-danger'} bg-opacity-10 ${trendUp ? 'text-success' : 'text-danger'}`}>
            <i className={`bi bi-arrow-${trendUp ? 'up' : 'down'} me-1`}></i>
            {trend}
          </span>
        )}
      </div>
      <h3 className="fw-bold mb-1">{value}</h3>
      <p className="text-muted mb-0">{title}</p>
      {subtitle && (
        <small className="text-muted">{subtitle}</small>
      )}
    </div>
  );
};

export default StatCard;
