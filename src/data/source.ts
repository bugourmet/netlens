import { apps, clearRegistries, flows, places, providers, setSystemHome } from './catalog';
import { startDemo } from './demo';
import type { AppInfo, CaptureState, FeedEvent, FlowDef, Idle, Place, ProviderInfo, Sample } from './types';
import { engine, useApp } from '../state/store';

/** Must match Wire.Version in native/NetLens.Core/Protocol.cs. */
const PROTOCOL = 1;

interface Registers {
  apps: AppInfo[];
  providers: ProviderInfo[];
  places: Place[];
  flows: FlowDef[];
  events: FeedEvent[];
  idle: Idle | null;
}
interface Hello extends Registers {
  type: 'hello';
  protocol?: number;
  mode: 'full' | 'limited';
  limits: string[];
  home: { lat: number; lng: number; label: string };
  history: Sample[];
}
interface Tick extends Registers, Sample {
  type: 'tick';
}
interface Status {
  type: 'status';
  state: CaptureState;
}
type Message = Hello | Tick | Status;

declare global {
  interface Window {
    HybridWebView?: { SendRawMessage: (message: string) => void };
  }
}

interface WebView2 {
  postMessage: (message: string) => void;
  addEventListener: (type: 'message', listener: (e: { data: string }) => void) => void;
}

let sendToShell: ((message: string) => void) | null = null;

function setStatus(state: CaptureState, limits: string[] = []) {
  useApp.getState().setStatus({ kind: 'live', state, limits, control: sendToShell !== null });
}

function merge(m: Registers) {
  for (const a of m.apps) apps[a.id] = a;
  for (const p of m.providers) providers[p.id] = p;
  for (const p of m.places) places[p.id] = p;
  for (const f of m.flows) flows[f.index] = f;
  if (m.idle) engine.idle = m.idle;
}

function handle(m: Message) {
  if (m.type === 'status') {
    setStatus(m.state);
  } else if (m.type === 'hello') {
    if (m.protocol !== PROTOCOL) return setStatus('incompatible');
    clearRegistries();
    engine.reset(m.history);
    setSystemHome(m.home);
    merge(m);
    engine.events = m.events;
    setStatus(m.mode, m.limits);
  } else {
    merge(m);
    engine.events.push(...m.events);
    engine.push({ t: m.t, ids: m.ids, down: m.down, up: m.up });
  }
  useApp.getState().bump();
}

function receive(raw: string) {
  let message: Message;
  try {
    message = JSON.parse(raw) as Message;
  } catch {
    console.error('Ignored a malformed capture message');
    return;
  }
  handle(message);
}

/** Asks the app to start the capture helper. "full" shows the Windows admin prompt. */
export function requestStart(mode: 'full' | 'limited') {
  sendToShell?.(`start:${mode}`);
}

/** Links to other sites open in the user's browser, not inside the app's web view. */
function routeExternalLinks() {
  document.addEventListener('click', (e) => {
    const link = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
    if (!link) return;
    const url = new URL(link.href, location.href);
    if (url.origin === location.origin) return;
    e.preventDefault();
    if (url.protocol === 'https:') sendToShell?.(`open:${url.href}`);
  });
}

/** Inside the app: messages come from the .NET host through HybridWebView. */
function startHybrid() {
  setStatus('connecting');
  routeExternalLinks();
  window.addEventListener('HybridWebViewMessageReceived', (e) => receive((e as CustomEvent<{ message: string }>).detail.message));
  const bridge = document.createElement('script');
  bridge.src = '_framework/hybridwebview.js';
  bridge.addEventListener('load', () => {
    sendToShell = (m) => window.HybridWebView!.SendRawMessage(m);
    sendToShell('ready');
  });
  // MAUI 9 doesn't serve that script here, so use the same protocol directly on WebView2's channel.
  bridge.addEventListener('error', () => {
    const webview = (window as unknown as { chrome: { webview: WebView2 } }).chrome.webview;
    webview.addEventListener('message', (e) => receive(e.data));
    // WebView2's postMessage goes to the host app and takes no target origin.
    // oxlint-disable-next-line unicorn/require-post-message-target-origin
    sendToShell = (m) => webview.postMessage(`__RawMessage|${m}`);
    sendToShell('ready');
  });
  document.head.append(bridge);
}

/** Dev mode: `npm run dev` with ?live=<token> printed by native/NetLens.DevBridge. */
function startSocket(token: string) {
  setStatus('connecting');
  const connect = () => {
    const ws = new WebSocket(`ws://127.0.0.1:5184/?token=${encodeURIComponent(token)}`);
    ws.addEventListener('message', (e) => receive(e.data as string));
    ws.addEventListener('close', () => {
      setStatus('lost');
      setTimeout(connect, 2000);
    });
  };
  connect();
}

export function startSource() {
  const token = new URLSearchParams(location.search).get('live');
  if (import.meta.env.MODE === 'hybrid') startHybrid();
  else if (token) startSocket(token);
  else startDemo(engine, () => useApp.getState().bump());
}
