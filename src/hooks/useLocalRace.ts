import { useCallback, useEffect, useRef, useState } from 'react';
import {
  lapsPerDetection,
  POOL_LENGTH_YARDS,
  type DetectionConfig,
  type SessionState,
  type SplitTime,
} from '../../shared/types';

export interface LocalRaceState {
  status: 'idle' | 'running' | 'finished';
  startedAt: number | null;
  distanceYards: number;
  totalLaps: number;
  detectionsNeeded: number;
  currentLaps: number;
  detectionsCount: number;
  elapsedMs: number;
  finishedAt: number | null;
  splits: SplitTime[];
  lastDetectionAt: number | null;
}

export interface RaceResult {
  elapsedMs: number;
  currentLaps: number;
  detectionsCount: number;
  finishedAt: number;
  splits: SplitTime[];
}

export interface RaceUpdate {
  splits: SplitTime[];
  currentLaps: number;
  detectionsCount: number;
}

function createIdleRace(): LocalRaceState {
  return {
    status: 'idle',
    startedAt: null,
    distanceYards: 100,
    totalLaps: 4,
    detectionsNeeded: 2,
    currentLaps: 0,
    detectionsCount: 0,
    elapsedMs: 0,
    finishedAt: null,
    splits: [],
    lastDetectionAt: null,
  };
}

function raceFromSession(session: SessionState): LocalRaceState {
  return {
    status: session.status === 'finished' ? 'finished' : 'running',
    startedAt: session.startedAt,
    distanceYards: session.distanceYards,
    totalLaps: session.totalLaps,
    detectionsNeeded: session.detectionsNeeded,
    currentLaps: 0,
    detectionsCount: 0,
    elapsedMs: 0,
    finishedAt: null,
    splits: [],
    lastDetectionAt: null,
  };
}

export function useLocalRace(
  session: SessionState | null,
  config: DetectionConfig,
  onUpdate: (update: RaceUpdate) => void,
  onFinish: (result: RaceResult) => void,
) {
  const [race, setRace] = useState<LocalRaceState>(createIdleRace);
  const raceRef = useRef(race);
  const onUpdateRef = useRef(onUpdate);
  const onFinishRef = useRef(onFinish);
  const lastRevisionRef = useRef(-1);
  const lastStartedAtRef = useRef<number | null>(null);

  useEffect(() => {
    raceRef.current = race;
  }, [race]);

  useEffect(() => {
    onUpdateRef.current = onUpdate;
  }, [onUpdate]);

  useEffect(() => {
    onFinishRef.current = onFinish;
  }, [onFinish]);

  useEffect(() => {
    if (!session) return;

    if (session.sessionRevision !== lastRevisionRef.current) {
      lastRevisionRef.current = session.sessionRevision;
      lastStartedAtRef.current = null;
      setRace(createIdleRace());
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

  const registerDetection = useCallback(() => {
    setRace((prev) => {
      if (prev.status !== 'running' || !prev.startedAt) return prev;

      const now = Date.now();
      if (prev.lastDetectionAt && now - prev.lastDetectionAt < config.cooldownMs) {
        return prev;
      }

      const detectionsCount = prev.detectionsCount + 1;
      const currentLaps = Math.min(
        prev.totalLaps,
        detectionsCount * lapsPerDetection(prev.totalLaps),
      );
      const elapsedMs = now - prev.startedAt;
      const isFinish = detectionsCount >= prev.detectionsNeeded;

      const splits = [...prev.splits];
      if (!isFinish && prev.totalLaps > 2) {
        splits.push({
          yards: currentLaps * POOL_LENGTH_YARDS,
          laps: currentLaps,
          elapsedMs,
        });
      }

      const next: LocalRaceState = {
        ...prev,
        detectionsCount,
        currentLaps,
        lastDetectionAt: now,
        elapsedMs,
        splits,
      };

      if (isFinish) {
        const result: RaceResult = {
          elapsedMs,
          currentLaps: prev.totalLaps,
          detectionsCount,
          finishedAt: now,
          splits,
        };
        queueMicrotask(() => onFinishRef.current(result));
        return {
          ...next,
          status: 'finished',
          finishedAt: now,
          currentLaps: prev.totalLaps,
        };
      }

      queueMicrotask(() =>
        onUpdateRef.current({
          splits,
          currentLaps,
          detectionsCount,
        }),
      );

      return next;
    });
  }, [config.cooldownMs]);

  return { race, registerDetection };
}
