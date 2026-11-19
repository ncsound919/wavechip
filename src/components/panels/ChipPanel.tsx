import React, { useState } from 'react';
import {
  ChipFamily,
  ChipState,
  ChipVariant,
  ClockStandard,
  CpuTier,
  FilterMode,
  SynthPatchState,
} from '../../types/synth';
import { RotaryKnob } from '../controls/RotaryKnob';
import { SegmentedToggle } from '../controls/SegmentedToggle';
import { MiniSlider } from '../controls/MiniSlider';
import { ChipRobotFace } from '../visuals/ChipRobotFace';

interface ChipPanelProps {
  state: SynthPatchState;
  cpuTier: CpuTier;
  activeNoteCount: number;
  onUpdateChip: (patch: Partial<ChipState>) => void;
}

const FAMILY_VARIANTS: Record<ChipFamily, ChipVariant[]> = {
  sid: ['6581', '8580'],
  psg: ['AY-3-8910', 'YM2149'],
  fm: ['YM2612', 'YM2151'],
  wavetable: ['N163', 'Namco WSG', 'Game Boy', 'SCC'],
};

const FM_ALGO_LABELS = [
  '1: 1→2→3→4',
  '2: (1+2)→3→4',
  '3: (1+(2→3))→4',
  '4: (1→2+3)→4',
  '5: 1→2 + 3→4',
  '6: 1→(2+3+4)',
  '7: 1→2 + 3 + 4',
  '8: 1 + 2 + 3 + 4',
];

const FM_ALGO_CARRIERS: boolean[][] = [
  [false, false, false, true],
  [false, false, false, true],
  [false, false, false, true],
  [false, false, false, true],
  [false, true, false, true],
  [false, true, true, true],
  [false, true, true, true],
  [true, true, true, true],
];

const FM_ALGO_EDGES: Array<[number, number]>[] = [
  [[0, 1], [1, 2], [2, 3]],
  [[0, 2], [1, 2], [2, 3]],
  [[0, 3], [1, 2], [2, 3]],
  [[0, 1], [1, 3], [2, 3]],
  [[0, 1], [2, 3]],
  [[0, 1], [0, 2], [0, 3]],
  [[0, 1]],
  [],
];

export const ChipPanel: React.FC<ChipPanelProps> = ({
  state,
  cpuTier,
  activeNoteCount,
  onUpdateChip,
}) => {
  const [tierTab, setTierTab] = useState<'patch' | 'silicon'>('patch');
  const [paintingRam, setPaintingRam] = useState(false);

  const { chip, fuse, wavetable, activeWaveFrame, drift, vectorX } = state;

  const handleFamilyChange = (family: ChipFamily) => {
    onUpdateChip({ family, variant: FAMILY_VARIANTS[family][0] });
  };

  const effectiveWaveRam =
    fuse.waveToChipMode !== 'off' && wavetable.chipifiedFrames[activeWaveFrame]
      ? wavetable.chipifiedFrames[activeWaveFrame]
      : chip.waveRam;

  const handleRamBar = (idx: number, e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const rel = 1 - Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    const nextRam = [...chip.waveRam];
    nextRam[idx] = Math.round(rel * 15);
    onUpdateChip({ waveRam: nextRam });
  };

  const activeCoreName =
    chip.family === 'sid'
      ? cpuTier === 'hq'
        ? 'reSIDfp'
        : 'SIDLite'
      : chip.family === 'fm' && chip.variant === 'YM2612' && cpuTier === 'hq'
        ? 'Nuked-OPN2'
        : chip.family === 'wavetable'
          ? 'Custom 4b'
          : 'ymfm';

  return (
    <section className="oldschool-panel relative flex flex-col border border-[#243b73] rounded-md overflow-hidden">
      <div className="h-[2px] w-full bg-gradient-to-r from-[#d98cb3]/40 via-[#39ff14] to-[#2dd4bf]/20" />

      <div className="hw-card-header flex items-center justify-between px-3 py-2 border-b border-[#1d2f5a]">
        <div className="flex items-center gap-2 min-w-0">
          <span className="hw-screw shrink-0" aria-hidden="true" />
          <h2 className="font-display text-xs font-bold tracking-wider uppercase text-[#74ff57] glow-neon whitespace-nowrap">
            Chip Silicon
          </h2>
          <span className="text-[11px] font-mono text-[#5eead4] truncate">
            · {activeCoreName}
          </span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => onUpdateChip({ authenticTuning: !chip.authenticTuning })}
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-[3px] text-[10px] font-mono cursor-pointer whitespace-nowrap ${
              chip.authenticTuning ? 'hw-btn-neon-on' : 'hw-btn text-slate-400'
            }`}
          >
            <span
              className={`w-1 h-1 rounded-full ${
                chip.authenticTuning ? 'bg-[#74ff57] shadow-[0_0_5px_#39ff14]' : 'bg-slate-600'
              }`}
            />
            <span>{chip.authenticTuning ? 'AUTH TUNE' : 'FINE TUNE'}</span>
          </button>
          <span className="hw-screw shrink-0" aria-hidden="true" />
        </div>
      </div>

      {/* Animated Robot Face + Chip Select */}
      <div className="p-3 border-b border-[#192952] flex flex-col gap-2.5">
        <ChipRobotFace
          chip={chip}
          drift={drift}
          fuse={fuse}
          blendAmount={vectorX}
          activeNoteCount={activeNoteCount}
        />

        <div className="flex flex-wrap items-center justify-between gap-2">
          <SegmentedToggle
            compact
            accent="neon"
            value={chip.family}
            onChange={handleFamilyChange}
            options={[
              { value: 'sid', label: 'SID' },
              { value: 'psg', label: 'AY' },
              { value: 'fm', label: 'FM' },
              { value: 'wavetable', label: 'WT' },
            ]}
          />

          <div className="flex items-center gap-1.5">
            <select
              aria-label="Chip variant"
              value={chip.variant}
              onChange={(e) => onUpdateChip({ variant: e.target.value as ChipVariant })}
              className="hw-select rounded-[3px] px-1.5 py-1 text-[11px] font-mono text-slate-100"
            >
              {FAMILY_VARIANTS[chip.family].map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>

            <select
              aria-label="Chip rack voice instances"
              value={chip.rackInstances}
              onChange={(e) => onUpdateChip({ rackInstances: Number(e.target.value) })}
              className="hw-select rounded-[3px] px-1.5 py-1 text-[11px] font-mono tabular-nums text-[#74ff57]"
            >
              {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                <option key={n} value={n}>
                  {n}× Rack
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Patch vs Silicon Bench Mods */}
      <div className="p-3 flex-1 flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <SegmentedToggle
            compact
            accent="mauve"
            value={tierTab}
            onChange={setTierTab}
            options={[
              { value: 'patch', label: 'Patch' },
              { value: 'silicon', label: 'Silicon Mods' },
            ]}
          />
          <div className="flex items-center gap-1">
            {(['tri', 'saw', 'pulse', 'noise'] as const).map((bit) => {
              const on = chip.waveBits[bit];
              return (
                <button
                  key={bit}
                  type="button"
                  onClick={() =>
                    onUpdateChip({ waveBits: { ...chip.waveBits, [bit]: !on } })
                  }
                  className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[3px] text-[10px] font-mono uppercase cursor-pointer ${
                    on ? 'hw-btn-neon-on' : 'hw-btn text-slate-400'
                  }`}
                >
                  <span
                    className={`w-1 h-1 rounded-full ${
                      on ? 'bg-[#74ff57] shadow-[0_0_5px_#39ff14]' : 'bg-slate-600'
                    }`}
                  />
                  <span>{bit}</span>
                </button>
              );
            })}
          </div>
        </div>

        {tierTab === 'patch' ? (
          <div className="flex-1 flex flex-col justify-between gap-2.5">
            {chip.family === 'fm' && (
              <div className="hw-subcard rounded-[4px] flex items-center justify-between gap-2 px-2.5 py-1.5">
                <button
                  type="button"
                  onClick={() => onUpdateChip({ fmAlgo: (chip.fmAlgo + 1) % 8 })}
                  className="flex items-center gap-2 text-[11px] font-mono text-[#f2b5d4] hover:text-white cursor-pointer"
                  title="Click to cycle 4-Op FM Algorithm"
                >
                  <svg width="68" height="18" viewBox="0 0 68 18" className="shrink-0">
                    {(FM_ALGO_EDGES[chip.fmAlgo] ?? []).map(([a, b], i) => {
                      const x1 = 9 + a * 16;
                      const x2 = 9 + b * 16;
                      return (
                        <path
                          key={i}
                          d={
                            Math.abs(b - a) === 1
                              ? `M ${x1 + 5} 9 L ${x2 - 5} 9`
                              : `M ${x1} 4 Q ${(x1 + x2) / 2} -1 ${x2} 4`
                          }
                          fill="none"
                          stroke="#5eead4"
                          strokeWidth="1.2"
                        />
                      );
                    })}
                    {[0, 1, 2, 3].map((op) => {
                      const isCarrier = FM_ALGO_CARRIERS[chip.fmAlgo]?.[op];
                      const cx = 9 + op * 16;
                      return (
                        <g key={op}>
                          <rect
                            x={cx - 5}
                            y={4}
                            width={10}
                            height={10}
                            rx={2}
                            fill={isCarrier ? 'rgba(57,255,20,0.2)' : 'rgba(217,140,179,0.2)'}
                            stroke={isCarrier ? '#39ff14' : '#d98cb3'}
                            strokeWidth="1.1"
                          />
                          <text
                            x={cx}
                            y={11.5}
                            textAnchor="middle"
                            fontSize="7"
                            fill={isCarrier ? '#74ff57' : '#f2b5d4'}
                            fontFamily="Share Tech Mono, monospace"
                          >
                            {op + 1}
                          </text>
                        </g>
                      );
                    })}
                  </svg>
                  <span>{FM_ALGO_LABELS[chip.fmAlgo]}</span>
                </button>
                <div className="flex items-center gap-2 w-28">
                  <span className="text-[10px] font-mono text-slate-400">FB</span>
                  <MiniSlider
                    label="FM Feedback"
                    hideHeader
                    compact
                    accent="mauve"
                    min={0}
                    max={7}
                    step={1}
                    value={chip.fmFeedback}
                    defaultValue={3}
                    onChange={(v) => onUpdateChip({ fmFeedback: Math.round(v) })}
                    paramId="chip.fm_feedback"
                  />
                  <span className="text-[10px] font-mono text-[#74ff57] w-3 text-right">
                    {chip.fmFeedback}
                  </span>
                </div>
              </div>
            )}

            <div className="hw-subcard rounded-[4px] px-3 py-2.5 flex items-center justify-between gap-2">
              <RotaryKnob
                label="Cutoff"
                size="md"
                accent="neon"
                value={chip.cutoff}
                defaultValue={0.6}
                onChange={(v) => onUpdateChip({ cutoff: v })}
                paramId="chip.cutoff"
                formatValue={(v) => `${Math.round(20 * Math.pow(1000, v))}Hz`}
              />
              <RotaryKnob
                label="Reso"
                size="md"
                accent="neon"
                value={chip.resonance}
                defaultValue={0.35}
                onChange={(v) => onUpdateChip({ resonance: v })}
                paramId="chip.reso"
              />
              <RotaryKnob
                label="PW"
                size="md"
                accent="teal"
                value={chip.pulseWidth}
                defaultValue={0.5}
                onChange={(v) => onUpdateChip({ pulseWidth: v })}
                paramId="chip.pw"
              />
              <div className="flex flex-col items-end gap-1">
                <span className="text-[10px] font-mono text-slate-300">FILTER</span>
                <SegmentedToggle
                  compact
                  accent="neon"
                  value={chip.filterMode}
                  onChange={(m) => onUpdateChip({ filterMode: m as FilterMode })}
                  options={[
                    { value: 'LP', label: 'LP' },
                    { value: 'BP', label: 'BP' },
                    { value: 'HP', label: 'HP' },
                  ]}
                />
              </div>
            </div>

            <div className="hw-subcard rounded-[4px] px-3 py-2 flex flex-col gap-2">
              {/* Real-Time ADSR Envelope Curve Preview */}
              {(() => {
                const aX = 4 + chip.adsr.attack * 24;
                const dX = aX + 6 + chip.adsr.decay * 28;
                const sY = 22 - chip.adsr.sustain * 18;
                const rStart = Math.max(dX + 10, 68);
                const rX = Math.min(98, rStart + 4 + chip.adsr.release * 26);
                const pts = `2,22 ${aX.toFixed(1)},3 ${dX.toFixed(1)},${sY.toFixed(1)} ${rStart.toFixed(1)},${sY.toFixed(1)} ${rX.toFixed(1)},22`;
                return (
                  <div className="relative h-6 w-full rounded-[3px] bg-[#040814] border border-[#172852] overflow-hidden">
                    <svg viewBox="0 0 100 25" preserveAspectRatio="none" className="w-full h-full">
                      <polygon
                        points={`2,22 ${pts} 98,22`}
                        fill="rgba(57,255,20,0.1)"
                      />
                      <polyline
                        fill="none"
                        stroke="#39ff14"
                        strokeWidth="1.4"
                        strokeLinejoin="round"
                        points={pts}
                      />
                      <circle cx={aX} cy={3} r="1.4" fill="#5eead4" />
                      <circle cx={dX} cy={sY} r="1.4" fill="#f2b5d4" />
                    </svg>
                    <span className="absolute top-0.5 right-1.5 text-[8px] font-mono text-slate-500 pointer-events-none">
                      ENV
                    </span>
                  </div>
                );
              })()}

              <div className="grid grid-cols-4 gap-2.5">
                <MiniSlider
                  label="ATK"
                  accent="neon"
                  value={chip.adsr.attack}
                  defaultValue={0.05}
                  onChange={(v) => onUpdateChip({ adsr: { ...chip.adsr, attack: v } })}
                  paramId="chip.env.a"
                />
                <MiniSlider
                  label="DEC"
                  accent="neon"
                  value={chip.adsr.decay}
                  defaultValue={0.45}
                  onChange={(v) => onUpdateChip({ adsr: { ...chip.adsr, decay: v } })}
                  paramId="chip.env.d"
                />
                <MiniSlider
                  label="SUS"
                  accent="teal"
                  value={chip.adsr.sustain}
                  defaultValue={0.65}
                  onChange={(v) => onUpdateChip({ adsr: { ...chip.adsr, sustain: v } })}
                  paramId="chip.env.s"
                />
                <MiniSlider
                  label="REL"
                  accent="mauve"
                  value={chip.adsr.release}
                  defaultValue={0.4}
                  onChange={(v) => onUpdateChip({ adsr: { ...chip.adsr, release: v } })}
                  paramId="chip.env.r"
                />
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col justify-between gap-2.5">
            <div className="hw-subcard rounded-[4px] px-3 py-2 flex items-center justify-between gap-2">
              <RotaryKnob
                label="Curve"
                size="sm"
                accent="teal"
                value={chip.filterCurve}
                defaultValue={0.5}
                onChange={(v) => onUpdateChip({ filterCurve: v })}
                paramId="silicon.filter_curve"
              />
              <RotaryKnob
                label="6581 Bias"
                size="sm"
                accent="mauve"
                bipolar
                value={chip.filterBias}
                defaultValue={0}
                onChange={(v) => onUpdateChip({ filterBias: v })}
                formatValue={(v) => `${v >= 0 ? '+' : ''}${Math.round(v * 100)}%`}
              />
              <RotaryKnob
                label="DAC"
                size="sm"
                accent="neon"
                value={(chip.dacBits - 4) / 8}
                defaultValue={(8 - 4) / 8}
                onChange={(v) => onUpdateChip({ dacBits: Math.round(4 + v * 8) })}
                paramId="silicon.dac_bits"
                formatValue={(v) => `${Math.round(4 + v * 8)}b`}
              />
              <div className="flex flex-col items-end gap-1">
                <SegmentedToggle
                  compact
                  accent="teal"
                  value={chip.clock}
                  onChange={(c) => onUpdateChip({ clock: c as ClockStandard })}
                  options={[
                    { value: 'PAL', label: 'PAL' },
                    { value: 'NTSC', label: 'NTSC' },
                    { value: 'OC_2X', label: '2x' },
                  ]}
                />
                <select
                  aria-label="Noise LFSR"
                  value={chip.noiseLfsr}
                  onChange={(e) =>
                    onUpdateChip({ noiseLfsr: e.target.value as ChipState['noiseLfsr'] })
                  }
                  className="hw-select rounded-[3px] px-1.5 py-0.5 text-[10px] font-mono text-slate-200"
                >
                  <option value="15-bit">15b LFSR</option>
                  <option value="17-bit">17b LFSR</option>
                  <option value="23-bit">23b LFSR</option>
                </select>
              </div>
            </div>

            {/* PWM LFO Modulation */}
            <div className="hw-subcard rounded-[4px] px-3 py-1.5 flex items-center justify-between">
              <span className="text-[10px] font-mono text-[#5eead4]">PWM LFO</span>
              <div className="flex items-center gap-3">
                <RotaryKnob
                  label="Rate"
                  size="sm"
                  accent="teal"
                  value={chip.pwmRate ?? 0.25}
                  defaultValue={0.25}
                  onChange={(v) => onUpdateChip({ pwmRate: v })}
                  paramId="chip.pwm_rate"
                  formatValue={(v) => `${(0.1 + v * 7.9).toFixed(1)}Hz`}
                />
                <RotaryKnob
                  label="Depth"
                  size="sm"
                  accent="teal"
                  value={chip.pwmDepth ?? 0.0}
                  defaultValue={0.0}
                  onChange={(v) => onUpdateChip({ pwmDepth: v })}
                  paramId="chip.pwm_depth"
                />
              </div>
            </div>

            <div className="hw-subcard rounded-[4px] p-2 flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-[9px] font-mono">
                <span className="text-[#5eead4]">WAVE RAM · 32×4-BIT</span>
                <span className={fuse.waveToChipMode !== 'off' ? 'text-[#2dd4bf]' : 'text-[#74ff57]'}>
                  {fuse.waveToChipMode !== 'off' ? 'LOCKED BY WAVE→CHIP' : 'DRAG TO DRAW'}
                </span>
              </div>
              <div className="relative h-14 flex items-end gap-[2px] bg-[#040813] border border-[#1b2b52] rounded p-1.5 select-none">
                <div className="absolute inset-x-1.5 top-1/3 h-px bg-[#18274d] pointer-events-none" />
                <div className="absolute inset-x-1.5 top-2/3 h-px bg-[#18274d] pointer-events-none" />
                {effectiveWaveRam.slice(0, 32).map((s, idx) => (
                  <div
                    key={idx}
                    onPointerDown={(e) => {
                      if (fuse.waveToChipMode !== 'off') return;
                      setPaintingRam(true);
                      handleRamBar(idx, e);
                    }}
                    onPointerMove={(e) => {
                      if (paintingRam && fuse.waveToChipMode === 'off') handleRamBar(idx, e);
                    }}
                    onPointerUp={() => setPaintingRam(false)}
                    title={`RAM[${idx}] = ${s}/15`}
                    className="relative z-10 flex-1 h-full flex items-end cursor-ns-resize"
                  >
                    <div
                      className={`w-full rounded-t-[1px] ${
                        fuse.waveToChipMode !== 'off'
                          ? 'bg-[#2dd4bf]/85 shadow-[0_0_4px_rgba(45,212,191,0.4)]'
                          : 'bg-[#39ff14]/85 shadow-[0_0_4px_rgba(57,255,20,0.4)]'
                      }`}
                      style={{ height: `${Math.max(8, (s / 15) * 100)}%` }}
                    />
                  </div>
                ))}
              </div>

              {/* Silicon Preset Shapes */}
              <div className="flex flex-wrap items-center gap-1 pt-1 border-t border-[#162547]">
                <span className="text-[9px] font-mono text-slate-400">SHAPE:</span>
                {[
                  { id: 'tri', label: 'TRI' },
                  { id: 'saw', label: 'SAW' },
                  { id: 'sqr50', label: '50% SQR' },
                  { id: 'pulse25', label: '25% PLS' },
                  { id: 'pulse12', label: '12.5%' },
                  { id: 'sine', label: 'SINE' },
                  { id: 'bell', label: 'BELL' },
                  { id: 'rand', label: 'RAND' },
                ].map((btn) => (
                  <button
                    key={btn.id}
                    type="button"
                    disabled={fuse.waveToChipMode !== 'off'}
                    onClick={() => {
                      const ram = new Array(32).fill(0);
                      for (let i = 0; i < 32; i++) {
                        if (btn.id === 'tri') ram[i] = i < 16 ? i : 31 - i;
                        else if (btn.id === 'saw') ram[i] = Math.round((i / 31) * 15);
                        else if (btn.id === 'sqr50') ram[i] = i < 16 ? 15 : 0;
                        else if (btn.id === 'pulse25') ram[i] = i < 8 ? 15 : 0;
                        else if (btn.id === 'pulse12') ram[i] = i < 4 ? 15 : 0;
                        else if (btn.id === 'sine') ram[i] = Math.round((0.5 + 0.5 * Math.sin((i / 32) * Math.PI * 2)) * 15);
                        else if (btn.id === 'bell') ram[i] = Math.round((0.5 + 0.45 * Math.sin((i / 32) * Math.PI * 6) * Math.exp(-i / 16)) * 15);
                        else if (btn.id === 'rand') ram[i] = Math.floor(Math.random() * 16);
                      }
                      onUpdateChip({ waveRam: ram });
                    }}
                    className="px-1.5 py-0.5 rounded-[2px] text-[8px] font-mono uppercase bg-[#0c1630] border border-[#22396b] text-[#5eead4] hover:text-white hover:border-[#39ff14] transition-colors disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
                  >
                    {btn.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
};
