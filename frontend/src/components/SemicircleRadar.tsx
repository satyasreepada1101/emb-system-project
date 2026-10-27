import { Mic, Volume2 } from 'lucide-react';
import { useAnimatedAngle } from '../hooks/useAnimatedAngle';
import type { LastDetection } from '../lib/dashboardState';
import { MICS } from '../lib/micLevels';
import { RADAR, polar, semicirclePath, wedgePath } from '../lib/radarGeometry';
import { detectionStateOf, formatAngle } from '../lib/statusText';
import type { Telemetry } from '../types/protocol';

interface Props {
  live: Telemetry | null;
  lastDetection: LastDetection | null;
  unavailableText: string;
}

const { cx, cy, r } = RADAR;
const RINGS = [0.2, 0.4, 0.6, 0.8];
const RADIALS = [30, 60, 90, 120, 150];
const LABELS = [0, 30, 60, 90, 120, 150, 180];
const TICKS = Array.from({ length: 91 }, (_, i) => i * 2);
const SOURCE_RADIUS = r * 0.72;

function tickLength(angle: number): number {
  if (angle % 30 === 0) return 26;
  if (angle % 10 === 0) return 16;
  return 8;
}

export function SemicircleRadar({ live, lastDetection, unavailableText }: Props) {
  const state = detectionStateOf(live);
  const target = state === 'active' && live ? live.estimatedAngle : null;
  const shown = useAnimatedAngle(target);
  const inactive = state === 'unavailable' || state === 'disabled';

  let centreText = '';
  if (state === 'unavailable') centreText = unavailableText;
  else if (state === 'disabled') centreText = 'SYSTEM DISABLED';
  else if (state === 'calibrating') centreText = `CALIBRATING ${live?.calibrationProgress ?? 0}%`;
  else if (state === 'listening') centreText = 'LISTENING · NO SOUND';

  const ariaLabel =
    state === 'active' && target !== null
      ? `Radar: sound detected at ${formatAngle(target)}`
      : `Radar: ${centreText.toLowerCase()}`;

  const ghost = state === 'listening' && lastDetection ? lastDetection.angle : null;

  return (
    <svg
      className={`radar radar--${state}`}
      viewBox={`0 0 ${RADAR.width} ${RADAR.height}`}
      role="img"
      aria-label={ariaLabel}
    >
      <defs>
        <radialGradient id="beamGradient" cx={cx} cy={cy} r={r} gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.05" />
          <stop offset="70%" stopColor="var(--accent)" stopOpacity="0.35" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.6" />
        </radialGradient>
        <radialGradient id="radarFill" cx={cx} cy={cy} r={r} gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.02" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.09" />
        </radialGradient>
        <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="5" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <g className={inactive ? 'radar__grid radar__grid--dim' : 'radar__grid'}>
        <path d={`${semicirclePath(r)} Z`} fill="url(#radarFill)" stroke="none" />

        {RINGS.map((f) => (
          <path key={f} d={semicirclePath(r * f)} className="radar__ring" />
        ))}

        {RADIALS.map((a) => {
          const p = polar(a, r);
          return (
            <line key={a} x1={cx} y1={cy} x2={p.x} y2={p.y} className="radar__radial" />
          );
        })}

        {TICKS.map((a) => {
          const outer = polar(a, r);
          const inner = polar(a, r - tickLength(a));
          return (
            <line
              key={a}
              x1={outer.x}
              y1={outer.y}
              x2={inner.x}
              y2={inner.y}
              className={a % 10 === 0 ? 'radar__tick radar__tick--major' : 'radar__tick'}
            />
          );
        })}

        <path d={semicirclePath(r)} className="radar__outline" filter="url(#glow)" />
        <line x1={cx - r} y1={cy} x2={cx + r} y2={cy} className="radar__outline" />
        <circle cx={cx - r} cy={cy} r={6} className="radar__endpoint" />
        <circle cx={cx + r} cy={cy} r={6} className="radar__endpoint" />
        <circle cx={cx} cy={cy} r={5} className="radar__endpoint" />

        {LABELS.map((a) => {
          if (a === 0 || a === 180) {
            return (
              <text
                key={a}
                x={a === 0 ? cx + r + 16 : cx - r - 16}
                y={cy - 14}
                textAnchor={a === 0 ? 'start' : 'end'}
                className="radar__label"
              >
                {a}°
              </text>
            );
          }
          const p = polar(a, r + 40);
          return (
            <text key={a} x={p.x} y={p.y + 10} textAnchor="middle" className="radar__label">
              {a}°
            </text>
          );
        })}
      </g>

      {/* Last detection (historical only, clearly not live) */}
      {ghost !== null && (
        <g className="radar__ghost">
          <line
            x1={cx}
            y1={cy}
            x2={polar(ghost, r).x}
            y2={polar(ghost, r).y}
            strokeDasharray="6 8"
          />
          <text x={polar(ghost, r * 0.5).x} y={polar(ghost, r * 0.5).y - 12} textAnchor="middle">
            last {formatAngle(ghost)}
          </text>
        </g>
      )}

      {/* Live beam: geometry, source icon and readout all come from one angle */}
      {shown !== null && target !== null && (
        <g className="radar__beam">
          <path d={wedgePath(shown, 5)} fill="url(#beamGradient)" />
          <line
            x1={cx}
            y1={cy}
            x2={polar(shown, r).x}
            y2={polar(shown, r).y}
            className="radar__beam-line"
            filter="url(#glow)"
          />
          <g transform={`translate(${polar(shown, SOURCE_RADIUS).x} ${polar(shown, SOURCE_RADIUS).y})`}>
            <circle r={34} className="radar__pulse" />
            <circle r={34} className="radar__pulse radar__pulse--late" />
            <circle r={26} className="radar__source" filter="url(#glow)" />
            <Volume2 x={-16} y={-16} width={32} height={32} className="radar__source-icon" aria-hidden />
          </g>
        </g>
      )}

      {/* Fixed microphone positions (never rotate) */}
      {MICS.map((mic) => {
        const p = polar(mic.angle, r);
        const strongest = state === 'active' && live?.strongestMic === mic.id;
        const labelPos =
          mic.angle === 0 || mic.angle === 180
            ? { x: p.x + (mic.angle === 0 ? -34 : 34), y: p.y + 38 }
            : { x: polar(mic.angle, r - 50).x, y: polar(mic.angle, r - 50).y + 6 };
        return (
          <g key={mic.id} className={strongest ? 'radar__mic radar__mic--peak' : 'radar__mic'}>
            <circle cx={p.x} cy={p.y} r={19} />
            <Mic x={p.x - 11} y={p.y - 11} width={22} height={22} aria-hidden />
            <text x={labelPos.x} y={labelPos.y} textAnchor="middle">
              M{mic.id}
            </text>
          </g>
        );
      })}

      {state === 'active' && target !== null ? (
        <text x={cx} y={cy - 26} textAnchor="middle" className="radar__readout">
          {formatAngle(target)}
        </text>
      ) : (
        <text x={cx} y={cy - 26} textAnchor="middle" className="radar__status">
          {centreText}
        </text>
      )}
    </svg>
  );
}
