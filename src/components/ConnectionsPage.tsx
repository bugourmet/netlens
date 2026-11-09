import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { apps, placeLabel, places, providers } from '../data/catalog';
import { useApp, useFrame } from '../state/store';
import { fmtBytes, fmtRate } from '../ui/format';
import { Sheet } from './Sheet';

const MAX_ROWS = 300;

export function ConnectionsPage() {
  const frame = useFrame();
  const select = useApp((s) => s.select);
  const [q, setQ] = useState('');
  const [activeOnly, setActiveOnly] = useState(false);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return frame.flows
      .filter((v) => !activeOnly || v.down + v.up > 0)
      .filter((v) => {
        if (!needle) return true;
        const hay = `${apps[v.def.appId]?.name} ${apps[v.def.appId]?.exe} ${v.def.domain} ${providers[v.def.providerId]?.name} ${places[v.def.placeId]?.country} ${v.def.ip}`;
        return hay.toLowerCase().includes(needle);
      })
      .sort((a, b) => b.totalDown + b.totalUp - a.totalDown - a.totalUp);
  }, [frame, q, activeOnly]);

  return (
    <Sheet
      title="Connections"
      count={rows.length}
      tools={
        <>
          <label className="field">
            <Search size={14} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter" aria-label="Filter connections" />
          </label>
          <label className="check">
            <input type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} /> Active only
          </label>
        </>
      }
    >
      <table className="table">
        <thead>
          <tr>
            <th>App</th>
            <th>Destination</th>
            <th className="hide-phone">Provider</th>
            <th className="hide-phone">Location</th>
            <th className="hide-phone">Port</th>
            <th className="num hide-phone">Down</th>
            <th className="num hide-phone">Up</th>
            <th className="num">Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, MAX_ROWS).map((v) => {
            const app = apps[v.def.appId];
            const provider = providers[v.def.providerId];
            const place = places[v.def.placeId];
            const active = v.down + v.up > 0;
            return (
              <tr
                key={v.def.index}
                className={app?.flagged ? 'tr-flag' : ''}
                tabIndex={0}
                onClick={() => select({ type: 'app', id: v.def.appId })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') select({ type: 'app', id: v.def.appId });
                }}
              >
                <td>
                  <span className={`status-dot ${active ? 'on' : ''}`} title={active ? 'Active' : 'Quiet'} />
                  {app?.name}
                </td>
                <td>
                  <div className="domain">{v.def.domain}</div>
                  <div className="domain-sub">{v.def.domain !== v.def.ip && v.def.ip}<span className="show-phone"> · {provider?.name} · {place?.cc}</span></div>
                </td>
                <td className="hide-phone">{provider?.name}</td>
                <td className="hide-phone">{placeLabel(place)}</td>
                <td className="hide-phone num">{v.def.proto} {v.def.port}</td>
                <td className="num hide-phone">{fmtRate(v.down)}</td>
                <td className="num hide-phone">{fmtRate(v.up)}</td>
                <td className="num strong">{fmtBytes(v.totalDown + v.totalUp)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length === 0 && <p className="empty">No connections match.</p>}
      {rows.length > MAX_ROWS && <p className="empty">Showing the top {MAX_ROWS}. Filter to narrow it down.</p>}
    </Sheet>
  );
}
