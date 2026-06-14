import { useCallback, useEffect, useRef, useState } from 'react';
import { useSocket } from '../hooks/useSocket';
import { useMotionDetection } from '../hooks/useMotionDetection';
import { useCameraStream } from '../hooks/useCameraStream';
import { SplitTimes } from './SplitTimes';
import { formatTime } from '../../shared/types';

export function CameraView() {
  const {
    connected,
    session,
    config,
    shouldStream,
    registerDetection,
    sendFrame,
  } = useSocket('camera');

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [stream, setStream] = useState<MediaStream | null>(null);
  const sessionRevision = session?.sessionRevision ?? 0;
  const [cameraKey, setCameraKey] = useState(0);
  const prevRevisionRef = useRef(-1);

  const detectionEnabled = session?.status === 'running';

  const handleDetection = useCallback(() => {
    registerDetection();
    if (navigator.vibrate) navigator.vibrate(200);
  }, [registerDetection]);

  const { motionLevel, calibrate, isCalibrating } = useMotionDetection({
    videoRef,
    canvasRef,
    config,
    active: !!stream,
    detecting: !!stream && detectionEnabled,
    resetKey: sessionRevision,
    onDetection: handleDetection,
  });

  useCameraStream({
    videoRef,
    stream,
    shouldStream,
    sendFrame,
  });

  useEffect(() => {
    const onCalibrate = () => calibrate();
    window.addEventListener('swim-timer:calibrate', onCalibrate);
    return () => window.removeEventListener('swim-timer:calibrate', onCalibrate);
  }, [calibrate]);

  useEffect(() => {
    if (prevRevisionRef.current !== sessionRevision) {
      const isReset = prevRevisionRef.current >= 0 && sessionRevision > prevRevisionRef.current;
      prevRevisionRef.current = sessionRevision;
      if (isReset) {
        setCameraKey((k) => k + 1);
      }
    }
  }, [sessionRevision]);

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
  }, [facingMode, cameraKey]);

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
          <p className="subtitle">Fixed lane camera — controls are on the coach laptop</p>
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
        <canvas
          key={`overlay-${sessionRevision}`}
          ref={canvasRef}
          className="camera-overlay"
        />

        {cameraError && (
          <div className="camera-error">
            <p>{cameraError}</p>
            <p className="hint">On iPhone: use Safari and accept the certificate warning.</p>
          </div>
        )}

        {detectionEnabled && (
          <div className="camera-badge running">Recording</div>
        )}
        {shouldStream && (
          <div className="camera-badge streaming">Streaming to coach</div>
        )}
      </div>

      <div className="camera-hud">
        <div className="hud-metric hud-metric-wide">
          <span className="metric-label">Time</span>
          <span className="metric-value">{formatTime(session.elapsedMs)}</span>
          <SplitTimes
            splits={session.splits}
            elapsedMs={session.elapsedMs}
            finished={session.status === 'finished'}
            distanceYards={session.distanceYards}
          />
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
        <p className={`status-banner status-${session.status}`}>
          {session.status === 'idle' && 'Waiting for coach to arm timer'}
          {session.status === 'ready' && 'Armed — ready to start'}
          {session.status === 'running' && 'Detecting crossings…'}
          {session.status === 'finished' && `Done — ${formatTime(session.elapsedMs)}`}
        </p>

        <div className="action-row">
          <button
            type="button"
            className="btn ghost"
            onClick={calibrate}
            disabled={isCalibrating}
          >
            {isCalibrating ? 'Calibrating…' : 'Calibrate locally'}
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
      </section>
    </div>
  );
}
