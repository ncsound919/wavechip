import React, { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Per-parameter automation panel.
 *
 * Clicking a knob (no drag) or a slider's label opens a small panel that maps a
 * MIDI CC to that parameter, can restrict the CC to a sub-range, and can slew the
 * moves so 7-bit controller steps do not zipper. The mapping is stored in the
 * plugin state, so it survives a save/load round-trip.
 *
 * Transport: the host exposes `automationGet` / `automationSet` /
 * `automationLearn` event listeners and answers `automationGet` with an
 * `automation` event carrying the current mapping.
 */

export interface AutomationState {
  id: string;
  cc: number;
  min: number;
  max: number;
  slew: number;
}

const OPEN_EVENT = 'vc:open-automation';
export const AUTOMATION_EVENT = 'automation';

type BridgeBackend = {
  emitEvent?: (name: string, payload: unknown) => void;
  addEventListener?: (name: string, cb: (payload: unknown) => void) => void;
};

const backend = (): BridgeBackend | undefined =>
  (window as unknown as { __JUCE__?: { backend?: BridgeBackend } }).__JUCE__?.backend;

const emit = (name: string, payload: unknown) => backend()?.emitEvent?.(name, payload);

export function openAutomationMenu(paramId: string, anchor: HTMLElement): void {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: { paramId, anchor } }));
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

export const AutomationHost: React.FC = () => {
  const [state, setState] = useState<AutomationState | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: 0, top: 0 });
  const [learning, setLearning] = useState(false);
  const pollRef = useRef<number | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const close = useCallback(() => {
    stopPolling();
    setLearning(false);
    setState(null);
  }, [stopPolling]);

  // Host replies with the authoritative mapping.
  useEffect(() => {
    const be = backend();
    be?.addEventListener?.(AUTOMATION_EVENT, (payload) => {
      const p = payload as Partial<AutomationState> | undefined;
      if (!p || typeof p.id !== 'string') return;
      setState({
        id: p.id,
        cc: typeof p.cc === 'number' ? p.cc : -1,
        min: typeof p.min === 'number' ? p.min : 0,
        max: typeof p.max === 'number' ? p.max : 1,
        slew: typeof p.slew === 'number' ? p.slew : 0,
      });
    });
    return () => undefined;
  }, []);

  useEffect(() => {
    const onOpen = (e: Event) => {
      const { paramId, anchor } = (e as CustomEvent<{ paramId: string; anchor: HTMLElement }>).detail;
      if (!paramId) return;

      const r = anchor.getBoundingClientRect();
      const width = 236;
      const left = Math.max(8, Math.min(window.innerWidth - width - 8, r.left + r.width / 2 - width / 2));
      const top = r.bottom + 8;
      setPos({ left, top: Math.min(window.innerHeight - 220, top) });
      setLearning(false);
      setState({ id: paramId, cc: -1, min: 0, max: 1, slew: 0 });
      emit('automationGet', { id: paramId });
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };

    window.addEventListener(OPEN_EVENT, onOpen);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener(OPEN_EVENT, onOpen);
      window.removeEventListener('keydown', onKey);
    };
  }, [close]);

  useEffect(() => {
    if (!state) return undefined;
    const outside = (e: PointerEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) close();
    };
    const t = window.setTimeout(() => window.addEventListener('pointerdown', outside), 0);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('pointerdown', outside);
    };
  }, [state, close]);

  if (!state) return null;

  const push = (patch: Partial<AutomationState>) => {
    const next = { ...state, ...patch };
    setState(next);
    emit('automationSet', { id: next.id, cc: next.cc, min: next.min, max: next.max, slew: next.slew });
  };

  const startLearn = () => {
    setLearning(true);
    emit('automationLearn', { id: state.id });
    stopPolling();
    pollRef.current = window.setInterval(() => emit('automationGet', { id: state.id }), 300);
  };

  useEffect(() => {
    // Stop polling as soon as the host reports a learned number.
    if (learning && state && state.cc >= 0) {
      stopPolling();
      setLearning(false);
    }
  }, [learning, state, stopPolling]);

  const label = state.id.replace(/^(m0|vector|fuse|wave|chip|silicon|drift|fx)\./, '').replace(/[._]/g, ' ');

  return (
    <div
      ref={panelRef}
      className="fixed z-[80] w-[236px] rounded-lg border border-[#22376c] bg-[#070d1f]/97 p-2.5 text-slate-200 shadow-[0_12px_34px_rgba(0,0,0,0.75)] backdrop-blur-sm"
      style={{ left: pos.left, top: pos.top }}
      role="dialog"
      aria-label={`Automation for ${label}`}
    >
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[10px] font-display uppercase tracking-[0.12em] text-slate-400">{label}</span>
        <span className="rounded bg-[#0e1938] px-1.5 py-0.5 font-mono text-[10px] text-[#2dd4bf]">{state.id}</span>
      </div>

      <div className="mb-1.5 flex items-center gap-1.5">
        <span className="w-[54px] font-mono text-[10px] uppercase tracking-wider text-slate-500">MIDI CC</span>
        <span className="flex-1 rounded bg-[#040813] px-1.5 py-1 font-mono text-[10px] text-slate-100">
          {state.cc >= 0 ? `CC ${state.cc}` : 'none'}
        </span>
        <button
          type="button"
          onClick={startLearn}
          className={`rounded border px-1.5 py-1 font-mono text-[10px] transition-colors ${
            learning
              ? 'border-transparent bg-[#2dd4bf] text-[#04101c]'
              : 'border-[#22376c] bg-[#0e1938] text-slate-200 hover:border-[#2dd4bf]'
          }`}
        >
          {learning ? 'Move a control' : 'Learn'}
        </button>
        <button
          type="button"
          onClick={() => push({ cc: -1 })}
          className="rounded border border-[#22376c] bg-[#0e1938] px-1.5 py-1 font-mono text-[10px] text-slate-200 hover:border-[#2dd4bf]"
        >
          Clear
        </button>
      </div>

      {(['min', 'max'] as const).map((k) => (
        <label key={k} className="mb-1 flex items-center gap-1.5">
          <span className="w-[54px] font-mono text-[10px] uppercase tracking-wider text-slate-500">{k}</span>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={Math.round(state[k] * 100)}
            onChange={(e) => {
              const v = Number(e.target.value) / 100;
              push(k === 'min' ? { min: Math.min(v, state.max) } : { max: Math.max(v, state.min) });
            }}
            className="h-1 flex-1 accent-[#2dd4bf]"
          />
          <span className="w-9 text-right font-mono text-[10px] tabular-nums text-slate-300">{pct(state[k])}</span>
        </label>
      ))}

      <label className="mb-1 flex items-center gap-1.5">
        <span className="w-[54px] font-mono text-[10px] uppercase tracking-wider text-slate-500">Slew</span>
        <input
          type="range"
          min={0}
          max={2000}
          step={10}
          value={state.slew}
          onChange={(e) => push({ slew: Number(e.target.value) })}
          className="h-1 flex-1 accent-[#2dd4bf]"
        />
        <span className="w-9 text-right font-mono text-[10px] tabular-nums text-slate-300">{Math.round(state.slew)}</span>
      </label>

      <div className="mt-1.5 flex justify-end">
        <button
          type="button"
          onClick={close}
          className="rounded border border-[#22376c] bg-[#0e1938] px-2 py-1 font-mono text-[10px] text-slate-200 hover:border-[#2dd4bf]"
        >
          Close
        </button>
      </div>
    </div>
  );
};
