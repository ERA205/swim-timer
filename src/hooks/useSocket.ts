import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import type { DetectionConfig, SessionState } from '../../shared/types';
import { DEFAULT_DETECTION_CONFIG } from '../../shared/types';

const SOCKET_URL =
  import.meta.env.DEV ? 'http://localhost:3001' : window.location.origin;

export type ClientRole = 'coach' | 'camera';

export function useSocket(role: ClientRole) {
  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [session, setSession] = useState<SessionState | null>(null);
  const [config, setConfig] = useState<DetectionConfig>(DEFAULT_DETECTION_CONFIG);
  const [cameraFrame, setCameraFrame] = useState<string | null>(null);
  const [cameraConnected, setCameraConnected] = useState(false);
  const [shouldStream, setShouldStream] = useState(false);

  useEffect(() => {
    const socket = io(SOCKET_URL, { transports: ['websocket', 'polling'] });
    socketRef.current = socket;

    const onConnect = () => {
      setConnected(true);
      socket.emit('client:register', role);
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', () => setConnected(false));
    socket.on('session:update', setSession);
    socket.on('config:update', setConfig);

    if (role === 'coach') {
      socket.on('camera:frame', setCameraFrame);
      socket.on('camera:status', (status: { connected: boolean }) => {
        setCameraConnected(status.connected);
        if (!status.connected) setCameraFrame(null);
      });
    }

    if (role === 'camera') {
      socket.on('camera:stream-state', (state: { streaming: boolean }) => {
        setShouldStream(state.streaming);
      });
      socket.on('camera:calibrate', () => {
        window.dispatchEvent(new CustomEvent('swim-timer:calibrate'));
      });
    }

    if (socket.connected) onConnect();

    return () => {
      socket.off('connect', onConnect);
      socket.off('session:update');
      socket.off('config:update');
      socket.off('camera:frame');
      socket.off('camera:status');
      socket.off('camera:stream-state');
      socket.off('camera:calibrate');
      socket.disconnect();
    };
  }, [role]);

  const emit = <T extends unknown[]>(event: string, ...args: T) => {
    socketRef.current?.emit(event, ...args);
  };

  return {
    connected,
    session,
    config,
    cameraFrame,
    cameraConnected,
    shouldStream,
    setDistance: (yards: number) => emit('session:set-distance', yards),
    setName: (name: string) => emit('session:set-name', name),
    arm: () => emit('session:arm'),
    start: () => emit('session:start'),
    reset: () => emit('session:reset'),
    registerDetection: () => emit('detection:register'),
    manualDetection: () => emit('detection:manual'),
    updateConfig: (partial: Partial<DetectionConfig>) =>
      emit('config:update', partial),
    sendFrame: (frame: string) => emit('camera:frame', frame),
    calibrateCamera: () => emit('camera:calibrate'),
  };
}
