import { useSocket } from '../hooks/useSocket';
import { SplitTimes } from './SplitTimes';
import { CameraSetupModal } from './CameraSetupModal';
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
    isViewingCamera,
    cameraSetupPrompt,
    dismissCameraPrompt,
    startCameraView,
    stopCameraView,
    setDistance,
    setName,
    arm,
    start,
    reset,
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
  const showResults = session.status === 'finished';

  return (
    <div className="coach-view">
      <header className="view-header">
        <div>
          <h1>Coach Dashboard</h1>
          <p className="subtitle">Start the race — timing runs on the lane camera</p>
        </div>
        <div className="header-status">
          <span className={`status-pill ${cameraConnected ? 'online' : 'offline'}`}>
            {cameraConnected ? 'Camera connected' : 'No camera'}
          </span>
          <span className={`status-pill ${connected ? 'online' : 'offline'}`}>
            {connected ? 'Connected' : 'Disconnected'}
          </span>
        </div>
      </header>

      {cameraSetupPrompt && !isViewingCamera && session.status !== 'running' && (
        <section className="panel setup-prompt">
          <p>Lane camera connected. Open setup to align the detection line before the race.</p>
          <div className="action-row">
            <button type="button" className="btn primary" onClick={startCameraView}>
              Setup camera
            </button>
            <button type="button" className="btn ghost" onClick={dismissCameraPrompt}>
              Dismiss
            </button>
          </div>
        </section>
      )}

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
              Each wall touch at the camera = 2 laps. {session.distanceYards} yd needs{' '}
              {session.detectionsNeeded} touch{session.detectionsNeeded === 1 ? '' : 'es'}.
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
            {cameraConnected && session.status !== 'running' && (
              <button type="button" className="btn ghost" onClick={startCameraView}>
                Setup camera
              </button>
            )}
          </div>
        </section>

        <section className="panel timer-panel">
          <div className="timer-readout">
            <span className="timer-label">
              {showResults ? 'Final time' : session.status === 'running' ? 'Race in progress' : 'Elapsed'}
            </span>
            {showResults ? (
              <>
                <span className="timer-value">{formatTime(session.elapsedMs)}</span>
                <SplitTimes
                  splits={session.splits}
                  elapsedMs={session.elapsedMs}
                  finished
                  distanceYards={session.distanceYards}
                />
              </>
            ) : session.status === 'running' ? (
              <span className="timer-value timer-waiting">—</span>
            ) : (
              <span className="timer-value">{formatTime(session.elapsedMs)}</span>
            )}
          </div>

          {showResults && (
            <>
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
            </>
          )}

          <p className={`status-banner status-${session.status}`}>
            {session.status === 'idle' && 'Set distance and arm the timer'}
            {session.status === 'ready' && 'Ready — hit Start when the swimmer goes'}
            {session.status === 'running' &&
              `${session.swimmerName || 'Swimmer'} racing — timing on lane camera…`}
            {session.status === 'finished' &&
              `Finished! ${formatTime(session.elapsedMs)} for ${session.distanceYards} yd`}
          </p>
        </section>
      </div>

      <CameraSetupModal
        open={isViewingCamera}
        frame={cameraFrame}
        config={config}
        onUpdateConfig={updateConfig}
        onCalibrate={calibrateCamera}
        onClose={stopCameraView}
      />

      <section className="panel info-panel">
        <h2>How it works</h2>
        <ol className="steps">
          <li>Open <strong>Camera Mode</strong> on the fixed phone at the end of the lane.</li>
          <li>Use <strong>Setup camera</strong> to briefly view the feed and align the detection line.</li>
          <li>Hit <strong>Start Race</strong> — the phone times locally from that exact moment.</li>
          <li>When the swimmer finishes, results are sent back to this screen automatically.</li>
        </ol>
      </section>
    </div>
  );
}
