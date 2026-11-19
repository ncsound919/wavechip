#pragma once

// ============================================================================
//  VectorWaves — FuseEngine
//  Pure C++20. No JUCE, no allocation, no locks.
//
//  Cross-Modulation & Chipification Matrix:
//    - Chipify Wave: bit depth truncation (4..16 bits) and downsampled
//      sample-and-hold clock aliasing.
//    - Chip->Wave Cross-Mod: FM, Ring Modulation, and Non-Linear Wavefolding.
//    - Wave->Chip Cross-Mod: Real-time 4-bit Wave RAM driving and Hard Sync.
// ============================================================================

#include "Parameters.h"
#include <cmath>
#include <cstdint>
#include <algorithm>

namespace VectorWaves {

class FuseEngine {
public:
    FuseEngine() noexcept = default;
    ~FuseEngine() noexcept = default;

    void prepare(double sampleRate) noexcept {
        sampleRate_ = sampleRate > 8000.0 ? sampleRate : 44100.0;
        reset();
    }

    void reset() noexcept {
        holdL_ = 0.0f;
        holdR_ = 0.0f;
        holdPhase_ = 0.0f;
        ramSampleAccum_ = 0.0f;
        ramWriteIdx_ = 0;
        prevWaveSign_ = 0;
    }

    void setChipify(bool enabled, int bits, float aliasing) noexcept {
        chipifyEnabled_  = enabled;
        chipifyBits_     = std::clamp(bits, 4, 16);
        chipifyAliasing_ = std::clamp(aliasing, 0.0f, 1.0f);
        dirtyCachedChipify_ = true;
    }

    void setChipToWave(int mode, float amount) noexcept {
        chipToWaveMode_   = std::clamp(mode, 0, 3); // 0=off, 1=fm, 2=ring, 3=shaper
        chipToWaveAmount_ = std::clamp(amount, 0.0f, 1.0f);
    }

    void setWaveToChip(int mode, float rate) noexcept {
        waveToChipMode_ = std::clamp(mode, 0, 2); // 0=off, 1=drive_ram, 2=sync_frame
        waveToChipRate_ = std::clamp(rate, 0.0f, 1.0f);
    }

    // Process a single sample of Wave audio through Chipify
    void processChipify(float& waveL, float& waveR) noexcept {
        if (!chipifyEnabled_) return;

        // Recompute cached values only when params changed (BUG-2 fix)
        if (dirtyCachedChipify_) {
            cachedSteps_ = std::pow(2.0f, static_cast<float>(chipifyBits_ - 1));
            const float targetRate = static_cast<float>(sampleRate_) *
                std::pow(800.0f / static_cast<float>(sampleRate_), chipifyAliasing_);
            cachedAliasInc_ = targetRate / static_cast<float>(sampleRate_);
            dirtyCachedChipify_ = false;
        }

        // 1. Bit depth reduction (quantization)
        waveL = std::round(waveL * cachedSteps_) / cachedSteps_;
        waveR = std::round(waveR * cachedSteps_) / cachedSteps_;

        // 2. Clock aliasing (Sample & Hold rate reduction)
        if (chipifyAliasing_ > 0.001f) {
            holdPhase_ += cachedAliasInc_;
            if (holdPhase_ >= 1.0f) {
                holdPhase_ -= std::floor(holdPhase_);
                holdL_ = waveL;
                holdR_ = waveR;
            }
            waveL = holdL_;
            waveR = holdR_;
        }
    }

    // Apply Chip->Wave cross modulation
    void applyChipToWave(float& waveL, float& waveR, float chipL, float chipR) noexcept {
        if (chipToWaveMode_ == 0 || chipToWaveAmount_ <= 0.001f) return;

        const float amt = chipToWaveAmount_;

        switch (chipToWaveMode_) {
            case 1: { // FM / Phase-like modulation
                // Phase-angle trigonometric shaping
                const float modL = std::sin(waveL * 3.14159f + chipL * amt * 4.0f);
                const float modR = std::sin(waveR * 3.14159f + chipR * amt * 4.0f);
                waveL = waveL * (1.0f - amt) + modL * amt;
                waveR = waveR * (1.0f - amt) + modR * amt;
                break;
            }
            case 2: { // Ring Modulation
                const float ringL = waveL * chipL * 2.0f;
                const float ringR = waveR * chipR * 2.0f;
                waveL = waveL * (1.0f - amt) + ringL * amt;
                waveR = waveR * (1.0f - amt) + ringR * amt;
                break;
            }
            case 3: { // Wavefolder / Shaper
                const float drive = 1.0f + std::abs(chipL) * amt * 5.0f;
                // BUG-1 fix: analytical triangle-wave folder (O(1), no loop)
                auto fold = [](float in) noexcept -> float {
                    // Analytical triangle wave folder: maps any real to [-1,1]
                    // period = 4, fold = triangleWave(in)
                    float x = in * 0.5f + 0.5f; // shift to [0, 1] center
                    x = x - std::floor(x);       // wrap to [0,1)
                    return 2.0f * (x < 0.5f ? x : 1.0f - x) * 2.0f - 1.0f; // triangle in [-1,1]
                };
                waveL = fold(waveL * drive);
                waveR = fold(waveR * drive);
                break;
            }
            default: break;
        }
    }

    // Inspect Wave audio to trigger Wave->Chip sync or RAM write
    // Returns true if a zero-crossing hard-sync should be fired
    bool checkWaveSync(float waveSample) noexcept {
        if (waveToChipMode_ != 2) return false; // 2 = sync_frame
        const int sign = waveSample >= 0.0f ? 1 : -1;
        const bool crossed = (prevWaveSign_ < 0 && sign > 0);
        prevWaveSign_ = sign;
        return crossed;
    }

    // Returns a 4-bit nibble (0..15) and target index (0..31) if a RAM update is ready
    bool checkRamDrive(float waveSample, int& outIdx, uint8_t& outNibble) noexcept {
        if (waveToChipMode_ != 1) return false; // 1 = drive_ram

        ramSampleAccum_ += waveToChipRate_ * 0.1f;
        if (ramSampleAccum_ >= 1.0f) {
            ramSampleAccum_ -= 1.0f;
            outIdx = ramWriteIdx_;
            ramWriteIdx_ = (ramWriteIdx_ + 1) % 32;
            const float norm = (waveSample + 1.0f) * 0.5f; // 0..1
            outNibble = static_cast<uint8_t>(std::clamp(static_cast<int>(norm * 15.0f), 0, 15));
            return true;
        }
        return false;
    }

private:
    double sampleRate_       { 44100.0 };
    bool   chipifyEnabled_   { false };
    int    chipifyBits_      { 8 };
    float  chipifyAliasing_  { 0.25f };

    int    chipToWaveMode_   { 0 };
    float  chipToWaveAmount_ { 0.25f };

    int    waveToChipMode_   { 0 };
    float  waveToChipRate_   { 0.5f };

    float  holdL_            { 0.0f };
    float  holdR_            { 0.0f };
    float  holdPhase_        { 0.0f };

    float  ramSampleAccum_   { 0.0f };
    int    ramWriteIdx_      { 0 };
    int    prevWaveSign_     { 0 };

    // BUG-2: Cached chipify values to avoid per-sample pow() calls
    float  cachedSteps_          { 128.0f };
    float  cachedAliasInc_       { 1.0f };
    bool   dirtyCachedChipify_   { true };
};

} // namespace VectorWaves