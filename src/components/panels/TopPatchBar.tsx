import React from 'react';
import { ChevronLeft, ChevronRight, SlidersHorizontal, Dices, Undo2, Cable } from 'lucide-react';
import { CpuTier, MilestoneScope, SynthPatchState, TransportMode } from '../../types/synth';
import { FACTORY_PRESETS, QUICK_STARTERS } from '../../data/presets';
import { SegmentedToggle } from '../controls/SegmentedToggle';

interface TopPatchBarProps {
  state: SynthPatchState;
  presetIndex: number;
  abSlot: 'A' | 'B';
  canUndo: boolean;
  showCables: boolean;
  milestoneScope: MilestoneScope;
  transportMode: TransportMode;
  activeNotesCount: number;
  onSelectPreset: (idx: number) => void;
  onSwitchAb: (slot: 'A' | 'B') => void;
  onCopyAtoB: () => void;
  onMutatePatch: () => void;
  onUndo: () => void;
  onToggleCables: () => void;
  onMilestoneScopeChange: (scope: MilestoneScope) => void;
  onToggleTransportMode: () => void;
  onCpuTierChange: (tier: CpuTier) => void;
  onOpenBridgeModal: () => void;
}

function getActiveCoreLabel(state: SynthPatchState): string {
  const { family, variant } = state.chip;
  if (family === 'sid') {
    return state.cpuTier === 'hq' ? `reSIDfp (${variant})` : `SIDLite (${variant})`;
  }
  if (family === 'fm') {
    if (variant === 'YM2612' && state.cpuTier === 'hq') return 'Nuked-OPN2';
    return `ymfm (${variant})`;
  }
  if (family === 'psg') {
    return `ymfm (${variant})`;
  }
  return `Custom 4-bit (${variant})`;
}

export const TopPatchBar: React.FC<TopPatchBarProps> = ({
  state,
  presetIndex,
  abSlot,
  canUndo,
  showCables,
  milestoneScope,
  transportMode,
  activeNotesCount,
  onSelectPreset,
  onSwitchAb,
  onCopyAtoB,
  onMutatePatch,
  onUndo,
  onToggleCables,
  onMilestoneScopeChange,
  onToggleTransportMode,
  onCpuTierChange,
  onOpenBridgeModal,
}) => {
  const handlePrev = () => {
    const prev = (presetIndex - 1 + FACTORY_PRESETS.length) % FACTORY_PRESETS.length;
    onSelectPreset(prev);
  };

  const handleNext = () => {
    const next = (presetIndex + 1) % FACTORY_PRESETS.length;
    onSelectPreset(next);
  };

  const baseSignal = activeNotesCount > 0
    ? Math.min(1, (0.45 + activeNotesCount * 0.14) * (0.65 + state.masterGain * 0.45))
    : 0.14 * state.masterGain;
  const leftLevel = Math.round(Math.min(10, Math.max(1, baseSignal * (1.06 - state.vectorX * 0.14) * 10)));
  const rightLevel = Math.round(Math.min(10, Math.max(1, baseSignal * (0.92 + state.vectorX * 0.14) * 10)));

  return (
    <>
    <header className="flex flex-wrap lg:flex-nowrap items-center justify-between gap-3 px-4 py-2.5 border-b border-[#1d2f5a] bg-[#0a1228]">
      {/* Zone 1: Digital 80s Wordmark + A/B Compare */}
      <div className="flex items-center gap-3 shrink-0">
        <span className="font-display text-xl font-extrabold tracking-[0.12em] whitespace-nowrap">
          <span className="text-[#5eead4] glow-teal">Wave</span>
          <span className="text-[#74ff57] glow-neon">Chip</span>
        </span>

        <div className="hidden sm:flex items-center gap-1">
          <SegmentedToggle
            compact
            accent="teal"
            value={abSlot}
            onChange={onSwitchAb}
            options={[
              { value: 'A', label: 'A' },
              { value: 'B', label: 'B' },
            ]}
          />
          <button
            type="button"
            onClick={onCopyAtoB}
            title="Copy Slot A to B"
            className="hw-btn px-2 py-1 rounded-[3px] text-[10px] font-mono text-slate-200 cursor-pointer"
          >
            A→B
          </button>
        </div>
      </div>

      {/* Zone 2: VFD Digital Patch LCD with Specular CRT Glare */}
      <div className="flex items-center gap-2 flex-1 max-w-xl min-w-[280px]">
        <div className="relative vfd-lcd-screen crt-scanlines flex-1 rounded border-2 border-[#234178] px-3 py-1.5 flex items-center justify-between gap-3 overflow-hidden">
          <div className="crt-glass-glare absolute inset-0 pointer-events-none" />
          <span className="absolute top-1 left-1 w-1.5 h-1.5 border-t border-l border-[#2dd4bf]/60 pointer-events-none" />
          <span className="absolute bottom-1 right-1 w-1.5 h-1.5 border-b border-r border-[#2dd4bf]/60 pointer-events-none" />

          <div className="relative z-10 flex items-center gap-2 min-w-0">
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={handlePrev}
                aria-label="Previous patch"
                className="hw-btn p-1 rounded-[3px] text-[#5eead4] cursor-pointer"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={handleNext}
                aria-label="Next patch"
                className="hw-btn p-1 rounded-[3px] text-[#5eead4] cursor-pointer"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[10px] font-mono tabular-nums text-[#f2b5d4] glow-mauve leading-none">
                <span>{state.bankLabel}</span>
                <span aria-hidden="true">·</span>
                <span className="truncate">{getActiveCoreLabel(state)}</span>
              </div>
              <select
                aria-label="Select patch preset"
                value={presetIndex}
                onChange={(e) => onSelectPreset(Number(e.target.value))}
                className="bg-transparent font-mono text-sm font-medium text-[#74ff57] glow-neon tracking-wide focus:outline-none cursor-pointer truncate max-w-[210px]"
              >
                {FACTORY_PRESETS.map((p, idx) => (
                  <option key={p.patchName} value={idx} className="bg-[#091229] text-[#74ff57]">
                    {p.patchName}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="relative z-10 hidden sm:flex items-center gap-2.5 font-mono tabular-nums text-[11px] text-[#5eead4] shrink-0">
            <div className="flex flex-col items-end leading-tight">
              <span className="text-[9px] text-[#d98cb3]">
                {milestoneScope === 'm0' ? 'M0 MONO' : 'POLY'}
              </span>
              <span className={activeNotesCount > 0 ? 'text-[#74ff57] glow-neon' : 'glow-teal'}>
                {milestoneScope === 'm0'
                  ? `${Math.min(1, activeNotesCount)}/1`
                  : `${activeNotesCount}/${state.chip.rackInstances}`}
              </span>
            </div>
            <div className="h-5 w-px bg-[#1f3666]" />
            <div className="flex flex-col items-end leading-tight">
              <span className="text-[9px] text-[#d98cb3]">VEC XY</span>
              <span className="glow-teal">
                {Math.round(state.vectorX * 100)}/{Math.round(state.vectorY * 100)}
              </span>
            </div>
            <div className="h-5 w-px bg-[#1f3666]" />
            <div className="flex flex-col items-end leading-tight">
              <span className="text-[9px] text-[#d98cb3]">RACK</span>
              <span className="glow-teal">
                {state.chip.rackInstances}×{state.chip.clock}
              </span>
            </div>
            <div className="h-5 w-px bg-[#1f3666]" />
            {/* Dual 10-Segment Neon Stereo VU Peak Meter */}
            <div className="flex flex-col gap-[3px]" title="Stereo Bus Peak Meter">
              {[leftLevel, rightLevel].map((lvl, chIdx) => (
                <div key={chIdx} className="flex items-center gap-[2px]">
                  <span className="text-[8px] text-slate-400 w-2">{chIdx === 0 ? 'L' : 'R'}</span>
                  {Array.from({ length: 10 }, (_, seg) => {
                    const lit = seg < lvl;
                    const colorClass =
                      seg >= 8
                        ? 'bg-[#d98cb3] shadow-[0_0_5px_#d98cb3]'
                        : seg >= 5
                          ? 'bg-[#39ff14] shadow-[0_0_5px_#39ff14]'
                          : 'bg-[#2dd4bf] shadow-[0_0_4px_#2dd4bf]';
                    return (
                      <span
                        key={seg}
                        className={`w-1.5 h-1.5 rounded-[1px] transition-all duration-100 ${
                          lit ? colorClass : 'bg-[#0b1533]'
                        }`}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Zone 3: Scope / Transport / Mutate / Undo / Cables / CPU Tier / Bridge */}
      <div className="flex items-center gap-1.5 shrink-0">
        <SegmentedToggle
          compact
          accent="neon"
          value={milestoneScope}
          onChange={onMilestoneScopeChange}
          options={[
            { value: 'm0', label: 'M0' },
            { value: 'all', label: 'All' },
          ]}
        />

        <button
          type="button"
          onClick={onToggleTransportMode}
          title={
            transportMode === 'sab'
              ? 'Parameter transport: SharedArrayBuffer SPSC ring (click to force MessagePort fallback)'
              : 'Parameter transport: MessagePort fallback (click to prefer SAB ring)'
          }
          className={`inline-flex items-center gap-1 px-2 py-1.5 rounded-[3px] text-[10px] font-mono cursor-pointer ${
            transportMode === 'sab' ? 'hw-btn-teal-on' : 'hw-btn-mauve-on'
          }`}
        >
          <span
            className={`w-1 h-1 rounded-full ${
              transportMode === 'sab'
                ? 'bg-[#5eead4] shadow-[0_0_5px_#2dd4bf]'
                : 'bg-[#f2b5d4] shadow-[0_0_5px_#d98cb3]'
            }`}
          />
          <span>{transportMode === 'sab' ? 'SAB' : 'PORT'}</span>
        </button>

        <button
          type="button"
          onClick={onMutatePatch}
          title="Mutate patch parameters (15% musical variation)"
          className="hw-btn inline-flex items-center gap-1.5 px-2 py-1.5 rounded-[3px] text-[11px] font-mono text-[#f2b5d4] cursor-pointer"
        >
          <Dices className="w-3.5 h-3.5" />
          <span className="hidden 2xl:inline">Mutate</span>
        </button>

        <button
          type="button"
          onClick={onUndo}
          disabled={!canUndo}
          title="Undo last patch change"
          className={`hw-btn p-1.5 rounded-[3px] ${
            canUndo
              ? 'text-[#5eead4] cursor-pointer'
              : 'text-slate-600 opacity-45 cursor-not-allowed'
          }`}
          aria-label="Undo last change"
        >
          <Undo2 className="w-3.5 h-3.5" />
        </button>

        <button
          type="button"
          onClick={onToggleCables}
          title="Toggle live patch cables & fuse arcs overlay"
          className={`inline-flex items-center gap-1 px-2 py-1.5 rounded-[3px] text-[11px] font-mono cursor-pointer ${
            showCables ? 'hw-btn-teal-on' : 'hw-btn text-slate-400'
          }`}
        >
          <span
            className={`w-1 h-1 rounded-full ${
              showCables ? 'bg-[#5eead4] shadow-[0_0_5px_#2dd4bf]' : 'bg-slate-600'
            }`}
          />
          <Cable className="w-3.5 h-3.5" />
          <span className="hidden 2xl:inline">Cables</span>
        </button>

        <SegmentedToggle
          compact
          accent="mauve"
          value={state.cpuTier}
          onChange={onCpuTierChange}
          options={[
            { value: 'eco', label: 'Eco' },
            { value: 'hq', label: 'HQ' },
          ]}
        />

        <button
          type="button"
          onClick={onOpenBridgeModal}
          className="hw-btn-teal-on inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-[3px] text-xs font-mono whitespace-nowrap shrink-0 cursor-pointer"
        >
          <SlidersHorizontal className="w-3.5 h-3.5 text-[#f2b5d4]" />
          <span>Bridge</span>
        </button>
      </div>
    </header>

      <div className="flex items-center gap-1 px-4 py-1 border-b border-[#1d2f5a] bg-[#080f22] overflow-x-auto">
        <span className="text-[9px] font-mono tracking-[0.18em] text-[#d98cb3] mr-1 shrink-0">START</span>
        {QUICK_STARTERS.map((s) => (
          <button
            key={s.index}
            type="button"
            onClick={() => onSelectPreset(s.index)}
            title={s.label}
            className={`hw-btn shrink-0 max-w-[140px] truncate px-2 py-0.5 rounded-[3px] text-[10px] font-mono cursor-pointer ${
              presetIndex === s.index ? 'hw-btn-teal-on' : 'text-[#5eead4]'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>
    </>
  );
};
