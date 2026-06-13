import { useState } from 'react';
import { CoachView } from './components/CoachView';
import { CameraView } from './components/CameraView';
import './App.css';

type ViewMode = 'coach' | 'camera';

export default function App() {
  const [mode, setMode] = useState<ViewMode>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('mode') === 'camera' ? 'camera' : 'coach';
  });

  return (
    <div className="app">
      <nav className="mode-nav">
        <button
          type="button"
          className={mode === 'coach' ? 'active' : ''}
          onClick={() => setMode('coach')}
        >
          Coach
        </button>
        <button
          type="button"
          className={mode === 'camera' ? 'active' : ''}
          onClick={() => setMode('camera')}
        >
          Camera
        </button>
      </nav>

      <main>{mode === 'coach' ? <CoachView /> : <CameraView />}</main>
    </div>
  );
}
