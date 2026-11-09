import { AnimatePresence, motion } from 'motion/react';
import { X } from 'lucide-react';
import { useApp } from '../state/store';
import { SHORTCUTS } from '../ui/hotkeys';

export function HelpOverlay() {
  const open = useApp((s) => s.help);
  const setHelp = useApp((s) => s.setHelp);
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="palette-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setHelp(false)}>
          <motion.div
            className="help glass"
            role="dialog"
            aria-modal="true"
            aria-label="Keyboard shortcuts"
            initial={{ opacity: 0, y: -14, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -14, scale: 0.98 }}
            onClick={(e) => e.stopPropagation()}
          >
            <header className="help-head">
              <h2>Keyboard shortcuts</h2>
              <button className="icon-btn" aria-label="Close shortcuts" onClick={() => setHelp(false)} autoFocus><X size={16} /></button>
            </header>
            <div className="help-grid">
              {SHORTCUTS.map((g) => (
                <section key={g.group}>
                  <h3>{g.group}</h3>
                  <dl>
                    {g.items.map((i) => (
                      <div key={i.label}>
                        <dt>{i.label}</dt>
                        <dd>{i.keys.map((k) => <kbd key={k} className="key">{k}</kbd>)}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
              ))}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
