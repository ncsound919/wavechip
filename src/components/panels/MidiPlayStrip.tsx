import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Lock, Zap } from 'lucide-react';
import { MilestoneScope } from '../../types/synth';
import { MiniSlider } from '../controls/MiniSlider';

interface MidiPlayStripProps {
  rackInstances: number;
  milestoneScope: MilestoneScope;
  activeNotes: Record<number, { slot: number; velocity: number }>;
  onNoteOn: (midiNote: number, velocity: number) => void;
  onNoteOff: (midiNote: number) => void;
  onPitchBend: (val: number) => void;
  onModWheel: (val: number) => void;
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const IS_BLACK = [false, true, false, true, false, false, true, false, true, false, true, false];

const QWERTY_MAP: Record<string, number> = {
  a: 0,
  w: 1,
  s: 2,
  e: 3,
  d: 4,
  f: 5,
  t: 6,
  g: 7,
  y: 8,
  h: 9,
  u: 10,
  j: 11,
  k: 12,
  o: 13,
  l: 14,
  p: 15,
};

export const MidiPlayStrip: React.FC<MidiPlayStripProps> = ({
  rackInstances,
  milestoneScope,
  activeNotes,
  onNoteOn,
  onNoteOff,
  onPitchBend,
  onModWheel,
}) => {
  const [octave, setOctave] = useState(3);
  const [hold, setHold] = useState(false);
  const [arpOn, setArpOn] = useState(false);
  const [arpMode, setArpMode] = useState<'UP' | 'DN' | 'RND'>('UP');
  const [pitchBend, setPitchBend] = useState(0);
  const [modWheel, setModWheel] = useState(0.25);
  const [lastVelocity, setLastVelocity] = useState(0);
  const [pointerDownKey, setPointerDownKey] = useState<number | null>(null);
  const [arpStepNote, setArpStepNote] = useState<number | null>(null);

  const arpIdxRef = useRef(0);
  const activeNotesRef = useRef(activeNotes);
  activeNotesRef.current = activeNotes;

  const baseMidi = (octave + 1) * 12;
  const totalSemitones = 25;

  // Built-in Hardware Arpeggiator stepping over held/active notes (or demo triad if none held)
  useEffect(() => {
    if (!arpOn) {
      setArpStepNote(null);
      return;
    }
    const timer = setInterval(() => {
      const held = Object.keys(activeNotesRef.current)
        .map(Number)
        .sort((a, b) => a - b);
      const pool = held.length > 0 ? held : [baseMidi, baseMidi + 4, baseMidi + 7, baseMidi + 12];

      let pickIdx = 0;
      if (arpMode === 'RND') {
        pickIdx = Math.floor(Math.random() * pool.length);
      } else if (arpMode === 'DN') {
        arpIdxRef.current = (arpIdxRef.current + 1) % pool.length;
        pickIdx = pool.length - 1 - arpIdxRef.current;
      } else {
        arpIdxRef.current = (arpIdxRef.current + 1) % pool.length;
        pickIdx = arpIdxRef.current;
      }
      setArpStepNote(pool[pickIdx]);
    }, 150);

    return () => clearInterval(timer);
  }, [arpOn, arpMode, baseMidi]);

  useEffect(() => {
    const downKeys = new Set<string>();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      const offset = QWERTY_MAP[e.key.toLowerCase()];
      if (offset === undefined) return;
      downKeys.add(e.key.toLowerCase());
      const midi = baseMidi + offset;
      setLastVelocity(104);
      onNoteOn(midi, 104 / 127);
    };

    const onKeyUp = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (!downKeys.has(k)) return;
      downKeys.delete(k);
      if (hold) return;
      const offset = QWERTY_MAP[k];
      if (offset !== undefined) onNoteOff(baseMidi + offset);
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [baseMidi, hold, onNoteOn, onNoteOff]);

  const whiteKeys: number[] = [];
  const blackKeys: { midi: number; leftPct: number }[] = [];

  for (let i = 0; i < totalSemitones; i++) {
    if (!IS_BLACK[i % 12]) whiteKeys.push(baseMidi + i);
  }

  let wCursor = 0;
  for (let i = 0; i < totalSemitones; i++) {
    if (!IS_BLACK[i % 12]) {
      wCursor++;
    } else {
      const leftPct = ((wCursor - 0.34) / whiteKeys.length) * 100;
      blackKeys.push({ midi: baseMidi + i, leftPct });
    }
  }

  const triggerKeyDown = (midi: number, e: React.PointerEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const relY = Math.max(0.15, Math.min(1, (e.clientY - rect.top) / rect.height));
    const vel = Math.round(relY * 127);
    setLastVelocity(vel);

    if (hold && activeNotes[midi]) {
      onNoteOff(midi);
      return;
    }
    setPointerDownKey(midi);
    onNoteOn(midi, relY);
  };

  const triggerKeyUp = (midi: number) => {
    if (pointerDownKey === midi) setPointerDownKey(null);
    if (!hold) onNoteOff(midi);
  };

  const releaseAllHeld = () => {
    Object.keys(activeNotes).forEach((m) => onNoteOff(Number(m)));
  };

  const activeMidiList = Object.entries(activeNotes);
  const slotNoteMap: Record<number, number> = {};
  activeMidiList.forEach(([midiStr, info]) => {
    slotNoteMap[info.slot] = Number(midiStr);
  });
  if (arpOn && arpStepNote !== null) {
    slotNoteMap[((arpIdxRef.current) % Math.max(1, rackInstances)) + 1] = arpStepNote;
  }

  return (
    <section className="oldschool-panel relative border border-[#243b73] rounded-md overflow-hidden">
      <div className="h-[2px] w-full bg-gradient-to-r from-[#2dd4bf]/30 via-[#39ff14]/70 to-[#d98cb3]/30" />
      <div className="px-3.5 py-2.5 flex flex-col md:flex-row items-stretch gap-3">
        {/* Left: Pitch / Mod Wheels, Octave, Hold & Arpeggiator */}
        <div className="hw-subcard rounded-[4px] px-2.5 py-1.5 flex items-center gap-2.5 shrink-0">
          <div className="flex items-center gap-2.5">
            <div
              className="flex flex-col items-center gap-0.5 w-14"
              onPointerUp={() => {
                setPitchBend(0);
                onPitchBend(0);
              }}
            >
              <span className="text-[9px] font-mono text-[#5eead4]">PB</span>
              <MiniSlider
                label="Pitch bend wheel"
                hideHeader
                compact
                bipolar
                accent="teal"
                min={-1}
                max={1}
                step={0.02}
                value={pitchBend}
                defaultValue={0}
                onChange={(v) => {
                  setPitchBend(v);
                  onPitchBend(v);
                }}
              />
            </div>
            <div className="flex flex-col items-center gap-0.5 w-14">
              <span className="text-[9px] font-mono text-[#f2b5d4]">MOD</span>
              <MiniSlider
                label="Modulation wheel"
                hideHeader
                compact
                accent="mauve"
                min={0}
                max={1}
                step={0.01}
                value={modWheel}
                defaultValue={0.25}
                onChange={(v) => {
                  setModWheel(v);
                  onModWheel(v);
                }}
              />
            </div>
          </div>

          <div className="h-9 w-px bg-[#1d3163]" />

          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setOctave((o) => Math.max(1, o - 1))}
                aria-label="Octave down"
                className="hw-btn p-0.5 rounded-[3px] text-slate-300 hover:text-[#5eead4] cursor-pointer"
              >
                <ChevronDown className="w-3 h-3" />
              </button>
              <span className="text-[11px] font-mono tabular-nums text-[#5eead4] w-7 text-center">
                C{octave}
              </span>
              <button
                type="button"
                onClick={() => setOctave((o) => Math.min(6, o + 1))}
                aria-label="Octave up"
                className="hw-btn p-0.5 rounded-[3px] text-slate-300 hover:text-[#5eead4] cursor-pointer"
              >
                <ChevronUp className="w-3 h-3" />
              </button>
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  if (hold) releaseAllHeld();
                  setHold((h) => !h);
                }}
                className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[3px] text-[9px] font-mono cursor-pointer ${
                  hold ? 'hw-btn-mauve-on' : 'hw-btn text-slate-400'
                }`}
              >
                <Lock className="w-2.5 h-2.5" />
                <span>HOLD</span>
              </button>

              <button
                type="button"
                onClick={() => setArpOn((a) => !a)}
                className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[3px] text-[9px] font-mono cursor-pointer ${
                  arpOn ? 'hw-btn-neon-on' : 'hw-btn text-slate-400'
                }`}
              >
                <Zap className="w-2.5 h-2.5" />
                <span>ARP</span>
              </button>

              {arpOn && (
                <button
                  type="button"
                  onClick={() =>
                    setArpMode((m) => (m === 'UP' ? 'DN' : m === 'DN' ? 'RND' : 'UP'))
                  }
                  className="hw-btn-teal-on px-1.5 py-0.5 rounded-[3px] text-[9px] font-mono cursor-pointer"
                >
                  {arpMode}
                </button>
              )}
            </div>
          </div>
        </div>

      {/* Center: 2-Octave Velocity-Sensitive Keyboard */}
      <div
        className="relative flex-1 h-14 min-w-[260px] bg-[#050914] border-2 border-[#1f3569] rounded overflow-hidden select-none shadow-[inset_0_2px_8px_rgba(0,0,0,0.85)]"
        onPointerLeave={() => {
          if (pointerDownKey !== null && !hold) {
            onNoteOff(pointerDownKey);
            setPointerDownKey(null);
          }
        }}
      >
        {/* Classic Keybed Felt Strip */}
        <div
          aria-hidden="true"
          className="absolute top-0 inset-x-0 h-[3px] z-20 bg-gradient-to-r from-[#2dd4bf]/60 via-[#d98cb3]/75 to-[#39ff14]/60 pointer-events-none"
        />

        <div className="flex w-full h-full">
          {whiteKeys.map((midi) => {
            const isActive = Boolean(activeNotes[midi]) || arpStepNote === midi;
            const noteLabel =
              midi % 12 === 0 ? `C${Math.floor(midi / 12) - 1}` : NOTE_NAMES[midi % 12];
            return (
              <button
                key={midi}
                type="button"
                onPointerDown={(e) => triggerKeyDown(midi, e)}
                onPointerUp={() => triggerKeyUp(midi)}
                onPointerEnter={(e) => {
                  if (e.buttons === 1 && !hold) {
                    if (pointerDownKey !== null && pointerDownKey !== midi) {
                      onNoteOff(pointerDownKey);
                    }
                    triggerKeyDown(midi, e);
                  }
                }}
                onPointerLeave={() => {
                  if (pointerDownKey === midi && !hold) onNoteOff(midi);
                }}
                className={`flex-1 h-full border-r border-[#16254a] last:border-r-0 flex flex-col justify-end items-center pb-1 transition-all cursor-pointer ${
                  isActive
                    ? 'bg-gradient-to-b from-[#2dd4bf]/55 to-[#155e75]/80 text-white shadow-[inset_0_0_16px_rgba(45,212,191,0.85)]'
                    : 'bg-gradient-to-b from-[#111d3f] to-[#0a1228] hover:from-[#182957] hover:to-[#0f1a38] text-slate-400 shadow-[inset_0_-2px_0_rgba(0,0,0,0.45)]'
                }`}
              >
                {midi % 12 === 0 && (
                  <span className="text-[9px] font-mono pointer-events-none">{noteLabel}</span>
                )}
              </button>
            );
          })}
        </div>

        {blackKeys.map(({ midi, leftPct }) => {
          const isActive = Boolean(activeNotes[midi]) || arpStepNote === midi;
          return (
            <button
              key={midi}
              type="button"
              onPointerDown={(e) => {
                e.stopPropagation();
                triggerKeyDown(midi, e);
              }}
              onPointerUp={(e) => {
                e.stopPropagation();
                triggerKeyUp(midi);
              }}
              style={{ left: `${leftPct}%`, width: `${(0.66 / whiteKeys.length) * 100}%` }}
              className={`absolute top-0 h-[62%] rounded-b-[3px] border border-[#243d78] z-10 transition-all cursor-pointer ${
                isActive
                  ? 'bg-[#39ff14] border-white shadow-[0_0_12px_#39ff14]'
                  : 'bg-gradient-to-b from-[#0c142b] to-[#03060f] hover:from-[#15234a] shadow-[0_2px_4px_rgba(0,0,0,0.85),inset_0_-2px_0_rgba(255,255,255,0.06)]'
              }`}
              aria-label={`MIDI Note ${midi}`}
            />
          );
        })}
      </div>

      {/* Right: Polyphonic Chip Rack / M0 Mono Voice Allocator Monitor */}
        <div className="hw-subcard rounded-[4px] px-2.5 py-1.5 flex flex-col justify-between gap-1 shrink-0 min-w-[184px]">
          <div className="flex items-center justify-between text-[10px] font-mono">
            <span className="text-[#74ff57]">
              {milestoneScope === 'm0' ? 'M0 MONO VOICE' : 'VOICE ALLOCATOR'}
            </span>
            <span className="text-[#f2b5d4] tabular-nums">VEL {lastVelocity}</span>
          </div>

          <div className="grid grid-cols-8 gap-1">
            {Array.from({ length: 8 }, (_, idx) => {
              const slotNum = idx + 1;
              const effectiveRack = milestoneScope === 'm0' ? 1 : rackInstances;
              const allocated = slotNum <= effectiveRack;
              const noteNum = slotNoteMap[slotNum];
              const sounding = noteNum !== undefined;
              const noteTxt = sounding
                ? `${NOTE_NAMES[noteNum % 12]}${Math.floor(noteNum / 12) - 1}`
                : allocated
                  ? milestoneScope === 'm0'
                    ? 'M0'
                    : `V${slotNum}`
                  : '—';

              return (
                <div
                  key={slotNum}
                  className={`h-7 rounded-[3px] border flex flex-col items-center justify-center font-mono text-[9px] tabular-nums transition-all ${
                    sounding
                      ? 'bg-[#39ff14]/25 border-[#39ff14] text-[#74ff57] shadow-[0_0_8px_rgba(57,255,20,0.45)]'
                      : allocated
                        ? 'bg-[#050914] border-[#21386e] text-slate-400'
                        : 'bg-[#040712] border-[#111c3a] text-slate-600 opacity-50'
                  }`}
                >
                  {noteTxt}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
};
