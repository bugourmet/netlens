import { LayoutGroup, motion } from 'motion/react';
import { useApp, useFrame, type StageMode } from '../state/store';
import { FlowsStage } from './FlowsStage';
import { EntityRow } from './EntityRow';
import { Instrument } from './Instrument';

const modes: { id: StageMode; label: string }[] = [
  { id: 'globe', label: 'Globe' },
  { id: 'flows', label: 'Flows' },
];

export function Overview() {
  const stage = useApp((s) => s.stage);
  const setStage = useApp((s) => s.setStage);
  const frame = useFrame();
  const tab = useApp((s) => s.sideTab);
  const setTab = useApp((s) => s.setSideTab);
  const rows = tab === 'app' ? frame.apps : frame.providers;
  const max = Math.max(1, ...rows.map((r) => r.total));

  return (
    <div className="overview">
      {stage === 'flows' && <FlowsStage />}
      <div className="segmented stage-toggle glass rise" role="tablist" aria-label="Live view" style={{ animationDelay: '.15s' }}>
        <LayoutGroup id="stage-seg">
          {modes.map((m) => (
            <button key={m.id} role="tab" aria-selected={stage === m.id} onClick={() => setStage(m.id)}>
              {stage === m.id && <motion.span layoutId="seg" className="seg-pill" />}
              <span>{m.label}</span>
            </button>
          ))}
        </LayoutGroup>
      </div>

      <Instrument />

      <aside className="side glass rise" style={{ animationDelay: '.35s' }}>
        <div className="side-tabs" role="tablist" aria-label="Group by">
          <LayoutGroup id="side-seg">
            {(['app', 'provider'] as const).map((t) => (
              <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
                {t === 'app' ? 'Apps' : 'Providers'} <span className="mono">{t === 'app' ? frame.apps.length : frame.providers.length}</span>
                {tab === t && <motion.span layoutId="side-mark" className="side-mark" />}
              </button>
            ))}
          </LayoutGroup>
        </div>
        <div className="side-list">
          {rows.map((r) => <EntityRow key={r.id} kind={tab} row={r} max={max} />)}
          {rows.length === 0 && <p className="empty">Waiting for traffic.</p>}
        </div>
      </aside>
    </div>
  );
}
