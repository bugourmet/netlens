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
      .arcColor((a: ArcDatum) => {
        if (a.kind === 'path') return a.flagged ? 'rgba(255,92,108,.32)' : 'rgba(120,235,225,.13)';
        return a.flagged ? ['rgba(255,92,108,0)', '#ffd2d6'] : ['rgba(98,230,216,0)', 'rgba(98,230,216,.75)', '#f4fffd'];
      })
      .arcStroke((a: ArcDatum) => (a.kind === 'path' ? 0.14 : 0.3 + a.level * 0.17))
      .arcAltitudeAutoScale(0.38)
      .arcCurveResolution(96)
      .arcDashLength((a: ArcDatum) => (a.kind === 'path' ? 1 : 0.28))
      .arcDashGap((a: ArcDatum) => (a.kind === 'path' ? 0 : 0.9))
      .arcDashInitialGap((a: ArcDatum) => (a.kind === 'path' ? 0 : Math.random() * 1.2))
      .arcDashAnimateTime((a: ArcDatum) => (a.kind === 'path' ? 0 : [0, 3400, 2300, 1400][a.level]))
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
  }, [frame, focus, arcLimit, homeCc, phone]);

  return (
    <div className="scene" aria-hidden={view !== 'overview'}>
      <div ref={host} className="globe-host" />
      {failed && <p className="empty">The globe needs WebGL, which isn't available here. Use Flows instead.</p>}
    </div>
  );
}
