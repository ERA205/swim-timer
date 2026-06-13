import { useCallback, useEffect, useRef, useState } from 'react';
import type { DetectionConfig } from '../../shared/types';

interface MotionDetectionOptions {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  config: DetectionConfig;
  enabled: boolean;
  onDetection: () => void;
}

export function useMotionDetection({
  videoRef,
  canvasRef,
  config,
  enabled,
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

  const calibrate = useCallback(() => {
    setIsCalibrating(true);
    baselineRef.current = [];
    setTimeout(() => setIsCalibrating(false), 2000);
  }, []);

  useEffect(() => {
    if (!enabled) {
      cancelAnimationFrame(animationRef.current);
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

      const lineY = Math.floor(config.lineY * canvas.height);
      const zoneTop = Math.max(0, lineY - Math.floor((config.zoneHeight * canvas.height) / 2));
      const zoneBottom = Math.min(
        canvas.height,
        lineY + Math.floor((config.zoneHeight * canvas.height) / 2),
      );
      const zoneHeight = zoneBottom - zoneTop;

      const imageData = ctx.getImageData(0, zoneTop, canvas.width, zoneHeight);
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

      const overlayCtx = canvas.getContext('2d');
      if (overlayCtx) {
        overlayCtx.strokeStyle = motion > config.sensitivity ? '#22c55e' : '#3b82f6';
        overlayCtx.lineWidth = 3;
        overlayCtx.setLineDash([12, 8]);
        overlayCtx.beginPath();
        overlayCtx.moveTo(0, lineY);
        overlayCtx.lineTo(canvas.width, lineY);
        overlayCtx.stroke();
        overlayCtx.setLineDash([]);

        overlayCtx.fillStyle =
          motion > config.sensitivity ? 'rgba(34,197,94,0.15)' : 'rgba(59,130,246,0.1)';
        overlayCtx.fillRect(0, zoneTop, canvas.width, zoneHeight);
      }

      animationRef.current = requestAnimationFrame(analyze);
    };

    animationRef.current = requestAnimationFrame(analyze);
    return () => cancelAnimationFrame(animationRef.current);
  }, [videoRef, canvasRef, config, enabled, isCalibrating]);

  return { motionLevel, calibrate, isCalibrating };
}
