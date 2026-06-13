import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  createInitialSession,
  lapsPerDetection,
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
});

let session: SessionState = createInitialSession();
let detectionConfig: DetectionConfig = { ...DEFAULT_DETECTION_CONFIG };
let timerInterval: ReturnType<typeof setInterval> | null = null;

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

  if (session.detectionsCount >= session.detectionsNeeded) {
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
    startTimer();
    broadcastState();
  });

  socket.on('session:reset', () => {
    stopTimer();
    const distance = session.distanceYards;
    const name = session.swimmerName;
    session = createInitialSession(distance);
    session.swimmerName = name;
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
