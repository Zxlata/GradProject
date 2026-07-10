import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence, useAnimation } from 'framer-motion';
import { FiVideo, FiMic, FiEye, FiTrendingUp, FiCpu, FiCheckCircle, FiActivity } from 'react-icons/fi';
import { HiSparkles } from 'react-icons/hi';
import { BsRobot, BsCameraVideo } from 'react-icons/bs';

// ─── design tokens ────────────────────────────────────────────────────────────
const C = {
  purple:     '#8b5cf6',
  indigo:     '#6366f1',
  blue:       '#3b82f6',
  cyan:       '#06b6d4',
  bg:         '#0a0714',
  card:       'rgba(255,255,255,0.04)',
  cardBorder: 'rgba(139,92,246,0.25)',
  text:       '#e2e8f0',
  muted:      '#94a3b8',
};

const gradPurple = `linear-gradient(135deg, ${C.indigo} 0%, ${C.purple} 100%)`;
const gradBlue   = `linear-gradient(135deg, ${C.blue} 0%, ${C.cyan} 100%)`;

// ─── helpers ──────────────────────────────────────────────────────────────────
const glassCard = (extra = {}) => ({
  background:    C.card,
  backdropFilter: 'blur(20px)',
  WebkitBackdropFilter: 'blur(20px)',
  border:        `1px solid ${C.cardBorder}`,
  borderRadius:  '20px',
  ...extra,
});

// ─── waveform data ─────────────────────────────────────────────────────────────
const WAVE_BARS = Array.from({ length: 28 }, (_, i) => ({
  id: i,
  baseH: 6 + Math.random() * 18,
  delay:  i * 0.07,
}));

// ─── metrics ───────────────────────────────────────────────────────────────────
const METRICS = [
  { label: 'Confidence',    icon: FiTrendingUp, target: 87, color: C.purple  },
  { label: 'Eye Contact',   icon: FiEye,        target: 74, color: C.indigo  },
  { label: 'Speech Clarity',icon: FiMic,        target: 91, color: C.cyan    },
  { label: 'Engagement',    icon: FiActivity,   target: 82, color: C.blue    },
];

// ─── transcript lines ──────────────────────────────────────────────────────────
const TRANSCRIPT_LINES = [
  "My experience in team leadership has",
  " helped me navigate complex projects",
  " under tight deadlines effectively.",
];

// ─── sub-components ───────────────────────────────────────────────────────────

/** Pulsing "LIVE" badge */
function LiveBadge() {
  return (
    <div style={{
      display:        'flex',
      alignItems:     'center',
      gap:            '6px',
      background:     'rgba(239,68,68,0.2)',
      border:         '1px solid rgba(239,68,68,0.5)',
      borderRadius:   '999px',
      padding:        '3px 10px',
      fontSize:       '11px',
      fontWeight:     700,
      letterSpacing:  '0.1em',
      color:          '#f87171',
    }}>
      <motion.div
        animate={{ opacity: [1, 0.2, 1] }}
        transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
        style={{
          width: 7, height: 7, borderRadius: '50%',
          background: '#ef4444',
          boxShadow: '0 0 6px #ef4444',
        }}
      />
      LIVE
    </div>
  );
}

/** Floating emotion badge */
function EmotionBadge() {
  return (
    <motion.div
      animate={{ y: [-4, 4, -4] }}
      transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
      style={{
        position:   'absolute',
        bottom:     20,
        left:       20,
        display:    'flex',
        alignItems: 'center',
        gap:        '6px',
        background: 'rgba(16,185,129,0.18)',
        border:     '1px solid rgba(16,185,129,0.45)',
        borderRadius: '999px',
        padding:    '5px 13px',
        fontSize:   '13px',
        fontWeight: 600,
        color:      '#6ee7b7',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        zIndex:     10,
      }}
    >
      😊 Confident
    </motion.div>
  );
}

/** Animated glowing border ring around the webcam card */
function GlowBorder({ children }) {
  return (
    <div style={{ position: 'relative', borderRadius: '22px' }}>
      {/* rotating gradient border */}
      <motion.div
        animate={{ rotate: 360 }}
        transition={{ duration: 6, repeat: Infinity, ease: 'linear' }}
        style={{
          position:     'absolute',
          inset:        -2,
          borderRadius: '24px',
          background:   `conic-gradient(from 0deg, ${C.purple}, ${C.cyan}, ${C.indigo}, ${C.purple})`,
          zIndex:       0,
        }}
      />
      {/* inner mask */}
      <div style={{
        position:     'absolute',
        inset:        1.5,
        borderRadius: '22px',
        background:   '#130d24',
        zIndex:       1,
      }} />
      <div style={{ position: 'relative', zIndex: 2 }}>
        {children}
      </div>
    </div>
  );
}

/** Mock webcam preview */
function WebcamCard() {
  return (
    <GlowBorder>
      <div style={{
        ...glassCard(),
        border:         'none',
        borderRadius:   '20px',
        overflow:       'hidden',
        aspectRatio:    '4/3',
        display:        'flex',
        flexDirection:  'column',
        alignItems:     'center',
        justifyContent: 'center',
        position:       'relative',
        background:     'linear-gradient(145deg, #130d24, #0e1628)',
        minHeight:      260,
      }}>
        {/* scan-line overlay */}
        <motion.div
          animate={{ y: ['-100%', '200%'] }}
          transition={{ duration: 3, repeat: Infinity, ease: 'linear', repeatDelay: 1.5 }}
          style={{
            position:   'absolute',
            left:       0,
            right:      0,
            height:     '3px',
            background: `linear-gradient(90deg, transparent 0%, ${C.cyan}55 50%, transparent 100%)`,
            pointerEvents: 'none',
          }}
        />

        {/* avatar silhouette */}
        <motion.div
          animate={{ scale: [1, 1.03, 1] }}
          transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
          style={{
            width:          110,
            height:         110,
            borderRadius:   '50%',
            background:     'linear-gradient(145deg, #1e1040, #2d1b69)',
            border:         `2px solid rgba(139,92,246,0.3)`,
            display:        'flex',
            alignItems:     'center',
            justifyContent: 'center',
            marginBottom:   16,
          }}
        >
          <BsCameraVideo size={42} color={C.purple} />
        </motion.div>
        <p style={{ color: C.muted, fontSize: 12, margin: 0 }}>Camera Preview</p>

        {/* top-right LIVE badge */}
        <div style={{ position: 'absolute', top: 14, right: 14 }}>
          <LiveBadge />
        </div>

        {/* floating emotion badge */}
        <EmotionBadge />
      </div>
    </GlowBorder>
  );
}

/** Single animated metric bar */
function MetricBar({ label, icon: Icon, target, color, delay }) {
  const controls = useAnimation();

  useEffect(() => {
    controls.start({
      width: `${target}%`,
      transition: { duration: 1.4, delay, ease: [0.22, 1, 0.36, 1] },
    });
  }, [controls, target, delay]);

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: delay + 0.2 }}
      style={{ marginBottom: 16 }}
    >
      <div style={{
        display:        'flex',
        justifyContent: 'space-between',
        alignItems:     'center',
        marginBottom:   6,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <Icon size={13} color={color} />
          <span style={{ color: C.text, fontSize: 13, fontWeight: 500 }}>{label}</span>
        </div>
        <motion.span
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: delay + 1.4 }}
          style={{ color, fontSize: 13, fontWeight: 700 }}
        >
          {target}%
        </motion.span>
      </div>

      {/* track */}
      <div style={{
        height:       6,
        borderRadius: 999,
        background:   'rgba(255,255,255,0.07)',
        overflow:     'hidden',
      }}>
        <motion.div
          initial={{ width: '0%' }}
          animate={controls}
          style={{
            height:     '100%',
            borderRadius: 999,
            background: `linear-gradient(90deg, ${color}99, ${color})`,
            boxShadow:  `0 0 10px ${color}66`,
          }}
        />
      </div>
    </motion.div>
  );
}

/** Live typing transcript */
function TypingTranscript() {
  const [displayed, setDisplayed] = useState('');
  const fullText = TRANSCRIPT_LINES.join('');
  const idxRef   = useRef(0);

  useEffect(() => {
    const tick = () => {
      if (idxRef.current < fullText.length) {
        idxRef.current++;
        setDisplayed(fullText.slice(0, idxRef.current));
      } else {
        // reset after pause
        setTimeout(() => {
          idxRef.current = 0;
          setDisplayed('');
        }, 2800);
        return;
      }
    };
    const id = setInterval(tick, 38);
    return () => clearInterval(id);
  }, [fullText]);

  return (
    <div style={{
      ...glassCard({ borderRadius: '14px' }),
      padding: '12px 14px',
    }}>
      <div style={{
        display:    'flex',
        alignItems: 'center',
        gap:        6,
        marginBottom: 8,
      }}>
        <motion.div
          animate={{ opacity: [1, 0.3, 1] }}
          transition={{ duration: 1.2, repeat: Infinity }}
          style={{
            width: 7, height: 7, borderRadius: '50%',
            background: C.cyan, boxShadow: `0 0 6px ${C.cyan}`,
          }}
        />
        <span style={{ fontSize: 10, color: C.cyan, fontWeight: 600, letterSpacing: '0.08em' }}>
          TRANSCRIBING
        </span>
      </div>
      <p style={{
        color:      C.text,
        fontSize:   13,
        lineHeight: 1.6,
        margin:     0,
        minHeight:  42,
        fontStyle:  'italic',
      }}>
        "{displayed}
        <motion.span
          animate={{ opacity: [1, 0] }}
          transition={{ duration: 0.6, repeat: Infinity }}
          style={{ color: C.purple, fontWeight: 700 }}
        >|</motion.span>"
      </p>
    </div>
  );
}

/** AI feedback chip */
function AIFeedback() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 2.2, duration: 0.6 }}
      style={{
        display:    'flex',
        alignItems: 'flex-start',
        gap:        10,
        background: 'rgba(99,102,241,0.12)',
        border:     `1px solid rgba(99,102,241,0.3)`,
        borderRadius: '14px',
        padding:    '12px 14px',
      }}
    >
      <div style={{
        flexShrink:     0,
        width:          30,
        height:         30,
        borderRadius:   '50%',
        background:     gradPurple,
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'center',
      }}>
        <BsRobot size={15} color="#fff" />
      </div>
      <div>
        <p style={{ color: C.muted, fontSize: 10, fontWeight: 600,
                    letterSpacing: '0.08em', margin: '0 0 4px' }}>
          AI COACH
        </p>
        <p style={{ color: C.text, fontSize: 13, lineHeight: 1.55, margin: 0 }}>
          Strong structured communication detected.{' '}
          <span style={{ color: C.purple, fontWeight: 600 }}>
            Maintain eye contact for +8% score boost.
          </span>
        </p>
      </div>
    </motion.div>
  );
}

/** Animated audio waveform */
function AudioWaveform() {
  return (
    <div style={{
      display:        'flex',
      alignItems:     'center',
      justifyContent: 'center',
      gap:            3,
      height:         48,
      padding:        '0 4px',
    }}>
      {WAVE_BARS.map(bar => (
        <motion.div
          key={bar.id}
          animate={{
            height: [
              bar.baseH,
              bar.baseH + 14 + Math.random() * 18,
              bar.baseH,
            ],
          }}
          transition={{
            duration:   0.55 + Math.random() * 0.4,
            delay:      bar.delay,
            repeat:     Infinity,
            ease:       'easeInOut',
            repeatType: 'mirror',
          }}
          style={{
            width:        4,
            minHeight:    bar.baseH,
            borderRadius: 999,
            background:   bar.id % 3 === 0 ? C.purple
                        : bar.id % 3 === 1 ? C.indigo
                        :                    C.cyan,
            opacity: 0.75 + (bar.id % 4) * 0.06,
          }}
        />
      ))}
    </div>
  );
}

/** Header row for a panel */
function PanelHeader({ icon: Icon, title, badge }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <div style={{
          width: 32, height: 32, borderRadius: '50%',
          background: gradPurple,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Icon size={15} color="#fff" />
        </div>
        <span style={{ color: C.text, fontWeight: 700, fontSize: 15 }}>{title}</span>
      </div>
      {badge && (
        <div style={{
          background:   'rgba(139,92,246,0.18)',
          border:       `1px solid rgba(139,92,246,0.35)`,
          borderRadius: '999px',
          padding:      '2px 9px',
          fontSize:     11,
          color:        C.purple,
          fontWeight:   600,
        }}>
          {badge}
        </div>
      )}
    </div>
  );
}

// ─── main component ───────────────────────────────────────────────────────────

export default function LiveInterviewPreview() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  return (
    <section style={{
      background:  `radial-gradient(ellipse at 30% 20%, rgba(99,102,241,0.18) 0%, transparent 55%),
                    radial-gradient(ellipse at 80% 80%, rgba(139,92,246,0.15) 0%, transparent 55%),
                    ${C.bg}`,
      padding:     '72px 24px',
      overflow:    'hidden',
    }}>
      {/* section title */}
      <motion.div
        initial={{ opacity: 0, y: -24 }}
        animate={mounted ? { opacity: 1, y: 0 } : {}}
        transition={{ duration: 0.7 }}
        style={{ textAlign: 'center', marginBottom: 48 }}
      >
        <div style={{
          display:        'inline-flex',
          alignItems:     'center',
          gap:            7,
          background:     'rgba(139,92,246,0.12)',
          border:         `1px solid rgba(139,92,246,0.3)`,
          borderRadius:   '999px',
          padding:        '5px 16px',
          marginBottom:   18,
          fontSize:       12,
          fontWeight:     600,
          color:          C.purple,
          letterSpacing:  '0.07em',
        }}>
          <HiSparkles size={13} />
          LIVE AI ANALYSIS PREVIEW
        </div>
        <h2 style={{
          fontSize:   'clamp(26px, 4vw, 40px)',
          fontWeight: 800,
          color:      '#f1f5f9',
          margin:     0,
          lineHeight: 1.2,
        }}>
          Experience Real-Time{' '}
          <span style={{
            background: gradPurple,
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
          }}>
            AI Coaching
          </span>
        </h2>
      </motion.div>

      {/* main card */}
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={mounted ? { opacity: 1, scale: 1 } : {}}
        transition={{ duration: 0.8, delay: 0.15 }}
        whileHover={{ scale: 1.008, transition: { duration: 0.25 } }}
        style={{
          ...glassCard({ borderRadius: '28px' }),
          maxWidth:  920,
          margin:    '0 auto',
          padding:   28,
          boxShadow: `0 32px 80px rgba(0,0,0,0.55), 0 0 0 1px rgba(139,92,246,0.2), inset 0 1px 0 rgba(255,255,255,0.06)`,
        }}
      >
        {/* row: left webcam + right panel */}
        <div style={{
          display:             'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          gap:                 24,
          marginBottom:        24,
        }}>
          {/* ── LEFT: webcam ── */}
          <motion.div
            initial={{ opacity: 0, x: -30 }}
            animate={mounted ? { opacity: 1, x: 0 } : {}}
            transition={{ duration: 0.7, delay: 0.3 }}
          >
            <WebcamCard />

            {/* mic indicator strip */}
            <div style={{
              ...glassCard({ borderRadius: '14px' }),
              padding:    '10px 16px',
              marginTop:  14,
              display:    'flex',
              alignItems: 'center',
              gap:        10,
            }}>
              <motion.div
                animate={{ scale: [1, 1.25, 1] }}
                transition={{ duration: 0.8, repeat: Infinity }}
                style={{
                  width: 32, height: 32, borderRadius: '50%',
                  background: 'rgba(6,182,212,0.18)',
                  border:     `1px solid ${C.cyan}55`,
                  display:    'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                <FiMic size={14} color={C.cyan} />
              </motion.div>
              <div>
                <p style={{ color: C.text, fontSize: 12, fontWeight: 600, margin: 0 }}>
                  Microphone Active
                </p>
                <p style={{ color: C.muted, fontSize: 11, margin: 0 }}>
                  Audio detected — processing…
                </p>
              </div>
              <div style={{ marginLeft: 'auto' }}>
                <AudioWaveform />
              </div>
            </div>
          </motion.div>

          {/* ── RIGHT: analysis panel ── */}
          <motion.div
            initial={{ opacity: 0, x: 30 }}
            animate={mounted ? { opacity: 1, x: 0 } : {}}
            transition={{ duration: 0.7, delay: 0.4 }}
            style={{ display: 'flex', flexDirection: 'column', gap: 18 }}
          >
            {/* metrics card */}
            <div style={{ ...glassCard({ borderRadius: '18px' }), padding: '20px 20px 8px' }}>
              <PanelHeader icon={FiCpu} title="AI Analysis" badge="Real-time" />
              {METRICS.map((m, i) => (
                <MetricBar key={m.label} {...m} delay={0.5 + i * 0.18} />
              ))}
            </div>

            {/* transcript card */}
            <div style={{ ...glassCard({ borderRadius: '18px' }), padding: '18px 18px 14px' }}>
              <PanelHeader icon={FiVideo} title="Live Transcript" />
              <TypingTranscript />
            </div>

            {/* AI feedback card */}
            <AIFeedback />
          </motion.div>
        </div>

        {/* ── BOTTOM: full-width waveform bar ── */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={mounted ? { opacity: 1, y: 0 } : {}}
          transition={{ delay: 0.8, duration: 0.6 }}
          style={{
            ...glassCard({ borderRadius: '16px' }),
            padding:    '14px 22px',
            display:    'flex',
            alignItems: 'center',
            gap:        18,
          }}
        >
          {/* label */}
          <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              width: 30, height: 30, borderRadius: '50%',
              background: 'rgba(139,92,246,0.2)',
              border: `1px solid rgba(139,92,246,0.35)`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <FiActivity size={14} color={C.purple} />
            </div>
            <div>
              <p style={{ color: C.text, fontSize: 12, fontWeight: 600, margin: 0 }}>Audio Waveform</p>
              <p style={{ color: C.muted, fontSize: 11, margin: 0 }}>Voice pattern analysis</p>
            </div>
          </div>

          {/* waveform */}
          <div style={{ flex: 1, overflow: 'hidden' }}>
            <AudioWaveform />
          </div>

          {/* score pill */}
          <motion.div
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 1.5, type: 'spring', stiffness: 220, damping: 14 }}
            style={{
              flexShrink:     0,
              display:        'flex',
              alignItems:     'center',
              gap:            6,
              background:     'rgba(16,185,129,0.15)',
              border:         '1px solid rgba(16,185,129,0.35)',
              borderRadius:   '999px',
              padding:        '5px 13px',
              fontSize:       13,
              color:          '#6ee7b7',
              fontWeight:     700,
            }}
          >
            <FiCheckCircle size={13} />
            84 / 100
          </motion.div>
        </motion.div>
      </motion.div>

      {/* subtle bottom note */}
      <motion.p
        initial={{ opacity: 0 }}
        animate={mounted ? { opacity: 1 } : {}}
        transition={{ delay: 1.6 }}
        style={{
          textAlign:  'center',
          marginTop:  28,
          color:      C.muted,
          fontSize:   13,
        }}
      >
        All analysis is processed in real-time by our AI engine — no data is stored during demos.
      </motion.p>
    </section>
  );
}
