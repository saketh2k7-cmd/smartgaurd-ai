import React, { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import {
  ShieldCheck,
  ShieldAlert,
  Thermometer,
  Wind,
  Flame,
  Eye,
  Droplets,
  Activity,
  Bell,
  BellOff,
  RotateCcw,
  Zap,
  WifiOff,
  Video,
  VideoOff,
  Camera,
  Maximize2,
  Minimize2,
  House,
  Clock,
} from 'lucide-react';

const API_URL = 'https://smartgaurd-ai.onrender.com/sensor-data';
const POLL_MS = 2000;
const MAX_LOG = 14;

/* The room this camera watches. Friendlier than a tactical call sign. */
const CAMERA_NAME = 'Living room';

/* Fallback clip. Google's public test bucket — stable and CORS-enabled,
   which matters because the snapshot button draws the frame to a canvas.
   Swap for any calm indoor clip; same-origin (public/) is safest. */
const CCTV_SRC =
  'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4';

/* ------------------------------------------------------------------ */
/*  Severity system — one source of truth for colour, tone and copy     */
/* ------------------------------------------------------------------ */

const SEVERITY = {
  SAFE: {
    label: 'All clear',
    headline: 'Home status: All clear',
    blurb: 'Everything looks normal right now.',
    ring: '#34D399',
    text: 'text-emerald-300',
    chip: 'border-emerald-400/25 bg-emerald-400/10 text-emerald-300',
    tint: 'bg-emerald-400/10 text-emerald-300',
    dot: 'bg-emerald-400',
    glow: null, // calm states stay quiet — no glow
  },
  WARNING: {
    label: 'Needs attention',
    headline: 'Home status: Needs attention',
    blurb: 'A reading has drifted out of its comfortable range.',
    ring: '#FBBF24',
    text: 'text-amber-300',
    chip: 'border-amber-400/25 bg-amber-400/10 text-amber-300',
    tint: 'bg-amber-400/10 text-amber-300',
    dot: 'bg-amber-400',
    glow: null,
  },
  HIGH: {
    label: 'Take action',
    headline: 'Home status: Take action',
    blurb: 'Conditions are unsafe. Follow the recommended action.',
    ring: '#FB923C',
    text: 'text-orange-300',
    chip: 'border-orange-400/30 bg-orange-400/10 text-orange-300',
    tint: 'bg-orange-400/10 text-orange-300',
    dot: 'bg-orange-400',
    glow: '0 0 55px -18px rgba(251,146,60,0.75)',
  },
  CRITICAL: {
    label: 'Emergency',
    headline: 'Home status: Emergency',
    blurb: 'Leave the area and follow the recommended action now.',
    ring: '#f70b2e',
    text: 'text-rose-300',
    chip: 'border-rose-400/35 bg-rose-400/10 text-rose-300',
    tint: 'bg-rose-400/10 text-rose-300',
    dot: 'bg-rose-400',
    glow: '0 0 65px -14px rgba(251,113,133,0.85)',
  },
};

const severityOf = (score) =>
  score >= 81 ? SEVERITY.CRITICAL
  : score >= 61 ? SEVERITY.HIGH
  : score >= 31 ? SEVERITY.WARNING
  : SEVERITY.SAFE;

const SEVERITY_RANK = { SAFE: 0, WARNING: 1, HIGH: 2, CRITICAL: 3 };

/* Backend returns shouty verbs; show people plain language instead. */
const ACTION_COPY = {
  MONITOR: 'Keep monitoring',
  VENTILATE: 'Ventilate the area',
  SUPPRESS: 'Activate suppression',
  EVACUATE: 'Evacuate the building',
};

const friendlyAction = (a) =>
  ACTION_COPY[a] || (a ? a.charAt(0).toUpperCase() + a.slice(1).toLowerCase() : '—');

/* ------------------------------------------------------------------ */
/*  Telemetry helpers                                                   */
/* ------------------------------------------------------------------ */

const round = (n, d = 1) => parseFloat(n.toFixed(d));

function generateReading(mode) {
  switch (mode) {
    case 'fire':
      return {
        temperature: round(62 + Math.random() * 18),
        humidity: round(12 + Math.random() * 10),
        gas_level: Math.floor(420 + Math.random() * 260),
        flame_detected: true,
        motion_detected: Math.random() > 0.4,
      };
    case 'gas':
      return {
        temperature: round(24 + Math.random() * 6),
        humidity: round(45 + Math.random() * 15),
        gas_level: Math.floor(600 + Math.random() * 350),
        flame_detected: false,
        motion_detected: Math.random() > 0.6,
      };
    case 'safe':
      return {
        temperature: round(21 + Math.random() * 3),
        humidity: round(42 + Math.random() * 8),
        gas_level: Math.floor(70 + Math.random() * 40),
        flame_detected: false,
        motion_detected: Math.random() > 0.7,
      };
    default:
      return {
        temperature: round(20 + Math.random() * 30),
        humidity: round(30 + Math.random() * 40),
        gas_level: Math.floor(80 + Math.random() * 400),
        flame_detected: Math.random() > 0.85,
        motion_detected: Math.random() > 0.5,
      };
  }
}

function evaluateLocally(d) {
  let score = 0;
  if (d.temperature > 60) score += 45;
  else if (d.temperature > 45) score += 28;
  else if (d.temperature > 35) score += 12;

  if (d.gas_level > 600) score += 40;
  else if (d.gas_level > 400) score += 26;
  else if (d.gas_level > 250) score += 12;

  if (d.flame_detected) score += 45;
  if (d.motion_detected && (d.flame_detected || d.gas_level > 500)) score += 6;
  if (d.humidity < 20) score += 5;

  score = Math.max(0, Math.min(100, score));
  const level = Object.keys(SEVERITY).find((k) => SEVERITY[k] === severityOf(score));
  const action =
    level === 'CRITICAL' ? 'EVACUATE'
    : level === 'HIGH' ? 'SUPPRESS'
    : level === 'WARNING' ? 'VENTILATE'
    : 'MONITOR';

  return { risk_score: score, risk_level: level, recommended_action: action };
}

/* ------------------------------------------------------------------ */
/*  Motion keyframes — gentle, and disabled for reduced-motion users    */
/* ------------------------------------------------------------------ */

const KEYFRAMES = `
@keyframes sgBreathe {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.55; }
}
@keyframes sgHalo {
  0%, 100% { box-shadow: 0 0 0 0 rgba(251,113,133,0.35); }
  50%      { box-shadow: 0 0 0 10px rgba(251,113,133,0); }
}
@media (prefers-reduced-motion: reduce) {
  .sg-motion { animation: none !important; }
}
`;

/* ------------------------------------------------------------------ */
/*  Building blocks                                                     */
/* ------------------------------------------------------------------ */

function Card({ children, className = '', style }) {
  return (
    <div
      style={style}
      className={`rounded-3xl border border-white/[0.07] bg-zinc-800/50 backdrop-blur-xl transition-all duration-500 ${className}`}
    >
      {children}
    </div>
  );
}

function Pill({ children, className = '', pulse = false }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${className} ${
        pulse ? 'sg-motion animate-pulse' : ''
      }`}
    >
      {children}
    </span>
  );
}

function MetricBar({ value, max, color, comfort = [] }) {
  const pct = Math.max(3, Math.min(100, (value / max) * 100));
  return (
    <div className="relative mt-5 h-2.5 w-full overflow-hidden rounded-full bg-white/[0.07]">
      {comfort.length === 2 && (
        <div
          className="absolute inset-y-0 rounded-full bg-white/[0.06]"
          style={{
            left: `${(comfort[0] / max) * 100}%`,
            width: `${((comfort[1] - comfort[0]) / max) * 100}%`,
          }}
        />
      )}
      <div
        className="h-full rounded-full transition-all duration-700 ease-out"
        style={{ width: `${pct}%`, backgroundColor: color }}
      />
    </div>
  );
}

function SensorCard({ icon: Icon, name, tint, children, accent, alert = false }) {
  return (
    <Card
      className={`p-6 ${alert ? 'border-rose-400/30' : ''}`}
      style={alert ? { boxShadow: SEVERITY.CRITICAL.glow } : undefined}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-3 text-sm font-medium text-zinc-400">
          <span className={`flex h-8 w-8 items-center justify-center rounded-xl ${tint}`}>
            <Icon className="h-4 w-4" />
          </span>
          {name}
        </span>
        {accent}
      </div>
      {children}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  Safety score — a soft 270° arc with rounded ends                    */
/* ------------------------------------------------------------------ */

function RiskGauge({ score, level, action, critical }) {
  const sev = SEVERITY[level] || severityOf(score);
  const R = 82;
  const CIRC = 2 * Math.PI * R;
  const SWEEP = 0.75; // 270° of arc, gap at the bottom
  const arc = CIRC * SWEEP;
  const pct = Math.min(100, Math.max(0, score)) / 100;

  return (
    <div className="flex flex-col items-center">
      <div className="relative h-[210px] w-[210px]">
        <svg viewBox="0 0 200 200" className="h-full w-full">
          <g transform="rotate(135 100 100)">
            <circle
              cx="100"
              cy="100"
              r={R}
              fill="none"
              stroke="rgba(255,255,255,0.07)"
              strokeWidth="14"
              strokeLinecap="round"
              strokeDasharray={`${arc} ${CIRC}`}
            />
            <circle
              cx="100"
              cy="100"
              r={R}
              fill="none"
              stroke={sev.ring}
              strokeWidth="14"
              strokeLinecap="round"
              strokeDasharray={`${arc} ${CIRC}`}
              strokeDashoffset={arc * (1 - pct)}
              style={{
                transition:
                  'stroke-dashoffset 900ms cubic-bezier(.22,1,.36,1), stroke 600ms ease',
                filter: sev.glow ? `drop-shadow(0 0 8px ${sev.ring}88)` : 'none',
              }}
            />
          </g>
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[56px] font-semibold leading-none tracking-tight text-white tabular-nums">
            {score}
          </span>
          <span className="mt-2 text-sm text-zinc-500">Risk score</span>
        </div>
      </div>

      <Pill className={`${sev.chip} mt-2 px-4 py-1.5 text-sm`} pulse={critical}>
        {level === 'SAFE' ? <ShieldCheck className="h-4 w-4" /> : <ShieldAlert className="h-4 w-4" />}
        {sev.label}
      </Pill>

      <p className="mt-5 max-w-[15rem] text-center text-sm leading-relaxed text-zinc-400">
        {sev.blurb}
      </p>
      <p className="mt-3 text-center text-sm text-zinc-500">
        Recommended action:{' '}
        <span className="font-medium text-zinc-100">{friendlyAction(action)}</span>
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Live feed                                                           */
/* ------------------------------------------------------------------ */

// Detections are derived from risk level, so the video overlay and the
// sensor readings can never contradict each other on screen.
function detectionsFor(level, flame, motion) {
  if (level === 'CRITICAL' || flame) {
    return [
      { id: 'fire', x: 22, y: 20, w: 42, h: 54, label: 'Flame detected', conf: 99 },
      ...(motion
        ? [{ id: 'occ', x: 68, y: 49, w: 24, h: 34, label: 'Person in room', conf: 92 }]
        : []),
    ];
  }
  if (level === 'HIGH' || level === 'WARNING') {
    return [
      { id: 'gas', x: 16, y: 26, w: 36, h: 42, label: 'Smoke or gas drift', conf: 84 },
      ...(level === 'HIGH'
        ? [{ id: 'therm', x: 60, y: 44, w: 26, h: 32, label: 'Unusual heat', conf: 71 }]
        : []),
    ];
  }
  return [];
}

function DetectionBox({ box, color, alert, jitter }) {
  return (
    <div
      className="absolute transition-all duration-700 ease-out"
      style={{
        left: `${box.x + jitter.x}%`,
        top: `${box.y + jitter.y}%`,
        width: `${box.w}%`,
        height: `${box.h}%`,
      }}
    >
      <div
        className={`absolute inset-0 rounded-2xl border-2 ${alert ? 'sg-motion' : ''}`}
        style={{
          borderColor: color,
          backgroundColor: `${color}12`,
          animation: alert ? 'sgBreathe 1.8s ease-in-out infinite' : undefined,
        }}
      />
      <span
        className="absolute -top-8 left-0 whitespace-nowrap rounded-full px-3 py-1 text-xs font-semibold text-zinc-900 shadow-lg"
        style={{ backgroundColor: color }}
      >
        {box.label} · {Math.min(99, box.conf + jitter.c)}%
      </span>
    </div>
  );
}

function LiveFeed({ level, flame, motion, online, onEvent }) {
  const sev = SEVERITY[level] || SEVERITY.SAFE;
  const alert = level === 'CRITICAL' || flame;
  const boxes = detectionsFor(level, flame, motion);

  const [source, setSource] = useState('cctv');
  const [camNote, setCamNote] = useState(null);
  const [videoError, setVideoError] = useState(false);
  const [fps, setFps] = useState(30);
  const [clock, setClock] = useState(() => new Date());
  const [fullscreen, setFullscreen] = useState(false);
  const [flash, setFlash] = useState(false);
  const [jitter, setJitter] = useState({ x: 0, y: 0, c: 0 });

  const videoRef = useRef(null);
  const shellRef = useRef(null);
  const streamRef = useRef(null);

  const stopWebcam = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    if (source === 'webcam') {
      setCamNote(null);
      navigator.mediaDevices
        ?.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
        .then((stream) => {
          if (cancelled) {
            stream.getTracks().forEach((t) => t.stop());
            return;
          }
          streamRef.current = stream;
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            videoRef.current.play().catch(() => {});
          }
        })
        .catch(() => {
          if (cancelled) return;
          setCamNote('Camera access was blocked, so we switched back to the saved feed.');
          setSource('cctv');
        });
    } else {
      stopWebcam();
      if (videoRef.current) {
        videoRef.current.srcObject = null;
        videoRef.current.load();
        videoRef.current.play().catch(() => {});
      }
    }

    return () => {
      cancelled = true;
    };
  }, [source, stopWebcam]);

  useEffect(() => stopWebcam, [stopWebcam]);

  // Measured frame rate rather than a hardcoded number.
  useEffect(() => {
    let frames = 0;
    let raf;
    let last = performance.now();
    const tick = (now) => {
      frames += 1;
      if (now - last >= 1000) {
        setFps(Math.round((frames * 1000) / (now - last)));
        frames = 0;
        last = now;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Slight drift so the boxes read as tracking rather than stamped on.
  useEffect(() => {
    const t = setInterval(() => {
      setJitter({
        x: round(Math.random() * 2 - 1),
        y: round(Math.random() * 2 - 1),
        c: Math.floor(Math.random() * 3) - 1,
      });
    }, 1600);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const onFsChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  const toggleFullscreen = () => {
    const el = shellRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen?.();
    else el.requestFullscreen?.().catch(() => {});
  };

  const snapshot = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
      const url = canvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = url;
      a.download = `smartguard-${Date.now()}.png`;
      a.click();
      setFlash(true);
      setTimeout(() => setFlash(false), 200);
      onEvent?.('SAFE', `Snapshot saved from the ${CAMERA_NAME.toLowerCase()}`, 'Added to your activity log');
    } catch {
      onEvent?.('WARNING', 'Snapshot blocked by the video source', 'Use a clip hosted with your app');
    }
  };

  const feedStatus = alert
    ? 'Hazard confirmed'
    : boxes.length
      ? boxes[0].label
      : 'Nothing unusual detected';

  return (
    <Card
      className="overflow-hidden"
      style={alert ? { boxShadow: SEVERITY.CRITICAL.glow } : undefined}
    >
      <style>{KEYFRAMES}</style>

      <div className="flex items-center justify-between gap-3 px-6 py-5">
        <div>
          <h2 className="text-base font-semibold text-white">Live feed</h2>
          <p className="mt-0.5 text-sm text-zinc-500">{CAMERA_NAME}</p>
        </div>
        <button
          onClick={() => setSource((s) => (s === 'cctv' ? 'webcam' : 'cctv'))}
          className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-medium text-zinc-300 transition-colors duration-200 hover:bg-white/[0.08] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
        >
          {source === 'webcam' ? <Video className="h-4 w-4" /> : <VideoOff className="h-4 w-4" />}
          {source === 'webcam' ? 'Webcam' : 'Saved feed'}
        </button>
      </div>

      <div className="px-4 pb-4">
        <div
          ref={shellRef}
          className={`relative aspect-video w-full overflow-hidden rounded-2xl bg-black ring-1 transition-all duration-500 ${
            alert ? 'sg-motion ring-2 ring-rose-400/70' : 'ring-white/10'
          }`}
          style={alert ? { animation: 'sgHalo 2s ease-in-out infinite' } : undefined}
        >
          {videoError && source === 'cctv' ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-zinc-900 text-zinc-500">
              <WifiOff className="h-6 w-6" />
              <span className="text-sm">This camera is offline</span>
            </div>
          ) : (
            <video
              ref={videoRef}
              src={source === 'cctv' ? CCTV_SRC : undefined}
              crossOrigin="anonymous"
              autoPlay
              muted
              loop
              playsInline
              onError={() => source === 'cctv' && setVideoError(true)}
              className="h-full w-full object-cover"
              style={{ filter: 'brightness(0.92) saturate(1.05)' }}
            />
          )}

          {/* Soft top and bottom scrims so overlay text stays readable */}
          <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-black/55 to-transparent" />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/60 to-transparent" />

          {boxes.map((b) => (
            <DetectionBox key={b.id} box={b} color={sev.ring} alert={alert} jitter={jitter} />
          ))}

          {/* Top overlay */}
          <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-4">
            <Pill className="border-white/15 bg-black/40 text-white backdrop-blur-md">
              <span className="relative flex h-1.5 w-1.5">
                {online && (
                  <span className="sg-motion absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400 opacity-75" />
                )}
                <span
                  className={`relative inline-flex h-1.5 w-1.5 rounded-full ${online ? 'bg-rose-400' : 'bg-zinc-500'}`}
                />
              </span>
              {online ? 'Live' : 'Paused'}
            </Pill>
            <Pill className="border-white/10 bg-black/35 text-zinc-300 tabular-nums backdrop-blur-md">
              {fps} fps · {clock.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </Pill>
          </div>

          {/* Bottom overlay */}
          <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 p-4">
            <Pill
              className={`${sev.chip} bg-black/45 backdrop-blur-md`}
              pulse={alert}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${sev.dot}`} />
              {feedStatus}
            </Pill>
            <div className="flex items-center gap-2">
              <button
                onClick={snapshot}
                title="Save a snapshot"
                aria-label="Save a snapshot"
                className="rounded-full border border-white/15 bg-black/40 p-2.5 text-zinc-200 backdrop-blur-md transition-colors duration-200 hover:bg-white/15 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
              >
                <Camera className="h-4 w-4" />
              </button>
              <button
                onClick={toggleFullscreen}
                title={fullscreen ? 'Exit full screen' : 'Full screen'}
                aria-label={fullscreen ? 'Exit full screen' : 'Full screen'}
                className="rounded-full border border-white/15 bg-black/40 p-2.5 text-zinc-200 backdrop-blur-md transition-colors duration-200 hover:bg-white/15 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
              >
                {fullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {flash && <div className="pointer-events-none absolute inset-0 bg-white/80" />}
        </div>
      </div>

      {camNote && <p className="px-6 pb-5 text-sm text-amber-300/90">{camNote}</p>}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  Dashboard                                                           */
/* ------------------------------------------------------------------ */

export default function App() {
  const [sensorData, setSensorData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [online, setOnline] = useState(true);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [muted, setMuted] = useState(false);
  const [mode, setMode] = useState('auto');
  const [events, setEvents] = useState([]);

  const modeRef = useRef(mode);
  const lastLevelRef = useRef('SAFE');
  const lastFlameRef = useRef(false);
  const mutedRef = useRef(muted);

  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => { mutedRef.current = muted; }, [muted]);

  const beep = useCallback(() => {
    if (mutedRef.current) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 660;
      gain.gain.setValueAtTime(0.05, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.45);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.45);
    } catch {
      /* audio is a nicety, never a failure path */
    }
  }, []);

  const pushEvent = useCallback((severity, message, protocol) => {
    setEvents((prev) =>
      [
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          severity,
          message,
          protocol,
        },
        ...prev,
      ].slice(0, MAX_LOG)
    );
  }, []);

  const record = useCallback(
    (data, evaluation) => {
      const level = evaluation.risk_level;

      if (data.flame_detected && !lastFlameRef.current) {
        pushEvent('CRITICAL', `Flame detected in the ${CAMERA_NAME.toLowerCase()}`, 'Evacuate the building');
      }
      lastFlameRef.current = data.flame_detected;

      if (level !== lastLevelRef.current) {
        const rising = SEVERITY_RANK[level] > SEVERITY_RANK[lastLevelRef.current];
        if (level === 'SAFE') {
          pushEvent('SAFE', 'Everything is back to normal', 'No action needed');
        } else if (rising) {
          const cause =
            data.gas_level > 400 ? `Gas level reached ${data.gas_level} ppm`
            : data.temperature > 45 ? `Temperature reached ${data.temperature} °C`
            : 'Several readings drifted out of range';
          pushEvent(level, cause, friendlyAction(evaluation.recommended_action));
          if (level === 'CRITICAL') beep();
        }
        lastLevelRef.current = level;
      }
    },
    [pushEvent, beep]
  );

  const fetchData = useCallback(async () => {
    try {
      // Fetch latest reading pushed by simulate_sensors.py via FastAPI
      const res = await axios.get(API_URL, { timeout: 1800 });
      const received_data = res.data?.received_data;
      const evaluation = res.data?.evaluation;

      if (received_data && evaluation) {
        setSensorData({ received_data, evaluation });
        setOnline(true);
        record(received_data, evaluation);
      }
    } catch (err) {
      setOnline(false);
    } finally {
      setUpdatedAt(new Date());
      setLoading(false);
    }
  }, [record]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, POLL_MS);
    return () => clearInterval(interval);
  }, [fetchData]);

  const simulate = (next) => {
    setMode(next);
    const labels = {
      fire: 'Fire drill started',
      gas: 'Gas leak drill started',
      safe: 'Reset to a calm baseline',
      auto: 'Back to live sensor readings',
    };
    pushEvent(
      next === 'safe' || next === 'auto' ? 'SAFE' : 'WARNING',
      labels[next],
      'Started by you'
    );
  };

  if (loading || !sensorData) {
    return (
      <div
        className="flex min-h-screen items-center justify-center bg-[#141318] text-zinc-400"
        style={{ fontFamily: "'Plus Jakarta Sans', Inter, system-ui, -apple-system, sans-serif" }}
      >
        <div className="flex flex-col items-center gap-3">
          <House className="sg-motion h-6 w-6 animate-pulse text-emerald-400" />
          <span className="text-sm">Connecting to your home…</span>
        </div>
      </div>
    );
  }

  const { received_data: d, evaluation: ev } = sensorData;
  const sev = SEVERITY[ev.risk_level] || severityOf(ev.risk_score);
  const critical = ev.risk_level === 'CRITICAL';

  const tempColor = d.temperature > 60 ? '#FB7185' : d.temperature > 40 ? '#FB923C' : '#38BDF8';
  const gasColor = d.gas_level > 600 ? '#FB7185' : d.gas_level > 400 ? '#FBBF24' : '#2DD4BF';

  const controls = [
    { key: 'fire', label: 'Fire drill', icon: Flame },
    { key: 'gas', label: 'Gas leak drill', icon: Wind },
    { key: 'safe', label: 'Reset', icon: RotateCcw },
  ];

  return (
    <div
      className="min-h-screen bg-[#141318] text-zinc-100 antialiased"
      style={{ fontFamily: "'Plus Jakarta Sans', Inter, system-ui, -apple-system, sans-serif" }}
    >
      {/* Warm ambient light, tinted by the current status */}
      <div
        className="pointer-events-none fixed left-1/2 top-[-18rem] h-[36rem] w-[60rem] -translate-x-1/2 rounded-full blur-[140px] transition-all duration-1000"
        style={{ backgroundColor: sev.ring, opacity: critical ? 0.16 : 0.08 }}
      />
      <div
        className="pointer-events-none fixed bottom-[-20rem] right-[-10rem] h-[32rem] w-[32rem] rounded-full blur-[160px]"
        style={{ backgroundColor: '#F59E0B', opacity: 0.05 }}
      />

      <div className="relative mx-auto max-w-6xl px-5 py-10 sm:px-8">
        {/* ---------------- Header ---------------- */}
        <header className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-4">
            <span className={`flex h-12 w-12 items-center justify-center rounded-2xl ${sev.tint}`}>
              <House className="h-5 w-5" />
            </span>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-white">
                {sev.headline}
              </h1>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-zinc-500">
                <span className="flex items-center gap-2">
                  <span className="relative flex h-2 w-2">
                    {online && (
                      <span className="sg-motion absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-70" />
                    )}
                    <span
                      className={`relative inline-flex h-2 w-2 rounded-full ${online ? 'bg-emerald-400' : 'bg-zinc-600'}`}
                    />
                  </span>
                  {online ? 'Sensors connected' : 'Reconnecting to sensors'}
                </span>
                <span className="flex items-center gap-1.5 tabular-nums">
                  <Clock className="h-3.5 w-3.5" />
                  Updated {updatedAt ? updatedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
                </span>
                {mode !== 'auto' && (
                  <Pill className="border-emerald-400/25 bg-emerald-400/10 text-emerald-300">
                    Drill mode
                  </Pill>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {controls.map(({ key, label, icon: Icon }) => {
              const active = mode === key;
              return (
                <button
                  key={key}
                  onClick={() => simulate(active ? 'auto' : key)}
                  className={`flex items-center gap-2 rounded-full border px-4 py-2.5 text-sm font-medium transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60 ${
                    active
                      ? 'border-emerald-400/40 bg-emerald-400/15 text-emerald-200'
                      : 'border-white/10 bg-white/[0.04] text-zinc-300 hover:bg-white/[0.08] hover:text-white'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </button>
              );
            })}
            <button
              onClick={() => setMuted((m) => !m)}
              aria-pressed={muted}
              className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm font-medium text-zinc-300 transition-all duration-200 hover:bg-white/[0.08] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
            >
              {muted ? <BellOff className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
              {muted ? 'Sounds off' : 'Sounds on'}
            </button>
          </div>
        </header>

        {/* ---------------- Live feed + safety score ---------------- */}
        <section className="mt-8 grid grid-cols-1 gap-5 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <LiveFeed
              level={ev.risk_level}
              flame={d.flame_detected}
              motion={d.motion_detected}
              online={online}
              onEvent={pushEvent}
            />
          </div>

          <Card
            className={`flex items-center justify-center p-8 ${critical ? 'border-rose-400/30' : ''}`}
            style={sev.glow ? { boxShadow: sev.glow } : undefined}
          >
            <RiskGauge
              score={ev.risk_score}
              level={ev.risk_level}
              action={ev.recommended_action}
              critical={critical}
            />
          </Card>
        </section>

        {/* ---------------- Sensors ---------------- */}
        <h2 className="mb-4 mt-10 text-sm font-medium text-zinc-500">Around your home</h2>
        <section className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <SensorCard icon={Thermometer} name="Temperature" tint="bg-sky-400/10 text-sky-300">
            <div className="mt-5 flex items-baseline gap-1.5">
              <span className="text-4xl font-semibold tracking-tight tabular-nums">{d.temperature}</span>
              <span className="text-zinc-500">°C</span>
            </div>
            <MetricBar value={d.temperature} max={90} color={tempColor} comfort={[18, 27]} />
            <p className="mt-3 text-sm text-zinc-500">
              {d.temperature > 60 ? 'Dangerously hot' : d.temperature > 40 ? 'Getting hot' : 'Comfortable'}
            </p>
          </SensorCard>

          <SensorCard icon={Wind} name="Air quality" tint="bg-teal-400/10 text-teal-300">
            <div className="mt-5 flex items-baseline gap-1.5">
              <span className="text-4xl font-semibold tracking-tight tabular-nums">{d.gas_level}</span>
              <span className="text-zinc-500">ppm</span>
            </div>
            <MetricBar value={d.gas_level} max={1000} color={gasColor} comfort={[0, 250]} />
            <p className="mt-3 text-sm text-zinc-500">
              {d.gas_level > 600 ? 'Leave and ventilate' : d.gas_level > 400 ? 'Open a window' : 'Air looks clean'}
            </p>
          </SensorCard>

          <SensorCard
            icon={Flame}
            name="Flame sensor"
            tint={d.flame_detected ? 'bg-rose-400/15 text-rose-300' : 'bg-white/[0.06] text-zinc-400'}
            alert={d.flame_detected}
            accent={
              <Pill
                className={d.flame_detected ? SEVERITY.CRITICAL.chip : 'border-white/10 bg-white/[0.05] text-zinc-400'}
                pulse={d.flame_detected}
              >
                {d.flame_detected ? 'Flame detected' : 'Clear'}
              </Pill>
            }
          >
            <p className="mt-6 text-sm leading-relaxed text-zinc-400">
              {d.flame_detected
                ? 'An open flame was picked up. Leave the area and call for help.'
                : 'No sign of fire anywhere in the house.'}
            </p>
          </SensorCard>

          <SensorCard
            icon={Eye}
            name="Motion"
            tint={d.motion_detected ? 'bg-emerald-400/10 text-emerald-300' : 'bg-white/[0.06] text-zinc-400'}
            accent={
              <Pill
                className={
                  d.motion_detected
                    ? 'border-emerald-400/25 bg-emerald-400/10 text-emerald-300'
                    : 'border-white/10 bg-white/[0.05] text-zinc-400'
                }
              >
                {d.motion_detected ? 'Someone home' : 'No movement'}
              </Pill>
            }
          >
            <p className="mt-6 text-sm leading-relaxed text-zinc-400">
              {d.motion_detected
                ? `Movement in the ${CAMERA_NAME.toLowerCase()} just now.`
                : 'The house has been still for a while.'}
            </p>
          </SensorCard>

          <SensorCard icon={Droplets} name="Humidity" tint="bg-sky-400/10 text-sky-300">
            <div className="mt-5 flex items-baseline gap-1.5">
              <span className="text-4xl font-semibold tracking-tight tabular-nums">{d.humidity}</span>
              <span className="text-zinc-500">%</span>
            </div>
            <MetricBar value={d.humidity} max={100} color="#38BDF8" comfort={[30, 60]} />
            <p className="mt-3 text-sm text-zinc-500">
              {d.humidity < 30 ? 'A little dry' : d.humidity > 60 ? 'A little humid' : 'Just right'}
            </p>
          </SensorCard>

          <SensorCard icon={Activity} name="Devices" tint="bg-emerald-400/10 text-emerald-300">
            <div className="mt-5 flex items-baseline gap-1.5">
              <span className="text-4xl font-semibold tracking-tight tabular-nums">6</span>
              <span className="text-zinc-500">connected</span>
            </div>
            <div className="mt-6 flex items-center gap-2 text-sm">
              {online ? (
                <>
                  <Zap className="h-4 w-4 text-emerald-300" />
                  <span className="text-zinc-400">Checking in every {POLL_MS / 1000} seconds</span>
                </>
              ) : (
                <>
                  <WifiOff className="h-4 w-4 text-amber-300" />
                  <span className="text-zinc-400">Trying to reconnect</span>
                </>
              )}
            </div>
          </SensorCard>
        </section>

        {/* ---------------- Activity ---------------- */}
        <section className="mt-10">
          <Card className="overflow-hidden">
            <div className="flex items-center justify-between px-6 py-5">
              <h2 className="text-base font-semibold text-white">Recent activity</h2>
              <span className="text-sm text-zinc-500">
                {events.length ? `${events.length} updates` : 'Nothing yet'}
              </span>
            </div>

            {events.length === 0 ? (
              <p className="px-6 pb-10 pt-4 text-center text-sm text-zinc-500">
                Updates appear here whenever something changes around the house.
              </p>
            ) : (
              <div className="max-h-80 overflow-y-auto">
                <table className="w-full text-left text-sm">
                  <thead className="sticky top-0 bg-zinc-800/80 text-xs font-medium text-zinc-500 backdrop-blur-xl">
                    <tr>
                      <th className="px-6 py-3 font-medium">Time</th>
                      <th className="px-6 py-3 font-medium">Status</th>
                      <th className="px-6 py-3 font-medium">What happened</th>
                      <th className="px-6 py-3 font-medium">What to do</th>
                    </tr>
                  </thead>
                  <tbody>
                    {events.map((e) => {
                      const s = SEVERITY[e.severity] || SEVERITY.SAFE;
                      return (
                        <tr
                          key={e.id}
                          className="border-t border-white/[0.06] transition-colors duration-200 hover:bg-white/[0.03]"
                        >
                          <td className="whitespace-nowrap px-6 py-4 tabular-nums text-zinc-500">{e.time}</td>
                          <td className="px-6 py-4">
                            <Pill className={s.chip}>
                              <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
                              {s.label}
                            </Pill>
                          </td>
                          <td className="px-6 py-4 text-zinc-200">{e.message}</td>
                          <td className="px-6 py-4 text-zinc-500">{e.protocol}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </section>

        <footer className="mt-8 pb-4 text-sm text-zinc-600">
          SmartGuard AI · watching over your home
        </footer>
      </div>
    </div>
  );
}
