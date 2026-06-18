import { useSocket } from '../hooks/useSocket';
import { useEstimatedElapsed } from '../hooks/useEstimatedElapsed';
import { SplitTimes } from './SplitTimes';
import { CameraSetupModal } from './CameraSetupModal';
import { CameraLinkStatus, SyncStatusList } from './SyncStatus';
import { SwimmerPanel } from './SwimmerPanel';
import {
  formatDistanceLabel,
  formatTime,
  POOL_LENGTH_YARDS,
  type RaceMode,
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
    setRaceMode,
    setSwimmerCount,
    setSwimmerName,
    setName,
    arm,
    start,
    reset,
    updateConfig,
    calibrateCamera,
    startAck,
    syncEvents,
  } = useSocket('coach');

  const isRunning = session?.status === 'running';
  const isFinished = session?.status === 'finished';
  const estimateMs = useEstimatedElapsed(session?.startedAt ?? null, !!isRunning);

  if (!session) {
    return (
      <div className="panel">
        <p className="muted">Connecting to timer server…</p>
      </div>
    );
  }

  const isMulti = session.raceMode === 'multi';
  const progress =
    session.totalLaps > 0 ? (session.currentLaps / (session.totalLaps * session.swimmerCount)) * 100 : 0;
  const displayElapsed = isFinished ? session.elapsedMs : isRunning ? estimateMs : session.elapsedMs;

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

          <div className="field">
            <span>Mode</span>
            <div className="chip-row">
              {(['single', 'multi'] as RaceMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={`chip ${session.raceMode === mode ? 'active' : ''}`}
                  onClick={() => setRaceMode(mode)}
                  disabled={session.status === 'running'}
                >
                  {mode === 'single' ? 'Single swimmer' : 'Multi swimmer'}
                </button>
              ))}
            </div>
          </div>

          {isMulti ? (
            <>
              <div className="field">
                <span>Swimmers in lane</span>
                <div className="chip-row">
                  {[2, 3, 4, 5, 6].map((n) => (
                    <button
                      key={n}
                      type="button"
                      className={`chip ${session.swimmerCount === n ? 'active' : ''}`}
                      onClick={() => setSwimmerCount(n)}
                      disabled={session.status === 'running'}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>
              {session.swimmers.map((swimmer) => (
                <label key={swimmer.id} className="field">
                  <span>{swimmer.id === 0 ? 'Leader' : `Swimmer ${swimmer.id + 1}`}</span>
                  <input
                    type="text"
                    value={swimmer.name}
                    onChange={(e) => setSwimmerName(swimmer.id, e.target.value)}
                    disabled={session.status === 'running'}
                  />
                </label>
              ))}
            </>
          ) : (
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
          )}

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
              {isMulti
                ? 'Track line counts send-offs. Stop line records wall touches for the focused swimmer only.'
                : `Each wall touch at the camera = 2 laps. ${session.distanceYards} yd needs ${session.detectionsNeeded} touch${session.detectionsNeeded === 1 ? '' : 'es'}.`}
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
          <CameraLinkStatus
            cameraConnected={cameraConnected}
            startAck={isRunning || isFinished ? startAck : 'none'}
          />

          {(isRunning || isFinished) && (
            <SyncStatusList
              events={syncEvents}
              title="Data from camera"
              emptyMessage={
                isRunning && syncEvents.length === 0
                  ? 'Splits will appear here as the camera sends them'
                  : undefined
              }
            />
          )}

          <div className="timer-readout">
            <span className="timer-label">
              {isFinished ? 'Final time' : isRunning ? 'Estimate' : 'Elapsed'}
            </span>
            <span className={`timer-value ${isRunning ? 'timer-estimate' : ''}`}>
              {formatTime(displayElapsed)}
            </span>
            {(isRunning || isFinished) && !isMulti && (
              <SplitTimes
                splits={session.splits}
                elapsedMs={isFinished ? session.elapsedMs : estimateMs}
                finished={isFinished}
                distanceYards={session.distanceYards}
              />
            )}
            {isRunning && !isMulti && (
              <p className="hint timer-hint">Final time updates from camera at finish</p>
            )}
          </div>

          {(isRunning || isFinished) && isMulti && (
            <SwimmerPanel
              swimmers={session.swimmers}
              focusedSwimmerId={session.focusedSwimmerId}
              totalLaps={session.totalLaps}
              distanceYards={session.distanceYards}
              raceFinished={isFinished}
            />
          )}

          {(isRunning || isFinished) && (
            <>
              <div className="lap-readout">
                <div>
                  <span className="metric-label">Laps</span>
                  <span className="metric-value">
                    {session.currentLaps} / {isMulti ? session.totalLaps * session.swimmerCount : session.totalLaps}
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
              (isMulti
                ? `${session.swimmerName || 'Lane'} racing — multi-swimmer tracking`
                : `${session.swimmerName || 'Swimmer'} racing — splits from camera`)}
            {session.status === 'finished' &&
              `Finished! ${formatTime(session.elapsedMs)} for ${session.distanceYards} yd`}
          </p>
        </section>
      </div>

      <CameraSetupModal
        open={isViewingCamera}
        frame={cameraFrame}
        config={config}
        multiMode={isMulti}
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
          <li>Splits appear here as they happen; the final time updates when the swimmer finishes.</li>
        </ol>
      </section>
    </div>
  );
}
