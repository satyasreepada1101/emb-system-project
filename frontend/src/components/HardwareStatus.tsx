import { Cpu } from 'lucide-react';
import type { DashboardState, ViewModel } from '../lib/dashboardState';
import { agoText, connectionText, formatAngle, sourceText, uptimeText } from '../lib/statusText';

interface Props {
  state: DashboardState;
  view: ViewModel;
  now: number;
}

type Tone = 'on' | 'off' | 'warn' | 'muted';

function Item({ label, value, tone = 'muted', led }: { label: string; value: string; tone?: Tone; led?: boolean }) {
  return (
    <div className="hw-item">
      <span className="hw-item__label">{label}</span>
      <span className={`hw-item__value hw-item__value--${tone}`}>
        {led && <span className={`led led--${tone}`} aria-hidden />}
        {value}
      </span>
    </div>
  );
}

export function HardwareStatus({ state, view, now }: Props) {
  const t = view.live;
  const demo = state.mode === 'demo';
  const na = 'Unavailable';

  const connTone: Tone = demo
    ? 'muted'
    : view.dataState === 'live'
      ? 'on'
      : view.dataState === 'stale' || view.dataState === 'waiting' || view.dataState === 'connecting'
        ? 'warn'
        : 'off';

  return (
    <section className="card panel" aria-labelledby="hw-title">
      <h2 className="panel__title" id="hw-title">
        <Cpu aria-hidden /> Hardware Status
        {demo && <span className="tag tag--demo">SIMULATED</span>}
        {!demo && state.device?.device === 'simulator' && <span className="tag tag--warn">MOCK SIMULATOR</span>}
      </h2>

      <div className="hw-grid">
        <Item label="ESP32 connection" value={connectionText(state.mode, view.dataState)} tone={connTone} />
        <Item
          label="System"
          value={t ? `${t.systemEnabled ? 'Enabled' : 'Disabled'} (by ${sourceText(t.enableSource)})` : na}
          tone={t ? (t.systemEnabled ? 'on' : 'off') : 'muted'}
        />
        <Item
          label="Sound detection"
          value={t ? (!t.systemEnabled ? 'Off' : t.soundDetected ? 'Sound detected' : 'No sound') : na}
          tone={t ? (t.soundDetected ? 'on' : 'muted') : 'muted'}
        />
        <Item label="LED 1 · system" value={t ? (t.led1On ? 'ON' : 'OFF') : na} tone={t?.led1On ? 'on' : 'off'} led />
        <Item label="LED 2 · sound" value={t ? (t.led2On ? 'ON' : 'OFF') : na} tone={t?.led2On ? 'on' : 'off'} led />
        <Item
          label="Calibration"
          value={t ? (t.calibrating ? `In progress ${t.calibrationProgress}%` : t.calibrated ? 'Complete' : 'Not calibrated') : na}
          tone={t ? (t.calibrating ? 'warn' : t.calibrated ? 'on' : 'off') : 'muted'}
        />
        <Item label="Servo target" value={t?.servoTarget != null ? `${t.servoTarget}°` : na} />
        <Item
          label="Smoothed direction (servo)"
          value={t ? (t.smoothedAngle !== null ? formatAngle(t.smoothedAngle) : 'None yet') : na}
        />
        <Item label="Mode" value={demo ? 'DEMO (simulated)' : 'HARDWARE'} tone={demo ? 'warn' : 'on'} />
        <Item
          label="Last telemetry update"
          value={
            state.lastUpdateAt
              ? `${new Date(state.lastUpdateAt).toLocaleTimeString(undefined, { hour12: false })} · ${agoText(now - state.lastUpdateAt)}`
              : 'Never'
          }
          tone={view.isLive ? 'on' : state.lastUpdateAt ? 'warn' : 'muted'}
        />
        <Item label="Uptime · sequence" value={t ? `${uptimeText(t.uptimeMs)} · #${t.sequence}` : na} />
        <Item
          label={demo ? 'Firmware' : 'Firmware · Wi-Fi signal'}
          value={
            demo
              ? 'Demo simulator'
              : state.device
                ? `${state.device.firmware}${t?.rssi != null ? ` · ${t.rssi} dBm` : ''}`
                : na
          }
        />
      </div>

      <p className="panel__note">
        LED values are the logical states the ESP32 commands on its GPIO pins, not independent electrical measurements.
        {state.protocolErrors > 0 &&
          ` ${state.protocolErrors} malformed message(s) ignored (last: ${state.lastProtocolError}).`}
        {state.lastDeviceError && ` ESP32 reported: ${state.lastDeviceError}.`}
      </p>
    </section>
  );
}
