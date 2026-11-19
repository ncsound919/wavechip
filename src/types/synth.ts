export type CpuTier = 'eco' | 'hq';

export type LaneId = 'timing' | 'sample' | 'pitch' | 'level';
export type StepOrderMode = 'forward' | 'reverse' | 'pendulum' | 'random';

export interface WaveLane {
  id: LaneId;
  label: string;
  unit: string;
  length: number; // 1..16
  loopStart: number; // 0-indexed
  loopEnd: number; // 0-indexed
  order: StepOrderMode;
  skipProb: number; // 0..100
  steps: number[]; // normalized 0..1 per step (up to 16)
  activeStep: number; // live playback cursor for visual inspection
}

export interface WavetableData {
  name: string;
  frameSize: 64 | 128 | 256 | 512 | 1024 | 2048;
  frameCount: number;
  headerDetected: boolean;
  mipsEnabled: boolean;
  /** Downsampled preview curves: [frameIndex][64 points in -1..1] */
  framesPreview: number[][];
  /** Chipified 32-sample, 4-bit (0..15) per frame */
  chipifiedFrames: number[][];
}

export interface VectorEnvelopeStage {
  id: number;
  x: number; // 0..1 (A=0, C=1)
  y: number; // 0..1 (D=0, B=1)
  durationMs: number; // 20..4000
}

export interface FuseState {
  chipifyEnabled: boolean;
  chipifyBits: number; // 4..16
  chipifyAliasing: number; // 0..1
  chipToWaveMode: 'off' | 'fm' | 'ring' | 'shaper';
  chipToWaveAmount: number; // 0..1
  waveToChipMode: 'off' | 'drive_ram' | 'sync_frame';
  waveToChipRate: number; // 0..1
}

export type ChipFamily = 'sid' | 'psg' | 'fm' | 'wavetable';

export type ChipVariant =
  | '6581'
  | '8580'
  | 'AY-3-8910'
  | 'YM2149'
  | 'YM2612'
  | 'YM2151'
  | 'N163'
  | 'Namco WSG'
  | 'Game Boy'
  | 'SCC';

export type ClockStandard = 'PAL' | 'NTSC' | 'OC_2X';
export type FilterMode = 'LP' | 'BP' | 'HP' | 'OFF';

export interface ChipState {
  family: ChipFamily;
  variant: ChipVariant;
  rackInstances: number; // 1..8
  authenticTuning: boolean;
  // Tier 1: Patch Level
  waveBits: {
    tri: boolean;
    saw: boolean;
    pulse: boolean;
    noise: boolean;
  };
  pulseWidth: number; // 0..1
  adsr: {
    attack: number; // 0..1
    decay: number; // 0..1
    sustain: number; // 0..1
    release: number; // 0..1
  };
  filterMode: FilterMode;
  cutoff: number; // 0..1
  resonance: number; // 0..1
  fmAlgo: number; // 0..7
  fmFeedback: number; // 0..7
  // Tier 2: Silicon Mods
  filterCurve: number; // 0..1
  filterBias: number; // -1..1 (dark to light)
  clock: ClockStandard;
  dacBits: number; // 4..12
  noiseLfsr: '15-bit' | '17-bit' | '23-bit';
  waveRamLength: 16 | 32 | 64 | 128;
  waveRam: number[]; // length 32, values 0..15 (4-bit)
  pwmRate?: number; // 0..1
  pwmDepth?: number; // 0..1
}

export interface VoiceSlotOffset {
  slot: number;
  pitchCents: number; // -18..+18
  cutoffPct: number; // -15..+15
  envPct: number; // -15..+15
}

export interface DriftState {
  amount: number; // 0..1
  rate: number; // 0..1 (maps to 0.05..0.5 Hz)
  spread: number; // 0..1
  warmup: number; // 0..1
  age: number; // 0..1
  tempCorrelation: number; // 0..1
  seed: number;
  slots: VoiceSlotOffset[];
}

export interface ModSlot {
  id: number;
  enabled: boolean;
  source: 'Vec Env' | 'Wave Seq' | 'Drift' | 'SID Env3' | 'LFO 1' | 'Velocity';
  destination: 'Cutoff' | 'Vec X' | 'Vec Y' | 'Chip Bias' | 'Wave Frame' | 'Chip->Wave' | 'Pitch';
  amount: number; // -1..1
  curve: 'Linear' | 'Exp' | 'Step';
}

export interface FxState {
  analogStageSat: number; // 0..1
  analogStageLpf: number; // 0..1
  chorusMix: number; // 0..1
  chorusRate: number; // 0..1
  delayMix: number; // 0..1
  delayTime: number; // 0..1
  reverbMix: number; // 0..1
}

export type MilestoneScope = 'all' | 'm0';
export type TransportMode = 'sab' | 'messageport';

export interface WaveVoiceState {
  tuneCents: number; // -24..+24 cents
  filterCutoffHz: number; // 80..20000 Hz (M0 one-pole LPF)
  attackSeconds: number; // 0.001..5 s
  decaySeconds: number; // 0.001..5 s
  sustainLevel: number; // 0..1
  releaseSeconds: number; // 0.001..10 s
}

export interface SynthPatchState {
  patchName: string;
  bankLabel: string;
  cpuTier: CpuTier;
  vectorX: number; // 0..1 (A=0 Wave 1, C=1 Chip 1)
  vectorY: number; // 0..1 (D=0 Chip 2, B=1 Wave 2)
  vectorEnvLoop: boolean;
  vectorEnvStages: VectorEnvelopeStage[];
  activeWaveFrame: number;
  wavetable: WavetableData;
  waveVoice: WaveVoiceState;
  lanes: Record<LaneId, WaveLane>;
  fuse: FuseState;
  chip: ChipState;
  drift: DriftState;
  modMatrix: ModSlot[];
  fx: FxState;
  masterGain: number; // 0..1
}
