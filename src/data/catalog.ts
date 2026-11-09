import type { AppInfo, FlowDef, Place, ProviderInfo } from './types';

// Registries filled by the active source (live capture or demo). Grow over time.
export const apps: Record<string, AppInfo> = {};
export const providers: Record<string, ProviderInfo> = {};
export const places: Record<string, Place> = {};
export const flows: FlowDef[] = [];
export const home = { lat: 48, lng: 14, label: '' };
export const systemHome = { ...home }; // from the OS; `home` may be overridden in Settings

export function setSystemHome(h: { lat: number; lng: number; label: string }) {
  Object.assign(systemHome, h);
  Object.assign(home, h);
}

export function clearRegistries() {
  for (const r of [apps, providers, places]) for (const k of Object.keys(r)) delete r[k];
  flows.length = 0;
}

export const countries = () =>
  [...new Map(Object.values(places).filter((p) => p.lat !== null).map((p) => [p.cc, p.country])).entries()].map(([id, name]) => ({ id, name }));

export const placeLabel = (p: Place | undefined) => (!p ? 'Unknown' : p.city ? `${p.city}, ${p.cc}` : p.country);

/** Status notes the capture helper attaches to apps. Must match AppNotes in native/NetLens.Core/Protocol.cs. */
export const APP_NOTES = { checkingSignature: 'Checking signature', pathUnavailable: 'Path unavailable' } as const;
const STATUS_NOTES: readonly string[] = Object.values(APP_NOTES);

/** Notes about trust (like "Runs from a Temp folder"), without the status ones. */
export const trustNotes = (app: AppInfo) => app.notes.filter((n) => !STATUS_NOTES.includes(n));

export function publisherLabel(app: AppInfo) {
  if (app.publisher) return app.publisher;
  if (app.notes.includes(APP_NOTES.checkingSignature)) return 'Checking signature';
  if (app.notes.includes(APP_NOTES.pathUnavailable)) return 'Signature unknown';
  return 'Unsigned';
}
