#pragma once

// ============================================================================
//  VectorWaves — FxRack
//  Pure C++20. No JUCE, no allocation in process().
//
//  Complete Studio FX Rack:
//    1. Analog Stage: Pre-emphasis shelf + warm non-linear tanh saturation + post LPF
//    2. BBD Stereo Chorus: Dual quadrature delay lines with LFO modulation
//    3. Tape Delay: Ping-pong tape delay with tape saturation and high-frequency damping
//    4. Plate Reverb: Schroeder-Moorer algorithmic diffuser with 4 comb filters and
//       2 all-pass stages
//    5. Master Gain & Soft Peak Limiter
// ============================================================================

#include "DcBlocker.h"
#include "Filter.h"
#include <array>
#include <vector>
#include <cmath>
#include <numbers>
#include <algorithm>

namespace VectorWaves {

class FxRack {
public:
    FxRack() noexcept;
    ~FxRack() noexcept = default;

    void prepare(float sampleRate) noexcept;
    void reset() noexcept;

    // Process stereo buffer in-place
    void process(float* L, float* R, int numFrames,
                 float satAmt, float lpfNorm, float masterGain) noexcept;

    // Parameter Setters
    void setSaturation(float drive) noexcept;
    void setMasterLpf(float normCutoff) noexcept;
    void setChorus(float mix, float rate) noexcept;
    void setDelay(float mix, float time) noexcept;
    void setReverb(float mix) noexcept;

private:
    float sr_ { 44100.0f };

    // --- Analog Stage ---
    OnePoleHiShelf preEmphL_, preEmphR_;
    OnePoleLP      masterLpfL_, masterLpfR_;
    float          satDrive_    { 0.0f };
    float          lpfCutoffHz_ { 20000.0f };
    bool           satDirty_    { false };   // BUG-5
    bool           lpfDirty_    { false };   // BUG-5

    // --- BBD Chorus ---
    static constexpr size_t kChorusBufferSize = 4096;
    std::vector<float> chorusBufferL_;
    std::vector<float> chorusBufferR_;
    size_t chorusWritePos_ { 0 };
    float  chorusLfoPhase_ { 0.0f };
    float  chorusMix_      { 0.0f };
    float  chorusRate_     { 0.35f };

    // --- Tape Delay ---
    static constexpr size_t kDelayBufferSize = 131072; // ~3 seconds at 44.1kHz
    std::vector<float> delayBufferL_;
    std::vector<float> delayBufferR_;
    size_t delayWritePos_  { 0 };
    float  delayMix_       { 0.0f };
    float  delayTimeSec_   { 0.35f };
    float  delayFeedback_  { 0.45f };
    float  tapeWowPhase_   { 0.0f };   // ENHANCEMENT-2: tape wow LFO
    OnePoleLP delayDampL_, delayDampR_;

    // --- Plate Reverb (Schroeder-Moorer) ---
    // 4 Parallel Comb Filters
    struct CombFilter {
        std::vector<float> buffer;
        size_t writePos { 0 };
        float  feedback { 0.78f };
        float  dampState { 0.0f };
        float  dampCoeff { 0.35f };

        void setSize(size_t size) {
            buffer.assign(size, 0.0f);
            writePos = 0;
            dampState = 0.0f;
        }

        inline float process(float in) noexcept {
            if (buffer.empty()) return in;
            const float out = buffer[writePos];
            dampState = out * (1.0f - dampCoeff) + dampState * dampCoeff;
            buffer[writePos] = in + dampState * feedback;
            writePos = (writePos + 1) % buffer.size();
            return out;
        }
    };

    // 2 Cascaded All-Pass Diffusers
    struct AllPassFilter {
        std::vector<float> buffer;
        size_t writePos { 0 };
        float  feedback { 0.5f };

        void setSize(size_t size) {
            buffer.assign(size, 0.0f);
            writePos = 0;
        }

        inline float process(float in) noexcept {
            if (buffer.empty()) return in;
            const float bufOut = buffer[writePos];
            const float out = -in + bufOut;
            buffer[writePos] = in + (bufOut * feedback);
            writePos = (writePos + 1) % buffer.size();
            return out;
        }
    };

    std::array<CombFilter, 4> combsL_;
    std::array<CombFilter, 4> combsR_;
    std::array<AllPassFilter, 2> allPassL_;
    std::array<AllPassFilter, 2> allPassR_;
    float reverbMix_ { 0.0f };

    // --- DC control ---
    // in: keeps DC out of the delay/reverb feedback tanks (comb DC gain is
    // 1/(1-feedback) ~ 4.5x). out: final safety net before the host sees it.
    DcBlocker inDcL_, inDcR_, outDcL_, outDcR_;

    // Helpers
    static float normToLogHz(float norm, float sr) noexcept;
    static float softClip(float x) noexcept;
};

} // namespace VectorWaves