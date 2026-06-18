import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createSwimmers,
  lapsPerDetection,
  POOL_LENGTH_YARDS,
  swimmerRaceTime,
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
  focusedSwimmerId: number | null;
  lastDetectionAt: number | null;
  departureQueue: number[];
  outboundCrossings: number;
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
    focusedSwimmerId: null,
    lastDetectionAt: null,
    departureQueue: [],
    outboundCrossings: 0,
  };
}

function initSwimmersOnStart(session: SessionState): SwimmerState[] {
  return session.swimmers.map((s, id) => ({
    ...s,
    phase: id === 0 ? ('out' as const) : ('waiting' as const),
    startOffsetMs: id === 0 ? 0 : null,
    canTriggerStop: false,
    focused: false,
    lapsCompleted: 0,
    wallTouches: 0,
    splits: [],
    elapsedMs: 0,
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
    swimmers: initSwimmersOnStart(session),
    elapsedMs: 0,
    finishedAt: null,
    focusedSwimmerId: null,
    lastDetectionAt: null,
    departureQueue: [0],
    outboundCrossings: 0,
  };
}

function allSwimmersDone(swimmers: SwimmerState[], totalLaps: number): boolean {
  return swimmers.every((s) => s.lapsCompleted >= totalLaps);
}

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

function nextAtWallSwimmer(swimmers: SwimmerState[], totalLaps: number): SwimmerState | undefined {
  return [...swimmers]
    .filter((s) => s.phase === 'at_wall' && s.lapsCompleted < totalLaps)
    .sort((a, b) => a.id - b.id)[0];
}

function updateSwimmerElapsed(
  swimmers: SwimmerState[],
  mainElapsedMs: number,
): SwimmerState[] {
  return swimmers.map((s) => ({
    ...s,
    elapsedMs:
      s.phase === 'waiting' && s.startOffsetMs === null
        ? 0
        : swimmerRaceTime(mainElapsedMs, s.startOffsetMs),
  }));
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
        const mainElapsed = Date.now() - prev.startedAt;
        return {
          ...prev,
          elapsedMs: mainElapsed,
          swimmers: updateSwimmerElapsed(prev.swimmers, mainElapsed),
        };
      });
    };
    const interval = setInterval(tick, 50);
    return () => clearInterval(interval);
  }, [race.status, race.startedAt]);

  const emitUpdate = useCallback((next: LocalMultiRaceState) => {
    onUpdateRef.current({
      swimmers: next.swimmers,
      focusedSwimmerId: next.focusedSwimmerId,
      currentLaps: 0,
      detectionsCount: 0,
      splits: [],
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

        const mainElapsed = now - prev.startedAt;
        let swimmers = prev.swimmers.map((s) => ({ ...s }));
        let departureQueue = [...prev.departureQueue];
        let outboundCrossings = prev.outboundCrossings;

        if (crossing === 'track-outbound') {
          outboundCrossings += 1;

          if (outboundCrossings === 1) {
            // First away already on coach start — crossing confirms leave, no stagger recorded
          } else if (outboundCrossings <= prev.swimmerCount) {
            const swimmerId = outboundCrossings - 1;
            const stagger = mainElapsed;
            swimmers = swimmers.map((s) =>
              s.id === swimmerId
                ? { ...s, phase: 'out' as const, startOffsetMs: stagger }
                : s,
            );
            if (!departureQueue.includes(swimmerId)) {
              departureQueue.push(swimmerId);
            }
          } else {
            const relaunch = nextAtWallSwimmer(swimmers, prev.totalLaps);
            if (!relaunch) return prev;
            swimmers = swimmers.map((s) =>
              s.id === relaunch.id
                ? { ...s, phase: 'out' as const, canTriggerStop: false, focused: false }
                : s,
            );
            departureQueue.push(relaunch.id);
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
            swimmers: updateSwimmerElapsed(swimmers, mainElapsed),
            departureQueue,
            outboundCrossings,
            focusedSwimmerId: returningId,
            lastDetectionAt: now,
            elapsedMs: mainElapsed,
          };
          queueMicrotask(() => emitUpdate(next));
          return next;
        }

        if (crossing === 'stop') {
          const focused = swimmers.find(
            (s) => s.canTriggerStop && s.focused && s.phase === 'returning',
          );
          if (!focused) return prev;

          const personalElapsed = swimmerRaceTime(mainElapsed, focused.startOffsetMs);
          const wallTouches = focused.wallTouches + 1;
          const lapsCompleted = Math.min(
            prev.totalLaps,
            wallTouches * lapsPerDetection(prev.totalLaps),
          );
          const isSwimmerDone = lapsCompleted >= prev.totalLaps;
          const isFinishTouch = wallTouches >= prev.detectionsNeeded;

          const splits = [...focused.splits];
          if (!isFinishTouch && prev.totalLaps > 2) {
            splits.push({
              yards: lapsCompleted * POOL_LENGTH_YARDS,
              laps: lapsCompleted,
              elapsedMs: personalElapsed,
            });
          }

          swimmers = swimmers.map((s) =>
            s.id === focused.id
              ? {
                  ...s,
                  wallTouches,
                  lapsCompleted,
                  splits,
                  elapsedMs: personalElapsed,
                  phase: isSwimmerDone ? ('done' as const) : ('at_wall' as const),
                  canTriggerStop: false,
                  focused: false,
                }
              : s,
          );

          swimmers = updateSwimmerElapsed(swimmers, mainElapsed);
          const raceDone = allSwimmersDone(swimmers, prev.totalLaps);

          const next: LocalMultiRaceState = {
            ...prev,
            swimmers,
            departureQueue,
            outboundCrossings,
            focusedSwimmerId: null,
            lastDetectionAt: now,
            elapsedMs: mainElapsed,
            status: raceDone ? 'finished' : 'running',
            finishedAt: raceDone ? now : null,
          };

          if (raceDone) {
            queueMicrotask(() =>
              onFinishRef.current({
                swimmers,
                elapsedMs: mainElapsed,
                currentLaps: 0,
                detectionsCount: 0,
                finishedAt: now,
                splits: [],
              }),
            );
          } else {
            queueMicrotask(() => emitUpdate(next));
          }

          return next;
        }

        const next: LocalMultiRaceState = {
          ...prev,
          swimmers: updateSwimmerElapsed(swimmers, mainElapsed),
          departureQueue,
          outboundCrossings,
          lastDetectionAt: now,
          elapsedMs: mainElapsed,
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
