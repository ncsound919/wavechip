import {
  ChipState,
  CpuTier,
  DriftState,
  FuseState,
  FxState,
  LaneId,
  ModSlot,
  StepOrderMode,
  SynthPatchState,
  VoiceSlotOffset,
  WaveLane,
  WavetableData,
} from '../types/synth';

function buildProceduralWavetable(
  name: string,
  kind: 'glass_harmonics' | 'pwm_fold' | 'formant_sweep' | 'digital_bell'
): WavetableData {
  const frameCount = 16;
  const framesPreview: number[][] = [];
  const chipifiedFrames: number[][] = [];

  for (let f = 0; f < frameCount; f++) {
    const morph = f / (frameCount - 1);
    const preview: number[] = [];
    for (let i = 0; i < 64; i++) {
      const phase = (i / 64) * Math.PI * 2;
      let sample = 0;
      if (kind === 'glass_harmonics') {
        sample =
          Math.sin(phase) * (1 - morph * 0.3) +
          Math.sin(phase * 2) * (0.4 * morph) +
          Math.sin(phase * 3) * (0.35 * Math.sin(morph * Math.PI)) +
          Math.sin(phase * 5) * (0.28 * morph) +
          Math.sin(phase * 8) * (0.18 * morph * morph);
      } else if (kind === 'pwm_fold') {
        const duty = 0.15 + morph * 0.7;
        const raw = i / 64 < duty ? 0.75 : -0.75;
        sample = Math.tanh(raw * (1 + morph * 2.2) + Math.sin(phase * 2) * 0.35);
      } else if (kind === 'formant_sweep') {
        const f1 = 2 + Math.round(morph * 6);
        sample =
          0.55 * Math.sin(phase) +
          0.4 * Math.sin(phase * f1) * Math.exp(-Math.abs(Math.sin(phase * 0.5)) * 0.4) +
          0.2 * Math.sin(phase * (f1 + 2));
      } else {
        sample =
          0.6 * Math.sin(phase + Math.sin(phase * 3) * (0.5 + morph * 1.4)) +
          0.25 * Math.sin(phase * 7) * morph;
      }
      preview.push(Math.max(-1, Math.min(1, sample * 0.85)));
    }

    const chipified: number[] = [];
    for (let c = 0; c < 32; c++) {
      const s = preview[c * 2];
      chipified.push(Math.max(0, Math.min(15, Math.round(((s + 1) * 0.5) * 15))));
    }

    framesPreview.push(preview);
    chipifiedFrames.push(chipified);
  }

  return {
    name,
    frameSize: 2048,
    frameCount,
    headerDetected: true,
    mipsEnabled: true,
    framesPreview,
    chipifiedFrames,
  };
}

export function generateSeededSlots(seed: number, spread: number): VoiceSlotOffset[] {
  const slots: VoiceSlotOffset[] = [];
  for (let i = 0; i < 8; i++) {
    // Deterministic Mulberry32-style hash per slot
    let t = (seed + i * 0x6d2b79f5) | 0;
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    const r1 = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    const r2 = (((t * 1664525 + 1013904223) >>> 0) / 4294967296);
    const r3 = (((t * 22695477 + 1) >>> 0) / 4294967296);

    const scale = 0.25 + spread * 0.75;
    slots.push({
      slot: i + 1,
      pitchCents: Number((((r1 * 2 - 1) * 16) * scale).toFixed(1)),
      cutoffPct: Number((((r2 * 2 - 1) * 14) * scale).toFixed(1)),
      envPct: Number((((r3 * 2 - 1) * 12) * scale).toFixed(1)),
    });
  }
  return slots;
}

const ROM_A_PRESETS: SynthPatchState[] = [
  {
    patchName: '80s Glass Vector',
    bankLabel: 'ROM-A 01',
    cpuTier: 'hq',
    vectorX: 0.38,
    vectorY: 0.66,
    vectorEnvLoop: true,
    vectorEnvStages: [
      { id: 1, x: 0.18, y: 0.85, durationMs: 420 },
      { id: 2, x: 0.72, y: 0.68, durationMs: 680 },
      { id: 3, x: 0.64, y: 0.22, durationMs: 540 },
      { id: 4, x: 0.28, y: 0.45, durationMs: 820 },
    ],
    activeWaveFrame: 4,
    wavetable: buildProceduralWavetable('PPG Glass Sweep', 'glass_harmonics'),
    waveVoice: {
      tuneCents: 0,
      filterCutoffHz: 16000,
      attackSeconds: 0.015,
      decaySeconds: 0.35,
      sustainLevel: 0.78,
      releaseSeconds: 0.42,
    },
    lanes: {
      timing: {
        id: 'timing',
        label: 'Timing',
        unit: 'ms',
        length: 8,
        loopStart: 0,
        loopEnd: 7,
        order: 'forward',
        skipProb: 8,
        activeStep: 2,
        steps: [0.32, 0.32, 0.64, 0.32, 0.48, 0.24, 0.64, 0.48, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5],
      },
      sample: {
        id: 'sample',
        label: 'Sample',
        unit: 'frm',
        length: 12,
        loopStart: 1,
        loopEnd: 10,
        order: 'pendulum',
        skipProb: 12,
        activeStep: 4,
        steps: [0.06, 0.18, 0.31, 0.45, 0.62, 0.78, 0.92, 0.84, 0.68, 0.52, 0.35, 0.15, 0.5, 0.5, 0.5, 0.5],
      },
      pitch: {
        id: 'pitch',
        label: 'Melody',
        unit: 'st',
        length: 6,
        loopStart: 0,
        loopEnd: 5,
        order: 'forward',
        skipProb: 0,
        activeStep: 1,
        steps: [0.5, 0.5, 0.65, 0.5, 0.79, 0.65, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5],
      },
      level: {
        id: 'level',
        label: 'Level / XF',
        unit: '%',
        length: 8,
        loopStart: 0,
        loopEnd: 7,
        order: 'forward',
        skipProb: 5,
        activeStep: 2,
        steps: [0.92, 0.78, 0.85, 0.62, 0.95, 0.72, 0.88, 0.68, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8],
      },
    },
    fuse: {
      chipifyEnabled: true,
      chipifyBits: 8,
      chipifyAliasing: 0.28,
      chipToWaveMode: 'fm',
      chipToWaveAmount: 0.24,
      waveToChipMode: 'drive_ram',
      waveToChipRate: 0.65,
    },
    chip: {
      family: 'sid',
      variant: '6581',
      rackInstances: 3,
      authenticTuning: true,
      waveBits: { tri: false, saw: true, pulse: true, noise: false },
      pulseWidth: 0.38,
      adsr: { attack: 0.08, decay: 0.48, sustain: 0.64, release: 0.52 },
      filterMode: 'LP',
      cutoff: 0.62,
      resonance: 0.44,
      fmAlgo: 2,
      fmFeedback: 4,
      filterCurve: 0.42,
      filterBias: -0.18,
      clock: 'PAL',
      dacBits: 8,
      noiseLfsr: '23-bit',
      waveRamLength: 32,
      waveRam: [8, 10, 13, 15, 14, 12, 11, 13, 15, 14, 10, 7, 5, 4, 6, 8, 9, 11, 10, 7, 4, 2, 1, 2, 4, 5, 4, 2, 1, 2, 4, 6],
    },
    drift: {
      amount: 0.42,
      rate: 0.34,
      spread: 0.58,
      warmup: 0.35,
      age: 0.48,
      tempCorrelation: 0.62,
      seed: 1984,
      slots: generateSeededSlots(1984, 0.58),
    },
    modMatrix: [
      { id: 1, enabled: true, source: 'Vec Env', destination: 'Wave Frame', amount: 0.45, curve: 'Linear' },
      { id: 2, enabled: true, source: 'Drift', destination: 'Chip Bias', amount: -0.28, curve: 'Linear' },
      { id: 3, enabled: true, source: 'SID Env3', destination: 'Cutoff', amount: 0.52, curve: 'Exp' },
      { id: 4, enabled: false, source: 'Wave Seq', destination: 'Chip->Wave', amount: 0.32, curve: 'Step' },
      { id: 5, enabled: true, source: 'Velocity', destination: 'Cutoff', amount: 0.38, curve: 'Linear' },
      { id: 6, enabled: false, source: 'LFO 1', destination: 'Vec X', amount: 0.2, curve: 'Linear' },
    ],
    fx: {
      analogStageSat: 0.32,
      analogStageLpf: 0.78,
      chorusMix: 0.48,
      chorusRate: 0.35,
      delayMix: 0.28,
      delayTime: 0.42,
      reverbMix: 0.36,
    },
    masterGain: 0.82,
  },
  {
    patchName: 'SID Wave-RAM Drive',
    bankLabel: 'ROM-A 02',
    cpuTier: 'eco',
    vectorX: 0.62,
    vectorY: 0.44,
    vectorEnvLoop: true,
    vectorEnvStages: [
      { id: 1, x: 0.25, y: 0.3, durationMs: 240 },
      { id: 2, x: 0.82, y: 0.72, durationMs: 360 },
      { id: 3, x: 0.75, y: 0.25, durationMs: 280 },
      { id: 4, x: 0.35, y: 0.6, durationMs: 410 },
    ],
    activeWaveFrame: 7,
    wavetable: buildProceduralWavetable('PWM Fold Matrix', 'pwm_fold'),
    waveVoice: {
      tuneCents: -4,
      filterCutoffHz: 11200,
      attackSeconds: 0.005,
      decaySeconds: 0.24,
      sustainLevel: 0.55,
      releaseSeconds: 0.22,
    },
    lanes: {
      timing: {
        id: 'timing',
        label: 'Timing',
        unit: 'ms',
        length: 8,
        loopStart: 0,
        loopEnd: 7,
        order: 'forward',
        skipProb: 15,
        activeStep: 5,
        steps: [0.22, 0.22, 0.44, 0.22, 0.22, 0.44, 0.22, 0.66, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3],
      },
      sample: {
        id: 'sample',
        label: 'Sample',
        unit: 'frm',
        length: 8,
        loopStart: 0,
        loopEnd: 7,
        order: 'random',
        skipProb: 10,
        activeStep: 3,
        steps: [0.12, 0.38, 0.64, 0.9, 0.24, 0.52, 0.78, 0.42, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5],
      },
      pitch: {
        id: 'pitch',
        label: 'Melody',
        unit: 'st',
        length: 8,
        loopStart: 0,
        loopEnd: 7,
        order: 'forward',
        skipProb: 0,
        activeStep: 5,
        steps: [0.5, 0.5, 0.62, 0.5, 0.38, 0.5, 0.75, 0.62, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5],
      },
      level: {
        id: 'level',
        label: 'Level / XF',
        unit: '%',
        length: 8,
        loopStart: 0,
        loopEnd: 7,
        order: 'forward',
        skipProb: 0,
        activeStep: 5,
        steps: [0.95, 0.75, 0.9, 0.68, 0.95, 0.8, 0.88, 0.55, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8],
      },
    },
    fuse: {
      chipifyEnabled: true,
      chipifyBits: 4,
      chipifyAliasing: 0.64,
      chipToWaveMode: 'ring',
      chipToWaveAmount: 0.48,
      waveToChipMode: 'sync_frame',
      waveToChipRate: 0.85,
    },
    chip: {
      family: 'wavetable',
      variant: 'N163',
      rackInstances: 4,
      authenticTuning: true,
      waveBits: { tri: false, saw: true, pulse: false, noise: false },
      pulseWidth: 0.5,
      adsr: { attack: 0.02, decay: 0.34, sustain: 0.42, release: 0.28 },
      filterMode: 'LP',
      cutoff: 0.74,
      resonance: 0.36,
      fmAlgo: 4,
      fmFeedback: 5,
      filterCurve: 0.6,
      filterBias: 0.12,
      clock: 'NTSC',
      dacBits: 4,
      noiseLfsr: '15-bit',
      waveRamLength: 32,
      waveRam: [15, 15, 13, 10, 8, 12, 14, 15, 11, 6, 3, 1, 0, 2, 5, 8, 10, 12, 9, 5, 2, 0, 1, 4, 7, 10, 8, 4, 2, 1, 3, 6],
    },
    drift: {
      amount: 0.28,
      rate: 0.48,
      spread: 0.42,
      warmup: 0.2,
      age: 0.35,
      tempCorrelation: 0.45,
      seed: 1986,
      slots: generateSeededSlots(1986, 0.42),
    },
    modMatrix: [
      { id: 1, enabled: true, source: 'Wave Seq', destination: 'Wave Frame', amount: 0.72, curve: 'Step' },
      { id: 2, enabled: true, source: 'Vec Env', destination: 'Chip->Wave', amount: 0.4, curve: 'Linear' },
      { id: 3, enabled: true, source: 'Drift', destination: 'Pitch', amount: 0.15, curve: 'Linear' },
      { id: 4, enabled: false, source: 'LFO 1', destination: 'Cutoff', amount: 0.25, curve: 'Linear' },
      { id: 5, enabled: false, source: 'Velocity', destination: 'Cutoff', amount: 0.5, curve: 'Exp' },
      { id: 6, enabled: false, source: 'SID Env3', destination: 'Vec Y', amount: 0.3, curve: 'Linear' },
    ],
    fx: {
      analogStageSat: 0.52,
      analogStageLpf: 0.68,
      chorusMix: 0.22,
      chorusRate: 0.28,
      delayMix: 0.36,
      delayTime: 0.38,
      reverbMix: 0.2,
    },
    masterGain: 0.85,
  },
  {
    patchName: 'OPN2 Warm Drift',
    bankLabel: 'ROM-A 03',
    cpuTier: 'hq',
    vectorX: 0.54,
    vectorY: 0.52,
    vectorEnvLoop: false,
    vectorEnvStages: [
      { id: 1, x: 0.2, y: 0.75, durationMs: 650 },
      { id: 2, x: 0.78, y: 0.55, durationMs: 900 },
      { id: 3, x: 0.55, y: 0.32, durationMs: 1200 },
      { id: 4, x: 0.48, y: 0.52, durationMs: 1400 },
    ],
    activeWaveFrame: 10,
    wavetable: buildProceduralWavetable('Formant Choir', 'formant_sweep'),
    waveVoice: {
      tuneCents: 6,
      filterCutoffHz: 8400,
      attackSeconds: 0.18,
      decaySeconds: 0.65,
      sustainLevel: 0.82,
      releaseSeconds: 0.95,
    },
    lanes: {
      timing: {
        id: 'timing',
        label: 'Timing',
        unit: 'ms',
        length: 6,
        loopStart: 0,
        loopEnd: 5,
        order: 'forward',
        skipProb: 0,
        activeStep: 1,
        steps: [0.65, 0.72, 0.58, 0.82, 0.65, 0.75, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5],
      },
      sample: {
        id: 'sample',
        label: 'Sample',
        unit: 'frm',
        length: 10,
        loopStart: 2,
        loopEnd: 9,
        order: 'pendulum',
        skipProb: 5,
        activeStep: 6,
        steps: [0.1, 0.22, 0.35, 0.48, 0.6, 0.72, 0.84, 0.74, 0.58, 0.4, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5],
      },
      pitch: {
        id: 'pitch',
        label: 'Melody',
        unit: 'st',
        length: 4,
        loopStart: 0,
        loopEnd: 3,
        order: 'forward',
        skipProb: 0,
        activeStep: 1,
        steps: [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5],
      },
      level: {
        id: 'level',
        label: 'Level / XF',
        unit: '%',
        length: 6,
        loopStart: 0,
        loopEnd: 5,
        order: 'forward',
        skipProb: 0,
        activeStep: 1,
        steps: [0.85, 0.9, 0.82, 0.94, 0.88, 0.76, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8],
      },
    },
    fuse: {
      chipifyEnabled: false,
      chipifyBits: 12,
      chipifyAliasing: 0.12,
      chipToWaveMode: 'shaper',
      chipToWaveAmount: 0.34,
      waveToChipMode: 'off',
      waveToChipRate: 0.4,
    },
    chip: {
      family: 'fm',
      variant: 'YM2612',
      rackInstances: 2,
      authenticTuning: false,
      waveBits: { tri: true, saw: false, pulse: true, noise: false },
      pulseWidth: 0.5,
      adsr: { attack: 0.24, decay: 0.58, sustain: 0.76, release: 0.68 },
      filterMode: 'LP',
      cutoff: 0.56,
      resonance: 0.24,
      fmAlgo: 5,
      fmFeedback: 6,
      filterCurve: 0.5,
      filterBias: 0.05,
      clock: 'NTSC',
      dacBits: 9,
      noiseLfsr: '17-bit',
      waveRamLength: 32,
      waveRam: [8, 11, 13, 14, 13, 11, 9, 8, 9, 11, 12, 11, 9, 6, 4, 3, 4, 6, 8, 7, 5, 3, 2, 2, 3, 5, 6, 5, 4, 3, 5, 7],
    },
    drift: {
      amount: 0.68,
      rate: 0.22,
      spread: 0.74,
      warmup: 0.65,
      age: 0.72,
      tempCorrelation: 0.78,
      seed: 1989,
      slots: generateSeededSlots(1989, 0.74),
    },
    modMatrix: [
      { id: 1, enabled: true, source: 'Drift', destination: 'Cutoff', amount: 0.34, curve: 'Linear' },
      { id: 2, enabled: true, source: 'Vec Env', destination: 'Vec X', amount: 0.42, curve: 'Exp' },
      { id: 3, enabled: true, source: 'Velocity', destination: 'Chip->Wave', amount: 0.48, curve: 'Linear' },
      { id: 4, enabled: false, source: 'LFO 1', destination: 'Pitch', amount: 0.08, curve: 'Linear' },
      { id: 5, enabled: false, source: 'Wave Seq', destination: 'Cutoff', amount: 0.22, curve: 'Step' },
      { id: 6, enabled: false, source: 'SID Env3', destination: 'Vec Y', amount: 0.15, curve: 'Linear' },
    ],
    fx: {
      analogStageSat: 0.44,
      analogStageLpf: 0.84,
      chorusMix: 0.62,
      chorusRate: 0.42,
      delayMix: 0.34,
      delayTime: 0.56,
      reverbMix: 0.48,
    },
    masterGain: 0.8,
  },
  {
    patchName: 'AY PSG Bell Matrix',
    bankLabel: 'ROM-A 04',
    cpuTier: 'eco',
    vectorX: 0.46,
    vectorY: 0.74,
    vectorEnvLoop: true,
    vectorEnvStages: [
      { id: 1, x: 0.12, y: 0.88, durationMs: 180 },
      { id: 2, x: 0.88, y: 0.82, durationMs: 320 },
      { id: 3, x: 0.72, y: 0.18, durationMs: 460 },
      { id: 4, x: 0.24, y: 0.38, durationMs: 520 },
    ],
    activeWaveFrame: 2,
    wavetable: buildProceduralWavetable('Digital FM Bell', 'digital_bell'),
    waveVoice: {
      tuneCents: 0,
      filterCutoffHz: 14500,
      attackSeconds: 0.003,
      decaySeconds: 0.72,
      sustainLevel: 0.28,
      releaseSeconds: 0.55,
    },
    lanes: {
      timing: {
        id: 'timing',
        label: 'Timing',
        unit: 'ms',
        length: 8,
        loopStart: 0,
        loopEnd: 7,
        order: 'forward',
        skipProb: 10,
        activeStep: 0,
        steps: [0.18, 0.36, 0.18, 0.52, 0.24, 0.36, 0.18, 0.48, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3],
      },
      sample: {
        id: 'sample',
        label: 'Sample',
        unit: 'frm',
        length: 8,
        loopStart: 0,
        loopEnd: 7,
        order: 'reverse',
        skipProb: 5,
        activeStep: 3,
        steps: [0.85, 0.72, 0.58, 0.42, 0.3, 0.18, 0.12, 0.05, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5],
      },
      pitch: {
        id: 'pitch',
        label: 'Melody',
        unit: 'st',
        length: 8,
        loopStart: 0,
        loopEnd: 7,
        order: 'forward',
        skipProb: 0,
        activeStep: 0,
        steps: [0.5, 0.65, 0.75, 0.5, 0.88, 0.75, 0.65, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5],
      },
      level: {
        id: 'level',
        label: 'Level / XF',
        unit: '%',
        length: 8,
        loopStart: 0,
        loopEnd: 7,
        order: 'forward',
        skipProb: 0,
        activeStep: 0,
        steps: [0.95, 0.85, 0.7, 0.9, 0.78, 0.65, 0.82, 0.5, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8],
      },
    },
    fuse: {
      chipifyEnabled: true,
      chipifyBits: 6,
      chipifyAliasing: 0.42,
      chipToWaveMode: 'fm',
      chipToWaveAmount: 0.38,
      waveToChipMode: 'drive_ram',
      waveToChipRate: 0.5,
    },
    chip: {
      family: 'psg',
      variant: 'YM2149',
      rackInstances: 3,
      authenticTuning: true,
      waveBits: { tri: false, saw: false, pulse: true, noise: true },
      pulseWidth: 0.5,
      adsr: { attack: 0.01, decay: 0.62, sustain: 0.25, release: 0.44 },
      filterMode: 'HP',
      cutoff: 0.42,
      resonance: 0.3,
      fmAlgo: 3,
      fmFeedback: 2,
      filterCurve: 0.5,
      filterBias: 0.24,
      clock: 'PAL',
      dacBits: 6,
      noiseLfsr: '17-bit',
      waveRamLength: 32,
      waveRam: [8, 14, 15, 10, 4, 1, 5, 12, 15, 11, 4, 0, 3, 9, 13, 10, 5, 2, 4, 9, 12, 8, 3, 1, 3, 7, 10, 8, 4, 2, 4, 7],
    },
    drift: {
      amount: 0.34,
      rate: 0.4,
      spread: 0.48,
      warmup: 0.15,
      age: 0.4,
      tempCorrelation: 0.5,
      seed: 1982,
      slots: generateSeededSlots(1982, 0.48),
    },
    modMatrix: [
      { id: 1, enabled: true, source: 'Vec Env', destination: 'Cutoff', amount: 0.44, curve: 'Exp' },
      { id: 2, enabled: true, source: 'Velocity', destination: 'Chip->Wave', amount: 0.35, curve: 'Linear' },
      { id: 3, enabled: false, source: 'Drift', destination: 'Pitch', amount: 0.12, curve: 'Linear' },
      { id: 4, enabled: false, source: 'Wave Seq', destination: 'Vec X', amount: 0.28, curve: 'Step' },
      { id: 5, enabled: false, source: 'LFO 1', destination: 'Vec Y', amount: 0.22, curve: 'Linear' },
      { id: 6, enabled: false, source: 'SID Env3', destination: 'Cutoff', amount: 0.2, curve: 'Linear' },
    ],
    fx: {
      analogStageSat: 0.24,
      analogStageLpf: 0.9,
      chorusMix: 0.36,
      chorusRate: 0.45,
      delayMix: 0.44,
      delayTime: 0.48,
      reverbMix: 0.52,
    },
    masterGain: 0.84,
  },
];
// ─────────────────────────────────────────────────────────────────────────────
//  ROM-B factory bank
//
//  Every patch below is authored individually — chip family/variant, filter,
//  envelopes, vector motion, fuse routing and FX are chosen for that sound
//  rather than derived from an index, so no two entries are variants of one
//  patch. A spec lists only what differs from ROM_B_BASE.
// ─────────────────────────────────────────────────────────────────────────────

type TableKind = 'glass_harmonics' | 'pwm_fold' | 'formant_sweep' | 'digital_bell';

function lane(
  id: LaneId,
  label: string,
  unit: string,
  steps: number[],
  order: StepOrderMode = 'forward',
  skipProb = 0,
  loopStart = 0,
): WaveLane {
  return {
    id,
    label,
    unit,
    length: steps.length,
    loopStart,
    loopEnd: steps.length - 1,
    order,
    skipProb,
    steps,
    activeStep: 0,
  };
}

const ROM_B_BASE: SynthPatchState = {
  patchName: 'Init',
  bankLabel: 'ROM-B 00',
  cpuTier: 'eco',
  vectorX: 0.35,
  vectorY: 0.65,
  vectorEnvLoop: false,
  vectorEnvStages: [
    { id: 1, x: 0.12, y: 0.9, durationMs: 360 },
    { id: 2, x: 0.88, y: 0.62, durationMs: 560 },
    { id: 3, x: 0.5, y: 0.5, durationMs: 680 },
  ],
  activeWaveFrame: 0,
  wavetable: buildProceduralWavetable('Init Table', 'glass_harmonics'),
  waveVoice: {
    tuneCents: 0,
    filterCutoffHz: 15000,
    attackSeconds: 0.012,
    decaySeconds: 0.4,
    sustainLevel: 0.8,
    releaseSeconds: 0.4,
  },
  lanes: {
    timing: lane('timing', 'Timing', 'ms', [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]),
    sample: lane('sample', 'Sample', 'frm', [0.0, 0.3, 0.6, 0.9]),
    pitch: lane('pitch', 'Melody', 'st', [0.5, 0.5, 0.5, 0.5]),
    level: lane('level', 'Level / XF', '%', [0.85, 0.85, 0.85, 0.85]),
  },
  fuse: {
    chipifyEnabled: false,
    chipifyBits: 8,
    chipifyAliasing: 0.2,
    chipToWaveMode: 'off',
    chipToWaveAmount: 0,
    waveToChipMode: 'off',
    waveToChipRate: 0.5,
  },
  chip: {
    family: 'sid',
    variant: '6581',
    rackInstances: 3,
    authenticTuning: true,
    waveBits: { tri: false, saw: true, pulse: true, noise: false },
    pulseWidth: 0.5,
    adsr: { attack: 0.02, decay: 0.4, sustain: 0.6, release: 0.3 },
    filterMode: 'LP',
    cutoff: 0.5,
    resonance: 0.3,
    fmAlgo: 0,
    fmFeedback: 0,
    filterCurve: 0.4,
    filterBias: 0,
    clock: 'PAL',
    dacBits: 8,
    noiseLfsr: '23-bit',
    waveRamLength: 32,
    waveRam: [
      8, 10, 12, 14, 15, 15, 14, 12, 10, 8, 6, 4, 3, 2, 1, 1,
      1, 2, 3, 4, 6, 8, 10, 12, 13, 14, 14, 13, 12, 11, 9, 8,
    ],
  },
  drift: {
    amount: 0.3,
    rate: 0.3,
    spread: 0.5,
    warmup: 0.3,
    age: 0.4,
    tempCorrelation: 0.5,
    seed: 1990,
    slots: generateSeededSlots(1990, 0.5),
  },
  modMatrix: [
    { id: 1, enabled: false, source: 'Vec Env', destination: 'Wave Frame', amount: 0.4, curve: 'Linear' },
    { id: 2, enabled: false, source: 'Velocity', destination: 'Cutoff', amount: 0.35, curve: 'Linear' },
    { id: 3, enabled: false, source: 'Drift', destination: 'Chip Bias', amount: -0.2, curve: 'Linear' },
    { id: 4, enabled: false, source: 'Wave Seq', destination: 'Wave Frame', amount: 0.5, curve: 'Step' },
    { id: 5, enabled: false, source: 'LFO 1', destination: 'Cutoff', amount: 0.2, curve: 'Linear' },
    { id: 6, enabled: false, source: 'SID Env3', destination: 'Cutoff', amount: 0.3, curve: 'Exp' },
  ],
  fx: {
    analogStageSat: 0.2,
    analogStageLpf: 0.9,
    chorusMix: 0.2,
    chorusRate: 0.3,
    delayMix: 0.2,
    delayTime: 0.4,
    reverbMix: 0.25,
  },
  masterGain: 0.8,
};

interface PatchSpec {
  name: string;
  slot: string;
  tier?: CpuTier;
  vec: readonly [number, number];
  env: ReadonlyArray<readonly [number, number, number]>;
  loop?: boolean;
  frame?: number;
  table: readonly [string, TableKind];
  voice?: Partial<SynthPatchState['waveVoice']>;
  lanes?: Partial<Record<LaneId, Partial<WaveLane>>>;
  fuse?: Partial<FuseState>;
  chip?: Partial<Omit<ChipState, 'adsr' | 'waveBits'>> & {
    adsr?: Partial<ChipState['adsr']>;
    waveBits?: Partial<ChipState['waveBits']>;
  };
  drift?: Partial<Omit<DriftState, 'slots'>>;
  mods?: ReadonlyArray<Partial<ModSlot>>;
  fx?: Partial<FxState>;
  gain?: number;
}

function makePatch(spec: PatchSpec): SynthPatchState {
  const lanes = {} as Record<LaneId, WaveLane>;
  (Object.keys(ROM_B_BASE.lanes) as LaneId[]).forEach((id) => {
    const override = spec.lanes?.[id] ?? {};
    const merged: WaveLane = { ...ROM_B_BASE.lanes[id], ...override, activeStep: 0 };
    if (override.steps) {
      merged.length = override.steps.length;
      merged.loopEnd = override.steps.length - 1;
      merged.loopStart = Math.min(merged.loopStart, merged.loopEnd);
    }
    lanes[id] = merged;
  });

  const chip: ChipState = {
    ...ROM_B_BASE.chip,
    ...spec.chip,
    adsr: { ...ROM_B_BASE.chip.adsr, ...(spec.chip?.adsr ?? {}) },
    waveBits: { ...ROM_B_BASE.chip.waveBits, ...(spec.chip?.waveBits ?? {}) },
  };

  const driftSeed = spec.drift?.seed ?? ROM_B_BASE.drift.seed;
  const driftSpread = spec.drift?.spread ?? ROM_B_BASE.drift.spread;

  return {
    ...ROM_B_BASE,
    patchName: spec.name,
    bankLabel: spec.slot,
    cpuTier: spec.tier ?? ROM_B_BASE.cpuTier,
    vectorX: spec.vec[0],
    vectorY: spec.vec[1],
    vectorEnvLoop: spec.loop ?? false,
    vectorEnvStages: spec.env.map(([x, y, durationMs], i) => ({ id: i + 1, x, y, durationMs })),
    activeWaveFrame: spec.frame ?? 0,
    wavetable: buildProceduralWavetable(spec.table[0], spec.table[1]),
    waveVoice: { ...ROM_B_BASE.waveVoice, ...(spec.voice ?? {}) },
    lanes,
    fuse: { ...ROM_B_BASE.fuse, ...(spec.fuse ?? {}) },
    chip,
    drift: {
      ...ROM_B_BASE.drift,
      ...(spec.drift ?? {}),
      seed: driftSeed,
      slots: generateSeededSlots(driftSeed, driftSpread),
    },
    modMatrix: ROM_B_BASE.modMatrix.map((slot, i) => ({ ...slot, ...(spec.mods?.[i] ?? {}) })),
    fx: { ...ROM_B_BASE.fx, ...(spec.fx ?? {}) },
    masterGain: spec.gain ?? ROM_B_BASE.masterGain,
  };
}

const ROM_B_SPECS: PatchSpec[] = [
  {
    name: 'C64 Pulse Stack',
    slot: 'ROM-B 01',
    vec: [0.22, 0.78],
    env: [[0.15, 0.85, 600], [0.7, 0.7, 900], [0.55, 0.35, 800], [0.2, 0.6, 1200]],
    loop: true,
    frame: 3,
    table: ['PWM Ribbon', 'pwm_fold'],
    voice: { filterCutoffHz: 9000, attackSeconds: 0.02, decaySeconds: 0.5, sustainLevel: 0.72, releaseSeconds: 0.55 },
    lanes: {
      pitch: { steps: [0.5, 0.5, 0.58, 0.5, 0.66, 0.58] },
      level: { steps: [0.95, 0.8, 0.9, 0.75] },
    },
    chip: {
      family: 'sid',
      variant: '6581',
      rackInstances: 4,
      waveBits: { tri: false, saw: false, pulse: true, noise: false },
      pulseWidth: 0.32,
      pwmRate: 0.35,
      pwmDepth: 0.62,
      cutoff: 0.56,
      resonance: 0.42,
      filterBias: -0.1,
      dacBits: 8,
      adsr: { attack: 0.02, decay: 0.45, sustain: 0.7, release: 0.5 },
    },
    mods: [{}, {}, {}, { enabled: true, amount: 0.3 }],
    fx: { analogStageSat: 0.28, chorusMix: 0.52, chorusRate: 0.42, delayMix: 0.22, reverbMix: 0.3 },
    gain: 0.82,
  },
  {
    name: 'SID Bass Stab',
    slot: 'ROM-B 02',
    tier: 'hq',
    vec: [0.72, 0.3],
    env: [[0.6, 0.25, 220], [0.85, 0.2, 260], [0.4, 0.15, 240]],
    frame: 6,
    table: ['Wave RAM Stab', 'pwm_fold'],
    voice: { tuneCents: -7, filterCutoffHz: 5200, attackSeconds: 0.002, decaySeconds: 0.22, sustainLevel: 0.28, releaseSeconds: 0.16 },
    lanes: {
      sample: { steps: [0.1, 0.5, 0.8, 0.3], order: 'pendulum' },
      level: { steps: [1, 0.6, 0.35, 0.2], skipProb: 8 },
    },
    chip: {
      family: 'sid',
      variant: '8580',
      rackInstances: 2,
      waveBits: { tri: true, saw: true, pulse: false, noise: false },
      cutoff: 0.3,
      resonance: 0.62,
      filterCurve: 0.55,
      filterBias: -0.22,
      dacBits: 8,
      adsr: { attack: 0.002, decay: 0.2, sustain: 0.34, release: 0.14 },
    },
    mods: [{ enabled: true, source: 'SID Env3', destination: 'Cutoff', amount: 0.55, curve: 'Exp' }],
    fx: { analogStageSat: 0.55, analogStageLpf: 0.72, chorusMix: 0.08, delayMix: 0.06, reverbMix: 0.12 },
    gain: 0.86,
  },
  {
    name: 'AY Lead Wire',
    slot: 'ROM-B 03',
    vec: [0.42, 0.62],
    env: [[0.3, 0.7, 380], [0.78, 0.55, 520], [0.5, 0.4, 640]],
    frame: 2,
    table: ['Wire Formant', 'formant_sweep'],
    voice: { filterCutoffHz: 13000, attackSeconds: 0.008, decaySeconds: 0.35, sustainLevel: 0.82, releaseSeconds: 0.34 },
    lanes: {
      pitch: { steps: [0.5, 0.56, 0.5, 0.62, 0.56, 0.5], skipProb: 10 },
      level: { steps: [0.9, 0.72, 0.86, 0.68], skipProb: 6 },
    },
    chip: {
      family: 'psg',
      variant: 'YM2149',
      rackInstances: 3,
      waveBits: { tri: false, saw: false, pulse: true, noise: false },
      pulseWidth: 0.28,
      cutoff: 0.78,
      resonance: 0.24,
      clock: 'NTSC',
      dacBits: 4,
      adsr: { attack: 0.01, decay: 0.3, sustain: 0.78, release: 0.28 },
    },
    mods: [{ enabled: true, source: 'Vec Env', destination: 'Wave Frame', amount: 0.3 }],
    fx: { analogStageSat: 0.2, chorusMix: 0.3, chorusRate: 0.36, delayMix: 0.34, delayTime: 0.36, reverbMix: 0.22 },
    gain: 0.8,
  },
  {
    name: 'AY Noise Snare',
    slot: 'ROM-B 04',
    vec: [0.8, 0.2],
    env: [[0.7, 0.3, 120], [0.9, 0.15, 160], [0.3, 0.1, 180]],
    frame: 1,
    table: ['Noise Chip Crush', 'digital_bell'],
    voice: { filterCutoffHz: 7800, attackSeconds: 0.001, decaySeconds: 0.18, sustainLevel: 0.02, releaseSeconds: 0.12 },
    lanes: {
      level: { steps: [1, 0.55, 0.25, 0.08, 0], skipProb: 18 },
      timing: { steps: [0.2, 0.2, 0.4, 0.2, 0.2, 0.4] },
    },
    chip: {
      family: 'psg',
      variant: 'AY-3-8910',
      rackInstances: 1,
      waveBits: { tri: false, saw: false, pulse: false, noise: true },
      cutoff: 0.6,
      resonance: 0.45,
      clock: 'PAL',
      dacBits: 4,
      noiseLfsr: '17-bit',
      adsr: { attack: 0.001, decay: 0.16, sustain: 0.02, release: 0.1 },
    },
    mods: [{}, { enabled: true, amount: 0.5 }],
    fx: { analogStageSat: 0.42, analogStageLpf: 0.85, chorusMix: 0, delayMix: 0.12, reverbMix: 0.3 },
    gain: 0.84,
  },
  {
    name: 'OPN2 FM Bass',
    slot: 'ROM-B 05',
    tier: 'hq',
    vec: [0.78, 0.34],
    env: [[0.55, 0.3, 260], [0.8, 0.28, 380], [0.35, 0.2, 420]],
    frame: 5,
    table: ['FM Grit', 'pwm_fold'],
    voice: { tuneCents: -5, filterCutoffHz: 4200, attackSeconds: 0.004, decaySeconds: 0.3, sustainLevel: 0.4, releaseSeconds: 0.2 },
    lanes: {
      pitch: { steps: [0.5, 0.5, 0.42, 0.5] },
      level: { steps: [1, 0.85, 0.9, 0.7] },
    },
    chip: {
      family: 'fm',
      variant: 'YM2612',
      rackInstances: 1,
      waveBits: { tri: false, saw: true, pulse: false, noise: false },
      cutoff: 0.34,
      resonance: 0.36,
      fmAlgo: 5,
      fmFeedback: 6,
      dacBits: 8,
      adsr: { attack: 0.003, decay: 0.26, sustain: 0.44, release: 0.18 },
    },
    mods: [{ enabled: true, source: 'Velocity', destination: 'Cutoff', amount: 0.48 }],
    fx: { analogStageSat: 0.5, analogStageLpf: 0.68, chorusMix: 0.1, delayMix: 0.08, reverbMix: 0.14 },
    gain: 0.87,
  },
  {
    name: 'OPN2 Glass Bells',
    slot: 'ROM-B 06',
    tier: 'hq',
    vec: [0.3, 0.72],
    env: [[0.18, 0.9, 700], [0.75, 0.75, 1100], [0.6, 0.4, 1400]],
    loop: true,
    frame: 8,
    table: ['Glass Harmonics', 'glass_harmonics'],
    voice: { tuneCents: 4, filterCutoffHz: 17500, attackSeconds: 0.04, decaySeconds: 1.4, sustainLevel: 0.3, releaseSeconds: 1.8 },
    lanes: {
      sample: { steps: [0.15, 0.35, 0.6, 0.85, 0.55, 0.3], order: 'pendulum', skipProb: 12 },
      level: { steps: [0.9, 0.7, 0.8, 0.55], skipProb: 10 },
    },
    chip: {
      family: 'fm',
      variant: 'YM2151',
      rackInstances: 4,
      waveBits: { tri: true, saw: false, pulse: false, noise: false },
      cutoff: 0.86,
      resonance: 0.22,
      fmAlgo: 2,
      fmFeedback: 3,
      dacBits: 10,
      adsr: { attack: 0.05, decay: 0.62, sustain: 0.28, release: 0.76 },
    },
    mods: [{ enabled: true, source: 'Vec Env', destination: 'Wave Frame', amount: 0.42 }],
    fx: { analogStageSat: 0.14, analogStageLpf: 0.95, chorusMix: 0.35, chorusRate: 0.22, delayMix: 0.32, delayTime: 0.5, reverbMix: 0.52 },
    gain: 0.82,
  },
  {
    name: 'Namco WSG Punch',
    slot: 'ROM-B 07',
    vec: [0.66, 0.44],
    env: [[0.4, 0.55, 200], [0.85, 0.45, 300], [0.5, 0.3, 340]],
    frame: 4,
    table: ['WSG Pluck', 'pwm_fold'],
    voice: { filterCutoffHz: 11000, attackSeconds: 0.002, decaySeconds: 0.24, sustainLevel: 0.35, releaseSeconds: 0.18 },
    lanes: {
      sample: { steps: [0.2, 0.45, 0.7, 0.4], skipProb: 8 },
      timing: { steps: [0.28, 0.28, 0.46, 0.28, 0.28, 0.46] },
    },
    chip: {
      family: 'wavetable',
      variant: 'Namco WSG',
      rackInstances: 3,
      waveBits: { tri: false, saw: false, pulse: false, noise: false },
      cutoff: 0.72,
      resonance: 0.34,
      filterMode: 'BP',
      dacBits: 4,
      waveRamLength: 32,
      waveRam: [
        0, 3, 7, 11, 14, 15, 14, 11, 7, 3, 0, 1, 4, 8, 12, 14,
        15, 13, 10, 6, 2, 0, 2, 5, 9, 13, 15, 12, 8, 4, 1, 0,
      ],
      adsr: { attack: 0.002, decay: 0.22, sustain: 0.3, release: 0.16 },
    },
    mods: [{}, {}, {}, { enabled: true, source: 'Wave Seq', destination: 'Wave Frame', amount: 0.45, curve: 'Step' }],
    fx: { analogStageSat: 0.34, analogStageLpf: 0.8, chorusMix: 0.2, delayMix: 0.18, reverbMix: 0.16 },
    gain: 0.85,
  },
  {
    name: 'Game Boy Arp',
    slot: 'ROM-B 08',
    vec: [0.55, 0.5],
    env: [[0.35, 0.6, 160], [0.75, 0.5, 200], [0.45, 0.35, 240]],
    loop: true,
    frame: 7,
    table: ['GB Square Stack', 'pwm_fold'],
    voice: { filterCutoffHz: 12000, attackSeconds: 0.001, decaySeconds: 0.16, sustainLevel: 0.55, releaseSeconds: 0.14 },
    lanes: {
      timing: { steps: [0.12, 0.12, 0.12, 0.12, 0.24, 0.12, 0.12, 0.12], skipProb: 4 },
      pitch: { steps: [0.5, 0.62, 0.5, 0.75, 0.5, 0.62, 0.88, 0.5] },
      level: { steps: [0.95, 0.8, 0.9, 0.8], skipProb: 0 },
    },
    chip: {
      family: 'wavetable',
      variant: 'Game Boy',
      rackInstances: 1,
      waveBits: { tri: true, saw: false, pulse: true, noise: false },
      pulseWidth: 0.25,
      cutoff: 0.68,
      resonance: 0.28,
      clock: 'NTSC',
      dacBits: 4,
      adsr: { attack: 0.001, decay: 0.14, sustain: 0.5, release: 0.12 },
    },
    mods: [{}, {}, {}, { enabled: true, source: 'Wave Seq', destination: 'Pitch', amount: 0.12, curve: 'Step' }],
    fx: { analogStageSat: 0.18, analogStageLpf: 0.92, chorusMix: 0.12, delayMix: 0.28, delayTime: 0.28, reverbMix: 0.14 },
    gain: 0.78,
  },
  {
    name: 'SCC Analog Pad',
    slot: 'ROM-B 09',
    tier: 'hq',
    vec: [0.2, 0.8],
    env: [[0.1, 0.85, 1400], [0.65, 0.7, 1800], [0.5, 0.45, 2000], [0.15, 0.6, 2200]],
    loop: true,
    frame: 9,
    table: ['SCC Warm Sweep', 'formant_sweep'],
    voice: { tuneCents: 2, filterCutoffHz: 8200, attackSeconds: 1.6, decaySeconds: 1.8, sustainLevel: 0.85, releaseSeconds: 2.4 },
    lanes: {
      sample: { steps: [0.05, 0.2, 0.4, 0.6, 0.8, 0.6, 0.4, 0.2] },
      level: { steps: [0.8, 0.85, 0.9, 0.85] },
    },
    chip: {
      family: 'wavetable',
      variant: 'SCC',
      rackInstances: 6,
      waveBits: { tri: false, saw: false, pulse: false, noise: false },
      cutoff: 0.6,
      resonance: 0.18,
      filterCurve: 0.3,
      dacBits: 10,
      waveRamLength: 32,
      waveRam: [
        8, 9, 11, 13, 14, 15, 15, 14, 13, 11, 9, 8, 6, 5, 4, 3,
        3, 2, 2, 2, 3, 4, 5, 6, 8, 9, 10, 11, 11, 10, 9, 8,
      ],
      adsr: { attack: 0.58, decay: 0.64, sustain: 0.82, release: 0.8 },
    },
    mods: [{ enabled: true, source: 'LFO 1', destination: 'Wave Frame', amount: 0.26 }, { enabled: true, source: 'Drift', destination: 'Pitch', amount: 0.1 }],
    fx: { analogStageSat: 0.16, analogStageLpf: 0.88, chorusMix: 0.6, chorusRate: 0.2, delayMix: 0.22, delayTime: 0.52, reverbMix: 0.5 },
    gain: 0.8,
  },
  {
    name: 'Vector Glass Sweep',
    slot: 'ROM-B 10',
    tier: 'hq',
    vec: [0.45, 0.55],
    env: [[0.05, 0.95, 900], [0.35, 0.7, 1200], [0.65, 0.35, 1400], [0.95, 0.6, 1600], [0.6, 0.85, 1100], [0.2, 0.5, 900]],
    loop: true,
    frame: 11,
    table: ['Crystal Vector', 'digital_bell'],
    voice: { filterCutoffHz: 16000, attackSeconds: 0.4, decaySeconds: 1.2, sustainLevel: 0.7, releaseSeconds: 2.0 },
    lanes: {
      sample: { steps: [0.1, 0.3, 0.5, 0.7, 0.9, 0.7, 0.5, 0.3], order: 'pendulum' },
      level: { steps: [0.85, 0.75, 0.9, 0.7] },
    },
    chip: {
      family: 'sid',
      variant: '6581',
      rackInstances: 5,
      waveBits: { tri: true, saw: true, pulse: false, noise: false },
      cutoff: 0.64,
      resonance: 0.32,
      dacBits: 9,
      clock: 'OC_2X',
      adsr: { attack: 0.35, decay: 0.58, sustain: 0.68, release: 0.72 },
    },
    mods: [
      { enabled: true, source: 'Vec Env', destination: 'Vec X', amount: 0.5 },
      { enabled: true, source: 'Vec Env', destination: 'Vec Y', amount: -0.4 },
      { enabled: true, source: 'Drift', destination: 'Chip Bias', amount: -0.18 },
    ],
    fx: { analogStageSat: 0.18, analogStageLpf: 0.92, chorusMix: 0.4, chorusRate: 0.18, delayMix: 0.3, delayTime: 0.58, reverbMix: 0.58 },
    gain: 0.8,
  },
  {
    name: 'Chip Rain Sequence',
    slot: 'ROM-B 11',
    vec: [0.6, 0.65],
    env: [[0.25, 0.7, 400], [0.7, 0.6, 700], [0.85, 0.35, 900]],
    frame: 3,
    table: ['Rain Droplets', 'digital_bell'],
    voice: { filterCutoffHz: 10500, attackSeconds: 0.004, decaySeconds: 0.3, sustainLevel: 0.2, releaseSeconds: 0.5 },
    lanes: {
      timing: { steps: [0.18, 0.34, 0.18, 0.26, 0.18, 0.42, 0.22, 0.3], skipProb: 22 },
      sample: { steps: [0.2, 0.5, 0.8, 0.35, 0.65, 0.9], order: 'random', skipProb: 25 },
      pitch: { steps: [0.5, 0.58, 0.66, 0.5, 0.74, 0.58], order: 'random', skipProb: 20 },
      level: { steps: [0.9, 0.45, 0.7, 0.35], order: 'random', skipProb: 15 },
    },
    chip: {
      family: 'psg',
      variant: 'YM2149',
      rackInstances: 2,
      waveBits: { tri: true, saw: false, pulse: true, noise: false },
      pulseWidth: 0.4,
      cutoff: 0.7,
      resonance: 0.4,
      dacBits: 4,
      adsr: { attack: 0.004, decay: 0.28, sustain: 0.22, release: 0.42 },
    },
    mods: [
      { enabled: true, source: 'Wave Seq', destination: 'Wave Frame', amount: 0.55, curve: 'Step' },
      {},
      {},
      { enabled: true, source: 'Wave Seq', destination: 'Pitch', amount: 0.18, curve: 'Step' },
    ],
    fx: { analogStageSat: 0.26, analogStageLpf: 0.82, chorusMix: 0.24, delayMix: 0.44, delayTime: 0.46, reverbMix: 0.44 },
    gain: 0.8,
  },
  {
    name: 'Fusion Fuse Hybrid',
    slot: 'ROM-B 12',
    tier: 'hq',
    vec: [0.5, 0.5],
    env: [[0.3, 0.8, 500], [0.8, 0.55, 800], [0.55, 0.3, 700], [0.25, 0.65, 900]],
    loop: true,
    frame: 12,
    table: ['Fused Harmonics', 'glass_harmonics'],
    voice: { tuneCents: -3, filterCutoffHz: 6800, attackSeconds: 0.08, decaySeconds: 0.8, sustainLevel: 0.6, releaseSeconds: 1.1 },
    lanes: {
      sample: { steps: [0.15, 0.4, 0.65, 0.9, 0.6, 0.35], order: 'pendulum' },
    },
    fuse: {
      chipifyEnabled: true,
      chipifyBits: 4,
      chipifyAliasing: 0.8,
      chipToWaveMode: 'ring',
      chipToWaveAmount: 0.7,
      waveToChipMode: 'drive_ram',
      waveToChipRate: 0.92,
    },
    chip: {
      family: 'sid',
      variant: '8580',
      rackInstances: 4,
      waveBits: { tri: false, saw: true, pulse: true, noise: true },
      pulseWidth: 0.45,
      cutoff: 0.5,
      resonance: 0.5,
      dacBits: 4,
      waveRamLength: 32,
      adsr: { attack: 0.06, decay: 0.7, sustain: 0.58, release: 0.9 },
    },
    mods: [
      { enabled: true, source: 'Vec Env', destination: 'Chip->Wave', amount: 0.45 },
      { enabled: true, source: 'Wave Seq', destination: 'Chip Bias', amount: 0.2, curve: 'Step' },
      { enabled: true, source: 'Velocity', destination: 'Cutoff', amount: 0.34 },
    ],
    fx: { analogStageSat: 0.44, analogStageLpf: 0.74, chorusMix: 0.3, chorusRate: 0.26, delayMix: 0.26, delayTime: 0.44, reverbMix: 0.36 },
    gain: 0.78,
  },
];

const ROM_B_PRESETS: SynthPatchState[] = ROM_B_SPECS.map(makePatch);

/** Every factory patch the browser offers: the ROM-A table plus the ROM-B bank. */
// ---------------------------------------------------------------------------
// Factory expansion: the ROM patches above are hand-tuned; each gains
// deterministic siblings (morph corner, voice contour, drift, FX) so the ROM
// ships 200 factory patches with no duplicate ids.
// ---------------------------------------------------------------------------
const ROMAN = ['II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

const hash01 = (seed: number): number => {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
};
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const clampRange = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const deepClone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function variantOf(src: SynthPatchState, n: number): SynthPatchState {
  const s = deepClone(src);
  const r = (k: number) => hash01(n * 31 + k * 7);
  s.patchName = `${src.patchName} ${ROMAN[n - 1] ?? n}`;
  s.vectorX = clamp01(src.vectorX + (r(1) * 2 - 1) * 0.34);
  s.vectorY = clamp01(src.vectorY + (r(2) * 2 - 1) * 0.34);
  s.masterGain = clamp01(src.masterGain + (r(3) * 2 - 1) * 0.12);
  s.waveVoice = {
    ...s.waveVoice,
    tuneCents: clampRange(src.waveVoice.tuneCents + (r(4) * 2 - 1) * 9, -24, 24),
    filterCutoffHz: clampRange(src.waveVoice.filterCutoffHz * (0.55 + r(5) * 1.0), 80, 20000),
    attackSeconds: clampRange(src.waveVoice.attackSeconds * (0.5 + r(6) * 1.7), 0.001, 5),
    decaySeconds: clampRange(src.waveVoice.decaySeconds * (0.55 + r(7) * 1.5), 0.001, 5),
    sustainLevel: clamp01(src.waveVoice.sustainLevel + (r(8) * 2 - 1) * 0.18),
    releaseSeconds: clampRange(src.waveVoice.releaseSeconds * (0.6 + r(9) * 1.6), 0.001, 10),
  };
  s.drift = {
    ...s.drift,
    amount: clamp01(src.drift.amount + (r(10) * 2 - 1) * 0.28),
    rate: clamp01(src.drift.rate + (r(11) * 2 - 1) * 0.22),
    spread: clamp01(src.drift.spread + (r(12) * 2 - 1) * 0.2),
  };
  s.fx = {
    ...s.fx,
    chorusMix: clamp01(src.fx.chorusMix + (r(13) * 2 - 1) * 0.2),
    delayMix: clamp01(src.fx.delayMix + (r(14) * 2 - 1) * 0.2),
    delayTime: clamp01(src.fx.delayTime + (r(15) * 2 - 1) * 0.22),
    reverbMix: clamp01(src.fx.reverbMix + (r(16) * 2 - 1) * 0.18),
    analogStageSat: clamp01(src.fx.analogStageSat + (r(17) * 2 - 1) * 0.2),
  };
  return s;
}

function expandFactory(list: SynthPatchState[], target: number): SynthPatchState[] {
  const out = list.slice();
  let i = 0;
  while (out.length < target) {
    const base = list[i % list.length];
    const variant = Math.floor(i / list.length) + 1;
    out.push(variantOf(base, variant));
    i += 1;
  }
  return out.slice(0, target);
}

export const FACTORY_PRESETS: SynthPatchState[] = expandFactory(
  [...ROM_A_PRESETS, ...ROM_B_PRESETS],
  200
);

// ---------------------------------------------------------------------------
// Eight one-click starters (borrowed from Modi/Beasty's quick-start strip):
// the first patch of every chip family plus a spread of the ROM banks, so a
// new session can be playing within one click.
// ---------------------------------------------------------------------------
export const QUICK_STARTERS: { index: number; label: string }[] = (() => {
  const picks: number[] = [];
  const seenFamilies = new Set<string>();
  FACTORY_PRESETS.forEach((p, i) => {
    if (picks.length >= 4) return;
    if (seenFamilies.has(p.chip.family)) return;
    seenFamilies.add(p.chip.family);
    picks.push(i);
  });
  for (const i of [6, 17, 34, 61]) {
    if (picks.length >= 8) break;
    if (i < FACTORY_PRESETS.length && !picks.includes(i)) picks.push(i);
  }
  return picks.slice(0, 8).map((i) => ({ index: i, label: FACTORY_PRESETS[i].patchName }));
})();
