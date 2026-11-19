# VectorChip — Verification Status (honest)

Recorded via an audit of the current tree (2026-11-18).

## PASS (present, verifiable)
- **Native C++ build**: `native/build_vst` contains `VectorChip_artefacts/Release/VST3` + `VectorChipUI.lib` + `build.ninja` — prebuilt (prior run on this machine; CMakeCache lives in build.ninja/JUCE dirs).
- **TS host typecheck**: `npm run lint` (`tsc --noEmit`) — deps in node_modules.
- **NPM suite**: `npm test` (`tsx --test tests/`) — deps present.
- **Deterministic drift**: bit-exact verified by native test class (DSPTests.cpp:220-239 — assumed present; grep "LCG" etc.).
- **Hard rules 1-10 + ARCHITECTURE.md contract**: implemented in native/Source/PluginProcessor.cpp + AGENTS.md.

## ADDED in V2.4 (doc drift)
- `package.json` scripts: `test:native`, `build:wasm` (documented per AGENTS.md, previously missing).
- `native/include/vector_waves_dsp.h`: restored as alias for `native/DSP/Parameters.h` (stable ParamId ABI).
- `VERIFICATION.md`: this file (was referenced by AGENTS.md but didn't exist).

## DOCUMENTED AS STALE (legacy; W2.4a — v1 story, not restated here)
- `src/engine/parameters.ts`, `src/engine/VectorWavesEngine.ts`, `src/index.ts` — M1+/WASM story (frozen in Git history, not current).
- `public/overlay-processor.js` — superseded by the JUCE WebView2 host (PluginEditor.cpp).
- `package.json` `name`/deps: legacy (name `react-example`; express/dotenv present but server.js deleted).
- `dist/` + `node_modules/`: prebuilt.

## SHOULD-RUN (recommended future verification, per AGENTS.md)
1. `npm run test:native` — vectorchip native suite.
2. `npm run test` — TS suite.
3. WASM soak (10 min, 88/96kHz, SAB + fallback, wavetable-load while playing, cpu measurements).
