import { Volume2 } from 'lucide-react';
import { overallLevel, relativeLevels } from '../lib/micLevels';
import { detectionStateOf } from '../lib/statusText';
import type { Telemetry } from '../types/protocol';

interface Props {
  live: Telemetry | null;
}

const SEGMENTS = 16;

/** Level = loudest microphone's relative level (see lib/micLevels.ts). */
export function LiveSoundIndicator({ live }: Props) {
  const state = detectionStateOf(live);
  const level = overallLevel(
    relativeLevels(live?.micActivity ?? null, live?.micNoiseFloors ?? null, live?.micThresholds ?? null),
  );
  const lit = level === null ? 0 : Math.round((level / 100) * SEGMENTS);

  let caption = 'No live data';
  if (state === 'active') caption = 'Sound Detected';
  else if (state === 'listening') caption = 'Listening';
  else if (state === 'disabled') caption = 'System disabled';
  else if (state === 'calibrating') caption = 'Calibrating';

  return (
    <section className="card panel" aria-labelledby="live-sound-title">
      <h2 className="panel__title" id="live-sound-title">
        <Volume2 aria-hidden /> Live Sound Indicator
      </h2>
      <div
        className={`segments segments--${state}`}
        role="meter"
        aria-label="Loudest microphone relative level"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={level === null ? 0 : Math.round(level)}
      >
        {Array.from({ length: SEGMENTS }, (_, i) => (
          <span
            key={i}
            className={`segment${i < lit ? ' segment--on' : ''}${i >= SEGMENTS / 2 ? ' segment--high' : ''}`}
          />
        ))}
      </div>
      <div className="segments__caption">
        <span className={state === 'active' ? 'accent' : 'muted'}>{caption}</span>
        <span className="mono muted">{level === null ? '—' : `${Math.round(level)}%`}</span>
      </div>
    </section>
  );
}
