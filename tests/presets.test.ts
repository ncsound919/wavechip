import test from 'node:test';
import assert from 'node:assert/strict';
import { FACTORY_PRESETS, QUICK_STARTERS } from '../src/data/presets';
import type { LaneId } from '../src/types/synth';

const LANES: LaneId[] = ['timing', 'sample', 'pitch', 'level'];
const ORDERS = new Set(['forward', 'reverse', 'pendulum', 'random']);
const inRange = (v: number, lo: number, hi: number) => Number.isFinite(v) && v >= lo - 1e-9 && v <= hi + 1e-9;

test('factory bank ships 200 patches with unique names', () => {
  assert.equal(FACTORY_PRESETS.length, 200);
  const names = new Set<string>();
  for (const patch of FACTORY_PRESETS) {
    assert.ok(!names.has(patch.patchName), `duplicate patch name: ${patch.patchName}`);
    names.add(patch.patchName);
  }
});

test('quick starters point at real patches', () => {
  assert.equal(QUICK_STARTERS.length, 8);
  for (const start of QUICK_STARTERS) {
    assert.ok(start.index >= 0 && start.index < FACTORY_PRESETS.length, `starter index ${start.index}`);
    assert.equal(start.label, FACTORY_PRESETS[start.index].patchName);
  }
});

test('every lane has 16 valid steps and a sane loop window', () => {
  for (const patch of FACTORY_PRESETS) {
    for (const laneId of LANES) {
      const lane = patch.lanes[laneId];
      assert.ok(lane, `${patch.patchName} is missing lane ${laneId}`);
      assert.equal(lane.id, laneId);
      assert.ok(lane.length >= 1 && lane.length <= 16, `${patch.patchName}.${laneId}.length=${lane.length}`);
      // steps may be stored short (the sequencer falls back to 0.5 past the end),
      // but never shorter than the loop window it advertises.
      assert.ok(
        lane.steps.length >= lane.length && lane.steps.length <= 16,
        `${patch.patchName}.${laneId} has ${lane.steps.length} steps for length ${lane.length}`,
      );
      for (const step of lane.steps) {
        assert.ok(inRange(step, 0, 1), `${patch.patchName}.${laneId} step ${step} outside 0..1`);
      }
      assert.ok(
        lane.loopStart >= 0 && lane.loopEnd < lane.length && lane.loopStart <= lane.loopEnd,
        `${patch.patchName}.${laneId} loop ${lane.loopStart}..${lane.loopEnd} of ${lane.length}`,
      );
      assert.ok(ORDERS.has(lane.order), `${patch.patchName}.${laneId} order ${lane.order}`);
      assert.ok(inRange(lane.skipProb, 0, 100), `${patch.patchName}.${laneId} skipProb ${lane.skipProb}`);
      assert.ok(lane.activeStep >= 0 && lane.activeStep < 16);
    }
  }
});

test('vector position, master gain and wave frame stay in range', () => {
  for (const patch of FACTORY_PRESETS) {
    assert.ok(inRange(patch.vectorX, 0, 1), `${patch.patchName} vectorX ${patch.vectorX}`);
    assert.ok(inRange(patch.vectorY, 0, 1), `${patch.patchName} vectorY ${patch.vectorY}`);
    assert.ok(inRange(patch.masterGain, 0, 1), `${patch.patchName} masterGain ${patch.masterGain}`);
    assert.ok(patch.wavetable.frameCount > 0);
    assert.ok(
      patch.activeWaveFrame >= 0 && patch.activeWaveFrame < patch.wavetable.frameCount,
      `${patch.patchName} frame ${patch.activeWaveFrame}/${patch.wavetable.frameCount}`,
    );
  }
});

test('vector envelope stages are valid and ordered points', () => {
  for (const patch of FACTORY_PRESETS) {
    assert.ok(patch.vectorEnvStages.length >= 2, `${patch.patchName} has ${patch.vectorEnvStages.length} stages`);
    for (const stage of patch.vectorEnvStages) {
      assert.ok(inRange(stage.x, 0, 1), `${patch.patchName} stage x ${stage.x}`);
      assert.ok(inRange(stage.y, 0, 1), `${patch.patchName} stage y ${stage.y}`);
      assert.ok(stage.durationMs >= 20 && stage.durationMs <= 4000, `${patch.patchName} stage ${stage.durationMs}ms`);
    }
  }
});

test('wavetable previews are normalised and chipified values are 0..15', () => {
  for (const patch of FACTORY_PRESETS) {
    const { framesPreview, chipifiedFrames } = patch.wavetable;
    assert.equal(framesPreview.length, patch.wavetable.frameCount, `${patch.patchName} preview frame count`);
    for (const frame of framesPreview) {
      assert.equal(frame.length, 64);
      for (const point of frame) assert.ok(inRange(point, -1, 1), `${patch.patchName} preview ${point}`);
    }
    for (const frame of chipifiedFrames) {
      for (const point of frame) {
        assert.ok(point >= 0 && point <= 15 && Number.isInteger(point), `${patch.patchName} chip ${point}`);
      }
    }
  }
});

test('chip, fuse, drift and fx blocks stay inside their documented ranges', () => {
  const MODES = new Set(['off', 'fm', 'ring', 'shaper']);
  for (const patch of FACTORY_PRESETS) {
    const { chip, fuse, waveVoice, modMatrix, fx } = patch;
    assert.ok(chip.rackInstances >= 1 && chip.rackInstances <= 8, `${patch.patchName} rack ${chip.rackInstances}`);
    for (const v of Object.values(chip.adsr)) assert.ok(inRange(v, 0, 1), `${patch.patchName} adsr ${v}`);
    assert.ok(inRange(chip.pulseWidth, 0, 1));
    assert.ok(inRange(chip.cutoff, 0, 1));
    assert.ok(inRange(chip.resonance, 0, 1));
    assert.ok(chip.fmAlgo >= 0 && chip.fmAlgo <= 7, `${patch.patchName} fmAlgo ${chip.fmAlgo}`);

    assert.ok(fuse.chipifyBits >= 4 && fuse.chipifyBits <= 16 && Number.isInteger(fuse.chipifyBits));
    assert.ok(inRange(fuse.chipifyAliasing, 0, 1));
    assert.ok(inRange(fuse.chipToWaveAmount, 0, 1));
    assert.ok(MODES.has(fuse.chipToWaveMode), `${patch.patchName} chipToWaveMode ${fuse.chipToWaveMode}`);
    assert.ok(inRange(fuse.waveToChipRate, 0, 1));

    assert.ok(inRange(waveVoice.tuneCents, -24, 24), `${patch.patchName} tune ${waveVoice.tuneCents}`);
    assert.ok(inRange(waveVoice.filterCutoffHz, 80, 20000), `${patch.patchName} cutoff ${waveVoice.filterCutoffHz}`);
    assert.ok(inRange(waveVoice.sustainLevel, 0, 1));
    for (const key of ['attackSeconds', 'decaySeconds', 'releaseSeconds'] as const) {
      assert.ok(waveVoice[key] >= 0.001 && waveVoice[key] <= 10, `${patch.patchName} ${key} ${waveVoice[key]}`);
    }

    for (const slot of modMatrix) {
      assert.ok(inRange(slot.amount, -1, 1), `${patch.patchName} mod amount ${slot.amount}`);
      assert.equal(typeof slot.enabled, 'boolean');
    }

    for (const value of Object.values(fx)) {
      assert.ok(inRange(value, 0, 1), `${patch.patchName} fx ${value}`);
    }
  }
});
