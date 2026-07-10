import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import Navbar from '../components/Navbar';
import InterviewHistoryCard from '../components/InterviewHistoryCard';
import LoadingSpinner from '../components/LoadingSpinner';
import { useAuth } from '../context/AuthContext';
import apiService from '../services/apiService';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
const ProfilePage = () => {
  const navigate   = useNavigate();
  const { user, logout } = useAuth();
  const cvInputRef = useRef(null);

  const [activeTab, setActiveTab]   = useState('profile');
  const [loading, setLoading]       = useState(true);
  const [saving, setSaving]         = useState(false);
  const [saveMsg, setSaveMsg]       = useState(null); // { type: 'success'|'danger', text }

  // Profile form
  const [profileData, setProfileData] = useState({
    name: '', email: '', phone: '', bio: '', avatar: ''
  });

  // Stats & interviews
  const [stats, setStats]               = useState({ totalInterviews: 0, averageScore: 0, practiceTime: '0m' });
  const [allInterviews, setInterviews]  = useState([]);

  // CV files
  const [cvFiles, setCVFiles]           = useState([]);
  const [cvUploading, setCVUploading]   = useState(false);

  // Settings
  const [settings, setSettings]         = useState({
    emailNotifications: true, weeklyReports: true, interviewReminders: false
  });
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsMsg, setSettingsMsg]       = useState(null);

  // Password
  const [passwordData, setPasswordData] = useState({
    currentPassword: '', newPassword: '', confirmPassword: ''
  });

  // -------------------------------------------------------------------------
  // Load data
  // -------------------------------------------------------------------------
  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        const [profileRes, interviewsRes, statsRes, cvsRes, settingsRes] = await Promise.all([
          apiService.getUserProfile(),
          apiService.getUserInterviews(),
          apiService.getUserStats(),
          apiService.getUserCVs(),
          apiService.getSettings(),
        ]);

        if (profileRes.success) {
          const d = profileRes.data;
          setProfileData({ name: d.name || '', email: d.email || '', phone: d.phone || '', bio: d.bio || '', avatar: d.avatar || '' });
        }
        if (interviewsRes.success) setInterviews(interviewsRes.data || []);
        if (statsRes.success) setStats(statsRes.data);
        if (cvsRes.success)   setCVFiles(cvsRes.data?.cvFiles || []);
        if (settingsRes.success) setSettings(settingsRes.data);
      } catch (err) {
        console.error('ProfilePage load error:', err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  // -------------------------------------------------------------------------
  // Profile save
  // -------------------------------------------------------------------------
  const handleProfileSubmit = async (e) => {
    e.preventDefault();
    try {
      setSaving(true);
      setSaveMsg(null);
      const result = await apiService.updateUserProfile({
        name:   profileData.name,
        phone:  profileData.phone,
        bio:    profileData.bio,
        avatar: profileData.avatar,
      });
      if (result.success) {
        setSaveMsg({ type: 'success', text: 'Profile updated successfully!' });
      } else {
        setSaveMsg({ type: 'danger', text: result.error || 'Failed to update profile' });
      }
    } catch (err) {
      setSaveMsg({ type: 'danger', text: 'Failed to update profile' });
    } finally {
      setSaving(false);
      setTimeout(() => setSaveMsg(null), 4000);
    }
  };

  // -------------------------------------------------------------------------
  // Avatar (base64)
  // -------------------------------------------------------------------------
  const handleAvatarChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setProfileData(d => ({ ...d, avatar: ev.target.result }));
    reader.readAsDataURL(file);
  };

  // -------------------------------------------------------------------------
  // CV management
  // -------------------------------------------------------------------------
  const handleCVUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      setCVUploading(true);
      const res = await apiService.uploadCV(file);
      if (res.success) {
        setCVFiles(prev => [...prev, res.data.cvFile]);
      } else {
        alert('Failed to upload CV: ' + res.error);
      }
    } catch (err) {
      alert('Failed to upload CV');
    } finally {
      setCVUploading(false);
      if (cvInputRef.current) cvInputRef.current.value = '';
    }
  };

  const handleCVDelete = async (fileId) => {
    if (!window.confirm('Delete this CV?')) return;
    const res = await apiService.deleteCV(fileId);
    if (res.success) {
      setCVFiles(prev => prev.filter(f => f._id !== fileId));
    } else {
      alert('Failed to delete: ' + res.error);
    }
  };

  const handleCVDownload = (fileId) => {
    const url = apiService.getCVDownloadUrl(fileId);
    window.open(url, '_blank');
  };

  // -------------------------------------------------------------------------
  // Settings save
  // -------------------------------------------------------------------------
  const handleSettingsSave = async () => {
    try {
      setSettingsSaving(true);
      setSettingsMsg(null);
      const res = await apiService.updateSettings(settings);
      if (res.success) {
        setSettings(res.data);
        setSettingsMsg({ type: 'success', text: 'Settings saved successfully!' });
      } else {
        setSettingsMsg({ type: 'danger', text: res.error || 'Failed to save settings' });
      }
    } catch (err) {
      setSettingsMsg({ type: 'danger', text: 'Failed to save settings' });
    } finally {
      setSettingsSaving(false);
      setTimeout(() => setSettingsMsg(null), 4000);
    }
  };

  // -------------------------------------------------------------------------
  // Password change (wired to auth-service if it ever exposes the route;
  // for now shows a clear message that it's not yet supported)
  // -------------------------------------------------------------------------
  const handlePasswordSubmit = async (e) => {
    e.preventDefault();
    if (passwordData.newPassword !== passwordData.confirmPassword) {
      alert('Passwords do not match!');
      return;
    }
    alert('Password change is not yet implemented in the backend.');
    setPasswordData({ currentPassword: '', newPassword: '', confirmPassword: '' });
  };

  const handleLogout = () => { logout(); navigate('/login'); };

  // -------------------------------------------------------------------------
  // Initials avatar
  // -------------------------------------------------------------------------
  const initials = (profileData.name || user?.name || 'U')
    .split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  if (loading) {
    return (
      <div className="bg-body min-vh-100">
        <Navbar variant="dashboard" />
        <LoadingSpinner message="Loading profile..." fullScreen={false} />
      </div>
    );
  }

  return (
    <div className="bg-body min-vh-100">
      <Navbar variant="dashboard" />

      <div className="container py-4">
        {/* Header */}
        <div className="mb-4">
          <button className="btn btn-outline-secondary mb-3" onClick={() => navigate('/dashboard')}>
            <i className="bi bi-arrow-left me-2"></i>Back to Dashboard
          </button>
          <h2 className="fw-bold mb-1">My Profile</h2>
          <p className="text-muted">Manage your account settings and preferences</p>
        </div>

        {/* Tab card */}
        <div className="card border-0 shadow-sm">
          <div className="card-header bg-body">
            <ul className="nav nav-tabs card-header-tabs">
              {['profile', 'history', 'settings'].map(tab => (
                <li key={tab} className="nav-item">
                  <button
                    className={`nav-link ${activeTab === tab ? 'active' : ''}`}
                    onClick={() => setActiveTab(tab)}
                  >
                    <i className={`bi bi-${tab === 'profile' ? 'person' : tab === 'history' ? 'clock-history' : 'gear'} me-2`}></i>
                    {tab.charAt(0).toUpperCase() + tab.slice(1)}
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div className="card-body p-4">

            {/* ================================================================
                PROFILE TAB
            ================================================================ */}
            {activeTab === 'profile' && (
              <div>
                {saveMsg && (
                  <div className={`alert alert-${saveMsg.type} alert-dismissible fade show`} role="alert">
                    {saveMsg.text}
                    <button type="button" className="btn-close" onClick={() => setSaveMsg(null)}></button>
                  </div>
                )}

                <div className="row g-4">
                  {/* Avatar card */}
                  <div className="col-12 col-md-4">
                    <div className="card border-0 bg-body-secondary">
                      <div className="card-body text-center">
                        {profileData.avatar ? (
                          <img
                            src={profileData.avatar}
                            alt="avatar"
                            className="rounded-circle mb-3"
                            style={{ width: 80, height: 80, objectFit: 'cover' }}
                          />
                        ) : (
                          <div className="avatar mx-auto mb-3">{initials}</div>
                        )}
                        <h5 className="fw-bold mb-1">{profileData.name}</h5>
                        <p className="text-muted small mb-3">{profileData.email}</p>
                        <label className="btn btn-outline-primary btn-sm" style={{ cursor: 'pointer' }}>
                          <i className="bi bi-camera me-2"></i>Change Photo
                          <input type="file" accept="image/*" className="d-none" onChange={handleAvatarChange} />
                        </label>
                      </div>
                    </div>
                  </div>

                  {/* Personal info form */}
                  <div className="col-12 col-md-8">
                    <div className="card border-0 bg-body-secondary">
                      <div className="card-body">
                        <h5 className="fw-bold mb-4">Personal Information</h5>
                        <form onSubmit={handleProfileSubmit}>
                          <div className="row g-3">
                            <div className="col-12">
                              <label className="form-label fw-semibold">Full Name</label>
                              <input
                                type="text" className="form-control"
                                value={profileData.name}
                                onChange={e => setProfileData(d => ({ ...d, name: e.target.value }))}
                                required
                              />
                            </div>
                            <div className="col-12">
                              <label className="form-label fw-semibold">Email Address</label>
                              <input
                                type="email" className="form-control"
                                value={profileData.email}
                                readOnly
                                style={{ background: 'var(--color-upload-bg)', cursor: 'not-allowed' }}
                                title="Email cannot be changed here"
                              />
                              <div className="form-text">Contact support to change your email.</div>
                            </div>
                            <div className="col-12">
                              <label className="form-label fw-semibold">Phone Number</label>
                              <input
                                type="tel" className="form-control"
                                value={profileData.phone}
                                onChange={e => setProfileData(d => ({ ...d, phone: e.target.value }))}
                              />
                            </div>
                            <div className="col-12">
                              <label className="form-label fw-semibold">Bio</label>
                              <textarea
                                className="form-control" rows="3"
                                value={profileData.bio}
                                onChange={e => setProfileData(d => ({ ...d, bio: e.target.value }))}
                              />
                            </div>
                            <div className="col-12">
                              <button type="submit" className="btn btn-gradient" disabled={saving}>
                                {saving
                                  ? <><span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>Saving…</>
                                  : <><i className="bi bi-check-circle me-2"></i>Save Changes</>
                                }
                              </button>
                            </div>
                          </div>
                        </form>
                      </div>
                    </div>
                  </div>
                </div>

                {/* CV Management */}
                <div className="card border-0 bg-body-secondary mt-4">
                  <div className="card-body">
                    <h5 className="fw-bold mb-3">Uploaded CVs</h5>

                    {cvFiles.length === 0 ? (
                      <p className="text-muted small mb-3">No CVs uploaded yet.</p>
                    ) : (
                      cvFiles.map(cv => (
                        <div
                          key={cv._id}
                          className="d-flex align-items-center justify-content-between p-3 bg-body rounded mb-2"
                        >
                          <div className="d-flex align-items-center">
                            <div className="icon-circle bg-primary bg-opacity-10 text-primary me-3">
                              <i className="bi bi-file-earmark-pdf fs-5"></i>
                            </div>
                            <div>
                              <h6 className="fw-bold mb-0">{cv.originalName}</h6>
                              <small className="text-muted">
                                {new Date(cv.uploadDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                                {' · '}{formatBytes(cv.size)}
                              </small>
                            </div>
                          </div>
                          <div className="d-flex gap-2">
                            <button
                              className="btn btn-sm btn-outline-primary"
                              title="Download"
                              onClick={() => handleCVDownload(cv._id)}
                            >
                              <i className="bi bi-download"></i>
                            </button>
                            <button
                              className="btn btn-sm btn-outline-danger"
                              title="Delete"
                              onClick={() => handleCVDelete(cv._id)}
                            >
                              <i className="bi bi-trash"></i>
                            </button>
                          </div>
                        </div>
                      ))
                    )}

                    <label className={`btn btn-outline-primary mt-2 ${cvUploading ? 'disabled' : ''}`} style={{ cursor: 'pointer' }}>
                      {cvUploading
                        ? <><span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>Uploading…</>
                        : <><i className="bi bi-cloud-upload me-2"></i>Upload New CV</>
                      }
                      <input
                        ref={cvInputRef}
                        type="file"
                        accept=".pdf,.doc,.docx"
                        className="d-none"
                        onChange={handleCVUpload}
                        disabled={cvUploading}
                      />
                    </label>
                  </div>
                </div>
              </div>
            )}

            {/* ================================================================
                HISTORY TAB
            ================================================================ */}
            {activeTab === 'history' && (
              <div>
                <div className="d-flex justify-content-between align-items-center mb-4">
                  <h5 className="fw-bold mb-0">Interview History</h5>
                </div>

                {allInterviews.length === 0 ? (
                  <div className="text-center text-muted py-5">
                    <i className="bi bi-clipboard fs-1 mb-3 opacity-25 d-block"></i>
                    <p className="mb-1">No interviews yet</p>
                    <small>Complete your first interview to see it here</small>
                    <div className="mt-3">
                      <button className="btn btn-gradient" onClick={() => navigate('/upload')}>
                        <i className="bi bi-play-circle me-2"></i>Start Interview
                      </button>
                    </div>
                  </div>
                ) : (
                  allInterviews.map(interview => (
                    <InterviewHistoryCard key={interview._id} interview={interview} />
                  ))
                )}

                {/* Summary stats */}
                <div className="row g-3 mt-4">
                  <div className="col-12 col-md-4">
                    <div className="card border-0 bg-primary bg-opacity-10">
                      <div className="card-body text-center">
                        <h3 className="fw-bold text-primary mb-1">{stats.totalInterviews || 0}</h3>
                        <p className="text-muted mb-0">Total Interviews</p>
                      </div>
                    </div>
                  </div>
                  <div className="col-12 col-md-4">
                    <div className="card border-0 bg-success bg-opacity-10">
                      <div className="card-body text-center">
                        <h3 className="fw-bold text-success mb-1">{stats.averageScore || 0}%</h3>
                        <p className="text-muted mb-0">Average Score</p>
                      </div>
                    </div>
                  </div>
                  <div className="col-12 col-md-4">
                    <div className="card border-0 bg-info bg-opacity-10">
                      <div className="card-body text-center">
                        <h3 className="fw-bold text-info mb-1">{stats.practiceTime || '0m'}</h3>
                        <p className="text-muted mb-0">Practice Time</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ================================================================
                SETTINGS TAB
            ================================================================ */}
            {activeTab === 'settings' && (
              <div>
                {/* Notification Settings */}
                <div className="card border-0 bg-body-secondary mb-4">
                  <div className="card-body">
                    <h5 className="fw-bold mb-4">Notification Settings</h5>

                    {settingsMsg && (
                      <div className={`alert alert-${settingsMsg.type} alert-dismissible fade show`} role="alert">
                        {settingsMsg.text}
                        <button type="button" className="btn-close" onClick={() => setSettingsMsg(null)}></button>
                      </div>
                    )}

                    {[
                      { key: 'emailNotifications', label: 'Email Notifications',  desc: 'Receive email updates about your interviews' },
                      { key: 'weeklyReports',      label: 'Weekly Reports',        desc: 'Get weekly performance summaries' },
                      { key: 'interviewReminders', label: 'Interview Reminders',   desc: 'Remind me to practice regularly' },
                    ].map(({ key, label, desc }) => (
                      <div key={key} className="mb-3">
                        <div className="form-check form-switch">
                          <input
                            className="form-check-input"
                            type="checkbox"
                            id={key}
                            checked={settings[key] ?? false}
                            onChange={e => setSettings(s => ({ ...s, [key]: e.target.checked }))}
                          />
                          <label className="form-check-label" htmlFor={key}>
                            <strong>{label}</strong>
                            <div className="text-muted small">{desc}</div>
                          </label>
                        </div>
                      </div>
                    ))}

                    <button
                      className="btn btn-gradient mt-2"
                      onClick={handleSettingsSave}
                      disabled={settingsSaving}
                    >
                      {settingsSaving
                        ? <><span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>Saving…</>
                        : <><i className="bi bi-check-circle me-2"></i>Save Settings</>
                      }
                    </button>
                  </div>
                </div>

                {/* Security */}
                <div className="card border-0 bg-body-secondary mb-4">
                  <div className="card-body">
                    <h5 className="fw-bold mb-4">Security</h5>
                    <form onSubmit={handlePasswordSubmit}>
                      <div className="mb-3">
                        <label className="form-label fw-semibold">Current Password</label>
                        <input
                          type="password" className="form-control"
                          value={passwordData.currentPassword}
                          onChange={e => setPasswordData(d => ({ ...d, currentPassword: e.target.value }))}
                          required
                        />
                      </div>
                      <div className="mb-3">
                        <label className="form-label fw-semibold">New Password</label>
                        <input
                          type="password" className="form-control" minLength="6"
                          value={passwordData.newPassword}
                          onChange={e => setPasswordData(d => ({ ...d, newPassword: e.target.value }))}
                          required
                        />
                      </div>
                      <div className="mb-3">
                        <label className="form-label fw-semibold">Confirm New Password</label>
                        <input
                          type="password" className="form-control"
                          value={passwordData.confirmPassword}
                          onChange={e => setPasswordData(d => ({ ...d, confirmPassword: e.target.value }))}
                          required
                        />
                      </div>
                      <button type="submit" className="btn btn-gradient">
                        <i className="bi bi-shield-check me-2"></i>Update Password
                      </button>
                    </form>
                  </div>
                </div>

                {/* Danger zone */}
                <div className="card border-0" style={{ border: '2px solid #dc3545' }}>
                  <div className="card-body">
                    <h5 className="fw-bold mb-3 text-danger">
                      <i className="bi bi-exclamation-triangle me-2"></i>Danger Zone
                    </h5>
                    <p className="text-muted mb-3">These actions are irreversible. Please proceed with caution.</p>
                    <div className="d-flex gap-2 flex-wrap">
                      <button className="btn btn-outline-danger">
                        <i className="bi bi-trash me-2"></i>Delete All Interview History
                      </button>
                      <button className="btn btn-danger">
                        <i className="bi bi-x-circle me-2"></i>Delete Account
                      </button>
                    </div>
                  </div>
                </div>

                {/* Logout */}
                <div className="text-center mt-4">
                  <button className="btn btn-outline-secondary" onClick={handleLogout}>
                    <i className="bi bi-box-arrow-right me-2"></i>Logout
                  </button>
                </div>
              </div>
            )}

          </div>
        </div>
      </div>
    </div>
  );
};

export default ProfilePage;
