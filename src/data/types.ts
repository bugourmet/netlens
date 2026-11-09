// Shapes the UI consumes. Live data follows native/NetLens.Core/Protocol.cs.

export type Severity = 'info' | 'warning' | 'critical';

export interface AppInfo {
  id: string;
  name: string;
  exe: string;
  path: string;
  publisher: string | null; // null = unsigned or not checked yet, see notes
  notes: string[]; // extra trust signals
  flagged: boolean;
}

export interface ProviderInfo {
  id: string;
  name: string;
  asn: string;
  category: string;
}

export interface Place {
  id: string;
  city: string; // empty when only the country is known
  country: string;
  cc: string;
  lat: number | null; // null = not on the globe (local network, unknown)
  lng: number | null;
}

export interface FlowDef {
  index: number;
  appId: string;
  providerId: string;
  domain: string; // the IP when no name is known
  ip: string;
  port: number;
  proto: string;
  placeId: string;
  open?: boolean; // listed as open by the OS, even if quiet
}

export interface Sample {
  t: number; // unix seconds
  ids: ArrayLike<number>; // flows with traffic this second
  down: ArrayLike<number>; // bytes/s, parallel to ids
  up: ArrayLike<number>;
}

export interface FeedEvent {
  t: number;
  severity: Severity;
  title: string;
  detail: string;
  appId: string;
  providerId: string;
}

export interface Idle {
  start: number;
  end: number;
}

export type Focus = { type: 'app' | 'provider' | 'country'; id: string };

export interface FlowView {
  def: FlowDef;
  down: number;
  up: number;
  totalDown: number;
  totalUp: number;
}

export interface Aggregate {
  id: string;
  down: number;
  up: number;
  total: number;
  flows: number;
  active: number;
  flagged: boolean;
}

export interface Frame {
  t: number;
  idx: number;
  live: boolean;
  flows: FlowView[];
  apps: Aggregate[];
  providers: Aggregate[];
  down: number;
  up: number;
  total: number;
}

export type CaptureState =
  | 'connecting'
  | 'full'
  | 'limited'
  | 'needs-start' // waiting for the user to agree to start capture
  | 'declined' // the user declined the admin prompt
  | 'lost' // the helper stopped
  | 'denied' // the helper couldn't be started
  | 'conflict' // another program owns the capture channel
  | 'incompatible'; // the helper is from a different version

export interface SourceStatus {
  kind: 'demo' | 'live';
  state: CaptureState;
  limits: string[];
  /** True when this UI can start the helper itself (inside the app, not the dev bridge). */
  control: boolean;
}
