import { useCallback, useEffect, useRef } from 'react';
import { normalizeConfig, type DetectionConfig } from '../../shared/types';
import { drawDetectionOverlay } from '../utils/detectionOverlay';

interface CameraSetupModalProps {
  open: boolean;
  frame: string | null;
  config: DetectionConfig;
  multiMode: boolean;
  onUpdateConfig: (partial: Partial<DetectionConfig>) => void;
  onCalibrate: () => void;
  onClose: () => void;
}

export function CameraSetupModal({
  open,
  frame,
  config,
  multiMode,
  onUpdateConfig,
  onCalibrate,
  onClose,
}: CameraSetupModalProps) {
  const imgRef = useRef<HTMLImageElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const cfg = normalizeConfig(config);

  const adjustTrack = (delta: number) => {
    onUpdateConfig({
      trackLineX: Math.min(cfg.stopLineX - 0.05, Math.max(0.1, cfg.trackLineX + delta)),
    });
  };

  const adjustStop = (delta: number) => {
    onUpdateConfig({
      stopLineX: Math.min(0.9, Math.max(cfg.trackLineX + 0.05, cfg.stopLineX + delta)),
    });
  };

  const redrawOverlay = useCallback(() => {
    const img = imgRef.current;
    const canvas = overlayRef.current;
    if (img && canvas && img.complete) {
      drawDetectionOverlay(canvas, img, config, multiMode);
    }
  }, [config, multiMode]);

  useEffect(() => {
    redrawOverlay();
  }, [redrawOverlay, frame]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Camera setup">
      <div className="modal-panel">
        <div className="modal-header">
          <div>
            <h2>Camera Setup</h2>
            <p className="hint">
              {multiMode
                ? 'Orange = track line (pool side). Red = stop line (wall).'
                : 'Align the stop line with the wall plane.'}
            </p>
          </div>
          <button type="button" className="btn ghost" onClick={onClose}>
            Done viewing
          </button>
        </div>

        <div className="coach-camera-stage">
          {!frame && (
            <div className="coach-camera-placeholder">
              <p>Waiting for camera feed…</p>
            </div>
          )}
          {frame && (
            <img
              ref={imgRef}
              src={frame}
              alt="Lane camera preview"
              className="coach-camera-img"
              onLoad={redrawOverlay}
            />
          )}
          <canvas ref={overlayRef} className="coach-camera-overlay" />
        </div>

        {multiMode ? (
          <>
            <div className="slider-row">
              <label>
                Track line (send-off / return detect)
                <input
                  type="range"
                  min={0.1}
                  max={0.85}
                  step={0.01}
                  value={cfg.trackLineX}
                  onChange={(e) => onUpdateConfig({ trackLineX: Number(e.target.value) })}
                />
              </label>
            </div>
            <div className="slider-row">
              <label>
                Stop line (wall / split)
                <input
                  type="range"
                  min={0.15}
                  max={0.9}
                  step={0.01}
                  value={cfg.stopLineX}
                  onChange={(e) => onUpdateConfig({ stopLineX: Number(e.target.value) })}
                />
              </label>
            </div>
            <div className="action-row">
              <button type="button" className="btn ghost" onClick={() => adjustTrack(-0.03)}>
                Track left
              </button>
              <button type="button" className="btn ghost" onClick={() => adjustTrack(0.03)}>
                Track right
              </button>
              <button type="button" className="btn ghost" onClick={() => adjustStop(-0.03)}>
                Stop left
              </button>
              <button type="button" className="btn ghost" onClick={() => adjustStop(0.03)}>
                Stop right
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="slider-row">
              <label>
                Stop line position
                <input
                  type="range"
                  min={0.1}
                  max={0.9}
                  step={0.01}
                  value={cfg.stopLineX}
                  onChange={(e) => onUpdateConfig({ stopLineX: Number(e.target.value) })}
                />
              </label>
            </div>
            <div className="action-row">
              <button type="button" className="btn ghost" onClick={() => adjustStop(-0.03)}>
                Line left
              </button>
              <button type="button" className="btn ghost" onClick={() => adjustStop(0.03)}>
                Line right
              </button>
            </div>
          </>
        )}

        <div className="slider-row">
          <label>
            Sensitivity
            <input
              type="range"
              min={8}
              max={40}
              step={1}
              value={cfg.sensitivity}
              onChange={(e) => onUpdateConfig({ sensitivity: Number(e.target.value) })}
            />
          </label>
        </div>

        <div className="action-row">
          <button type="button" className="btn primary" onClick={onCalibrate}>
            Calibrate (empty lane)
          </button>
        </div>
      </div>
    </div>
  );
}
