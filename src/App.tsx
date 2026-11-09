import { useEffect } from 'react';
import { AnimatePresence, MotionConfig } from 'motion/react';
import { engine, useApp } from './state/store';
import { useSettings } from './state/settings';
import { startSource } from './data/source';
import { GlobeStage } from './components/GlobeStage';
import { Hud } from './components/Hud';
import { Timeline } from './components/Timeline';
import { Overview } from './components/Overview';
import { AppsPage, ProvidersPage } from './components/EntityPages';
import { ConnectionsPage } from './components/ConnectionsPage';
import { ActivityPage } from './components/ActivityPage';
import { SettingsPage } from './components/SettingsPage';
import { DetailDrawer } from './components/DetailDrawer';
import { CommandPalette } from './components/CommandPalette';
import { Notices } from './components/Notices';
import { HelpOverlay } from './components/HelpOverlay';
import { CaptureGate } from './components/CaptureGate';
import { ErrorBoundary } from './components/ErrorBoundary';
import { useHotkeys } from './ui/hotkeys';

export function App() {
  const view = useApp((s) => s.view);
  const stage = useApp((s) => s.stage);
  const playing = useApp((s) => s.playing);
  const motionSetting = useSettings((s) => s.motion);
  const quality = useSettings((s) => s.quality);
  const focus = useApp((s) => s.focus);
  const focusKey = focus ? `${focus.type}:${focus.id}` : 'none';

  useEffect(() => startSource(), []);

  // Replay runs at 8x.
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      const s = useApp.getState();
      s.seek((s.playhead ?? engine.now) + 1);
    }, 125);
    return () => clearInterval(id);
  }, [playing]);

  useHotkeys();

  return (
    <MotionConfig reducedMotion={motionSetting === 'reduced' ? 'always' : 'user'} transition={{ type: 'spring', stiffness: 380, damping: 36 }}>
      <ErrorBoundary>
        <div className="app" data-view={view} data-stage={stage} data-quality={quality} data-motion={motionSetting}>
          {/* Without the globe the rest still works, so its failure stays contained. */}
          <ErrorBoundary fallback={<p className="empty">The globe couldn't be drawn. Flows and lists still work.</p>}>
            <GlobeStage />
          </ErrorBoundary>
          <div className="vignette" aria-hidden />
          <Hud />
          <main className="layer">
            {view === 'overview' && <Overview />}
            <AnimatePresence>
              {view === 'apps' && <AppsPage key="apps" />}
              {view === 'providers' && <ProvidersPage key="providers" />}
              {view === 'connections' && <ConnectionsPage key="connections" />}
              {view === 'activity' && <ActivityPage key="activity" />}
              {view === 'settings' && <SettingsPage key="settings" />}
            </AnimatePresence>
            {view === 'overview' && <Timeline />}
            <ErrorBoundary key={focusKey} fallback={null}>
              <DetailDrawer />
            </ErrorBoundary>
            <Notices />
            <CaptureGate />
          </main>
          <p className="credit">
            Locations approximate · Earth imagery: NASA · <a href="https://db-ip.com" target="_blank" rel="noreferrer">IP Geolocation by DB-IP</a>
          </p>
        </div>
        <CommandPalette />
        <HelpOverlay />
      </ErrorBoundary>
    </MotionConfig>
  );
}
