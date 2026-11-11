import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { AlertOctagon, AlertTriangle, Info, X } from 'lucide-react';
import { engine, useApp } from '../state/store';
import { useSettings } from '../state/settings';
import type { FeedEvent, Severity } from '../data/types';
import { AwaySummary } from './AwaySummary';

const sevMeta: Record<Severity, { label: string; icon: typeof Info }> = {
  info: { label: 'Info', icon: Info },
  warning: { label: 'New', icon: AlertTriangle },
  critical: { label: 'Review', icon: AlertOctagon },
};

export function SeverityBadge({ severity }: { severity: Severity }) {
  const { label, icon: Icon } = sevMeta[severity];
  return (
    <span className={`sev sev-text-${severity}`}>
      <Icon size={13} /> {label}
    </span>
  );
}

export function Notices() {
  const version = useApp((s) => s.version);
  const view = useApp((s) => s.view);
  const stage = useApp((s) => s.stage);
  const awayOpen = useApp((s) => s.awayOpen);
  const dismiss = useApp((s) => s.dismissAway);
  const select = useApp((s) => s.select);
  const seen = useRef(engine.events.length);
  const [toast, setToast] = useState<FeedEvent | null>(null);

  const toasts = useSettings((s) => s.toasts);

  useEffect(() => {
    if (engine.events.length !== seen.current) {
      const last = engine.events[engine.events.length - 1];
      // History replayed on connect shouldn't pop up as new.
      if (toasts && last && engine.events.length > seen.current && Date.now() / 1000 - last.t < 10) setToast(last);
      seen.current = engine.events.length;
    }
  }, [version, toasts]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 8000);
    return () => clearTimeout(id);
  }, [toast]);

  const notice = useApp((s) => s.notice);
  const setNotice = useApp((s) => s.setNotice);
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(null), 8000);
    return () => clearTimeout(id);
  }, [notice, setNotice]);

  return (
    <div className="notices">
      <AnimatePresence>
        {notice && (
          <motion.div key="notice" layout className="notice glass" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 16 }} role="status">
            <SeverityBadge severity="info" />
            <div className="notice-body"><span>{notice}</span></div>
            <button className="icon-btn small" aria-label="Dismiss" onClick={() => setNotice(null)}><X size={14} /></button>
          </motion.div>
        )}
        {toast && (
          <motion.div key="toast" layout className={`notice glass ${toast.severity === 'critical' ? 'alarm' : ''}`} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 16 }} role="status">
            <SeverityBadge severity={toast.severity} />
            <button className="notice-body" onClick={() => { select({ type: 'app', id: toast.appId }); setToast(null); }}>
              <b>{toast.title}</b>
              <span>{toast.detail}</span>
            </button>
            <button className="icon-btn small" aria-label="Dismiss" onClick={() => setToast(null)}><X size={14} /></button>
          </motion.div>
        )}
        {awayOpen && view === 'overview' && stage === 'globe' && engine.awaySummary() && (
          <motion.div key="away" layout className="notice notice-away glass" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 16 }}>
            <button className="icon-btn small notice-close" aria-label="Dismiss summary" onClick={dismiss}><X size={14} /></button>
            <AwaySummary onAction={dismiss} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
