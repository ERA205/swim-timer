export const POOL_LENGTH_YARDS = 25;
export const DEFAULT_DETECTION_CONFIG = {
    lineY: 0.55,
    zoneHeight: 0.2,
    sensitivity: 18,
    cooldownMs: 2500,
};
export function createInitialSession(distanceYards = 100) {
    const totalLaps = distanceYards / POOL_LENGTH_YARDS;
    return {
        status: 'idle',
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
    };
}
export function lapsPerDetection(totalLaps) {
    return 2;
}
export function formatTime(ms) {
    if (ms < 0)
        ms = 0;
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const centis = Math.floor((ms % 1000) / 10);
    return `${minutes}:${seconds.toString().padStart(2, '0')}.${centis.toString().padStart(2, '0')}`;
}
export function formatDistanceLabel(yards) {
    return `${yards} yd (${yards / POOL_LENGTH_YARDS} laps)`;
}
