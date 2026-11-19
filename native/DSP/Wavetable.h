#pragma once

// ============================================================================
//  VectorWaves — Wavetable (module M1)
//  Pure C++20. No JUCE, no allocation in read path.
//
//  Module: Wavetable — the sample-storage layer for WavetableVoice.
//    - mip pyramid built from a 2048-sample cycle (finite-difference FIR)
//    - double-buffered publish (activeSlot_) for thread-safe swapping
//
//  Thread safety:
//    build()  — background/message thread only (NEVER from render).
//    read()   — render thread only.
//    Double-buffer via activeSlot_ atomic: build fills the inactive slot,
//    then atomically publishes it.
// ============================================================================

#include <array>
#include <atomic>
#include <cmath>
#include <cstdint>
#include <cstring>

namespace VectorWaves {

// ---------------------------------------------------------------------------
//  Constants
// ---------------------------------------------------------------------------
inline constexpr int kMipLevels     = 11;    // levels 0..10
inline constexpr int kBaseTableSize = 2048;  // level 0

inline constexpr int mipSize(int level) noexcept {
    return kBaseTableSize >> level; // 2048, 1024, ... 2
}

// ---------------------------------------------------------------------------
//  Wavetable
// ---------------------------------------------------------------------------
class Wavetable {
public:
    Wavetable();

    // -----------------------------------------------------------------------
    //  build — background thread only. Fills the inactive slot, publishes it.
    // -----------------------------------------------------------------------
    void build(const float* cycle2048, int sr) noexcept;

    // -----------------------------------------------------------------------
    //  read — render thread only. Catmull-Rom interpolation, linear phase.
    // -----------------------------------------------------------------------
    [[nodiscard]] float read(int mipLevel, double phase) const noexcept;

    [[nodiscard]] bool isReady() const noexcept {
        return activeSlot_.load(std::memory_order_acquire) >= 0;
    }

private:
    // 15-tap Kaiser-windowed half-band FIR (2x downsampling, passband gain 1)
    static constexpr int kFirTaps = 15;
    static constexpr float kFir[kFirTaps] = {
         0.0048437f, 0.0f, -0.0295875f, 0.0f,  0.1091946f,
         0.0f,        0.4155492f, 0.5f, 0.4155492f, 0.0f,
         0.1091946f, 0.0f, -0.0295875f, 0.0f,  0.0048437f
    };

    using SlotStorage = std::array<float, kBaseTableSize * 2 - 2>;

    SlotStorage slots_[2]{};

    static constexpr int levelOffset(int level) noexcept {
        int off = 0;
        for (int i = 0; i < level; ++i) off += mipSize(i);
        return off;
    }

    static constexpr std::array<int, kMipLevels> kOffsets = []() constexpr {
        std::array<int, kMipLevels> arr{};
        int off = 0;
        for (int i = 0; i < kMipLevels; ++i) {
            arr[i] = off;
            off += mipSize(i);
        }
        return arr;
    }();

    alignas(64) std::atomic<int> activeSlot_{-1};

    static void applyHalfBandFir(const float* src, int srcLen,
                                 float* dst, int dstLen) noexcept;
};

} // namespace VectorWaves
