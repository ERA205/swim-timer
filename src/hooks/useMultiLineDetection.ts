import { useCallback, useEffect, useRef, useState } from 'react';
import {
  analyzeZoneMotion,
  motionDirection,
  normalizeConfig,
  type DetectionConfig,
  type LineCrossing,
} from '../../shared/types';

interface MultiLineDetectionOptions {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  config: DetectionConfig;
  active: boolean;
  detecting: boolean;
  stopArmed: boolean;
  resetKey: number;
  onCrossing: (crossing: LineCrossing) => void;
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

export function useMultiLineDetection({
  videoRef,
  canvasRef,
  config,
  active,
  detecting,
  stopArmed,
  resetKey,
  onCrossing,
}: MultiLineDetectionOptions) {
  const cfg = normalizeConfig(config);
  const [trackMotion, setTrackMotion] = useState(0);
  const [stopMotion, setStopMotion] = useState(0);
  const [isCalibrating, setIsCalibrating] = useState(false);

  const trackPrevFrameRef = useRef<ImageData | null>(null);
  const stopPrevFrameRef = useRef<ImageData | null>(null);
  const trackCentroidRef = useRef(0.5);
  const stopCentroidRef = useRef(0.5);
  const lastTrackOutRef = useRef(0);
  const lastTrackInRef = useRef(0);
  const lastStopRef = useRef(0);
  const baselineTrackRef = useRef<number[]>([]);
  const baselineStopRef = useRef<number[]>([]);
  const onCrossingRef = useRef(onCrossing);
  const stopArmedRef = useRef(stopArmed);
  const animationRef = useRef(0);

  useEffect(() => {
    onCrossingRef.current = onCrossing;
  }, [onCrossing]);

  useEffect(() => {
    stopArmedRef.current = stopArmed;
  }, [stopArmed]);

  const resetDetection = useCallback(() => {
    trackPrevFrameRef.current = null;
    stopPrevFrameRef.current = null;
    trackCentroidRef.current = 0.5;
    stopCentroidRef.current = 0.5;
    lastTrackOutRef.current = 0;
    lastTrackInRef.current = 0;
    lastStopRef.current = 0;
    baselineTrackRef.current = [];
    baselineStopRef.current = [];
    setTrackMotion(0);
    setStopMotion(0);
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

      trackAnalysis.direction = motionDirection(trackCentroidRef.current, trackAnalysis.centroidX);
      stopAnalysis.direction = motionDirection(stopCentroidRef.current, stopAnalysis.centroidX);

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

        // Pool is toward lower X (left); wall toward higher X (right)
        if (
          trackAnalysis.level > trackThreshold &&
          trackAnalysis.direction < 0 &&
          now - lastTrackOutRef.current > cfg.cooldownMs
        ) {
          lastTrackOutRef.current = now;
          onCrossingRef.current('track-outbound');
        }

        if (
          trackAnalysis.level > trackThreshold &&
          trackAnalysis.direction > 0 &&
          now - lastTrackInRef.current > cfg.cooldownMs
        ) {
          lastTrackInRef.current = now;
          onCrossingRef.current('track-inbound');
        }

        if (
          stopArmedRef.current &&
          stopAnalysis.level > stopThreshold &&
          stopAnalysis.direction > 0 &&
          now - lastStopRef.current > cfg.cooldownMs
        ) {
          lastStopRef.current = now;
          onCrossingRef.current('stop');
        }
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
      }

      animationRef.current = requestAnimationFrame(analyze);
    };

    animationRef.current = requestAnimationFrame(analyze);
    return () => {
      cancelAnimationFrame(animationRef.current);
      clearCanvas(canvasRef.current);
    };
  }, [videoRef, canvasRef, cfg, active, detecting, stopArmed, isCalibrating, resetKey]);

  return { trackMotion, stopMotion, calibrate, isCalibrating };
}
