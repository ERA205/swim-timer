export const POOL_LENGTH_YARDS = 25;

export type SessionStatus = 'idle' | 'ready' | 'running' | 'finished';
export type RaceMode = 'single' | 'multi';
export type SwimmerPhase = 'waiting' | 'out' | 'returning' | 'at_wall' | 'done';

export interface SplitTime {
  yards: number;
  laps: number;
  elapsedMs: number;
}

export interface SwimmerState {
  id: number;
  name: string;
  phase: SwimmerPhase;
  /** Stagger behind swimmer 1 (0 for first away). null = not yet sent */
  startOffsetMs: number | null;
  lapsCompleted: number;
  wallTouches: number;
  /** Pool-direction track line crossings while returning */
  inboundPasses: number;
  splits: SplitTime[];
  canTriggerStop: boolean;
  focused: boolean;
  /** Personal race time (main clock minus stagger) */
  elapsedMs: number;
}

export function swimmerRaceTime(mainElapsedMs: number, startOffsetMs: number | null): number {
  return Math.max(0, mainElapsedMs - (startOffsetMs ?? 0));
}

export interface SessionState {
  status: SessionStatus;
  raceMode: RaceMode;
  swimmerCount: number;
  swimmers: SwimmerState[];
  distanceYards: number;
  totalLaps: number;
  currentLaps: number;
  detectionsNeeded: number;
  detectionsCount: number;
  elapsedMs: number;
  startedAt: number | null;
  finishedAt: number | null;
  swimmerName: string;
  lastDetectionAt: number | null;
  splits: SplitTime[];
  sessionRevision: number;
  focusedSwimmerId: number | null;
}

export type SyncKind = 'start' | 'split' | 'finish';

export interface SyncEvent {
  id: string;
  kind: SyncKind;
  label: string;
  state: 'sending' | 'confirmed' | 'failed';
  progress: number;
  recordedLocally?: boolean;
}

export interface DetectionConfig {
  trackLineX: number;
  stopLineX: number;
  zoneWidth: number;
  sensitivity: number;
  cooldownMs: number;
  /** @deprecated use stopLineX */
  lineX?: number;
}

export const DEFAULT_DETECTION_CONFIG: DetectionConfig = {
  trackLineX: 0.38,
  stopLineX: 0.58,
  zoneWidth: 0.14,
  sensitivity: 18,
  cooldownMs: 2500,
};

export function normalizeConfig(config: DetectionConfig): DetectionConfig {
  const stopLineX = config.stopLineX ?? config.lineX ?? 0.58;
  const trackLineX = config.trackLineX ?? stopLineX - 0.2;
  return { ...config, trackLineX, stopLineX };
}

export function createSwimmers(count: number, names: string[] = []): SwimmerState[] {
  return Array.from({ length: count }, (_, id) => ({
    id,
    name: names[id] ?? `Swimmer ${id + 1}`,
    phase: 'waiting' as SwimmerPhase,
    startOffsetMs: null,
    lapsCompleted: 0,
    wallTouches: 0,
    inboundPasses: 0,
    splits: [],
    canTriggerStop: false,
    focused: false,
    elapsedMs: 0,
  }));
}

/** Each lap = 2 track passes (wall→pool, pool→wall). Returns needed to finish. */
export function returnPassesRequired(detectionsNeeded: number): number {
  return detectionsNeeded;
}

export function createInitialSession(distanceYards = 100, raceMode: RaceMode = 'single'): SessionState {
  const totalLaps = distanceYards / POOL_LENGTH_YARDS;
  return {
    status: 'idle',
    raceMode,
    swimmerCount: 1,
    swimmers: createSwimmers(1),
    distanceYards,
    totalLaps,
    currentLaps: 0,
    detectionsNeeded: totalLaps / 2,
    detectionsCount: 0,
    elapsedMs: 0,
    startedAt: null,
    finishedAt: null,
    swimmerName: '',
    lastDetectionAt: null,
    splits: [],
    sessionRevision: 0,
    focusedSwimmerId: null,
  };
}

export function lapsPerDetection(_totalLaps: number): number {
  return 2;
}

export function formatTime(ms: number): string {
  if (ms < 0) ms = 0;
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const centis = Math.floor((ms % 1000) / 10);
  return `${minutes}:${seconds.toString().padStart(2, '0')}.${centis.toString().padStart(2, '0')}`;
}

export function formatDistanceLabel(yards: number): string {
  return `${yards} yd (${yards / POOL_LENGTH_YARDS} laps)`;
}

export interface SegmentSplit {
  yards: number;
  segmentMs: number;
}

export function toSegmentSplits(
  splits: SplitTime[],
  elapsedMs: number,
  finished: boolean,
  distanceYards: number,
): SegmentSplit[] {
  const segments = splits.map((split, index) => ({
    yards: split.yards,
    segmentMs: split.elapsedMs - (index > 0 ? splits[index - 1].elapsedMs : 0),
  }));

  if (finished && distanceYards > POOL_LENGTH_YARDS * 2) {
    const lastCumulative =
      splits.length > 0 ? splits[splits.length - 1].elapsedMs : 0;
    const finalYards = distanceYards;
    if (!splits.some((split) => split.yards === finalYards)) {
      segments.push({
        yards: finalYards,
        segmentMs: elapsedMs - lastCumulative,
      });
    }
  }

  return segments;
}

export interface MultiRaceUpdate {
  swimmers: SwimmerState[];
  currentLaps: number;
  detectionsCount: number;
  splits: SplitTime[];
  focusedSwimmerId: number | null;
}

export interface MultiRaceResult {
  swimmers: SwimmerState[];
  elapsedMs: number;
  currentLaps: number;
  detectionsCount: number;
  finishedAt: number;
  splits: SplitTime[];
}

export type LineCrossing = 'track-outbound' | 'track-inbound' | 'stop';

export interface ZoneMotion {
  level: number;
  centroidX: number;
  /** Motion intensity on pool side (lower X) of the zone */
  leftMotion: number;
  /** Motion intensity on wall side (higher X) of the zone */
  rightMotion: number;
  direction: number;
}

export type MotionTrend = 'toward-pool' | 'toward-wall' | 'none';

const MOTION_HISTORY_LEN = 14;
const CROSS_DELTA_MIN = 0.055;
const TREND_SMOOTH_ALPHA = 0.32;

export function pushMotionSample(history: number[], centroidX: number): number[] {
  const next = [...history, centroidX];
  if (next.length > MOTION_HISTORY_LEN) next.shift();
  return next;
}

export function smoothCentroidHistory(history: number[]): number[] {
  if (history.length === 0) return [];
  const smoothed: number[] = [];
  let ema = history[0];
  for (const sample of history) {
    ema = ema * (1 - TREND_SMOOTH_ALPHA) + sample * TREND_SMOOTH_ALPHA;
    smoothed.push(ema);
  }
  return smoothed;
}

/** Detect sustained movement across the zone midpoint (0.5 = the line). */
export function detectMotionTrend(
  history: number[],
  motionLevel: number,
  threshold: number,
): MotionTrend {
  if (history.length < 8 || motionLevel < threshold) return 'none';

  const smoothed = smoothCentroidHistory(history);
  const early = smoothed.slice(0, 4).reduce((sum, v) => sum + v, 0) / 4;
  const late = smoothed.slice(-4).reduce((sum, v) => sum + v, 0) / 4;
  const delta = late - early;

  if (delta < -CROSS_DELTA_MIN && early > 0.46 && late < 0.54) {
    return 'toward-pool';
  }
  if (delta > CROSS_DELTA_MIN && early < 0.54 && late > 0.46) {
    return 'toward-wall';
  }
  return 'none';
}

/** Instantaneous flow from which half of the zone is lighting up. */
export function hemisphereFlow(leftMotion: number, rightMotion: number): MotionTrend {
  const total = leftMotion + rightMotion;
  if (total < 8) return 'none';
  const ratio = rightMotion / total;
  if (ratio > 0.58) return 'toward-pool';
  if (ratio < 0.42) return 'toward-wall';
  return 'none';
}

export function combineTrends(
  crossingTrend: MotionTrend,
  flowTrend: MotionTrend,
  instantDirection: number,
): MotionTrend {
  if (crossingTrend !== 'none') return crossingTrend;
  if (flowTrend !== 'none' && instantDirection !== 0) {
    const flowDir = flowTrend === 'toward-pool' ? -1 : 1;
    if (flowDir === instantDirection) return flowTrend;
  }
  if (instantDirection < 0) return 'toward-pool';
  if (instantDirection > 0) return 'toward-wall';
  return 'none';
}

export function analyzeZoneMotion(
  current: ImageData,
  previous: ImageData | null,
): ZoneMotion {
  if (!previous || current.width !== previous.width || current.height !== previous.height) {
    return { level: 0, centroidX: 0.5, leftMotion: 0, rightMotion: 0, direction: 0 };
  }

  const data = current.data;
  const prevData = previous.data;
  let diffSum = 0;
  let weightedX = 0;
  let weightTotal = 0;
  let leftDiff = 0;
  let rightDiff = 0;
  let leftCount = 0;
  let rightCount = 0;
  const step = 4;
  const width = current.width;
  const midCol = Math.floor(width / 2);

  for (let i = 0; i < data.length; i += step * 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const pr = prevData[i];
    const pg = prevData[i + 1];
    const pb = prevData[i + 2];
    const diff = Math.abs(r - pr) + Math.abs(g - pg) + Math.abs(b - pb);
    diffSum += diff;

    if (diff > 10) {
      const pixelIndex = i / 4;
      const col = pixelIndex % width;
      const x = col / width;
      weightedX += x * diff;
      weightTotal += diff;
      if (col < midCol) {
        leftDiff += diff;
        leftCount += 1;
      } else {
        rightDiff += diff;
        rightCount += 1;
      }
    }
  }

  const samples = data.length / (step * 4);
  const level = diffSum / samples;
  const centroidX = weightTotal > 0 ? weightedX / weightTotal : 0.5;
  const leftMotion = leftCount > 0 ? leftDiff / leftCount : 0;
  const rightMotion = rightCount > 0 ? rightDiff / rightCount : 0;

  return { level, centroidX, leftMotion, rightMotion, direction: 0 };
}

export function motionDirection(
  prevCentroid: number,
  currCentroid: number,
  threshold = 0.012,
): number {
  const delta = currCentroid - prevCentroid;
  if (Math.abs(delta) < threshold) return 0;
  return delta > 0 ? 1 : -1;
}
