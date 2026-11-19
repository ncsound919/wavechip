# Agent Instructions — Vector Waves M0

## Product boundary

This repository is the **DSP/runtime foundation only**. The product UI is owned by the developer and is intentionally not part of this scaffold. Do not add a visual interface, Tailwind theme, control panel, vector-pad mockup, or design system unless explicitly requested.

## Current milestone

M0 is a single wavetable voice plus seeded drift. The job is to make this engine reliable and measurable before adding chips, vector mixing, or wave sequencing.

## Source-of-truth boundaries

- `native/include/vector_waves_dsp.h`: stable C ABI between TypeScript host and C++ DSP.
- `native/src/vector_waves_dsp.cpp`: DSP source of truth.
- `src/engine/parameters.ts`: parameter IDs, ranges, defaults and labels for the UI.
- `public/overlay-processor.js`: AudioWorklet host and transport adapter.
- `src/engine/VectorWavesEngine.ts`: framework-independent host API.
- `ARCHITECTURE.md`: real-time constraints and ownership boundaries.

When changing a parameter, update both C++ and TypeScript metadata and add/update a test. Never silently reorder parameter IDs once external UI code depends on them.

## Hard rules

1. Never allocate, free, lock, wait, log, access files, or perform network I/O from `Engine::process()`.
2. Never build FFT mipmaps inside the render callback.
3. Keep the WASM memory fixed in M0; do not turn on memory growth without testing pointer stability and callback behavior.
4. Keep the C++ core independent of browser APIs and UI frameworks.
5. Keep the AudioWorklet output path allocation-free from application code.
6. Keep all external messages validated and all DSP parameters clamped in C++.
7. Keep deterministic drift reproducible from an explicit seed.
8. No chip-emulation code is allowed in M0. Chip interfaces begin in M1/M4 when their licensing and fidelity tests are defined.
9. Do not substitute an approximate SID/AY/YM implementation and label it authentic silicon emulation.
10. Any fallback path must remain functional without SharedArrayBuffer.

## Required verification for every DSP change

Run:

```bash
npm run test:native
npm test
```

When dependencies are available, also run:

```bash
npm run build:wasm
npm run build
```

Before declaring the browser runtime complete, test on a real browser with:

- 44.1, 48, 88.2 and 96 kHz AudioContexts;
- SAB enabled and forced MessagePort fallback;
- 10-minute continuous render with no NaN, infinity, or unexpected silence;
- repeated note-on/note-off and rapid parameter automation;
- wavetable upload while audio is running;
- context suspend/resume and engine dispose/recreate;
- CPU measurements under at least one desktop Chromium and one Firefox build.

## Acceptance criteria for M0 completion

- Stable start/stop and note handling.
- Correct frequency at reference MIDI pitches within the expected cents tolerance.
- Mip selection reduces folded upper harmonics versus the unfiltered source at high pitches.
- Parameter changes are audible and remain finite at min/max values.
- Drift with the same seed and event sequence is reproducible; different seeds produce different fixed voice personalities.
- No allocation or table-building work in the sample render loop.
- Shared transport and fallback both deliver every parameter update under normal operating load.
- Native tests, TS tests, Emscripten build, and browser smoke tests pass.

## Work order

1. Make the current M0 build reproducible with a pinned/recorded Emscripten SDK version.
2. Add automated browser smoke tests and WASM render-capture tests.
3. Add spectral verification for mipmap anti-aliasing and frequency tuning.
4. Profile worst-case CPU and optimize only against measured bottlenecks.
5. Split the DSP source into `Wavetable`, `Envelope`, `DriftState`, `Filter`, and `Voice` modules without changing the C ABI.
6. Introduce explicit engine handles before M1 needs multiple independent instances.
7. Add wave frames/vector blending only after M0 passes the acceptance criteria.
