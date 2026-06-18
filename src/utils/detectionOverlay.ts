import { normalizeConfig, type DetectionConfig } from '../../shared/types';

export function drawDetectionOverlay(
  canvas: HTMLCanvasElement,
  image: HTMLImageElement,
  config: DetectionConfig,
  multiMode: boolean,
  stopArmed = false,
) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const width = image.clientWidth;
  const height = image.clientHeight;
  if (width === 0 || height === 0) return;

  canvas.width = width;
  canvas.height = height;
  ctx.clearRect(0, 0, width, height);

  const cfg = normalizeConfig(config);

  const drawLine = (lineX: number, color: string, fill: string) => {
    const x = lineX * width;
    const half = (cfg.zoneWidth * width) / 2;
    const left = Math.max(0, x - half);
    const zoneW = Math.min(width, x + half) - left;
    ctx.fillStyle = fill;
    ctx.fillRect(left, 0, zoneW, height);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.setLineDash([10, 6]);
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
    ctx.setLineDash([]);
  };

  if (multiMode) {
    drawLine(cfg.trackLineX, '#f59e0b', 'rgba(245,158,11,0.12)');
    drawLine(
      cfg.stopLineX,
      stopArmed ? '#22c55e' : '#ef4444',
      stopArmed ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.1)',
    );
  } else {
    drawLine(cfg.stopLineX, '#3b82f6', 'rgba(59,130,246,0.12)');
  }
}
