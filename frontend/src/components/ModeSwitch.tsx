import { Cpu, FlaskConical } from 'lucide-react';
import type { Mode } from '../lib/dashboardState';

interface Props {
  mode: Mode;
  onChange(mode: Mode): void;
}

export function ModeSwitch({ mode, onChange }: Props) {
  return (
    <div className="control-block">
      <span className="control-block__title">Data source</span>
      <div className="segmented" role="group" aria-label="Data source mode">
        <button type="button" aria-pressed={mode === 'demo'} onClick={() => onChange('demo')}>
          <FlaskConical size={15} aria-hidden /> Demo
        </button>
        <button type="button" aria-pressed={mode === 'hardware'} onClick={() => onChange('hardware')}>
          <Cpu size={15} aria-hidden /> Hardware
        </button>
      </div>
      <span className="hint">
        {mode === 'demo'
          ? 'Simulated readings. Nothing is sent to the ESP32.'
          : 'Live telemetry from the ESP32 over Wi-Fi.'}
      </span>
    </div>
  );
}
