import { motion } from 'motion/react';
import { engine, useApp, useFrame } from '../state/store';
import { fmtClock } from '../ui/format';
import { SeverityBadge } from './Notices';
import { AwaySummary } from './AwaySummary';
import { Sheet } from './Sheet';

export function ActivityPage() {
  const frame = useFrame();
  const select = useApp((s) => s.select);
  const seek = useApp((s) => s.seek);
  const setView = useApp((s) => s.setView);
  const events = engine.events.filter((e) => e.t <= frame.t).toReversed();

  return (
    <Sheet title="Activity" count={events.length}>
      {engine.awaySummary() && (
        <div className="away-inline">
          <AwaySummary />
        </div>
      )}
      {events.length === 0 && <p className="empty">Nothing new yet. New apps and countries show up here.</p>}
      <ul className="feed">
        {events.map((e, i) => (
          <motion.li
            key={`${e.t}${e.appId}${e.title}`}
            className={`feed-item sev-${e.severity}`}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: Math.min(i, 12) * 0.03 }}
          >
            <span className="feed-time mono">{fmtClock(e.t)}</span>
            <div className="feed-body">
              <SeverityBadge severity={e.severity} />
              <b>{e.title}</b>
              <span>{e.detail}</span>
            </div>
            <div className="feed-actions">
              <button className="btn" onClick={() => select({ type: 'app', id: e.appId })}>Inspect</button>
              <button
                className="btn"
                onClick={() => {
                  seek(e.t);
                  setView('overview');
                }}
              >
                Replay
              </button>
            </div>
          </motion.li>
        ))}
      </ul>
    </Sheet>
  );
}
