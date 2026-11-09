import { beforeEach, describe, expect, it } from 'vitest';
import { apps, clearRegistries, flows, places, providers } from './catalog';
import { Engine, buildFrame, series } from './engine';

function seed() {
  clearRegistries();
  places.de = { id: 'de', city: '', country: 'Germany', cc: 'DE', lat: 51, lng: 10 };
  places.local = { id: 'local', city: '', country: 'Local network', cc: '--', lat: null, lng: null };
  providers.g = { id: 'g', name: 'Google', asn: 'AS15169', category: 'Search' };
  apps.chrome = { id: 'chrome', name: 'Chrome', exe: 'chrome.exe', path: '', publisher: 'Google LLC', notes: [], flagged: false };
  apps.bad = { id: 'bad', name: 'bad', exe: 'bad.exe', path: '', publisher: null, notes: [], flagged: true };
  flows[0] = { index: 0, appId: 'chrome', providerId: 'g', domain: 'google.com', ip: '1.1.1.1', port: 443, proto: 'TCP', placeId: 'de' };
  flows[1] = { index: 1, appId: 'bad', providerId: 'g', domain: 'x.example', ip: '2.2.2.2', port: 443, proto: 'TCP', placeId: 'de' };
  flows[2] = { index: 2, appId: 'chrome', providerId: 'g', domain: 'router', ip: '192.168.1.1', port: 80, proto: 'TCP', placeId: 'local' };
}

function engineWith(...samples: [number, number[], number[]][]) {
  const engine = new Engine();
  engine.reset(samples.map(([t, ids, down]) => ({ t, ids, down, up: down.map(() => 0) })));
  return engine;
}

describe('Engine', () => {
  beforeEach(seed);

  it('ignores a sample for a second it already has', () => {
    const engine = engineWith([100, [0], [10]]);
    engine.push({ t: 100, ids: [0], down: [10], up: [0] });
    engine.push({ t: 99, ids: [0], down: [10], up: [0] });
    expect(engine.samples).toHaveLength(1);
    engine.push({ t: 101, ids: [0], down: [5], up: [0] });
    expect(engine.samples).toHaveLength(2);
  });

  it('accepts the first sample into an empty history', () => {
    const engine = new Engine();
    engine.samples = [];
    engine.push({ t: 100, ids: [], down: [], up: [] });
    expect(engine.now).toBe(100);
  });

  it('finds the sample at or before a time, even across gaps', () => {
    const engine = engineWith([100, [], []], [105, [], []], [110, [], []]);
    expect(engine.indexOf(99)).toBe(0);
    expect(engine.indexOf(104)).toBe(0);
    expect(engine.indexOf(105)).toBe(1);
    expect(engine.indexOf(200)).toBe(2);
  });

  it('summarises the idle period and caches the result', () => {
    const engine = engineWith([100, [0], [10]], [101, [0, 1], [20, 5]], [102, [0], [7]]);
    engine.idle = { start: 101, end: 102 };
    const summary = engine.awaySummary();
    expect(summary).toMatchObject({ total: 32, apps: 2 });
    expect(engine.awaySummary()).toBe(summary);
  });

  it('has no away summary once the idle period left history', () => {
    const engine = engineWith([200, [], []]);
    engine.idle = { start: 100, end: 150 };
    expect(engine.awaySummary()).toBeNull();
  });
});

describe('buildFrame', () => {
  beforeEach(seed);

  it('totals bytes up to the playhead and takes rates from that second', () => {
    const engine = engineWith([100, [0], [10]], [101, [0, 1], [20, 5]], [102, [0], [7]]);
    const live = buildFrame(engine, null, null);
    expect(live.total).toBe(42);
    expect(live.down).toBe(7);

    const past = buildFrame(engine, 101, null);
    expect(past.live).toBe(false);
    expect(past.total).toBe(35);
    expect(past.down).toBe(25);
  });

  it('puts flagged apps first, whatever their size', () => {
    const engine = engineWith([100, [0, 1], [1000, 1]]);
    expect(buildFrame(engine, null, null).apps.map((a) => a.id)).toEqual(['bad', 'chrome']);
  });

  it('filters by focus', () => {
    const engine = engineWith([100, [0, 1], [10, 5]]);
    const frame = buildFrame(engine, null, { type: 'app', id: 'bad' });
    expect(frame.flows.map((v) => v.def.index)).toEqual([1]);
    expect(buildFrame(engine, null, { type: 'country', id: 'DE' }).flows).toHaveLength(2);
  });

  it('shows open but quiet connections only when live', () => {
    flows[0] = { ...flows[0], open: true };
    const engine = engineWith([100, [], []], [101, [], []]);
    expect(buildFrame(engine, null, null).flows).toHaveLength(1);
    expect(buildFrame(engine, 100, null).flows).toHaveLength(0);
  });
});

describe('series', () => {
  beforeEach(seed);

  it('averages samples into buckets', () => {
    const engine = engineWith([100, [0], [10]], [101, [0], [30]], [102, [0], [5]], [103, [0], [15]]);
    expect([...series(engine, null, 2).down]).toEqual([20, 10]);
  });

  it('only counts flows in focus', () => {
    const engine = engineWith([100, [0, 1], [10, 4]]);
    expect([...series(engine, { type: 'app', id: 'bad' }, 1).down]).toEqual([4]);
  });
});
