import { useEffect } from 'react';
import { engine, useApp, type View } from '../state/store';

export const SHORTCUTS: { group: string; items: { keys: string[]; label: string }[] }[] = [
  {
    group: 'Everywhere',
    items: [
      { keys: ['Esc'], label: 'Close or go back' },
      { keys: ['Ctrl', 'K'], label: 'Search' },
      { keys: ['/'], label: 'Search, or filter connections' },
      { keys: ['?'], label: 'Show these shortcuts' },
    ],
  },
  {
    group: 'Pages',
    items: [
      { keys: ['1'], label: 'Live' },
      { keys: ['2'], label: 'Apps' },
      { keys: ['3'], label: 'Providers' },
      { keys: ['4'], label: 'Connections' },
      { keys: ['5'], label: 'Activity' },
      { keys: [','], label: 'Settings' },
    ],
  },
  {
    group: 'Live view',
    items: [
      { keys: ['G'], label: 'Switch Globe and Flows' },
      { keys: ['T'], label: 'Switch Apps and Providers list' },
      { keys: ['H'], label: 'Fly back home' },
    ],
  },
  {
    group: 'Timeline',
    items: [
      { keys: ['Space'], label: 'Play or pause replay' },
      { keys: ['←', '→'], label: 'Move 10 seconds' },
      { keys: ['Shift', '←', '→'], label: 'Move 1 minute' },
      { keys: ['L'], label: 'Back to live' },
    ],
  },
  {
    group: 'Lists',
    items: [
      { keys: ['↑', '↓'], label: 'Move through rows' },
      { keys: ['Enter'], label: 'Open the row' },
    ],
  },
];

const PAGES: Record<string, View> = { '1': 'overview', '2': 'apps', '3': 'providers', '4': 'connections', '5': 'activity', ',': 'settings' };

function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  return !!el?.closest?.('input, select, textarea, [contenteditable="true"]');
}

/** Esc peels back one layer at a time, topmost first. */
function escape(target: EventTarget | null) {
  const s = useApp.getState();
  if (s.palette) return s.setPalette(false);
  if (s.help) return s.setHelp(false);
  if (isTyping(target)) return (target as HTMLElement).blur();
  if (s.drawer) return s.closeDrawer();
  if (s.view !== 'overview') return s.closeSheet();
  if (s.focus) return s.select(null);
  if (s.playhead !== null) return s.seek(null);
}

function moveInList(direction: 1 | -1) {
  const { view } = useApp.getState();
  const sheets = document.querySelectorAll<HTMLElement>('.sheet');
  const scope = view === 'overview' ? document.querySelector<HTMLElement>('.side-list') : sheets[sheets.length - 1];
  const rows = [...(scope?.querySelectorAll<HTMLElement>('.row, tbody tr') ?? [])];
  if (!rows.length) return;
  const at = rows.indexOf(document.activeElement as HTMLElement);
  const next = rows[at < 0 ? (direction === 1 ? 0 : rows.length - 1) : Math.min(rows.length - 1, Math.max(0, at + direction))];
  next.focus({ focusVisible: true } as FocusOptions);
  next.scrollIntoView({ block: 'nearest' });
}

export function useHotkeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useApp.getState();

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        return s.setPalette(!s.palette);
      }
      if (e.key === 'Escape') return escape(e.target);
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target) || s.palette) return;

      if (e.key === '?') return s.setHelp(!s.help);
      if (s.help) return;

      const page = PAGES[e.key];
      if (page) return s.setView(page);

      const live = s.view === 'overview';
      const key = e.key.toLowerCase();

      if (e.key === '/') {
        e.preventDefault();
        const filter = s.view === 'connections' ? document.querySelector<HTMLInputElement>('.sheet .field input') : null;
        return filter ? filter.focus() : s.setPalette(true);
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        return moveInList(e.key === 'ArrowDown' ? 1 : -1);
      }
      if (!live) return;

      if (key === 'g') return s.setStage(s.stage === 'globe' ? 'flows' : 'globe');
      if (key === 't') return s.setSideTab(s.sideTab === 'app' ? 'provider' : 'app');
      if (key === 'h') return s.flyHome();
      if (key === 'l') return s.seek(null);

      if (e.key === ' ') {
        // A control reached with the keyboard keeps Space for itself.
        if ((e.target as HTMLElement).matches?.('button:focus-visible')) return;
        e.preventDefault();
        return s.togglePlay();
      }
      if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !(e.target as HTMLElement).closest?.('[role="slider"]')) {
        e.preventDefault();
        const step = (e.shiftKey ? 60 : 10) * (e.key === 'ArrowLeft' ? -1 : 1);
        s.setPlaying(false);
        s.seek((s.playhead ?? engine.now) + step);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
