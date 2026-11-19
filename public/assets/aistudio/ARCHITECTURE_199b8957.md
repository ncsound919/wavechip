# M0 Architecture Contract

## Hard real-time rules

The C++ `Engine::process()` path must remain free of:

- heap allocation or deallocation;
- file, network, or console I/O;
- locks, mutexes, condition variables, or blocking waits;
- table FFT/mipmap construction;
- unbounded loops or container growth.

All wavetable preparation, module initialization, memory allocation, and message parsing happen outside the render callback. New DSP modules must preserve this rule.

## Stable C ABI

`native/include/vector_waves_dsp.h` is the browser/native boundary. Keep it C-compatible and version changes deliberately. The first implementation exports lifecycle, table upload, parameter, note and render functions.

## Engine ownership

M0 owns one static engine instance in the WASM module. Do not create additional engines by copying static globals. M1 should introduce explicit engine handles (`vw_engine_create`, `vw_engine_destroy`, etc.) before adding a multi-instance chip rack or multiple independent plugin instances.

## Audio format

- Input: MIDI note number and normalized velocity.
- Output: planar stereo `float32`.
- Render rate: the active `AudioContext.sampleRate`.
- Worklet block: variable frame count up to 2048, not assumed to be permanently 128.
- Wavetable: one normalized cycle; internal frame 2048 samples.

## Parameter transport

- Control-rate parameters: SAB single-producer/single-consumer ring when available.
- Note events and table transfers: MessagePort.
- Fallback: all parameter changes use MessagePort.
- The worklet drains parameter updates at the beginning of each render quantum.
- The C++ parameter setter clamps every value again; the UI is never the trust boundary.

## DSP conventions

- Parameter IDs are stable integer values mirrored by `src/engine/parameters.ts`.
- Seconds are seconds, cutoff is Hz, tuning is cents, and normalized controls are 0–1.
- Wavetable phase wraps in `[0, 1)`.
- Drift RNG is seeded and deterministic.
- Table changes rebuild all mip levels before the new table is used by the next render block.
