import { useCallback, useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import type { DetectionConfig, SessionState, SyncEvent } from '../../shared/types';
import { DEFAULT_DETECTION_CONFIG, POOL_LENGTH_YARDS } from '../../shared/types';
import type { RaceMode } from '../../shared/types';
import type { RaceResult, RaceUpdate } from './useLocalRace';
import type { MultiRaceResult, MultiRaceUpdate } from './useMultiSwimmerRace';
import { useSyncQueue } from './useSyncQueue';

const SOCKET_URL =
  import.meta.env.DEV ? 'http://localhost:3001' : window.location.origin;

export type ClientRole = 'coach' | 'camera';
export type StartAckState = 'none' | 'waiting' | 'confirmed';

type AckResponse = { ok: boolean };

export function useSocket(role: ClientRole) {
  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [session, setSession] = useState<SessionState | null>(null);
  const [config, setConfig] = useState<DetectionConfig>(DEFAULT_DETECTION_CONFIG);
  const [cameraFrame, setCameraFrame] = useState<string | null>(null);
  const [cameraConnected, setCameraConnected] = useState(false);
  const [isViewingCamera, setIsViewingCamera] = useState(false);
  const [cameraSetupPrompt, setCameraSetupPrompt] = useState(false);
  const [shouldStream, setShouldStream] = useState(false);
  const [startAck, setStartAck] = useState<StartAckState>('none');

  const coachSync = useSyncQueue();
  const cameraSync = useSyncQueue();
  const coachSyncRef = useRef(coachSync);
  const cameraSyncRef = useRef(cameraSync);

  useEffect(() => {
    coachSyncRef.current = coachSync;
    cameraSyncRef.current = cameraSync;
  });

  const startCameraView = useCallback(() => {
    socketRef.current?.emit('camera:stream-start');
    setIsViewingCamera(true);
    setCameraSetupPrompt(false);
    setCameraFrame(null);
  }, []);

  const stopCameraView = useCallback(() => {
    socketRef.current?.emit('camera:stream-stop');
    setIsViewingCamera(false);
    setCameraFrame(null);
  }, []);

  const emitWithAck = useCallback(
    <T,>(event: string, payload: T): Promise<AckResponse> =>
      new Promise((resolve) => {
        const socket = socketRef.current;
        if (!socket?.connected) {
          resolve({ ok: false });
          return;
        }
        socket.emit(event, payload, (response: AckResponse) => {
          resolve(response ?? { ok: false });
        });
      }),
    [],
  );

  useEffect(() => {
    const socket = io(SOCKET_URL, { transports: ['websocket', 'polling'] });
    socketRef.current = socket;

    const onConnect = () => {
      setConnected(true);
      socket.emit('client:register', role);
    };

    const onSessionUpdate = (next: SessionState) => {
      setSession((prev) => {
        if (prev && next.sessionRevision !== prev.sessionRevision) {
          setStartAck('none');
          coachSyncRef.current.clearAll();
          cameraSyncRef.current.clearAll();
        } else if (prev?.status === 'running' && next.status !== 'running') {
          setStartAck('none');
        } else if (prev?.status !== 'running' && next.status === 'running') {
          setStartAck('waiting');
        }
        return next;
      });
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', () => setConnected(false));
    socket.on('session:update', onSessionUpdate);
    socket.on('config:update', setConfig);

    if (role === 'coach') {
      socket.on('camera:frame', setCameraFrame);
      socket.on('camera:status', (status: { connected: boolean }) => {
        setCameraConnected(status.connected);
        if (!status.connected) {
          setCameraFrame(null);
          setIsViewingCamera(false);
          setCameraSetupPrompt(false);
        }
      });
      socket.on('camera:joined', () => setCameraSetupPrompt(true));
      socket.on('camera:start-ack', () => setStartAck('confirmed'));

      socket.on(
        'sync:progress',
        (payload: {
          syncId: string;
          kind: SyncEvent['kind'];
          label: string;
          stage: 'sending' | 'confirmed' | 'failed';
        }) => {
          if (payload.stage === 'sending') {
            coachSyncRef.current.trackSync(payload.syncId, payload.kind, payload.label);
          } else if (payload.stage === 'confirmed') {
            coachSyncRef.current.confirmSync(payload.syncId);
          } else {
            coachSyncRef.current.failSync(payload.syncId);
          }
        },
      );
    }

    if (role === 'camera') {
      socket.on('camera:stream-state', (state: { streaming: boolean }) => {
        setShouldStream(state.streaming);
        if (!state.streaming) {
          window.dispatchEvent(new CustomEvent('swim-timer:stream-stop'));
        }
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
      socket.off('camera:joined');
      socket.off('camera:start-ack');
      socket.off('sync:progress');
      socket.off('camera:stream-state');
      socket.off('camera:calibrate');
      socket.disconnect();
    };
  }, [role]);

  const acknowledgeStart = useCallback(
    async (startedAt: number, sessionRevision: number) => {
      const id = cameraSyncRef.current.beginSync(
        'start',
        'Start time received — timing locally',
      );
      const result = await emitWithAck('camera:start-ack', {
        startedAt,
        sessionRevision,
        syncId: id,
      });
      if (result.ok) {
        cameraSyncRef.current.confirmSync(id);
      } else {
        cameraSyncRef.current.failSync(id);
      }
    },
    [emitWithAck],
  );

  const submitRaceUpdate = useCallback(
    async (update: RaceUpdate) => {
      const yards = update.currentLaps * POOL_LENGTH_YARDS;
      const id = cameraSyncRef.current.beginSync(
        'split',
        `Recorded ${yards} yd split — sending to coach`,
        true,
      );
      const result = await emitWithAck('camera:race-update', { ...update, syncId: id });
      if (result.ok) {
        cameraSyncRef.current.confirmSync(id);
      } else {
        cameraSyncRef.current.failSync(id);
      }
    },
    [emitWithAck],
  );

  const submitRaceResult = useCallback(
    async (result: RaceResult) => {
      const id = cameraSyncRef.current.beginSync(
        'finish',
        'Recorded finish — sending to coach',
        true,
      );
      const ack = await emitWithAck('camera:race-result', { ...result, syncId: id });
      if (ack.ok) {
        cameraSyncRef.current.confirmSync(id);
      } else {
        cameraSyncRef.current.failSync(id);
      }
    },
    [emitWithAck],
  );

  const submitMultiRaceUpdate = useCallback(
    async (update: MultiRaceUpdate) => {
      const id = cameraSyncRef.current.beginSync(
        'split',
        'Recorded swimmer update — sending to coach',
        true,
      );
      const result = await emitWithAck('camera:multi-race-update', { ...update, syncId: id });
      if (result.ok) cameraSyncRef.current.confirmSync(id);
      else cameraSyncRef.current.failSync(id);
    },
    [emitWithAck],
  );

  const submitMultiRaceResult = useCallback(
    async (result: MultiRaceResult) => {
      const id = cameraSyncRef.current.beginSync(
        'finish',
        'Recorded all finishes — sending to coach',
        true,
      );
      const ack = await emitWithAck('camera:multi-race-result', { ...result, syncId: id });
      if (ack.ok) cameraSyncRef.current.confirmSync(id);
      else cameraSyncRef.current.failSync(id);
    },
    [emitWithAck],
  );

  const emit = <T extends unknown[]>(event: string, ...args: T) => {
    socketRef.current?.emit(event, ...args);
  };

  return {
    connected,
    session,
    config,
    cameraFrame,
    cameraConnected,
    isViewingCamera,
    cameraSetupPrompt,
    startAck,
    syncEvents: role === 'coach' ? coachSync.events : cameraSync.events,
    dismissCameraPrompt: () => setCameraSetupPrompt(false),
    startCameraView,
    stopCameraView,
    shouldStream,
    acknowledgeStart,
    setDistance: (yards: number) => emit('session:set-distance', yards),
    setRaceMode: (mode: RaceMode) => emit('session:set-race-mode', mode),
    setSwimmerCount: (count: number) => emit('session:set-swimmer-count', count),
    setSwimmerName: (id: number, name: string) =>
      emit('session:set-swimmer-name', { id, name }),
    setName: (name: string) => emit('session:set-name', name),
    arm: () => emit('session:arm'),
    start: () => emit('session:start'),
    reset: () => emit('session:reset'),
    submitRaceResult,
    submitRaceUpdate,
    submitMultiRaceResult,
    submitMultiRaceUpdate,
    updateConfig: (partial: Partial<DetectionConfig>) =>
      emit('config:update', partial),
    sendFrame: (frame: string) => emit('camera:frame', frame),
    calibrateCamera: () => emit('camera:calibrate'),
  };
}
