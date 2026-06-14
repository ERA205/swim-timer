import { useEffect, useRef } from 'react';

const FRAME_INTERVAL_MS = 150;
const JPEG_QUALITY = 0.55;
const MAX_WIDTH = 640;

interface UseCameraStreamOptions {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  stream: MediaStream | null;
  shouldStream: boolean;
  sendFrame: (frame: string) => void;
}

export function useCameraStream({
  videoRef,
  stream,
  shouldStream,
  sendFrame,
}: UseCameraStreamOptions) {
  const sendFrameRef = useRef(sendFrame);
  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    sendFrameRef.current = sendFrame;
  }, [sendFrame]);

  useEffect(() => {
    if (!stream || !shouldStream) return;

    const captureCanvas = document.createElement('canvas');
    captureCanvasRef.current = captureCanvas;
    const ctx = captureCanvas.getContext('2d');
    if (!ctx) return;

    const interval = setInterval(() => {
      const video = videoRef.current;
      if (!video || video.readyState < 2) return;

      const scale = Math.min(1, MAX_WIDTH / video.videoWidth);
      captureCanvas.width = Math.floor(video.videoWidth * scale);
      captureCanvas.height = Math.floor(video.videoHeight * scale);
      ctx.drawImage(video, 0, 0, captureCanvas.width, captureCanvas.height);

      const frame = captureCanvas.toDataURL('image/jpeg', JPEG_QUALITY);
      sendFrameRef.current(frame);
    }, FRAME_INTERVAL_MS);

    return () => {
      clearInterval(interval);
      captureCanvasRef.current = null;
    };
  }, [videoRef, stream, shouldStream]);
}
