import { useEffect, useEffectEvent, useRef } from 'react';
import { motion, useMotionValueEvent, useSpring } from 'motion/react';
import { useFrame } from '../state/store';
import { useSettings } from '../state/settings';
import { rateParts } from '../ui/format';

const SCALE_MAX = Math.log10(1024 ** 3); // 1 GB/s at the top
const RULER_H = 128;
const position = (rate: number) => RULER_H - (Math.log10(Math.max(1, rate)) / SCALE_MAX) * RULER_H;

const MAJOR = [
  { at: 1024 ** 3, label: 'G' },
  { at: 1024 ** 2, label: 'M' },
  { at: 1024, label: 'K' },
  { at: 1, label: '0' },
];

function Readout({ value, label, tone }: { value: number; label: string; tone: 'down' | 'up' }) {
  const spring = useSpring(value, { stiffness: 90, damping: 22 });
  const num = useRef<HTMLSpanElement>(null);
  const unit = useRef<HTMLSpanElement>(null);
  const units = useSettings((s) => s.units);

  useEffect(() => spring.set(value), [spring, value]);

  // Writes straight to the DOM: the number animates many times a second without re-rendering.
  const write = (v: number) => {
    const [n, u] = rateParts(Math.max(0, v));
    if (num.current) num.current.textContent = n;
    if (unit.current) unit.current.textContent = u;
  };
  useMotionValueEvent(spring, 'change', write);
  const rewrite = useEffectEvent(() => write(spring.get()));
  useEffect(() => rewrite(), [units]); // a units change re-labels the current value

  return (
    <div className={`readout ${tone}`}>
      <div className="readout-value"><span ref={num}>0</span><small ref={unit}>KB/s</small></div>
      <div className="readout-label"><i />{label}</div>
    </div>
  );
}

function Marker({ value, tone }: { value: number; tone: 'down' | 'up' }) {
  const y = useSpring(position(value), { stiffness: 110, damping: 20 });
  useEffect(() => y.set(position(value)), [y, value]);
  return <motion.span className={`ruler-marker ${tone}`} style={{ y }} />;
}

/** Live speed on a log ruler, styled like a physical gauge. */
export function Instrument() {
  const frame = useFrame();
  const ticks = Array.from({ length: 28 });
  return (
    <section className="instrument glass rise" aria-label="Current speed" style={{ animationDelay: '.25s' }}>
      <div className="ruler" aria-hidden>
        {ticks.map((_, i) => <span key={i} className={i % 9 === 0 ? 'tick major' : 'tick'} style={{ top: `${(i / 27) * 100}%` }} />)}
        {MAJOR.map((m) => <em key={m.label} style={{ top: position(m.at) }}>{m.label}</em>)}
        <Marker value={frame.down} tone="down" />
        <Marker value={frame.up} tone="up" />
      </div>
      <div className="readouts">
        <Readout value={frame.down} label="Download" tone="down" />
        <Readout value={frame.up} label="Upload" tone="up" />
      </div>
    </section>
  );
}
