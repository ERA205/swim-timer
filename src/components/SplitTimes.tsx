import { formatTime, type SplitTime } from '../../shared/types';

interface SplitTimesProps {
  splits: SplitTime[];
}

export function SplitTimes({ splits }: SplitTimesProps) {
  if (splits.length === 0) return null;

  return (
    <div className="split-times">
      {splits.map((split) => (
        <div key={`${split.yards}-${split.elapsedMs}`} className="split-row">
          <span className="split-label">{split.yards} yd</span>
          <span className="split-value">{formatTime(split.elapsedMs)}</span>
        </div>
      ))}
    </div>
  );
}
