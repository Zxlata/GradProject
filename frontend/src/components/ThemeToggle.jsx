import React from 'react';
import { useTheme } from '../context/ThemeContext';

const OPTIONS = [
  { value: 'light',  icon: 'sun',          label: 'Light'  },
  { value: 'system', icon: 'display',       label: 'Auto'   },
  { value: 'dark',   icon: 'moon-stars-fill', label: 'Dark' },
];

/**
 * ThemeToggle
 *
 * compact=true  → single icon button that cycles light → auto → dark → light
 * compact=false → pill with three labelled buttons (default)
 */
const ThemeToggle = ({ compact = false }) => {
  const { theme, setTheme } = useTheme();

  if (compact) {
    const idx     = OPTIONS.findIndex((o) => o.value === theme);
    const current = OPTIONS[idx] ?? OPTIONS[0];
    const next    = OPTIONS[(idx + 1) % OPTIONS.length];
    return (
      <button
        className="btn btn-sm theme-toggle-btn"
        onClick={() => setTheme(next.value)}
        title={`Theme: ${current.label} — click for ${next.label}`}
        aria-label={`Current theme: ${current.label}. Switch to ${next.label}`}
      >
        <i className={`bi bi-${current.icon}`}></i>
      </button>
    );
  }

  return (
    <div className="theme-toggle-group" role="group" aria-label="Choose color theme">
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          className={`theme-toggle-option ${theme === opt.value ? 'active' : ''}`}
          onClick={() => setTheme(opt.value)}
          aria-pressed={theme === opt.value}
          title={opt.label}
        >
          <i className={`bi bi-${opt.icon}`}></i>
          <span className="theme-toggle-label">{opt.label}</span>
        </button>
      ))}
    </div>
  );
};

export default ThemeToggle;
