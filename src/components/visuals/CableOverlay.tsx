import React from 'react';
import { SynthPatchState } from '../../types/synth';

interface CableOverlayProps {
  visible: boolean;
  state: SynthPatchState;
}

const SRC_ANCHORS: Record<string, { x: number; y: number; color: string }> = {
  'Vec Env': { x: 50, y: 42, color: '#d98cb3' },
  'Wave Seq': { x: 20, y: 66, color: '#2dd4bf' },
  Drift: { x: 35, y: 84, color: '#d98cb3' },
  'SID Env3': { x: 80, y: 55, color: '#39ff14' },
  'LFO 1': { x: 64, y: 84, color: '#2dd4bf' },
  Velocity: { x: 50, y: 92, color: '#39ff14' },
};

const DST_ANCHORS: Record<string, { x: number; y: number }> = {
  Cutoff: { x: 78, y: 46 },
  'Vec X': { x: 47, y: 27 },
  'Vec Y': { x: 53, y: 39 },
  'Chip Bias': { x: 85, y: 62 },
  'Wave Frame': { x: 18, y: 28 },
  'Chip->Wave': { x: 44, y: 60 },
  Pitch: { x: 72, y: 34 },
};

export const CableOverlay: React.FC<CableOverlayProps> = ({ visible, state }) => {
  if (!visible) return null;

  const activeRoutes = state.modMatrix.filter((m) => m.enabled);

  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden="true"
      className="absolute inset-0 w-full h-full pointer-events-none z-30"
    >
      <defs>
        <filter id="cableGlow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="0.5" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Fuse Cross-Modulation Cables */}
      {state.fuse.waveToChipMode !== 'off' && (
        <path
          d="M 28 32 Q 50 18 72 32"
          fill="none"
          stroke="#2dd4bf"
          strokeWidth="0.45"
          strokeOpacity="0.8"
          className="animate-flow-right"
          filter="url(#cableGlow)"
        />
      )}
      {state.fuse.chipToWaveMode !== 'off' && (
        <path
          d="M 72 38 Q 50 52 28 38"
          fill="none"
          stroke="#d98cb3"
          strokeWidth="0.45"
          strokeOpacity="0.8"
          className="animate-flow-left"
          filter="url(#cableGlow)"
        />
      )}

      {/* Active Mod Matrix Catenary Patch Cables */}
      {activeRoutes.map((slot, idx) => {
        const src = SRC_ANCHORS[slot.source] ?? { x: 50, y: 80, color: '#2dd4bf' };
        const dst = DST_ANCHORS[slot.destination] ?? { x: 50, y: 40 };
        const sag = 10 + (idx % 3) * 4;
        const midX = (src.x + dst.x) / 2;
        const midY = Math.max(src.y, dst.y) + sag;

        return (
          <g key={slot.id} opacity={0.45 + Math.abs(slot.amount) * 0.5}>
            <path
              d={`M ${src.x} ${src.y} Q ${midX} ${Math.min(97, midY)} ${dst.x} ${dst.y}`}
              fill="none"
              stroke={src.color}
              strokeWidth="0.42"
              strokeLinecap="round"
              filter="url(#cableGlow)"
            />
            <circle cx={src.x} cy={src.y} r="0.85" fill={src.color} stroke="#050914" strokeWidth="0.25" />
            <circle cx={dst.x} cy={dst.y} r="0.85" fill="#ffffff" stroke={src.color} strokeWidth="0.3" />
          </g>
        );
      })}
    </svg>
  );
};
