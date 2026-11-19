import React from 'react';
import { AccentTone } from './RotaryKnob';
import { openAutomationMenu } from './AutomationMenu';

interface MiniSliderProps {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  defaultValue?: number;
  accent?: AccentTone;
  bipolar?: boolean;
  compact?: boolean;
  hideHeader?: boolean;
  formatValue?: (val: number) => string;
  onChange: (val: number) => void;
  /** APVTS id this slider drives; clicking its label opens the automation panel. */
  paramId?: string;
}

const FILL_HEX: Record<AccentTone, { bar: string; glow: string }> = {
  teal: { bar: '#2dd4bf', glow: 'rgba(45, 212, 191, 0.75)' },
  mauve: { bar: '#d98cb3', glow: 'rgba(217, 140, 179, 0.75)' },
  neon: { bar: '#39ff14', glow: 'rgba(57, 255, 20, 0.75)' },
  blue: { bar: '#38bdf8', glow: 'rgba(56, 189, 248, 0.75)' },
  amber: { bar: '#2dd4bf', glow: 'rgba(45, 212, 191, 0.75)' },
  cyan: { bar: '#39ff14', glow: 'rgba(57, 255, 20, 0.75)' },
  slate: { bar: '#94a3b8', glow: 'rgba(148, 163, 184, 0.5)' },
};

export const MiniSlider: React.FC<MiniSliderProps> = ({
  label,
  value,
  min = 0,
  max = 1,
  step = 0.01,
  defaultValue,
  accent = 'teal',
  bipolar = false,
  compact = false,
  hideHeader = false,
  formatValue,
  onChange,
  paramId,
}) => {
  const span = max - min || 1;
  const pct = Math.max(0, Math.min(100, ((value - min) / span) * 100));
  const { bar, glow } = FILL_HEX[accent];

  const fillStyle = bipolar
    ? {
        left: `${Math.min(50, pct)}%`,
        width: `${Math.abs(pct - 50)}%`,
        backgroundColor: bar,
        boxShadow: `0 0 8px ${glow}`,
      }
    : {
        left: '0%',
        width: `${pct}%`,
        backgroundColor: bar,
        boxShadow: `0 0 8px ${glow}`,
      };

  return (
    <div className="flex flex-col gap-1 w-full">
      {!hideHeader && (
        <div
          className={`flex items-center justify-between text-[11px] leading-none ${
            paramId ? 'cursor-pointer' : ''
          }`}
          onClick={(e) => {
            if (paramId) openAutomationMenu(paramId, e.currentTarget);
          }}
          title={paramId ? `${label} — click for automation` : undefined}
        >
          <span className="text-slate-300 font-mono truncate">{label}</span>
          <span className="font-mono tabular-nums text-slate-100 shrink-0 ml-2">
            {formatValue ? formatValue(value) : `${Math.round(pct)}%`}
          </span>
        </div>
      )}

      <div
        className={`group relative w-full ${
          compact ? 'h-4' : 'h-5'
        } flex items-center select-none cursor-ew-resize`}
        onDoubleClick={() => {
          if (defaultValue !== undefined) onChange(defaultValue);
        }}
        title={
          defaultValue !== undefined
            ? `${label} (Double-click to reset)`
            : label
        }
      >
        {/* Recessed Track Channel */}
        <div className="relative w-full h-2 rounded-[3px] bg-[#040813] border border-[#1d3163] shadow-[inset_0_2px_4px_rgba(0,0,0,0.9)] overflow-hidden">
          {/* Calibration Tick Marks */}
          <div className="absolute inset-0 flex justify-between px-1.5 items-center pointer-events-none opacity-35">
            {Array.from({ length: 9 }, (_, i) => (
              <span
                key={i}
                className={`w-px ${i === 4 && bipolar ? 'h-2 bg-slate-300' : 'h-1 bg-slate-400'}`}
              />
            ))}
          </div>

          {/* Glowing Neon Signal Fill */}
          <div
            className="absolute inset-y-0 opacity-85 pointer-events-none transition-[width,left] duration-75"
            style={fillStyle}
          />
        </div>

        {/* Machined Metallic Fader Cap */}
        <div
          className={`pointer-events-none absolute top-1/2 -translate-y-1/2 -translate-x-1/2 ${
            compact ? 'w-2.5 h-3.5' : 'w-3 h-4'
          } rounded-[2px] border border-[#4f6fb8] bg-gradient-to-b from-[#2c437d] via-[#15244d] to-[#0a132c] shadow-[0_2px_5px_rgba(0,0,0,0.85),inset_0_1px_0_rgba(255,255,255,0.28)] flex items-center justify-center group-hover:border-white/70 transition-colors`}
          style={{ left: `calc(6px + (100% - 12px) * ${pct / 100})` }}
        >
          <span
            className="w-[2px] h-2.5 rounded-full"
            style={{ backgroundColor: bar, boxShadow: `0 0 6px ${glow}` }}
          />
        </div>

        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          aria-label={label}
          className="absolute inset-0 w-full h-full opacity-0 cursor-ew-resize"
        />
      </div>
    </div>
  );
};
