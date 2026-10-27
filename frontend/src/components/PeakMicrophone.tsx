import { Crosshair } from 'lucide-react';
import type { LastDetection } from '../lib/dashboardState';
import { MICS, micName } from '../lib/micLevels';
import { detectionStateOf, formatAngle } from '../lib/statusText';
import type { Telemetry } from '../types/protocol';

interface Props {
  live: Telemetry | null;
  lastDetection: LastDetection | null;
}

export function PeakMicrophone({ live, lastDetection }: Props) {
  const peak =
    detectionStateOf(live) === 'active' && live ? MICS.find((m) => m.id === live.strongestMic) : undefined;

  return (
    <section className="card panel" aria-labelledby="peak-mic-title">
      <h2 className="panel__title" id="peak-mic-title">
        <Crosshair aria-hidden /> Peak Microphone
      </h2>
      <div className={`peak-box${peak ? '' : ' peak-box--idle'}`}>
        {peak ? `${peak.label} (${peak.angle}°)` : 'No qualifying sound'}
      </div>
      <p className="panel__note">
        {peak && live?.estimatedAngle != null ? (
          <>
            Fixed mic position {peak.angle}° · interpolated direction {formatAngle(live.estimatedAngle)}
          </>
        ) : lastDetection?.strongestMic ? (
          <>Last peak: {micName(lastDetection.strongestMic)}</>
        ) : (
          'Strongest microphone above its threshold, as reported by the ESP32.'
        )}
      </p>
    </section>
  );
}
