import { create } from 'zustand';

export type Quality = 'ultra' | 'balanced' | 'battery';

export interface Settings {
  quality: Quality;
  stars: boolean;
  sunlight: boolean; // real day/night on the globe, else always night
  rotate: boolean;
  rotateSpeed: number;
  arcLimit: number;
  units: 'bytes' | 'bits';
  motion: 'full' | 'reduced';
  toasts: boolean;
  showLocal: boolean;
  homeCc: string; // '' = from the system region
  autoStart: boolean; // start capture at launch without asking again
  captureMode: 'full' | 'limited';
}

const KEY = 'netlens.settings';

export const DEFAULTS: Settings = {
  quality: 'ultra',
  stars: true,
  sunlight: true,
  rotate: true,
  rotateSpeed: 0.3,
  arcLimit: 40,
  units: 'bytes',
  motion: 'full',
  toasts: true,
  showLocal: true,
  homeCc: '',
  autoStart: false,
  captureMode: 'full',
};

const CHOICES: Partial<Record<keyof Settings, readonly unknown[]>> = {
  quality: ['ultra', 'balanced', 'battery'],
  units: ['bytes', 'bits'],
  motion: ['full', 'reduced'],
  captureMode: ['full', 'limited'],
};

const RANGES: Partial<Record<keyof Settings, readonly [number, number]>> = {
  rotateSpeed: [0.05, 1.5],
  arcLimit: [5, 100],
};

/** Keeps only stored values of the right type and range, so an old or edited entry can't break the app. */
export function sanitize(raw: unknown): Settings {
  const out: Settings = { ...DEFAULTS };
  if (!raw || typeof raw !== 'object') return out;
  const stored = raw as Record<string, unknown>;
  for (const key of Object.keys(DEFAULTS) as (keyof Settings)[]) {
    const value = stored[key];
    if (typeof value !== typeof DEFAULTS[key]) continue;
    if (CHOICES[key] && !CHOICES[key].includes(value)) continue;
    const range = RANGES[key];
    if (range && !(typeof value === 'number' && value >= range[0] && value <= range[1])) continue;
    Object.assign(out, { [key]: value });
  }
  return out;
}

function load(): Settings {
  try {
    return sanitize(JSON.parse(localStorage.getItem(KEY) ?? '{}'));
  } catch {
    return { ...DEFAULTS };
  }
}

interface SettingsState extends Settings {
  set: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  reset: () => void;
}

function save(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Not stored, but still applies for this session.
  }
}

const values = (s: SettingsState): Settings => {
  const { set: _set, reset: _reset, ...rest } = s;
  return rest;
};

export const useSettings = create<SettingsState>((set, get) => ({
  ...load(),
  set: (key, value) => {
    set({ [key]: value } as Partial<SettingsState>);
    save(values(get()));
  },
  reset: () => {
    set(DEFAULTS);
    save(DEFAULTS);
  },
}));
