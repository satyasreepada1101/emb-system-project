import { AudioWaveform } from 'lucide-react';
import type { LastDetection } from '../lib/dashboardState';
import { directionLabel } from '../lib/radarGeometry';
import { agoText, detectionStateOf, formatAngle } from '../lib/statusText';
import type { Telemetry } from '../types/protocol';

interface Props {
  live: Telemetry | null;
  lastDetection: LastDetection | null;
  now: number;
  simulated: boolean;
}

const SOUND_TEXT = {
  active: 'Sound Detected',
  listening: 'Listening · No Sound Detected',
  calibrating: 'Calibrating noise floor…',
  disabled: 'System disabled',
  unavailable: 'Live data unavailable',
} as const;

export function DetectedDirection({ live, lastDetection, now, simulated }: Props) {
  const state = detectionStateOf(live);
  const angle = state === 'active' && live ? live.estimatedAngle : null;

  return (
    <>
      <section className="card panel panel--center" aria-labelledby="direction-title">
        <h2 className="panel__title panel__title--center" id="direction-title">
          Detected Direction
          {simulated && <span className="tag tag--demo">SIMULATED</span>}
        </h2>
        <div className={`direction${angle === null ? ' direction--idle' : ''}`} aria-live="polite">
          {angle !== null ? formatAngle(angle) : '--°'}
        </div>
        <div className="direction__range">(From 0° – 180°)</div>
        <div className="direction__sub">
          {angle !== null ? (
            <span className="accent">{directionLabel(angle)}</span>
          ) : lastDetection ? (
            <span className="muted">
              Last detected direction: {formatAngle(lastDetection.angle)} · {agoText(now - lastDetection.at)}
            </span>
          ) : (
            <span className="muted">No direction detected yet</span>
          )}
        </div>
      </section>

      <section className={`card sound-status sound-status--${state}`} role="status" aria-live="polite">
        <AudioWaveform className="sound-status__icon" aria-hidden />
        <span className="sound-status__text">
          {SOUND_TEXT[state]}
          {state === 'calibrating' && live ? ` ${live.calibrationProgress}%` : ''}
        </span>
        <span className="sound-status__dot" aria-hidden />
      </section>
    </>
  );
}
