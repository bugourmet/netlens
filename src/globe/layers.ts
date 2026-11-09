import { apps, home, placeLabel, places, providers } from '../data/catalog';
import type { Frame } from '../data/types';
import { esc, fmtBytes, fmtRate } from '../ui/format';

// Turns a frame of traffic into the globe's layers: arcs, light bars and tags. Pure data, no rendering.

/** One provider at one place. Drawn twice: a faint permanent path and a moving comet while traffic flows. */
export interface ArcDatum {
  key: string;
  kind: 'path' | 'comet';
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
  rate: number;
  total: number;
  flagged: boolean;
  providerId: string;
  placeId: string;
  appNames: string[];
  level: number; // 0 quiet, 1-3 by speed
}

export interface BarDatum {
  id: string;
  lat: number;
  lng: number;
  height: number;
  radius: number;
  color: string;
  label: string; // HTML, escaped
  providerId?: string;
  flagged: boolean;
}

export interface TagDatum {
  placeId: string;
  providerId: string;
  rate: number;
  flagged: boolean;
}

export const COLORS = { flagged: '#ff5c6c', bar: '#7cf2e6', home: '#ffffff' } as const;

const levelOf = (rate: number) => (rate > 1024 * 1024 ? 3 : rate > 100 * 1024 ? 2 : rate > 0 ? 1 : 0);

/**
 * Busiest arcs first, flagged always kept. The cache keeps object identity between frames,
 * which lets the globe update arcs in place instead of rebuilding them.
 */
export function buildArcs(frame: Frame, focused: boolean, limit: number, cache: Map<string, [ArcDatum, ArcDatum]>): ArcDatum[] {
  const seen = new Map<string, ArcDatum>();
  for (const v of frame.flows) {
    const rate = v.down + v.up;
    const flagged = !!apps[v.def.appId]?.flagged;
    if (rate === 0 && !focused && !flagged) continue;
    const place = places[v.def.placeId];
    if (place?.lat == null || place.lng == null) continue;
    if (Math.abs(place.lat - home.lat) + Math.abs(place.lng - home.lng) < 0.5) continue; // same spot: no arc to draw
    const key = `${v.def.providerId}|${v.def.placeId}`;
    let comet = seen.get(key);
    if (!comet) {
      let pair = cache.get(key);
      if (!pair) {
        const base = { key, startLat: home.lat, startLng: home.lng, endLat: place.lat, endLng: place.lng, rate: 0, total: 0, flagged: false, providerId: v.def.providerId, placeId: v.def.placeId, appNames: [], level: 0 };
        pair = [{ ...base, kind: 'path' }, { ...base, kind: 'comet', appNames: [] }];
        cache.set(key, pair);
      }
      comet = pair[1];
      Object.assign(comet, { rate: 0, total: 0, flagged: false, appNames: [] });
      seen.set(key, comet);
    }
    comet.rate += rate;
    comet.total += v.totalDown + v.totalUp;
    comet.flagged ||= flagged;
    const appName = apps[v.def.appId]?.name ?? v.def.appId;
    if (!comet.appNames.includes(appName)) comet.appNames.push(appName);
  }

  const ranked = [...seen.values()].sort((x, y) => Number(y.flagged) - Number(x.flagged) || y.rate - x.rate).slice(0, limit);
  const out: ArcDatum[] = [];
  for (const comet of ranked) {
    comet.level = levelOf(comet.rate);
    const path = cache.get(comet.key)![0];
    Object.assign(path, { rate: comet.rate, total: comet.total, flagged: comet.flagged, appNames: comet.appNames, level: comet.level });
    out.push(path);
    if (comet.level > 0) out.push(comet);
  }
  return out;
}

export const arcLabel = (a: ArcDatum) =>
  `<div class="globe-tip"><b>${esc(providers[a.providerId]?.name ?? '')}</b><span>${esc(placeLabel(places[a.placeId]))}, approximate</span><span>${esc(a.appNames.join(', '))}</span><span class="mono">${esc(fmtRate(a.rate))} · ${esc(fmtBytes(a.total))}</span></div>`;

/** A light bar per place, its height on a log scale of current speed. */
export function buildBars(arcs: ArcDatum[]): BarDatum[] {
  const byPlace = groupByPlace(arcs);
  const maxRate = Math.max(1, ...[...byPlace.values()].map((list) => sum(list)));
  const bars: BarDatum[] = [...byPlace.entries()].map(([placeId, list]) => {
    const p = places[placeId];
    const rate = sum(list);
    const flagged = list.some((a) => a.flagged);
    return {
      id: placeId,
      lat: p.lat!,
      lng: p.lng!,
      height: 0.004 + (Math.log10(1 + rate) / Math.log10(1 + maxRate)) * 0.05 * (rate > 0 ? 1 : 0.1),
      radius: 0.11,
      color: flagged ? COLORS.flagged : COLORS.bar,
      label: `<div class="globe-tip"><b>${esc(placeLabel(p))}</b><span>${esc(list.map((a) => providers[a.providerId]?.name ?? '').join(', '))}</span><span class="mono">${esc(fmtRate(rate))}</span></div>`,
      providerId: busiest(list).providerId,
      flagged,
    };
  });
  const homeBar: BarDatum = {
    id: 'home', lat: home.lat, lng: home.lng, height: 0.018, radius: 0.22, color: COLORS.home, flagged: false,
    label: `<div class="globe-tip"><b>This device</b><span>${esc(home.label)}</span></div>`,
  };
  return [homeBar, ...bars];
}

/** Tags for the busiest places and anything flagged, skipping any that would sit on top of one already chosen. */
export function pickTags(arcs: ArcDatum[], max: number): TagDatum[] {
  const candidates = [...groupByPlace(arcs).entries()]
    .map(([placeId, list]) => ({ placeId, providerId: busiest(list).providerId, rate: sum(list), flagged: list.some((a) => a.flagged) }))
    .filter((t) => t.flagged || t.rate > 0)
    .sort((x, y) => Number(y.flagged) - Number(x.flagged) || y.rate - x.rate);
  const kept: TagDatum[] = [];
  for (const t of candidates) {
    if (kept.length >= max) break;
    const p = places[t.placeId];
    if (kept.every((k) => Math.hypot(places[k.placeId].lat! - p.lat!, places[k.placeId].lng! - p.lng!) > 16)) kept.push(t);
  }
  return kept;
}

// Comets carry the current numbers; a quiet arc has only its path.
function groupByPlace(arcs: ArcDatum[]) {
  const byPlace = new Map<string, ArcDatum[]>();
  for (const a of arcs) {
    if (a.kind === 'path' && a.level > 0) continue;
    byPlace.set(a.placeId, [...(byPlace.get(a.placeId) ?? []), a]);
  }
  return byPlace;
}

const sum = (list: ArcDatum[]) => list.reduce((s, a) => s + a.rate, 0);
const busiest = (list: ArcDatum[]) => list.reduce((best, a) => (a.rate > best.rate ? a : best));
