import { useCallback, useEffect, useRef, useState } from 'react';
import { useSocket } from '../hooks/useSocket';
import { useMotionDetection } from '../hooks/useMotionDetection';
import { formatTime } from '../../shared/types';

export function CameraView() {
  const {
    connected,
    session,
    config,
    registerDetection,
    updateConfig,
  } = useSocket();

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [stream, setStream] = useState<MediaStream | null>(null);

  const detectionEnabled = session?.status === 'running';

  const handleDetection = useCallback(() => {
    registerDetection();
    if (navigator.vibrate) navigator.vibrate(200);
  }, [registerDetection]);

  const { motionLevel, calibrate, isCalibrating } = useMotionDetection({
    videoRef,
    canvasRef,
    config,
    enabled: !!stream && detectionEnabled,
    onDetection: handleDetection,
  });

  useEffect(() => {
    let active = true;
    let localStream: MediaStream | null = null;

    async function startCamera() {
      setCameraError(null);
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
      }

      try {
        localStream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode,
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });

        if (!active) {
          localStream.getTracks().forEach((t) => t.stop());
          return;
        }

        setStream(localStream);
        if (videoRef.current) {
          videoRef.current.srcObject = localStream;
        }
      } catch (err) {
        setCameraError(
          err instanceof Error
            ? err.message
            : 'Could not access camera. Use HTTPS and grant permission.',
        );
      }
    }

    startCamera();

    return () => {
      active = false;
      localStream?.getTracks().forEach((t) => t.stop());
    };
  }, [facingMode]);

  const adjustLine = (delta: number) => {
    updateConfig({ lineY: Math.min(0.9, Math.max(0.1, config.lineY + delta)) });
  };

  if (!session) {
    return (
      <div className="panel">
        <p className="muted">Connecting to timer server…</p>
      </div>
    );
  }

  return (
    <div className="camera-view">
      <header className="view-header compact">
        <div>
          <h1>Camera Mode</h1>
          <p className="subtitle">Point at the wall plane — detect arm/body crossings</p>
        </div>
        <span className={`status-pill ${connected ? 'online' : 'offline'}`}>
          {connected ? 'Live' : 'Offline'}
        </span>
      </header>

      <div className="camera-stage">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="camera-video"
        />
        <canvas ref={canvasRef} className="camera-overlay" />

        {cameraError && (
          <div className="camera-error">
            <p>{cameraError}</p>
            <p className="hint">On iPhone: use Safari and accept the self-signed certificate warning.</p>
          </div>
        )}

        {detectionEnabled && (
          <div className="camera-badge running">Recording</div>
        )}
      </div>

      <div className="camera-hud">
        <div className="hud-metric">
          <span className="metric-label">Time</span>
          <span className="metric-value">{formatTime(session.elapsedMs)}</span>
        </div>
        <div className="hud-metric">
          <span className="metric-label">Laps</span>
          <span className="metric-value">
            {session.currentLaps}/{session.totalLaps}
          </span>
        </div>
        <div className="hud-metric">
          <span className="metric-label">Motion</span>
          <span className="metric-value">{motionLevel.toFixed(1)}</span>
        </div>
      </div>

      <section className="panel camera-controls">
        <h2>Detection plane</h2>
        <p className="hint">
          Align the blue line with the wall plane. When a swimmer&apos;s arm or torso
          crosses it, a lap is counted.
        </p>

        <div className="slider-row">
          <label>
            Line position
            <input
              type="range"
              min={0.1}
              max={0.9}
              step={0.01}
              value={config.lineY}
              onChange={(e) => updateConfig({ lineY: Number(e.target.value) })}
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
              onChange={(e) => updateConfig({ sensitivity: Number(e.target.value) })}
            />
          </label>
        </div>

        <div className="action-row">
          <button type="button" className="btn ghost" onClick={() => adjustLine(-0.03)}>
            Line up
          </button>
          <button type="button" className="btn ghost" onClick={() => adjustLine(0.03)}>
            Line down
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={calibrate}
            disabled={isCalibrating}
          >
            {isCalibrating ? 'Calibrating…' : 'Calibrate (empty lane)'}
          </button>
          <button
            type="button"
            className="btn ghost"
            onClick={() =>
              setFacingMode((f) => (f === 'environment' ? 'user' : 'environment'))
            }
          >
            Flip camera
          </button>
        </div>

        <p className={`status-banner status-${session.status}`}>
          {session.status === 'idle' && 'Waiting for coach to arm timer'}
          {session.status === 'ready' && 'Armed — ready to start'}
          {session.status === 'running' && 'Detecting crossings…'}
          {session.status === 'finished' && `Done — ${formatTime(session.elapsedMs)}`}
        </p>
      </section>
    </div>
  );
}
