import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { Pause, Play } from 'lucide-react';
import { WINDOW_S, matchesFocus, series } from '../data/engine';
import { flows } from '../data/catalog';
import { engine, useApp, useFrame } from '../state/store';
import { fmtClock, fmtRate, fmtShortClock, useSize } from '../ui/format';

const HEIGHT = 58;
const PAD_TOP = 14;

export function Timeline() {
  const [ref, size] = useSize<HTMLDivElement>();
  const version = useApp((s) => s.version);
  const focus = useApp((s) => s.focus);
  const playing = useApp((s) => s.playing);
  const setPlaying = useApp((s) => s.setPlaying);
  const togglePlay = useApp((s) => s.togglePlay);
  const seek = useApp((s) => s.seek);
  const frame = useFrame();
  const [hover, setHover] = useState<number | null>(null);
  const dragging = useRef(false);

  const w = Math.max(1, size.w);
  const first = engine.first;
  const span = engine.now - first || 1;
  const xOf = (t: number) => ((t - first) / span) * w;

  // The engine is mutable and `version` marks each change to it, so it is the real dependency.
  const chart = useMemo(() => {
    void version;
    const { down, up } = series(engine, focus, Math.floor(w / 3));
    const max = Math.max(1, ...down, ...up);
    const toPath = (v: Float64Array) => {
      let d = '';
      v.forEach((y, i) => {
        d += `${i ? 'L' : 'M'}${((i / Math.max(1, v.length - 1)) * w).toFixed(1)} ${(HEIGHT - 1 - (y / max) * (HEIGHT - PAD_TOP - 2)).toFixed(1)}`;
      });
      return d;
    };
    return { down: toPath(down), up: toPath(up) };
  }, [version, focus, w]);

  // Events for apps (and providers) that the focus covers. One pass over flows, not one per event.
  const events = useMemo(() => {
    void version;
    if (!focus) return engine.events.filter((e) => e.t >= first);
    const appsInFocus = new Set<string>();
    const pairsInFocus = new Set<string>();
    flows.forEach((f) => {
      if (!matchesFocus(f, focus)) return;
      appsInFocus.add(f.appId);
      pairsInFocus.add(`${f.appId}|${f.providerId}`);
    });
    return engine.events.filter((e) => e.t >= first && (e.providerId ? pairsInFocus.has(`${e.appId}|${e.providerId}`) : appsInFocus.has(e.appId)));
  }, [version, focus, first]);
  const idle = engine.idle && engine.idle.end > first ? engine.idle : null;

  const tFromX = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    return Math.round(first + (Math.max(0, Math.min(r.width, clientX - r.left)) / r.width) * span);
  };
  const onDown = (e: PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    dragging.current = true;
    setPlaying(false);
    seek(tFromX(e.clientX));
  };
  const onMove = (e: PointerEvent) => {
    const t = tFromX(e.clientX);
    setHover(t);
    if (dragging.current) seek(t);
  };
  const onKey = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 60 : 10;
    if (e.key === 'ArrowLeft') seek((frame.t ?? engine.now) - step);
    else if (e.key === 'ArrowRight') seek(frame.t + step);
    else if (e.key === 'End') seek(null);
    else return;
    e.preventDefault();
    setPlaying(false);
  };

  const hoverIdx = hover === null ? null : engine.indexOf(hover);
  const hoverRates = useMemo(() => {
    if (hoverIdx === null) return null;
    const s = engine.samples[hoverIdx];
    let d = 0;
    let u = 0;
    for (let j = 0; j < s.ids.length; j++) {
      const f = flows[s.ids[j]];
      if (f && matchesFocus(f, focus)) {
        d += s.down[j];
        u += s.up[j];
      }
    }
    return { d, u, t: s.t };
  }, [hoverIdx, focus]);

  const playheadX = xOf(frame.t);

  return (
    <section className="timeline glass rise" aria-label="Timeline" style={{ animationDelay: '.45s' }}>
      <div className="tl-controls">
        <button
          className="icon-btn"
          aria-label={playing ? 'Pause replay' : 'Play replay at 8x'}
          title={`${playing ? 'Pause' : 'Play'} replay (Space)`}
          onClick={togglePlay}
        >
          {playing ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <button className={`live-btn ${frame.live ? 'on' : ''}`} onClick={() => seek(null)} aria-pressed={frame.live} title="Back to live (L)">
          <span className="live-dot" />
          Live
        </button>
      </div>

      <div
        ref={ref}
        className="tl-track"
        role="slider"
        tabIndex={0}
        aria-label="Time position"
        aria-valuemin={first}
        aria-valuemax={engine.now}
        aria-valuenow={frame.t}
        aria-valuetext={frame.live ? 'Live' : fmtClock(frame.t)}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={() => (dragging.current = false)}
        onPointerLeave={() => setHover(null)}
        onKeyDown={onKey}
      >
        <svg width={w} height={HEIGHT} aria-hidden>
          <defs>
            <linearGradient id="tl-down" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="var(--down)" stopOpacity=".28" />
              <stop offset="1" stopColor="var(--down)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {idle && (
            <>
              <rect x={xOf(Math.max(idle.start, first))} y={0} width={xOf(idle.end) - xOf(Math.max(idle.start, first))} height={HEIGHT} className="tl-idle" />
              <text x={xOf(Math.max(idle.start, first)) + 6} y={10} className="tl-idle-label">PC idle</text>
            </>
          )}
          <line x1={0} x2={w} y1={HEIGHT - 0.5} y2={HEIGHT - 0.5} className="tl-base" />
          <path d={`${chart.down} L${w} ${HEIGHT} L0 ${HEIGHT} Z`} fill="url(#tl-down)" />
          <path d={chart.down} className="tl-line glow" stroke="var(--down)" />
          <path d={chart.up} className="tl-line glow" stroke="var(--up)" />
          {events.map((e) => (
            <circle key={`${e.t}${e.appId}`} cx={xOf(e.t)} cy={7} r={4} className={`tl-event sev-${e.severity}`} />
          ))}
          {!frame.live && <line x1={playheadX} x2={playheadX} y1={0} y2={HEIGHT} className="tl-playhead" />}
          {hover !== null && <line x1={xOf(hover)} x2={xOf(hover)} y1={0} y2={HEIGHT} className="tl-cross" />}
        </svg>
        {!frame.live && <span className="tl-handle" style={{ left: playheadX }} />}
        {hoverRates && (
          <div className="tl-tip" style={{ left: Math.min(w - 170, Math.max(0, xOf(hoverRates.t) - 85)) }}>
            <b>{fmtClock(hoverRates.t)}</b>
            <span><i className="dot bg-down" />{fmtRate(hoverRates.d)}</span>
            <span><i className="dot bg-up" />{fmtRate(hoverRates.u)}</span>
          </div>
        )}
        <div className="tl-axis">
          <span>{fmtShortClock(first)}</span>
          <span className="tl-legend">
            <i className="dot bg-down" />Download <i className="dot bg-up" />Upload
          </span>
          <span>Up to {Math.round(WINDOW_S / 60)} min history · now {fmtShortClock(engine.now)}</span>
        </div>
      </div>
    </section>
  );
}
