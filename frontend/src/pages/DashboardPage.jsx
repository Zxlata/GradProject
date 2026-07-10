import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
} from 'chart.js';
import Navbar from '../components/Navbar';
import StatCard from '../components/StatCard';
import InterviewHistoryCard from '../components/InterviewHistoryCard';
import GradientButton from '../components/GradientButton';
import LoadingSpinner from '../components/LoadingSpinner';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import apiService from '../services/apiService';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler);

const tips = [
  'Practice answering common interview questions regularly',
  'Research the company before your interview',
  'Prepare examples from your past experience'
];

/** Build Chart.js line options that match the active theme. */
function buildChartOptions(isDark) {
  const gridColor  = isDark ? 'rgba(255,255,255,0.06)' : '#f3f4f6';
  const tickColor  = isDark ? '#94a3b8' : '#6b7280';
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: isDark ? '#1e293b' : '#1f2937',
        padding: 12,
        titleColor: '#fff',
        bodyColor: '#e2e8f0',
        borderColor: '#6366f1',
        borderWidth: 1,
        displayColors: false,
        callbacks: { label: (ctx) => 'Score: ' + ctx.parsed.y + '%' },
      },
    },
    scales: {
      y: {
        beginAtZero: true,
        max: 100,
        ticks: { callback: (v) => v + '%', color: tickColor },
        grid: { color: gridColor },
      },
      x: {
        ticks: { color: tickColor },
        grid: { display: false },
      },
    },
  };
}

const DashboardPage = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isDark } = useTheme();
  const chartOptions = buildChartOptions(isDark);

  const [stats, setStats]               = useState(null);
  const [recentInterviews, setRecent]   = useState([]);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState(null);

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        const [statsRes, interviewsRes] = await Promise.all([
          apiService.getUserStats(),
          apiService.getUserInterviews(),
        ]);
        if (statsRes.success)      setStats(statsRes.data);
        if (interviewsRes.success) setRecent(interviewsRes.data.slice(0, 3));
      } catch (err) {
        console.error('Dashboard load error:', err);
        setError('Failed to load dashboard data');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  // Build stat cards from real data
  const statsArray = stats ? [
    {
      icon: 'clipboard-check',
      title: 'Total Interviews',
      value: String(stats.totalInterviews || 0),
      subtitle: 'completed',
      color: 'primary'
    },
    {
      icon: 'graph-up',
      title: 'Average Score',
      value: `${stats.averageScore || 0}%`,
      subtitle: 'across all sessions',
      color: 'success'
    },
    {
      icon: 'clock',
      title: 'Practice Time',
      value: stats.practiceTime || '0m',
      subtitle: 'total time',
      color: 'info'
    },
    {
      icon: 'trophy',
      title: 'Best Score',
      value: `${stats.bestScore || 0}%`,
      subtitle: 'personal best',
      color: 'warning'
    }
  ] : [];

  // Build chart from real interview data
  const chartPoints = (stats?.chartData || []);
  const hasChartData = chartPoints.length > 0;

  const chartData = {
    labels: hasChartData
      ? chartPoints.map(p => new Date(p.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }))
      : ['No data yet'],
    datasets: [{
      label: 'Score',
      data: hasChartData ? chartPoints.map(p => p.score) : [0],
      borderColor: '#6366f1',
      backgroundColor: 'rgba(99, 102, 241, 0.1)',
      tension: 0.4,
      fill: true,
      pointRadius: 6,
      pointHoverRadius: 8,
      pointBackgroundColor: '#6366f1',
      pointBorderColor: '#fff',
      pointBorderWidth: 2,
    }]
  };

  if (loading) {
    return (
      <div className="bg-body min-vh-100">
        <Navbar variant="dashboard" />
        <LoadingSpinner message="Loading dashboard..." fullScreen={false} />
      </div>
    );
  }

  return (
    <div className="bg-body min-vh-100">
      <Navbar variant="dashboard" />

      <div className="container py-4">
        {/* Welcome */}
        <div className="mb-4">
          <h2 className="fw-bold mb-1">Welcome back, {user?.name || 'User'}! 👋</h2>
          <p className="text-muted">Here's what's happening with your interview practice</p>
        </div>

        {error && (
          <div className="alert alert-warning alert-dismissible fade show" role="alert">
            <i className="bi bi-exclamation-triangle me-2"></i>
            {error}
            <button type="button" className="btn-close" onClick={() => setError(null)}></button>
          </div>
        )}

        {/* Stats Cards */}
        <div className="row g-3 mb-4">
          {statsArray.map((stat, i) => (
            <div key={i} className="col-12 col-sm-6 col-lg-3">
              <StatCard {...stat} />
            </div>
          ))}
        </div>

        {/* CTA + Tips */}
        <div className="row g-4 mb-4">
          <div className="col-12 col-lg-8">
            <div className="card border-0 bg-gradient-secondary text-white h-100">
              <div className="card-body p-4">
                <h4 className="fw-bold mb-3">Ready for Your Next Interview?</h4>
                <p className="mb-4 opacity-90">
                  Continue improving your skills with AI-powered interview practice sessions tailored to your goals.
                </p>
                <div className="d-flex gap-2 flex-wrap">
                  <GradientButton
                    variant="white"
                    className="text-primary fw-bold"
                    onClick={() => navigate('/upload')}
                  >
                    <i className="bi bi-play-circle me-2"></i>
                    Start New Interview
                  </GradientButton>
                  <button className="btn btn-outline-light" onClick={() => navigate('/upload')}>
                    <i className="bi bi-lightning me-2"></i>
                    Quick Practice
                  </button>
                </div>
              </div>
            </div>
          </div>
          <div className="col-12 col-lg-4">
            <div className="card border-0 shadow-sm h-100">
              <div className="card-body">
                <h5 className="fw-bold mb-3">
                  <i className="bi bi-lightbulb text-warning me-2"></i>
                  Today's Tips
                </h5>
                {tips.map((tip, i) => (
                  <div key={i} className="d-flex mb-3">
                    <i className="bi bi-check-circle-fill text-success me-2 mt-1"></i>
                    <small className="text-muted">{tip}</small>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Performance Chart */}
        <div className="row g-4 mb-4">
          <div className="col-12">
            <div className="card border-0 shadow-sm">
              <div className="card-body">
                <div className="d-flex justify-content-between align-items-center mb-4">
                  <h5 className="fw-bold mb-0">Performance Overview</h5>
                  {!hasChartData && (
                    <span className="badge bg-secondary bg-opacity-10 text-secondary">
                      Complete an interview to see your progress
                    </span>
                  )}
                </div>
                <div style={{ height: '300px' }}>
                  {hasChartData ? (
                    <Line data={chartData} options={chartOptions} />
                  ) : (
                    <div className="d-flex flex-column align-items-center justify-content-center h-100 text-muted">
                      <i className="bi bi-bar-chart fs-1 mb-3 opacity-25"></i>
                      <p className="mb-0">No interview data yet</p>
                      <small>Your score progression will appear here after your first interview</small>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Recent Interviews */}
        <div className="row g-4">
          <div className="col-12">
            <div className="card border-0 shadow-sm">
              <div className="card-body">
                <div className="d-flex justify-content-between align-items-center mb-4">
                  <h5 className="fw-bold mb-0">Recent Interviews</h5>
                  <button
                    className="btn btn-sm btn-outline-primary"
                    onClick={() => navigate('/profile')}
                  >
                    View All
                  </button>
                </div>

                {recentInterviews.length === 0 ? (
                  <div className="text-center text-muted py-4">
                    <i className="bi bi-clipboard fs-1 mb-3 opacity-25 d-block"></i>
                    <p className="mb-0">No interviews yet</p>
                    <small>Start your first interview to see history here</small>
                  </div>
                ) : (
                  recentInterviews.map((interview) => (
                    <InterviewHistoryCard key={interview._id} interview={interview} />
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DashboardPage;
