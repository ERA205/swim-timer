import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  createInitialSession,
  createSwimmers,
  POOL_LENGTH_YARDS,
  type DetectionConfig,
  type RaceMode,
  type SessionState,
  type SplitTime,
  type SwimmerState,
  DEFAULT_DETECTION_CONFIG,
} from '../shared/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3001;
const isProd = process.env.NODE_ENV === 'production';

const app = express();
app.use(cors());
app.use(express.json());

if (isProd) {
  const clientDist = path.join(__dirname, '../../dist');
  app.use(express.static(clientDist));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*' },
  maxHttpBufferSize: 5e6,
});

let session: SessionState = createInitialSession();
let detectionConfig: DetectionConfig = { ...DEFAULT_DETECTION_CONFIG };

let cameraSocketId: string | null = null;
let streamingCoachId: string | null = null;

function notifyCameraStatus() {
  io.emit('camera:status', { connected: cameraSocketId !== null });
}

function setCameraStreaming(coachId: string | null) {
  streamingCoachId = coachId;
  if (!cameraSocketId) return;
  io.to(cameraSocketId).emit('camera:stream-state', {
    streaming: coachId !== null,
  });
}

function broadcastState() {
  io.emit('session:update', session);
}

function broadcastConfig() {
  io.emit('config:update', detectionConfig);
}

interface RaceResultPayload {
  elapsedMs: number;
  currentLaps: number;
  detectionsCount: number;
  finishedAt: number;
  splits: SplitTime[];
  syncId?: string;
}

interface RaceUpdatePayload {
  splits: SplitTime[];
  currentLaps: number;
  detectionsCount: number;
  syncId?: string;
}

function notifyCoachSync(
  syncId: string,
  kind: 'split' | 'finish',
  label: string,
  stage: 'sending' | 'confirmed' | 'failed',
) {
  io.emit('sync:progress', { syncId, kind, label, stage });
}

function applyRaceUpdate(update: RaceUpdatePayload) {
  if (session.status !== 'running') return;

  session.splits = update.splits;
  session.currentLaps = update.currentLaps;
  session.detectionsCount = update.detectionsCount;
  broadcastState();
}

interface MultiRaceUpdatePayload {
  swimmers: SwimmerState[];
  splits: SplitTime[];
  currentLaps: number;
  detectionsCount: number;
  focusedSwimmerId: number | null;
  syncId?: string;
}

interface MultiRaceResultPayload extends MultiRaceUpdatePayload {
  elapsedMs: number;
  finishedAt: number;
}

function applyMultiRaceUpdate(update: MultiRaceUpdatePayload) {
  if (session.status !== 'running') return;

  session.swimmers = update.swimmers;
  session.splits = update.splits;
  session.currentLaps = update.currentLaps;
  session.detectionsCount = update.detectionsCount;
  session.focusedSwimmerId = update.focusedSwimmerId;
  broadcastState();
}

function applyMultiRaceResult(result: MultiRaceResultPayload) {
  if (session.status !== 'running') return;

  session.status = 'finished';
  session.swimmers = result.swimmers;
  session.splits = result.splits;
  session.currentLaps = result.currentLaps;
  session.detectionsCount = result.detectionsCount;
  session.focusedSwimmerId = null;
  session.elapsedMs = result.elapsedMs;
  session.finishedAt = result.finishedAt;
  broadcastState();
}

function applyRaceResult(result: RaceResultPayload) {
  if (session.status !== 'running') return;

  session.status = 'finished';
  session.elapsedMs = result.elapsedMs;
  session.currentLaps = result.currentLaps;
  session.detectionsCount = result.detectionsCount;
  session.finishedAt = result.finishedAt;
  session.splits = result.splits;
  broadcastState();
}

io.on('connection', (socket) => {
  socket.emit('session:update', session);
  socket.emit('config:update', detectionConfig);
  socket.emit('camera:status', { connected: cameraSocketId !== null });

  socket.on('client:register', (role: 'coach' | 'camera') => {
    if (role === 'camera') {
      if (cameraSocketId && cameraSocketId !== socket.id) {
        io.to(cameraSocketId).emit('camera:replaced');
      }
      cameraSocketId = socket.id;
      notifyCameraStatus();
      io.emit('camera:joined');
    }
  });

  socket.on('camera:stream-start', () => {
    setCameraStreaming(socket.id);
  });

  socket.on('camera:stream-stop', () => {
    if (streamingCoachId === socket.id) {
      setCameraStreaming(null);
    }
  });

  socket.on('camera:frame', (frame: string) => {
    if (socket.id !== cameraSocketId || !streamingCoachId) return;
    io.to(streamingCoachId).emit('camera:frame', frame);
  });

  socket.on('camera:calibrate', () => {
    if (cameraSocketId) {
      io.to(cameraSocketId).emit('camera:calibrate');
    }
  });

  socket.on(
    'camera:start-ack',
    (
      payload: { startedAt: number; sessionRevision: number; syncId?: string },
      ack?: (res: { ok: boolean }) => void,
    ) => {
      if (socket.id !== cameraSocketId) {
        ack?.({ ok: false });
        return;
      }
      if (
        session.status !== 'running' ||
        session.startedAt !== payload.startedAt ||
        session.sessionRevision !== payload.sessionRevision
      ) {
        ack?.({ ok: false });
        return;
      }
      io.emit('camera:start-ack');
      ack?.({ ok: true });
    },
  );

  socket.on('camera:race-update', (update: RaceUpdatePayload, ack?: (res: { ok: boolean }) => void) => {
    if (socket.id !== cameraSocketId || session.raceMode === 'multi') {
      ack?.({ ok: false });
      return;
    }
    const syncId = update.syncId ?? `split-${Date.now()}`;
    const yards = update.currentLaps * POOL_LENGTH_YARDS;
    notifyCoachSync(syncId, 'split', `Receiving ${yards} yd split from camera`, 'sending');
    applyRaceUpdate(update);
    notifyCoachSync(syncId, 'split', `${yards} yd split received`, 'confirmed');
    ack?.({ ok: true });
  });

  socket.on('camera:race-result', (result: RaceResultPayload, ack?: (res: { ok: boolean }) => void) => {
    if (socket.id !== cameraSocketId || session.raceMode === 'multi') {
      ack?.({ ok: false });
      return;
    }
    const syncId = result.syncId ?? `finish-${Date.now()}`;
    notifyCoachSync(syncId, 'finish', 'Receiving final time from camera', 'sending');
    applyRaceResult(result);
    notifyCoachSync(syncId, 'finish', 'Final time received', 'confirmed');
    ack?.({ ok: true });
  });

  socket.on('camera:multi-race-update', (update: MultiRaceUpdatePayload, ack?: (res: { ok: boolean }) => void) => {
    if (socket.id !== cameraSocketId || session.raceMode !== 'multi') {
      ack?.({ ok: false });
      return;
    }
    const syncId = update.syncId ?? `multi-split-${Date.now()}`;
    const focused = update.swimmers.find((s) => s.id === update.focusedSwimmerId);
    const label = focused
      ? `Receiving ${focused.name} update from camera`
      : 'Receiving swimmer update from camera';
    notifyCoachSync(syncId, 'split', label, 'sending');
    applyMultiRaceUpdate(update);
    notifyCoachSync(syncId, 'split', 'Swimmer data received', 'confirmed');
    ack?.({ ok: true });
  });

  socket.on('camera:multi-race-result', (result: MultiRaceResultPayload, ack?: (res: { ok: boolean }) => void) => {
    if (socket.id !== cameraSocketId || session.raceMode !== 'multi') {
      ack?.({ ok: false });
      return;
    }
    const syncId = result.syncId ?? `multi-finish-${Date.now()}`;
    notifyCoachSync(syncId, 'finish', 'Receiving multi-swimmer results from camera', 'sending');
    applyMultiRaceResult(result);
    notifyCoachSync(syncId, 'finish', 'All results received', 'confirmed');
    ack?.({ ok: true });
  });

  socket.on('disconnect', () => {
    if (streamingCoachId === socket.id) {
      setCameraStreaming(null);
    }
    if (socket.id === cameraSocketId) {
      cameraSocketId = null;
      setCameraStreaming(null);
      notifyCameraStatus();
    }
  });

  socket.on('session:set-distance', (distanceYards: number) => {
    if (session.status === 'running') return;
    const { swimmerName, raceMode, swimmerCount, swimmers } = session;
    session = createInitialSession(distanceYards, raceMode);
    session.swimmerName = swimmerName;
    session.swimmerCount = swimmerCount;
    session.swimmers = swimmers.length === swimmerCount
      ? swimmers
      : createSwimmers(swimmerCount, swimmers.map((s) => s.name));
    broadcastState();
  });

  socket.on('session:set-race-mode', (raceMode: RaceMode) => {
    if (session.status === 'running') return;
    session.raceMode = raceMode;
    if (raceMode === 'multi' && session.swimmerCount < 2) {
      session.swimmerCount = 2;
      session.swimmers = createSwimmers(2);
    }
    if (raceMode === 'single') {
      session.swimmerCount = 1;
      session.swimmers = createSwimmers(1, [session.swimmerName || 'Swimmer 1']);
    }
    broadcastState();
  });

  socket.on('session:set-swimmer-count', (count: number) => {
    if (session.status === 'running' || session.raceMode !== 'multi') return;
    const clamped = Math.min(8, Math.max(2, count));
    const names = session.swimmers.map((s) => s.name);
    session.swimmerCount = clamped;
    session.swimmers = createSwimmers(clamped, names);
    broadcastState();
  });

  socket.on('session:set-swimmer-name', (payload: { id: number; name: string }) => {
    if (session.status === 'running') return;
    session.swimmers = session.swimmers.map((s) =>
      s.id === payload.id ? { ...s, name: payload.name } : s,
    );
    if (payload.id === 0) session.swimmerName = payload.name;
    broadcastState();
  });

  socket.on('session:set-name', (name: string) => {
    session.swimmerName = name;
    if (session.swimmers[0]) {
      session.swimmers = session.swimmers.map((s, i) =>
        i === 0 ? { ...s, name } : s,
      );
    }
    broadcastState();
  });

  socket.on('session:arm', () => {
    if (session.status === 'idle') {
      session.status = 'ready';
      broadcastState();
    }
  });

  socket.on('session:start', () => {
    if (session.status !== 'ready' && session.status !== 'idle') return;
    session.status = 'running';
    session.startedAt = Date.now();
    session.elapsedMs = 0;
    session.currentLaps = 0;
    session.detectionsCount = 0;
    session.lastDetectionAt = null;
    session.finishedAt = null;
    session.splits = [];
    session.focusedSwimmerId = null;
    if (session.raceMode === 'multi') {
      session.swimmers = session.swimmers.map((s, id) => ({
        ...s,
        phase: 'waiting',
        startOffsetMs: null,
        lapsCompleted: 0,
        wallTouches: 0,
        splits: [],
        canTriggerStop: false,
        focused: false,
      }));
    }
    setCameraStreaming(null);
    broadcastState();
  });

  socket.on('session:reset', () => {
    const distance = session.distanceYards;
    const name = session.swimmerName;
    const raceMode = session.raceMode;
    const swimmerCount = session.swimmerCount;
    const swimmerNames = session.swimmers.map((s) => s.name);
    const revision = session.sessionRevision + 1;
    session = createInitialSession(distance, raceMode);
    session.swimmerName = name;
    session.swimmerCount = swimmerCount;
    session.swimmers = createSwimmers(swimmerCount, swimmerNames);
    session.sessionRevision = revision;
    broadcastState();
  });

  socket.on('config:update', (config: Partial<DetectionConfig>) => {
    detectionConfig = { ...detectionConfig, ...config };
    broadcastConfig();
  });
});

httpServer.listen(PORT, () => {
  console.log(`Swim Timer server running on http://localhost:${PORT}`);
});
