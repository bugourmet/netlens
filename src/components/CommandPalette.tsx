import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { AppWindow, Building2, Compass, Flag, Globe2, Keyboard, Search, type LucideIcon } from 'lucide-react';
import { apps, countries, flows, providers } from '../data/catalog';
import { useApp, type View } from '../state/store';

interface Item {
  id: string;
  label: string;
  hint: string;
  icon: LucideIcon;
  run: () => void;
}

const viewItems: [View, string, string][] = [
  ['overview', 'Live', '1'],
  ['apps', 'Apps', '2'],
  ['providers', 'Providers', '3'],
  ['connections', 'Connections', '4'],
  ['activity', 'Activity', '5'],
  ['settings', 'Settings', ','],
];

const state = () => useApp.getState();

/** Everything searchable, read from the registries at the moment the dialog opens. */
function buildItems(): Item[] {
  return [
      ...Object.values(apps).map((a) => ({ id: `a-${a.id}`, label: a.name, hint: `App · ${a.exe}`, icon: AppWindow, run: () => state().select({ type: 'app', id: a.id }) })),
      ...Object.values(providers).map((p) => ({ id: `p-${p.id}`, label: p.name, hint: `Provider · ${p.asn}`, icon: Building2, run: () => state().select({ type: 'provider', id: p.id }) })),
      ...countries().map((c) => ({ id: `c-${c.id}`, label: c.name, hint: 'Country', icon: Flag, run: () => state().select({ type: 'country', id: c.id }) })),
      ...[...new Map(flows.filter(Boolean).map((f) => [f.domain, f])).values()].map((f) => ({
        id: `d-${f.domain}`,
        label: f.domain,
        hint: `Domain · ${providers[f.providerId]?.name ?? ''}`,
        icon: Globe2,
        run: () => state().select({ type: 'provider', id: f.providerId }),
      })),
      ...viewItems.map(([v, label, key]) => ({ id: `v-${v}`, label: `Go to ${label}`, hint: `Page · ${key}`, icon: Compass, run: () => state().setView(v) })),
      { id: 'x-help', label: 'Keyboard shortcuts', hint: '?', icon: Keyboard, run: () => state().setHelp(true) },
  ];
}

export function CommandPalette() {
  const open = useApp((s) => s.palette);
  return <AnimatePresence>{open && <PaletteDialog key="palette" />}</AnimatePresence>;
}

/** Mounted only while open, so each opening starts with an empty query. */
function PaletteDialog() {
  const setOpen = useApp((s) => s.setPalette);
  const [items] = useState(buildItems);
  const [q, setQ] = useState('');
  const [cursor, setCursor] = useState(0);

  const results = useMemo(() => {
    const n = q.trim().toLowerCase();
    const hits = n ? items.filter((i) => `${i.label} ${i.hint}`.toLowerCase().includes(n)) : items.filter((i) => !i.id.startsWith('d-'));
    return hits.slice(0, 9);
  }, [q, items]);

  const run = (i?: Item) => {
    if (!i) return;
    i.run();
    setOpen(false);
  };

  return (
        <motion.div className="palette-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setOpen(false)}>
          <motion.div
            className="palette"
            role="dialog"
            aria-label="Search"
            initial={{ opacity: 0, y: -14, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -14, scale: 0.98 }}
            onClick={(e) => e.stopPropagation()}
          >
            <label className="palette-input">
              <Search size={17} />
              <input
                autoFocus
                value={q}
                placeholder="Search apps, providers, domains, countries"
                aria-label="Search"
                role="combobox"
                aria-expanded="true"
                aria-controls="palette-results"
                aria-activedescendant={results[cursor] ? `palette-${cursor}` : undefined}
                onChange={(e) => {
                  setQ(e.target.value);
                  setCursor(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setCursor((c) => Math.min(results.length - 1, c + 1));
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setCursor((c) => Math.max(0, c - 1));
                  } else if (e.key === 'Enter') {
                    run(results[cursor]);
                  }
                }}
              />
            </label>
            <ul className="palette-list" id="palette-results" role="listbox" aria-label="Results">
              {results.map((r, i) => (
                <li key={r.id} id={`palette-${i}`} role="option" aria-selected={i === cursor}>
                  <button className={i === cursor ? 'on' : ''} tabIndex={-1} onPointerMove={() => setCursor(i)} onClick={() => run(r)}>
                    <r.icon size={15} />
                    <span>{r.label}</span>
                    <small>{r.hint}</small>
                  </button>
                </li>
              ))}
              {results.length === 0 && <li className="empty">No matches.</li>}
            </ul>
          </motion.div>
        </motion.div>
  );
}
