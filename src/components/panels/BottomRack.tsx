import React, { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { DriftState, FxState, MilestoneScope, ModSlot, SynthPatchState } from '../../types/synth';
import { generateSeededSlots } from '../../data/presets';
import { RotaryKnob } from '../controls/RotaryKnob';
import { MiniSlider } from '../controls/MiniSlider';
import { SegmentedToggle } from '../controls/SegmentedToggle';

interface BottomRackProps {
  state: SynthPatchState;
  milestoneScope: MilestoneScope;
  onUpdateDrift: (patch: Partial<DriftState>) => void;
  onUpdateModSlot: (id: number, patch: Partial<ModSlot>) => void;
  onUpdateFx: (patch: Partial<FxState>) => void;
  onMasterGainChange: (val: number) => void;
}

export const BottomRack: React.FC<BottomRackProps> = ({
  state,
  milestoneScope,
  onUpdateDrift,
  onUpdateModSlot,
  onUpdateFx,
  onMasterGainChange,
}) => {
  const [activeTab, setActiveTab] = useState<'drift' | 'mod' | 'fx'>('drift');
  const [wanderPhase, setWanderPhase] = useState(0);

  const { drift, modMatrix, fx } = state;

  useEffect(() => {
    if (milestoneScope === 'm0') {
      setActiveTab('drift');
    }
  }, [milestoneScope]);

  useEffect(() => {
    if (activeTab !== 'drift') return;
    const interval = setInterval(() => {
      setWanderPhase((prev) => prev + 0.08 * (0.2 + drift.rate * 1.4));
    }, 60);
    return () => clearInterval(interval);
  }, [activeTab, drift.rate]);

  const handleReseed = () => {
    const nextSeed = Math.floor(1000 + Math.random() * 8999);
    onUpdateDrift({
      seed: nextSeed,
      slots: generateSeededSlots(nextSeed, drift.spread),
    });
  };

  return (
    <section className="oldschool-panel relative border border-[#243b73] rounded-md overflow-hidden">
      <div className="h-[2px] w-full bg-gradient-to-r from-[#2dd4bf]/35 via-[#d98cb3]/85 to-[#39ff14]/35" />

      <div className="hw-card-header flex flex-wrap items-center justify-between gap-3 px-3 py-2 border-b border-[#1d2f5a]">
        <div className="flex items-center gap-2.5">
          <span className="hw-screw shrink-0" aria-hidden="true" />
          <SegmentedToggle
            compact
            accent="mauve"
            value={activeTab}
            onChange={setActiveTab}
            options={[
              { value: 'drift', label: '80s Drift' },
              { value: 'mod', label: 'Mod Matrix' },
              { value: 'fx', label: 'Output & FX' },
            ]}
          />
          <span className="hidden md:inline text-[11px] font-mono text-[#5eead4]">
            {activeTab === 'drift' &&
              `SEED #${drift.seed} · ${(0.05 + drift.rate * 0.45).toFixed(2)} Hz · ${Math.round(15 + drift.warmup * 165)}s WARMUP`}
            {activeTab === 'mod' &&
              `${modMatrix.filter((m) => m.enabled).length} / ${modMatrix.length} ROUTES${milestoneScope === 'm0' ? ' (M1+)' : ''}`}
            {activeTab === 'fx' &&
              `ANALOG STAGE · BBD CHORUS · TAPE DELAY · PLATE${milestoneScope === 'm0' ? ' (M1+)' : ''}`}
          </span>
        </div>

        <div className="flex items-center gap-3">
          <div className="w-40">
            <MiniSlider
              label="MASTER"
              accent="teal"
              value={state.masterGain}
              defaultValue={0.82}
              onChange={onMasterGainChange}
              paramId="masterGain"
            />
          </div>
          <span className="hw-screw shrink-0" aria-hidden="true" />
        </div>
      </div>

      <div className="px-3.5 py-3">
        {activeTab === 'drift' && (
          <div className="flex flex-col lg:flex-row items-center justify-between gap-4">
            <div className="flex flex-wrap items-center justify-around gap-4 shrink-0">
              <RotaryKnob
                label="Amount"
                size="sm"
                accent="mauve"
                value={drift.amount}
                defaultValue={0.4}
                onChange={(v) => onUpdateDrift({ amount: v })}
                paramId="drift.amount"
              />
              <RotaryKnob
                label="Rate"
                size="sm"
                accent="teal"
                value={drift.rate}
                defaultValue={0.35}
                onChange={(v) => onUpdateDrift({ rate: v })}
                paramId="drift.rate"
                formatValue={(v) => `${(0.05 + v * 0.45).toFixed(2)}Hz`}
              />
              <RotaryKnob
                label="Spread"
                size="sm"
                accent="neon"
                value={drift.spread}
                defaultValue={0.5}
                onChange={(v) =>
                  onUpdateDrift({
                    spread: v,
                    slots: generateSeededSlots(drift.seed, v),
                  })
                }
              />
              <RotaryKnob
                label="Warm-up"
                size="sm"
                accent="mauve"
                value={drift.warmup}
                defaultValue={0.35}
                onChange={(v) => onUpdateDrift({ warmup: v })}
                paramId="drift.warmup"
                formatValue={(v) => `${Math.round(15 + v * 165)}s`}
              />
              <RotaryKnob
                label="Age"
                size="sm"
                accent="teal"
                value={drift.age}
                defaultValue={0.45}
                onChange={(v) => onUpdateDrift({ age: v })}
                paramId="drift.age"
              />
            </div>

            <div className="hidden lg:block w-px h-14 bg-[#1d2f5a]" />

            <div className="flex-1 w-full flex flex-col sm:flex-row items-center gap-3">
              <div className="hw-subcard rounded-[4px] p-2.5 w-full sm:w-52 flex flex-col gap-2 shrink-0">
                <div className={milestoneScope === 'm0' ? 'opacity-45' : ''}>
                  <MiniSlider
                    label={milestoneScope === 'm0' ? 'TEMP CORR (M1)' : 'TEMP CORR'}
                    accent="mauve"
                    value={drift.tempCorrelation}
                    defaultValue={0.6}
                    onChange={(v) => onUpdateDrift({ tempCorrelation: v })}
                    paramId="drift.temp_corr"
                  />
                </div>
                <div className="flex items-center gap-1.5">
                  <label className="hw-select inline-flex items-center gap-1 rounded-[3px] px-1.5 py-1 text-[10px] font-mono text-slate-300 shrink-0">
                    <span className="text-slate-500">#</span>
                    <input
                      type="number"
                      aria-label="Deterministic drift seed"
                      value={drift.seed}
                      onChange={(e) => {
                        const s = Math.max(1, Math.floor(Number(e.target.value) || 1));
                        onUpdateDrift({
                          seed: s,
                          slots: generateSeededSlots(s, drift.spread),
                        });
                      }}
                      className="w-12 bg-transparent text-[#5eead4] tabular-nums focus:outline-none"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={handleReseed}
                    className="hw-btn flex-1 inline-flex items-center justify-center gap-1.5 px-2 py-1 rounded-[3px] text-[10px] font-mono text-[#f2b5d4] cursor-pointer"
                  >
                    <RefreshCw className="w-2.5 h-2.5 text-[#5eead4]" />
                    <span>RE-SEED</span>
                  </button>
                </div>
              </div>

              <div className="flex-1 w-full grid grid-cols-8 gap-1.5">
                {drift.slots.map((slot, idx) => {
                  const isM0ActiveSlot = milestoneScope === 'm0' ? idx === 0 : true;
                  const sharedTemp = Math.sin(wanderPhase) * drift.tempCorrelation * drift.amount * 8;
                  const indivWander =
                    Math.sin(wanderPhase * (0.7 + idx * 0.19) + idx * 1.4) *
                    (1 - drift.tempCorrelation * 0.5) *
                    drift.amount *
                    10;
                  const liveCents =
                    slot.pitchCents * (0.3 + drift.age * 0.7) + sharedTemp + indivWander;
                  const barPct = Math.max(-100, Math.min(100, (liveCents / 24) * 100));

                  return (
                    <div
                      key={slot.slot}
                      className={`hw-subcard flex flex-col items-center gap-0.5 rounded-[4px] py-1 px-1 transition-opacity ${
                        isM0ActiveSlot
                          ? milestoneScope === 'm0'
                            ? 'border-[#39ff14]/70'
                            : ''
                          : 'opacity-30'
                      }`}
                    >
                      <span
                        className={`text-[8px] font-mono ${
                          milestoneScope === 'm0' && idx === 0 ? 'text-[#74ff57]' : 'text-slate-500'
                        }`}
                      >
                        {milestoneScope === 'm0' && idx === 0 ? 'V1·M0' : `V${slot.slot}`}
                      </span>
                      <div className="relative w-full h-5 bg-[#040712] border border-[#172852] rounded-[2px] overflow-hidden">
                        <div className="absolute inset-x-0 top-1/2 h-px bg-[#263b6e]" />
                        <div
                          className={`absolute inset-x-1 rounded-[1px] ${
                            barPct >= 0
                              ? 'bg-[#39ff14]/90 shadow-[0_0_5px_rgba(57,255,20,0.6)]'
                              : 'bg-[#d98cb3]/90 shadow-[0_0_5px_rgba(217,140,179,0.6)]'
                          }`}
                          style={{
                            bottom: barPct >= 0 ? '50%' : `${50 + barPct * 0.5}%`,
                            top: barPct >= 0 ? `${50 - barPct * 0.5}%` : '50%',
                          }}
                        />
                      </div>
                      <span className="text-[10px] font-mono tabular-nums text-slate-200">
                        {liveCents >= 0 ? '+' : ''}
                        {liveCents.toFixed(0)}c
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'mod' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
            {modMatrix.map((slot) => (
              <div
                key={slot.id}
                className={`hw-subcard flex items-center gap-1.5 px-2.5 py-1.5 rounded-[4px] text-[11px] transition-opacity ${
                  slot.enabled ? 'border-[#2d4a8a]' : 'opacity-55'
                }`}
              >
                <button
                  type="button"
                  onClick={() => onUpdateModSlot(slot.id, { enabled: !slot.enabled })}
                  className={`w-6 h-5 rounded-[3px] text-[10px] font-mono cursor-pointer shrink-0 ${
                    slot.enabled ? 'hw-btn-mauve-on' : 'hw-btn text-slate-400'
                  }`}
                >
                  {slot.id}
                </button>

                <select
                  aria-label={`Mod slot ${slot.id} source`}
                  value={slot.source}
                  onChange={(e) =>
                    onUpdateModSlot(slot.id, { source: e.target.value as ModSlot['source'] })
                  }
                  className="hw-select rounded-[3px] px-1.5 py-0.5 text-[#5eead4] font-mono text-[10px]"
                >
                  {['Vec Env', 'Wave Seq', 'Drift', 'SID Env3', 'LFO 1', 'Velocity'].map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>

                <span className="text-[#f2b5d4] text-[10px]">→</span>

                <select
                  aria-label={`Mod slot ${slot.id} destination`}
                  value={slot.destination}
                  onChange={(e) =>
                    onUpdateModSlot(slot.id, {
                      destination: e.target.value as ModSlot['destination'],
                    })
                  }
                  className="hw-select rounded-[3px] px-1.5 py-0.5 text-[#74ff57] font-mono text-[10px]"
                >
                  {[
                    'Cutoff',
                    'Vec X',
                    'Vec Y',
                    'Chip Bias',
                    'Wave Frame',
                    'Chip->Wave',
                    'Pitch',
                  ].map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>

                <div className="flex-1 min-w-[54px]">
                  <MiniSlider
                    label={`Mod slot ${slot.id} depth`}
                    hideHeader
                    compact
                    bipolar
                    accent="mauve"
                    min={-1}
                    max={1}
                    step={0.02}
                    value={slot.amount}
                    defaultValue={0}
                    onChange={(v) => onUpdateModSlot(slot.id, { amount: v })}
                  />
                </div>
                <span className="font-mono tabular-nums text-[10px] text-slate-200 w-8 text-right">
                  {slot.amount >= 0 ? '+' : ''}
                  {Math.round(slot.amount * 100)}
                </span>
              </div>
            ))}
          </div>
        )}

        {activeTab === 'fx' && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
            <div className="hw-subcard rounded-[4px] px-3 py-2 flex flex-col gap-1.5">
              <span className="text-[9px] font-mono tracking-widest uppercase text-[#74ff57]/80 text-center">
                Analog Stage
              </span>
              <div className="flex items-center justify-around gap-3">
                <RotaryKnob
                  label="Chip Drive"
                  size="sm"
                  accent="neon"
                  value={fx.analogStageSat}
                  defaultValue={0.3}
                  onChange={(v) => onUpdateFx({ analogStageSat: v })}
                  paramId="fx.analog_sat"
                />
                <RotaryKnob
                  label="Post LPF"
                  size="sm"
                  accent="neon"
                  value={fx.analogStageLpf}
                  defaultValue={0.8}
                  onChange={(v) => onUpdateFx({ analogStageLpf: v })}
                  paramId="analogLpf"
                  formatValue={(v) => `${Math.round(2000 + v * 16000)}Hz`}
                />
              </div>
            </div>
            <div className="hw-subcard rounded-[4px] px-3 py-2 flex flex-col gap-1.5">
              <span className="text-[9px] font-mono tracking-widest uppercase text-[#5eead4]/80 text-center">
                BBD Chorus
              </span>
              <div className="flex items-center justify-around gap-3">
                <RotaryKnob
                  label="Chorus Mix"
                  size="sm"
                  accent="teal"
                  value={fx.chorusMix}
                  defaultValue={0.4}
                  onChange={(v) => onUpdateFx({ chorusMix: v })}
                  paramId="fx.chorus_mix"
                />
                <RotaryKnob
                  label="Chorus Rate"
                  size="sm"
                  accent="teal"
                  value={fx.chorusRate}
                  defaultValue={0.35}
                  onChange={(v) => onUpdateFx({ chorusRate: v })}
                  paramId="chorusRate"
                />
              </div>
            </div>
            <div className="hw-subcard rounded-[4px] px-3 py-2 flex flex-col gap-1.5">
              <span className="text-[9px] font-mono tracking-widest uppercase text-[#f2b5d4]/80 text-center">
                Tape Delay &amp; Plate
              </span>
              <div className="flex items-center justify-around gap-2">
                <RotaryKnob
                  label="Delay Mix"
                  size="sm"
                  accent="mauve"
                  value={fx.delayMix}
                  defaultValue={0.25}
                  onChange={(v) => onUpdateFx({ delayMix: v })}
                  paramId="fx.delay_mix"
                />
                <RotaryKnob
                  label="Delay Time"
                  size="sm"
                  accent="mauve"
                  value={fx.delayTime}
                  defaultValue={0.42}
                  onChange={(v) => onUpdateFx({ delayTime: v })}
                  paramId="delayTime"
                  formatValue={(v) => `${Math.round(60 + v * 740)}ms`}
                />
                <RotaryKnob
                  label="Reverb"
                  size="sm"
                  accent="teal"
                  value={fx.reverbMix}
                  defaultValue={0.32}
                  onChange={(v) => onUpdateFx({ reverbMix: v })}
                  paramId="fx.reverb_mix"
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
};
