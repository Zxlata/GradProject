import React from "react";
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import "./styles.css";
import "bootstrap-icons/font/bootstrap-icons.css";

// Context
import { AuthProvider } from "./context/AuthContext";
import { ThemeProvider } from "./context/ThemeContext";

// Components
import ProtectedRoute from "./components/ProtectedRoute";
import InstallApp     from "./components/InstallApp";

// Pages
import LandingPage from "./pages/LandingPage";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";
import ForgotPasswordPage from "./pages/ForgotPasswordPage";
import DashboardPage from "./pages/DashboardPage";
import UploadPage from "./pages/UploadPage";
import InterviewPage from "./pages/InterviewPage";
import FeedbackPage from "./pages/FeedbackPage";
import ProfilePage from "./pages/ProfilePage";

function App() {
  return (
    <ThemeProvider>
    <AuthProvider>
      <Router>
        <Routes>
          {/* Public Routes */}
          <Route path="/" element={<LandingPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />

          {/* Protected Routes - Require Authentication */}
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <DashboardPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/upload"
            element={
              <ProtectedRoute>
                <UploadPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/interview"
            element={
              <ProtectedRoute>
                <InterviewPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/feedback/:id"
            element={
              <ProtectedRoute>
                <FeedbackPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/profile"
            element={
              <ProtectedRoute>
                <ProfilePage />
              </ProtectedRoute>
            }
          />
        </Routes>
      </Router>

      {/* PWA install prompt — rendered outside Router so it persists across routes */}
      <InstallApp delay={4000} />
    </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
