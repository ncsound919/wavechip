import React, { useEffect, useRef, useState } from 'react';
import { SynthPatchState } from '../../types/synth';

interface FuseScopeCanvasProps {
  state: SynthPatchState;
  activeNotesCount: number;
}

type AnalyzerMode = 'scope' | 'fft' | 'xy';

export const FuseScopeCanvas: React.FC<FuseScopeCanvasProps> = ({ state, activeNotesCount }) => {
  const [mode, setMode] = useState<AnalyzerMode>('scope');
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef(state);
  const notesRef = useRef(activeNotesCount);
  const modeRef = useRef(mode);
  const peaksRef = useRef<number[]>(new Array(20).fill(0));

  stateRef.current = state;
  notesRef.current = activeNotesCount;
  modeRef.current = mode;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let rafId = 0;
    const start = performance.now();

    const draw = (now: number) => {
      const t = (now - start) / 1000;
      const s = stateRef.current;
      const curMode = modeRef.current;
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (w === 0 || h === 0) {
        rafId = requestAnimationFrame(draw);
        return;
      }

      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, w, h);

      // Reticle grid
      ctx.strokeStyle = 'rgba(30, 49, 93, 0.7)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h / 2);
      ctx.moveTo(w / 2, 0);
      ctx.lineTo(w / 2, h);
      ctx.stroke();

      const frames = s.wavetable.framesPreview;
      const frame = frames[s.activeWaveFrame] ?? frames[0];
      const chipRam = s.chip.waveRam;
      const blend = s.vectorX;
      const pts = 96;

      const waveSamples: number[] = [];
      const chipSamples: number[] = [];
      const fusedSamples: number[] = [];

      const speed = notesRef.current > 0 ? 4.8 : 1.6;
      const phaseScroll = t * speed;

      for (let i = 0; i < pts; i++) {
        const u = (i / (pts - 1)) * 2;
        const wrappedU = (u + phaseScroll * 0.25) % 1;

        // Chip signal
        let chipVal = 0;
        if (s.chip.family === 'wavetable' || s.fuse.waveToChipMode !== 'off') {
          const ramIdx = Math.floor(wrappedU * 32) % 32;
          chipVal = ((chipRam[ramIdx] ?? 8) / 15) * 2 - 1;
        } else {
          let activeWaveCount = 0;
          if (s.chip.waveBits.pulse) {
            chipVal += wrappedU < s.chip.pulseWidth ? 0.8 : -0.8;
            activeWaveCount++;
          }
          if (s.chip.waveBits.saw) {
            chipVal += wrappedU * 2 - 1;
            activeWaveCount++;
          }
          if (s.chip.waveBits.tri) {
            chipVal += 1 - 4 * Math.abs(Math.round(wrappedU - 0.25) - (wrappedU - 0.25));
            activeWaveCount++;
          }
          if (s.chip.waveBits.noise) {
            chipVal += Math.sin(i * 17.7 + t * 24) * 0.65;
            activeWaveCount++;
          }
          if (activeWaveCount > 0) chipVal /= activeWaveCount;
        }

        const dacLevels = Math.pow(2, Math.min(8, s.chip.dacBits)) - 1;
        chipVal = (Math.round(((chipVal + 1) * 0.5) * dacLevels) / dacLevels) * 2 - 1;

        // Wave signal + Fuse
        let waveIdxFloat = wrappedU;
        if (s.fuse.chipToWaveMode === 'fm') {
          waveIdxFloat = (wrappedU + chipVal * s.fuse.chipToWaveAmount * 0.35 + 1) % 1;
        }
        const fIdx = Math.floor(waveIdxFloat * (frame.length - 1));
        let waveVal = frame[fIdx] ?? 0;

        if (s.fuse.chipToWaveMode === 'ring') {
          waveVal =
            waveVal * (1 - s.fuse.chipToWaveAmount) +
            waveVal * chipVal * s.fuse.chipToWaveAmount * 1.4;
        } else if (s.fuse.chipToWaveMode === 'shaper') {
          waveVal = Math.tanh(
            waveVal * (1 + s.fuse.chipToWaveAmount * 3.2) +
              chipVal * s.fuse.chipToWaveAmount * 0.6
          );
        }

        if (s.fuse.chipifyEnabled) {
          const levels = Math.pow(2, Math.min(8, s.fuse.chipifyBits)) - 1;
          waveVal = (Math.round(((waveVal + 1) * 0.5) * levels) / levels) * 2 - 1;
        }

        const fused = Math.max(-1, Math.min(1, waveVal * (1 - blend) + chipVal * blend));
        waveSamples.push(waveVal);
        chipSamples.push(chipVal);
        fusedSamples.push(fused);
      }

      if (curMode === 'scope') {
        const midY = h / 2;
        const amp = h * 0.38;
        const drawCurve = (arr: number[], color: string, width: number, glow: boolean) => {
          ctx.beginPath();
          for (let i = 0; i < arr.length; i++) {
            const x = (i / (arr.length - 1)) * w;
            const y = midY - arr[i] * amp;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          if (glow) {
            ctx.shadowColor = color;
            ctx.shadowBlur = 7;
          }
          ctx.strokeStyle = color;
          ctx.lineWidth = width;
          ctx.stroke();
          ctx.shadowBlur = 0;
        };

        drawCurve(waveSamples, 'rgba(45, 212, 191, 0.38)', 1.1, false);
        drawCurve(chipSamples, 'rgba(57, 255, 20, 0.35)', 1.1, false);
        drawCurve(fusedSamples, '#f2b5d4', 2.0, true);
      } else if (curMode === 'fft') {
        // Compute 20-band DFT magnitude from fusedSamples
        const bins = 20;
        const barW = (w - 12) / bins;
        const peaks = peaksRef.current;

        for (let k = 0; k < bins; k++) {
          let re = 0;
          let im = 0;
          const freq = k + 1;
          for (let n = 0; n < fusedSamples.length; n++) {
            const angle = (2 * Math.PI * freq * n) / fusedSamples.length;
            re += fusedSamples[n] * Math.cos(angle);
            im -= fusedSamples[n] * Math.sin(angle);
          }
          const rawMag = Math.sqrt(re * re + im * im) / (fusedSamples.length * 0.45);
          // Cutoff roll-off shaping
          const filterAtten = k / bins > s.chip.cutoff ? 0.35 + s.chip.resonance * 0.5 : 1.0;
          const mag = Math.min(1, rawMag * filterAtten * (notesRef.current > 0 ? 1.25 : 0.95));

          peaks[k] = Math.max(mag, peaks[k] - 0.018);

          const bx = 6 + k * barW;
          const barH = Math.max(2, mag * (h - 10));
          const col = k < 6 ? '#2dd4bf' : k < 13 ? '#d98cb3' : '#39ff14';

          ctx.fillStyle = col;
          ctx.fillRect(bx + 1, h - 4 - barH, Math.max(2, barW - 3), barH);

          // Peak hold LED
          const peakY = h - 4 - peaks[k] * (h - 10);
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(bx + 1, peakY - 1.5, Math.max(2, barW - 3), 1.5);
        }
      } else {
        // XY Phase Lissajous Goniometer: Wave(t) on X vs Chip(t) on Y
        ctx.beginPath();
        for (let i = 0; i < pts; i++) {
          const px = w / 2 + waveSamples[i] * (w * 0.36);
          const py = h / 2 - chipSamples[i] * (h * 0.38);
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.shadowColor = '#39ff14';
        ctx.shadowBlur = 8;
        ctx.strokeStyle = '#39ff14';
        ctx.lineWidth = 1.6;
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Fused diagonal vector trace
        ctx.beginPath();
        for (let i = 0; i < pts; i++) {
          const px = w / 2 + fusedSamples[i] * (w * 0.28);
          const py = h / 2 - fusedSamples[(i + 6) % pts] * (h * 0.3);
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.strokeStyle = 'rgba(242, 181, 212, 0.75)';
        ctx.lineWidth = 1.1;
        ctx.stroke();
      }

      ctx.restore();
      rafId = requestAnimationFrame(draw);
    };

    rafId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafId);
  }, []);

  return (
    <div className="relative w-full h-16 rounded bg-[#050914] border border-[#1d2f5a] shadow-[inset_0_2px_8px_rgba(0,0,0,0.85)] overflow-hidden">
      <canvas ref={canvasRef} className="w-full h-full block" />
      <div className="crt-scanlines crt-glass-glare absolute inset-0 pointer-events-none opacity-60" />

      {/* Interactive Analyzer Mode Pills */}
      <div className="absolute top-1 left-1.5 flex items-center gap-1 z-10">
        {(['scope', 'fft', 'xy'] as AnalyzerMode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`px-1.5 py-[1px] rounded-[2px] text-[9px] font-mono uppercase border cursor-pointer ${
              mode === m
                ? 'bg-[#d98cb3]/25 text-[#f2b5d4] border-[#d98cb3]/60'
                : 'bg-[#060a17]/80 text-slate-400 border-[#1b2b52] hover:text-slate-200'
            }`}
          >
            {m}
          </button>
        ))}
      </div>

      <div className="absolute top-1 right-2 flex items-center gap-2 text-[9px] font-mono pointer-events-none">
        <span className="text-[#5eead4]">W</span>
        <span className="text-[#39ff14]">C</span>
        <span className="text-[#f2b5d4]">OUT</span>
      </div>
    </div>
  );
};
