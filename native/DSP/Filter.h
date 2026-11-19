#pragma once

// ============================================================================
//  VectorWaves — Filter (module M1)
//  Pure C++20, header-only. No JUCE, no allocation.
//
//  Module: Filter — one-pole filters.
//    OnePoleLP     — classic one-pole low-pass: y += a*(x - y)
//    OnePoleHiShelf — high-shelf for analog saturation coloring
//
//  Coefficient rule: setCoeff() / setHiShelf() must be called at CONTROL RATE
//  only (every kControlPeriod samples), never inside the sample loop.
// ============================================================================

#include <algorithm>
#include <cmath>
#include <numbers>

namespace VectorWaves {

// ---------------------------------------------------------------------------
//  OnePoleLP — classic one-pole low-pass
// ---------------------------------------------------------------------------
class OnePoleLP {
public:
    OnePoleLP() = default;

    /// Compute coefficient from cutoff frequency and sample rate.
    /// Call at control rate only — not inside the sample loop.
    void setCoeff(float fc, float sr) noexcept {
        const float fcClamped = std::max(1.0f, std::min(fc, sr * 0.4999f));
        a_ = 1.0f - std::exp(-2.0f * static_cast<float>(std::numbers::pi_v<float>) * fcClamped / sr);
    }

    /// Process one sample. Call from the sample loop.
    [[nodiscard]] inline float process(float x) noexcept {
        y_ += a_ * (x - y_);
        return y_;
    }

    /// Reset state (e.g. on voice steal / silence).
    void reset() noexcept { y_ = 0.0f; }

    /// Current output (without advancing).
    [[nodiscard]] float output() const noexcept { return y_; }

    /// Current coefficient (for diagnostics).
    [[nodiscard]] float coeff() const noexcept { return a_; }

private:
    float a_ = 1.0f; // coefficient; 1.0 = bypass (all-pass trivially)
    float y_ = 0.0f; // filter state
};

// ---------------------------------------------------------------------------
//  OnePoleHiShelf — high-frequency shelf boost/cut
// ---------------------------------------------------------------------------
class OnePoleHiShelf {
public:
    OnePoleHiShelf() = default;

    /// Set shelf frequency and gain (in dB, positive = boost).
    /// Call at control rate only.
    void setHiShelf(float shelfHz, float gainDb, float sr) noexcept {
        const float fcClamped = std::max(1.0f, std::min(shelfHz, sr * 0.4999f));
        a_   = 1.0f - std::exp(-2.0f * static_cast<float>(std::numbers::pi_v<float>) * fcClamped / sr);
        gain_ = std::pow(10.0f, gainDb / 20.0f);
    }

    /// Process one sample.
    [[nodiscard]] inline float process(float x) noexcept {
        // LP state
        lpY_ += a_ * (x - lpY_);
        // HP = x - LP; shelf = LP + gain*HP = gain*x + (1-gain)*LP
        return gain_ * x + (1.0f - gain_) * lpY_;
    }

    void reset() noexcept { lpY_ = 0.0f; }

private:
    float a_    = 1.0f;  // LP coeff
    float gain_ = 1.0f;  // linear shelf gain
    float lpY_  = 0.0f;  // LP state
};

} // namespace VectorWaves
