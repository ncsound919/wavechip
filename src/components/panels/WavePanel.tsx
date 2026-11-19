import React, { useEffect, useRef, useState } from 'react';
import { Upload, Shuffle, ArrowRight, ArrowLeft, ArrowLeftRight, Play, Pause, Send } from 'lucide-react';
import { LaneId, MilestoneScope, StepOrderMode, SynthPatchState, WaveVoiceState, WavetableData } from '../../types/synth';
import { parseWavToWavetable } from '../../bridge/vstBridge';
import { SegmentedToggle } from '../controls/SegmentedToggle';
import { MiniSlider } from '../controls/MiniSlider';
import { Wavetable3DCanvas } from '../visuals/Wavetable3DCanvas';
import { StepSeqVisualType, WaveStepSequencer } from './WaveStepSequencer';

interface WavePanelProps {
  state: SynthPatchState;
  milestoneScope: MilestoneScope;
  lastPlayedMidi: number | null;
  onActiveFrameChange: (frame: number) => void;
  onWavetableImport: (wt: WavetableData) => void;
  onSculptFrame: (frameIndex: number, curve64: number[]) => void;
  onToggleMips: (enabled: boolean) => void;
  onUpdateWaveVoice: (patch: Partial<WaveVoiceState>) => void;
  onPushCycle2048: () => void;
  onUpdateLane: (laneId: LaneId, patch: Partial<SynthPatchState['lanes'][LaneId]>) => void;
}

const LANE_TABS: { id: LaneId; label: string }[] = [
  { id: 'timing', label: 'Time' },
  { id: 'sample', label: 'Sample' },
  { id: 'pitch', label: 'Melody' },
  { id: 'level', label: 'Level' },
];

export const WavePanel: React.FC<WavePanelProps> = ({
  state,
  milestoneScope,
  lastPlayedMidi,
  onActiveFrameChange,
  onWavetableImport,
  onSculptFrame,
  onToggleMips,
  onUpdateWaveVoice,
  onPushCycle2048,
  onUpdateLane,
}) => {
  const [selectedLane, setSelectedLane] = useState<LaneId>('sample');
  const [viewMode, setViewMode] = useState<'3d' | 'draw'>('3d');
  const [lowerModule, setLowerModule] = useState<'seq' | 'm0'>('seq');
  const [showChipifiedOverlay, setShowChipifiedOverlay] = useState(false);
  const [importFrameSize, setImportFrameSize] = useState<64 | 128 | 256 | 512 | 1024 | 2048>(2048);
  const [importNote, setImportNote] = useState<string | null>(null);
  const [isDrawingWave, setIsDrawingWave] = useState(false);
  const [seqRunning, setSeqRunning] = useState(true);
  const [seqVisualType, setSeqVisualType] = useState<StepSeqVisualType>('led');

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const drawCanvasRef = useRef<HTMLDivElement | null>(null);
  const pendulumDirRef = useRef<1 | -1>(1);
  const { wavetable, activeWaveFrame, waveVoice } = state;
  const lane = state.lanes[selectedLane];
  const activeCurve = wavetable.framesPreview[activeWaveFrame] ?? wavetable.framesPreview[0];

  useEffect(() => {
    if (milestoneScope === 'm0') {
      setLowerModule('m0');
    }
  }, [milestoneScope]);

  const effectiveMidi = lastPlayedMidi ?? 60;
  const freqHz = 440 * Math.pow(2, (effectiveMidi - 69 + waveVoice.tuneCents / 100) / 12);
  const nyquistSafeHz = 22050;
  const maxHarmonics = Math.max(1, Math.floor(nyquistSafeHz / Math.max(20, freqHz)));
  const activeMipIdx = wavetable.mipsEnabled
    ? Math.max(0, Math.min(10, Math.floor(Math.log2(Math.max(1, 1024 / maxHarmonics)))))
    : 0;
  const lpfNorm = Math.max(0, Math.min(1, Math.log(waveVoice.filterCutoffHz / 80) / Math.log(20000 / 80)));

  useEffect(() => {
    if (!seqRunning) return;
    const timer = setInterval(() => {
      const start = Math.min(lane.loopStart, lane.length - 1);
      const end = Math.min(lane.loopEnd, lane.length - 1);
      if (end <= start) return;

      let nextStep = lane.activeStep;
      if (lane.order === 'random') {
        nextStep = start + Math.floor(Math.random() * (end - start + 1));
      } else if (lane.order === 'reverse') {
        nextStep = lane.activeStep <= start ? end : lane.activeStep - 1;
      } else if (lane.order === 'pendulum') {
        nextStep = lane.activeStep + pendulumDirRef.current;
        if (nextStep >= end) {
          nextStep = end;
          pendulumDirRef.current = -1;
        } else if (nextStep <= start) {
          nextStep = start;
          pendulumDirRef.current = 1;
        }
      } else {
        nextStep = lane.activeStep >= end ? start : lane.activeStep + 1;
      }

      if (Math.random() * 100 < lane.skipProb) {
        nextStep = nextStep >= end ? start : nextStep + 1;
      }

      onUpdateLane(selectedLane, { activeStep: nextStep });
    }, 260);
    return () => clearInterval(timer);
  }, [seqRunning, selectedLane, lane.activeStep, lane.length, lane.loopStart, lane.loopEnd, lane.order, lane.skipProb, onUpdateLane]);

  const handleFileImport = async (file: File | undefined) => {
    if (!file) return;
    try {
      const parsed = await parseWavToWavetable(file, importFrameSize);
      onWavetableImport(parsed);
      onActiveFrameChange(0);
      setImportNote(
        parsed.headerDetected
          ? `Hdr: ${parsed.frameSize}×${parsed.frameCount}`
          : `Slc: ${parsed.frameSize}×${parsed.frameCount}`
      );
    } catch {
      setImportNote('Invalid WAV');
    }
  };

  const handleDrawPointer = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = drawCanvasRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const xNorm = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const yNorm = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    const amp = 1 - yNorm * 2; // +1 top to -1 bottom
    const centerIdx = Math.round(xNorm * (activeCurve.length - 1));
    const next = [...activeCurve];
    for (let offset = -2; offset <= 2; offset++) {
      const idx = centerIdx + offset;
      if (idx >= 0 && idx < next.length) {
        const blend = 1 - Math.abs(offset) * 0.28;
        next[idx] = Number((next[idx] * (1 - blend) + amp * blend).toFixed(3));
      }
    }
    onSculptFrame(activeWaveFrame, next);
  };

  const handleUpdateStep = (idx: number, val: number) => {
    const nextSteps = [...lane.steps];
    nextSteps[idx] = val;
    onUpdateLane(selectedLane, { steps: nextSteps });
  };

  const cycleOrder = () => {
    const modes: StepOrderMode[] = ['forward', 'reverse', 'pendulum', 'random'];
    const next = modes[(modes.indexOf(lane.order) + 1) % modes.length];
    onUpdateLane(selectedLane, { order: next });
  };

  return (
    <section className="oldschool-panel relative flex flex-col border border-[#243b73] rounded-md overflow-hidden">
      <div className="h-[2px] w-full bg-gradient-to-r from-[#2dd4bf]/20 via-[#2dd4bf] to-[#d98cb3]/40" />

      {/* Header */}
      <div className="hw-card-header flex items-center justify-between px-3 py-2 border-b border-[#1d2f5a]">
        <div className="flex items-center gap-2 min-w-0">
          <span className="hw-screw shrink-0" aria-hidden="true" />
          <h2 className="font-display text-xs font-bold tracking-wider uppercase text-[#5eead4] glow-teal whitespace-nowrap">
            Wave Engine
          </h2>
          <span className="text-[11px] font-mono text-[#f2b5d4] truncate">
            · {wavetable.name}
          </span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <SegmentedToggle
            compact
            accent="teal"
            value={viewMode}
            onChange={setViewMode}
            options={[
              { value: '3d', label: '3D' },
              { value: 'draw', label: 'Draw' },
            ]}
          />
          <button
            type="button"
            onClick={() => onToggleMips(!wavetable.mipsEnabled)}
            title="11 FFT-derived harmonic mip levels (rebuilt on table upload)"
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-[3px] text-[10px] font-mono cursor-pointer ${
              wavetable.mipsEnabled ? 'hw-btn-teal-on' : 'hw-btn text-slate-400'
            }`}
          >
            <span
              className={`w-1 h-1 rounded-full ${
                wavetable.mipsEnabled ? 'bg-[#5eead4] shadow-[0_0_5px_#2dd4bf]' : 'bg-slate-600'
              }`}
            />
            <span>11 MIPS</span>
          </button>
          <button
            type="button"
            onClick={() => setShowChipifiedOverlay((v) => !v)}
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-[3px] text-[10px] font-mono cursor-pointer ${
              showChipifiedOverlay ? 'hw-btn-neon-on' : 'hw-btn text-slate-400'
            }`}
          >
            <span
              className={`w-1 h-1 rounded-full ${
                showChipifiedOverlay ? 'bg-[#74ff57] shadow-[0_0_5px_#39ff14]' : 'bg-slate-600'
              }`}
            />
            <span>32×4b</span>
          </button>
          <span className="hw-screw shrink-0 ml-0.5" aria-hidden="true" />
        </div>
      </div>

      {/* 3D Terrain OR Interactive 2D Frame Sculptor */}
      <div className="p-3 border-b border-[#192952] flex flex-col gap-2.5">
        {viewMode === '3d' ? (
          <Wavetable3DCanvas
            wavetable={wavetable}
            activeFrame={activeWaveFrame}
            chipified={showChipifiedOverlay}
            onActiveFrameChange={onActiveFrameChange}
          />
        ) : (
          <div
            ref={drawCanvasRef}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              setIsDrawingWave(true);
              handleDrawPointer(e);
            }}
            onPointerMove={(e) => {
              if (isDrawingWave) handleDrawPointer(e);
            }}
            onPointerUp={(e) => {
              if (isDrawingWave) {
                e.currentTarget.releasePointerCapture(e.pointerId);
                setIsDrawingWave(false);
              }
            }}
            title="Click & drag to sculpt active wavetable frame"
            className="relative h-64 w-full rounded bg-[#050914] border-2 border-[#1f3569] shadow-[inset_0_2px_16px_rgba(0,0,0,0.95)] overflow-hidden cursor-crosshair select-none"
          >
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-full">
              <defs>
                <linearGradient id="sculptWaveFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#f2b5d4" stopOpacity="0.32" />
                  <stop offset="100%" stopColor="#2dd4bf" stopOpacity="0.04" />
                </linearGradient>
              </defs>
              <line x1="0" y1="50" x2="100" y2="50" stroke="#1e315d" strokeWidth="0.8" />
              <line x1="50" y1="0" x2="50" y2="100" stroke="#1e315d" strokeWidth="0.6" strokeDasharray="2 2" />
              <polygon
                fill="url(#sculptWaveFill)"
                points={`0,50 ${activeCurve
                  .map((v, i) => `${((i / (activeCurve.length - 1)) * 100).toFixed(2)},${((1 - v) * 44 + 6).toFixed(2)}`)
                  .join(' ')} 100,50`}
              />
              <polyline
                fill="none"
                stroke="#f2b5d4"
                strokeWidth="1.9"
                points={activeCurve
                  .map((v, i) => `${((i / (activeCurve.length - 1)) * 100).toFixed(2)},${((1 - v) * 44 + 6).toFixed(2)}`)
                  .join(' ')}
              />
            </svg>
            <div className="crt-scanlines crt-glass-glare absolute inset-0 pointer-events-none opacity-60" />
            <div className="absolute top-2 left-2.5 text-[11px] font-mono text-[#5eead4] glow-teal pointer-events-none">
              FRAME SCULPTOR (DRAG TO DRAW)
            </div>
            <div className="absolute top-2 right-2.5 text-[11px] font-mono tabular-nums text-[#f2b5d4] pointer-events-none">
              FRM {String(activeWaveFrame + 1).padStart(2, '0')}
            </div>
          </div>
        )}

        <div className="hw-subcard rounded-[4px] px-2.5 py-2 flex items-center gap-2.5 text-[11px]">
          <input
            ref={fileInputRef}
            type="file"
            accept=".wav,audio/wav"
            className="hidden"
            onChange={(e) => handleFileImport(e.target.files?.[0])}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="hw-btn inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[3px] text-[11px] font-mono text-[#5eead4] cursor-pointer whitespace-nowrap shrink-0"
          >
            <Upload className="w-3 h-3 text-[#f2b5d4]" />
            <span>.WAV</span>
          </button>

          <select
            aria-label="Wavetable frame slice size"
            value={importFrameSize}
            onChange={(e) =>
              setImportFrameSize(Number(e.target.value) as 64 | 128 | 256 | 512 | 1024 | 2048)
            }
            className="hw-select rounded-[3px] px-1.5 py-1 text-[11px] font-mono tabular-nums text-slate-200 shrink-0"
          >
            {[64, 128, 256, 512, 1024, 2048].map((sz) => (
              <option key={sz} value={sz}>
                {sz}
              </option>
            ))}
          </select>

          <div className="flex-1 flex items-center gap-2 min-w-0">
            <span className="text-[10px] font-mono text-[#5eead4] whitespace-nowrap">SCAN</span>
            <MiniSlider
              label="Scan wavetable frame"
              hideHeader
              compact
              accent="teal"
              min={0}
              max={Math.max(1, wavetable.frameCount - 1)}
              step={1}
              value={activeWaveFrame}
              defaultValue={0}
              onChange={(v) => onActiveFrameChange(Math.round(v))}
            />
          </div>

          {importNote && (
            <span className="text-[10px] font-mono text-[#f2b5d4] shrink-0">{importNote}</span>
          )}

          <button
            type="button"
            onClick={onPushCycle2048}
            title="Resample active frame to 2048 Float32Array and upload to VectorWavesEngine.loadWavetable()"
            className="hw-btn-teal-on inline-flex items-center gap-1 px-2 py-1 rounded-[3px] text-[10px] font-mono cursor-pointer shrink-0"
          >
            <Send className="w-2.5 h-2.5 text-[#5eead4]" />
            <span>2048↑</span>
          </button>
        </div>

        {/* M0 Core Voice Strip: Global Tune (-24..+24 ct) & One-Pole LPF (80..20,000 Hz) */}
        <div className="hw-subcard rounded-[4px] px-2.5 py-1.5 grid grid-cols-1 sm:grid-cols-2 gap-2.5 items-center text-[10px] font-mono">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[#5eead4] whitespace-nowrap">TUNE</span>
            <div className="flex-1 min-w-0">
              <MiniSlider
                label="Global Tune Cents"
                hideHeader
                compact
                bipolar
                accent="teal"
                min={-24}
                max={24}
                step={0.5}
                value={waveVoice.tuneCents}
                defaultValue={0}
                onChange={(v) => onUpdateWaveVoice({ tuneCents: v })}
              />
            </div>
            <span className="tabular-nums text-slate-200 w-11 text-right shrink-0">
              {waveVoice.tuneCents > 0 ? '+' : ''}
              {waveVoice.tuneCents.toFixed(1)}ct
            </span>
          </div>

          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[#f2b5d4] whitespace-nowrap">1P LPF</span>
            <div className="flex-1 min-w-0">
              <MiniSlider
                label="One-Pole Low-Pass Cutoff Hz"
                hideHeader
                compact
                accent="mauve"
                min={0}
                max={1}
                step={0.005}
                value={lpfNorm}
                defaultValue={Math.log(16000 / 80) / Math.log(20000 / 80)}
                onChange={(norm) =>
                  onUpdateWaveVoice({
                    filterCutoffHz: Math.round(80 * Math.pow(20000 / 80, norm)),
                  })
                }
              />
            </div>
            <span className="tabular-nums text-slate-200 w-14 text-right shrink-0">
              {waveVoice.filterCutoffHz >= 1000
                ? `${(waveVoice.filterCutoffHz / 1000).toFixed(1)}kHz`
                : `${Math.round(waveVoice.filterCutoffHz)}Hz`}
            </span>
          </div>
        </div>
      </div>

      {/* Lower Wave Module: Wave Seq 2.0 (M2) OR M0 Voice ADSR & 11-Mip Pyramid */}
      <div className="p-3 flex-1 flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-1.5">
          <div className="flex items-center gap-1.5">
            <SegmentedToggle
              compact
              accent="neon"
              value={lowerModule}
              onChange={setLowerModule}
              options={[
                { value: 'seq', label: 'Seq 2.0' },
                { value: 'm0', label: 'M0 Voice' },
              ]}
            />
            {lowerModule === 'seq' && (
              <>
                <button
                  type="button"
                  onClick={() => setSeqRunning((v) => !v)}
                  title={seqRunning ? 'Pause lane preview' : 'Play lane preview'}
                  className={`p-1.5 rounded-[3px] cursor-pointer ${
                    seqRunning ? 'hw-btn-teal-on' : 'hw-btn text-slate-400'
                  }`}
                >
                  {seqRunning ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                </button>
                <SegmentedToggle
                  compact
                  accent="teal"
                  value={selectedLane}
                  onChange={setSelectedLane}
                  options={LANE_TABS.map((t) => ({ value: t.id, label: t.label }))}
                />
              </>
            )}
          </div>

          {lowerModule === 'seq' ? (
            <SegmentedToggle
              compact
              accent="mauve"
              value={seqVisualType}
              onChange={setSeqVisualType}
              options={[
                { value: 'led', label: 'LED' },
                { value: 'nodes', label: 'Nodes' },
                { value: 'ring', label: 'Ring' },
                { value: 'bars', label: 'Bars' },
              ]}
            />
          ) : (
            <span className="text-[10px] font-mono tabular-nums text-[#74ff57]">
              MIP {activeMipIdx} ({Math.round(freqHz)}Hz · {maxHarmonics}h)
            </span>
          )}
        </div>

        {lowerModule === 'seq' ? (
          <>
            <div
              className={`flex flex-wrap items-center justify-between gap-1.5 text-[11px] font-mono tabular-nums transition-opacity ${
                milestoneScope === 'm0' ? 'opacity-45' : ''
              }`}
            >
              <span className="text-[10px] tracking-wider uppercase text-[#5eead4]/80">
                Seq 2.0 · {lane.label} ({lane.unit})
                {milestoneScope === 'm0' && ' · M2'}
              </span>

              <div className="flex items-center gap-1.5">
                <select
                  aria-label="Lane length"
                  value={lane.length}
                  onChange={(e) => {
                    const len = Number(e.target.value);
                    onUpdateLane(selectedLane, {
                      length: len,
                      loopEnd: Math.min(lane.loopEnd, len - 1),
                      loopStart: Math.min(lane.loopStart, len - 1),
                    });
                  }}
                  className="hw-select rounded-[3px] px-1.5 py-0.5 text-slate-200"
                >
                  {Array.from({ length: 16 }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>
                      {n} stp
                    </option>
                  ))}
                </select>

                <button
                  type="button"
                  onClick={() => {
                    const nextStart = (lane.loopStart + 1) % Math.max(1, lane.loopEnd);
                    onUpdateLane(selectedLane, { loopStart: nextStart });
                  }}
                  title="Cycle loop start step"
                  className="hw-btn px-1.5 py-0.5 rounded-[3px] text-[10px] text-[#d98cb3] cursor-pointer"
                >
                  L{lane.loopStart + 1}..{lane.loopEnd + 1}
                </button>

                <button
                  type="button"
                  onClick={cycleOrder}
                  title="Step playback order"
                  className="hw-btn inline-flex items-center gap-1 px-2 py-0.5 rounded-[3px] text-slate-200 hover:text-[#f2b5d4] cursor-pointer"
                >
                  {lane.order === 'forward' && <ArrowRight className="w-3 h-3 text-[#2dd4bf]" />}
                  {lane.order === 'reverse' && <ArrowLeft className="w-3 h-3 text-[#2dd4bf]" />}
                  {lane.order === 'pendulum' && <ArrowLeftRight className="w-3 h-3 text-[#d98cb3]" />}
                  {lane.order === 'random' && <Shuffle className="w-3 h-3 text-[#39ff14]" />}
                  <span className="capitalize">{lane.order.slice(0, 3)}</span>
                </button>

                <label className="hw-select inline-flex items-center gap-1 rounded-[3px] px-1.5 py-0.5 text-slate-200">
                  <span className="text-slate-400">SKP</span>
                  <input
                    type="number"
                    min={0}
                    max={95}
                    step={5}
                    value={lane.skipProb}
                    onChange={(e) =>
                      onUpdateLane(selectedLane, {
                        skipProb: Math.max(0, Math.min(95, Number(e.target.value) || 0)),
                      })
                    }
                    aria-label="Skip probability percent"
                    className="w-7 bg-transparent text-right text-[#f2b5d4] focus:outline-none"
                  />
                  <span className="text-slate-400">%</span>
                </label>
              </div>
            </div>

            <div className={`flex-1 flex flex-col ${milestoneScope === 'm0' ? 'opacity-45' : ''}`}>
              <WaveStepSequencer
                lane={lane}
                selectedLane={selectedLane}
                visualType={seqVisualType}
                frameCount={wavetable.frameCount}
                onUpdateStep={handleUpdateStep}
              />
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col justify-between gap-2">
            {/* M0 Amplitude ADSR in exact physical seconds */}
            <div className="hw-subcard rounded-[4px] p-2.5 flex flex-col gap-2">
              <div className="flex items-center justify-between text-[9px] font-mono">
                <span className="text-[#5eead4]">M0 AMP ENVELOPE (SECONDS)</span>
                <span className="text-[#f2b5d4] tabular-nums">
                  {waveVoice.attackSeconds < 0.1
                    ? `${Math.round(waveVoice.attackSeconds * 1000)}ms`
                    : `${waveVoice.attackSeconds.toFixed(2)}s`}{' '}
                  /{' '}
                  {waveVoice.decaySeconds < 0.1
                    ? `${Math.round(waveVoice.decaySeconds * 1000)}ms`
                    : `${waveVoice.decaySeconds.toFixed(2)}s`}{' '}
                  / {Math.round(waveVoice.sustainLevel * 100)}% /{' '}
                  {waveVoice.releaseSeconds < 0.1
                    ? `${Math.round(waveVoice.releaseSeconds * 1000)}ms`
                    : `${waveVoice.releaseSeconds.toFixed(2)}s`}
                </span>
              </div>
              <div className="grid grid-cols-4 gap-2.5">
                <MiniSlider
                  label="ATK"
                  accent="teal"
                  min={0.001}
                  max={5}
                  step={0.005}
                  value={waveVoice.attackSeconds}
                  defaultValue={0.01}
                  onChange={(v) => onUpdateWaveVoice({ attackSeconds: v })}
                  paramId="wave.env.a"
                />
                <MiniSlider
                  label="DEC"
                  accent="teal"
                  min={0.001}
                  max={5}
                  step={0.005}
                  value={waveVoice.decaySeconds}
                  defaultValue={0.25}
                  onChange={(v) => onUpdateWaveVoice({ decaySeconds: v })}
                  paramId="wave.env.d"
                />
                <MiniSlider
                  label="SUS"
                  accent="mauve"
                  min={0}
                  max={1}
                  step={0.01}
                  value={waveVoice.sustainLevel}
                  defaultValue={0.8}
                  onChange={(v) => onUpdateWaveVoice({ sustainLevel: v })}
                  paramId="wave.env.s"
                />
                <MiniSlider
                  label="REL"
                  accent="neon"
                  min={0.001}
                  max={10}
                  step={0.01}
                  value={waveVoice.releaseSeconds}
                  defaultValue={0.25}
                  onChange={(v) => onUpdateWaveVoice({ releaseSeconds: v })}
                  paramId="wave.env.r"
                />
              </div>
            </div>

            {/* 11-Level FFT Harmonic Mip Pyramid */}
            <div className="hw-subcard rounded-[4px] p-2 flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-[9px] font-mono">
                <span className="text-[#5eead4]">11-LEVEL FFT MIP PYRAMID</span>
                <span className="text-slate-400">
                  2048 SMP · {wavetable.mipsEnabled ? 'ANTI-ALIASED' : 'BYPASSED'}
                </span>
              </div>
              <div className="grid grid-cols-11 gap-1 h-10 items-end bg-[#040814] border border-[#172852] rounded px-1.5 py-1">
                {Array.from({ length: 11 }, (_, mip) => {
                  const active = mip === activeMipIdx;
                  const heightPct = Math.max(18, 100 - mip * 7.5);
                  const harmonics = Math.max(1, Math.round(1024 / Math.pow(2, mip)));
                  return (
                    <div
                      key={mip}
                      title={`MIP ${mip}: up to ${harmonics} harmonics`}
                      className="flex flex-col items-center justify-end h-full gap-0.5"
                    >
                      <div
                        className={`w-full rounded-t-[1px] transition-all ${
                          !wavetable.mipsEnabled
                            ? 'bg-slate-700/40'
                            : active
                              ? 'bg-[#39ff14] shadow-[0_0_8px_#39ff14]'
                              : 'bg-[#2dd4bf]/45'
                        }`}
                        style={{ height: `${heightPct}%` }}
                      />
                      <span
                        className={`text-[7px] font-mono leading-none ${
                          active ? 'text-[#74ff57] font-bold' : 'text-slate-500'
                        }`}
                      >
                        {mip}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
};
