import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createInitialSession,
  lapsPerDetection,
  POOL_LENGTH_YARDS,
  returnPassesRequired,
  swimmerRaceTime,
  type DetectionConfig,
  type LineCrossing,
  type MultiRaceResult,
  type MultiRaceUpdate,
  type SessionState,
  type SplitTime,
  type SwimmerState,
} from '../../shared/types';

type MultiRacePhase = 'departing' | 'racing';

export interface LocalMultiRaceState {
  status: 'idle' | 'running' | 'finished';
  racePhase: MultiRacePhase;
  startedAt: number | null;
  distanceYards: number;
  totalLaps: number;
  detectionsNeeded: number;
  swimmerCount: number;
  swimmers: SwimmerState[];
  elapsedMs: number;
  finishedAt: number | null;
  focusedSwimmerId: number | null;
  departureQueue: number[];
  departedCount: number;
  outboundCrossings: number;
}

function idleFromSession(session: SessionState): LocalMultiRaceState {
  return {
    status: 'idle',
    racePhase: 'departing',
    startedAt: null,
    distanceYards: session.distanceYards,
    totalLaps: session.totalLaps,
    detectionsNeeded: session.detectionsNeeded,
    swimmerCount: session.swimmerCount,
    swimmers: session.swimmers.map((s) => ({
      ...s,
      phase: 'waiting',
      startOffsetMs: null,
      lapsCompleted: 0,
      wallTouches: 0,
      inboundPasses: 0,
      splits: [],
      elapsedMs: 0,
      canTriggerStop: false,
      focused: false,
    })),
    elapsedMs: 0,
    finishedAt: null,
    focusedSwimmerId: null,
    departureQueue: [],
    departedCount: 0,
    outboundCrossings: 0,
  };
}

function initSwimmersOnStart(session: SessionState): SwimmerState[] {
  return session.swimmers.map((s) => ({
    ...s,
    phase: 'waiting' as const,
    startOffsetMs: null,
    canTriggerStop: false,
    focused: false,
    lapsCompleted: 0,
    wallTouches: 0,
    inboundPasses: 0,
    splits: [],
    elapsedMs: 0,
  }));
}

function raceFromSession(session: SessionState): LocalMultiRaceState {
  return {
    status: 'running',
    racePhase: 'departing',
    startedAt: session.startedAt,
    distanceYards: session.distanceYards,
    totalLaps: session.totalLaps,
    detectionsNeeded: session.detectionsNeeded,
    swimmerCount: session.swimmerCount,
    swimmers: initSwimmersOnStart(session),
    elapsedMs: 0,
    finishedAt: null,
    focusedSwimmerId: null,
    departureQueue: [],
    departedCount: 0,
    outboundCrossings: 0,
  };
}

function swimmersSetupMatches(a: SwimmerState[], b: SwimmerState[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((sw, i) => sw.id === b[i].id && sw.name === b[i].name);
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
  return swimmers.map((s) => {
    if (s.phase === 'done') return s;
    if (s.phase === 'waiting' && s.startOffsetMs === null) {
      return { ...s, elapsedMs: 0 };
    }
    return {
      ...s,
      elapsedMs: swimmerRaceTime(mainElapsedMs, s.startOffsetMs),
    };
  });
}

function departedCountFromCrossings(outboundCrossings: number, swimmerCount: number): number {
  return Math.min(swimmerCount, outboundCrossings);
}

function finishSwimmer(
  swimmer: SwimmerState,
  personalElapsed: number,
  totalLaps: number,
  detectionsNeeded: number,
  splits: SplitTime[],
): SwimmerState {
  return {
    ...swimmer,
    wallTouches: detectionsNeeded,
    inboundPasses: detectionsNeeded,
    lapsCompleted: totalLaps,
    splits,
    elapsedMs: personalElapsed,
    phase: 'done',
    canTriggerStop: false,
    focused: false,
  };
}

function buildRaceResult(
  prev: LocalMultiRaceState,
  swimmers: SwimmerState[],
  now: number,
  mainElapsed: number,
): LocalMultiRaceState {
  const raceDone = allSwimmersDone(swimmers, prev.totalLaps);
  return {
    ...prev,
    swimmers,
    focusedSwimmerId: null,
    elapsedMs: mainElapsed,
    status: raceDone ? 'finished' : 'running',
    finishedAt: raceDone ? now : null,
  };
}

export function useMultiSwimmerRace(
  session: SessionState | null,
  config: DetectionConfig,
  onUpdate: (update: MultiRaceUpdate) => void,
  onFinish: (result: MultiRaceResult) => void,
) {
  const [race, setRace] = useState<LocalMultiRaceState>(() =>
    idleFromSession(createInitialSession(100, 'multi')),
  );
  const onUpdateRef = useRef(onUpdate);
  const onFinishRef = useRef(onFinish);
  const lastRevisionRef = useRef(-1);
  const lastStartedAtRef = useRef<number | null>(null);
  const lastOutboundAtRef = useRef(0);
  const lastInboundAtRef = useRef(0);
  const lastStopAtRef = useRef(0);

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
      lastOutboundAtRef.current = 0;
      lastInboundAtRef.current = 0;
      lastStopAtRef.current = 0;
      setRace(idleFromSession(session));
      return;
    }

    if (
      session.status === 'running' &&
      session.startedAt &&
      session.startedAt !== lastStartedAtRef.current
    ) {
      lastStartedAtRef.current = session.startedAt;
      lastOutboundAtRef.current = 0;
      lastInboundAtRef.current = 0;
      lastStopAtRef.current = 0;
      setRace(raceFromSession(session));
      return;
    }

    if (session.status !== 'running') {
      setRace((prev) => {
        if (prev.status !== 'idle') return prev;
        if (
          prev.swimmerCount === session.swimmerCount &&
          prev.distanceYards === session.distanceYards &&
          prev.totalLaps === session.totalLaps &&
          swimmersSetupMatches(prev.swimmers, session.swimmers)
        ) {
          return prev;
        }
        return idleFromSession(session);
      });
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

  const emitFinish = useCallback((swimmers: SwimmerState[], mainElapsed: number, now: number) => {
    onFinishRef.current({
      swimmers,
      elapsedMs: mainElapsed,
      currentLaps: 0,
      detectionsCount: 0,
      finishedAt: now,
      splits: [],
    });
  }, []);

  const handleCrossing = useCallback(
    (crossing: LineCrossing) => {
      setRace((prev) => {
        if (prev.status !== 'running' || !prev.startedAt) return prev;

        const now = Date.now();
        const mainElapsed = now - prev.startedAt;
        let swimmers = prev.swimmers.map((s) => ({ ...s }));
        let departureQueue = [...prev.departureQueue];
        let outboundCrossings = prev.outboundCrossings;
        let departedCount = prev.departedCount;
        let racePhase = prev.racePhase;
        const returnsNeeded = returnPassesRequired(prev.detectionsNeeded);

        if (crossing === 'track-outbound') {
          if (now - lastOutboundAtRef.current < config.cooldownMs) return prev;
          lastOutboundAtRef.current = now;

          outboundCrossings += 1;

          if (outboundCrossings <= prev.swimmerCount) {
            const swimmerId = outboundCrossings - 1;
            const startOffsetMs = swimmerId === 0 ? 0 : mainElapsed;
            swimmers = swimmers.map((s) =>
              s.id === swimmerId
                ? { ...s, phase: 'out' as const, startOffsetMs }
                : s,
            );
            if (!departureQueue.includes(swimmerId)) {
              departureQueue.push(swimmerId);
            }
            departedCount = departedCountFromCrossings(outboundCrossings, prev.swimmerCount);
            if (departedCount >= prev.swimmerCount) {
              racePhase = 'racing';
            }
          } else if (racePhase === 'racing') {
            const relaunch = nextAtWallSwimmer(swimmers, prev.totalLaps);
            if (!relaunch) return prev;
            swimmers = swimmers.map((s) =>
              s.id === relaunch.id
                ? { ...s, phase: 'out' as const, canTriggerStop: false, focused: false }
                : s,
            );
            if (!departureQueue.includes(relaunch.id)) {
              departureQueue.push(relaunch.id);
            }
          } else {
            return prev;
          }

          const next: LocalMultiRaceState = {
            ...prev,
            swimmers: updateSwimmerElapsed(swimmers, mainElapsed),
            departureQueue,
            outboundCrossings,
            departedCount,
            racePhase,
            elapsedMs: mainElapsed,
          };
          queueMicrotask(() => emitUpdate(next));
          return next;
        }

        if (crossing === 'track-inbound') {
          if (now - lastInboundAtRef.current < config.cooldownMs) return prev;
          if (departedCount < prev.swimmerCount) return prev;

          const returningId = nextReturningSwimmerId(swimmers, departureQueue);
          if (returningId === null) return prev;

          lastInboundAtRef.current = now;

          const returning = swimmers.find((s) => s.id === returningId);
          if (!returning) return prev;

          const inboundPasses = returning.inboundPasses + 1;
          const personalElapsed = swimmerRaceTime(mainElapsed, returning.startOffsetMs);
          const raceCompleteForSwimmer = inboundPasses >= returnsNeeded;

          if (raceCompleteForSwimmer) {
            swimmers = swimmers.map((s) =>
              s.id === returningId
                ? finishSwimmer(s, personalElapsed, prev.totalLaps, prev.detectionsNeeded, s.splits)
                : s,
            );
            swimmers = updateSwimmerElapsed(swimmers, mainElapsed);
            const next = buildRaceResult(
              { ...prev, departureQueue, outboundCrossings, departedCount, racePhase },
              swimmers,
              now,
              mainElapsed,
            );

            if (next.status === 'finished') {
              queueMicrotask(() => emitFinish(swimmers, mainElapsed, now));
            } else {
              queueMicrotask(() => emitUpdate(next));
            }
            return next;
          }

          swimmers = swimmers.map((s) =>
            s.id === returningId
              ? {
                  ...s,
                  inboundPasses,
                  phase: 'returning' as const,
                  focused: true,
                  canTriggerStop: true,
                }
              : s,
          );

          const next: LocalMultiRaceState = {
            ...prev,
            swimmers: updateSwimmerElapsed(swimmers, mainElapsed),
            departureQueue,
            outboundCrossings,
            departedCount,
            racePhase,
            focusedSwimmerId: returningId,
            elapsedMs: mainElapsed,
          };
          queueMicrotask(() => emitUpdate(next));
          return next;
        }

        if (crossing === 'stop') {
          if (now - lastStopAtRef.current < config.cooldownMs / 2) return prev;
          if (departedCount < prev.swimmerCount) return prev;

          const focused = swimmers.find(
            (s) => s.canTriggerStop && s.focused && s.phase === 'returning',
          );
          if (!focused) return prev;

          lastStopAtRef.current = now;

          const personalElapsed = swimmerRaceTime(mainElapsed, focused.startOffsetMs);
          const wallTouches = focused.wallTouches + 1;
          const lapsCompleted = Math.min(
            prev.totalLaps,
            wallTouches * lapsPerDetection(prev.totalLaps),
          );
          const isSwimmerDone = lapsCompleted >= prev.totalLaps;

          const splits = [...focused.splits];
          if (!isSwimmerDone && prev.totalLaps > 2) {
            splits.push({
              yards: lapsCompleted * POOL_LENGTH_YARDS,
              laps: lapsCompleted,
              elapsedMs: personalElapsed,
            });
          }

          swimmers = swimmers.map((s) =>
            s.id === focused.id
              ? isSwimmerDone
                ? finishSwimmer(s, personalElapsed, prev.totalLaps, prev.detectionsNeeded, splits)
                : {
                    ...s,
                    wallTouches,
                    lapsCompleted,
                    splits,
                    elapsedMs: personalElapsed,
                    phase: 'at_wall' as const,
                    canTriggerStop: false,
                    focused: false,
                  }
              : s,
          );

          swimmers = updateSwimmerElapsed(swimmers, mainElapsed);
          const next = buildRaceResult(
            { ...prev, departureQueue, outboundCrossings, departedCount, racePhase },
            swimmers,
            now,
            mainElapsed,
          );

          if (next.status === 'finished') {
            queueMicrotask(() => emitFinish(swimmers, mainElapsed, now));
          } else {
            queueMicrotask(() => emitUpdate(next));
          }
          return next;
        }

        return prev;
      });
    },
    [config.cooldownMs, emitUpdate, emitFinish],
  );

  const stopArmed = race.swimmers.some((s) => s.canTriggerStop && s.focused);

  return { race, handleCrossing, stopArmed };
}

export type { MultiRaceResult, MultiRaceUpdate };
