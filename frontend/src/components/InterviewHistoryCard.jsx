import React from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * Displays a single interview from the database.
 *
 * API shape (MongoDB document):
 *   _id, title, interviewType, createdAt, status,
 *   performance.timeSpent (seconds),
 *   aiAnalysis.matchScore (0-100)
 */
const InterviewHistoryCard = ({ interview }) => {
  const navigate = useNavigate();

  // --- normalise field names from the real API response ---
  const id          = interview._id  || interview.id;
  const title       = interview.title || 'Interview';
  const type        = interview.interviewType || interview.type || 'general';
  const score       = interview.aiAnalysis?.matchScore
                      ?? interview.score
                      ?? 0;
  const timeSpentSec = interview.performance?.timeSpent ?? 0;
  const duration    = timeSpentSec > 0
    ? `${Math.floor(timeSpentSec / 60)}m`
    : null;
  const dateStr     = interview.createdAt || interview.date;
  const displayDate = dateStr
    ? new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : '—';

  // --- type helpers ---
  const typeLabels = { hr: 'HR', technical: 'Technical', behavioral: 'Behavioral', general: 'General' };
  const typeLabel  = typeLabels[type] || type;

  const typeIcons  = { hr: 'person', technical: 'code-slash', behavioral: 'chat-dots', general: 'briefcase' };
  const typeIcon   = typeIcons[type] || 'briefcase';

  const getScoreColor = (s) => {
    if (s >= 85) return 'success';
    if (s >= 70) return 'primary';
    if (s >= 50) return 'warning';
    return 'danger';
  };

  const scoreColor = getScoreColor(score);

  return (
    <div className="card card-hover mb-3">
      <div className="card-body">
        <div className="d-flex align-items-center justify-content-between">
          <div className="d-flex align-items-center flex-grow-1">
            <div className={`icon-circle bg-${scoreColor} bg-opacity-10 text-${scoreColor} me-3`}>
              <i className={`bi bi-${typeIcon} fs-5`}></i>
            </div>
            <div className="flex-grow-1">
              <h6 className="mb-1 fw-bold">{title}</h6>
              <div className="d-flex flex-wrap gap-3 text-muted small">
                <span>
                  <i className="bi bi-bookmark me-1"></i>
                  {typeLabel}
                </span>
                <span>
                  <i className="bi bi-calendar me-1"></i>
                  {displayDate}
                </span>
                {duration && (
                  <span>
                    <i className="bi bi-clock me-1"></i>
                    {duration}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="d-flex align-items-center gap-3">
            <div className="text-end">
              <div className={`badge bg-${scoreColor} fs-6 px-3 py-2`}>
                {score}%
              </div>
            </div>
            <button
              className="btn btn-outline-primary btn-sm"
              onClick={() => navigate(`/feedback/${id}`)}
            >
              View Details
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default InterviewHistoryCard;
