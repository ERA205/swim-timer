import { useEffect, useState } from 'react';

export function useEstimatedElapsed(
  startedAt: number | null,
  active: boolean,
): number {
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    if (!active || !startedAt) {
      setElapsedMs(0);
      return;
    }

    const tick = () => setElapsedMs(Date.now() - startedAt);
    tick();
    const interval = setInterval(tick, 50);
    return () => clearInterval(interval);
  }, [active, startedAt]);

  return elapsedMs;
}
