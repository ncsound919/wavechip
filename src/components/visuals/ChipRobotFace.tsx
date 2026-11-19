import React, { useEffect, useState } from 'react';
import { ChipState, DriftState, FuseState } from '../../types/synth';

interface ChipRobotFaceProps {
  chip: ChipState;
  drift: DriftState;
  fuse: FuseState;
  blendAmount: number;
  activeNoteCount?: number;
}

export const ChipRobotFace: React.FC<ChipRobotFaceProps> = ({
  chip,
  drift,
  fuse,
  blendAmount,
  activeNoteCount = 0,
}) => {
  const [xrayMode, setXrayMode] = useState(false);
  const [tick, setTick] = useState(0);
  const [blinking, setBlinking] = useState(false);

  useEffect(() => {
    let rafId = 0;
    let lastBlink = performance.now();
    const start = performance.now();

    const loop = (now: number) => {
      const elapsed = (now - start) / 1000;
      setTick(elapsed);

      if (now - lastBlink > 3100 + (1 - drift.rate) * 1800) {
        setBlinking(true);
        lastBlink = now;
        setTimeout(() => setBlinking(false), 120);
      }

      rafId = requestAnimationFrame(loop);
    };

    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [drift.rate]);

  const noteBoost = activeNoteCount > 0 ? 1.45 : 1.0;
  const driftSpeed = 0.65 + drift.rate * 2.4;
  const headX = Math.sin(tick * driftSpeed) * (0.9 + drift.amount * 3.0);
  const headY = Math.cos(tick * driftSpeed * 0.75) * (0.7 + drift.amount * 2.2);
  const headTilt = Math.sin(tick * driftSpeed * 0.5) * (drift.amount * 2.4);

  const gazeX = (blendAmount - 0.5) * 5.2 + Math.sin(tick * 1.2) * 1.4;
  const gazeY = (0.5 - chip.cutoff) * 4.2 + Math.cos(tick * 0.9) * 1.0;

  const primaryNeon = '#39ff14';
  const secondaryTone = chip.variant === '6581' ? '#d98cb3' : '#2dd4bf';

  const mouthWidth = 76;
  const mouthStartX = 110 - mouthWidth / 2;
  const mouthCenterY = 104;
  const mouthPts: string[] = [];

  const hasNoise = chip.waveBits.noise;
  const hasSaw = chip.waveBits.saw;
  const hasPulse = chip.waveBits.pulse;

  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    const x = mouthStartX + t * mouthWidth;
    let yOff = 0;

    if (chip.family === 'wavetable' || fuse.waveToChipMode !== 'off') {
      const ramIdx = Math.floor((t * 31 + tick * 8) % 32);
      const val = (chip.waveRam[ramIdx] ?? 8) / 15 - 0.5;
      yOff = val * 18;
    } else if (hasPulse) {
      const phase = (t * 2 + tick * 2.5) % 1;
      yOff = phase < chip.pulseWidth ? -8 : 8;
    } else if (hasSaw) {
      const phase = (t * 2 + tick * 2.5) % 1;
      yOff = (phase - 0.5) * 16;
    } else {
      yOff = Math.sin(t * Math.PI * 4 + tick * 5) * 7;
    }

    if (hasNoise) {
      yOff += Math.sin(i * 19.3 + tick * 28) * 3.5;
    }

    const activeEnergy = Math.min(1.25, (0.35 + blendAmount * 0.65) * noteBoost);
    mouthPts.push(`${x.toFixed(1)},${(mouthCenterY + yOff * activeEnergy).toFixed(1)}`);
  }

  const eyeScaleY = blinking ? 0.1 : 0.74 + chip.resonance * 0.45;
  const scanBeamY = 34 + ((tick * 24) % 78);

  const vuBars = [0, 1, 2, 3, 4].map((b) => {
    const wave = 0.45 + 0.55 * Math.sin(tick * (3.5 + b * 1.1) + b * 1.3);
    return Math.max(
      0.15,
      Math.min(1, wave * (0.35 + blendAmount * 0.4 + chip.cutoff * 0.3) * noteBoost)
    );
  });

  // Live pseudo-LFSR register bits for X-Ray Die view
  const lfsrCount = chip.noiseLfsr === '23-bit' ? 16 : chip.noiseLfsr === '17-bit' ? 12 : 10;
  const lfsrStep = Math.floor(tick * 12);

  return (
    <div className="relative w-full h-48 rounded bg-[#050914] border-2 border-[#1b2b52] shadow-[inset_0_2px_12px_rgba(0,0,0,0.9),0_0_16px_rgba(57,255,20,0.08)] flex items-center justify-center overflow-hidden select-none">
      <div
        aria-hidden="true"
        className="absolute w-36 h-36 rounded-full pointer-events-none blur-2xl transition-opacity"
        style={{
          opacity: activeNoteCount > 0 ? 0.42 : 0.22,
          background: `radial-gradient(circle, ${primaryNeon}, ${secondaryTone}, transparent)`,
        }}
      />

      {!xrayMode ? (
        <svg
          viewBox="0 0 220 144"
          className="relative z-10 w-full h-full max-w-[260px]"
          aria-label={`Animated ${chip.variant} silicon chip face`}
        >
          <defs>
            <filter id="neonChipGlow" x="-40%" y="-40%" width="180%" height="180%">
              <feGaussianBlur stdDeviation="2.6" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          <g stroke="#1b305c" strokeWidth="1.2" fill="none">
            <path d="M 8 36 L 44 36 L 54 46" />
            <path d="M 8 72 L 48 72" stroke="#2dd4bf" strokeOpacity="0.45" className="animate-flow-right" />
            <path d="M 8 108 L 44 108 L 54 98" />
            <path d="M 212 36 L 176 36 L 166 46" />
            <path d="M 212 72 L 172 72" stroke="#2dd4bf" strokeOpacity="0.45" className="animate-flow-left" />
            <path d="M 212 108 L 176 108 L 166 98" />
          </g>

          <g>
            {vuBars.map((lvl, idx) => {
              const barY = 98 - idx * 12;
              const litW = 3 + lvl * 12;
              const barCol = idx >= 3 ? '#d98cb3' : '#39ff14';
              return (
                <g key={idx}>
                  <rect x={28 - litW} y={barY} width={litW} height="4" rx="1" fill={barCol} opacity="0.8" />
                  <rect x={192} y={barY} width={litW} height="4" rx="1" fill={barCol} opacity="0.8" />
                </g>
              );
            })}
          </g>

          <g transform={`translate(${headX.toFixed(2)}, ${headY.toFixed(2)}) rotate(${headTilt.toFixed(2)} 110 72)`}>
            <line x1="110" y1="14" x2="110" y2="26" stroke="#2dd4bf" strokeWidth="2" />
            <circle
              cx="110"
              cy="11"
              r={(activeNoteCount > 0 ? 4.4 : 3.2) + Math.sin(tick * 4) * 0.7}
              fill={activeNoteCount > 0 ? primaryNeon : secondaryTone}
              filter="url(#neonChipGlow)"
            />

            {[0, 1, 2, 3].map((pinIdx) => {
              const py = 40 + pinIdx * 20;
              const leftLit = pinIdx + 1 <= chip.rackInstances;
              const rightLit = pinIdx + 5 <= chip.rackInstances;
              return (
                <g key={pinIdx}>
                  <rect
                    x="44"
                    y={py - 3}
                    width="10"
                    height="6"
                    rx="1"
                    fill={leftLit ? primaryNeon : '#17254a'}
                    opacity={leftLit ? 0.95 : 0.6}
                    filter={leftLit ? 'url(#neonChipGlow)' : undefined}
                  />
                  <rect
                    x="166"
                    y={py - 3}
                    width="10"
                    height="6"
                    rx="1"
                    fill={rightLit ? primaryNeon : '#17254a'}
                    opacity={rightLit ? 0.95 : 0.6}
                    filter={rightLit ? 'url(#neonChipGlow)' : undefined}
                  />
                </g>
              );
            })}

            <rect
              x="54"
              y="26"
              width="112"
              height="94"
              rx="8"
              fill="#0d1734"
              stroke="#2dd4bf"
              strokeOpacity="0.7"
              strokeWidth="1.5"
            />

            <rect
              x="62"
              y="34"
              width="96"
              height="78"
              rx="5"
              fill="#050914"
              stroke="#1e315d"
              strokeWidth="1"
            />

            <line
              x1="64"
              y1={scanBeamY}
              x2="156"
              y2={scanBeamY}
              stroke={secondaryTone}
              strokeOpacity="0.22"
              strokeWidth="1.2"
            />

            <text
              x="110"
              y="45"
              textAnchor="middle"
              fill={secondaryTone}
              fontSize="7.5"
              fontFamily="Share Tech Mono, monospace"
              letterSpacing="1.2"
            >
              {chip.variant.toUpperCase()} · {chip.clock}
            </text>

            <g transform={`translate(86, 65) scale(1, ${eyeScaleY.toFixed(3)})`}>
              <rect
                x="-12"
                y="-10"
                width="24"
                height="20"
                rx={chip.family === 'wavetable' ? 2 : 5}
                fill="#071126"
                stroke={secondaryTone}
                strokeWidth="1.5"
              />
              <circle
                cx={gazeX}
                cy={gazeY}
                r={chip.family === 'fm' ? 4.6 : 4.0}
                fill={primaryNeon}
                filter="url(#neonChipGlow)"
              />
              <circle cx={gazeX - 1.2} cy={gazeY - 1.2} r="1.2" fill="#ffffff" opacity="0.85" />
            </g>

            <g transform={`translate(134, 65) scale(1, ${eyeScaleY.toFixed(3)})`}>
              <rect
                x="-12"
                y="-10"
                width="24"
                height="20"
                rx={chip.family === 'wavetable' ? 2 : 5}
                fill="#071126"
                stroke={secondaryTone}
                strokeWidth="1.5"
              />
              <circle
                cx={gazeX}
                cy={gazeY}
                r={chip.family === 'fm' ? 4.6 : 4.0}
                fill={primaryNeon}
                filter="url(#neonChipGlow)"
              />
              <circle cx={gazeX - 1.2} cy={gazeY - 1.2} r="1.2" fill="#ffffff" opacity="0.85" />
            </g>

            <rect
              x={mouthStartX - 4}
              y={mouthCenterY - 12}
              width={mouthWidth + 8}
              height="24"
              rx="3"
              fill="#060c1b"
              stroke="#1f3463"
              strokeWidth="1"
            />
            <polyline
              fill="none"
              stroke={primaryNeon}
              strokeWidth="2.0"
              strokeLinecap="round"
              strokeLinejoin="round"
              points={mouthPts.join(' ')}
              filter="url(#neonChipGlow)"
            />
          </g>
        </svg>
      ) : (
        /* X-Ray Silicon Die Schematic View */
        <svg viewBox="0 0 220 144" className="relative z-10 w-full h-full max-w-[270px]">
          <rect x="26" y="24" width="168" height="100" rx="4" fill="#071124" stroke="#2dd4bf" strokeOpacity="0.6" strokeWidth="1.2" />

          {/* OSC Cores */}
          {[0, 1, 2].map((oscIdx) => {
            const ox = 34 + oscIdx * 52;
            const pulseOn = ((Math.floor(tick * 6) + oscIdx) % 3 === 0) || activeNoteCount > 0;
            return (
              <g key={oscIdx}>
                <rect x={ox} y="32" width="44" height="24" rx="2" fill="#0b1836" stroke={pulseOn ? '#39ff14' : '#1e315d'} strokeWidth="1" />
                <text x={ox + 22} y="43" textAnchor="middle" fill="#5eead4" fontSize="6.5" fontFamily="Share Tech Mono">
                  OSC {oscIdx + 1}
                </text>
                <text x={ox + 22} y="52" textAnchor="middle" fill="#74ff57" fontSize="6" fontFamily="Share Tech Mono">
                  {chip.dacBits}b · {chip.clock}
                </text>
              </g>
            );
          })}

          {/* LFSR Shift Register Flashing Bits */}
          <rect x="34" y="64" width="152" height="22" rx="2" fill="#050b18" stroke="#d98cb3" strokeOpacity="0.55" strokeWidth="1" />
          <text x="40" y="73" fill="#f2b5d4" fontSize="6" fontFamily="Share Tech Mono">
            LFSR {chip.noiseLfsr}
          </text>
          {Array.from({ length: lfsrCount }, (_, b) => {
            const bitOn = ((lfsrStep * 7 + b * 13) % 5) < 2;
            return (
              <rect
                key={b}
                x={40 + b * 8.8}
                y="77"
                width="6"
                height="5"
                rx="1"
                fill={bitOn ? '#39ff14' : '#18284d'}
              />
            );
          })}

          {/* Analog Filter Capacitor Array */}
          <rect x="34" y="92" width="152" height="24" rx="2" fill="#0b1836" stroke="#2dd4bf" strokeOpacity="0.5" strokeWidth="1" />
          <text x="40" y="102" fill="#5eead4" fontSize="6.5" fontFamily="Share Tech Mono">
            {chip.filterMode} FILTER · BIAS {(chip.filterBias * 100).toFixed(0)}%
          </text>
          <rect
            x="40"
            y="107"
            width={Math.max(8, chip.cutoff * 138)}
            height="4"
            rx="1"
            fill="#d98cb3"
          />
        </svg>
      )}

      <div className="crt-scanlines crt-glass-glare absolute inset-0 pointer-events-none opacity-65" />

      {/* CRT Visor Corner Reticles */}
      <span className="absolute top-1 left-1 w-2 h-2 border-t border-l border-[#39ff14]/55 pointer-events-none" />
      <span className="absolute bottom-1 left-1 w-2 h-2 border-b border-l border-[#39ff14]/55 pointer-events-none" />
      <span className="absolute bottom-1 right-1 w-2 h-2 border-b border-r border-[#d98cb3]/55 pointer-events-none" />

      {/* Top Left Status + Top Right X-Ray Toggle */}
      <div className="absolute top-2 left-3 text-[11px] font-mono text-[#74ff57] glow-neon pointer-events-none">
        {activeNoteCount > 0 ? `VOICES: ${activeNoteCount}` : xrayMode ? 'DIE X-RAY' : 'SILICON VOICE'}
      </div>

      <button
        type="button"
        onClick={() => setXrayMode((v) => !v)}
        className={`absolute top-1.5 right-2 z-20 inline-flex items-center gap-1 px-2 py-0.5 rounded-[3px] text-[9px] font-mono cursor-pointer ${
          xrayMode ? 'hw-btn-mauve-on' : 'hw-btn text-[#5eead4]'
        }`}
      >
        <span
          className={`w-1 h-1 rounded-full ${
            xrayMode ? 'bg-[#f2b5d4] shadow-[0_0_5px_#d98cb3]' : 'bg-[#2dd4bf]/70'
          }`}
        />
        <span>{xrayMode ? 'ROBOT' : 'X-RAY'}</span>
      </button>
    </div>
  );
};
