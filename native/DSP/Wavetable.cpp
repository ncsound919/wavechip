// ============================================================================
//  VectorWaves — Wavetable implementation (M1)
//  Pure C++20. No JUCE, no allocation in read path.
// ============================================================================

#include "Wavetable.h" // (renamed from WavetableMipMap.h in M1 — see Git log)

#include <algorithm>
#include <cassert>
#include <cmath>

namespace VectorWaves {

// ---------------------------------------------------------------------------
//  FIR kernel definition (declared constexpr in header)
// ---------------------------------------------------------------------------
constexpr float Wavetable::kFir[kFirTaps];

// ---------------------------------------------------------------------------
//  Constructor
// ---------------------------------------------------------------------------
Wavetable::Wavetable() {
    // Zero-initialise both slots
    slots_[0].fill(0.0f);
    slots_[1].fill(0.0f);
    activeSlot_.store(-1, std::memory_order_relaxed);
}

// ---------------------------------------------------------------------------
//  applyHalfBandFir
//
//  Convolves `src[srcLen]` with the 15-tap Kaiser-windowed kernel and writes
//  every other output sample to `dst[dstLen]` (dstLen == srcLen / 2).
//  The source is treated as a cyclic buffer (wavetable wraps around).
//
//  Called from build() — background thread only.
// ---------------------------------------------------------------------------
void Wavetable::applyHalfBandFir(const float* src, int srcLen,
                                        float* dst, int dstLen) noexcept {
    // We output one sample for every two input samples (2× downsample).
    for (int out = 0; out < dstLen; ++out) {
        const int inBase = out * 2; // centre input sample for this output
        float acc = 0.0f;

        for (int tap = 0; tap < kFirTaps; ++tap) {
            // BUG-1 fix: correct linear-phase FIR centering for 15-tap kernel.
            // offset = tap - (kFirTaps/2) = tap - 7
            // → offsets: -7,-6,-5,-4,-3,-2,-1,0,1,2,3,4,5,6,7
            const int offset = tap - (kFirTaps / 2);
            const int idx    = ((inBase + offset) % srcLen + srcLen) % srcLen;
            acc += kFir[tap] * src[idx];
        }

        dst[out] = acc;
    }
}

// ---------------------------------------------------------------------------
//  build — MUST NOT be called from the render callback.
//          Fills the inactive slot then atomically publishes it.
// ---------------------------------------------------------------------------
void Wavetable::build(const float* cycle2048, int /*sr*/) noexcept {
    // Determine which slot to write into (the one NOT currently active)
    const int current  = activeSlot_.load(std::memory_order_acquire);
    const int writeSlot = (current == 0) ? 1 : 0;

    SlotStorage& slot = slots_[writeSlot];

    // ---- Level 0: copy the source 2048-sample cycle, removing DC offset ----
    // ENHANCEMENT-2: subtract mean to remove DC offset before storing
    {
        float dcSum = 0.0f;
        for (int j = 0; j < mipSize(0); ++j) dcSum += cycle2048[j];
        const float dc = dcSum / static_cast<float>(mipSize(0));
        float* dst0 = slot.data() + kOffsets[0];
        for (int j = 0; j < mipSize(0); ++j)
            dst0[j] = cycle2048[j] - dc;
    }

    // ---- Levels 1..10: iterative FIR downsample from previous level ----
    for (int level = 1; level < kMipLevels; ++level) {
        const float* src    = slot.data() + kOffsets[level - 1];
        float*       dst    = slot.data() + kOffsets[level];
        const int    srcLen = mipSize(level - 1);
        const int    dstLen = mipSize(level);

        applyHalfBandFir(src, srcLen, dst, dstLen);
    }

    // ---- Atomically publish the new slot ----
    activeSlot_.store(writeSlot, std::memory_order_release);
}

// ---------------------------------------------------------------------------
//  read — called from render thread only.
// ---------------------------------------------------------------------------
float Wavetable::read(int mipLevel, double phase) const noexcept {
    const int slot = activeSlot_.load(std::memory_order_acquire);
    if (slot < 0) return 0.0f;

    mipLevel = std::max(0, std::min(mipLevel, kMipLevels - 1));
    const int   tableSize = mipSize(mipLevel);
    const float* table    = slots_[slot].data() + kOffsets[mipLevel];

    phase -= std::floor(phase);
    const double posExact = phase * static_cast<double>(tableSize);
    const int    idx1     = static_cast<int>(posExact);
    const float  frac     = static_cast<float>(posExact - static_cast<double>(idx1));

    // ENHANCEMENT-1: 4-point Catmull-Rom cubic interpolation (cyclic)
    const int idx0 = (idx1 - 1 + tableSize) % tableSize;
    const int idx2 = (idx1 + 1) % tableSize;
    const int idx3 = (idx1 + 2) % tableSize;

    const float p0 = table[idx0];
    const float p1 = table[idx1];
    const float p2 = table[idx2];
    const float p3 = table[idx3];

    const float t  = frac;
    const float t2 = t * t;
    const float t3 = t2 * t;
    return 0.5f * ((2.0f * p1)
        + (-p0 + p2) * t
        + (2.0f * p0 - 5.0f * p1 + 4.0f * p2 - p3) * t2
        + (-p0 + 3.0f * p1 - 3.0f * p2 + p3) * t3);
}

} // namespace VectorWaves
