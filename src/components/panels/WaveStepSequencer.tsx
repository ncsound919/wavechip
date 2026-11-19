import React, { useRef, useState } from 'react';
import { LaneId, WaveLane } from '../../types/synth';

export type StepSeqVisualType = 'led' | 'nodes' | 'ring' | 'bars';

interface WaveStepSequencerProps {
  lane: WaveLane;
  selectedLane: LaneId;
  visualType: StepSeqVisualType;
  frameCount: number;
  onUpdateStep: (stepIndex: number, value: number) => void;
}

export const WaveStepSequencer: React.FC<WaveStepSequencerProps> = ({
  lane,
  selectedLane,
  visualType,
  frameCount,
  onUpdateStep,
}) => {
  const [isPainting, setIsPainting] = useState(false);
  const [hoveredStep, setHoveredStep] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const isBipolar = selectedLane === 'pitch';
  const activeIdx = lane.activeStep % Math.max(1, lane.length);

  const formatStepValue = (val: number) => {
    if (selectedLane === 'timing') return `${Math.round(30 + val * 970)}`;
    if (selectedLane === 'sample') return `${Math.round(1 + val * (frameCount - 1))}`;
    if (selectedLane === 'pitch') {
      const st = Math.round((val - 0.5) * 24);
      return `${st > 0 ? '+' : ''}${st}`;
    }
    return `${Math.round(val * 100)}`;
  };

  const handleColumnPointer = (idx: number, clientY: number, rect: DOMRect) => {
    if (idx >= lane.length) return;
    const relY = 1 - Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
    onUpdateStep(idx, Number(relY.toFixed(3)));
  };

  const handleNodesContainerPointer = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const xNorm = Math.max(0, Math.min(0.9999, (e.clientX - rect.left) / rect.width));
    const yNorm = 1 - Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    const idx = Math.min(15, Math.floor(xNorm * 16));
    if (idx < lane.length) {
      setHoveredStep(idx);
      onUpdateStep(idx, Number(yNorm.toFixed(3)));
    }
  };

  const handleRingPointer = (e: React.PointerEvent<SVGSVGElement>) => {
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = e.clientX - cx;
    const dy = e.clientY - cy;
    // Angle starting from top (-PI/2) clockwise
    let angle = Math.atan2(dy, dx) + Math.PI / 2;
    if (angle < 0) angle += Math.PI * 2;
    const idx = Math.floor((angle / (Math.PI * 2)) * 16) % 16;
    if (idx >= lane.length) return;

    const maxR = Math.min(rect.width, rect.height) * 0.44;
    const minR = Math.min(rect.width, rect.height) * 0.16;
    const dist = Math.hypot(dx, dy);
    const norm = Math.max(0, Math.min(1, (dist - minR) / Math.max(1, maxR - minR)));
    setHoveredStep(idx);
    onUpdateStep(idx, Number(norm.toFixed(3)));
  };

  /* ───────────────────────────────────────────────────────────────────────────
     VISUAL TYPE 1: 80s SEGMENTED NEON LED MATRIX (Default)
     ─────────────────────────────────────────────────────────────────────────── */
  if (visualType === 'led') {
    const SEGMENTS = 10;
    return (
      <div
        className="flex-1 min-h-[126px] flex items-stretch gap-1 bg-[#040814] border-2 border-[#1b2b52] shadow-[inset_0_2px_14px_rgba(0,0,0,0.95)] rounded p-1.5 select-none relative overflow-hidden"
        onPointerUp={() => setIsPainting(false)}
        onPointerLeave={() => {
          setIsPainting(false);
          setHoveredStep(null);
        }}
      >
        {Array.from({ length: 16 }, (_, idx) => {
          const enabled = idx < lane.length;
          const inLoop = enabled && idx >= lane.loopStart && idx <= lane.loopEnd;
          const isCurrent = enabled && idx === activeIdx;
          const val = lane.steps[idx] ?? 0.5;
          const litCount = Math.round(val * SEGMENTS);
          const midSeg = SEGMENTS / 2;

          return (
            <div
              key={idx}
              onPointerEnter={() => setHoveredStep(idx)}
              onPointerDown={(e) => {
                if (!enabled) return;
                setIsPainting(true);
                handleColumnPointer(idx, e.clientY, e.currentTarget.getBoundingClientRect());
              }}
              onPointerMove={(e) => {
                if (enabled && isPainting) {
                  handleColumnPointer(idx, e.clientY, e.currentTarget.getBoundingClientRect());
                }
              }}
              title={enabled ? `Step ${idx + 1}: ${formatStepValue(val)} ${lane.unit}` : 'Inactive'}
              className={`flex-1 flex flex-col justify-between relative rounded-[3px] px-[2px] py-1 transition-colors ${
                enabled ? 'cursor-ns-resize' : 'opacity-20 pointer-events-none'
              } ${
                isCurrent
                  ? 'bg-[#101f44]/95 ring-1 ring-[#39ff14]/70 shadow-[inset_0_0_10px_rgba(57,255,20,0.18)]'
                  : inLoop
                    ? 'bg-[#091229]'
                    : 'bg-[#060a18]'
              }`}
            >
              {/* Loop status cap */}
              <div
                className={`h-[2px] w-full rounded-full mb-1 ${
                  isCurrent
                    ? 'bg-[#39ff14] shadow-[0_0_6px_#39ff14]'
                    : inLoop
                      ? 'bg-[#d98cb3]/65'
                      : 'bg-[#17254a]'
                }`}
              />

              {/* 10 LED Segments (top-down index) */}
              <div className="flex-1 flex flex-col justify-between gap-[2px]">
                {Array.from({ length: SEGMENTS }, (_, rowFromTop) => {
                  const segLevel = SEGMENTS - 1 - rowFromTop; // 0 bottom .. 9 top
                  let isLit = false;
                  if (isBipolar) {
                    const targetSeg = Math.round(val * (SEGMENTS - 1));
                    if (val >= 0.5) {
                      isLit = segLevel >= midSeg && segLevel <= targetSeg;
                    } else {
                      isLit = segLevel < midSeg && segLevel >= targetSeg;
                    }
                  } else {
                    isLit = segLevel < litCount;
                  }

                  const isPeak =
                    !isBipolar && isLit && segLevel === Math.max(0, litCount - 1);

                  let segClass = 'bg-[#0e1936] border-[#16254a]';
                  if (isLit) {
                    if (isCurrent) {
                      segClass = isPeak
                        ? 'bg-[#39ff14] border-[#74ff57] shadow-[0_0_6px_#39ff14]'
                        : 'bg-[#f2b5d4] border-[#f9d2e6] shadow-[0_0_5px_rgba(242,181,212,0.85)]';
                    } else if (segLevel >= 7) {
                      segClass = 'bg-[#d98cb3] border-[#f2b5d4]/70 shadow-[0_0_4px_rgba(217,140,179,0.55)]';
                    } else if (segLevel >= 4) {
                      segClass = 'bg-[#2dd4bf] border-[#5eead4]/70 shadow-[0_0_4px_rgba(45,212,191,0.5)]';
                    } else {
                      segClass = 'bg-[#1ea896] border-[#2dd4bf]/60';
                    }
                  } else if (isBipolar && segLevel === midSeg) {
                    segClass = 'bg-[#1a2c59] border-[#2b4482]';
                  }

                  return (
                    <div
                      key={rowFromTop}
                      className={`flex-1 w-full rounded-[1px] border transition-colors duration-75 ${segClass}`}
                    />
                  );
                })}
              </div>

              {/* Numeric readout & step dot */}
              <div className="mt-1 flex flex-col items-center leading-none pointer-events-none">
                <span
                  className={`text-[9px] font-mono tabular-nums ${
                    isCurrent
                      ? 'text-[#74ff57] font-bold'
                      : hoveredStep === idx
                        ? 'text-[#5eead4]'
                        : 'text-slate-300'
                  }`}
                >
                  {enabled ? formatStepValue(val) : '·'}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  /* ───────────────────────────────────────────────────────────────────────────
     VISUAL TYPE 2: VECTOR NODE SPLINE GRAPH
     ─────────────────────────────────────────────────────────────────────────── */
  if (visualType === 'nodes') {
    const activeSteps = Array.from({ length: lane.length }, (_, idx) => ({
      idx,
      x: ((idx + 0.5) / 16) * 100,
      y: (1 - (lane.steps[idx] ?? 0.5)) * 80 + 8,
      val: lane.steps[idx] ?? 0.5,
    }));

    const linePoints = activeSteps.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
    const baseLineY = isBipolar ? 48 : 88;
    const areaPoints =
      activeSteps.length > 0
        ? `${activeSteps[0].x.toFixed(2)},${baseLineY} ${linePoints} ${activeSteps[activeSteps.length - 1].x.toFixed(2)},${baseLineY}`
        : '';

    const loopLeftPct = (lane.loopStart / 16) * 100;
    const loopWidthPct = ((Math.max(lane.loopStart, lane.loopEnd) - lane.loopStart + 1) / 16) * 100;

    return (
      <div
        ref={containerRef}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          setIsPainting(true);
          handleNodesContainerPointer(e);
        }}
        onPointerMove={(e) => {
          if (isPainting) {
            handleNodesContainerPointer(e);
          } else {
            const rect = e.currentTarget.getBoundingClientRect();
            const idx = Math.min(
              15,
              Math.max(0, Math.floor(((e.clientX - rect.left) / rect.width) * 16))
            );
            setHoveredStep(idx);
          }
        }}
        onPointerUp={(e) => {
          if (isPainting) {
            e.currentTarget.releasePointerCapture(e.pointerId);
            setIsPainting(false);
          }
        }}
        onPointerLeave={() => {
          setIsPainting(false);
          setHoveredStep(null);
        }}
        title="Click or drag across steps to sculpt sequencer spline"
        className="flex-1 min-h-[126px] relative bg-[#040814] border-2 border-[#1b2b52] shadow-[inset_0_2px_14px_rgba(0,0,0,0.95)] rounded overflow-hidden cursor-crosshair select-none"
      >
        {/* Loop Region Shaded Backdrop */}
        <div
          className="absolute top-0 bottom-0 bg-[#d98cb3]/[0.07] border-x border-[#d98cb3]/30 pointer-events-none"
          style={{ left: `${loopLeftPct}%`, width: `${loopWidthPct}%` }}
        />

        {/* Active Step Vertical Laser Column */}
        <div
          className="absolute top-0 bottom-0 bg-[#39ff14]/[0.11] border-x border-[#39ff14]/45 pointer-events-none transition-all duration-75"
          style={{ left: `${(activeIdx / 16) * 100}%`, width: `${100 / 16}%` }}
        />

        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-full block">
          <defs>
            <linearGradient id="seqNodeFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#2dd4bf" stopOpacity="0.34" />
              <stop offset="100%" stopColor="#d98cb3" stopOpacity="0.04" />
            </linearGradient>
          </defs>

          {/* Horizontal calibration lines */}
          <line x1="0" y1="28" x2="100" y2="28" stroke="#15244a" strokeWidth="0.4" strokeDasharray="1.5 1.5" />
          <line
            x1="0"
            y1="48"
            x2="100"
            y2="48"
            stroke={isBipolar ? '#2d4b8e' : '#15244a'}
            strokeWidth={isBipolar ? '0.8' : '0.4'}
          />
          <line x1="0" y1="68" x2="100" y2="68" stroke="#15244a" strokeWidth="0.4" strokeDasharray="1.5 1.5" />

          {/* Vertical step dividers */}
          {Array.from({ length: 15 }, (_, i) => (
            <line
              key={i}
              x1={((i + 1) / 16) * 100}
              y1="0"
              x2={((i + 1) / 16) * 100}
              y2="90"
              stroke="#122042"
              strokeWidth="0.35"
            />
          ))}

          {/* Filled curve area */}
          {areaPoints && <polygon fill="url(#seqNodeFill)" points={areaPoints} />}

          {/* Vertical stems */}
          {activeSteps.map((p) => (
            <line
              key={p.idx}
              x1={p.x}
              y1={baseLineY}
              x2={p.x}
              y2={p.y}
              stroke={p.idx === activeIdx ? '#39ff14' : '#2dd4bf'}
              strokeOpacity={p.idx === activeIdx ? 0.9 : 0.4}
              strokeWidth={p.idx === activeIdx ? 0.8 : 0.45}
            />
          ))}

          {/* Connecting neon spline */}
          {linePoints && (
            <polyline
              fill="none"
              stroke="#5eead4"
              strokeWidth="1.25"
              strokeLinejoin="round"
              points={linePoints}
            />
          )}
        </svg>

        {/* Crisp HTML-overlay nodes so circles stay perfectly round regardless of aspect ratio */}
        <div className="absolute inset-0 pointer-events-none">
          {activeSteps.map((p) => {
            const isCurrent = p.idx === activeIdx;
            const isInLoop = p.idx >= lane.loopStart && p.idx <= lane.loopEnd;
            return (
              <div
                key={p.idx}
                style={{ left: `${p.x}%`, top: `${p.y}%` }}
                className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full transition-transform ${
                  isCurrent
                    ? 'w-3 h-3 bg-[#39ff14] ring-2 ring-[#74ff57]/70 shadow-[0_0_10px_#39ff14] scale-110'
                    : hoveredStep === p.idx
                      ? 'w-2.5 h-2.5 bg-[#f2b5d4] shadow-[0_0_8px_#f2b5d4]'
                      : isInLoop
                        ? 'w-2 h-2 bg-[#5eead4] border border-[#040814]'
                        : 'w-1.5 h-1.5 bg-[#2dd4bf]/70'
                }`}
              />
            );
          })}
        </div>

        {/* Bottom Step Numeric Strip */}
        <div className="absolute bottom-0 inset-x-0 h-4 bg-[#03060f]/85 border-t border-[#16254a] flex pointer-events-none">
          {Array.from({ length: 16 }, (_, idx) => {
            const enabled = idx < lane.length;
            const isCurrent = enabled && idx === activeIdx;
            return (
              <span
                key={idx}
                className={`flex-1 text-[9px] font-mono tabular-nums flex items-center justify-center ${
                  !enabled
                    ? 'text-slate-700'
                    : isCurrent
                      ? 'text-[#74ff57] font-bold'
                      : hoveredStep === idx
                        ? 'text-[#f2b5d4]'
                        : 'text-slate-300'
                }`}
              >
                {enabled ? formatStepValue(lane.steps[idx] ?? 0.5) : '·'}
              </span>
            );
          })}
        </div>
      </div>
    );
  }

  /* ───────────────────────────────────────────────────────────────────────────
     VISUAL TYPE 3: ORBITAL RADIAL RING SEQUENCER
     ─────────────────────────────────────────────────────────────────────────── */
  if (visualType === 'ring') {
    const cx = 100;
    const cy = 62;
    const minR = 21;
    const maxR = 52;
    const activeVal = lane.steps[activeIdx] ?? 0.5;

    return (
      <div className="flex-1 min-h-[126px] flex items-center gap-3 bg-[#040814] border-2 border-[#1b2b52] shadow-[inset_0_2px_14px_rgba(0,0,0,0.95)] rounded px-2.5 py-1.5 select-none">
        <div className="relative h-[116px] w-[190px] shrink-0 mx-auto sm:mx-0">
          <svg
            viewBox="0 0 200 124"
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              setIsPainting(true);
              handleRingPointer(e);
            }}
            onPointerMove={(e) => {
              if (isPainting) handleRingPointer(e);
            }}
            onPointerUp={(e) => {
              if (isPainting) {
                e.currentTarget.releasePointerCapture(e.pointerId);
                setIsPainting(false);
              }
            }}
            onPointerLeave={() => {
              setIsPainting(false);
              setHoveredStep(null);
            }}
            className="w-full h-full cursor-crosshair"
          >
            {/* Outer & mid calibration rings */}
            <circle cx={cx} cy={cy} r={maxR} fill="none" stroke="#15244a" strokeWidth="1" />
            <circle
              cx={cx}
              cy={cy}
              r={(minR + maxR) / 2}
              fill="none"
              stroke={isBipolar ? '#2d4b8e' : '#122042'}
              strokeDasharray="2 2"
              strokeWidth="0.8"
            />
            <circle cx={cx} cy={cy} r={minR} fill="#060c1f" stroke="#243d75" strokeWidth="1.1" />

            {/* 16 radial spokes */}
            {Array.from({ length: 16 }, (_, idx) => {
              const angle = (idx / 16) * Math.PI * 2 - Math.PI / 2;
              const enabled = idx < lane.length;
              const inLoop = enabled && idx >= lane.loopStart && idx <= lane.loopEnd;
              const isCurrent = enabled && idx === activeIdx;
              const val = lane.steps[idx] ?? 0.5;
              const tipR = minR + val * (maxR - minR);

              const x1 = cx + Math.cos(angle) * minR;
              const y1 = cy + Math.sin(angle) * minR;
              const x2 = cx + Math.cos(angle) * maxR;
              const y2 = cy + Math.sin(angle) * maxR;
              const xt = cx + Math.cos(angle) * tipR;
              const yt = cy + Math.sin(angle) * tipR;

              return (
                <g key={idx} opacity={enabled ? 1 : 0.2}>
                  <line
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    stroke={inLoop ? '#1d3263' : '#101b38'}
                    strokeWidth="2.5"
                    strokeLinecap="round"
                  />
                  <line
                    x1={x1}
                    y1={y1}
                    x2={xt}
                    y2={yt}
                    stroke={isCurrent ? '#39ff14' : inLoop ? '#f2b5d4' : '#2dd4bf'}
                    strokeWidth={isCurrent ? '3.5' : '2.8'}
                    strokeLinecap="round"
                  />
                  <circle
                    cx={xt}
                    cy={yt}
                    r={isCurrent ? 3.3 : 2.1}
                    fill={isCurrent ? '#74ff57' : '#5eead4'}
                  />
                </g>
              );
            })}

            {/* Center Telemetry Hub */}
            <text
              x={cx}
              y={cy - 4}
              textAnchor="middle"
              className="fill-[#5eead4] font-mono text-[8px]"
            >
              S{String(activeIdx + 1).padStart(2, '0')}
            </text>
            <text
              x={cx}
              y={cy + 8}
              textAnchor="middle"
              className="fill-[#74ff57] font-mono text-[10px] font-bold"
            >
              {formatStepValue(activeVal)}
            </text>
          </svg>
        </div>

        {/* Compact 4x4 Step Grid Readout beside the Ring */}
        <div className="hidden sm:grid flex-1 grid-cols-4 gap-1 text-[10px] font-mono tabular-nums">
          {Array.from({ length: 16 }, (_, idx) => {
            const enabled = idx < lane.length;
            const inLoop = enabled && idx >= lane.loopStart && idx <= lane.loopEnd;
            const isCurrent = enabled && idx === activeIdx;
            const val = lane.steps[idx] ?? 0.5;
            return (
              <div
                key={idx}
                className={`flex items-center justify-between px-1.5 py-0.5 rounded-[2px] border ${
                  !enabled
                    ? 'opacity-20 border-[#111c3a] bg-[#050915]'
                    : isCurrent
                      ? 'border-[#39ff14]/80 bg-[#102422] text-[#74ff57]'
                      : inLoop
                        ? 'border-[#243b73] bg-[#0a132c] text-slate-200'
                        : 'border-[#16254a] bg-[#060b1b] text-slate-400'
                }`}
              >
                <span className="text-[8px] text-slate-500">{idx + 1}</span>
                <span>{enabled ? formatStepValue(val) : '·'}</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  /* ───────────────────────────────────────────────────────────────────────────
     VISUAL TYPE 4: CLASSIC SOLID BARS
     ─────────────────────────────────────────────────────────────────────────── */
  return (
    <div
      className="flex-1 min-h-[126px] flex items-stretch gap-1 bg-[#050914] border-2 border-[#1b2b52] shadow-[inset_0_2px_10px_rgba(0,0,0,0.9)] rounded p-1.5 select-none"
      onPointerUp={() => setIsPainting(false)}
      onPointerLeave={() => setIsPainting(false)}
    >
      {Array.from({ length: 16 }, (_, idx) => {
        const enabled = idx < lane.length;
        const inLoop = enabled && idx >= lane.loopStart && idx <= lane.loopEnd;
        const isCurrent = enabled && idx === activeIdx;
        const val = lane.steps[idx] ?? 0.5;

        return (
          <div
            key={idx}
            onPointerDown={(e) => {
              if (!enabled) return;
              setIsPainting(true);
              handleColumnPointer(idx, e.clientY, e.currentTarget.getBoundingClientRect());
            }}
            onPointerMove={(e) => {
              if (enabled && isPainting) {
                handleColumnPointer(idx, e.clientY, e.currentTarget.getBoundingClientRect());
              }
            }}
            title={enabled ? `Step ${idx + 1}: ${formatStepValue(val)} ${lane.unit}` : 'Inactive'}
            className={`flex-1 flex flex-col justify-end relative rounded-[2px] overflow-hidden ${
              enabled ? 'cursor-ns-resize opacity-100' : 'opacity-20 pointer-events-none'
            } ${inLoop ? 'bg-[#0b132b]' : 'bg-[#070b1a]'}`}
          >
            {inLoop && (
              <div
                className={`absolute top-0 inset-x-0 h-0.5 ${
                  isCurrent ? 'bg-[#39ff14] shadow-[0_0_6px_#39ff14]' : 'bg-[#d98cb3]/55'
                }`}
              />
            )}

            {isBipolar ? (
              <>
                <div className="absolute inset-x-0 top-1/2 h-px bg-[#263b6e]" />
                <div
                  className={`absolute inset-x-0.5 rounded-[1px] transition-colors ${
                    isCurrent
                      ? 'bg-[#f2b5d4] shadow-[0_0_8px_rgba(242,181,212,0.8)]'
                      : 'bg-[#2dd4bf]/75'
                  }`}
                  style={{
                    bottom: val >= 0.5 ? '50%' : `${val * 100}%`,
                    top: val >= 0.5 ? `${(1 - val) * 100}%` : '50%',
                  }}
                />
              </>
            ) : (
              <div
                className={`w-full rounded-t-[1px] transition-colors ${
                  isCurrent
                    ? 'bg-[#f2b5d4] shadow-[0_0_8px_rgba(242,181,212,0.8)]'
                    : 'bg-[#2dd4bf]/70 hover:bg-[#5eead4]'
                }`}
                style={{ height: `${Math.max(5, val * 100)}%` }}
              />
            )}

            <span className="relative z-10 text-[10px] font-mono tabular-nums text-center text-slate-100 pb-0.5 pointer-events-none">
              {enabled ? formatStepValue(val) : ''}
            </span>
          </div>
        );
      })}
    </div>
  );
};
