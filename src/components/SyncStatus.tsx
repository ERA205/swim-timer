import type { SyncEvent } from '../../shared/types';

interface SyncStatusListProps {
  events: SyncEvent[];
  title?: string;
  emptyMessage?: string;
}

export function SyncStatusList({
  events,
  title = 'Camera data',
  emptyMessage,
}: SyncStatusListProps) {
  if (events.length === 0 && !emptyMessage) return null;

  return (
    <div className="sync-status-list">
      {title && <span className="sync-status-title">{title}</span>}
      {events.length === 0 && emptyMessage && (
        <p className="hint sync-empty">{emptyMessage}</p>
      )}
      {events.map((event) => (
        <div key={event.id} className={`sync-item sync-${event.state}`}>
          <div className="sync-item-header">
            <span className="sync-label">{event.label}</span>
            <span className="sync-state-text">
              {event.state === 'sending' && `${Math.round(event.progress)}%`}
              {event.state === 'confirmed' && 'Received'}
              {event.state === 'failed' && 'Failed'}
            </span>
          </div>
          <div className="sync-progress-bar">
            <div
              className="sync-progress-fill"
              style={{ width: `${event.progress}%` }}
            />
          </div>
          {event.recordedLocally && event.state === 'sending' && (
            <p className="sync-local-note">Recorded on camera — sending to coach…</p>
          )}
        </div>
      ))}
    </div>
  );
}

interface CameraLinkStatusProps {
  cameraConnected: boolean;
  startAck: 'none' | 'waiting' | 'confirmed';
}

export function CameraLinkStatus({ cameraConnected, startAck }: CameraLinkStatusProps) {
  return (
    <div className="camera-link-status">
      <div className={`link-row ${cameraConnected ? 'ok' : 'warn'}`}>
        <span className="link-dot" />
        <span>{cameraConnected ? 'Camera connected' : 'No camera connected'}</span>
      </div>
      {startAck !== 'none' && (
        <div className={`link-row ${startAck === 'confirmed' ? 'ok' : 'pending'}`}>
          <span className="link-dot" />
          <span>
            {startAck === 'waiting' && 'Waiting for camera to confirm start…'}
            {startAck === 'confirmed' && 'Camera received start time'}
          </span>
        </div>
      )}
    </div>
  );
}
