import { AlertTriangle, FlaskConical, Info, Loader2 } from 'lucide-react';
import type { DashboardState, ViewModel } from '../lib/dashboardState';
import { agoText } from '../lib/statusText';

interface Props {
  state: DashboardState;
  view: ViewModel;
  now: number;
}

/** One-line explanation of where the data comes from and whether it is current. */
export function StatusBanner({ state, view, now }: Props) {
  if (state.mode === 'demo') {
    return (
      <div className="banner banner--demo" role="status">
        <FlaskConical size={16} aria-hidden />
        DEMO MODE: all readings are simulated in the browser. No commands are sent to the ESP32.
      </div>
    );
  }

  const simulator = state.device?.device === 'simulator';

  switch (view.dataState) {
    case 'live':
      return simulator ? (
        <div className="banner banner--warn" role="status">
          <AlertTriangle size={16} aria-hidden />
          Connected to the mock ESP32 simulator (scripts/mock-esp32.mjs). These values are NOT from physical hardware.
        </div>
      ) : null;
    case 'connecting':
      return (
        <div className="banner banner--info" role="status">
          <Loader2 size={16} className="spin" aria-hidden /> Connecting to {state.wsUrl}…
        </div>
      );
    case 'waiting':
      return (
        <div className="banner banner--info" role="status">
          <Loader2 size={16} className="spin" aria-hidden /> Connected. Waiting for ESP32 telemetry…
        </div>
      );
    case 'stale':
      return (
        <div className="banner banner--error" role="alert">
          <AlertTriangle size={16} aria-hidden />
          Telemetry stale: last update {view.ageMs !== null ? agoText(view.ageMs) : 'unknown'}. Live data unavailable.
        </div>
      );
    case 'paused':
      return (
        <div className="banner banner--info" role="status">
          <Info size={16} aria-hidden /> Hardware connection paused. Press Connect to resume.
        </div>
      );
    default:
      return (
        <div className="banner banner--error" role="alert">
          <AlertTriangle size={16} aria-hidden />
          ESP32 disconnected: live data unavailable.
          {state.lastUpdateAt ? ` Last telemetry ${agoText(now - state.lastUpdateAt)}.` : ''}
          {state.link.error ? ` (${state.link.error})` : ''}
        </div>
      );
  }
}
