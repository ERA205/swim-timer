import { useCallback, useEffect, useRef } from 'react';
import type { DetectionConfig } from '../../shared/types';

interface CoachCameraFeedProps {
  frame: string | null;
  connected: boolean;
  config: DetectionConfig;
  onUpdateConfig: (partial: Partial<DetectionConfig>) => void;
  onCalibrate: () => void;
}

function drawOverlay(
  canvas: HTMLCanvasElement,
  image: HTMLImageElement,
  config: DetectionConfig,
) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const width = image.clientWidth;
  const height = image.clientHeight;
  if (width === 0 || height === 0) return;

  canvas.width = width;
  canvas.height = height;

  ctx.clearRect(0, 0, width, height);

  const lineX = config.lineX * width;
  const zoneHalf = (config.zoneWidth * width) / 2;
  const zoneLeft = Math.max(0, lineX - zoneHalf);
  const zoneWidth = Math.min(width, lineX + zoneHalf) - zoneLeft;

  ctx.fillStyle = 'rgba(59,130,246,0.12)';
  ctx.fillRect(zoneLeft, 0, zoneWidth, height);

  ctx.strokeStyle = '#3b82f6';
  ctx.lineWidth = 2;
  ctx.setLineDash([10, 6]);
  ctx.beginPath();
  ctx.moveTo(lineX, 0);
  ctx.lineTo(lineX, height);
  ctx.stroke();
  ctx.setLineDash([]);
}

export function CoachCameraFeed({
  frame,
  connected,
  config,
  onUpdateConfig,
  onCalibrate,
}: CoachCameraFeedProps) {
  const imgRef = useRef<HTMLImageElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);

  const adjustLine = (delta: number) => {
    onUpdateConfig({ lineX: Math.min(0.9, Math.max(0.1, config.lineX + delta)) });
  };

  const redrawOverlay = useCallback(() => {
    const img = imgRef.current;
    const canvas = overlayRef.current;
    if (img && canvas && img.complete) {
      drawOverlay(canvas, img, config);
    }
  }, [config]);

  useEffect(() => {
    redrawOverlay();
  }, [redrawOverlay, frame]);

  return (
    <section className="panel coach-camera-panel">
      <div className="coach-camera-header">
        <h2>Lane Camera</h2>
        <span className={`status-pill ${connected ? 'online' : 'offline'}`}>
          {connected ? 'Camera live' : 'Camera offline'}
        </span>
      </div>

      <div className="coach-camera-stage">
        {!frame && (
          <div className="coach-camera-placeholder">
            <p>{connected ? 'Waiting for video…' : 'Open Camera mode on the fixed phone'}</p>
            <p className="hint">Use <strong>?mode=camera</strong> on the phone URL</p>
          </div>
        )}
        {frame && (
          <img
            ref={imgRef}
            src={frame}
            alt="Lane camera feed"
            className="coach-camera-img"
            onLoad={redrawOverlay}
          />
        )}
        <canvas ref={overlayRef} className="coach-camera-overlay" />
      </div>

      <p className="hint">
        Adjust the vertical detection line from here. The phone camera is fixed — align the
        blue line with the wall plane where swimmers cross.
      </p>

      <div className="slider-row">
        <label>
          Line position (left ↔ right)
          <input
            type="range"
            min={0.1}
            max={0.9}
            step={0.01}
            value={config.lineX}
            onChange={(e) => onUpdateConfig({ lineX: Number(e.target.value) })}
          />
        </label>
      </div>

      <div className="slider-row">
        <label>
          Sensitivity
          <input
            type="range"
            min={8}
            max={40}
            step={1}
            value={config.sensitivity}
            onChange={(e) => onUpdateConfig({ sensitivity: Number(e.target.value) })}
          />
        </label>
      </div>

      <div className="action-row">
        <button type="button" className="btn ghost" onClick={() => adjustLine(-0.03)}>
          Line left
        </button>
        <button type="button" className="btn ghost" onClick={() => adjustLine(0.03)}>
          Line right
        </button>
        <button type="button" className="btn primary" onClick={onCalibrate}>
          Calibrate (empty lane)
        </button>
      </div>
    </section>
  );
}
