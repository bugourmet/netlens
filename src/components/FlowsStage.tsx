import type { CSSProperties } from 'react';
import { useMemo, useState } from 'react';
import { apps, providers } from '../data/catalog';
import { useApp, useFrame } from '../state/store';
import { fmtBytes, useIsPhone, useSize } from '../ui/format';

const OTHER = '__other';
const TOP = 40;
const BOTTOM = 30;

interface Node {
  id: string;
  name: string;
  total: number;
  active: boolean;
  flagged: boolean;
  y: number;
  h: number;
  offset: number;
}

function layoutNodes(items: { id: string; name: string; total: number; active: boolean; flagged: boolean }[], height: number, gap: number): Node[] {
  // Every node gets a slot tall enough for its two-line label; the rest of the
  // height is shared by square root so one heavy app can't crush the others.
  const LABEL = 30;
  const sum = items.reduce((a, n) => a + Math.sqrt(n.total), 0) || 1;
  const free = Math.max(0, height - gap * Math.max(0, items.length - 1) - LABEL * items.length);
  const scale = (free * 0.72) / sum;
  let y = 0;
  return items.map((n) => {
    const extra = Math.sqrt(n.total) * scale;
    const h = 4 + extra;
    const node = { ...n, y: y + 13, h, offset: 0 };
    y += LABEL + extra + gap;
    return node;
  });
}

/** App → provider ribbons. Width is data over the history window, on a compressed scale. */
export function FlowsStage() {
  const [ref, size] = useSize<HTMLDivElement>();
  const frame = useFrame();
  const select = useApp((s) => s.select);
  const phone = useIsPhone();
  const [hover, setHover] = useState<string | null>(null);
  const limit = phone ? 6 : 8;

  const data = useMemo(() => {
    const topApps = frame.apps.slice(0, limit);
    const topProviders = frame.providers.slice(0, limit);
    const appKey = (id: string) => (topApps.some((a) => a.id === id) ? id : OTHER);
    const provKey = (id: string) => (topProviders.some((p) => p.id === id) ? id : OTHER);
    const links = new Map<string, { app: string; prov: string; total: number; rate: number; flagged: boolean }>();
    const appTotals = new Map<string, { total: number; active: boolean; flagged: boolean }>();
    const provTotals = new Map<string, { total: number; active: boolean; flagged: boolean }>();
    const bump = (m: typeof appTotals, id: string, total: number, rate: number, flagged: boolean) => {
      const c = m.get(id) ?? { total: 0, active: false, flagged: false };
      c.total += total;
      c.active ||= rate > 0;
      c.flagged ||= flagged;
      m.set(id, c);
    };
    for (const v of frame.flows) {
      const a = appKey(v.def.appId);
      const p = provKey(v.def.providerId);
      const key = `${a}>${p}`;
      const total = v.totalDown + v.totalUp;
      const rate = v.down + v.up;
      const flagged = !!apps[v.def.appId]?.flagged;
      const l = links.get(key) ?? { app: a, prov: p, total: 0, rate: 0, flagged: false };
      l.total += total;
      l.rate += rate;
      l.flagged ||= flagged;
      links.set(key, l);
      bump(appTotals, a, total, rate, flagged);
      bump(provTotals, p, total, rate, flagged);
    }
    const order = (m: typeof appTotals, name: (id: string) => string) =>
      [...m.entries()]
        .map(([id, c]) => ({ id, name: id === OTHER ? 'Other' : name(id), ...c }))
        .sort((x, y) => Number(y.id !== OTHER) - Number(x.id !== OTHER) || Number(y.flagged) - Number(x.flagged) || y.total - x.total);
    return {
      appsN: order(appTotals, (id) => apps[id]?.name ?? id),
      provN: order(provTotals, (id) => providers[id]?.name ?? id),
      links: [...links.values()].sort((a, b) => b.total - a.total),
    };
  }, [frame, limit]);

  const H = Math.max(120, size.h - TOP - BOTTOM);
  const W = size.w;
  const labelW = phone ? 92 : 150;
  const x0 = labelW;
  const x1 = Math.max(x0 + 40, W - labelW);
  const nodeW = 6;

  const left = layoutNodes(data.appsN, H, phone ? 8 : 12);
  const right = layoutNodes(data.provN, H, phone ? 8 : 12);
  const leftBy = new Map(left.map((n) => [n.id, n]));
  const rightBy = new Map(right.map((n) => [n.id, n]));

  const ribbons = data.links.map((l) => {
    const a = leftBy.get(l.app)!;
    const b = rightBy.get(l.prov)!;
    const ta = Math.max(1, (l.total / (a.total || 1)) * a.h);
    const tb = Math.max(1, (l.total / (b.total || 1)) * b.h);
    const ya = a.y + a.offset + ta / 2;
    const yb = b.y + b.offset + tb / 2;
    a.offset += ta;
    b.offset += tb;
    const mid = (x0 + nodeW + x1) / 2;
    const d = `M${x0 + nodeW} ${ya.toFixed(1)} C${mid} ${ya.toFixed(1)} ${mid} ${yb.toFixed(1)} ${x1} ${yb.toFixed(1)}`;
    return { ...l, d, width: (ta + tb) / 2 };
  });

  const clickNode = (type: 'app' | 'provider', id: string) => {
    if (id !== OTHER) select({ type, id });
  };

  const dim = (l: { app: string; prov: string }) => hover !== null && hover !== l.app && hover !== l.prov;

  return (
    <div ref={ref} className="flows">
      <p className="globe-note">Width shows data sent and received, on a compressed scale</p>
      {W > 0 && (
        <svg width={W} height={size.h} role="img" aria-label="Traffic from apps to providers">
          <defs>
            <linearGradient id="ribbon" gradientUnits="userSpaceOnUse" x1={x0} x2={x1} y1="0" y2="0">
              <stop offset="0" stopColor="#62e6d8" stopOpacity=".42" />
              <stop offset="1" stopColor="#7fb6ff" stopOpacity=".3" />
            </linearGradient>
          </defs>
          <text x={x0 + nodeW} y={TOP - 14} className="flows-head">Apps</text>
          <text x={x1} y={TOP - 14} textAnchor="end" className="flows-head">Providers</text>
          <g transform={`translate(0 ${TOP})`}>
            {ribbons.map((r) => (
              <g key={`${r.app}>${r.prov}`}>
                <path
                  className={`ribbon ${r.flagged ? 'flag' : ''}`}
                  style={{ d: `path("${r.d}")`, strokeWidth: Math.max(1, r.width), opacity: dim(r) ? 0.06 : undefined } as CSSProperties}
                />
                {r.rate > 0 && (
                  <path
                    className={`ribbon-pulse ${r.flagged ? 'flag' : ''}`}
                    style={{ d: `path("${r.d}")`, opacity: dim(r) ? 0 : undefined } as CSSProperties}
                  />
                )}
              </g>
            ))}
            {left.map((n) => (
              <g
                key={n.id}
                className={`node ${n.id === OTHER ? '' : 'click'}`}
                onPointerEnter={() => setHover(n.id)}
                onPointerLeave={() => setHover(null)}
                onClick={() => clickNode('app', n.id)}
              >
                <rect x={0} y={n.y - 5} width={x0 + nodeW} height={Math.max(n.h + 10, 26)} fill="transparent" />
                <rect x={x0} y={n.y} width={nodeW} height={n.h} rx={2} className={n.flagged ? 'node-bar flag' : 'node-bar'} />
                <text x={x0 - 10} y={n.y + n.h / 2} dy="-.15em" textAnchor="end" className="node-name">{n.name}</text>
                <text x={x0 - 10} y={n.y + n.h / 2} dy="1.05em" textAnchor="end" className="node-sub">{fmtBytes(n.total)}</text>
              </g>
            ))}
            {right.map((n) => (
              <g
                key={n.id}
                className={`node ${n.id === OTHER ? '' : 'click'}`}
                onPointerEnter={() => setHover(n.id)}
                onPointerLeave={() => setHover(null)}
                onClick={() => clickNode('provider', n.id)}
              >
                <rect x={x1} y={n.y - 5} width={W - x1} height={Math.max(n.h + 10, 26)} fill="transparent" />
                <rect x={x1} y={n.y} width={nodeW} height={n.h} rx={2} className={n.flagged ? 'node-bar flag' : 'node-bar'} />
                <text x={x1 + nodeW + 10} y={n.y + n.h / 2} dy="-.15em" className="node-name">{n.name}</text>
                <text x={x1 + nodeW + 10} y={n.y + n.h / 2} dy="1.05em" className="node-sub">{fmtBytes(n.total)}</text>
              </g>
            ))}
          </g>
        </svg>
      )}
    </div>
  );
}
