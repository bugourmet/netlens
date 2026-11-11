import { beforeEach, describe, expect, it } from 'vitest';
import { apps, clearRegistries, flows, home, places, providers } from '../data/catalog';
import { Engine, buildFrame } from '../data/engine';
import { sunDirection } from './earth';
import { ARC_HOLD_MS, buildArcs, buildBars, pickTags, type ArcDatum } from './layers';

// Back from three-globe's xyz convention to latitude and longitude.
function subsolar(utc: number) {
  const v = sunDirection(utc / 1000);
  return { lat: (Math.asin(v.y) * 180) / Math.PI, lng: (Math.atan2(v.x, v.z) * 180) / Math.PI };
}

function frameOf(ids: number[], down: number[]) {
  const engine = new Engine();
  engine.reset([{ t: 100, ids, down, up: down.map(() => 0) }]);
  return buildFrame(engine, null, null);
}

describe('sunDirection', () => {
  it('puts the sun near the equator and the prime meridian at a March equinox noon', () => {
    const { lat, lng } = subsolar(Date.UTC(2026, 2, 20, 12));
    expect(Math.abs(lat)).toBeLessThan(1);
    expect(Math.abs(lng)).toBeLessThan(3); // the equation of time shifts noon by a few minutes
  });

  it('puts the sun over the Tropic of Cancer in June', () => {
    expect(subsolar(Date.UTC(2026, 5, 21, 12)).lat).toBeCloseTo(23.4, 0);
  });

  it('moves the sun west by 15 degrees an hour', () => {
    const before = subsolar(Date.UTC(2026, 2, 20, 12)).lng;
    const after = subsolar(Date.UTC(2026, 2, 20, 13)).lng;
    expect(before - after).toBeCloseTo(15, 0);
  });
});

describe('layers', () => {
  beforeEach(() => {
    clearRegistries();
    Object.assign(home, { lat: 51, lng: 10, label: 'Germany' });
    places.us = { id: 'us', city: '', country: 'United States', cc: 'US', lat: 39, lng: -98 };
    places.jp = { id: 'jp', city: '', country: 'Japan', cc: 'JP', lat: 36, lng: 138 };
    places.de = { id: 'de', city: '', country: 'Germany', cc: 'DE', lat: 51, lng: 10 };
    providers.a = { id: 'a', name: 'A', asn: '', category: '' };
    providers.b = { id: 'b', name: 'B', asn: '', category: '' };
    apps.ok = { id: 'ok', name: 'OK', exe: 'ok.exe', path: '', publisher: 'X', notes: [], flagged: false };
    apps.bad = { id: 'bad', name: 'Bad', exe: 'bad.exe', path: '', publisher: null, notes: [], flagged: true };
    flows[0] = { index: 0, appId: 'ok', providerId: 'a', domain: 'a.com', ip: '1.1.1.1', port: 443, proto: 'TCP', placeId: 'us' };
    flows[1] = { index: 1, appId: 'bad', providerId: 'b', domain: 'b.com', ip: '2.2.2.2', port: 443, proto: 'TCP', placeId: 'jp' };
    flows[2] = { index: 2, appId: 'ok', providerId: 'a', domain: 'local.example', ip: '3.3.3.3', port: 443, proto: 'TCP', placeId: 'de' };
  });

  it('draws a path and a comet for active traffic, and keeps flagged arcs when quiet', () => {
    const cache = new Map<string, [ArcDatum, ArcDatum]>();
    const engine = new Engine();
    engine.reset([
      { t: 100, ids: [1], down: [10], up: [0] },
      { t: 101, ids: [0], down: [5000], up: [0] },
    ]);
    const arcs = buildArcs(buildFrame(engine, null, null), false, 40, cache);
    expect(arcs.map((a) => `${a.key}:${a.kind}`).sort()).toEqual(['a|us:comet', 'a|us:path', 'b|jp:path']);
    expect(arcs[0].flagged).toBe(true); // flagged sorts first
  });

  it('skips destinations at the home position', () => {
    const arcs = buildArcs(frameOf([2], [100]), false, 40, new Map());
    expect(arcs).toHaveLength(0);
  });

  it('reuses arc objects between frames so the globe can update them in place', () => {
    const cache = new Map<string, [ArcDatum, ArcDatum]>();
    const first = buildArcs(frameOf([0], [100]), false, 40, cache);
    const second = buildArcs(frameOf([0], [900]), false, 40, cache);
    expect(second[0]).toBe(first[0]);
    expect(second[1].rate).toBe(900);
  });

  it('holds an arc for a few seconds after its traffic stops, then drops it', () => {
    const cache = new Map<string, [ArcDatum, ArcDatum]>();
    const engine = new Engine();
    engine.reset([{ t: 100, ids: [0], down: [5000], up: [0] }]);
    buildArcs(buildFrame(engine, null, null), false, 40, cache, 1_000_000);

    engine.push({ t: 101, ids: [], down: [], up: [] }); // the connection goes quiet
    const quiet = buildFrame(engine, null, null);
    expect(buildArcs(quiet, false, 40, cache, 1_000_000 + ARC_HOLD_MS - 1).map((a) => a.kind).sort()).toEqual(['comet', 'path']);
    expect(buildArcs(quiet, false, 40, cache, 1_000_000 + ARC_HOLD_MS + 1)).toHaveLength(0);
  });

  it('respects the arc limit', () => {
    expect(buildArcs(frameOf([0, 1], [100, 100]), false, 1, new Map()).filter((a) => a.kind === 'path')).toHaveLength(1);
  });

  it('adds a home bar and one bar per place, red when flagged', () => {
    const bars = buildBars(buildArcs(frameOf([0, 1], [100, 100]), false, 40, new Map()));
    expect(bars.map((b) => b.id).sort()).toEqual(['home', 'jp', 'us']);
    expect(bars.find((b) => b.id === 'jp')?.flagged).toBe(true);
  });

  it('escapes names in tooltips', () => {
    providers.a = { ...providers.a, name: '<b>x</b>' };
    const bars = buildBars(buildArcs(frameOf([0], [100]), false, 40, new Map()));
    expect(bars.find((b) => b.id === 'us')?.label).toContain('&lt;b&gt;x&lt;/b&gt;');
  });

  it('tags flagged places first and never two on top of each other', () => {
    places.us2 = { id: 'us2', city: '', country: 'United States', cc: 'US', lat: 40, lng: -97 };
    flows[3] = { index: 3, appId: 'ok', providerId: 'b', domain: 'c.com', ip: '4.4.4.4', port: 443, proto: 'TCP', placeId: 'us2' };
    const tags = pickTags(buildArcs(frameOf([0, 1, 3], [500, 1, 400]), false, 40, new Map()), 5);
    expect(tags.map((t) => t.placeId)).toEqual(['jp', 'us']);
  });
});
