import type { ReactNode } from 'react';
import { motion } from 'motion/react';
import { X } from 'lucide-react';
import { useApp } from '../state/store';

/** Glass sheet that slides over the planet for pages with lots of data. */
export function Sheet({ title, count, tools, children }: { title: string; count?: number; tools?: ReactNode; children: ReactNode }) {
  const closeSheet = useApp((s) => s.closeSheet);
  return (
    <motion.section
      className="sheet glass"
      initial={{ opacity: 0, x: 60, filter: 'blur(6px)' }}
      animate={{ opacity: 1, x: 0, filter: 'blur(0px)' }}
      exit={{ opacity: 0, x: 40, filter: 'blur(4px)' }}
      transition={{ type: 'spring', stiffness: 240, damping: 30 }}
    >
      <div className="sheet-head">
        <h1>{title}{count !== undefined && <span className="count mono">{count}</span>}</h1>
        <div className="sheet-tools">
          {tools}
          <button className="sheet-close" onClick={closeSheet} aria-label={`Close ${title}`} title="Close (Esc)">
            <kbd className="key">Esc</kbd>
            <X size={15} />
          </button>
        </div>
      </div>
      <div className="sheet-body">{children}</div>
    </motion.section>
  );
}
