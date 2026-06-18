import { formatTime, type SwimmerState } from '../../shared/types';

interface SwimmerPanelProps {
  swimmers: SwimmerState[];
  focusedSwimmerId: number | null;
  totalLaps: number;
  distanceYards: number;
  raceFinished: boolean;
}

export function SwimmerPanel({
  swimmers,
  focusedSwimmerId,
  totalLaps,
  distanceYards,
  raceFinished,
}: SwimmerPanelProps) {
  return (
    <div className="swimmer-panel">
      <h3>Swimmers</h3>
      <div className="swimmer-list">
        {swimmers.map((swimmer) => (
          <div
            key={swimmer.id}
            className={`swimmer-card ${swimmer.focused || focusedSwimmerId === swimmer.id ? 'focused' : ''} phase-${swimmer.phase}`}
          >
            <div className="swimmer-card-header">
              <strong>{swimmer.name}</strong>
              <span className="swimmer-phase">{phaseLabel(swimmer.phase)}</span>
            </div>
            <div className="swimmer-metrics">
              <span>Laps {swimmer.lapsCompleted}/{totalLaps}</span>
              {swimmer.id === 0 && swimmer.startOffsetMs === 0 && (
                <span>First away</span>
              )}
              {swimmer.startOffsetMs !== null && swimmer.startOffsetMs > 0 && (
                <span>+{formatTime(swimmer.startOffsetMs)} behind first away</span>
              )}
              {swimmer.phase === 'waiting' && swimmer.startOffsetMs === null && (
                <span>On wall</span>
              )}
            </div>
            {swimmer.splits.length > 0 && (
              <div className="swimmer-splits">
                {swimmer.splits.map((split) => (
                  <span key={`${swimmer.id}-${split.yards}`}>
                    {split.yards} yd @ {formatTime(split.elapsedMs)}
                  </span>
                ))}
              </div>
            )}
            {raceFinished && swimmer.lapsCompleted >= totalLaps && (
              <span className="swimmer-done">Finished</span>
            )}
          </div>
        ))}
      </div>
      <p className="hint">
        Track crossings from wall = swimmers leaving (1st, 2nd, 3rd…). Returns from pool
        are first-away-first-back. Stop line only counts for the focused return.
      </p>
    </div>
  );
}

function phaseLabel(phase: SwimmerState['phase']): string {
  switch (phase) {
    case 'waiting':
      return 'Waiting';
    case 'out':
      return 'Swimming out';
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
