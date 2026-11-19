import React, { useRef, useState } from 'react';
import { openAutomationMenu } from './AutomationMenu';

export type AccentTone = 'teal' | 'mauve' | 'neon' | 'blue' | 'amber' | 'cyan' | 'slate';

interface RotaryKnobProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  defaultValue?: number;
  bipolar?: boolean;
  accent?: AccentTone;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  formatValue?: (val: number) => string;
  /** APVTS id this knob drives; enables the automation panel on a plain click. */
  paramId?: string;
}

const ACCENT_HEX: Record<AccentTone, string> = {
  teal: '#2dd4bf',
  mauve: '#d98cb3',
  neon: '#39ff14',
  blue: '#38bdf8',
  amber: '#2dd4bf',
  cyan: '#39ff14',
  slate: '#94a3b8',
};

export const RotaryKnob: React.FC<RotaryKnobProps> = ({
  label,
  value,
  onChange,
  defaultValue = 0.5,
  bipolar = false,
  accent = 'teal',
  size = 'md',
  formatValue,
  paramId,
}) => {
  const [dragging, setDragging] = useState(false);
  const startYRef = useRef(0);
  const startValRef = useRef(value);
  const movedRef = useRef(false);

  const minVal = bipolar ? -1 : 0;
  const maxVal = 1;
  const clamped = Math.max(minVal, Math.min(maxVal, value));
  const norm = bipolar ? (clamped + 1) / 2 : clamped;

  const sizePx = size === 'sm' ? 36 : size === 'lg' ? 54 : size === 'xl' ? 92 : 44;
  const radius = sizePx * 0.4;
  const center = sizePx / 2;
  const startAngle = 135;
  const sweepAngle = 270;

  const angleDeg = startAngle + norm * sweepAngle;
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const polarToXY = (deg: number, r: number) => ({
    x: center + r * Math.cos(toRad(deg)),
    y: center + r * Math.sin(toRad(deg)),
  });

  const describeArc = (fromDeg: number, toDeg: number, r: number) => {
    if (Math.abs(toDeg - fromDeg) < 0.5) return '';
    const start = polarToXY(fromDeg, r);
    const end = polarToXY(toDeg, r);
    const largeArc = Math.abs(toDeg - fromDeg) > 180 ? 1 : 0;
    const sweepFlag = toDeg > fromDeg ? 1 : 0;
    return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${r} ${r} 0 ${largeArc} ${sweepFlag} ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
  };

  const trackPath = describeArc(startAngle, startAngle + sweepAngle, radius);
  const activeStartDeg = bipolar ? startAngle + sweepAngle * 0.5 : startAngle;
  const activePath = describeArc(activeStartDeg, angleDeg, radius);

  const pointerInner = polarToXY(angleDeg, radius * 0.28);
  const pointerOuter = polarToXY(angleDeg, radius * 0.76);
  const strokeColor = ACCENT_HEX[accent];

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
    startYRef.current = e.clientY;
    startValRef.current = clamped;
    movedRef.current = false;
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    if (Math.abs(startYRef.current - e.clientY) > 3) movedRef.current = true;
    const sensitivity = e.shiftKey ? 520 : 150;
    const delta = (startYRef.current - e.clientY) / sensitivity;
    const span = maxVal - minVal;
    const next = Math.max(minVal, Math.min(maxVal, startValRef.current + delta * span));
    onChange(Number(next.toFixed(4)));
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    const wasClick = !movedRef.current;
    e.currentTarget.releasePointerCapture(e.pointerId);
    setDragging(false);
    // A click that never turned into a drag opens the parameter's automation panel.
    if (wasClick && paramId) openAutomationMenu(paramId, e.currentTarget);
  };

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const step = e.shiftKey ? 0.01 : 0.04;
    const dir = e.deltaY < 0 ? 1 : -1;
    const next = Math.max(minVal, Math.min(maxVal, clamped + dir * step));
    onChange(Number(next.toFixed(4)));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 0.01 : 0.05;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
      e.preventDefault();
      onChange(Math.min(maxVal, Number((clamped + step).toFixed(4))));
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
      e.preventDefault();
      onChange(Math.max(minVal, Number((clamped - step).toFixed(4))));
    }
  };

  const displayStr = formatValue
    ? formatValue(clamped)
    : bipolar
      ? `${clamped >= 0 ? '+' : ''}${Math.round(clamped * 100)}%`
      : `${Math.round(clamped * 100)}%`;

  // 13-LED outer collar for the XL center Blend knob
  const ledCount = 13;

  return (
    <div className="flex flex-col items-center select-none gap-1">
      <div
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={minVal}
        aria-valuemax={maxVal}
        aria-valuenow={clamped}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onDoubleClick={() => onChange(defaultValue)}
        onWheel={handleWheel}
        onKeyDown={handleKeyDown}
        title={`${label}: ${displayStr} (Drag, Shift+Drag fine, Double-click reset)`}
        className={`relative cursor-ns-resize rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2dd4bf]/80 transition-transform ${
          dragging ? 'scale-[1.04]' : ''
        }`}
        style={{ width: sizePx, height: sizePx }}
      >
        <svg width={sizePx} height={sizePx} className="overflow-visible">
          <defs>
            <radialGradient id={`knobBody-${size}-${accent}`} cx="38%" cy="32%" r="68%">
              <stop offset="0%" stopColor="#1e3163" />
              <stop offset="55%" stopColor="#0e1938" />
              <stop offset="100%" stopColor="#050a18" />
            </radialGradient>
            <linearGradient id={`knobBevel-${size}-${accent}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#587cc9" stopOpacity="0.85" />
              <stop offset="100%" stopColor="#132147" stopOpacity="0.9" />
            </linearGradient>
          </defs>

          {/* Calibrated 11-point radial tick marks */}
          {Array.from({ length: 11 }, (_, i) => {
            const tickNorm = i / 10;
            const deg = startAngle + tickNorm * sweepAngle;
            const innerTick = polarToXY(deg, radius + 2.5);
            const outerTick = polarToXY(deg, radius + (i % 5 === 0 ? 5.2 : 4));
            const tickLit = bipolar
              ? (norm >= 0.5 ? tickNorm >= 0.5 && tickNorm <= norm : tickNorm <= 0.5 && tickNorm >= norm)
              : tickNorm <= norm + 0.02;
            return (
              <line
                key={`tick-${i}`}
                x1={innerTick.x}
                y1={innerTick.y}
                x2={outerTick.x}
                y2={outerTick.y}
                stroke={tickLit ? strokeColor : '#243a6b'}
                strokeOpacity={tickLit ? 0.9 : 0.75}
                strokeWidth={i % 5 === 0 ? 1.35 : 0.9}
                strokeLinecap="round"
              />
            );
          })}

          {/* XL LED Halo Ring */}
          {size === 'xl' &&
            Array.from({ length: ledCount }, (_, i) => {
              const t = i / (ledCount - 1);
              const deg = startAngle + t * sweepAngle;
              const pos = polarToXY(deg, radius + 8.5);
              const isLit = Math.abs(t - norm) <= 0.09 || (norm >= 0.5 ? t >= 0.5 && t <= norm : t <= 0.5 && t >= norm);
              const ledColor = t < 0.4 ? '#2dd4bf' : t > 0.6 ? '#39ff14' : '#d98cb3';
              return (
                <circle
                  key={i}
                  cx={pos.x}
                  cy={pos.y}
                  r={isLit ? 2.1 : 1.5}
                  fill={isLit ? ledColor : '#152242'}
                  style={isLit ? { filter: `drop-shadow(0 0 4px ${ledColor})` } : undefined}
                />
              );
            })}

          {/* Outer track arc */}
          <path
            d={trackPath}
            fill="none"
            stroke="#131f3d"
            strokeWidth={size === 'xl' ? 3.5 : 2.5}
            strokeLinecap="round"
          />
          {/* Active neon arc with subtle glow */}
          {activePath && (
            <path
              d={activePath}
              fill="none"
              stroke={strokeColor}
              strokeWidth={size === 'xl' ? 3.5 : 2.5}
              strokeLinecap="round"
              style={{
                filter: `drop-shadow(0 0 ${size === 'xl' ? 6 : 3}px ${strokeColor})`,
              }}
            />
          )}
          {/* Machined beveled anodized knob body */}
          <circle
            cx={center}
            cy={center}
            r={radius * 0.74}
            fill={`url(#knobBody-${size}-${accent})`}
            stroke={`url(#knobBevel-${size}-${accent})`}
            strokeWidth={1.35}
          />
          <circle
            cx={center}
            cy={center}
            r={radius * 0.53}
            fill="#070d1f"
            stroke="#22376c"
            strokeWidth={0.9}
          />
          {/* Glowing indicator notch */}
          <line
            x1={pointerInner.x}
            y1={pointerInner.y}
            x2={pointerOuter.x}
            y2={pointerOuter.y}
            stroke={dragging ? '#ffffff' : strokeColor}
            strokeWidth={size === 'xl' ? 2.8 : 2}
            strokeLinecap="round"
            style={{ filter: `drop-shadow(0 0 4px ${strokeColor})` }}
          />
        </svg>
      </div>
      <div className="flex flex-col items-center leading-none">
        <span className="text-[10px] font-display tracking-wider uppercase text-slate-300 whitespace-nowrap">
          {label}
        </span>
        <span className="text-[11px] font-mono tabular-nums text-slate-100 mt-0.5 whitespace-nowrap">
          {displayStr}
        </span>
      </div>
    </div>
  );
};
