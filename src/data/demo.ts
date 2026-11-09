import { apps, clearRegistries, flows, places, providers, setSystemHome } from './catalog';
import { WINDOW_S, type Engine } from './engine';
import type { AppInfo, Place, ProviderInfo, Severity } from './types';

// Fake traffic for UI work (`npm run dev` without ?live=1). All IPs are from reserved
// documentation ranges. NovaHost and updater_svc are invented examples.

const appList: AppInfo[] = [
  ['chrome', 'Chrome', 'chrome.exe', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'Google LLC'],
  ['discord', 'Discord', 'Discord.exe', 'C:\\Users\\demo\\AppData\\Local\\Discord\\app\\Discord.exe', 'Discord Inc.'],
  ['spotify', 'Spotify', 'Spotify.exe', 'C:\\Users\\demo\\AppData\\Roaming\\Spotify\\Spotify.exe', 'Spotify AB'],
  ['vscode', 'VS Code', 'Code.exe', 'C:\\Program Files\\Microsoft VS Code\\Code.exe', 'Microsoft Corporation'],
  ['onedrive', 'OneDrive', 'OneDrive.exe', 'C:\\Program Files\\Microsoft OneDrive\\OneDrive.exe', 'Microsoft Corporation'],
  ['wupdate', 'Windows Update', 'svchost.exe', 'C:\\Windows\\System32\\svchost.exe', 'Windows catalog'],
  ['steam', 'Steam', 'steam.exe', 'C:\\Program Files (x86)\\Steam\\steam.exe', 'Valve Corp.'],
  ['teams', 'Teams', 'ms-teams.exe', 'C:\\Program Files\\WindowsApps\\MSTeams\\ms-teams.exe', 'Microsoft Corporation'],
].map(([id, name, exe, path, publisher]) => ({ id, name, exe, path, publisher, notes: [], flagged: false }));

appList.push({
  id: 'updater',
  name: 'updater_svc',
  exe: 'updater_svc.exe',
  path: 'C:\\Users\\demo\\AppData\\Local\\Temp\\x7f2\\updater_svc.exe',
  publisher: null,
  flagged: true,
  notes: ['Runs from a Temp folder', 'Connects every 60 s'],
});

const providerList: ProviderInfo[] = [
  { id: 'google', name: 'Google', asn: 'AS15169', category: 'Search & video' },
  { id: 'microsoft', name: 'Microsoft', asn: 'AS8075', category: 'Cloud & OS' },
  { id: 'cloudflare', name: 'Cloudflare', asn: 'AS13335', category: 'CDN' },
  { id: 'aws', name: 'Amazon AWS', asn: 'AS16509', category: 'Cloud' },
  { id: 'akamai', name: 'Akamai', asn: 'AS20940', category: 'CDN' },
  { id: 'fastly', name: 'Fastly', asn: 'AS54113', category: 'CDN' },
  { id: 'discord', name: 'Discord', asn: 'AS49544', category: 'Chat' },
  { id: 'spotify', name: 'Spotify', asn: 'AS8403', category: 'Music' },
  { id: 'valve', name: 'Valve', asn: 'AS32590', category: 'Games' },
  { id: 'github', name: 'GitHub', asn: 'AS36459', category: 'Developer' },
  { id: 'meta', name: 'Meta', asn: 'AS32934', category: 'Social & ads' },
  { id: 'novahost', name: 'NovaHost', asn: 'AS64512', category: 'Rented servers' },
];

const placeList: Place[] = [
  { id: 'ashburn', city: 'Ashburn', country: 'United States', cc: 'US', lat: 39.04, lng: -77.49 },
  { id: 'sanjose', city: 'San Jose', country: 'United States', cc: 'US', lat: 37.34, lng: -121.89 },
  { id: 'seattle', city: 'Seattle', country: 'United States', cc: 'US', lat: 47.61, lng: -122.33 },
  { id: 'dallas', city: 'Dallas', country: 'United States', cc: 'US', lat: 32.78, lng: -96.8 },
  { id: 'frankfurt', city: 'Frankfurt', country: 'Germany', cc: 'DE', lat: 50.11, lng: 8.68 },
  { id: 'amsterdam', city: 'Amsterdam', country: 'Netherlands', cc: 'NL', lat: 52.37, lng: 4.9 },
  { id: 'london', city: 'London', country: 'United Kingdom', cc: 'GB', lat: 51.51, lng: -0.13 },
  { id: 'dublin', city: 'Dublin', country: 'Ireland', cc: 'IE', lat: 53.35, lng: -6.26 },
  { id: 'stockholm', city: 'Stockholm', country: 'Sweden', cc: 'SE', lat: 59.33, lng: 18.07 },
  { id: 'singapore', city: 'Singapore', country: 'Singapore', cc: 'SG', lat: 1.35, lng: 103.82 },
  { id: 'tokyo', city: 'Tokyo', country: 'Japan', cc: 'JP', lat: 35.68, lng: 139.69 },
  { id: 'saopaulo', city: 'São Paulo', country: 'Brazil', cc: 'BR', lat: -23.55, lng: -46.63 },
  { id: 'sydney', city: 'Sydney', country: 'Australia', cc: 'AU', lat: -33.87, lng: 151.21 },
];

interface Spec {
  appId: string;
  providerId: string;
  domain: string;
  placeId: string;
  downKBps: number;
  upKBps: number;
  duty: number;
  port: number;
  proto: string;
  background: boolean;
  beacon: boolean;
  firstSeenOffset?: number;
  event?: { severity: Severity; title: string; detail: string };
}

type Opts = Partial<Pick<Spec, 'port' | 'proto' | 'background' | 'beacon' | 'firstSeenOffset' | 'event'>>;
const seed: [string, string, string, string, number, number, number, Opts?][] = [
  ['chrome', 'google', 'rr5---sn-demo.googlevideo.com', 'frankfurt', 2400, 40, 0.8, { proto: 'QUIC' }],
  ['chrome', 'google', 'www.google.com', 'frankfurt', 90, 12, 0.35, { proto: 'QUIC' }],
  ['chrome', 'cloudflare', 'cdnjs.cloudflare.com', 'frankfurt', 320, 8, 0.3],
  ['chrome', 'aws', 'd1demo.cloudfront.net', 'ashburn', 260, 14, 0.25],
  ['chrome', 'meta', 'www.instagram.com', 'amsterdam', 410, 18, 0.25, { proto: 'QUIC' }],
  ['chrome', 'meta', 'connect.facebook.net', 'dublin', 24, 9, 0.3],
  ['chrome', 'fastly', 'www.reddit.com', 'london', 190, 10, 0.2],
  ['chrome', 'akamai', 'www.demo-news.com', 'stockholm', 150, 6, 0.2],
  ['chrome', 'github', 'github.com', 'seattle', 120, 16, 0.2],
  ['chrome', 'microsoft', 'www.bing.com', 'dublin', 40, 6, 0.1],
  ['discord', 'discord', 'gateway.discord.gg', 'frankfurt', 6, 2, 0.95, { background: true }],
  ['discord', 'cloudflare', 'cdn.discordapp.com', 'frankfurt', 280, 6, 0.3],
  ['discord', 'google', 'frankfurt1234.discord.media', 'frankfurt', 90, 80, 0.2, { proto: 'UDP', port: 50012 }],
  ['spotify', 'spotify', 'ap-gew4.spotify.com', 'stockholm', 42, 2, 0.95, { background: true }],
  ['spotify', 'google', 'audio-ak.spotifycdn.com', 'frankfurt', 320, 4, 0.5],
  ['spotify', 'akamai', 'i.scdn.co', 'amsterdam', 80, 2, 0.2],
  ['vscode', 'microsoft', 'marketplace.visualstudio.com', 'dublin', 70, 8, 0.15],
  ['vscode', 'github', 'api.github.com', 'seattle', 36, 14, 0.25],
  ['vscode', 'aws', 'api.demo-ai.dev', 'sanjose', 50, 24, 0.3],
  ['onedrive', 'microsoft', 'demo-my.sharepoint.com', 'dublin', 120, 760, 0.3, { background: true }],
  ['onedrive', 'microsoft', 'skyapi.onedrive.live.com', 'amsterdam', 8, 3, 0.4, { background: true }],
  ['wupdate', 'microsoft', 'dl.delivery.mp.microsoft.com', 'frankfurt', 1800, 12, 0.3, { background: true }],
  ['wupdate', 'akamai', 'download.windowsupdate.com', 'amsterdam', 900, 6, 0.2, { background: true }],
  ['wupdate', 'microsoft', 'settings-win.data.microsoft.com', 'ashburn', 6, 4, 0.2, { background: true }],
  ['steam', 'valve', 'steamcontent-demo.steamserver.net', 'frankfurt', 3200, 30, 0.2],
  ['steam', 'valve', 'cm2-sto1.cm.steampowered.com', 'stockholm', 4, 2, 0.8, { background: true }],
  ['steam', 'akamai', 'cdn.akamai.steamstatic.com', 'tokyo', 240, 4, 0.1],
  ['chrome', 'cloudflare', 'cdn.demo-shop.com.br', 'saopaulo', 70, 4, 0.12],
  ['discord', 'google', 'sydney4021.discord.media', 'sydney', 50, 40, 0.06, { proto: 'UDP', port: 50021 }],
  ['vscode', 'aws', 'open-vsx.demo.sg', 'singapore', 34, 3, 0.1],
  ['chrome', 'aws', 'api.demo-saas.com', 'dallas', 40, 12, 0.15],
  ['updater', 'novahost', 'cdn-sync.example.net', 'saopaulo', 6, 22, 1, {
    background: true, beacon: true, firstSeenOffset: -17 * 60, port: 8443,
    event: { severity: 'critical', title: 'Unknown app connected', detail: 'updater_svc.exe, unsigned, contacted NovaHost in Brazil for the first time' },
  }],
  ['chrome', 'cloudflare', 'static.new-demo-store.com', 'london', 80, 6, 0.35, {
    firstSeenOffset: -5 * 60,
    event: { severity: 'info', title: 'New destination', detail: 'Chrome contacted static.new-demo-store.com for the first time' },
  }],
  ['teams', 'microsoft', 'teams.microsoft.com', 'dublin', 160, 90, 0.8, {
    firstSeenOffset: 18,
    event: { severity: 'warning', title: 'App connected for the first time', detail: 'Teams started talking to Microsoft in Ireland' },
  }],
];

function mulberry32(start: number) {
  let s = start;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fills the registries and history, then adds one sample per second. Returns a stop function. */
export function startDemo(engine: Engine, onTick: () => void) {
  clearRegistries();
  setSystemHome({ lat: 48, lng: 14, label: 'Demo location' });
  for (const a of appList) apps[a.id] = a;
  for (const p of providerList) providers[p.id] = p;
  for (const p of placeList) places[p.id] = p;

  const specs: Spec[] = seed.map(([appId, providerId, domain, placeId, downKBps, upKBps, duty, o]) => ({
    appId, providerId, domain, placeId, downKBps, upKBps, duty,
    port: o?.port ?? 443,
    proto: o?.proto ?? 'TCP',
    background: o?.background ?? false,
    beacon: o?.beacon ?? false,
    firstSeenOffset: o?.firstSeenOffset,
    event: o?.event,
  }));
  specs.forEach((s, index) => {
    flows[index] = {
      index, appId: s.appId, providerId: s.providerId, domain: s.domain, placeId: s.placeId, port: s.port, proto: s.proto,
      ip: s.beacon ? '203.0.113.77' : `198.51.100.${10 + index}`,
    };
  });

  const startedAt = Math.floor(Date.now() / 1000);
  const idleStart = startedAt - 22 * 60;
  const idleEnd = startedAt - 9 * 60;
  const rng = mulberry32(42);
  const on = specs.map(() => false);
  const level = specs.map(() => 0);
  const seen = specs.map(() => false);

  const rate = (s: Spec, i: number, t: number) => {
    const firstSeen = s.firstSeenOffset === undefined ? -Infinity : startedAt + s.firstSeenOffset;
    if (t < firstSeen) return 0;
    if (s.beacon) return (t - firstSeen) % 60 < 2 ? 1 : 0;
    if (t >= idleStart && t <= idleEnd && !s.background) {
      on[i] = false;
      level[i] = 0;
      return 0;
    }
    if (t === firstSeen) on[i] = true;
    if (on[i]) {
      if (rng() < 0.012) on[i] = false;
    } else if (rng() < (0.012 * s.duty) / Math.max(0.02, 1 - s.duty)) {
      on[i] = true;
    }
    level[i] += ((on[i] ? 0.55 + rng() * 0.9 : 0) - level[i]) * 0.35;
    return level[i] < 0.02 ? 0 : level[i];
  };

  const step = (t: number) => {
    const ids: number[] = [];
    const down: number[] = [];
    const up: number[] = [];
    specs.forEach((s, i) => {
      const r = rate(s, i, t);
      if (r === 0) return;
      ids.push(i);
      down.push(r * s.downKBps * 1024);
      up.push(r * s.upKBps * 1024);
      if (!seen[i]) {
        seen[i] = true;
        if (s.event) engine.events.push({ t, ...s.event, appId: s.appId, providerId: s.providerId });
      }
    });
    engine.push({ t, ids, down, up });
  };

  engine.reset([]);
  engine.samples = [];
  for (let t = startedAt - WINDOW_S + 1; t <= startedAt; t++) step(t);
  engine.idle = { start: idleStart, end: idleEnd };

  const id = setInterval(() => {
    const now = Math.floor(Date.now() / 1000);
    for (let t = engine.now + 1; t <= now; t++) step(t);
    onTick();
  }, 1000);
  onTick();
  return () => clearInterval(id);
}
