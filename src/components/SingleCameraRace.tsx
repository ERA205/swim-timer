import { useCallback, useEffect, useRef, useState } from 'react';
import { useCameraSocket } from '../context/CameraSocketContext';
import { useMotionDetection } from '../hooks/useMotionDetection';
import { useCameraStream } from '../hooks/useCameraStream';
import { useLocalRace } from '../hooks/useLocalRace';
import { SplitTimes } from './SplitTimes';
import { SyncStatusList } from './SyncStatus';
import { formatTime } from '../../shared/types';

export function SingleCameraRace() {
  const {
    connected,
    session,
    config,
    shouldStream,
    submitRaceResult,
    submitRaceUpdate,
    sendFrame,
    acknowledgeStart,
    syncEvents,
  } = useCameraSocket();

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const sessionRevision = session?.sessionRevision ?? 0;
  const [cameraKey, setCameraKey] = useState(0);
  const prevRevisionRef = useRef(-1);
  const prevStartedAtRef = useRef<number | null>(null);

  const handleUpdate = useCallback(
    (update: Parameters<typeof submitRaceUpdate>[0]) => submitRaceUpdate(update),
    [submitRaceUpdate],
  );

  const handleFinish = useCallback(
    (result: Parameters<typeof submitRaceResult>[0]) => {
      submitRaceResult(result);
      if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
    },
    [submitRaceResult],
  );

  const { race, registerDetection } = useLocalRace(session, config, handleUpdate, handleFinish);

  const handleDetection = useCallback(() => {
    registerDetection();
    if (navigator.vibrate) navigator.vibrate(200);
  }, [registerDetection]);

  const { motionLevel, calibrate, isCalibrating } = useMotionDetection({
    videoRef,
    canvasRef,
    config,
    active: !!stream,
    detecting: !!stream && race.status === 'running',
    resetKey: sessionRevision,
    onDetection: handleDetection,
  });

  useCameraStream({ videoRef, stream, shouldStream, sendFrame });

  useEffect(() => {
    if (
      race.status === 'running' &&
      race.startedAt &&
      race.startedAt !== prevStartedAtRef.current &&
      session
    ) {
      prevStartedAtRef.current = race.startedAt;
      acknowledgeStart(race.startedAt, session.sessionRevision);
    }
    if (race.status === 'idle') prevStartedAtRef.current = null;
  }, [race.status, race.startedAt, session, acknowledgeStart]);

  useEffect(() => {
    const onCalibrate = () => calibrate();
    window.addEventListener('swim-timer:calibrate', onCalibrate);
    return () => window.removeEventListener('swim-timer:calibrate', onCalibrate);
  }, [calibrate]);

  useEffect(() => {
    if (prevRevisionRef.current !== sessionRevision) {
      if (prevRevisionRef.current >= 0 && sessionRevision > prevRevisionRef.current) {
        setCameraKey((k) => k + 1);
      }
      prevRevisionRef.current = sessionRevision;
    }
  }, [sessionRevision]);

  useEffect(() => {
    let active = true;
    let localStream: MediaStream | null = null;
    async function startCamera() {
      setCameraError(null);
      try {
        localStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (!active) {
          localStream.getTracks().forEach((t) => t.stop());
          return;
        }
        setStream(localStream);
        if (videoRef.current) videoRef.current.srcObject = localStream;
      } catch (err) {
        setCameraError(err instanceof Error ? err.message : 'Camera unavailable');
      }
    }
    startCamera();
    return () => {
      active = false;
      localStream?.getTracks().forEach((t) => t.stop());
    };
  }, [cameraKey]);

  if (!session) {
    return <div className="panel"><p className="muted">Connecting…</p></div>;
  }

  return (
    <div className="camera-view">
      <header className="view-header compact">
        <div>
          <h1>Camera Mode</h1>
          <p className="subtitle">Local timing — results sent to coach</p>
        </div>
        <span className={`status-pill ${connected ? 'online' : 'offline'}`}>
          {connected ? 'Live' : 'Offline'}
        </span>
      </header>

      <div className="camera-stage">
        <video ref={videoRef} autoPlay playsInline muted className="camera-video" />
        <canvas key={`overlay-${sessionRevision}`} ref={canvasRef} className="camera-overlay" />
        {cameraError && <div className="camera-error"><p>{cameraError}</p></div>}
        {race.status === 'running' && <div className="camera-badge running">Timing</div>}
        {shouldStream && <div className="camera-badge streaming">Coach viewing</div>}
      </div>

      <div className="camera-hud">
        <div className="hud-metric hud-metric-wide">
          <span className="metric-label">Time</span>
          <span className="metric-value">{formatTime(race.elapsedMs)}</span>
          <SplitTimes
            splits={race.splits}
            elapsedMs={race.elapsedMs}
            finished={race.status === 'finished'}
            distanceYards={race.distanceYards}
          />
        </div>
        <div className="hud-metric">
          <span className="metric-label">Laps</span>
          <span className="metric-value">{race.currentLaps}/{race.totalLaps}</span>
        </div>
        <div className="hud-metric">
          <span className="metric-label">Motion</span>
          <span className="metric-value">{motionLevel.toFixed(1)}</span>
        </div>
      </div>

      <section className="panel camera-controls">
        <SyncStatusList events={syncEvents} title="Sending to coach" />
        <p className={`status-banner status-${race.status === 'running' ? 'running' : session.status}`}>
          {session.status === 'idle' && 'Waiting for coach to arm timer'}
          {session.status === 'ready' && 'Armed — waiting for coach start'}
          {race.status === 'running' && 'Timing locally from coach start'}
          {race.status === 'finished' && `Done — ${formatTime(race.elapsedMs)} recorded`}
        </p>
        <div className="action-row">
          <button type="button" className="btn ghost" onClick={calibrate} disabled={isCalibrating || race.status === 'running'}>
            {isCalibrating ? 'Calibrating…' : 'Calibrate'}
          </button>
        </div>
      </section>
    </div>
  );
}
