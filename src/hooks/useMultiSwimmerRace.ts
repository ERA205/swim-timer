import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createSwimmers,
  lapsPerDetection,
  POOL_LENGTH_YARDS,
  type DetectionConfig,
  type LineCrossing,
  type MultiRaceResult,
  type MultiRaceUpdate,
  type SessionState,
  type SplitTime,
  type SwimmerState,
} from '../../shared/types';

export interface LocalMultiRaceState {
  status: 'idle' | 'running' | 'finished';
  startedAt: number | null;
  distanceYards: number;
  totalLaps: number;
  detectionsNeeded: number;
  swimmerCount: number;
  swimmers: SwimmerState[];
  elapsedMs: number;
  finishedAt: number | null;
  splits: SplitTime[];
  currentLaps: number;
  detectionsCount: number;
  focusedSwimmerId: number | null;
  lastDetectionAt: number | null;
  /** Swimmer ids in the order they left the wall (FIFO for returns) */
  departureQueue: number[];
}

function createIdleMultiRace(): LocalMultiRaceState {
  return {
    status: 'idle',
    startedAt: null,
    distanceYards: 100,
    totalLaps: 4,
    detectionsNeeded: 2,
    swimmerCount: 2,
    swimmers: createSwimmers(2),
    elapsedMs: 0,
    finishedAt: null,
    splits: [],
    currentLaps: 0,
    detectionsCount: 0,
    focusedSwimmerId: null,
    lastDetectionAt: null,
    departureQueue: [],
  };
}

function initSwimmersForRace(session: SessionState): SwimmerState[] {
  return session.swimmers.map((s) => ({
    ...s,
    phase: 'waiting' as const,
    startOffsetMs: null,
    canTriggerStop: false,
    focused: false,
    lapsCompleted: 0,
    wallTouches: 0,
    splits: [],
  }));
}

function raceFromSession(session: SessionState): LocalMultiRaceState {
  return {
    status: 'running',
    startedAt: session.startedAt,
    distanceYards: session.distanceYards,
    totalLaps: session.totalLaps,
    detectionsNeeded: session.detectionsNeeded,
    swimmerCount: session.swimmerCount,
    swimmers: initSwimmersForRace(session),
    elapsedMs: 0,
    finishedAt: null,
    splits: [],
    currentLaps: 0,
    detectionsCount: 0,
    focusedSwimmerId: null,
    lastDetectionAt: null,
    departureQueue: [],
  };
}

function aggregateSplits(swimmers: SwimmerState[]): SplitTime[] {
  return swimmers.flatMap((s) => s.splits);
}

function aggregateLaps(swimmers: SwimmerState[]): number {
  return swimmers.reduce((sum, s) => sum + s.lapsCompleted, 0);
}

function aggregateTouches(swimmers: SwimmerState[]): number {
  return swimmers.reduce((sum, s) => sum + s.wallTouches, 0);
}

function allSwimmersDone(swimmers: SwimmerState[], totalLaps: number): boolean {
  return swimmers.every((s) => s.lapsCompleted >= totalLaps);
}

/** Next swimmer waiting to leave (lowest id still on wall) */
function nextWaitingSwimmer(swimmers: SwimmerState[]): SwimmerState | undefined {
  return [...swimmers]
    .filter((s) => s.phase === 'waiting')
    .sort((a, b) => a.id - b.id)[0];
}

/** Next swimmer at wall ready to push off for another lap */
function nextAtWallSwimmer(swimmers: SwimmerState[], totalLaps: number): SwimmerState | undefined {
  return [...swimmers]
    .filter((s) => s.phase === 'at_wall' && s.lapsCompleted < totalLaps)
    .sort((a, b) => a.id - b.id)[0];
}

/** First swimmer still in the water per departure order (first to leave = first back) */
function nextReturningSwimmerId(
  swimmers: SwimmerState[],
  departureQueue: number[],
): number | null {
  for (const id of departureQueue) {
    const swimmer = swimmers.find((s) => s.id === id);
    if (swimmer?.phase === 'out') return id;
  }
  return null;
}

export function useMultiSwimmerRace(
  session: SessionState | null,
  config: DetectionConfig,
  onUpdate: (update: MultiRaceUpdate) => void,
  onFinish: (result: MultiRaceResult) => void,
) {
  const [race, setRace] = useState<LocalMultiRaceState>(createIdleMultiRace);
  const onUpdateRef = useRef(onUpdate);
  const onFinishRef = useRef(onFinish);
  const lastRevisionRef = useRef(-1);
  const lastStartedAtRef = useRef<number | null>(null);

  useEffect(() => {
    onUpdateRef.current = onUpdate;
  }, [onUpdate]);

  useEffect(() => {
    onFinishRef.current = onFinish;
  }, [onFinish]);

  useEffect(() => {
    if (!session || session.raceMode !== 'multi') return;

    if (session.sessionRevision !== lastRevisionRef.current) {
      lastRevisionRef.current = session.sessionRevision;
      lastStartedAtRef.current = null;
      setRace(createIdleMultiRace());
      return;
    }

    if (
      session.status === 'running' &&
      session.startedAt &&
      session.startedAt !== lastStartedAtRef.current
    ) {
      lastStartedAtRef.current = session.startedAt;
      setRace(raceFromSession(session));
    }
  }, [session]);

  useEffect(() => {
    if (race.status !== 'running' || !race.startedAt) return;
    const tick = () => {
      setRace((prev) => {
        if (prev.status !== 'running' || !prev.startedAt) return prev;
        return { ...prev, elapsedMs: Date.now() - prev.startedAt };
      });
    };
    const interval = setInterval(tick, 50);
    return () => clearInterval(interval);
  }, [race.status, race.startedAt]);

  const emitUpdate = useCallback((next: LocalMultiRaceState) => {
    onUpdateRef.current({
      swimmers: next.swimmers,
      currentLaps: next.currentLaps,
      detectionsCount: next.detectionsCount,
      splits: next.splits,
      focusedSwimmerId: next.focusedSwimmerId,
    });
  }, []);

  const handleCrossing = useCallback(
    (crossing: LineCrossing) => {
      setRace((prev) => {
        if (prev.status !== 'running' || !prev.startedAt) return prev;

        const now = Date.now();
        if (prev.lastDetectionAt && now - prev.lastDetectionAt < config.cooldownMs / 2) {
          return prev;
        }

        let swimmers = prev.swimmers.map((s) => ({ ...s }));
        let departureQueue = [...prev.departureQueue];

        if (crossing === 'track-outbound') {
          const waiting = nextWaitingSwimmer(swimmers);
          const atWall = nextAtWallSwimmer(swimmers, prev.totalLaps);

          if (waiting) {
            swimmers = swimmers.map((s) =>
              s.id === waiting.id
                ? {
                    ...s,
                    phase: 'out' as const,
                    startOffsetMs: now - prev.startedAt!,
                  }
                : s,
            );
            departureQueue.push(waiting.id);
          } else if (atWall) {
            swimmers = swimmers.map((s) =>
              s.id === atWall.id
                ? { ...s, phase: 'out' as const, canTriggerStop: false, focused: false }
                : s,
            );
            departureQueue.push(atWall.id);
          } else {
            return prev;
          }
        }

        if (crossing === 'track-inbound') {
          const returningId = nextReturningSwimmerId(swimmers, departureQueue);
          if (returningId === null) return prev;

          swimmers = swimmers.map((s) => ({
            ...s,
            phase: s.id === returningId ? ('returning' as const) : s.phase,
            focused: s.id === returningId,
            canTriggerStop: s.id === returningId,
          }));

          const next: LocalMultiRaceState = {
            ...prev,
            swimmers,
            departureQueue,
            focusedSwimmerId: returningId,
            lastDetectionAt: now,
          };
          queueMicrotask(() => emitUpdate(next));
          return next;
        }

        if (crossing === 'stop') {
          const focused = swimmers.find(
            (s) => s.canTriggerStop && s.focused && s.phase === 'returning',
          );
          if (!focused) return prev;

          const wallTouches = focused.wallTouches + 1;
          const lapsCompleted = Math.min(
            prev.totalLaps,
            wallTouches * lapsPerDetection(prev.totalLaps),
          );
          const elapsedMs = now - prev.startedAt;
          const isSwimmerDone = lapsCompleted >= prev.totalLaps;

          const splits = [...focused.splits];
          const isFinishTouch = wallTouches >= prev.detectionsNeeded;

          if (!isFinishTouch && prev.totalLaps > 2) {
            splits.push({
              yards: lapsCompleted * POOL_LENGTH_YARDS,
              laps: lapsCompleted,
              elapsedMs,
            });
          }

          swimmers = swimmers.map((s) =>
            s.id === focused.id
              ? {
                  ...s,
                  wallTouches,
                  lapsCompleted,
                  splits,
                  phase: isSwimmerDone ? ('done' as const) : ('at_wall' as const),
                  canTriggerStop: false,
                  focused: false,
                }
              : s,
          );

          const allSplits = aggregateSplits(swimmers);
          const currentLaps = aggregateLaps(swimmers);
          const detectionsCount = aggregateTouches(swimmers);
          const raceDone = allSwimmersDone(swimmers, prev.totalLaps);

          const next: LocalMultiRaceState = {
            ...prev,
            swimmers,
            departureQueue,
            splits: allSplits,
            currentLaps,
            detectionsCount,
            focusedSwimmerId: null,
            lastDetectionAt: now,
            status: raceDone ? 'finished' : 'running',
            finishedAt: raceDone ? now : null,
          };

          if (raceDone) {
            queueMicrotask(() =>
              onFinishRef.current({
                swimmers,
                elapsedMs,
                currentLaps,
                detectionsCount,
                finishedAt: now,
                splits: allSplits,
              }),
            );
          } else {
            queueMicrotask(() => emitUpdate(next));
          }

          return next;
        }

        const next: LocalMultiRaceState = {
          ...prev,
          swimmers,
          departureQueue,
          lastDetectionAt: now,
        };
        queueMicrotask(() => emitUpdate(next));
        return next;
      });
    },
    [config.cooldownMs, emitUpdate],
  );

  const stopArmed = race.swimmers.some((s) => s.canTriggerStop && s.focused);

  return { race, handleCrossing, stopArmed };
}

export type { MultiRaceResult, MultiRaceUpdate };
