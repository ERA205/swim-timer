import { useSocket } from '../hooks/useSocket';
import { SplitTimes } from './SplitTimes';
import { CoachCameraFeed } from './CoachCameraFeed';
import {
  formatDistanceLabel,
  formatTime,
  POOL_LENGTH_YARDS,
} from '../../shared/types';

const DISTANCE_OPTIONS = [25, 50, 100, 200, 500];

export function CoachView() {
  const {
    connected,
    session,
    config,
    cameraFrame,
    cameraConnected,
    setDistance,
    setName,
    arm,
    start,
    reset,
    manualDetection,
    updateConfig,
    calibrateCamera,
  } = useSocket('coach');

  if (!session) {
    return (
      <div className="panel">
        <p className="muted">Connecting to timer server…</p>
      </div>
    );
  }

  const progress =
    session.totalLaps > 0 ? (session.currentLaps / session.totalLaps) * 100 : 0;

  return (
    <div className="coach-view">
      <header className="view-header">
        <div>
          <h1>Coach Dashboard</h1>
          <p className="subtitle">Set the race and monitor splits from your laptop</p>
        </div>
        <span className={`status-pill ${connected ? 'online' : 'offline'}`}>
          {connected ? 'Connected' : 'Disconnected'}
        </span>
      </header>

      <div className="coach-grid">
        <section className="panel">
          <h2>Race Setup</h2>

          <label className="field">
            <span>Swimmer name</span>
            <input
              type="text"
              placeholder="e.g. Alex"
              value={session.swimmerName}
              onChange={(e) => setName(e.target.value)}
              disabled={session.status === 'running'}
            />
          </label>

          <div className="field">
            <span>Distance</span>
            <div className="chip-row">
              {DISTANCE_OPTIONS.map((d) => (
                <button
                  key={d}
                  type="button"
                  className={`chip ${session.distanceYards === d ? 'active' : ''}`}
                  onClick={() => setDistance(d)}
                  disabled={session.status === 'running'}
                >
                  {formatDistanceLabel(d)}
                </button>
              ))}
            </div>
            <p className="hint">
              Camera is at the start/finish wall. Each detection = 2 laps (out + back).
              {' '}
              {session.distanceYards} yd needs {session.detectionsNeeded} wall touch
              {session.detectionsNeeded === 1 ? '' : 'es'}.
            </p>
          </div>

          <div className="action-row">
            {session.status === 'idle' && (
              <button type="button" className="btn primary" onClick={arm}>
                Arm Timer
              </button>
            )}
            {(session.status === 'ready' || session.status === 'idle') && (
              <button type="button" className="btn success" onClick={start}>
                Start Race
              </button>
            )}
            {session.status !== 'idle' && (
              <button type="button" className="btn ghost" onClick={reset}>
                Reset
              </button>
            )}
          </div>
        </section>

        <section className="panel timer-panel">
          <div className="timer-readout">
            <span className="timer-label">Elapsed</span>
            <span className="timer-value">{formatTime(session.elapsedMs)}</span>
            <SplitTimes splits={session.splits} />
          </div>

          <div className="lap-readout">
            <div>
              <span className="metric-label">Laps</span>
              <span className="metric-value">
                {session.currentLaps} / {session.totalLaps}
              </span>
            </div>
            <div>
              <span className="metric-label">Wall touches</span>
              <span className="metric-value">
                {session.detectionsCount} / {session.detectionsNeeded}
              </span>
            </div>
            <div>
              <span className="metric-label">Pool</span>
              <span className="metric-value">{POOL_LENGTH_YARDS} yd</span>
            </div>
          </div>

          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${progress}%` }} />
          </div>

          <p className={`status-banner status-${session.status}`}>
            {session.status === 'idle' && 'Set distance and arm the timer'}
            {session.status === 'ready' && 'Ready — waiting for start'}
            {session.status === 'running' && `${session.swimmerName || 'Swimmer'} racing…`}
            {session.status === 'finished' &&
              `Finished! ${formatTime(session.elapsedMs)} for ${session.distanceYards} yd`}
          </p>

          {session.status === 'running' && (
            <button type="button" className="btn ghost full-width" onClick={manualDetection}>
              Manual lap (backup)
            </button>
          )}
        </section>
      </div>

      <CoachCameraFeed
        frame={cameraFrame}
        connected={cameraConnected}
        config={config}
        onUpdateConfig={updateConfig}
        onCalibrate={calibrateCamera}
      />

      <section className="panel info-panel">
        <h2>How it works</h2>
        <ol className="steps">
          <li>Open <strong>Camera Mode</strong> on the fixed phone at the end of the lane.</li>
          <li>Use the lane camera feed below to position the detection line on your laptop.</li>
          <li>Calibrate with an empty lane, then start the race when the swimmer dives in.</li>
          <li>
            For {session.distanceYards} yards: first return = {Math.min(2, session.totalLaps)} laps,
            {session.detectionsNeeded > 1 &&
              ` second return = finish (${session.totalLaps} laps total).`}
          </li>
        </ol>
      </section>
    </div>
  );
}
