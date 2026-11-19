#pragma once

// ============================================================================
//  VectorWaves — DcBlocker
//  Pure C++20. One-pole high-pass used to keep modelled DC offsets (6581 filter
//  bias, asymmetric saturation) out of the signal path.
//
//  Why this exists: the 6581 filter stage intentionally adds a bias before its
//  tanh, and the reverb combs (feedback 0.78) plus the tape delay have a DC gain
//  of 1/(1-feedback). Any residual DC therefore circulates in the feedback tanks
//  and grows over several seconds, eating output headroom.
// ============================================================================

#include <algorithm>
#include <cmath>

namespace VectorWaves {

class DcBlocker {
public:
    void prepare(float sampleRateHz, float cutoffHz = 10.0f) noexcept {
        // y[n] = x[n] - x[n-1] + R * y[n-1]
        const float w = 2.0f * 3.14159265358979f * cutoffHz / std::max(1.0f, sampleRateHz);
        r_ = std::clamp(1.0f - w, 0.9f, 0.99999f);
        reset();
    }

    void reset() noexcept {
        x1_ = 0.0f;
        y1_ = 0.0f;
    }

    inline float process(float x) noexcept {
        const float y = x - x1_ + r_ * y1_;
        x1_ = x;
        y1_ = y;
        return y;
    }

private:
    float r_  { 0.99870f };   // ~10 Hz at 48 kHz
    float x1_ { 0.0f };
    float y1_ { 0.0f };
};

} // namespace VectorWaves
