import React, { useEffect, useRef, useState } from 'react';
import { Repeat } from 'lucide-react';
import { FuseState, SynthPatchState, VectorEnvelopeStage } from '../../types/synth';
import { RotaryKnob } from '../controls/RotaryKnob';
import { SegmentedToggle } from '../controls/SegmentedToggle';
import { MiniSlider } from '../controls/MiniSlider';
import { FuseScopeCanvas } from '../visuals/FuseScopeCanvas';

interface VectorFusePanelProps {
  state: SynthPatchState;
  activeNotesCount: number;
  onVectorChange: (x: number, y: number) => void;
  onToggleEnvLoop: (loop: boolean) => void;
  onUpdateStage: (stageId: number, patch: Partial<VectorEnvelopeStage>) => void;
  onUpdateFuse: (patch: Partial<FuseState>) => void;
}

export const VectorFusePanel: React.FC<VectorFusePanelProps> = ({
  state,
  activeNotesCount,
  onVectorChange,
  onToggleEnvLoop,
  onUpdateStage,
  onUpdateFuse,
}) => {
  const padRef = useRef<HTMLDivElement | null>(null);
  const [draggingPuck, setDraggingPuck] = useState(false);
  const [selectedStageId, setSelectedStageId] = useState<number>(1);
  const [draggingStageId, setDraggingStageId] = useState<number | null>(null);
  const [envT, setEnvT] = useState(0);

  const { vectorX, vectorY, vectorEnvStages, vectorEnvLoop, fuse } = state;

  const wavePct = Math.round((1 - vectorX) * 100);
  const chipPct = 100 - wavePct;

  useEffect(() => {
    if (!vectorEnvLoop || vectorEnvStages.length < 2) return;
    let rafId = 0;
    const start = performance.now();
    const loop = (now: number) => {
      // rAF timestamps can precede the performance.now() captured at mount, which
      // used to make the phase negative and index pts[-1].
      setEnvT(Math.max(0, ((now - start) / 2600) % 1));
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [vectorEnvLoop, vectorEnvStages.length]);

  const getTracerPoint = () => {
    const pts = vectorEnvStages;
    if (pts.length === 0) return { x: 0.5, y: 0.5 };
    const segCount = vectorEnvLoop ? pts.length : pts.length - 1;
    if (segCount <= 0) return pts[0];
    const scaled = envT * segCount;
    const idx = ((Math.floor(scaled) % pts.length) + pts.length) % pts.length;
    const nextIdx = (idx + 1) % pts.length;
    const frac = scaled - Math.floor(scaled);
    return {
      x: pts[idx].x + (pts[nextIdx].x - pts[idx].x) * frac,
      y: pts[idx].y + (pts[nextIdx].y - pts[idx].y) * frac,
    };
  };

  const tracer = getTracerPoint();

  const extractXY = (clientX: number, clientY: number) => {
    const el = padRef.current;
    if (!el) return { x: vectorX, y: vectorY };
    const rect = el.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, 1 - (clientY - rect.top) / rect.height));
    return { x: Number(x.toFixed(3)), y: Number(y.toFixed(3)) };
  };

  return (
    <section className="oldschool-panel relative flex flex-col border border-[#243b73] rounded-md overflow-hidden">
      <div className="h-[2px] w-full bg-gradient-to-r from-[#2dd4bf]/45 via-[#d98cb3] to-[#39ff14]/45" />

      {/* Header */}
      <div className="hw-card-header flex items-center justify-between px-3 py-2 border-b border-[#1d2f5a]">
        <div className="flex items-center gap-2">
          <span className="hw-screw shrink-0" aria-hidden="true" />
          <h2 className="font-display text-xs font-bold tracking-wider uppercase text-[#f2b5d4] glow-mauve">
            Blend Core
          </h2>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => onToggleEnvLoop(!vectorEnvLoop)}
            className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-[3px] text-[10px] font-mono cursor-pointer ${
              vectorEnvLoop ? 'hw-btn-mauve-on' : 'hw-btn text-slate-400'
            }`}
          >
            <span
              className={`w-1 h-1 rounded-full ${
                vectorEnvLoop ? 'bg-[#f2b5d4] shadow-[0_0_5px_#d98cb3]' : 'bg-slate-600'
              }`}
            />
            <Repeat className="w-2.5 h-2.5" />
            <span>LOOP ENV</span>
          </button>
          <span className="hw-screw shrink-0" aria-hidden="true" />
        </div>
      </div>

      {/* Hero Center Blend Knob + Live Dual-Trace Fuse Scope */}
      <div className="px-3.5 pt-3 pb-2.5 border-b border-[#192952] flex flex-col items-center gap-2">
        <div className="w-full flex items-center justify-between text-[12px] font-mono tabular-nums">
          <span className="text-[#5eead4] glow-teal">◀ WAVE {wavePct}%</span>
          <span className="text-[#74ff57] glow-neon">CHIP {chipPct}% ▶</span>
        </div>

        <div className="w-full h-1.5 rounded-[2px] bg-[#050914] border border-[#1e2f58] overflow-hidden flex">
          <div
            className="h-full bg-[#2dd4bf] shadow-[0_0_8px_#2dd4bf] transition-[width] duration-75"
            style={{ width: `${wavePct}%` }}
          />
          <div
            className="h-full bg-[#39ff14] shadow-[0_0_8px_#39ff14] transition-[width] duration-75"
            style={{ width: `${chipPct}%` }}
          />
        </div>

        {/* Center Hero BLEND Knob flanked by Animated Signal Conduits */}
        <div className="w-full flex items-center justify-center gap-1">
          <svg viewBox="0 0 60 24" className="w-14 h-6 shrink-0" aria-hidden="true">
            <line x1="2" y1="12" x2="58" y2="12" stroke="#182a54" strokeWidth="2" />
            <line
              x1="2"
              y1="12"
              x2="58"
              y2="12"
              stroke="#2dd4bf"
              strokeWidth="2"
              strokeOpacity={0.35 + (1 - vectorX) * 0.65}
              className="animate-flow-right"
            />
          </svg>

          <RotaryKnob
            label="WAVE ↔ CHIP BLEND"
            size="xl"
            accent="mauve"
            value={vectorX}
            defaultValue={0.5}
            onChange={(x) => onVectorChange(x, vectorY)}
            formatValue={(v) => `${Math.round((1 - v) * 100)} / ${Math.round(v * 100)}`}
          />

          <svg viewBox="0 0 60 24" className="w-14 h-6 shrink-0" aria-hidden="true">
            <line x1="2" y1="12" x2="58" y2="12" stroke="#182a54" strokeWidth="2" />
            <line
              x1="2"
              y1="12"
              x2="58"
              y2="12"
              stroke="#39ff14"
              strokeWidth="2"
              strokeOpacity={0.35 + vectorX * 0.65}
              className="animate-flow-left"
            />
          </svg>
        </div>

        {/* Real-Time Dual-Trace + Fused Output Oscilloscope */}
        <FuseScopeCanvas state={state} activeNotesCount={activeNotesCount} />

        {/* Compact 4-Corner Vector XY Plane */}
        <div className="w-full flex flex-col items-center gap-1">
          <div className="w-full flex items-center justify-between text-[10px] font-mono text-slate-400 px-0.5">
            <span className="text-[#5eead4]">A:W1</span>
            <span className="text-[#f2b5d4]">B:W2 / D:C2</span>
            <span className="text-[#74ff57]">C:C1</span>
          </div>

          <div
            ref={padRef}
            onPointerDown={(e) => {
              if (draggingStageId !== null) return;
              e.currentTarget.setPointerCapture(e.pointerId);
              setDraggingPuck(true);
              const { x, y } = extractXY(e.clientX, e.clientY);
              onVectorChange(x, y);
            }}
            onPointerMove={(e) => {
              if (draggingStageId !== null) {
                const { x, y } = extractXY(e.clientX, e.clientY);
                onUpdateStage(draggingStageId, { x, y });
                return;
              }
              if (!draggingPuck) return;
              const { x, y } = extractXY(e.clientX, e.clientY);
              onVectorChange(x, y);
            }}
            onPointerUp={(e) => {
              if (draggingPuck) {
                e.currentTarget.releasePointerCapture(e.pointerId);
                setDraggingPuck(false);
              }
              setDraggingStageId(null);
            }}
            className="relative w-full h-28 rounded bg-[#050914] border-2 border-[#1b2b52] shadow-[inset_0_2px_12px_rgba(0,0,0,0.9),0_0_14px_rgba(217,140,179,0.1)] cursor-crosshair select-none overflow-hidden"
          >
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 w-full h-full pointer-events-none">
              <line x1="50" y1="0" x2="50" y2="100" stroke="#1e315d" strokeWidth="0.9" />
              <line x1="0" y1="50" x2="100" y2="50" stroke="#1e315d" strokeWidth="0.9" />
              <polygon
                points="50,5 95,50 50,95 5,50"
                fill="none"
                stroke="#2dd4bf"
                strokeOpacity="0.4"
                strokeWidth="0.8"
                strokeDasharray="2 2"
              />
              <polyline
                fill="none"
                stroke="#d98cb3"
                strokeOpacity="0.75"
                strokeWidth="1.3"
                points={
                  vectorEnvStages
                    .map((s) => `${s.x * 100},${(1 - s.y) * 100}`)
                    .join(' ') +
                  (vectorEnvLoop && vectorEnvStages.length > 0
                    ? ` ${vectorEnvStages[0].x * 100},${(1 - vectorEnvStages[0].y) * 100}`
                    : '')
                }
              />
              {vectorEnvLoop && (
                <circle cx={tracer.x * 100} cy={(1 - tracer.y) * 100} r="2.2" fill="#5eead4" />
              )}
            </svg>

            <div className="crt-scanlines crt-glass-glare absolute inset-0 pointer-events-none opacity-45" />

            {vectorEnvStages.map((stage) => {
              const isSelected = stage.id === selectedStageId;
              return (
                <button
                  key={stage.id}
                  type="button"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    setSelectedStageId(stage.id);
                    setDraggingStageId(stage.id);
                  }}
                  style={{
                    left: `${stage.x * 100}%`,
                    top: `${(1 - stage.y) * 100}%`,
                  }}
                  title={`Env Stage ${stage.id}: ${stage.durationMs}ms`}
                  className={`absolute -translate-x-1/2 -translate-y-1/2 w-4 h-4 rounded-full text-[9px] font-mono font-semibold flex items-center justify-center border cursor-grab active:cursor-grabbing ${
                    isSelected
                      ? 'bg-[#d98cb3] text-[#050914] border-white shadow-[0_0_8px_#d98cb3] z-20'
                      : 'bg-[#0c1633] text-[#f2b5d4] border-[#d98cb3]/70 z-10'
                  }`}
                >
                  {stage.id}
                </button>
              );
            })}

            <div
              style={{
                left: `${vectorX * 100}%`,
                top: `${(1 - vectorY) * 100}%`,
              }}
              className="absolute -translate-x-1/2 -translate-y-1/2 pointer-events-none z-30"
            >
              <div className="w-4 h-4 rounded-full border-2 border-white bg-[#050914] flex items-center justify-center shadow-[0_0_14px_rgba(45,212,191,0.9)]">
                <div className="w-1.5 h-1.5 rounded-full bg-[#39ff14]" />
              </div>
            </div>
          </div>

          {/* Active Vector Stage Duration Micro-Bar */}
          {(() => {
            const sel = vectorEnvStages.find((s) => s.id === selectedStageId) ?? vectorEnvStages[0];
            if (!sel) return null;
            return (
              <div className="w-full flex items-center justify-between gap-2 px-2 py-0.5 rounded-[3px] bg-[#040814] border border-[#1a2c59] text-[10px] font-mono tabular-nums">
                <span className="text-[#f2b5d4] shrink-0">ENV S{sel.id}</span>
                <div className="flex-1">
                  <MiniSlider
                    label={`Vector stage ${sel.id} duration`}
                    hideHeader
                    compact
                    accent="mauve"
                    min={20}
                    max={2500}
                    step={10}
                    value={sel.durationMs}
                    defaultValue={500}
                    onChange={(v) => onUpdateStage(sel.id, { durationMs: Math.round(v) })}
                  />
                </div>
                <span className="text-[#5eead4] w-12 text-right shrink-0">{sel.durationMs}ms</span>
              </div>
            );
          })()}
        </div>
      </div>

      {/* Fuse Cross-Modulation Cards */}
      <div className="p-3 flex-1 flex flex-col justify-between gap-2">
        <div className="flex items-center justify-between">
          <span className="font-display text-[11px] font-bold tracking-wider uppercase text-[#5eead4] glow-teal">
            Fuse Cross-Mod
          </span>
          <button
            type="button"
            onClick={() => onUpdateFuse({ chipifyEnabled: !fuse.chipifyEnabled })}
            className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-[3px] text-[10px] font-mono cursor-pointer ${
              fuse.chipifyEnabled ? 'hw-btn-neon-on' : 'hw-btn text-slate-400'
            }`}
          >
            <span
              className={`w-1 h-1 rounded-full ${
                fuse.chipifyEnabled ? 'bg-[#74ff57] shadow-[0_0_5px_#39ff14]' : 'bg-slate-600'
              }`}
            />
            <span>CHIPIFY {fuse.chipifyEnabled ? 'ON' : 'OFF'}</span>
          </button>
        </div>

        <div className="hw-subcard rounded-[4px] px-2.5 py-1.5 flex items-center justify-between">
          <span className="text-[11px] font-mono text-[#74ff57]">CHIPIFY WAVE</span>
          <div className="flex items-center gap-3">
            <RotaryKnob
              label="Bits"
              size="sm"
              accent="neon"
              value={(fuse.chipifyBits - 4) / 12}
              defaultValue={(8 - 4) / 12}
              onChange={(v) => onUpdateFuse({ chipifyBits: Math.round(4 + v * 12) })}
              paramId="fuse.chipify.bits"
              formatValue={(v) => `${Math.round(4 + v * 12)}b`}
            />
            <RotaryKnob
              label="Alias"
              size="sm"
              accent="neon"
              value={fuse.chipifyAliasing}
              defaultValue={0.25}
              onChange={(v) => onUpdateFuse({ chipifyAliasing: v })}
              paramId="fuse.chipify.alias"
            />
          </div>
        </div>

        <div className="hw-subcard rounded-[4px] px-2.5 py-1.5 flex items-center justify-between">
          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-mono text-[#f2b5d4]">CHIP → WAVE</span>
            <SegmentedToggle
              compact
              accent="mauve"
              value={fuse.chipToWaveMode}
              onChange={(m) => onUpdateFuse({ chipToWaveMode: m })}
              options={[
                { value: 'off', label: 'Off' },
                { value: 'fm', label: 'FM' },
                { value: 'ring', label: 'RM' },
                { value: 'shaper', label: 'Shp' },
              ]}
            />
          </div>
          <RotaryKnob
            label="Depth"
            size="sm"
            accent="mauve"
            value={fuse.chipToWaveAmount}
            defaultValue={0.25}
            onChange={(v) => onUpdateFuse({ chipToWaveAmount: v })}
            paramId="fuse.c2w.amount"
          />
        </div>

        <div className="hw-subcard rounded-[4px] px-2.5 py-1.5 flex items-center justify-between">
          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-mono text-[#5eead4]">WAVE → CHIP</span>
            <SegmentedToggle
              compact
              accent="teal"
              value={fuse.waveToChipMode}
              onChange={(m) => onUpdateFuse({ waveToChipMode: m })}
              options={[
                { value: 'off', label: 'Off' },
                { value: 'drive_ram', label: 'RAM' },
                { value: 'sync_frame', label: 'Sync' },
              ]}
            />
          </div>
          <RotaryKnob
            label="Scan"
            size="sm"
            accent="teal"
            value={fuse.waveToChipRate}
            defaultValue={0.5}
            onChange={(v) => onUpdateFuse({ waveToChipRate: v })}
            paramId="fuse.w2c.rate"
          />
        </div>
      </div>
    </section>
  );
};
