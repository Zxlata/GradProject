import React, { useState, useEffect } from 'react';
import { useInstallPrompt } from '../hooks/useInstallPrompt';

/**
 * InstallApp
 * ─────────────────────────────────────────────────────────────────────────────
 * Non-intrusive install CTA banner that slides up from the bottom of the
 * viewport.  Only renders when:
 *   1. The browser fires `beforeinstallprompt` (Chrome / Edge / Samsung)
 *   2. The user hasn't dismissed it this session
 *   3. The app isn't already installed (standalone mode)
 *
 * Placement: mount once at the App root level.
 *
 * Props:
 *   delay (ms, default 3000) — how long after mount before the banner appears
 */
const InstallApp = ({ delay = 3000 }) => {
  const { isInstallable, isInstalling, isInstalled, promptInstall, dismissPrompt } =
    useInstallPrompt();

  const [visible,  setVisible]  = useState(false);
  const [mounted,  setMounted]  = useState(false);
  const [closing,  setClosing]  = useState(false);
  const [success,  setSuccess]  = useState(false);

  // Animate in after `delay` ms
  useEffect(() => {
    if (!isInstallable) return;
    const id = setTimeout(() => {
      setMounted(true);
      requestAnimationFrame(() => setVisible(true));
    }, delay);
    return () => clearTimeout(id);
  }, [isInstallable, delay]);

  // Hide when installed
  useEffect(() => {
    if (isInstalled && mounted) {
      setSuccess(true);
      setTimeout(handleClose, 2500);
    }
  }, [isInstalled, mounted]);

  function handleClose() {
    setClosing(true);
    setTimeout(() => {
      setMounted(false);
      setVisible(false);
      setClosing(false);
      dismissPrompt();
    }, 350);
  }

  async function handleInstall() {
    await promptInstall();
    if (!isInstalled) handleClose(); // user declined
  }

  if (!mounted) return null;

  return (
    <>
      {/* ── Backdrop (subtle) ── */}
      {visible && !closing && (
        <div
          style={backdropStyle}
          onClick={handleClose}
          aria-hidden="true"
        />
      )}

      {/* ── Banner ── */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Install AI Interview Simulator"
        style={{
          ...bannerStyle,
          transform:  visible && !closing ? 'translateY(0)' : 'translateY(110%)',
          opacity:    visible && !closing ? 1 : 0,
        }}
      >
        {success ? (
          /* ── Success state ── */
          <div style={successStyle}>
            <span style={{ fontSize: 28 }}>🎉</span>
            <div>
              <strong style={{ color: '#f1f5f9', fontSize: 15 }}>
                App installed successfully!
              </strong>
              <p style={{ color: '#94a3b8', fontSize: 13, margin: '4px 0 0' }}>
                Look for <strong>AI Interview</strong> on your home screen.
              </p>
            </div>
          </div>
        ) : (
          /* ── Normal install CTA ── */
          <>
            {/* App icon + info */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, flex: 1, minWidth: 0 }}>
              <div style={iconStyle}>
                {/* Mini brain SVG */}
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none"
                     stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9.5 2a2.5 2.5 0 0 1 0 5H9a3 3 0 0 0 0 6h.5a2.5 2.5 0 0 1 0 5"/>
                  <path d="M14.5 2a2.5 2.5 0 0 0 0 5H15a3 3 0 0 1 0 6h-.5a2.5 2.5 0 0 0 0 5"/>
                  <line x1="12" y1="2" x2="12" y2="22"/>
                </svg>
              </div>
              <div style={{ minWidth: 0 }}>
                <p style={titleStyle}>Install AI Interview</p>
                <p style={subtitleStyle}>
                  Add to home screen for the best experience — works offline too.
                </p>
              </div>
            </div>

            {/* Actions */}
            <div style={actionsStyle}>
              <button
                style={installBtnStyle}
                onClick={handleInstall}
                disabled={isInstalling}
                aria-busy={isInstalling}
              >
                {isInstalling ? (
                  <>
                    <span style={spinnerStyle} aria-hidden="true" />
                    Installing…
                  </>
                ) : (
                  <>
                    <i className="bi bi-download" style={{ fontSize: 14 }} />
                    Install
                  </>
                )}
              </button>

              <button
                style={closeBtnStyle}
                onClick={handleClose}
                aria-label="Dismiss install prompt"
                title="Dismiss"
              >
                <i className="bi bi-x-lg" style={{ fontSize: 15 }} />
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
};

// ── Styles ────────────────────────────────────────────────────────────────────

const backdropStyle = {
  position:   'fixed',
  inset:       0,
  background: 'rgba(0,0,0,0.15)',
  zIndex:      1049,
  backdropFilter: 'blur(2px)',
};

const bannerStyle = {
  position:        'fixed',
  bottom:           16,
  left:             16,
  right:            16,
  maxWidth:         600,
  margin:           '0 auto',
  zIndex:           1050,
  background:       'linear-gradient(135deg, #1e1b4b 0%, #1e293b 100%)',
  border:           '1px solid rgba(139,92,246,0.35)',
  borderRadius:     18,
  boxShadow:        '0 20px 60px rgba(0,0,0,0.5), 0 0 0 1px rgba(99,102,241,0.2)',
  padding:          '16px 16px 16px 18px',
  display:          'flex',
  alignItems:       'center',
  gap:              14,
  transition:       'transform 0.35s cubic-bezier(0.34,1.56,0.64,1), opacity 0.35s ease',
  willChange:       'transform, opacity',
};

const successStyle = {
  display: 'flex', alignItems: 'center', gap: 14,
};

const iconStyle = {
  width:           44,
  height:          44,
  borderRadius:    12,
  background:      'linear-gradient(135deg,#6366f1 0%,#8b5cf6 100%)',
  display:         'flex',
  alignItems:      'center',
  justifyContent:  'center',
  flexShrink:       0,
  boxShadow:       '0 4px 14px rgba(99,102,241,0.45)',
};

const titleStyle = {
  color:       '#f1f5f9',
  fontWeight:   700,
  fontSize:     14,
  margin:        0,
  whiteSpace:   'nowrap',
  overflow:     'hidden',
  textOverflow: 'ellipsis',
};

const subtitleStyle = {
  color:       '#94a3b8',
  fontSize:     12,
  margin:       '3px 0 0',
  lineHeight:   1.4,
};

const actionsStyle = {
  display:    'flex',
  alignItems: 'center',
  gap:         8,
  flexShrink:  0,
};

const installBtnStyle = {
  display:        'inline-flex',
  alignItems:     'center',
  gap:             6,
  background:     'linear-gradient(135deg,#6366f1 0%,#8b5cf6 100%)',
  color:          '#fff',
  border:         'none',
  borderRadius:    10,
  padding:        '8px 16px',
  fontSize:        13,
  fontWeight:      600,
  cursor:         'pointer',
  whiteSpace:     'nowrap',
  boxShadow:      '0 4px 12px rgba(99,102,241,0.4)',
  transition:     'all 0.2s ease',
};

const closeBtnStyle = {
  display:        'flex',
  alignItems:     'center',
  justifyContent: 'center',
  width:           32,
  height:          32,
  background:     'rgba(255,255,255,0.08)',
  border:         '1px solid rgba(255,255,255,0.12)',
  borderRadius:    8,
  color:          '#94a3b8',
  cursor:         'pointer',
  flexShrink:      0,
};

const spinnerStyle = {
  display:      'inline-block',
  width:         12,
  height:        12,
  border:        '2px solid rgba(255,255,255,0.3)',
  borderTop:     '2px solid white',
  borderRadius: '50%',
  animation:    'spin 0.7s linear infinite',
};

// Inject keyframe for spinner (runs once, safe to call multiple times)
if (typeof document !== 'undefined' && !document.getElementById('install-app-spin')) {
  const style = document.createElement('style');
  style.id = 'install-app-spin';
  style.textContent = '@keyframes spin { to { transform: rotate(360deg); } }';
  document.head.appendChild(style);
}

export default InstallApp;
