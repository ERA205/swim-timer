import {
  formatTime,
  toSegmentSplits,
  type SwimmerState,
} from '../../shared/types';

interface SwimmerPanelProps {
  swimmers: SwimmerState[];
  focusedSwimmerId: number | null;
  totalLaps: number;
  detectionsNeeded: number;
  distanceYards: number;
  raceFinished: boolean;
  departedCount?: number;
  swimmerCount?: number;
}

export function SwimmerPanel({
  swimmers,
  focusedSwimmerId,
  totalLaps,
  detectionsNeeded,
  distanceYards,
  raceFinished,
  departedCount,
  swimmerCount,
}: SwimmerPanelProps) {
  const awaitingDeparture =
    departedCount !== undefined &&
    swimmerCount !== undefined &&
    departedCount < swimmerCount;

  return (
    <div className="swimmer-panel">
      <h3>
        Swimmers
        {swimmerCount !== undefined && ` (${swimmerCount})`}
      </h3>
      {awaitingDeparture && (
        <p className="swimmer-departure-status">
          Waiting for departures: {departedCount}/{swimmerCount} left the wall
        </p>
      )}
      <div className="swimmer-list">
        {swimmers.map((swimmer) => {
          const segments = toSegmentSplits(
            swimmer.splits,
            swimmer.elapsedMs,
            (raceFinished || swimmer.phase === 'done') && swimmer.lapsCompleted >= totalLaps,
            distanceYards,
          );
          const isActive = swimmer.phase !== 'waiting' && swimmer.phase !== 'done';

          return (
            <div
              key={swimmer.id}
              className={`swimmer-card ${swimmer.focused || focusedSwimmerId === swimmer.id ? 'focused' : ''} phase-${swimmer.phase}`}
            >
              <div className="swimmer-card-header">
                <strong>{swimmer.name}</strong>
                <span className="swimmer-phase">{phaseLabel(swimmer.phase)}</span>
              </div>

              <div className="swimmer-metrics">
                <span className="swimmer-time">{formatTime(swimmer.elapsedMs)}</span>
                <span>Laps {swimmer.lapsCompleted}/{totalLaps}</span>
                <span>Touches {swimmer.wallTouches}/{detectionsNeeded}</span>
              </div>

              {swimmer.startOffsetMs !== null && swimmer.startOffsetMs > 0 && (
                <p className="swimmer-stagger">
                  Sent off +{formatTime(swimmer.startOffsetMs)} behind leader
                </p>
              )}
              {swimmer.id === 0 && swimmer.startOffsetMs === 0 && isActive && (
                <p className="swimmer-stagger">Leader — uses main clock</p>
              )}
              {swimmer.phase === 'waiting' && swimmer.startOffsetMs === null && (
                <p className="swimmer-stagger">On wall — not yet sent</p>
              )}

              {segments.length > 0 && (
                <div className="swimmer-splits">
                  {segments.map((seg) => (
                    <span key={`${swimmer.id}-${seg.yards}`}>
                      {seg.yards} yd — {formatTime(seg.segmentMs)}
                    </span>
                  ))}
                </div>
              )}

              {swimmer.phase === 'done' && (
                <span className="swimmer-done">
                  Finished {formatTime(swimmer.elapsedMs)}
                </span>
              )}
            </div>
          );
        })}
      </div>
      <p className="hint">
        Coach sets swimmer count. Leader starts on coach Start; each next track cross records their gap.
        After all leave, returns are tracked — each finisher&apos;s time = main clock minus their gap.
      </p>
    </div>
  );
}

function phaseLabel(phase: SwimmerState['phase']): string {
  switch (phase) {
    case 'waiting':
      return 'On wall';
    case 'out':
      return 'Swimming';
    case 'returning':
      return 'Returning';
    case 'at_wall':
      return 'At wall';
    case 'done':
      return 'Done';
    default:
      return phase;
  }
}
