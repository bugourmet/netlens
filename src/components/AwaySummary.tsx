import { AlertTriangle, Moon, Play } from 'lucide-react';
import { engine, useApp } from '../state/store';
import { fmtBytes, fmtShortClock } from '../ui/format';

export function AwaySummary({ onAction }: { onAction?: () => void }) {
  const seek = useApp((s) => s.seek);
  const setPlaying = useApp((s) => s.setPlaying);
  const select = useApp((s) => s.select);
  const s = engine.awaySummary();
  if (!s) return null;
  const critical = s.events.find((e) => e.severity === 'critical');

  return (
    <div className="away">
      <div className="away-head">
        <Moon size={15} />
        <b>While you were away</b>
        <small>{fmtShortClock(s.start)} to {fmtShortClock(s.end)}</small>
      </div>
      <div className="away-stats">
        <div><strong>{fmtBytes(s.total)}</strong><span>transferred</span></div>
        <div><strong>{s.apps}</strong><span>apps active</span></div>
        <div><strong>{s.events.length}</strong><span>new {s.events.length === 1 ? 'event' : 'events'}</span></div>
      </div>
      {critical && (
        <button
          className="away-alert"
          onClick={() => {
            select({ type: 'app', id: critical.appId });
            onAction?.();
          }}
        >
          <AlertTriangle size={14} />
          <span>{critical.detail}</span>
        </button>
      )}
      <button
        className="btn btn-primary"
        onClick={() => {
          seek(s.start);
          setPlaying(true);
          onAction?.();
        }}
      >
        <Play size={13} /> Replay this period
      </button>
    </div>
  );
}
