import { formatTime, toSegmentSplits, type SplitTime } from '../../shared/types';

interface SplitTimesProps {
  splits: SplitTime[];
  elapsedMs: number;
  finished: boolean;
  distanceYards: number;
}

export function SplitTimes({
  splits,
  elapsedMs,
  finished,
  distanceYards,
}: SplitTimesProps) {
  const segments = toSegmentSplits(splits, elapsedMs, finished, distanceYards);
  if (segments.length === 0) return null;

  return (
    <div className="split-times">
      {segments.map((segment) => (
        <div key={`${segment.yards}-${segment.segmentMs}`} className="split-row">
          <span className="split-label">{segment.yards} yd</span>
          <span className="split-value">{formatTime(segment.segmentMs)}</span>
        </div>
      ))}
    </div>
  );
}
