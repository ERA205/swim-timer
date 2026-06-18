import { createContext, useContext } from 'react';
import { useSocket } from '../hooks/useSocket';

type CameraSocket = ReturnType<typeof useSocket>;

const CameraSocketContext = createContext<CameraSocket | null>(null);

export function CameraSocketProvider({ children }: { children: React.ReactNode }) {
  const socket = useSocket('camera');
  return (
    <CameraSocketContext.Provider value={socket}>{children}</CameraSocketContext.Provider>
  );
}

export function useCameraSocket(): CameraSocket {
  const ctx = useContext(CameraSocketContext);
  if (!ctx) throw new Error('useCameraSocket must be used within CameraSocketProvider');
  return ctx;
}
