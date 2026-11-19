# Wavechip (Vector Waves)

C++20 wavetable/chip synthesizer with a **JUCE 8 VST3 + WebView2** host and a
React UI served from the embedded `dist/` bundle. Three synth layers fuse into
one voice: wavetable oscillator, silicon chip core, and a cross-modulation
"fuse" matrix, into a vector mixer and studio FX rack.

## Build

```bash
npm install
npm run build          # builds dist/ (React UI) — needed before the VST3
npm run dev            # UI dev server
npm run test           # TS tests (bridge, presets)
npm run test:native    # native C++ suite (CMake, VECTORCHIP_BUILD_TESTS=ON)
npm run lint           # tsc --noEmit
```

CMake needs JUCE (8.0.14, local `-DJUCE_DIR=` or FetchContent) and the
WebView2 SDK; see `native/CMakeLists.txt`.

## Architecture

| Path | Responsibility |
|---|---|
| `native/DSP/Parameters.h` | Frozen parameter IDs 0..58 + `ParamKey` string mirror |
| `native/DSP/Wavetable.h/.cpp` | Mip pyramid (11 levels), half-band FIR, atomic slot publish |
| `native/DSP/Envelope.h` | ADSR state machine and coefficients |
| `native/DSP/DriftState.h` | Seeded LCG drift (pitch/filter/level), warmup |
| `native/DSP/Filter.h` | One-pole LP + high-shelf |
| `native/DSP/WavetableVoice.*` | Voice = Wavetable + Envelope + Filter + DriftState |
| `native/DSP/ChipCore.*` | SID/PSG/FM/Wave-RAM core |
| `native/DSP/FuseEngine.h` | Chipify, chip↔wave cross-modulation |
| `native/DSP/VectorMixer.h` | Bilinear 4-quadrant vector blend |
| `native/DSP/FxRack.*` | Saturation, chorus, tape delay, plate reverb |
| `native/Source/*` | JUCE processor/editor: APVTS sync, CC automation, diagnostics |

## Hard rules (implemented, not aspirational)

1. `processBlock` is allocation-free, lock-free, I/O-free.
2. No mipmap building inside the render callback.
3. Fixed WASM memory (no growth without pointer-stability tests).
4. Canonical parameter IDs 0..11 are frozen; extended IDs only append.
5. Every `setParam` clamps in C++ (the UI is never the trust boundary).
6. Drift is deterministic from an explicit seed.
7. `getDiagnostics()` exposes CPU/voice/rate state for smoke tests.

## Verification

`VERIFICATION.md` records what was actually run. Native tests cover tuning,
ADSR timing, drift reproducibility + parameter handling, NaN/Inf extremes,
ChipCore, FuseEngine, FxRack, VectorMixer, and silicon integrity.
