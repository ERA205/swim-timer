import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  createInitialSession,
  lapsPerDetection,
  POOL_LENGTH_YARDS,
  type DetectionConfig,
  type SessionState,
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
let timerInterval: ReturnType<typeof setInterval> | null = null;

const coachSockets = new Set<string>();
let cameraSocketId: string | null = null;

function notifyCameraStreamState() {
  if (!cameraSocketId) return;
  io.to(cameraSocketId).emit('camera:stream-state', {
    streaming: coachSockets.size > 0,
  });
}

function notifyCameraStatus() {
  io.emit('camera:status', { connected: cameraSocketId !== null });
}

function broadcastState() {
  io.emit('session:update', session);
}

function broadcastConfig() {
  io.emit('config:update', detectionConfig);
}

function startTimer() {
  if (timerInterval) return;
  timerInterval = setInterval(() => {
    if (session.status === 'running' && session.startedAt) {
      session.elapsedMs = Date.now() - session.startedAt;
      broadcastState();
    }
  }, 50);
}

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

function registerDetection(source: 'camera' | 'manual') {
  if (session.status !== 'running') return;

  const now = Date.now();
  if (
    session.lastDetectionAt &&
    now - session.lastDetectionAt < detectionConfig.cooldownMs
  ) {
    return;
  }

  session.lastDetectionAt = now;
  session.detectionsCount += 1;
  session.currentLaps = Math.min(
    session.totalLaps,
    session.detectionsCount * lapsPerDetection(session.totalLaps),
  );

  const elapsedMs = now - (session.startedAt ?? now);
  const isFinish = session.detectionsCount >= session.detectionsNeeded;

  if (!isFinish && session.totalLaps > 2) {
    session.splits.push({
      yards: session.currentLaps * POOL_LENGTH_YARDS,
      laps: session.currentLaps,
      elapsedMs,
    });
  }

  if (isFinish) {
    session.status = 'finished';
    session.finishedAt = now;
    session.elapsedMs = now - (session.startedAt ?? now);
    session.currentLaps = session.totalLaps;
    stopTimer();
  }

  io.emit('detection:triggered', {
    source,
    detectionsCount: session.detectionsCount,
    currentLaps: session.currentLaps,
    finished: session.status === 'finished',
  });
  broadcastState();
}

io.on('connection', (socket) => {
  socket.emit('session:update', session);
  socket.emit('config:update', detectionConfig);
  socket.emit('camera:status', { connected: cameraSocketId !== null });

  socket.on('client:register', (role: 'coach' | 'camera') => {
    if (role === 'coach') {
      coachSockets.add(socket.id);
      notifyCameraStreamState();
    }
    if (role === 'camera') {
      if (cameraSocketId && cameraSocketId !== socket.id) {
        io.to(cameraSocketId).emit('camera:replaced');
      }
      cameraSocketId = socket.id;
      notifyCameraStatus();
      notifyCameraStreamState();
    }
  });

  socket.on('camera:frame', (frame: string) => {
    if (socket.id !== cameraSocketId) return;
    for (const coachId of coachSockets) {
      io.to(coachId).emit('camera:frame', frame);
    }
  });

  socket.on('camera:calibrate', () => {
    if (cameraSocketId) {
      io.to(cameraSocketId).emit('camera:calibrate');
    }
  });

  socket.on('disconnect', () => {
    coachSockets.delete(socket.id);
    if (socket.id === cameraSocketId) {
      cameraSocketId = null;
      notifyCameraStatus();
    }
    notifyCameraStreamState();
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
    startTimer();
    broadcastState();
  });

  socket.on('session:reset', () => {
    stopTimer();
    const distance = session.distanceYards;
    const name = session.swimmerName;
    const revision = session.sessionRevision + 1;
    session = createInitialSession(distance);
    session.swimmerName = name;
    session.sessionRevision = revision;
    broadcastState();
  });

  socket.on('detection:register', () => {
    registerDetection('camera');
  });

  socket.on('detection:manual', () => {
    registerDetection('manual');
  });

  socket.on('config:update', (config: Partial<DetectionConfig>) => {
    detectionConfig = { ...detectionConfig, ...config };
    broadcastConfig();
  });
});

httpServer.listen(PORT, () => {
  console.log(`Swim Timer server running on http://localhost:${PORT}`);
});
