import { useEffect } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ShieldCheck } from 'lucide-react';
import { requestStart } from '../data/source';
import type { CaptureState } from '../data/types';
import { useApp } from '../state/store';
import { useSettings } from '../state/settings';

const COPY: Partial<Record<CaptureState, { title: string; body: string; primary?: string; limited?: boolean }>> = {
  'needs-start': {
    title: 'Start watching your traffic',
    body: 'NetLens reads which apps connect where from Windows network events. That needs admin rights, so Windows will ask. Nothing leaves this device.',
    primary: 'Start with admin',
    limited: true,
  },
  declined: {
    title: 'Admin was declined',
    body: 'Without admin, limited mode still lists open connections, but not traffic amounts, UDP or domain names.',
    primary: 'Try again',
    limited: true,
  },
  lost: {
    title: 'Capture stopped',
    body: 'The capture helper closed. What was recorded so far is still here.',
    primary: 'Restart capture',
  },
  denied: {
    title: "Capture couldn't start",
    body: 'The capture helper is missing or was blocked, for example by antivirus. Reinstalling NetLens usually fixes this.',
    primary: 'Try again',
  },
  conflict: {
    title: 'Capture is busy',
    body: 'Another copy of NetLens is already capturing, possibly an older version. Close it, then try again.',
    primary: 'Try again',
  },
  incompatible: {
    title: 'Restart needed',
    body: 'The running capture helper is from a different version of NetLens. Close NetLens fully and open it again.',
  },
};

/** Explains capture before Windows asks for admin, and offers recovery when it stops. */
export function CaptureGate() {
  const status = useApp((s) => s.status);
  const autoStart = useSettings((s) => s.autoStart);
  const captureMode = useSettings((s) => s.captureMode);
  const set = useSettings((s) => s.set);
  const copy = status.kind === 'live' && status.control ? COPY[status.state] : undefined;

  // After the first explicit start, later launches start straight away.
  useEffect(() => {
    if (status.control && status.state === 'needs-start' && autoStart) requestStart(captureMode);
  }, [status.control, status.state, autoStart, captureMode]);

  const start = (mode: 'full' | 'limited') => {
    set('captureMode', mode);
    set('autoStart', true);
    requestStart(mode);
  };
  const waitingForAutoStart = status.state === 'needs-start' && autoStart;

  return (
    <AnimatePresence>
      {copy && !waitingForAutoStart && (
        <motion.section
          key={status.state}
          className="gate glass"
          role="dialog"
          aria-labelledby="gate-title"
          initial={{ opacity: 0, y: 18, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12, scale: 0.98 }}
        >
          <ShieldCheck size={22} className="gate-icon" aria-hidden />
          <h2 id="gate-title">{copy.title}</h2>
          <p>{copy.body}</p>
          <div className="gate-actions">
            {copy.primary && (
              <button className="btn btn-primary" autoFocus onClick={() => start(status.state === 'lost' ? captureMode : 'full')}>
                {copy.primary}
              </button>
            )}
            {copy.limited && <button className="btn" onClick={() => start('limited')}>Use limited mode</button>}
          </div>
        </motion.section>
      )}
    </AnimatePresence>
  );
}
