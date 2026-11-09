import type { CSSProperties, ReactNode } from 'react';
import { LayoutGroup, motion } from 'motion/react';
import countryRows from '../../native/NetLens.Core/countries.json';
import { systemHome } from '../data/catalog';
import { useApp } from '../state/store';
import { useSettings, type Settings } from '../state/settings';
import { Sheet } from './Sheet';

function Row({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="set-row">
      <div className="set-text">
        <b>{title}</b>
        {hint && <span>{hint}</span>}
      </div>
      <div className="set-control">{children}</div>
    </div>
  );
}

type BooleanSetting = { [K in keyof Settings]: Settings[K] extends boolean ? K : never }[keyof Settings];
type ChoiceSetting = 'quality' | 'units' | 'motion' | 'captureMode';

function Toggle({ name, label }: { name: BooleanSetting; label: string }) {
  const value = useSettings((s) => s[name]);
  const set = useSettings((s) => s.set);
  return (
    <button className={`toggle ${value ? 'on' : ''}`} role="switch" aria-checked={value} aria-label={label} onClick={() => set(name, !value)}>
      <motion.span layout className="knob" transition={{ type: 'spring', stiffness: 620, damping: 34 }} />
    </button>
  );
}

function Choice<K extends ChoiceSetting>({ name, options, label }: { name: K; options: { value: Settings[K]; label: string }[]; label: string }) {
  const value = useSettings((s) => s[name]);
  const set = useSettings((s) => s.set);
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      <LayoutGroup id={`set-${name}`}>
        {options.map((o) => (
          <button key={String(o.value)} role="radio" aria-checked={value === o.value} onClick={() => set(name, o.value)}>
            {value === o.value && <motion.span layoutId="pill" className="seg-pill" />}
            <span>{o.label}</span>
          </button>
        ))}
      </LayoutGroup>
    </div>
  );
}

function Slider({ name, min, max, step, label, format }: { name: 'rotateSpeed' | 'arcLimit'; min: number; max: number; step: number; label: string; format: (v: number) => string }) {
  const value = useSettings((s) => s[name]);
  const set = useSettings((s) => s.set);
  return (
    <label className="slider">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        style={{ '--fill': `${((value - min) / (max - min)) * 100}%` } as CSSProperties}
        onChange={(e) => set(name, Number(e.target.value))}
      />
      <span className="mono">{format(value)}</span>
    </label>
  );
}

function modeLabel(state: string, kind: string) {
  if (kind === 'demo') return 'Demo data';
  if (state === 'full') return 'Full capture, with admin';
  if (state === 'limited') return 'Limited, without admin';
  return 'Not capturing';
}

export function SettingsPage() {
  const homeCc = useSettings((s) => s.homeCc);
  const set = useSettings((s) => s.set);
  const reset = useSettings((s) => s.reset);
  const rotate = useSettings((s) => s.rotate);
  const status = useApp((s) => s.status);
  const countries = [...(countryRows as { cc: string; name: string }[])].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <Sheet title="Settings" tools={<button className="btn" onClick={reset}>Reset to defaults</button>}>
      <div className="set-grid">
        <section className="set-group">
          <h2>Planet</h2>
          <Row title="Graphics" hint="Battery turns off the glow and lowers resolution.">
            <Choice name="quality" label="Graphics quality" options={[{ value: 'ultra', label: 'Ultra' }, { value: 'balanced', label: 'Balanced' }, { value: 'battery', label: 'Battery' }]} />
          </Row>
          <Row title="Real sunlight" hint="Shows day and night as they are now. Off keeps the whole planet at night.">
            <Toggle name="sunlight" label="Real sunlight" />
          </Row>
          <Row title="Stars"><Toggle name="stars" label="Stars" /></Row>
          <Row title="Slow rotation"><Toggle name="rotate" label="Slow rotation" /></Row>
          {rotate && (
            <Row title="Rotation speed">
              <Slider name="rotateSpeed" min={0.05} max={1.5} step={0.05} label="Rotation speed" format={(v) => `${v.toFixed(2)}x`} />
            </Row>
          )}
          <Row title="Connections drawn" hint="The busiest are shown first. Flagged ones always stay.">
            <Slider name="arcLimit" min={5} max={100} step={5} label="Connections drawn" format={(v) => String(v)} />
          </Row>
        </section>

        <section className="set-group">
          <h2>Motion and display</h2>
          <Row title="Animation" hint="Reduced removes camera flights and transitions.">
            <Choice name="motion" label="Animation" options={[{ value: 'full', label: 'Full' }, { value: 'reduced', label: 'Reduced' }]} />
          </Row>
          <Row title="Speed units">
            <Choice name="units" label="Speed units" options={[{ value: 'bytes', label: 'MB/s' }, { value: 'bits', label: 'Mb/s' }]} />
          </Row>
          <Row title="Your location" hint={`Where arcs start. Default is ${systemHome.label || 'your system region'}.`}>
            <label className="select-wrap">
              <select value={homeCc} onChange={(e) => set('homeCc', e.target.value)} aria-label="Your location">
                <option value="">System region</option>
                {countries.map((c) => <option key={c.cc} value={c.cc}>{c.name}</option>)}
              </select>
            </label>
          </Row>

          <h2>Capture</h2>
          <Row title="Start automatically" hint="Off asks before each start. Full capture still shows the Windows admin prompt.">
            <Toggle name="autoStart" label="Start capture automatically" />
          </Row>
          <Row title="Capture mode" hint="Limited needs no admin, but shows no traffic amounts, UDP or domain names.">
            <Choice name="captureMode" label="Capture mode" options={[{ value: 'full', label: 'Full' }, { value: 'limited', label: 'Limited' }]} />
          </Row>

          <h2>Alerts and data</h2>
          <Row title="Pop-up alerts" hint="New events are always listed in Activity.">
            <Toggle name="toasts" label="Pop-up alerts" />
          </Row>
          <Row title="Local network traffic" hint="Devices on your own network, such as your router.">
            <Toggle name="showLocal" label="Local network traffic" />
          </Row>

          <h2>About</h2>
          <dl className="about">
            <div><dt>Capture</dt><dd>{modeLabel(status.state, status.kind)}</dd></div>
            <div><dt>History</dt><dd>Last 30 minutes, in memory</dd></div>
            <div><dt>Privacy</dt><dd>Everything stays on this device</dd></div>
            <div><dt>Encrypted traffic</dt><dd>Shows who and how much, never the content</dd></div>
            <div>
              <dt>IP data</dt>
              <dd>
                <a href="https://db-ip.com" target="_blank" rel="noreferrer">IP Geolocation by DB-IP</a>,{' '}
                <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a>
              </dd>
            </div>
            <div><dt>Earth imagery</dt><dd>Courtesy of NASA. No endorsement implied.</dd></div>
            <div><dt>Map data</dt><dd><a href="https://www.naturalearthdata.com" target="_blank" rel="noreferrer">Natural Earth</a></dd></div>
            <div><dt>Licences</dt><dd>MIT. See THIRD_PARTY_NOTICES.md in the app folder.</dd></div>
          </dl>
        </section>
      </div>
    </Sheet>
  );
}
