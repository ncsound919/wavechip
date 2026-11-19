import { SynthPatchState, TransportMode, WavetableData } from '../types/synth';

/**
 * Normalized parameter descriptor for JUCE AudioProcessorValueTreeState
 * and Emscripten AudioWorklet SharedArrayBuffer ring mapping.
 */
export interface VstParamDescriptor {
  id: string;
  label: string;
  group: 'Vector' | 'Fuse' | 'Wave' | 'Chip' | 'Silicon' | 'Drift' | 'FX';
  normalizedValue: number; // 0..1
  displayValue: string;
}

export interface M0ParamDescriptor {
  index: number;
  key:
    | 'masterGain'
    | 'tuneCents'
    | 'attackSeconds'
    | 'decaySeconds'
    | 'sustainLevel'
    | 'releaseSeconds'
    | 'filterCutoffHz'
    | 'driftAmount'
    | 'driftRate'
    | 'driftSpread'
    | 'driftWarmup'
    | 'driftAge';
  rangeLabel: string;
  defaultLabel: string;
  physicalValue: number;
  normalizedValue: number;
  displayValue: string;
}

export interface IVstBridge {
  readonly targetName: string;
  pushParam(paramId: string, normalizedValue: number): void;
  pushStateSnapshot(state: SynthPatchState): void;
  getLastMessage(): string;
}

export function isCrossOriginIsolated(): boolean {
  return typeof globalThis !== 'undefined' && Boolean((globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated);
}

/**
 * Linearly resamples a 64-pt UI preview curve into a 2048-sample single-cycle Float32Array
 * matching `VectorWavesEngine.loadWavetable(cycle2048)`.
 */
export function buildCycle2048(curve64: number[]): Float32Array {
  const out = new Float32Array(2048);
  const srcLen = Math.max(1, curve64.length);
  for (let i = 0; i < 2048; i++) {
    const pos = (i / 2048) * srcLen;
    const i0 = Math.floor(pos) % srcLen;
    const i1 = (i0 + 1) % srcLen;
    const frac = pos - Math.floor(pos);
    const v0 = curve64[i0] ?? 0;
    const v1 = curve64[i1] ?? 0;
    out[i] = Math.max(-1, Math.min(1, v0 + (v1 - v0) * frac));
  }
  return out;
}

/**
 * Default local UI bridge. Replace or wrap with:
 * 1) `VectorWavesEngine` (`AudioWorkletProcessor` + `public/wasm/overlay-dsp.js` via SAB ring / MessagePort)
 * 2) JUCE WebBrowserComponent native function (`window.__JUCE__.backend.emitEvent`)
 */
export class VstHostBridge implements IVstBridge {
  public readonly targetName: string;
  private lastMessage = 'Ready for VectorWavesEngine / JUCE binding';
  private transportMode: TransportMode = isCrossOriginIsolated() ? 'sab' : 'messageport';
  private listeners = new Set<(id: string, val: number) => void>();

  constructor(targetName = 'VectorWavesEngine / APVTS Bridge') {
    this.targetName = targetName;
  }

  public getTransportMode(): TransportMode {
    return this.transportMode;
  }

  public setTransportMode(mode: TransportMode): void {
    this.transportMode = mode;
    this.lastMessage =
      mode === 'sab'
        ? `Transport: SAB SPSC Ring (${isCrossOriginIsolated() ? 'COI OK' : 'COI fallback→Port'})`
        : 'Transport: MessagePort Fallback (forced)';
    this.listeners.forEach((cb) => cb('transport.mode', mode === 'sab' ? 1 : 0));
  }

  public pushParam(paramId: string, normalizedValue: number): void {
    const clamped = Math.max(0, Math.min(1, normalizedValue));
    const via = this.transportMode === 'sab' && isCrossOriginIsolated() ? 'SAB' : 'Port';
    this.lastMessage = `[${via}] ${paramId} = ${clamped.toFixed(4)}`;

    const win = window as unknown as {
      __JUCE__?: {
        backend?: {
          emitEvent?: (name: string, payload: unknown) => void;
          setParameter?: (id: string, value: number) => void;
        };
      };
      __VECTOR_WAVES_ENGINE__?: { setParameter?: (id: string, value: number) => void };
      vstHost?: { setParameter?: (id: string, value: number) => void };
    };

    if (win.__VECTOR_WAVES_ENGINE__?.setParameter) {
      win.__VECTOR_WAVES_ENGINE__.setParameter(paramId, clamped);
    }
    if (win.__JUCE__?.backend?.emitEvent) {
      win.__JUCE__.backend.emitEvent('setParameter', { id: paramId, value: clamped });
    } else if (win.__JUCE__?.backend?.setParameter) {
      win.__JUCE__.backend.setParameter(paramId, clamped);
    } else if (win.vstHost?.setParameter) {
      win.vstHost.setParameter(paramId, clamped);
    }

    this.listeners.forEach((cb) => cb(paramId, clamped));
  }

  public pushM0Param(
    key: M0ParamDescriptor['key'],
    physicalValue: number,
    normalizedValue: number
  ): void {
    const via = this.transportMode === 'sab' && isCrossOriginIsolated() ? 'SAB' : 'Port';
    this.lastMessage = `[${via}] M0.${key} = ${physicalValue.toFixed(3)}`;

    const win = window as unknown as {
      __VECTOR_WAVES_ENGINE__?: { setParameter?: (id: string, value: number) => void };
    };
    if (win.__VECTOR_WAVES_ENGINE__?.setParameter) {
      win.__VECTOR_WAVES_ENGINE__.setParameter(key, physicalValue);
    }

    this.pushParam(key, normalizedValue);
  }

  public pushWavetable2048(curve64: number[], frameIndex: number): void {
    const cycle = buildCycle2048(curve64);
    this.lastMessage = `[Port] loadWavetable(2048f32, frm=${frameIndex + 1}) → 11 FFT Mips`;

    const win = window as unknown as {
      __VECTOR_WAVES_ENGINE__?: { loadWavetable?: (cycle: Float32Array) => void };
      __JUCE__?: {
        backend?: {
          emitEvent?: (name: string, payload: unknown) => void;
          loadWavetable?: (frame: number[]) => void;
        };
      };
    };
    if (win.__VECTOR_WAVES_ENGINE__?.loadWavetable) {
      win.__VECTOR_WAVES_ENGINE__.loadWavetable(cycle);
    }
    if (win.__JUCE__?.backend?.emitEvent) {
      win.__JUCE__.backend.emitEvent('loadWavetable', { frame: Array.from(cycle) });
    } else if (win.__JUCE__?.backend?.loadWavetable) {
      win.__JUCE__.backend.loadWavetable(Array.from(cycle));
    }
    this.listeners.forEach((cb) => cb('wavetable.load2048', frameIndex));
  }

  public pushWaveRam(ram: number[]): void {
    const win = window as unknown as {
      __JUCE__?: {
        backend?: {
          emitEvent?: (name: string, payload: unknown) => void;
          setWaveRam?: (ram: number[]) => void;
        };
      };
    };
    if (win.__JUCE__?.backend?.emitEvent) {
      win.__JUCE__.backend.emitEvent('setWaveRam', { ram });
    } else if (win.__JUCE__?.backend?.setWaveRam) {
      win.__JUCE__.backend.setWaveRam(ram);
    }
    this.listeners.forEach((cb) => cb('chip.waveRam', ram.length));
  }

  public pushMidi(
    eventType: 'noteOn' | 'noteOff' | 'pitchBend' | 'modWheel',
    payload: { note?: number; velocity?: number; value?: number }
  ): void {
    const summary =
      eventType === 'noteOn' || eventType === 'noteOff'
        ? `${eventType}(note=${payload.note}, vel=${Math.round((payload.velocity ?? 0) * 127)})`
        : `${eventType}(${(payload.value ?? 0).toFixed(3)})`;
    this.lastMessage = `[Port] MIDI ${summary}`;

    const win = window as unknown as {
      __JUCE__?: { backend?: { emitEvent?: (name: string, payload: unknown) => void } };
      __VECTOR_WAVES_ENGINE__?: {
        noteOn?: (note: number, velocity: number) => void;
        noteOff?: () => void;
      };
    };
    if (eventType === 'noteOn' && payload.note !== undefined) {
      win.__VECTOR_WAVES_ENGINE__?.noteOn?.(payload.note, payload.velocity ?? 0.8);
    } else if (eventType === 'noteOff') {
      win.__VECTOR_WAVES_ENGINE__?.noteOff?.();
    }
    if (win.__JUCE__?.backend?.emitEvent) {
      win.__JUCE__.backend.emitEvent('midiEvent', { type: eventType, ...payload });
    }
    this.listeners.forEach((cb) => cb(`midi.${eventType}`, payload.velocity ?? payload.value ?? 0));
  }

  public pushStateSnapshot(state: SynthPatchState): void {
    this.lastMessage = `Snapshot synced (${state.patchName} · Seed #${state.drift.seed})`;
  }

  public getLastMessage(): string {
    return this.lastMessage;
  }

  public subscribe(cb: (id: string, val: number) => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }
}

export const vstBridge = new VstHostBridge();

/**
 * Exact 12-parameter inventory matching Vector Waves M0 `src/engine/parameters.ts`
 * and `native/include/vector_waves_dsp.h`.
 */
export function extractM0ParameterMap(state: SynthPatchState): M0ParamDescriptor[] {
  const { waveVoice, drift } = state;
  const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

  return [
    {
      index: 0,
      key: 'masterGain',
      rangeLabel: '0–1',
      defaultLabel: '0.25',
      physicalValue: state.masterGain,
      normalizedValue: clamp01(state.masterGain),
      displayValue: `${Math.round(state.masterGain * 100)}%`,
    },
    {
      index: 1,
      key: 'tuneCents',
      rangeLabel: '-24–24 ct',
      defaultLabel: '0 ct',
      physicalValue: waveVoice.tuneCents,
      normalizedValue: clamp01((waveVoice.tuneCents + 24) / 48),
      displayValue: `${waveVoice.tuneCents > 0 ? '+' : ''}${waveVoice.tuneCents.toFixed(1)} ct`,
    },
    {
      index: 2,
      key: 'attackSeconds',
      rangeLabel: '0.001–5 s',
      defaultLabel: '0.01 s',
      physicalValue: waveVoice.attackSeconds,
      normalizedValue: clamp01((waveVoice.attackSeconds - 0.001) / 4.999),
      displayValue:
        waveVoice.attackSeconds < 0.1
          ? `${Math.round(waveVoice.attackSeconds * 1000)} ms`
          : `${waveVoice.attackSeconds.toFixed(2)} s`,
    },
    {
      index: 3,
      key: 'decaySeconds',
      rangeLabel: '0.001–5 s',
      defaultLabel: '0.25 s',
      physicalValue: waveVoice.decaySeconds,
      normalizedValue: clamp01((waveVoice.decaySeconds - 0.001) / 4.999),
      displayValue:
        waveVoice.decaySeconds < 0.1
          ? `${Math.round(waveVoice.decaySeconds * 1000)} ms`
          : `${waveVoice.decaySeconds.toFixed(2)} s`,
    },
    {
      index: 4,
      key: 'sustainLevel',
      rangeLabel: '0–1',
      defaultLabel: '0.80',
      physicalValue: waveVoice.sustainLevel,
      normalizedValue: clamp01(waveVoice.sustainLevel),
      displayValue: `${Math.round(waveVoice.sustainLevel * 100)}%`,
    },
    {
      index: 5,
      key: 'releaseSeconds',
      rangeLabel: '0.001–10 s',
      defaultLabel: '0.25 s',
      physicalValue: waveVoice.releaseSeconds,
      normalizedValue: clamp01((waveVoice.releaseSeconds - 0.001) / 9.999),
      displayValue:
        waveVoice.releaseSeconds < 0.1
          ? `${Math.round(waveVoice.releaseSeconds * 1000)} ms`
          : `${waveVoice.releaseSeconds.toFixed(2)} s`,
    },
    {
      index: 6,
      key: 'filterCutoffHz',
      rangeLabel: '80–20,000 Hz',
      defaultLabel: '16,000 Hz',
      physicalValue: waveVoice.filterCutoffHz,
      normalizedValue: clamp01(Math.log(waveVoice.filterCutoffHz / 80) / Math.log(20000 / 80)),
      displayValue: `${Math.round(waveVoice.filterCutoffHz)} Hz`,
    },
    {
      index: 7,
      key: 'driftAmount',
      rangeLabel: '0–1',
      defaultLabel: '0.15',
      physicalValue: drift.amount,
      normalizedValue: clamp01(drift.amount),
      displayValue: `${Math.round(drift.amount * 100)}%`,
    },
    {
      index: 8,
      key: 'driftRate',
      rangeLabel: '0–1 (0.05–0.50 Hz)',
      defaultLabel: '0.35',
      physicalValue: drift.rate,
      normalizedValue: clamp01(drift.rate),
      displayValue: `${(0.05 + drift.rate * 0.45).toFixed(2)} Hz`,
    },
    {
      index: 9,
      key: 'driftSpread',
      rangeLabel: '0–1',
      defaultLabel: '0.15',
      physicalValue: drift.spread,
      normalizedValue: clamp01(drift.spread),
      displayValue: `${Math.round(drift.spread * 100)}%`,
    },
    {
      index: 10,
      key: 'driftWarmup',
      rangeLabel: '0–1 (15–180 s)',
      defaultLabel: '0.35',
      physicalValue: drift.warmup,
      normalizedValue: clamp01(drift.warmup),
      displayValue: `${Math.round(15 + drift.warmup * 165)}s`,
    },
    {
      index: 11,
      key: 'driftAge',
      rangeLabel: '0–1',
      defaultLabel: '0.10',
      physicalValue: drift.age,
      normalizedValue: clamp01(drift.age),
      displayValue: `${Math.round(drift.age * 100)}%`,
    },
  ];
}

/**
 * Flattens current patch state into deterministic 0..1 VST parameter descriptors
 * so the developer can verify exact APVTS / WASM bindings.
 */
export function extractParameterMap(state: SynthPatchState): VstParamDescriptor[] {
  const { chip, drift, fuse, fx, waveVoice } = state;
  return [
    { id: 'vector.x', label: 'Vector X (A↔C)', group: 'Vector', normalizedValue: state.vectorX, displayValue: `${Math.round(state.vectorX * 100)}%` },
    { id: 'vector.y', label: 'Vector Y (D↔B)', group: 'Vector', normalizedValue: state.vectorY, displayValue: `${Math.round(state.vectorY * 100)}%` },
    { id: 'vector.env_loop', label: 'Vector Env Loop', group: 'Vector', normalizedValue: state.vectorEnvLoop ? 1 : 0, displayValue: state.vectorEnvLoop ? 'ON' : 'OFF' },
    { id: 'wave.frame', label: 'Wave Scan Frame', group: 'Wave', normalizedValue: state.activeWaveFrame / Math.max(1, state.wavetable.frameCount - 1), displayValue: `${state.activeWaveFrame + 1}/${state.wavetable.frameCount}` },
    { id: 'wave.mips', label: '11-Level FFT Mips', group: 'Wave', normalizedValue: state.wavetable.mipsEnabled ? 1 : 0, displayValue: state.wavetable.mipsEnabled ? '11 MIP' : 'OFF' },
    { id: 'wave.tune_cents', label: 'Global Tune (cents)', group: 'Wave', normalizedValue: (waveVoice.tuneCents + 24) / 48, displayValue: `${waveVoice.tuneCents > 0 ? '+' : ''}${waveVoice.tuneCents.toFixed(1)} ct` },
    { id: 'wave.lpf_hz', label: '1-Pole LPF Cutoff', group: 'Wave', normalizedValue: Math.log(waveVoice.filterCutoffHz / 80) / Math.log(20000 / 80), displayValue: `${Math.round(waveVoice.filterCutoffHz)} Hz` },
    { id: 'wave.env.a', label: 'Wave Attack (s)', group: 'Wave', normalizedValue: (waveVoice.attackSeconds - 0.001) / 4.999, displayValue: `${waveVoice.attackSeconds.toFixed(3)} s` },
    { id: 'wave.env.d', label: 'Wave Decay (s)', group: 'Wave', normalizedValue: (waveVoice.decaySeconds - 0.001) / 4.999, displayValue: `${waveVoice.decaySeconds.toFixed(3)} s` },
    { id: 'wave.env.s', label: 'Wave Sustain', group: 'Wave', normalizedValue: waveVoice.sustainLevel, displayValue: `${Math.round(waveVoice.sustainLevel * 100)}%` },
    { id: 'wave.env.r', label: 'Wave Release (s)', group: 'Wave', normalizedValue: (waveVoice.releaseSeconds - 0.001) / 9.999, displayValue: `${waveVoice.releaseSeconds.toFixed(3)} s` },
    { id: 'fuse.chipify.on', label: 'Chipify Active', group: 'Fuse', normalizedValue: fuse.chipifyEnabled ? 1 : 0, displayValue: fuse.chipifyEnabled ? 'ON' : 'OFF' },
    { id: 'fuse.chipify.bits', label: 'Chipify DAC Bits', group: 'Fuse', normalizedValue: (fuse.chipifyBits - 4) / 12, displayValue: `${fuse.chipifyBits}-bit` },
    { id: 'fuse.chipify.alias', label: 'Clock Aliasing', group: 'Fuse', normalizedValue: fuse.chipifyAliasing, displayValue: `${Math.round(fuse.chipifyAliasing * 100)}%` },
    { id: 'fuse.c2w.amount', label: 'Chip→Wave Depth', group: 'Fuse', normalizedValue: fuse.chipToWaveAmount, displayValue: `${fuse.chipToWaveMode.toUpperCase()} ${Math.round(fuse.chipToWaveAmount * 100)}%` },
    { id: 'fuse.w2c.rate', label: 'Wave→Chip RAM Rate', group: 'Fuse', normalizedValue: fuse.waveToChipRate, displayValue: `${fuse.waveToChipMode} ${Math.round(fuse.waveToChipRate * 100)}%` },
    { id: 'chip.pw', label: 'Pulse Width', group: 'Chip', normalizedValue: chip.pulseWidth, displayValue: `${Math.round(chip.pulseWidth * 100)}%` },
    { id: 'chip.cutoff', label: 'Chip Filter Cutoff', group: 'Chip', normalizedValue: chip.cutoff, displayValue: `${Math.round(20 * Math.pow(1000, chip.cutoff))} Hz` },
    { id: 'chip.reso', label: 'Chip Resonance', group: 'Chip', normalizedValue: chip.resonance, displayValue: `${Math.round(chip.resonance * 100)}%` },
    { id: 'chip.env.a', label: 'Chip Attack', group: 'Chip', normalizedValue: chip.adsr.attack, displayValue: `${Math.round(chip.adsr.attack * 100)}%` },
    { id: 'chip.env.d', label: 'Chip Decay', group: 'Chip', normalizedValue: chip.adsr.decay, displayValue: `${Math.round(chip.adsr.decay * 100)}%` },
    { id: 'chip.env.s', label: 'Chip Sustain', group: 'Chip', normalizedValue: chip.adsr.sustain, displayValue: `${Math.round(chip.adsr.sustain * 100)}%` },
    { id: 'chip.env.r', label: 'Chip Release', group: 'Chip', normalizedValue: chip.adsr.release, displayValue: `${Math.round(chip.adsr.release * 100)}%` },
    { id: 'silicon.filter_curve', label: 'reSIDfp Filter Curve', group: 'Silicon', normalizedValue: chip.filterCurve, displayValue: `${Math.round(chip.filterCurve * 100)}%` },
    { id: 'silicon.filter_bias', label: 'reSIDfp Filter Bias', group: 'Silicon', normalizedValue: (chip.filterBias + 1) / 2, displayValue: `${chip.filterBias >= 0 ? '+' : ''}${(chip.filterBias * 100).toFixed(0)}%` },
    { id: 'silicon.dac_bits', label: 'Chip DAC Depth', group: 'Silicon', normalizedValue: (chip.dacBits - 4) / 8, displayValue: `${chip.dacBits}-bit` },
    { id: 'drift.amount', label: 'Drift Amount', group: 'Drift', normalizedValue: drift.amount, displayValue: `${Math.round(drift.amount * 100)}%` },
    { id: 'drift.rate', label: 'Drift Rate', group: 'Drift', normalizedValue: drift.rate, displayValue: `${(0.05 + drift.rate * 0.45).toFixed(2)} Hz` },
    { id: 'drift.spread', label: 'Voice Spread', group: 'Drift', normalizedValue: drift.spread, displayValue: `${Math.round(drift.spread * 100)}%` },
    { id: 'drift.warmup', label: 'Warm-up Curve', group: 'Drift', normalizedValue: drift.warmup, displayValue: `${Math.round(15 + drift.warmup * 165)}s` },
    { id: 'drift.age', label: 'Component Age', group: 'Drift', normalizedValue: drift.age, displayValue: `${Math.round(drift.age * 100)}%` },
    { id: 'drift.temp_corr', label: 'Temp Correlation', group: 'Drift', normalizedValue: drift.tempCorrelation, displayValue: `${Math.round(drift.tempCorrelation * 100)}%` },
    { id: 'fx.analog_sat', label: 'Analog Stage Sat', group: 'FX', normalizedValue: fx.analogStageSat, displayValue: `${Math.round(fx.analogStageSat * 100)}%` },
    { id: 'fx.chorus_mix', label: 'BBD Chorus Mix', group: 'FX', normalizedValue: fx.chorusMix, displayValue: `${Math.round(fx.chorusMix * 100)}%` },
    { id: 'fx.delay_mix', label: 'Tape Delay Mix', group: 'FX', normalizedValue: fx.delayMix, displayValue: `${Math.round(fx.delayMix * 100)}%` },
    { id: 'fx.reverb_mix', label: 'Plate Reverb Mix', group: 'FX', normalizedValue: fx.reverbMix, displayValue: `${Math.round(fx.reverbMix * 100)}%` },
  ];
}

/**
 * Lightweight browser WAV header & Serum `clm ` chunk parser for the Wavetable Importer UI.
 * Reads sample frames and slices/resamples into 64-pt UI preview + 32x4-bit chipified RAM.
 */
export async function parseWavToWavetable(
  file: File,
  fallbackFrameSize: 64 | 128 | 256 | 512 | 1024 | 2048
): Promise<WavetableData> {
  const buffer = await file.arrayBuffer();
  const view = new DataView(buffer);

  let detectedFrameSize: number | null = null;
  let audioFormat = 1;
  let numChannels = 1;
  let bitsPerSample = 16;
  let dataOffset = 44;
  let dataByteLength = Math.max(0, buffer.byteLength - 44);

  const readFourCC = (offset: number) =>
    String.fromCharCode(
      view.getUint8(offset),
      view.getUint8(offset + 1),
      view.getUint8(offset + 2),
      view.getUint8(offset + 3)
    );

  if (buffer.byteLength >= 44 && readFourCC(0) === 'RIFF' && readFourCC(8) === 'WAVE') {
    let offset = 12;
    while (offset + 8 <= buffer.byteLength) {
      const chunkId = readFourCC(offset);
      const chunkSize = view.getUint32(offset + 4, true);
      const payloadOffset = offset + 8;

      if (chunkId === 'fmt ' && payloadOffset + 16 <= buffer.byteLength) {
        audioFormat = view.getUint16(payloadOffset, true);
        numChannels = Math.max(1, view.getUint16(payloadOffset + 2, true));
        bitsPerSample = view.getUint16(payloadOffset + 14, true);
      } else if (chunkId === 'clm ' && payloadOffset + 10 <= buffer.byteLength) {
        // Serum wavetable chunk e.g. "<!>2048 ..."
        let text = '';
        for (let i = 0; i < Math.min(chunkSize, 32); i++) {
          text += String.fromCharCode(view.getUint8(payloadOffset + i));
        }
        const match = text.match(/(\d{2,4})/);
        if (match) {
          const parsed = Number(match[1]);
          if ([64, 128, 256, 512, 1024, 2048].includes(parsed)) {
            detectedFrameSize = parsed;
          }
        }
      } else if (chunkId === 'data') {
        dataOffset = payloadOffset;
        dataByteLength = Math.min(chunkSize, buffer.byteLength - payloadOffset);
      }

      offset = payloadOffset + chunkSize + (chunkSize % 2);
    }
  }

  const effectiveFrameSize = (detectedFrameSize ?? fallbackFrameSize) as 64 | 128 | 256 | 512 | 1024 | 2048;
  const bytesPerSample = Math.max(1, Math.floor(bitsPerSample / 8));
  const totalMonoSamples = Math.floor(dataByteLength / (bytesPerSample * numChannels));

  const monoSamples = new Float32Array(Math.min(totalMonoSamples, effectiveFrameSize * 256));
  for (let i = 0; i < monoSamples.length; i++) {
    const byteIdx = dataOffset + i * bytesPerSample * numChannels;
    if (byteIdx + bytesPerSample > buffer.byteLength) break;
    if (audioFormat === 3 && bitsPerSample === 32) {
      monoSamples[i] = Math.max(-1, Math.min(1, view.getFloat32(byteIdx, true)));
    } else if (bitsPerSample === 24) {
      const b0 = view.getUint8(byteIdx);
      const b1 = view.getUint8(byteIdx + 1);
      const b2 = view.getInt8(byteIdx + 2);
      const val = (b2 << 16) | (b1 << 8) | b0;
      monoSamples[i] = val / 8388608;
    } else if (bitsPerSample === 16) {
      monoSamples[i] = view.getInt16(byteIdx, true) / 32768;
    } else {
      monoSamples[i] = (view.getUint8(byteIdx) - 128) / 128;
    }
  }

  const rawFrameCount = Math.max(1, Math.min(64, Math.floor(monoSamples.length / effectiveFrameSize)));
  const framesPreview: number[][] = [];
  const chipifiedFrames: number[][] = [];

  for (let f = 0; f < rawFrameCount; f++) {
    const start = f * effectiveFrameSize;
    const preview: number[] = [];
    for (let p = 0; p < 64; p++) {
      const srcIdx = start + Math.floor((p / 64) * effectiveFrameSize);
      preview.push(monoSamples[srcIdx] ?? 0);
    }
    const chipified: number[] = [];
    for (let c = 0; c < 32; c++) {
      const srcIdx = start + Math.floor((c / 32) * effectiveFrameSize);
      const s = monoSamples[srcIdx] ?? 0;
      chipified.push(Math.max(0, Math.min(15, Math.round(((s + 1) * 0.5) * 15))));
    }
    framesPreview.push(preview);
    chipifiedFrames.push(chipified);
  }

  return {
    name: file.name.replace(/\.wav$/i, ''),
    frameSize: effectiveFrameSize,
    frameCount: rawFrameCount,
    headerDetected: detectedFrameSize !== null,
    mipsEnabled: true,
    framesPreview,
    chipifiedFrames,
  };
}
