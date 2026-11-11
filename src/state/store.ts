import { create } from 'zustand';
import { Engine, buildFrame } from '../data/engine';
import type { Focus, Frame, SourceStatus } from '../data/types';
import { useSettings } from './settings';

export const engine = new Engine();

export type View = 'overview' | 'apps' | 'providers' | 'connections' | 'activity' | 'settings';
export type StageMode = 'globe' | 'flows';

interface State {
  version: number;
  status: SourceStatus;
  view: View;
  stage: StageMode;
  focus: Focus | null;
  drawer: boolean;
  playhead: number | null; // null = live
  playing: boolean;
  palette: boolean;
  awayOpen: boolean;
  help: boolean;
  previousView: View;
  sideTab: 'app' | 'provider';
  homeFlights: number; // bumped to send the camera home
  notice: string | null; // short message shown as a toast
  setNotice: (n: string | null) => void;
  setView: (v: View) => void;
  closeSheet: () => void;
  setStage: (s: StageMode) => void;
  setHelp: (h: boolean) => void;
  setSideTab: (t: 'app' | 'provider') => void;
  flyHome: () => void;
  togglePlay: () => void;
  select: (f: Focus | null) => void;
  closeDrawer: () => void;
  seek: (t: number | null) => void;
  setPlaying: (p: boolean) => void;
  setPalette: (p: boolean) => void;
  dismissAway: () => void;
  setStatus: (s: SourceStatus) => void;
  bump: () => void;
}

// Deep links for development and screenshots: ?view=apps&stage=flows&help
const params = new URLSearchParams(location.search);
const VIEWS: readonly View[] = ['overview', 'apps', 'providers', 'connections', 'activity', 'settings'];
const pick = <T extends string>(value: string | null, allowed: readonly T[], fallback: T): T =>
  allowed.includes(value as T) ? (value as T) : fallback;

export const useApp = create<State>((set, get) => ({
  version: 0,
  status: { kind: 'demo', state: 'connecting', limits: [], control: false },
  view: pick(params.get('view'), VIEWS, 'overview'),
  stage: pick(params.get('stage'), ['globe', 'flows'] as const, 'globe'),
  focus: null,
  drawer: false,
  playhead: null,
  playing: false,
  palette: false,
  awayOpen: true,
  help: params.has('help'),
  previousView: 'overview',
  sideTab: 'app',
  homeFlights: 0,
  notice: null,
  setNotice: (notice) => set({ notice }),
  setView: (view) => {
    if (view !== get().view) set({ view, previousView: get().view });
  },
  // Settings returns to where you came from; other pages return to Live.
  closeSheet: () => {
    const { view, previousView } = get();
    get().setView(view === 'settings' ? previousView : 'overview');
  },
  setStage: (stage) => set({ stage }),
  setHelp: (help) => set({ help }),
  setSideTab: (sideTab) => set({ sideTab }),
  flyHome: () => set({ homeFlights: get().homeFlights + 1 }),
  togglePlay: () => {
    const { playing, playhead, seek, setPlaying } = get();
    if (playhead === null) seek(engine.now - 5 * 60);
    setPlaying(!playing);
  },
  select: (focus) => set({ focus, drawer: !!focus && focus.type !== 'country' }),
  closeDrawer: () => set({ drawer: false }),
  seek: (t) => set(t === null || t >= engine.now ? { playhead: null, playing: false } : { playhead: Math.max(t, engine.first) }),
  setPlaying: (playing) => set({ playing }),
  setPalette: (palette) => {
    // Release focus now, so keys work during the fade-out.
    if (!palette) (document.activeElement as HTMLElement | null)?.blur();
    set({ palette });
  },
  dismissAway: () => set({ awayOpen: false }),
  setStatus: (status) => set({ status }),
  bump: () => set({ version: get().version + 1 }),
}));

// Shared by every component that asks, so a frame is built once per tick, not once per panel.
const frameCache: { key: string; frame: Frame | null } = { key: '', frame: null };

function cachedFrame(key: string, playhead: number | null, focus: Focus | null): Frame {
  if (key !== frameCache.key || !frameCache.frame) {
    frameCache.frame = buildFrame(engine, playhead, focus);
    frameCache.key = key;
  }
  return frameCache.frame;
}

/** Current frame, recomputed once per tick / seek / focus / filter change. */
export function useFrame(): Frame {
  const version = useApp((s) => s.version);
  const playhead = useApp((s) => s.playhead);
  const focus = useApp((s) => s.focus);
  const showLocal = useSettings((s) => s.showLocal);
  return cachedFrame(`${version}|${playhead}|${focus?.type}:${focus?.id}|${showLocal}`, playhead, focus);
}
