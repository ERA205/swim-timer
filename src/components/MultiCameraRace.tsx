import { useCallback, useEffect, useRef, useState } from 'react';
import { useCameraSocket } from '../context/CameraSocketContext';
import { useMultiLineDetection } from '../hooks/useMultiLineDetection';
import { useCameraStream } from '../hooks/useCameraStream';
import { useMultiSwimmerRace } from '../hooks/useMultiSwimmerRace';
import { SwimmerPanel } from './SwimmerPanel';
import { SyncStatusList } from './SyncStatus';
import { formatTime } from '../../shared/types';

export function MultiCameraRace() {
  const {
    connected,
    session,
    config,
    shouldStream,
    submitMultiRaceResult,
    submitMultiRaceUpdate,
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
    (update: Parameters<typeof submitMultiRaceUpdate>[0]) => submitMultiRaceUpdate(update),
    [submitMultiRaceUpdate],
  );

  const handleFinish = useCallback(
    (result: Parameters<typeof submitMultiRaceResult>[0]) => {
      submitMultiRaceResult(result);
      if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
    },
    [submitMultiRaceResult],
  );

  const { race, handleCrossing, stopArmed } = useMultiSwimmerRace(
    session,
    config,
    handleUpdate,
    handleFinish,
  );

  const directionTesting = !!stream && session.status === 'ready';
  const directionActive = !!stream && (session.status === 'ready' || race.status === 'running');

  const {
    trackMotion,
    stopMotion,
    trackTrend,
    stopTrend,
    lastCrossingFlash,
    calibrate,
    isCalibrating,
  } = useMultiLineDetection({
    videoRef,
    canvasRef,
    config,
    active: !!stream,
    detecting: directionActive,
    timingActive: race.status === 'running',
    stopArmed,
    resetKey: sessionRevision,
    onCrossing: handleCrossing,
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

  const focused = race.swimmers.find((s) => s.focused);
  const panelSwimmers = race.status === 'idle' ? session.swimmers : race.swimmers;
  const swimmersInWater = race.swimmers.filter(
    (s) => s.phase === 'out' || s.phase === 'returning',
  ).length;
  const swimmersDone = race.swimmers.filter((s) => s.phase === 'done').length;

  return (
    <div className="camera-view">
      <header className="view-header compact">
        <div>
          <h1>Camera Mode</h1>
          <p className="subtitle">
            {session.swimmerCount} swimmers — track + stop lines
          </p>
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
        {directionTesting && <div className="camera-badge direction-test">Direction test — wave past lines</div>}
        {shouldStream && <div className="camera-badge streaming">Coach viewing</div>}
        {focused && (
          <div className="camera-badge focused-swimmer">Tracking {focused.name}</div>
        )}
        {lastCrossingFlash && (
          <div className={`camera-badge crossing-flash crossing-${lastCrossingFlash.crossing}`}>
            {crossingLabel(lastCrossingFlash.crossing)}
          </div>
        )}
      </div>

      <div className="camera-hud">
        <div className="hud-metric">
          <span className="metric-label">Main clock</span>
          <span className="metric-value">{formatTime(race.elapsedMs)}</span>
        </div>
        <div className="hud-metric">
          <span className="metric-label">Track dir</span>
          <span className={`metric-value direction-${trackTrend}`}>{trendHudLabel(trackTrend)}</span>
        </div>
        <div className="hud-metric">
          <span className="metric-label">Stop dir</span>
          <span className={`metric-value direction-${stopTrend}`}>
            {stopArmed ? trendHudLabel(stopTrend) : 'off'}
          </span>
        </div>
        <div className="hud-metric">
          <span className="metric-label">Track motion</span>
          <span className="metric-value">{trackMotion.toFixed(1)}</span>
        </div>
        <div className="hud-metric">
          <span className="metric-label">Stop motion</span>
          <span className="metric-value">{stopMotion.toFixed(1)}</span>
        </div>
      </div>

      <SwimmerPanel
        swimmers={panelSwimmers}
        focusedSwimmerId={race.focusedSwimmerId}
        totalLaps={race.status === 'idle' ? session.totalLaps : race.totalLaps}
        detectionsNeeded={race.status === 'idle' ? session.detectionsNeeded : race.detectionsNeeded}
        distanceYards={race.status === 'idle' ? session.distanceYards : race.distanceYards}
        raceFinished={race.status === 'finished'}
        departedCount={race.status === 'running' ? race.departedCount : undefined}
        swimmerCount={session.swimmerCount}
      />

      <section className="panel camera-controls">
        <SyncStatusList events={syncEvents} title="Sending to coach" />
        <p className={`status-banner status-${race.status === 'running' ? 'running' : session.status}`}>
          {session.status === 'idle' && `Waiting for coach — ${session.swimmerCount} swimmers configured`}
          {session.status === 'ready' && `Armed — ${session.swimmerCount} swimmers, waiting for coach start`}
          {race.status === 'running' && race.racePhase === 'departing' && (
            `Departures ${race.departedCount}/${session.swimmerCount} — waiting for all to leave wall`
          )}
          {race.status === 'running' && race.racePhase === 'racing' && stopArmed && (
            `Stop line armed for ${focused?.name ?? 'swimmer'}`
          )}
          {race.status === 'running' && race.racePhase === 'racing' && !stopArmed && (
            `${swimmersInWater} swimming, ${swimmersDone} done — watching returns`
          )}
          {race.status === 'finished' && 'All swimmers done — results sent'}
        </p>
        <div className="action-row">
          <button type="button" className="btn ghost" onClick={calibrate} disabled={isCalibrating || race.status === 'running'}>
            {isCalibrating ? 'Calibrating…' : 'Calibrate'}
          </button>
        </div>
        {directionActive && (
          <p className="hint">
            Orange track line: ← pool = leaving wall, wall → = returning.
            {directionTesting && ' Test passes now — flashes confirm direction before you start.'}
          </p>
        )}
      </section>
    </div>
  );
}

function trendHudLabel(trend: 'toward-pool' | 'toward-wall' | 'none'): string {
  switch (trend) {
    case 'toward-pool':
      return '← leaving wall';
    case 'toward-wall':
      return '→ toward wall';
    default:
      return '—';
  }
}

function crossingLabel(crossing: 'track-outbound' | 'track-inbound' | 'stop'): string {
  switch (crossing) {
    case 'track-outbound':
      return 'OUT — leaving wall';
    case 'track-inbound':
      return 'IN — returning';
    case 'stop':
      return 'STOP — at wall';
  }
}
