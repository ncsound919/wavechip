import React, { useState } from 'react';
import { Check, Copy, X } from 'lucide-react';
import { SynthPatchState, TransportMode } from '../../types/synth';
import {
  extractM0ParameterMap,
  extractParameterMap,
  isCrossOriginIsolated,
} from '../../bridge/vstBridge';
import { SegmentedToggle } from '../controls/SegmentedToggle';

interface BridgeSpecModalProps {
  open: boolean;
  state: SynthPatchState;
  transportMode: TransportMode;
  lastBridgeMessage: string;
  onClose: () => void;
}

export const BridgeSpecModal: React.FC<BridgeSpecModalProps> = ({
  open,
  state,
  transportMode,
  lastBridgeMessage,
  onClose,
}) => {
  const [tab, setTab] = useState<'m0' | 'apvts' | 'hookup'>('m0');
  const [copiedKey, setCopiedKey] = useState<'json' | 'code' | null>(null);

  if (!open) return null;

  const m0Params = extractM0ParameterMap(state);
  const fullParams = extractParameterMap(state);
  const coi = isCrossOriginIsolated();

  const hookupSnippet = `import { VectorWavesEngine } from './index';

// Attach your M0 engine to window.__VECTOR_WAVES_ENGINE__ in a user gesture:
const context = new AudioContext();
await context.resume();

const engine = await VectorWavesEngine.create(context, {
  seed: ${state.drift.seed},
  useSharedParameterRing: ${transportMode === 'sab'},
});
engine.connect(context.destination);

// Sync initial M0 controls from WaveChip UI state:
${m0Params.map((p) => `engine.setParameter('${p.key}', ${Number(p.physicalValue.toFixed(4))});`).join('\n')}

window.__VECTOR_WAVES_ENGINE__ = engine;`;

  const handleCopy = async (kind: 'json' | 'code') => {
    try {
      const payload = kind === 'json' ? JSON.stringify(state, null, 2) : hookupSnippet;
      await navigator.clipboard.writeText(payload);
      setCopiedKey(kind);
      setTimeout(() => setCopiedKey(null), 1800);
    } catch {
      // Clipboard blocked in restricted iframe context
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="WaveChip Host Parameter Bridge"
      className="fixed inset-0 z-50 bg-[#040712]/80 backdrop-blur-xs flex items-center justify-center p-4"
    >
      <div className="w-full max-w-4xl bg-[#091024] border-2 border-[#233a6e] rounded-md overflow-hidden shadow-2xl flex flex-col max-h-[86vh]">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 border-b border-[#1d2f5a] bg-[#0d1632]">
          <div>
            <h2 className="font-display text-sm font-bold tracking-wider uppercase text-[#5eead4]">
              WaveChip × VectorWavesEngine Bridge
            </h2>
            <p className="text-xs font-mono text-[#74ff57] mt-0.5">
              Last event: {lastBridgeMessage}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <SegmentedToggle
              compact
              accent="teal"
              value={tab}
              onChange={setTab}
              options={[
                { value: 'm0', label: 'M0 (12 Params)' },
                { value: 'apvts', label: 'Full M1–M4' },
                { value: 'hookup', label: 'WASM Hookup' },
              ]}
            />
            <button
              type="button"
              onClick={() => handleCopy(tab === 'hookup' ? 'code' : 'json')}
              className="hw-btn inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-mono text-[#f2b5d4] cursor-pointer"
            >
              {copiedKey ? (
                <>
                  <Check className="w-3.5 h-3.5 text-[#39ff14]" />
                  <span>COPIED</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5 text-[#5eead4]" />
                  <span>{tab === 'hookup' ? 'COPY CODE' : 'COPY JSON'}</span>
                </>
              )}
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close bridge modal"
              className="p-1.5 rounded text-slate-400 hover:text-slate-100 hover:bg-[#16254f] cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="p-5 overflow-y-auto flex-1 space-y-4">
          {/* Runtime Transport & Architecture Status Bar */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs font-mono">
            <div className="bg-[#050914] border border-[#1d2f5a] rounded p-2.5">
              <div className="text-[10px] text-slate-400">COOP / COEP ISOLATION</div>
              <div className={coi ? 'text-[#74ff57] mt-0.5' : 'text-[#f2b5d4] mt-0.5'}>
                {coi ? 'crossOriginIsolated = true (SAB Ready)' : 'crossOriginIsolated = false (Port Active)'}
              </div>
            </div>
            <div className="bg-[#050914] border border-[#1d2f5a] rounded p-2.5">
              <div className="text-[10px] text-slate-400">PARAMETER TRANSPORT</div>
              <div className="text-[#5eead4] mt-0.5">
                {transportMode === 'sab' && coi
                  ? 'SAB SPSC Atomic Ring + Port Notes'
                  : 'MessagePort Fallback (All Events)'}
              </div>
            </div>
            <div className="bg-[#050914] border border-[#1d2f5a] rounded p-2.5">
              <div className="text-[10px] text-slate-400">WAVETABLE PIPELINE</div>
              <div className="text-[#74ff57] mt-0.5">
                2048-Sample Cycle · 11 FFT Mips · Seed #{state.drift.seed}
              </div>
            </div>
          </div>

          {tab === 'm0' && (
            <div className="border border-[#1d2f5a] rounded overflow-hidden">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#0d1632] text-[#f2b5d4] font-mono border-b border-[#1d2f5a]">
                  <tr>
                    <th className="py-2 px-3">ID</th>
                    <th className="py-2 px-3">M0 PARAMETER KEY</th>
                    <th className="py-2 px-3">RANGE</th>
                    <th className="py-2 px-3 text-right">DEFAULT</th>
                    <th className="py-2 px-3 text-right">PHYSICAL</th>
                    <th className="py-2 px-3 text-right">DISPLAY</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#17254a] font-mono tabular-nums">
                  {m0Params.map((p) => (
                    <tr key={p.key} className="hover:bg-[#101c3d]/60">
                      <td className="py-1.5 px-3 text-slate-400">{p.index}</td>
                      <td className="py-1.5 px-3 text-[#5eead4]">{p.key}</td>
                      <td className="py-1.5 px-3 text-slate-400">{p.rangeLabel}</td>
                      <td className="py-1.5 px-3 text-right text-slate-400">{p.defaultLabel}</td>
                      <td className="py-1.5 px-3 text-right text-slate-200">
                        {p.physicalValue.toFixed(4)}
                      </td>
                      <td className="py-1.5 px-3 text-right text-[#74ff57]">{p.displayValue}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {tab === 'apvts' && (
            <div className="border border-[#1d2f5a] rounded overflow-hidden">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#0d1632] text-[#f2b5d4] font-mono border-b border-[#1d2f5a]">
                  <tr>
                    <th className="py-2 px-3">PARAM ID</th>
                    <th className="py-2 px-3">GROUP</th>
                    <th className="py-2 px-3">LABEL</th>
                    <th className="py-2 px-3 text-right">NORM (0..1)</th>
                    <th className="py-2 px-3 text-right">VALUE</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#17254a] font-mono tabular-nums">
                  {fullParams.map((p) => (
                    <tr key={p.id} className="hover:bg-[#101c3d]/60">
                      <td className="py-1.5 px-3 text-[#5eead4]">{p.id}</td>
                      <td className="py-1.5 px-3 text-slate-400 font-sans">{p.group}</td>
                      <td className="py-1.5 px-3 text-slate-200 font-sans">{p.label}</td>
                      <td className="py-1.5 px-3 text-right text-slate-300">
                        {p.normalizedValue.toFixed(4)}
                      </td>
                      <td className="py-1.5 px-3 text-right text-[#74ff57]">{p.displayValue}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {tab === 'hookup' && (
            <div className="space-y-3">
              <div className="text-xs text-slate-300 bg-[#050914] border border-[#1d2f5a] rounded p-3 font-mono leading-relaxed">
                <div className="text-[#f2b5d4] mb-1">Real-Time Contract (`ARCHITECTURE.md`):</div>
                <div>• `Engine::process()` stays lock-free &amp; allocation-free (`public/wasm/overlay-dsp.js`).</div>
                <div>• `loadWavetable(Float32Array(2048))` rebuilds all 11 FFT mip levels on the MessagePort event.</div>
                <div>• `COOP: same-origin` + `COEP: require-corp` unlocks the SPSC `SharedArrayBuffer` ring.</div>
              </div>
              <pre className="bg-[#040712] border border-[#1d2f5a] rounded p-3.5 text-[11px] font-mono text-[#5eead4] overflow-x-auto leading-relaxed">
                {hookupSnippet}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
