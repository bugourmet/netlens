import { apps, flows, places } from './catalog';
import { useSettings } from '../state/settings';
import type { Aggregate, FeedEvent, FlowDef, Focus, Frame, FlowView, Idle, Sample } from './types';

export const WINDOW_S = 30 * 60;

/** Rolling history that sources push into, one sample per second. */
export class Engine {
  samples: Sample[] = [{ t: Math.floor(Date.now() / 1000), ids: [], down: [], up: [] }];
  events: FeedEvent[] = [];
  idle: Idle | null = null;
  private away: { key: string; value: ReturnType<Engine['computeAway']> } | null = null;

  /** Adds the next second. A sample for a second already recorded is ignored rather than counted twice. */
  push(sample: Sample) {
    if (this.samples.length && sample.t <= this.now) return;
    this.samples.push(sample);
    while (this.samples.length > WINDOW_S) this.samples.shift();
  }

  reset(samples: Sample[]) {
    this.samples = samples.length ? samples : [{ t: Math.floor(Date.now() / 1000), ids: [], down: [], up: [] }];
    this.events = [];
    this.idle = null;
  }

  get now() {
    return this.samples[this.samples.length - 1].t;
  }

  get first() {
    return this.samples[0].t;
  }

  /** History can have gaps if capture stalled, so search rather than subtract. */
  indexOf(t: number) {
    let lo = 0;
    let hi = this.samples.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.samples[mid].t <= t) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  /** What happened during the last idle period, if it's still in history. Cached: several panels ask every tick. */
  awaySummary() {
    const key = this.idle ? `${this.idle.start}|${this.idle.end}|${this.first}|${this.events.length}` : '';
    if (this.away?.key !== key) this.away = { key, value: this.computeAway() };
    return this.away.value;
  }

  private computeAway() {
    if (!this.idle || this.idle.end <= this.first) return null;
    const { start, end } = this.idle;
    const appIds = new Set<string>();
    let total = 0;
    for (const s of this.samples) {
      if (s.t < start || s.t > end) continue;
      for (let j = 0; j < s.ids.length; j++) {
        total += s.down[j] + s.up[j];
        const f = flows[s.ids[j]];
        if (f) appIds.add(f.appId);
      }
    }
    return { start, end, total, apps: appIds.size, events: this.events.filter((e) => e.t >= start && e.t <= end) };
  }
}

export function matchesFocus(f: FlowDef, focus: Focus | null) {
  if (!focus) return true;
  if (focus.type === 'app') return f.appId === focus.id;
  if (focus.type === 'provider') return f.providerId === focus.id;
  return places[f.placeId]?.cc === focus.id;
}

function aggregate(views: FlowView[], key: (f: FlowDef) => string, flagged: (f: FlowDef) => boolean): Aggregate[] {
  const map = new Map<string, Aggregate>();
  for (const v of views) {
    const id = key(v.def);
    const a = map.get(id) ?? { id, down: 0, up: 0, total: 0, flows: 0, active: 0, flagged: false };
    a.down += v.down;
    a.up += v.up;
    a.total += v.totalDown + v.totalUp;
    a.flows++;
    if (v.down + v.up > 0) a.active++;
    a.flagged ||= flagged(v.def);
    map.set(id, a);
  }
  return [...map.values()].sort((x, y) => Number(y.flagged) - Number(x.flagged) || y.total - x.total);
}

const isFlagged = (f: FlowDef) => !!apps[f.appId]?.flagged;

export function buildFrame(engine: Engine, playhead: number | null, focus: Focus | null): Frame {
  const idx = playhead === null ? engine.samples.length - 1 : engine.indexOf(playhead);
  const n = flows.length;
  const totalDown = new Float64Array(n);
  const totalUp = new Float64Array(n);
  for (let k = 0; k <= idx; k++) {
    const s = engine.samples[k];
    for (let j = 0; j < s.ids.length; j++) {
      totalDown[s.ids[j]] += s.down[j];
      totalUp[s.ids[j]] += s.up[j];
    }
  }
  const s = engine.samples[idx];
  const rateDown = new Float64Array(n);
  const rateUp = new Float64Array(n);
  for (let j = 0; j < s.ids.length; j++) {
    rateDown[s.ids[j]] = s.down[j];
    rateUp[s.ids[j]] = s.up[j];
  }

  const { showLocal } = useSettings.getState();
  const views: FlowView[] = [];
  for (const def of flows) {
    if (!def || !matchesFocus(def, focus)) continue;
    if (!showLocal && def.placeId === 'local') continue;
    const i = def.index;
    if (totalDown[i] + totalUp[i] === 0 && !(playhead === null && def.open)) continue;
    views.push({ def, down: rateDown[i], up: rateUp[i], totalDown: totalDown[i], totalUp: totalUp[i] });
  }
  return {
    t: s.t,
    idx,
    live: playhead === null,
    flows: views,
    apps: aggregate(views, (f) => f.appId, isFlagged),
    providers: aggregate(views, (f) => f.providerId, isFlagged),
    down: views.reduce((a, v) => a + v.down, 0),
    up: views.reduce((a, v) => a + v.up, 0),
    total: views.reduce((a, v) => a + v.totalDown + v.totalUp, 0),
  };
}

/** Down/up series for matching flows, averaged into `buckets` points. */
export function series(engine: Engine, focus: Focus | null, buckets: number, lastSeconds?: number, endIdx?: number) {
  const end = endIdx ?? engine.samples.length - 1;
  const start = lastSeconds ? Math.max(0, end - lastSeconds + 1) : 0;
  const n = end - start + 1;
  const count = Math.max(1, Math.min(buckets, n));
  const down = new Float64Array(count);
  const up = new Float64Array(count);
  const hits = new Int32Array(count);
  const { showLocal } = useSettings.getState();
  const selected = focus || !showLocal ? flows.map((f) => !!f && matchesFocus(f, focus) && (showLocal || f.placeId !== 'local')) : null;
  for (let k = start; k <= end; k++) {
    const b = Math.min(count - 1, Math.floor(((k - start) / n) * count));
    const s = engine.samples[k];
    for (let j = 0; j < s.ids.length; j++) {
      if (selected && !selected[s.ids[j]]) continue;
      down[b] += s.down[j];
      up[b] += s.up[j];
    }
    hits[b]++;
  }
  for (let b = 0; b < count; b++) {
    if (hits[b]) {
      down[b] /= hits[b];
      up[b] /= hits[b];
    }
  }
  return { down, up, start, end };
}
