import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import ThemeToggle from './ThemeToggle';

const Navbar = ({ variant = 'landing', showAuth = true }) => {
  const navigate = useNavigate();
  const { user, logout, isAuthenticated } = useAuth();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  // Landing: sticky glassmorphism bar.
  // Dashboard: solid body-tertiary bar (adapts automatically in dark mode).
  const navClass =
    variant === 'landing'
      ? 'navbar navbar-expand-lg navbar-blur sticky-top'
      : 'navbar navbar-expand-lg bg-body-tertiary shadow-sm';

  return (
    <nav className={navClass}>
      <div className="container">
        <Link className="navbar-brand d-flex align-items-center" to="/">
          <div className="icon-circle bg-gradient-secondary me-2">
            <i className="bi bi-robot text-white fs-4"></i>
          </div>
          <span className="fw-bold text-gradient">AI Interview Simulator</span>
        </Link>

        <button
          className="navbar-toggler border-0"
          type="button"
          data-bs-toggle="collapse"
          data-bs-target="#navbarNav"
          aria-controls="navbarNav"
          aria-expanded="false"
          aria-label="Toggle navigation"
        >
          <span className="navbar-toggler-icon"></span>
        </button>

        <div className="collapse navbar-collapse" id="navbarNav">
          <ul className="navbar-nav ms-auto align-items-center gap-1">

            {/* ── ThemeToggle — always visible ── */}
            <li className="nav-item">
              <ThemeToggle />
            </li>

            {/* ── Landing nav items ── */}
            {variant === 'landing' && showAuth && (
              <>
                <li className="nav-item">
                  <Link className="nav-link nav-link-custom" to="/login">Login</Link>
                </li>
                <li className="nav-item ms-1">
                  <Link className="btn btn-gradient" to="/register">Get Started</Link>
                </li>
              </>
            )}

            {/* ── Dashboard nav items ── */}
            {variant === 'dashboard' && isAuthenticated && (
              <>
                {user && (
                  <li className="nav-item">
                    <span className="nav-link text-muted">
                      <i className="bi bi-person-circle me-1"></i>
                      {user.name || user.fullName}
                    </span>
                  </li>
                )}
                <li className="nav-item">
                  <Link className="nav-link nav-link-custom" to="/dashboard">
                    <i className="bi bi-house-door me-1"></i> Dashboard
                  </Link>
                </li>
                <li className="nav-item">
                  <Link className="nav-link nav-link-custom" to="/profile">
                    <i className="bi bi-person me-1"></i> Profile
                  </Link>
                </li>
                <li className="nav-item ms-1">
                  <button className="btn btn-outline-danger" onClick={handleLogout}>
                    <i className="bi bi-box-arrow-right me-1"></i> Logout
                  </button>
                </li>
              </>
            )}
          </ul>
        </div>
      </div>
    </nav>
  );
};

export default Navbar;
