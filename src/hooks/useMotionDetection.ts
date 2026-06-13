import { useCallback, useEffect, useRef, useState } from 'react';
import type { DetectionConfig } from '../../shared/types';

interface MotionDetectionOptions {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  config: DetectionConfig;
  active: boolean;
  detecting: boolean;
  resetKey: number;
  onDetection: () => void;
}

function clearCanvas(canvas: HTMLCanvasElement | null) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx || canvas.width === 0 || canvas.height === 0) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

export function useMotionDetection({
  videoRef,
  canvasRef,
  config,
  active,
  detecting,
  resetKey,
  onDetection,
}: MotionDetectionOptions) {
  const [motionLevel, setMotionLevel] = useState(0);
  const [isCalibrating, setIsCalibrating] = useState(false);
  const previousFrameRef = useRef<ImageData | null>(null);
  const animationRef = useRef<number>(0);
  const lastTriggerRef = useRef(0);
  const baselineRef = useRef<number[]>([]);
  const onDetectionRef = useRef(onDetection);

  useEffect(() => {
    onDetectionRef.current = onDetection;
  }, [onDetection]);

  const resetDetection = useCallback(() => {
    previousFrameRef.current = null;
    lastTriggerRef.current = 0;
    baselineRef.current = [];
    setMotionLevel(0);
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
      previousFrameRef.current = null;
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

      const lineX = Math.floor(config.lineX * canvas.width);
      const zoneLeft = Math.max(0, lineX - Math.floor((config.zoneWidth * canvas.width) / 2));
      const zoneRight = Math.min(
        canvas.width,
        lineX + Math.floor((config.zoneWidth * canvas.width) / 2),
      );
      const zoneWidth = zoneRight - zoneLeft;

      const imageData = ctx.getImageData(zoneLeft, 0, zoneWidth, canvas.height);
      const prev = previousFrameRef.current;

      let motion = 0;
      if (prev && prev.width === imageData.width && prev.height === imageData.height) {
        const data = imageData.data;
        const prevData = prev.data;
        let diffSum = 0;
        const step = 4;
        for (let i = 0; i < data.length; i += step * 8) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const pr = prevData[i];
          const pg = prevData[i + 1];
          const pb = prevData[i + 2];
          diffSum += Math.abs(r - pr) + Math.abs(g - pg) + Math.abs(b - pb);
        }
        const samples = data.length / (step * 8);
        motion = diffSum / samples;
      }

      previousFrameRef.current = imageData;
      setMotionLevel(motion);

      if (detecting) {
        if (isCalibrating) {
          baselineRef.current.push(motion);
        } else {
          const baseline =
            baselineRef.current.length > 0
              ? baselineRef.current.reduce((a, b) => a + b, 0) / baselineRef.current.length
              : 0;
          const threshold = Math.max(config.sensitivity, baseline * 2.5);
          const now = Date.now();

          if (motion > threshold && now - lastTriggerRef.current > config.cooldownMs) {
            lastTriggerRef.current = now;
            onDetectionRef.current();
          }
        }
      }

      const overlayCtx = canvas.getContext('2d');
      if (overlayCtx) {
        overlayCtx.strokeStyle = motion > config.sensitivity ? '#22c55e' : '#3b82f6';
        overlayCtx.lineWidth = 3;
        overlayCtx.setLineDash([12, 8]);
        overlayCtx.beginPath();
        overlayCtx.moveTo(lineX, 0);
        overlayCtx.lineTo(lineX, canvas.height);
        overlayCtx.stroke();
        overlayCtx.setLineDash([]);

        overlayCtx.fillStyle =
          motion > config.sensitivity ? 'rgba(34,197,94,0.15)' : 'rgba(59,130,246,0.1)';
        overlayCtx.fillRect(zoneLeft, 0, zoneWidth, canvas.height);
      }

      animationRef.current = requestAnimationFrame(analyze);
    };

    previousFrameRef.current = null;
    animationRef.current = requestAnimationFrame(analyze);
    return () => {
      cancelAnimationFrame(animationRef.current);
      clearCanvas(canvasRef.current);
      previousFrameRef.current = null;
    };
  }, [videoRef, canvasRef, config, active, detecting, isCalibrating, resetKey]);

  return { motionLevel, calibrate, isCalibrating, resetDetection };
}
