#pragma once

// ============================================================================
//  VectorWaves — DriftState (module M1)
//  Pure C++20, header-only. No JUCE, no allocation.
//
//  Module: DriftState — seeded deterministic per-voice drift for pitch /
//  filter / level modulation.
//
//  Algorithm: 32-bit Linear Congruential Generator (LCG).
//    next = a * state + c   (mod 2^32, implicit via uint32_t overflow)
//  Constants: Numerical Recipes / ANSI C  (a=1664525, c=1013904223).
//
//  Determinism guarantee:
//    Same seed + same call sequence (noteOn/update) → identical output.
//    Different seeds → independent, uncorrelated drift personalities.
//
//  update() is called at CONTROL RATE (every 64 samples), not per-sample.
//  warmup / age shift the phase of the drift oscillator.
// ============================================================================

#include <cstdint>
#include <cmath>
#include <numbers>

namespace VectorWaves {

struct DriftOutput {
    float pitchCents = 0.0f;  // ±N cents of pitch drift
    float filterMod  = 0.0f;  // [-1, 1] multiplied by caller into cutoff
    float levelMod   = 0.0f;  // [-1, 1] multiplied by caller into gain
};

class DriftState {
public:
    DriftState() = default;

    // -----------------------------------------------------------------------
    //  seed — call once per voice personality (noteOn or patch load).
    // -----------------------------------------------------------------------
    void seed(uint32_t patchSeed) noexcept {
        state_[0] = patchSeed;
        state_[1] = patchSeed ^ 0xDEADBEEFu;
        state_[2] = patchSeed ^ 0xCAFEBABEu;
        warmupSamples_ = 0;
    }

    // -----------------------------------------------------------------------
    //  setWarmup / burnWarmup — "aged" oscillator drift at patch load.
    // -----------------------------------------------------------------------
    void setWarmup(int controlRateTicks) noexcept { warmupSamples_ = controlRateTicks; }
    void burnWarmup() noexcept {
        for (int i = 0; i < warmupSamples_; ++i) advanceLCG();
        warmupSamples_ = 0;
    }

    // -----------------------------------------------------------------------
    //  update — called at control rate.
    // -----------------------------------------------------------------------
    [[nodiscard]] DriftOutput update(float rate, float amount) noexcept {
        // Advance three independent LCG lanes for decorrelated drift
        const float r0 = lcgToFloat(advanceLCG(0)); // pitch
        const float r1 = lcgToFloat(advanceLCG(1)); // filter
        const float r2 = lcgToFloat(advanceLCG(2)); // level

        const float coeff = std::min(rate * 0.1f, 1.0f); // scale rate to [0,1]
        smoothPitch_  += coeff * (r0 - smoothPitch_);
        smoothFilter_ += coeff * (r1 - smoothFilter_);
        smoothLevel_  += coeff * (r2 - smoothLevel_);

        DriftOutput out;
        out.pitchCents = smoothPitch_  * amount * 50.0f;
        out.filterMod  = smoothFilter_ * amount;
        out.levelMod   = smoothLevel_  * amount * 0.1f;
        return out;
    }

    // -----------------------------------------------------------------------
    //  spread — decorrelate voices sharing a patch (deterministic by index).
    // -----------------------------------------------------------------------
    void applySpread(int voiceIndex, float spread) noexcept {
        const uint32_t steps = static_cast<uint32_t>(voiceIndex) *
                               static_cast<uint32_t>(spread * 1000.0f + 1.0f);
        for (uint32_t i = 0; i < steps; ++i) advanceLCG();
    }

private:
    static constexpr uint32_t kA = 1664525u;
    static constexpr uint32_t kC = 1013904223u;

    uint32_t state_[3] = {12345u, 67890u, 11111u};

    uint32_t advanceLCG(int lane) noexcept {
        state_[lane] = kA * state_[lane] + kC;
        return state_[lane];
    }
    void advanceLCG() noexcept {
        for (auto& s : state_) s = kA * s + kC;
    }
    static float lcgToFloat(uint32_t v) noexcept {
        return static_cast<float>(static_cast<int32_t>(v))
               * (1.0f / static_cast<float>(1u << 31));
    }

    float smoothPitch_  = 0.0f;
    float smoothFilter_ = 0.0f;
    float smoothLevel_  = 0.0f;
    int   warmupSamples_ = 0;
};

} // namespace VectorWaves
