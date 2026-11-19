import React from 'react';
import { AccentTone } from './RotaryKnob';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

interface SegmentedToggleProps<T extends string> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  accent?: AccentTone;
  compact?: boolean;
}

const ACTIVE_CLASSES: Record<AccentTone, { btn: string; pip: string }> = {
  teal: {
    btn: 'hw-btn-teal-on',
    pip: 'bg-[#5eead4] shadow-[0_0_6px_#2dd4bf]',
  },
  mauve: {
    btn: 'hw-btn-mauve-on',
    pip: 'bg-[#f2b5d4] shadow-[0_0_6px_#d98cb3]',
  },
  neon: {
    btn: 'hw-btn-neon-on',
    pip: 'bg-[#74ff57] shadow-[0_0_6px_#39ff14]',
  },
  blue: {
    btn: 'hw-btn-teal-on',
    pip: 'bg-[#7dd3fc] shadow-[0_0_6px_#38bdf8]',
  },
  amber: {
    btn: 'hw-btn-teal-on',
    pip: 'bg-[#5eead4] shadow-[0_0_6px_#2dd4bf]',
  },
  cyan: {
    btn: 'hw-btn-neon-on',
    pip: 'bg-[#74ff57] shadow-[0_0_6px_#39ff14]',
  },
  slate: {
    btn: 'bg-slate-700/60 text-slate-100 border-slate-400/60',
    pip: 'bg-slate-200',
  },
};

export function SegmentedToggle<T extends string>({
  options,
  value,
  onChange,
  accent = 'teal',
  compact = false,
}: SegmentedToggleProps<T>) {
  const activeStyle = ACTIVE_CLASSES[accent];

  return (
    <div className="inline-flex items-center p-0.5 rounded-[4px] bg-[#040814] border border-[#1d3163] gap-0.5 shadow-[inset_0_2px_5px_rgba(0,0,0,0.85)]">
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`${
              compact ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-xs'
            } inline-flex items-center gap-1.5 font-mono tracking-wide rounded-[3px] border transition-all whitespace-nowrap shrink-0 cursor-pointer active:translate-y-[0.5px] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#2dd4bf] ${
              active
                ? activeStyle.btn
                : 'border-transparent text-slate-400 hover:text-slate-100 hover:bg-[#132044]'
            }`}
          >
            <span
              className={`w-1 h-1 rounded-full transition-opacity ${
                active ? activeStyle.pip : 'bg-slate-600/60'
              }`}
            />
            <span>{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}
