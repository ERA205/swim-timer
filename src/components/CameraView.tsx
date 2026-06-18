import { CameraSocketProvider } from '../context/CameraSocketContext';
import { SingleCameraRace } from './SingleCameraRace';
import { MultiCameraRace } from './MultiCameraRace';
import { useCameraSocket } from '../context/CameraSocketContext';

function CameraRaceRouter() {
  const { session } = useCameraSocket();
  if (!session) {
    return (
      <div className="panel">
        <p className="muted">Connecting to timer server…</p>
      </div>
    );
  }
  return session.raceMode === 'multi' ? <MultiCameraRace /> : <SingleCameraRace />;
}

export function CameraView() {
  return (
    <CameraSocketProvider>
      <CameraRaceRouter />
    </CameraSocketProvider>
  );
}
