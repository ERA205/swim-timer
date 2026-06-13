import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import type { DetectionConfig, SessionState } from '../../shared/types';
import { DEFAULT_DETECTION_CONFIG } from '../../shared/types';

const SOCKET_URL =
  import.meta.env.DEV ? 'http://localhost:3001' : window.location.origin;

export function useSocket() {
  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [session, setSession] = useState<SessionState | null>(null);
  const [config, setConfig] = useState<DetectionConfig>(DEFAULT_DETECTION_CONFIG);

  useEffect(() => {
    const socket = io(SOCKET_URL, { transports: ['websocket', 'polling'] });
    socketRef.current = socket;

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('session:update', setSession);
    socket.on('config:update', setConfig);

    return () => {
      socket.disconnect();
    };
  }, []);

  const emit = <T extends unknown[]>(
    event: string,
    ...args: T
  ) => {
    socketRef.current?.emit(event, ...args);
  };

  return {
    connected,
    session,
    config,
    setDistance: (yards: number) => emit('session:set-distance', yards),
    setName: (name: string) => emit('session:set-name', name),
    arm: () => emit('session:arm'),
    start: () => emit('session:start'),
    reset: () => emit('session:reset'),
    registerDetection: () => emit('detection:register'),
    manualDetection: () => emit('detection:manual'),
    updateConfig: (partial: Partial<DetectionConfig>) =>
      emit('config:update', partial),
  };
}
