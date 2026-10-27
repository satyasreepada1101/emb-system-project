import { ConnectionSettings } from './components/ConnectionSettings';
import { DashboardHeader } from './components/DashboardHeader';
import { DetectedDirection } from './components/DetectedDirection';
import { HardwareStatus } from './components/HardwareStatus';
import { LiveSoundIndicator } from './components/LiveSoundIndicator';
import { MicrophoneLevels } from './components/MicrophoneLevels';
import { ModeSwitch } from './components/ModeSwitch';
import { PeakMicrophone } from './components/PeakMicrophone';
import { SemicircleRadar } from './components/SemicircleRadar';
import { StatusBanner } from './components/StatusBanner';
import { SystemControl } from './components/SystemControl';
import { useDashboard } from './hooks/useDashboard';
import { useNow } from './hooks/useNow';
import { deriveView, type DataState } from './lib/dashboardState';

const RADAR_UNAVAILABLE: Record<DataState, string> = {
  demo: '',
  live: '',
  connecting: 'CONNECTING TO ESP32…',
  waiting: 'WAITING FOR ESP32',
  stale: 'TELEMETRY STALE',
  disconnected: 'ESP32 DISCONNECTED',
  paused: 'ESP32 DISCONNECTED',
};

export default function App() {
  const { state, setSystemEnabled, simulateButtonPress, setMode, applySettings, setPaused } = useDashboard();
  const now = useNow(250);
  const view = deriveView(state, now);
  const simulated = state.mode === 'demo';
  const live = view.live;

  return (
    <div className="app">
      <DashboardHeader
        now={now}
        mode={state.mode}
        dataState={view.dataState}
        systemEnabled={live ? live.systemEnabled : null}
      />

      <section className="card controls" aria-label="Controls">
        <ModeSwitch mode={state.mode} onChange={setMode} />
        <SystemControl
          mode={state.mode}
          view={view}
          command={state.command}
          onSetEnabled={setSystemEnabled}
          onSimulateButton={simulateButtonPress}
        />
        <ConnectionSettings state={state} now={now} onApply={applySettings} onPause={setPaused} />
      </section>

      <StatusBanner state={state} view={view} now={now} />

      <main className="radar-wrap">
        {simulated && <span className="radar-wrap__tag tag tag--demo">DEMO · SIMULATED DATA</span>}
        <SemicircleRadar
          live={live}
          lastDetection={state.lastDetection}
          unavailableText={RADAR_UNAVAILABLE[view.dataState]}
        />
      </main>

      <div className="grid">
        <MicrophoneLevels live={live} simulated={simulated} />
        <div className="stack">
          <DetectedDirection live={live} lastDetection={state.lastDetection} now={now} simulated={simulated} />
        </div>
        <div className="stack">
          <LiveSoundIndicator live={live} />
          <PeakMicrophone live={live} lastDetection={state.lastDetection} />
        </div>
      </div>

      <HardwareStatus state={state} view={view} now={now} />

      <footer className="footer">
        ESP32 DevKit V1 · 4 × MAX9814 · SG90 servo · amplitude-based direction estimate (not TDOA) · Mic 1 0°, Mic 2
        60°, Mic 3 120°, Mic 4 180°
      </footer>
    </div>
  );
}
