import { Mic } from 'lucide-react';
import { ADC_FULL_SCALE, MICS, relativeLevels } from '../lib/micLevels';
import { detectionStateOf } from '../lib/statusText';
import type { Telemetry } from '../types/protocol';

interface Props {
  live: Telemetry | null;
  simulated: boolean;
}

export function MicrophoneLevels({ live, simulated }: Props) {
  const activity = live?.micActivity ?? null;
  const levels = relativeLevels(activity, live?.micNoiseFloors ?? null, live?.micThresholds ?? null);
  const active = detectionStateOf(live) === 'active';

  return (
    <section className="card panel" aria-labelledby="mic-levels-title">
      <h2 className="panel__title" id="mic-levels-title">
        <Mic aria-hidden /> Mic Levels
        {simulated && <span className="tag tag--demo">SIMULATED</span>}
      </h2>

      <div className="mic-table">
        {MICS.map((mic, i) => {
          const raw = activity ? activity[i] : null;
          const threshold = live?.micThresholds ? live.micThresholds[i] : null;
          const pct = levels ? levels[i] : raw !== null ? (raw / ADC_FULL_SCALE) * 100 : 0;
          const over = raw !== null && threshold !== null && raw > threshold;
          const peak = active && live?.strongestMic === mic.id;

          return (
            <div key={mic.id} className={`mic-row${peak ? ' mic-row--peak' : ''}`}>
              <span className="mic-row__name">
                {mic.label} <span className="muted">({mic.angle}°)</span>
              </span>
              <span className="mic-row__value mono" title="Average peak-to-peak ADC counts over the last 500 ms">
                {raw ?? '—'}
              </span>
              <span className="mic-row__pct mono" title="Relative level (see note below)">
                {levels ? `${Math.round(levels[i])}%` : '—'}
              </span>
              <div
                className="bar"
                role="meter"
                aria-label={`${mic.label} relative level`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(pct)}
              >
                <div className={`bar__fill${over ? ' bar__fill--over' : ''}`} style={{ width: `${pct}%` }} />
                {levels && <div className="bar__threshold" title={`Threshold ${threshold}`} />}
              </div>
              <span className="mic-row__thr mono muted">T {threshold ?? '—'}</span>
            </div>
          );
        })}
      </div>

      <p className="panel__note">
        {activity
          ? 'Numbers: average peak-to-peak ADC counts (12-bit) reported by the ESP32. % and bars are computed here: 0 % = noise floor, tick = threshold (50 %), 100 % = 2× threshold margin.'
          : live
            ? 'No microphone readings while the system is disabled or calibrating.'
            : 'No live readings.'}
      </p>
    </section>
  );
}
