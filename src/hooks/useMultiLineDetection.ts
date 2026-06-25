import { useCallback, useEffect, useRef, useState } from 'react';
import {
  analyzeZoneMotion,
  combineTrends,
  detectMotionTrend,
  hemisphereFlow,
  motionDirection,
  normalizeConfig,
  pushMotionSample,
  smoothCentroidHistory,
  type DetectionConfig,
  type LineCrossing,
  type MotionTrend,
} from '../../shared/types';

interface MultiLineDetectionOptions {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  config: DetectionConfig;
  active: boolean;
  /** Run motion analysis and show direction feedback */
  detecting: boolean;
  /** Fire crossing callbacks for race timing */
  timingActive: boolean;
  stopArmed: boolean;
  resetKey: number;
  onCrossing: (crossing: LineCrossing) => void;
}

export interface CrossingFlash {
  crossing: LineCrossing;
  at: number;
}

function clearCanvas(canvas: HTMLCanvasElement | null) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx || canvas.width === 0 || canvas.height === 0) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

function getZoneBounds(lineX: number, zoneWidth: number, canvasWidth: number) {
  const line = Math.floor(lineX * canvasWidth);
  const left = Math.max(0, line - Math.floor((zoneWidth * canvasWidth) / 2));
  const right = Math.min(canvasWidth, line + Math.floor((zoneWidth * canvasWidth) / 2));
  return { line, left, width: right - left };
}

function trendLabel(trend: MotionTrend): string {
  switch (trend) {
    case 'toward-pool':
      return '← pool';
    case 'toward-wall':
      return 'wall →';
    default:
      return '—';
  }
}

function drawDirectionArrow(
  ctx: CanvasRenderingContext2D,
  zone: { line: number; left: number; width: number },
  canvasHeight: number,
  trend: MotionTrend,
  color: string,
) {
  if (trend === 'none') return;
  const midY = canvasHeight * 0.22;
  const cx = zone.line;
  const len = Math.min(zone.width * 0.35, 48);
  const dx = trend === 'toward-pool' ? -len : len;

  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(cx - dx * 0.5, midY);
  ctx.lineTo(cx + dx * 0.5, midY);
  ctx.stroke();

  const tipX = cx + dx * 0.5;
  const tipDir = trend === 'toward-pool' ? -1 : 1;
  ctx.beginPath();
  ctx.moveTo(tipX, midY);
  ctx.lineTo(tipX - tipDir * 12, midY - 8);
  ctx.lineTo(tipX - tipDir * 12, midY + 8);
  ctx.closePath();
  ctx.fill();
}

export function useMultiLineDetection({
  videoRef,
  canvasRef,
  config,
  active,
  detecting,
  timingActive,
  stopArmed,
  resetKey,
  onCrossing,
}: MultiLineDetectionOptions) {
  const cfg = normalizeConfig(config);
  const [trackMotion, setTrackMotion] = useState(0);
  const [stopMotion, setStopMotion] = useState(0);
  const [trackTrend, setTrackTrend] = useState<MotionTrend>('none');
  const [stopTrend, setStopTrend] = useState<MotionTrend>('none');
  const [lastCrossingFlash, setLastCrossingFlash] = useState<CrossingFlash | null>(null);
  const [isCalibrating, setIsCalibrating] = useState(false);

  const trackPrevFrameRef = useRef<ImageData | null>(null);
  const stopPrevFrameRef = useRef<ImageData | null>(null);
  const trackCentroidRef = useRef(0.5);
  const stopCentroidRef = useRef(0.5);
  const trackHistoryRef = useRef<number[]>([]);
  const stopHistoryRef = useRef<number[]>([]);
  const lastTrackOutRef = useRef(0);
  const lastTrackInRef = useRef(0);
  const lastStopRef = useRef(0);
  const baselineTrackRef = useRef<number[]>([]);
  const baselineStopRef = useRef<number[]>([]);
  const onCrossingRef = useRef(onCrossing);
  const stopArmedRef = useRef(stopArmed);
  const timingActiveRef = useRef(timingActive);
  const trackTrendRef = useRef<MotionTrend>('none');
  const stopTrendRef = useRef<MotionTrend>('none');
  const animationRef = useRef(0);

  useEffect(() => {
    onCrossingRef.current = onCrossing;
  }, [onCrossing]);

  useEffect(() => {
    stopArmedRef.current = stopArmed;
  }, [stopArmed]);

  useEffect(() => {
    timingActiveRef.current = timingActive;
  }, [timingActive]);

  const resetDetection = useCallback(() => {
    trackPrevFrameRef.current = null;
    stopPrevFrameRef.current = null;
    trackCentroidRef.current = 0.5;
    stopCentroidRef.current = 0.5;
    trackHistoryRef.current = [];
    stopHistoryRef.current = [];
    lastTrackOutRef.current = 0;
    lastTrackInRef.current = 0;
    lastStopRef.current = 0;
    baselineTrackRef.current = [];
    baselineStopRef.current = [];
    setTrackMotion(0);
    setStopMotion(0);
    setTrackTrend('none');
    setStopTrend('none');
    setLastCrossingFlash(null);
    setIsCalibrating(false);
    clearCanvas(canvasRef.current);
  }, [canvasRef]);

  useEffect(() => {
    resetDetection();
  }, [resetKey, resetDetection]);

  const calibrate = useCallback(() => {
    resetDetection();
    setIsCalibrating(true);
    setTimeout(() => setIsCalibrating(false), 2000);
  }, [resetDetection]);

  const flashCrossing = useCallback((crossing: LineCrossing) => {
    setLastCrossingFlash({ crossing, at: Date.now() });
    if (timingActiveRef.current) {
      onCrossingRef.current(crossing);
    }
  }, []);

  useEffect(() => {
    if (!lastCrossingFlash) return;
    const timer = setTimeout(() => setLastCrossingFlash(null), 1800);
    return () => clearTimeout(timer);
  }, [lastCrossingFlash]);

  useEffect(() => {
    if (!active) {
      cancelAnimationFrame(animationRef.current);
      clearCanvas(canvasRef.current);
      return;
    }

    const analyze = () => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || video.readyState < 2) {
        animationRef.current = requestAnimationFrame(analyze);
        return;
      }

      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) {
        animationRef.current = requestAnimationFrame(analyze);
        return;
      }

      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0);

      const trackZone = getZoneBounds(cfg.trackLineX, cfg.zoneWidth, canvas.width);
      const stopZone = getZoneBounds(cfg.stopLineX, cfg.zoneWidth, canvas.width);

      const trackData = ctx.getImageData(trackZone.left, 0, trackZone.width, canvas.height);
      const stopData = ctx.getImageData(stopZone.left, 0, stopZone.width, canvas.height);

      const trackAnalysis = analyzeZoneMotion(trackData, trackPrevFrameRef.current);
      const stopAnalysis = analyzeZoneMotion(stopData, stopPrevFrameRef.current);

      const trackInstantDir = motionDirection(trackCentroidRef.current, trackAnalysis.centroidX);
      const stopInstantDir = motionDirection(stopCentroidRef.current, stopAnalysis.centroidX);

      trackHistoryRef.current = pushMotionSample(trackHistoryRef.current, trackAnalysis.centroidX);
      stopHistoryRef.current = pushMotionSample(stopHistoryRef.current, stopAnalysis.centroidX);

      trackPrevFrameRef.current = trackData;
      stopPrevFrameRef.current = stopData;
      trackCentroidRef.current = trackAnalysis.centroidX;
      stopCentroidRef.current = stopAnalysis.centroidX;

      setTrackMotion(trackAnalysis.level);
      setStopMotion(stopAnalysis.level);

      if (detecting && !isCalibrating) {
        const trackBaseline =
          baselineTrackRef.current.length > 0
            ? baselineTrackRef.current.reduce((a, b) => a + b, 0) / baselineTrackRef.current.length
            : 0;
        const stopBaseline =
          baselineStopRef.current.length > 0
            ? baselineStopRef.current.reduce((a, b) => a + b, 0) / baselineStopRef.current.length
            : 0;
        const trackThreshold = Math.max(cfg.sensitivity, trackBaseline * 2.5);
        const stopThreshold = Math.max(cfg.sensitivity + 4, stopBaseline * 2.5);
        const now = Date.now();

        const trackCrossTrend = detectMotionTrend(
          trackHistoryRef.current,
          trackAnalysis.level,
          trackThreshold,
        );
        const trackFlowTrend = hemisphereFlow(trackAnalysis.leftMotion, trackAnalysis.rightMotion);
        const resolvedTrackTrend = combineTrends(trackCrossTrend, trackFlowTrend, trackInstantDir);
        trackTrendRef.current = resolvedTrackTrend;
        setTrackTrend(resolvedTrackTrend);

        const stopCrossTrend = detectMotionTrend(
          stopHistoryRef.current,
          stopAnalysis.level,
          stopThreshold,
        );
        const stopFlowTrend = hemisphereFlow(stopAnalysis.leftMotion, stopAnalysis.rightMotion);
        const resolvedStopTrend = combineTrends(stopCrossTrend, stopFlowTrend, stopInstantDir);
        stopTrendRef.current = resolvedStopTrend;
        setStopTrend(resolvedStopTrend);

        // Pool is toward lower X (left); wall toward higher X (right)
        if (
          trackAnalysis.level > trackThreshold &&
          resolvedTrackTrend === 'toward-pool' &&
          now - lastTrackOutRef.current > cfg.cooldownMs
        ) {
          lastTrackOutRef.current = now;
          flashCrossing('track-outbound');
        }

        if (
          trackAnalysis.level > trackThreshold &&
          resolvedTrackTrend === 'toward-wall' &&
          now - lastTrackInRef.current > cfg.cooldownMs
        ) {
          lastTrackInRef.current = now;
          flashCrossing('track-inbound');
        }

        if (
          stopArmedRef.current &&
          stopAnalysis.level > stopThreshold &&
          resolvedStopTrend === 'toward-wall' &&
          now - lastStopRef.current > cfg.cooldownMs
        ) {
          lastStopRef.current = now;
          flashCrossing('stop');
        }
      } else if (!detecting) {
        trackTrendRef.current = 'none';
        stopTrendRef.current = 'none';
        setTrackTrend('none');
        setStopTrend('none');
      }

      if (isCalibrating) {
        baselineTrackRef.current.push(trackAnalysis.level);
        baselineStopRef.current.push(stopAnalysis.level);
      }

      const overlayCtx = canvas.getContext('2d');
      if (overlayCtx) {
        overlayCtx.fillStyle = 'rgba(245,158,11,0.12)';
        overlayCtx.fillRect(trackZone.left, 0, trackZone.width, canvas.height);
        overlayCtx.fillStyle = stopArmed
          ? 'rgba(34,197,94,0.18)'
          : 'rgba(239,68,68,0.1)';
        overlayCtx.fillRect(stopZone.left, 0, stopZone.width, canvas.height);

        overlayCtx.strokeStyle = '#f59e0b';
        overlayCtx.lineWidth = 3;
        overlayCtx.setLineDash([10, 6]);
        overlayCtx.beginPath();
        overlayCtx.moveTo(trackZone.line, 0);
        overlayCtx.lineTo(trackZone.line, canvas.height);
        overlayCtx.stroke();

        overlayCtx.strokeStyle = stopArmed ? '#22c55e' : '#ef4444';
        overlayCtx.beginPath();
        overlayCtx.moveTo(stopZone.line, 0);
        overlayCtx.lineTo(stopZone.line, canvas.height);
        overlayCtx.stroke();
        overlayCtx.setLineDash([]);

        if (detecting) {
          const trackSmoothed = smoothCentroidHistory(trackHistoryRef.current);
          const trackY = canvas.height * 0.38;
          if (trackSmoothed.length > 0) {
            const last = trackSmoothed[trackSmoothed.length - 1];
            const dotX = trackZone.left + last * trackZone.width;
            overlayCtx.fillStyle = '#fbbf24';
            overlayCtx.beginPath();
            overlayCtx.arc(dotX, trackY, 8, 0, Math.PI * 2);
            overlayCtx.fill();
          }

          drawDirectionArrow(
            overlayCtx,
            trackZone,
            canvas.height,
            trackTrendRef.current,
            trackTrendRef.current === 'none' ? 'rgba(251,191,36,0.35)' : '#fbbf24',
          );
          drawDirectionArrow(
            overlayCtx,
            stopZone,
            canvas.height,
            stopArmed ? stopTrendRef.current : 'none',
            stopTrendRef.current === 'none' ? 'rgba(239,68,68,0.35)' : '#22c55e',
          );

          overlayCtx.font = 'bold 13px system-ui, sans-serif';
          overlayCtx.fillStyle = '#fbbf24';
          overlayCtx.fillText(
            `Track ${trendLabel(trackTrendRef.current)}`,
            trackZone.left + 4,
            canvas.height * 0.12,
          );
          if (stopArmed) {
            overlayCtx.fillStyle = '#22c55e';
            overlayCtx.fillText(
              `Stop ${trendLabel(stopTrendRef.current)}`,
              stopZone.left + 4,
              canvas.height * 0.12,
            );
          }
        }
      }

      animationRef.current = requestAnimationFrame(analyze);
    };

    animationRef.current = requestAnimationFrame(analyze);
    return () => {
      cancelAnimationFrame(animationRef.current);
      clearCanvas(canvasRef.current);
    };
  }, [
    videoRef,
    canvasRef,
    cfg,
    active,
    detecting,
    stopArmed,
    isCalibrating,
    resetKey,
    flashCrossing,
  ]);

  return {
    trackMotion,
    stopMotion,
    trackTrend,
    stopTrend,
    lastCrossingFlash,
    calibrate,
    isCalibrating,
  };
}
