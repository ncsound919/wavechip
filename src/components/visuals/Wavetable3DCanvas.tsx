import React, { useEffect, useRef, useState } from 'react';
import { WavetableData } from '../../types/synth';

interface Wavetable3DCanvasProps {
  wavetable: WavetableData;
  activeFrame: number;
  chipified: boolean;
  onActiveFrameChange: (frame: number) => void;
}

export const Wavetable3DCanvas: React.FC<Wavetable3DCanvasProps> = ({
  wavetable,
  activeFrame,
  chipified,
  onActiveFrameChange,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [yaw, setYaw] = useState(-0.42);
  const [pitch, setPitch] = useState(0.5);
  const [autoOrbit, setAutoOrbit] = useState(true);
  const [orbiting, setOrbiting] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0, yaw: -0.42, pitch: 0.5 });

  const stateRef = useRef({ wavetable, activeFrame, chipified, yaw, pitch, autoOrbit, orbiting });
  stateRef.current = { wavetable, activeFrame, chipified, yaw, pitch, autoOrbit, orbiting };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let rafId = 0;
    const startTime = performance.now();

    const renderFrame = (now: number) => {
      const tSec = (now - startTime) / 1000;
      const {
        wavetable: wt,
        activeFrame: actFrm,
        chipified: isChip,
        yaw: baseYaw,
        pitch: basePitch,
        autoOrbit: orbitOn,
        orbiting: isDragging,
      } = stateRef.current;

      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (w === 0 || h === 0) {
        rafId = requestAnimationFrame(renderFrame);
        return;
      }

      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, w, h);

      const pulse = 0.85 + Math.sin(tSec * 1.8) * 0.15;
      const grad = ctx.createRadialGradient(w * 0.5, h * 0.52, 10, w * 0.5, h * 0.52, w * 0.72);
      grad.addColorStop(
        0,
        isChip
          ? `rgba(57, 255, 20, ${(0.17 * pulse).toFixed(3)})`
          : `rgba(45, 212, 191, ${(0.18 * pulse).toFixed(3)})`
      );
      grad.addColorStop(0.5, `rgba(217, 140, 179, ${(0.11 * pulse).toFixed(3)})`);
      grad.addColorStop(1, 'rgba(5, 9, 20, 0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      const frames = wt.framesPreview;
      const numSlices = Math.min(frames.length, 24);
      const numPts = 48;

      const effYaw = orbitOn && !isDragging ? baseYaw + Math.sin(tSec * 0.45) * 0.22 : baseYaw;
      const cosY = Math.cos(effYaw);
      const sinY = Math.sin(effYaw);
      const cosP = Math.cos(basePitch);
      const sinP = Math.sin(basePitch);

      const project = (nx: number, ny: number, nz: number) => {
        const x1 = nx * cosY - nz * sinY;
        const z1 = nx * sinY + nz * cosY;
        const y2 = ny * cosP - z1 * sinP;
        const z2 = ny * sinP + z1 * cosP;

        const camDist = 2.55;
        const scale = (Math.min(w, h) * 1.12) / (camDist + z2);
        return {
          x: w * 0.5 + x1 * scale,
          y: h * 0.62 - y2 * scale,
          z: z2,
        };
      };

      // Perspective Table Floor Grid
      ctx.strokeStyle = 'rgba(217, 140, 179, 0.22)';
      ctx.lineWidth = 1;
      for (let gx = -1.05; gx <= 1.05; gx += 0.35) {
        const a = project(gx, -0.44, -1.05);
        const b = project(gx, -0.44, 1.05);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      for (let gz = -1.05; gz <= 1.05; gz += 0.35) {
        const a = project(-1.05, -0.44, gz);
        const b = project(1.05, -0.44, gz);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }

      const slices = Array.from({ length: numSlices }, (_, sIdx) => {
        const frameIdx = Math.round((sIdx / Math.max(1, numSlices - 1)) * (frames.length - 1));
        const nz = numSlices > 1 ? (sIdx / (numSlices - 1)) * 2 - 1 : 0;
        const curve = frames[frameIdx];
        const chipCurve = wt.chipifiedFrames[frameIdx];

        const pts: { x: number; y: number; z: number }[] = [];
        const basePts: { x: number; y: number; z: number }[] = [];
        let avgZ = 0;

        for (let p = 0; p < numPts; p++) {
          const nx = (p / (numPts - 1)) * 2 - 1;
          let sample = curve[Math.floor((p / (numPts - 1)) * (curve.length - 1))] ?? 0;
          if (isChip && chipCurve) {
            const cIdx = Math.floor((p / (numPts - 1)) * (chipCurve.length - 1));
            sample = (chipCurve[cIdx] / 15) * 2 - 1;
          }
          const shimmer = Math.sin(tSec * 2.4 + p * 0.24 + sIdx * 0.4) * 0.018;
          const pt = project(nx * 1.04, (sample + shimmer) * 0.62, nz * 1.04);
          const base = project(nx * 1.04, -0.44, nz * 1.04);
          pts.push(pt);
          basePts.push(base);
          avgZ += pt.z;
        }

        const isActive =
          Math.abs(frameIdx - actFrm) <=
          Math.max(0, Math.floor(frames.length / numSlices / 2));

        return { frameIdx, pts, basePts, avgZ: avgZ / numPts, isActive, sIdx };
      }).sort((a, b) => b.avgZ - a.avgZ);

      // Longitudinal mesh ribs across the table
      ctx.strokeStyle = isChip ? 'rgba(57, 255, 20, 0.2)' : 'rgba(45, 212, 191, 0.24)';
      ctx.lineWidth = 0.85;
      const sortedByIdx = [...slices].sort((a, b) => a.sIdx - b.sIdx);
      for (let p = 0; p < numPts; p += 4) {
        ctx.beginPath();
        sortedByIdx.forEach((sl, idx) => {
          const pt = sl.pts[p];
          if (idx === 0) ctx.moveTo(pt.x, pt.y);
          else ctx.lineTo(pt.x, pt.y);
        });
        ctx.stroke();
      }

      // Harmonic Prism Slice Coloring across depth
      slices.forEach(({ pts, basePts, isActive, sIdx }) => {
        const depthNorm = sIdx / Math.max(1, numSlices - 1);

        ctx.beginPath();
        ctx.moveTo(basePts[0].x, basePts[0].y);
        pts.forEach((pt) => ctx.lineTo(pt.x, pt.y));
        ctx.lineTo(basePts[basePts.length - 1].x, basePts[basePts.length - 1].y);
        ctx.closePath();

        if (isActive) {
          const activeGrad = ctx.createLinearGradient(0, 0, 0, h);
          activeGrad.addColorStop(0, isChip ? 'rgba(57, 255, 20, 0.42)' : 'rgba(242, 181, 212, 0.44)');
          activeGrad.addColorStop(1, 'rgba(5, 9, 20, 0.2)');
          ctx.fillStyle = activeGrad;
        } else {
          ctx.fillStyle = 'rgba(5, 9, 20, 0.78)';
        }
        ctx.fill();

        ctx.beginPath();
        pts.forEach((pt, idx) => {
          if (idx === 0) ctx.moveTo(pt.x, pt.y);
          else ctx.lineTo(pt.x, pt.y);
        });

        if (isActive) {
          const activeColor = isChip ? '#39ff14' : '#f2b5d4';
          ctx.shadowColor = activeColor;
          ctx.shadowBlur = 14;
          ctx.strokeStyle = activeColor;
          ctx.lineWidth = 3.0;
          ctx.stroke();
          ctx.shadowBlur = 0;

          const beadPos = Math.floor(((tSec * 0.55) % 1) * (pts.length - 1));
          const bead = pts[beadPos];
          if (bead) {
            ctx.beginPath();
            ctx.arc(bead.x, bead.y, 3.8, 0, Math.PI * 2);
            ctx.fillStyle = '#ffffff';
            ctx.shadowColor = activeColor;
            ctx.shadowBlur = 14;
            ctx.fill();
            ctx.shadowBlur = 0;
          }
        } else {
          ctx.strokeStyle = isChip
            ? 'rgba(57, 255, 20, 0.42)'
            : depthNorm < 0.5
              ? 'rgba(45, 212, 191, 0.56)'
              : 'rgba(217, 140, 179, 0.48)';
          ctx.lineWidth = 1.15;
          ctx.stroke();
        }
      });

      ctx.restore();
      rafId = requestAnimationFrame(renderFrame);
    };

    rafId = requestAnimationFrame(renderFrame);
    return () => cancelAnimationFrame(rafId);
  }, []);

  return (
    <div
      className="relative h-64 w-full rounded bg-[#050914] border-2 border-[#1f3569] shadow-[inset_0_2px_16px_rgba(0,0,0,0.95),0_0_20px_rgba(45,212,191,0.12)] overflow-hidden cursor-grab active:cursor-grabbing select-none"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        setOrbiting(true);
        dragStartRef.current = { x: e.clientX, y: e.clientY, yaw, pitch };
      }}
      onPointerMove={(e) => {
        if (!orbiting) return;
        const dx = (e.clientX - dragStartRef.current.x) * 0.008;
        const dy = (e.clientY - dragStartRef.current.y) * 0.006;
        setYaw(Math.max(-1.2, Math.min(1.2, dragStartRef.current.yaw + dx)));
        setPitch(Math.max(0.15, Math.min(1.15, dragStartRef.current.pitch + dy)));
      }}
      onPointerUp={(e) => {
        if (orbiting) {
          e.currentTarget.releasePointerCapture(e.pointerId);
          setOrbiting(false);
        }
      }}
      onDoubleClick={() => {
        setYaw(-0.42);
        setPitch(0.5);
      }}
      onWheel={(e) => {
        e.preventDefault();
        const dir = e.deltaY < 0 ? 1 : -1;
        const next = Math.max(0, Math.min(wavetable.frameCount - 1, activeFrame + dir));
        onActiveFrameChange(next);
      }}
      title="Drag to tilt 3D wavetable · Scroll to scan frames · Double-click to reset view"
    >
      <canvas ref={canvasRef} className="w-full h-full block" />
      <div className="crt-scanlines crt-glass-glare absolute inset-0 pointer-events-none opacity-60" />

      {/* Precision HUD Corner Reticles */}
      <span className="absolute top-1 left-1 w-2 h-2 border-t border-l border-[#2dd4bf]/55 pointer-events-none" />
      <span className="absolute bottom-1 left-1 w-2 h-2 border-b border-l border-[#2dd4bf]/55 pointer-events-none" />
      <span className="absolute bottom-1 right-1 w-2 h-2 border-b border-r border-[#d98cb3]/55 pointer-events-none" />

      <div className="absolute top-2 left-3 text-[11px] font-mono text-[#5eead4] glow-teal pointer-events-none">
        {chipified ? '3D CHIP TABLE 32×4b' : '3D WAVE TERRAIN'}
      </div>

      <div className="absolute bottom-1.5 left-3 text-[9px] font-mono text-slate-400/80 pointer-events-none">
        X:PHASE · Z:FRAME
      </div>

      <div className="absolute top-1.5 right-2 flex items-center gap-2 z-10">
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => setAutoOrbit((v) => !v)}
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-[3px] text-[9px] font-mono cursor-pointer ${
            autoOrbit ? 'hw-btn-teal-on' : 'hw-btn text-slate-400'
          }`}
        >
          <span
            className={`w-1 h-1 rounded-full ${
              autoOrbit ? 'bg-[#5eead4] shadow-[0_0_5px_#2dd4bf]' : 'bg-slate-600'
            }`}
          />
          <span>ORBIT</span>
        </button>
        <span className="px-1.5 py-0.5 rounded-[2px] bg-[#060b19]/80 border border-[#1d3163] text-[10px] font-mono tabular-nums text-[#f2b5d4] glow-mauve pointer-events-none">
          {String(activeFrame + 1).padStart(2, '0')}/{String(wavetable.frameCount).padStart(2, '0')}
        </span>
      </div>
    </div>
  );
};
