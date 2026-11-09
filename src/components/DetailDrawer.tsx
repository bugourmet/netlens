import { useMemo } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { AlertTriangle, BadgeCheck, Clock, FolderOpen, X } from 'lucide-react';
import { series } from '../data/engine';
import { apps, placeLabel, places, providers, publisherLabel, trustNotes } from '../data/catalog';
import { engine, useApp, useFrame } from '../state/store';
import { fmtAgo, fmtBytes, fmtRate } from '../ui/format';

const SPARK_W = 340;
const SPARK_H = 72;

function Spark() {
  const focus = useApp((s) => s.focus);
  const frame = useFrame();
  const paths = useMemo(() => {
    // A new frame object means new samples, even when the index stays at "latest".
    const { down, up } = series(engine, focus, 120, 120, frame.idx);
    const max = Math.max(1, ...down, ...up);
    const toPath = (v: Float64Array) =>
      Array.from(v, (y, i) => `${i ? 'L' : 'M'}${((i / Math.max(1, v.length - 1)) * SPARK_W).toFixed(1)} ${(SPARK_H - 2 - (y / max) * (SPARK_H - 6)).toFixed(1)}`).join('');
    return { down: toPath(down), up: toPath(up) };
  }, [focus, frame]);
  return (
    <figure className="spark">
      <figcaption>
        Last 2 minutes
        <span className="tl-legend"><i className="dot bg-down" />Download <i className="dot bg-up" />Upload</span>
      </figcaption>
      <svg viewBox={`0 0 ${SPARK_W} ${SPARK_H}`} preserveAspectRatio="none" role="img" aria-label="Speed over the last two minutes">
        <line x1={0} x2={SPARK_W} y1={SPARK_H - 0.5} y2={SPARK_H - 0.5} className="tl-base" />
        <path d={paths.down} className="tl-line" stroke="var(--down)" vectorEffect="non-scaling-stroke" />
        <path d={paths.up} className="tl-line" stroke="var(--up)" vectorEffect="non-scaling-stroke" />
      </svg>
    </figure>
  );
}

function AppBody({ id }: { id: string }) {
  const app = apps[id];
  const frame = useFrame();
  const select = useApp((s) => s.select);
  // After capture restarts, an app is unknown until it uses the network again.
  if (!app) return <p className="empty">Waiting for this app to show up in capture again.</p>;
  const agg = frame.apps.find((a) => a.id === id);
  const firstSeen = engine.events.find((e) => e.appId === id)?.t;
  const label = publisherLabel(app);
  return (
    <>
      <div className="badges">
        {app.publisher ? (
          <span className="badge good"><BadgeCheck size={13} /> Signed by {app.publisher}</span>
        ) : label === 'Unsigned' ? (
          <span className="badge serious"><AlertTriangle size={13} /> Unsigned</span>
        ) : (
          <span className="badge">{label}</span>
        )}
        {trustNotes(app).map((n) => (
          <span key={n} className="badge warning"><AlertTriangle size={13} /> {n}</span>
        ))}
        {firstSeen !== undefined && <span className="badge"><Clock size={13} /> First seen {fmtAgo(engine.now - firstSeen)}</span>}
      </div>
      {app.path && <p className="path"><FolderOpen size={13} /> <code>{app.path}</code></p>}
      <Stats down={agg?.down ?? 0} up={agg?.up ?? 0} total={agg?.total ?? 0} />
      <Spark />
      <h3>Destinations</h3>
      <ul className="dest">
        {[...frame.flows].sort((a, b) => b.totalDown + b.totalUp - a.totalDown - a.totalUp).slice(0, 100).map((v) => (
          <li key={v.def.index}>
            <button onClick={() => select({ type: 'provider', id: v.def.providerId })}>
              <span className={`status-dot ${v.down + v.up > 0 ? 'on' : ''}`} />
              <span className="dest-main">
                <b>{v.def.domain}</b>
                <small>{providers[v.def.providerId]?.name} · {placeLabel(places[v.def.placeId])}</small>
              </span>
              <span className="num">{fmtBytes(v.totalDown + v.totalUp)}</span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

function ProviderBody({ id }: { id: string }) {
  const provider = providers[id];
  const frame = useFrame();
  const select = useApp((s) => s.select);
  if (!provider) return <p className="empty">Waiting for this provider to show up in capture again.</p>;
  const agg = frame.providers.find((a) => a.id === id);
  const locations = [...new Set(frame.flows.map((v) => placeLabel(places[v.def.placeId])))];
  return (
    <>
      <div className="badges">
        {provider.asn && <span className="badge">{provider.asn}</span>}
        <span className="badge">{provider.category}</span>
        <span className="badge">{locations.join(', ')}</span>
      </div>
      <Stats down={agg?.down ?? 0} up={agg?.up ?? 0} total={agg?.total ?? 0} />
      <Spark />
      <h3>Apps using this provider</h3>
      <ul className="dest">
        {frame.apps.map((a) => (
          <li key={a.id}>
            <button onClick={() => select({ type: 'app', id: a.id })}>
              <span className={`status-dot ${a.down + a.up > 0 ? 'on' : ''}`} />
              <span className="dest-main">
                <b>{apps[a.id]?.name ?? a.id}</b>
                <small>{a.flows} {a.flows === 1 ? 'connection' : 'connections'}</small>
              </span>
              <span className="num">{fmtBytes(a.total)}</span>
            </button>
          </li>
        ))}
      </ul>
      <h3>Domains</h3>
      <ul className="domains">
        {[...new Set(frame.flows.map((v) => v.def.domain))].slice(0, 100).map((d) => <li key={d}><code>{d}</code></li>)}
      </ul>
    </>
  );
}

function Stats({ down, up, total }: { down: number; up: number; total: number }) {
  return (
    <div className="stats">
      <div><strong>{fmtRate(down)}</strong><span>Download</span></div>
      <div><strong>{fmtRate(up)}</strong><span>Upload</span></div>
      <div><strong>{fmtBytes(total)}</strong><span>30 min total</span></div>
    </div>
  );
}

export function DetailDrawer() {
  const open = useApp((s) => s.drawer);
  const focus = useApp((s) => s.focus);
  const close = useApp((s) => s.closeDrawer);
  const show = open && focus && focus.type !== 'country';
  const name = focus?.type === 'app' ? apps[focus.id]?.name : focus?.type === 'provider' ? providers[focus.id]?.name : '';
  const sub = focus?.type === 'app' ? apps[focus.id]?.exe : focus?.type === 'provider' ? 'Provider' : '';

  return (
    <AnimatePresence>
      {show && focus && (
        <motion.aside
          className={`drawer glass ${focus.type === 'app' && apps[focus.id]?.flagged ? 'alarm' : ''}`}
          aria-label={`${name} details`}
          initial={{ opacity: 0, x: 40, scale: 0.98 }}
          animate={{ opacity: 1, x: 0, scale: 1 }}
          exit={{ opacity: 0, x: 40, scale: 0.98 }}
        >
          <header className="drawer-head">
            <div>
              <h2>{name}</h2>
              <small>{sub}</small>
            </div>
            <button className="icon-btn" aria-label="Close details" onClick={close}><X size={16} /></button>
          </header>
          <div className="drawer-body" key={`${focus.type}:${focus.id}`}>
            {focus.type === 'app' ? <AppBody id={focus.id} /> : <ProviderBody id={focus.id} />}
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
