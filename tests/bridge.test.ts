import test from 'node:test';
import assert from 'node:assert/strict';
import { FACTORY_PRESETS } from '../src/data/presets';

// The bridge module builds a singleton that looks for the JUCE host on the
// window object. These tests only exercise the pure helpers, so give it an
// inert window rather than pretending a host exists.
(globalThis as unknown as { window?: unknown }).window ??= {};

const bridge = await import('../src/bridge/vstBridge');
const { buildCycle2048, parseWavToWavetable, extractM0ParameterMap, extractParameterMap } = bridge;

type WavParts = {
  samples: number[];          // interleaved, in -1..1
  channels?: number;
  bits?: 8 | 16 | 24 | 32;
  float?: boolean;
  clm?: string;
};

function makeWav({ samples, channels = 1, bits = 16, float = false, clm }: WavParts): Uint8Array {
  const bytesPerSample = bits / 8;
  const dataSize = samples.length * bytesPerSample;
  const clmText = clm ? `<!>${clm} / ${channels}ch` : '';
  const clmChunk = clmText ? 8 + clmText.length + (clmText.length % 2) : 0;
  const total = 12 + 24 + clmChunk + 8 + dataSize;
  const buf = new ArrayBuffer(total);
  const view = new DataView(buf);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  ascii(0, 'RIFF'); view.setUint32(4, total - 8, true); ascii(8, 'WAVE');
  ascii(12, 'fmt '); view.setUint32(16, 16, true);
  view.setUint16(20, float ? 3 : 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, 48000, true);
  view.setUint32(28, 48000 * channels * bytesPerSample, true);
  view.setUint16(32, channels * bytesPerSample, true);
  view.setUint16(34, bits, true);

  let offset = 36;
  if (clmText) {
    ascii(offset, 'clm '); view.setUint32(offset + 4, clmText.length, true);
    ascii(offset + 8, clmText);
    offset += 8 + clmText.length + (clmText.length % 2);
  }

  ascii(offset, 'data'); view.setUint32(offset + 4, dataSize, true);
  let cursor = offset + 8;
  for (const sample of samples) {
    if (float) { view.setFloat32(cursor, sample, true); cursor += 4; continue; }
    if (bits === 8) { view.setUint8(cursor, Math.max(0, Math.min(255, Math.round(sample * 127 + 128)))); cursor += 1; continue; }
    if (bits === 16) { view.setInt16(cursor, Math.max(-32768, Math.min(32767, Math.round(sample * 32767))), true); cursor += 2; continue; }
    const v = Math.max(-8388608, Math.min(8388607, Math.round(sample * 8388607)));
    view.setUint8(cursor, v & 0xff);
    view.setUint8(cursor + 1, (v >> 8) & 0xff);
    view.setUint8(cursor + 2, (v >> 16) & 0xff);
    cursor += 3;
  }
  return new Uint8Array(buf);
}

const fileOf = (parts: WavParts, name = 'table.wav') => {
  // Copy into a plain ArrayBuffer so the BlobPart type is exact under TS 7
  // (Uint8Array<ArrayBufferLike> is rejected for SharedArrayBuffer-capable views).
  const bytes = makeWav(parts)
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return new File([copy.buffer as ArrayBuffer], name)
}

const ramp = (n: number) => Array.from({ length: n }, (_, i) => -1 + (2 * i) / Math.max(1, n - 1));

test('16-bit mono WAV splits into frames at the fallback size', async () => {
  const table = await parseWavToWavetable(fileOf({ samples: ramp(128) }), 64);
  assert.equal(table.name, 'table');
  assert.equal(table.frameSize, 64);
  assert.equal(table.frameCount, 2);
  assert.equal(table.headerDetected, false);
  assert.equal(table.framesPreview.length, 2);
  assert.equal(table.framesPreview[0].length, 64);
  assert.equal(table.chipifiedFrames[0].length, 32);
  assert.ok(Math.abs(table.framesPreview[0][0] - -1) < 0.01, `first sample ${table.framesPreview[0][0]}`);
  for (const frame of table.framesPreview) {
    for (const point of frame) assert.ok(point >= -1 && point <= 1, `preview ${point}`);
  }
  for (const point of table.chipifiedFrames[0]) {
    assert.ok(Number.isInteger(point) && point >= 0 && point <= 15, `chip ${point}`);
  }
});

test('Serum clm chunk sets the frame size and marks the header as detected', async () => {
  const samples = ramp(2048 * 2);
  const table = await parseWavToWavetable(fileOf({ samples, clm: '2048' }), 64);
  assert.equal(table.frameSize, 2048);
  assert.equal(table.headerDetected, true);
  assert.equal(table.frameCount, 2);
});

test('stereo WAV reads the left channel, not silence', async () => {
  const left = Array.from({ length: 64 }, () => 0.5);
  const interleaved = left.flatMap((sample) => [sample, 0]);
  const table = await parseWavToWavetable(fileOf({ samples: interleaved, channels: 2 }), 64);
  assert.equal(table.frameCount, 1);
  const preview = table.framesPreview[0];
  assert.ok(preview.every((point) => Math.abs(point - 0.5) < 0.02), `left channel lost: ${preview.slice(0, 4)}`);
});

test('8-bit and float WAVs decode to normalised previews', async () => {
  const eight = await parseWavToWavetable(fileOf({ samples: ramp(64), bits: 8 }), 64);
  assert.ok(Math.abs(eight.framesPreview[0][0] - -1) < 0.05, `8-bit first ${eight.framesPreview[0][0]}`);

  const float = await parseWavToWavetable(fileOf({ samples: Array.from({ length: 64 }, () => 0.25), bits: 32, float: true }), 64);
  assert.ok(float.framesPreview[0].every((point) => Math.abs(point - 0.25) < 1e-3), 'float32 samples must survive');
});

test('24-bit WAV decodes without sign errors', async () => {
  const samples = Array.from({ length: 64 }, (_, i) => (i < 32 ? -0.75 : 0.75));
  const table = await parseWavToWavetable(fileOf({ samples, bits: 24 }), 64);
  assert.ok(Math.abs(table.framesPreview[0][0] - -0.75) < 0.01, `24-bit first ${table.framesPreview[0][0]}`);
});

test('a non-WAV blob still yields a usable, finite table', async () => {
  const junk = new File([new Uint8Array(200)], 'noise.wav');
  const table = await parseWavToWavetable(junk, 256);
  assert.equal(table.frameSize, 256);
  assert.ok(table.frameCount >= 1);
  for (const frame of table.framesPreview) {
    for (const point of frame) assert.ok(Number.isFinite(point));
  }
});

test('buildCycle2048 resamples a 64-point curve to one clean cycle', () => {
  const curve = ramp(64);
  const cycle = buildCycle2048(curve);
  assert.equal(cycle.length, 2048);
  for (const sample of cycle) assert.ok(sample >= -1 && sample <= 1, `cycle ${sample}`);
  assert.ok(Math.abs(cycle[0] - curve[0]) < 1e-6, `start ${cycle[0]}`);
  assert.ok(Math.abs(cycle[1024] - curve[32]) < 1e-6, `midpoint ${cycle[1024]}`);
  // the buffer is cyclic, so the last sample interpolates from the final point
  // back toward the first rather than sitting on curve[63].
  assert.ok(Math.abs(cycle[2047] - -0.9375) < 1e-4, `wrap sample ${cycle[2047]}`);
  const flat = buildCycle2048(Array.from({ length: 64 }, () => 0.5));
  assert.ok(flat.every((sample) => Math.abs(sample - 0.5) < 1e-6));
});

test('M0 parameter map is 12 contiguous, unique, normalised entries', () => {
  for (const patch of FACTORY_PRESETS) {
    const map = extractM0ParameterMap(patch);
    assert.equal(map.length, 12, `${patch.patchName} exposes ${map.length} M0 parameters`);
    const keys = new Set<string>();
    map.forEach((param, i) => {
      assert.equal(param.index, i, `${patch.patchName} index ${param.index} at position ${i}`);
      assert.ok(!keys.has(param.key), `${patch.patchName} duplicate key ${param.key}`);
      keys.add(param.key);
      assert.ok(param.normalizedValue >= 0 && param.normalizedValue <= 1,
        `${patch.patchName}.${param.key} normalised ${param.normalizedValue}`);
      assert.ok(Number.isFinite(param.physicalValue), `${patch.patchName}.${param.key} physical not finite`);
      assert.ok(param.displayValue.trim().length > 0, `${patch.patchName}.${param.key} has no display value`);
    });
  }
});

test('host parameter map has unique ids and every value normalised', () => {
  for (const patch of FACTORY_PRESETS) {
    const map = extractParameterMap(patch);
    assert.ok(map.length > 20, `${patch.patchName} exposes ${map.length} host parameters`);
    const ids = new Set<string>();
    for (const param of map) {
      assert.ok(!ids.has(param.id), `${patch.patchName} duplicate id ${param.id}`);
      ids.add(param.id);
      assert.match(param.id, /^[a-z0-9_]+\.[a-z0-9_.]+$/, `${patch.patchName} odd id ${param.id}`);
      assert.ok(Number.isFinite(param.normalizedValue), `${patch.patchName}.${param.id} not finite`);
      assert.ok(
        param.normalizedValue >= 0 && param.normalizedValue <= 1,
        `${patch.patchName}.${param.id} normalised ${param.normalizedValue}`,
      );
      assert.ok(param.displayValue.trim().length > 0, `${patch.patchName}.${param.id} has no display value`);
    }
  }
});
