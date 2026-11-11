import { useEffect, useEffectEvent, useRef, useState } from 'react';
import Globe from 'globe.gl';
import * as THREE from 'three';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { apps, home, places, providers, systemHome } from '../data/catalog';
import countryRows from '../../native/NetLens.Core/countries.json';
import { createEarthMaterial, createStars, sunDirection, type EarthLight } from '../globe/earth';
import { arcLabel, buildArcs, buildBars, pickTags, type ArcDatum, type BarDatum, type TagDatum } from '../globe/layers';
import { useApp, useFrame, type View } from '../state/store';
import { useSettings, type Quality } from '../state/settings';
import { fmtRate, useIsPhone } from '../ui/format';

// globe.gl's chainable API is only partly typed, so the instance is held loosely.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GlobeInstance = any;

const PIXEL_RATIO: Record<Quality, number> = { ultra: 2, balanced: 1.5, battery: 1 };
const BLOOM: Record<Quality, number> = { ultra: 0.62, balanced: 0.42, battery: 0 };

/** Camera distance in globe radii: close on Live, further back when a sheet covers part of the window. */
const restAltitude = (phone: boolean, view: View) => (phone ? 2.7 : view === 'overview' ? 1.72 : 2.5);

/** How far to push the planet left so it isn't hidden under the right-hand panel or sheet. */
const viewShift = (phone: boolean, view: View, width: number) => (phone ? 0 : view === 'overview' ? 174 : width * 0.31);

const prefersReducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** How long a new connection's line takes to draw out from home. */
const REVEAL_MS = 1200;
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

/**
 * A fixed start point per comet, so comets don't fly in lockstep. Fixed rather than random,
 * because the globe re-reads it on every data update and a new value would make comets jump.
 */
function cometPhase(key: string) {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return ((h >>> 0) % 1000) / 1000 * 1.2;
}

/** Sets a drawn path's visible share directly on its shader, between data updates. */
function applyReveal(a: ArcDatum) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const uniforms = (a as any).__threeObjArc?.children[0]?.material?.uniforms;
  if (uniforms) uniforms.dashSize.value = a.reveal;
}

/** Reuses one element per place so numbers update in place. Text only, never HTML. */
function tagElement(cache: Map<string, HTMLDivElement>, t: TagDatum) {
  let el = cache.get(t.placeId);
  if (!el) {
    el = document.createElement('div');
    el.className = 'geo-tag';
    el.innerHTML = '<i></i><div><span class="geo-name"></span><b class="geo-rate"></b></div>';
    cache.set(t.placeId, el);
  }
  el.classList.toggle('flag', t.flagged);
  el.querySelector('.geo-name')!.textContent = `${providers[t.providerId]?.name ?? ''} · ${places[t.placeId].cc}`;
  el.querySelector('.geo-rate')!.textContent = t.flagged && t.rate === 0 ? 'Quiet, flagged' : fmtRate(t.rate);
  return el;
}

export function GlobeStage() {
  const host = useRef<HTMLDivElement>(null);
  const globe = useRef<GlobeInstance>(null);
  const light = useRef<EarthLight | null>(null);
  const bloom = useRef<UnrealBloomPass | null>(null);
  const stars = useRef<THREE.Points | null>(null);
  const arcCache = useRef(new Map<string, [ArcDatum, ArcDatum]>());
  const tagElements = useRef(new Map<string, HTMLDivElement>());
  const lastSignature = useRef('');
  const shownPaths = useRef(new Set<string>());
  const revealing = useRef(new Map<ArcDatum, number>()); // path -> draw start time
  const introDone = useRef(false);
  const shift = useRef(0);
  const [failed, setFailed] = useState(false);

  const phone = useIsPhone();
  const frame = useFrame();
  const focus = useApp((s) => s.focus);
  const view = useApp((s) => s.view);
  const homeFlights = useApp((s) => s.homeFlights);
  const { quality, stars: showStars, sunlight, rotate, rotateSpeed, arcLimit, motion, homeCc } = useSettings();
  const status = useApp((s) => s.status);
  const reduced = motion === 'reduced' || prefersReducedMotion();

  // Camera moves read the current layout but shouldn't re-run when it changes.
  const flyHome = useEffectEvent((duration: number) => {
    globe.current?.pointOfView({ lat: home.lat - 8, lng: home.lng - 18, altitude: restAltitude(phone, view) }, reduced ? 0 : duration);
  });
  const flyToFocus = useEffectEvent(() => {
    const onGlobe = frame.flows.filter((v) => places[v.def.placeId]?.lat != null);
    if (!globe.current || !onGlobe.length) return;
    // Its flagged destination first, else its busiest.
    const target = onGlobe.find((v) => apps[v.def.appId]?.flagged) ?? onGlobe.reduce((a, b) => (b.totalDown + b.totalUp > a.totalDown + a.totalUp ? b : a));
    const p = places[target.def.placeId];
    globe.current.pointOfView({ lat: (p.lat! + home.lat) / 2, lng: (p.lng! + home.lng) / 2, altitude: phone ? 2.4 : 1.55 }, reduced ? 0 : 1300);
  });
  const introOnce = useEffectEvent(() => {
    if (introDone.current) return;
    introDone.current = true;
    flyHome(3200);
  });

  // Build the globe once.
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let g: GlobeInstance;
    try {
      g = new Globe(el, { rendererConfig: { antialias: true, alpha: false, powerPreference: 'high-performance' } } as never);
    } catch {
      // Only known after trying to create a WebGL context, so it can't be derived during render.
      // oxlint-disable-next-line react/set-state-in-effect
      setFailed(true);
      return;
    }
    globe.current = g;

    const earth = createEarthMaterial(import.meta.env.BASE_URL);
    light.current = earth.light;

    g.backgroundColor('#03070a')
      .globeMaterial(earth.material)
      .showAtmosphere(true)
      .atmosphereColor('#2a8fc4')
      .atmosphereAltitude(0.07)
      .arcStartLat('startLat')
      .arcStartLng('startLng')
      .arcEndLat('endLat')
      .arcEndLng('endLng')
      // Paths are 1-pixel lines: a thin tube breaks into dots once it is narrower than a pixel.
      // Comets keep a fixed width and speed, because changing either rebuilds or restarts them
      // mid-flight; traffic level shows as brightness instead.
      .arcColor((a: ArcDatum) => {
        if (a.kind === 'path') return a.flagged ? 'rgba(255,92,108,.45)' : 'rgba(120,235,225,.22)';
        if (a.flagged) return ['rgba(255,92,108,0)', '#ffd2d6'];
        const head = ['rgba(98,230,216,.55)', 'rgba(170,250,242,.8)', '#f4fffd'][a.level - 1] ?? '#f4fffd';
        return ['rgba(98,230,216,0)', 'rgba(98,230,216,.6)', head];
      })
      .arcStroke((a: ArcDatum) => (a.kind === 'path' ? null : 0.5))
      .arcAltitudeAutoScale(0.38)
      .arcCurveResolution(96)
      // Dashes are measured from home (0) to the far end (1). A path is one dash as long as
      // its reveal, so growing that from 0 to 1 draws the line out from home.
      .arcDashLength((a: ArcDatum) => (a.kind === 'path' ? a.reveal : 0.3))
      .arcDashGap((a: ArcDatum) => (a.kind === 'path' ? 2 : 0.9))
      .arcDashInitialGap((a: ArcDatum) => (a.kind === 'path' ? 0 : cometPhase(a.key)))
      .arcDashAnimateTime((a: ArcDatum) => (a.kind === 'path' ? 0 : 2400))
      .arcsTransitionDuration(0)
      .arcLabel(arcLabel)
      .onArcClick((a: ArcDatum) => useApp.getState().select({ type: 'provider', id: a.providerId }))
      .pointLat('lat')
      .pointLng('lng')
      .pointAltitude('height')
      .pointRadius('radius')
      .pointColor('color')
      .pointResolution(16)
      .pointLabel((p: BarDatum) => p.label)
      .pointsMerge(false)
      .pointsTransitionDuration(900)
      .onPointClick((p: BarDatum) => p.providerId && useApp.getState().select({ type: 'provider', id: p.providerId }))
      .ringLat('lat')
      .ringLng('lng')
      .ringColor((r: { color: string }) => (t: number) => r.color.replace('ALPHA', String(Math.max(0, 1 - t))))
      .ringMaxRadius((r: { max: number }) => r.max)
      .ringPropagationSpeed(1.5)
      .ringRepeatPeriod(1600)
      .htmlLat('lat')
      .htmlLng('lng')
      .htmlAltitude(0.03)
      .htmlElement((d: { el: HTMLElement }) => d.el)
      .htmlTransitionDuration(0);
    g.htmlElementVisibilityModifier?.((tag: HTMLElement, visible: boolean) => {
      tag.dataset.visible = String(visible);
    });

    // Start in deep space; the intro below flies in.
    g.pointOfView({ lat: home.lat - 8, lng: home.lng - 18, altitude: 7 });

    const controls = g.controls();
    Object.assign(controls, { enableDamping: true, dampingFactor: 0.06, rotateSpeed: 0.55, zoomSpeed: 0.7, minDistance: 125, maxDistance: 900, enablePan: false });

    const pass = new UnrealBloomPass(new THREE.Vector2(el.clientWidth, el.clientHeight), BLOOM[useSettings.getState().quality], 0.22, 0.92);
    g.postProcessingComposer().addPass(pass);
    bloom.current = pass;

    const sky = createStars();
    g.scene().add(sky);
    stars.current = sky;

    const resize = new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect;
      if (width === 0) return;
      g.width(width).height(height);
      g.camera().setViewOffset(width, height, shift.current, 0, width, height);
    });
    resize.observe(el);

    // Don't draw while nobody can see it.
    const onVisibility = () => (document.hidden ? g.pauseAnimation() : g.resumeAnimation());
    document.addEventListener('visibilitychange', onVisibility);

    // Fly in once the real home position is known (below), or after a moment regardless.
    const intro = setTimeout(introOnce, 2000);

    return () => {
      clearTimeout(intro);
      document.removeEventListener('visibilitychange', onVisibility);
      resize.disconnect();
      g._destructor?.();
      globe.current = null;
    };
  }, []);

  // A hello from capture (or the demo) sets the home position along with the status.
  useEffect(() => {
    if (home.label) introOnce();
  }, [status]);

  useEffect(() => {
    const g = globe.current;
    if (!g) return;
    const ratio = Math.min(window.devicePixelRatio || 1, PIXEL_RATIO[quality]);
    g.renderer().setPixelRatio(ratio);
    g.postProcessingComposer().setPixelRatio(ratio);
    if (bloom.current) {
      bloom.current.strength = BLOOM[quality];
      bloom.current.enabled = BLOOM[quality] > 0;
    }
  }, [quality]);

  useEffect(() => {
    if (stars.current) stars.current.visible = showStars;
  }, [showStars]);

  useEffect(() => {
    if (light.current) light.current.sunlit.value = sunlight ? 1 : 0;
  }, [sunlight]);

  // The light follows the playhead, so replay shows the planet as it was.
  useEffect(() => {
    light.current?.sunDir.value.copy(sunDirection(frame.t));
  }, [frame.t]);

  useEffect(() => {
    const controls = globe.current?.controls();
    if (!controls) return;
    controls.autoRotate = rotate && !focus && !reduced;
    controls.autoRotateSpeed = rotateSpeed;
  }, [rotate, rotateSpeed, focus, reduced]);

  // A sheet or panel pushes the planet aside. Shifting the camera's view, not the
  // canvas, keeps clicks and tags lined up.
  useEffect(() => {
    const g = globe.current;
    if (!g) return;
    const target = () => viewShift(phone, view, g.width());
    if (reduced) shift.current = target();
    let raf = 0;
    const step = () => {
      shift.current += (target() - shift.current) * 0.075;
      const done = Math.abs(target() - shift.current) < 0.5;
      if (done) shift.current = target();
      g.camera().setViewOffset(g.width(), g.height(), shift.current, 0, g.width(), g.height());
      if (!done) raf = requestAnimationFrame(step);
    };
    step();
    return () => cancelAnimationFrame(raf);
  }, [view, phone, reduced]);

  // Sheets pull the camera back; Live brings it close again.
  useEffect(() => {
    const g = globe.current;
    if (!g || useApp.getState().focus || !introDone.current) return;
    g.pointOfView({ altitude: restAltitude(phone, view) }, reduced ? 0 : 1100);
  }, [view, phone, reduced]);

  // Keyboard H.
  useEffect(() => {
    if (homeFlights > 0) flyHome(1300);
  }, [homeFlights]);

  useEffect(() => {
    if (focus) flyToFocus();
  }, [focus]);

  // Push data, rebuilding layers only when what's drawn actually changes.
  useEffect(() => {
    const g = globe.current;
    if (!g) return;
    const row = (countryRows as { cc: string; lat: number; lng: number; name: string }[]).find((c) => c.cc === homeCc);
    const wanted = row ? { lat: row.lat, lng: row.lng, label: row.name } : systemHome;
    if (wanted.lat !== home.lat || wanted.lng !== home.lng) {
      Object.assign(home, wanted);
      arcCache.current.clear();
    }

    const arcs = buildArcs(frame, !!focus, arcLimit, arcCache.current);
    const bars = buildBars(arcs);
    const tags = pickTags(arcs, phone ? 2 : 5);

    // Connections new to the globe draw in; ones already shown stay as they are.
    const now = performance.now();
    const paths = arcs.filter((a) => a.kind === 'path');
    for (const a of paths) {
      if (shownPaths.current.has(a.key) && a.reveal > 0) continue;
      a.reveal = reduced ? 1 : 0;
      if (!reduced) revealing.current.set(a, now);
    }
    shownPaths.current = new Set(paths.map((a) => a.key));
    for (const a of revealing.current.keys()) if (!shownPaths.current.has(a.key)) revealing.current.delete(a);

    const signature = `${arcs.map((a) => `${a.key}:${a.kind}:${a.level}:${a.flagged}`).sort().join(',')}|${tags.map((t) => t.placeId).join()}|${home.lat},${home.lng}`;
    if (signature !== lastSignature.current) {
      lastSignature.current = signature;
      g.arcsData(arcs);
      g.ringsData([
        { lat: home.lat, lng: home.lng, color: 'rgba(235,255,252,ALPHA)', max: 3 },
        ...bars.filter((b) => b.flagged).map((b) => ({ lat: b.lat, lng: b.lng, color: 'rgba(255,92,108,ALPHA)', max: 5 })),
      ]);
      g.htmlElementsData(tags.map((t) => ({ lat: places[t.placeId].lat, lng: places[t.placeId].lng, el: tagElement(tagElements.current, t) })));
    } else {
      for (const t of tags) tagElement(tagElements.current, t); // same tags, fresh numbers
    }
    g.pointsData(bars);
  }, [frame, focus, arcLimit, homeCc, phone, reduced]);

  // Draws new lines out from home, like a progress bar.
  useEffect(() => {
    let id = 0;
    const tick = () => {
      const now = performance.now();
      for (const [a, start] of revealing.current) {
        const t = Math.min(1, (now - start) / REVEAL_MS);
        a.reveal = easeOut(t);
        applyReveal(a);
        if (t === 1) revealing.current.delete(a);
      }
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <div className="scene" aria-hidden={view !== 'overview'}>
      <div ref={host} className="globe-host" />
      {failed && <p className="empty">The globe needs WebGL, which isn't available here. Use Flows instead.</p>}
    </div>
  );
}
