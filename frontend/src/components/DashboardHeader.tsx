import { AudioWaveform, FlaskConical, Power, Wifi, WifiOff } from 'lucide-react';
import type { DataState, Mode } from '../lib/dashboardState';
import { connectionText } from '../lib/statusText';

interface Props {
  now: number;
  mode: Mode;
  dataState: DataState;
  /** Confirmed system state from live telemetry; null when unknown. */
  systemEnabled: boolean | null;
}

export function DashboardHeader({ now, mode, dataState, systemEnabled }: Props) {
  const date = new Date(now);
  const linkOk = mode === 'hardware' && dataState === 'live';
  const linkWarn =
    mode === 'hardware' &&
    (dataState === 'waiting' || dataState === 'connecting' || dataState === 'stale');
  const linkClass = linkOk ? 'pill--on' : linkWarn ? 'pill--warn' : mode === 'demo' ? 'pill--muted' : 'pill--off';
  const systemClass = systemEnabled === null ? 'pill--muted' : systemEnabled ? 'pill--on' : 'pill--off';

  return (
    <header className="card header">
      <div className="header__brand">
        <AudioWaveform className="header__logo" aria-hidden />
        <div>
          <h1>
            Sound <span className="accent">Direction Finder</span>
          </h1>
          <p className="header__subtitle">Locate the direction of the sound source in real time</p>
        </div>
      </div>

      <div className="header__status">
        <span className={`badge badge--${mode}`}>
          {mode === 'demo' && <FlaskConical size={15} aria-hidden />}
          {mode === 'demo' ? 'DEMO MODE' : 'HARDWARE'}
        </span>

        <span className={`pill ${systemClass}`} title="Detection system state confirmed by telemetry">
          <Power size={15} aria-hidden />
          {systemEnabled === null ? 'System state unknown' : systemEnabled ? 'System ON' : 'System OFF'}
        </span>

        <span className={`pill ${linkClass}`}>
          {linkOk || linkWarn ? <Wifi size={15} aria-hidden /> : <WifiOff size={15} aria-hidden />}
          {connectionText(mode, dataState)}
        </span>

        <div className="header__clock" aria-label="Current date and time">
          <span>{date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
          <span className="mono">{date.toLocaleTimeString(undefined, { hour12: false })}</span>
        </div>
      </div>
    </header>
  );
}
