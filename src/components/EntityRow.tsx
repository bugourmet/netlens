import { motion } from 'motion/react';
import { AlertTriangle } from 'lucide-react';
import { apps, providers, publisherLabel } from '../data/catalog';
import { useApp } from '../state/store';
import type { Aggregate } from '../data/types';
import { fmtBytes, fmtRate } from '../ui/format';

export function EntityRow({ kind, row, max, wide }: { kind: 'app' | 'provider'; row: Aggregate; max: number; wide?: boolean }) {
  const focus = useApp((s) => s.focus);
  const select = useApp((s) => s.select);
  const name = (kind === 'app' ? apps[row.id]?.name : providers[row.id]?.name) ?? row.id;
  const sub = kind === 'app' ? (apps[row.id] ? publisherLabel(apps[row.id]) : '') : (providers[row.id]?.category ?? '');
  const selected = focus?.type === kind && focus.id === row.id;
  const rate = row.down + row.up;

  return (
    <motion.button
      layout="position"
      className={`row ${selected ? 'selected' : ''} ${wide ? 'row-wide' : ''} ${row.flagged ? 'flagged' : ''} ${rate > 0 ? 'live' : ''}`}
      onClick={() => select(selected ? null : { type: kind, id: row.id })}
      aria-pressed={selected}
      whileTap={{ scale: 0.985 }}
    >
      <span className="row-main">
        <span className="row-name">
          <span className="row-name-text">{name}</span>
          {row.flagged && <span className="flag-label"><AlertTriangle size={11} /> Review</span>}
        </span>
        <span className="row-sub">{sub}</span>
      </span>
      {wide ? (
        <>
          <span className="num col-a">{row.active}/{row.flows}</span>
          <span className="num col-b">{fmtRate(row.down)}</span>
          <span className="num col-b">{fmtRate(row.up)}</span>
          <span className="num strong">{fmtBytes(row.total)}</span>
        </>
      ) : (
        <span className="row-right">
          <span className="num strong">{fmtBytes(row.total)}</span>
          <span className="num row-rate">{rate > 0 ? fmtRate(rate) : 'quiet'}</span>
        </span>
      )}
      <span className="row-bar" aria-hidden>
        <span style={{ transform: `scaleX(${Math.max(0.012, row.total / max)})` }} />
      </span>
    </motion.button>
  );
}
