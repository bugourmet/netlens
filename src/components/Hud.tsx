import { AnimatePresence, motion } from 'motion/react';
import { History, Keyboard, Search, Settings2, X } from 'lucide-react';
import { apps, countries, providers } from '../data/catalog';
import { useApp, useFrame, type View } from '../state/store';
import { fmtClock } from '../ui/format';
import type { Focus, SourceStatus } from '../data/types';

export function focusLabel(f: Focus) {
  if (f.type === 'app') return apps[f.id]?.name ?? f.id;
  if (f.type === 'provider') return providers[f.id]?.name ?? f.id;
  return countries().find((c) => c.id === f.id)?.name ?? f.id;
}

function statusBadge(s: SourceStatus): { text: string; title: string; tone: string } {
  if (s.kind === 'demo') return { text: 'Demo data', title: 'Fake traffic for trying the UI', tone: 'idle' };
  switch (s.state) {
    case 'connecting':
      return { text: 'Connecting', title: 'Waiting for the capture helper', tone: 'idle' };
    case 'needs-start':
      return { text: 'Not capturing', title: 'Capture hasn’t been started', tone: 'idle' };
    case 'declined':
      return { text: 'Not capturing', title: 'Admin was declined', tone: 'warn' };
    case 'lost':
      return { text: 'Capture stopped', title: 'The capture helper is not running. Showing what was recorded.', tone: 'bad' };
    case 'denied':
    case 'conflict':
      return { text: 'Capture off', title: 'The capture helper could not start.', tone: 'bad' };
    case 'incompatible':
      return { text: 'Restart needed', title: 'The capture helper is from a different version.', tone: 'bad' };
    case 'limited':
      return { text: 'Limited', title: 'Running without admin. Shows open TCP connections, but no traffic amounts, UDP or domain names.', tone: 'warn' };
    default:
      return s.limits.includes('no-geo')
        ? { text: 'No IP database', title: 'Providers and countries are limited. Run tools/get-geodata.ps1.', tone: 'warn' }
        : { text: 'Capturing', title: 'Reading live traffic from Windows', tone: 'good' };
  }
}

const items: { id: View; label: string }[] = [
  { id: 'overview', label: 'Live' },
  { id: 'apps', label: 'Apps' },
  { id: 'providers', label: 'Providers' },
  { id: 'connections', label: 'Connections' },
  { id: 'activity', label: 'Activity' },
];

export function Hud() {
  const frame = useFrame();
  const view = useApp((s) => s.view);
  const setView = useApp((s) => s.setView);
  const focus = useApp((s) => s.focus);
  const select = useApp((s) => s.select);
  const seek = useApp((s) => s.seek);
  const setPalette = useApp((s) => s.setPalette);
  const setHelp = useApp((s) => s.setHelp);
  const badge = statusBadge(useApp((s) => s.status));

  return (
    <header className="hud rise">
      <button className="brand" onClick={() => setView('overview')} aria-label="NetLens, go to Live" title="Live (1)">
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden>
          <circle cx="12" cy="12" r="10.25" fill="none" stroke="currentColor" strokeWidth="1" opacity=".45" />
          <path d="M1.75 12a10.25 4 0 0 0 20.5 0" fill="none" stroke="currentColor" strokeWidth="1" opacity=".45" />
          <path d="M3.5 6.2C8 9 15 9.5 20 5" fill="none" stroke="var(--glow)" strokeWidth="1.4" strokeLinecap="round" />
          <circle cx="20" cy="5" r="1.7" fill="var(--glow)" />
        </svg>
        <span>netlens</span>
      </button>

      <nav className="nav" aria-label="Main">
        {items.map((i, n) => (
          <button key={i.id} className={view === i.id ? 'on' : ''} onClick={() => setView(i.id)} aria-current={view === i.id ? 'page' : undefined} title={`${i.label} (${n + 1})`}>
            {i.label}
            {view === i.id && <motion.span layoutId="nav-mark" className="nav-mark" />}
          </button>
        ))}
      </nav>

      <div className="hud-right">
        <AnimatePresence>
          {focus && (
            <motion.button key="focus" className="chip chip-focus" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 10 }} onClick={() => select(null)} aria-label={`Clear filter ${focusLabel(focus)}`}>
              <span className="chip-text">{focusLabel(focus)}</span>
              <X size={12} />
            </motion.button>
          )}
          {!frame.live && (
            <motion.button key="replay" className="chip chip-replay" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 10 }} onClick={() => seek(null)}>
              <History size={12} />
              <span className="mono">{fmtClock(frame.t)}</span>
              <b>Back to live</b>
            </motion.button>
          )}
        </AnimatePresence>
        <span className={`status ${badge.tone}`} title={badge.title}><i />{badge.text}</span>
        <button className="ghost-btn" onClick={() => setPalette(true)} aria-label="Search">
          <Search size={15} />
          <kbd>Ctrl K</kbd>
        </button>
        <button className="ghost-btn hide-touch" onClick={() => setHelp(true)} aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)">
          <Keyboard size={15} />
        </button>
        <button className={`ghost-btn ${view === 'settings' ? 'on' : ''}`} onClick={() => setView('settings')} aria-label="Settings" title="Settings (,)">
          <Settings2 size={15} />
        </button>
      </div>
    </header>
  );
}
