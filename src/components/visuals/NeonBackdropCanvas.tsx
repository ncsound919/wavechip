import React, { useEffect, useRef } from 'react';

interface NeonBackdropCanvasProps {
  blendX: number;
  activeNotesCount: number;
}

export const NeonBackdropCanvas: React.FC<NeonBackdropCanvasProps> = ({
  blendX,
  activeNotesCount,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const propsRef = useRef({ blendX, activeNotesCount });
  propsRef.current = { blendX, activeNotesCount };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const prefersReduced =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let rafId = 0;
    const start = performance.now();

    const shapes = [
      { x: 0.08, y: 0.18, size: 18, speed: 0.35, kind: 'tri', color: '#2dd4bf' },
      { x: 0.91, y: 0.22, size: 20, speed: -0.28, kind: 'diamond', color: '#39ff14' },
      { x: 0.12, y: 0.78, size: 15, speed: 0.42, kind: 'circle', color: '#d98cb3' },
      { x: 0.89, y: 0.75, size: 17, speed: -0.36, kind: 'tri', color: '#d98cb3' },
      { x: 0.5, y: 0.1, size: 14, speed: 0.25, kind: 'diamond', color: '#2dd4bf' },
    ];

    const render = (now: number) => {
      const t = prefersReduced ? 0 : (now - start) / 1000;
      const { blendX: bx, activeNotesCount: notes } = propsRef.current;
      const w = window.innerWidth;
      const h = window.innerHeight;
      if (w === 0 || h === 0) {
        if (!prefersReduced) rafId = requestAnimationFrame(render);
        return;
      }

      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }

      ctx.clearRect(0, 0, w, h);

      // Perspective 80s horizon grid at bottom 36% of viewport
      const horizonY = h * 0.64;
      const vanishX = w * (0.45 + bx * 0.1);
      const energy = notes > 0 ? 1.45 : 1.0;

      ctx.save();
      ctx.strokeStyle = `rgba(45, 212, 191, ${(0.12 * energy).toFixed(2)})`;
      ctx.lineWidth = 1;

      // Radiating perspective lines
      const rays = 18;
      for (let i = -rays; i <= rays; i++) {
        const bottomX = vanishX + i * (w / 10);
        ctx.beginPath();
        ctx.moveTo(vanishX, horizonY);
        ctx.lineTo(bottomX, h);
        ctx.stroke();
      }

      // Scrolling horizontal depth lines
      const rows = 10;
      const scroll = (t * 0.45) % 1;
      for (let r = 0; r < rows; r++) {
        const prog = (r + scroll) / rows;
        const y = horizonY + Math.pow(prog, 2.2) * (h - horizonY);
        ctx.strokeStyle = `rgba(217, 140, 179, ${(0.06 + prog * 0.16 * energy).toFixed(2)})`;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }

      // Horizon laser line
      ctx.strokeStyle = notes > 0 ? 'rgba(57, 255, 20, 0.35)' : 'rgba(217, 140, 179, 0.25)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, horizonY);
      ctx.lineTo(w, horizonY);
      ctx.stroke();

      // Rotating wireframe Memphis shapes around outer brick wall
      shapes.forEach((sh, idx) => {
        const cx = sh.x * w;
        const cy = sh.y * h + Math.sin(t * 0.9 + idx) * 10;
        const rot = t * sh.speed;
        const rad = sh.size * (notes > 0 ? 1.15 : 1.0);

        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(rot);
        ctx.strokeStyle = sh.color;
        ctx.globalAlpha = notes > 0 ? 0.34 : 0.2;
        ctx.lineWidth = 1.4;

        ctx.beginPath();
        if (sh.kind === 'tri') {
          for (let k = 0; k < 3; k++) {
            const a = (k / 3) * Math.PI * 2 - Math.PI / 2;
            const px = Math.cos(a) * rad;
            const py = Math.sin(a) * rad;
            if (k === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.closePath();
        } else if (sh.kind === 'diamond') {
          ctx.moveTo(0, -rad);
          ctx.lineTo(rad, 0);
          ctx.lineTo(0, rad);
          ctx.lineTo(-rad, 0);
          ctx.closePath();
        } else {
          ctx.arc(0, 0, rad * 0.78, 0, Math.PI * 2);
        }
        ctx.stroke();
        ctx.restore();
      });

      ctx.restore();
      if (!prefersReduced) {
        rafId = requestAnimationFrame(render);
      }
    };

    rafId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(rafId);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="fixed inset-0 w-full h-full pointer-events-none z-0"
    />
  );
};
