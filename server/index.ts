import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  createInitialSession,
  POOL_LENGTH_YARDS,
  type DetectionConfig,
  type SessionState,
  type SplitTime,
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
    if (socket.id !== cameraSocketId) {
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
    if (socket.id !== cameraSocketId) {
      ack?.({ ok: false });
      return;
    }
    const syncId = result.syncId ?? `finish-${Date.now()}`;
    notifyCoachSync(syncId, 'finish', 'Receiving final time from camera', 'sending');
    applyRaceResult(result);
    notifyCoachSync(syncId, 'finish', 'Final time received', 'confirmed');
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
    const name = session.swimmerName;
    session = createInitialSession(distanceYards);
    session.swimmerName = name;
    broadcastState();
  });

  socket.on('session:set-name', (name: string) => {
    session.swimmerName = name;
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
    setCameraStreaming(null);
    broadcastState();
  });

  socket.on('session:reset', () => {
    const distance = session.distanceYards;
    const name = session.swimmerName;
    const revision = session.sessionRevision + 1;
    session = createInitialSession(distance);
    session.swimmerName = name;
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
