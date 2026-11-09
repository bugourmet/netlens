import { useMemo, useState } from 'react';
import { useFrame } from '../state/store';
import type { Aggregate } from '../data/types';
import { EntityRow } from './EntityRow';
import { Sheet } from './Sheet';

function EntityPage({ title, kind, rows }: { title: string; kind: 'app' | 'provider'; rows: Aggregate[] }) {
  const [sort, setSort] = useState<'total' | 'rate'>('total');
  const sorted = useMemo(
    () => [...rows].sort((a, b) => Number(b.flagged) - Number(a.flagged) || (sort === 'total' ? b.total - a.total : b.down + b.up - a.down - a.up)),
    [rows, sort],
  );
  const max = Math.max(1, ...rows.map((r) => r.total));
  return (
    <Sheet
      title={title}
      count={rows.length}
      tools={
        <label className="select-wrap">
          Sort
          <select value={sort} onChange={(e) => setSort(e.target.value as 'total' | 'rate')}>
            <option value="total">Total data</option>
            <option value="rate">Current speed</option>
          </select>
        </label>
      }
    >
      <div className="row-header">
        <span>Name</span>
        <span className="num col-a">Active</span>
        <span className="num col-b">Down</span>
        <span className="num col-b">Up</span>
        <span className="num">Total</span>
      </div>
      <div className="list-wide">
        {sorted.map((r) => <EntityRow key={r.id} kind={kind} row={r} max={max} wide />)}
        {rows.length === 0 && <p className="empty">Waiting for traffic.</p>}
      </div>
    </Sheet>
  );
}

export function AppsPage() {
  const frame = useFrame();
  return <EntityPage title="Apps" kind="app" rows={frame.apps} />;
}

export function ProvidersPage() {
  const frame = useFrame();
  return <EntityPage title="Providers" kind="provider" rows={frame.providers} />;
}
