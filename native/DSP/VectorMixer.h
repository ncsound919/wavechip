#pragma once

// ============================================================================
//  VectorWaves — VectorMixer
//  Pure C++20, header-only. No JUCE, no allocation.
//
//  Implements:
//    1. Bilinear vector mixing across the four quadrants of the vector pad:
//         A (0,0): Wave 1
//         C (1,0): Chip 1
//         B (0,1): Wave 2 (detuned/sub)
//         D (1,1): Chip 2 (noise/mod)
//
//    2. Real-time 4-Stage Timed Vector Envelope generator with smooth
//       interpolation and looping.
// ============================================================================

#include <array>
#include <cmath>
#include <algorithm>

namespace VectorWaves {

struct VectorStage {
    float x { 0.5f };
    float y { 0.5f };
    float durationMs { 500.0f };
};

class VectorMixer {
public:
    VectorMixer() noexcept {
        stages_[0] = { 0.18f, 0.85f, 420.0f };
        stages_[1] = { 0.72f, 0.68f, 680.0f };
        stages_[2] = { 0.64f, 0.22f, 540.0f };
        stages_[3] = { 0.28f, 0.45f, 820.0f };
    }
    ~VectorMixer() noexcept = default;

    void prepare(double sampleRate) noexcept {
        sampleRate_ = sampleRate > 8000.0 ? sampleRate : 44100.0;
        reset();
    }

    void reset() noexcept {
        currentStage_ = 0;
        stageElapsedSamples_ = 0;
        envX_ = stages_[0].x;
        envY_ = stages_[0].y;
    }

    void noteOn() noexcept {
        currentStage_ = 0;
        stageElapsedSamples_ = 0;
    }

    void setStage(int id, float x, float y, float durationMs) noexcept {
        if (id >= 1 && id <= 4) {
            stages_[static_cast<size_t>(id - 1)] = {
                std::clamp(x, 0.0f, 1.0f),
                std::clamp(y, 0.0f, 1.0f),
                std::clamp(durationMs, 10.0f, 10000.0f)
            };
        }
    }

    void setEnvLoop(bool loop) noexcept {
        envLoop_ = loop;
    }

    // Step the vector envelope by 1 sample and return current (x, y)
    void stepEnvelope(float& outX, float& outY) noexcept {
        if (!envLoop_ && currentStage_ >= 3) {
            outX = stages_[3].x;
            outY = stages_[3].y;
            return;
        }

        const auto& sFrom = stages_[static_cast<size_t>(currentStage_)];
        const int nextIdx = (currentStage_ + 1) % 4;
        const auto& sTo = stages_[static_cast<size_t>(nextIdx)];

        const double stageSamples = (static_cast<double>(sFrom.durationMs) * 0.001) * sampleRate_;
        const float frac = static_cast<float>(std::clamp(static_cast<double>(stageElapsedSamples_) / std::max(1.0, stageSamples), 0.0, 1.0));

        outX = sFrom.x + (sTo.x - sFrom.x) * frac;
        outY = sFrom.y + (sTo.y - sFrom.y) * frac;

        stageElapsedSamples_++;
        if (stageElapsedSamples_ >= static_cast<uint64_t>(stageSamples)) {
            stageElapsedSamples_ = 0;
            currentStage_ = nextIdx;
        }

        envX_ = outX;
        envY_ = outY;
    }

    // Bilinear blend across 4 quadrants
    void mix(float*       outL,
             float*       outR,
             const float* waveL,
             const float* waveR,
             const float* chipL,
             const float* chipR,
             int          numFrames,
             float        baseVecX,
             float        baseVecY) noexcept
    {
        for (int i = 0; i < numFrames; ++i) {
            float envX = baseVecX;
            float envY = baseVecY;

            if (envLoop_) {
                stepEnvelope(envX, envY);
                // Blend manual puck position with moving vector envelope
                envX = (baseVecX + envX) * 0.5f;
                envY = (baseVecY + envY) * 0.5f;
            }

            envX = std::clamp(envX, 0.0f, 1.0f);
            envY = std::clamp(envY, 0.0f, 1.0f);

            // Bilinear interpolation weights:
            //   wA (Wave 1, bottom-left):  (1-x) * (1-y)
            //   wB (Wave 2, top-left):     (1-x) * y
            //   wC (Chip 1, bottom-right): x * (1-y)
            //   wD (Chip 2, top-right):    x * y
            const float wA = (1.0f - envX) * (1.0f - envY);
            const float wB = (1.0f - envX) * envY;
            const float wC = envX * (1.0f - envY);
            const float wD = envX * envY;

            const float wL = waveL ? waveL[i] : 0.0f;
            const float wR = waveR ? waveR[i] : 0.0f;
            const float cL = chipL ? chipL[i] : 0.0f;
            const float cR = chipR ? chipR[i] : 0.0f;

            // Quadrant Node B: slightly phase-shifted wave
            const float nodeBL = wR * 0.9f;
            const float nodeBR = wL * 0.9f;

            // Quadrant Node D: chip with subtle saturation
            const float nodeDL = std::tanh(cL * 1.4f);
            const float nodeDR = std::tanh(cR * 1.4f);

            if (outL) outL[i] = wA * wL + wB * nodeBL + wC * cL + wD * nodeDL;
            if (outR) outR[i] = wA * wR + wB * nodeBR + wC * cR + wD * nodeDR;
        }
    }

private:
    double sampleRate_ { 44100.0 };
    std::array<VectorStage, 4> stages_ {};
    bool envLoop_ { true };
    int currentStage_ { 0 };
    uint64_t stageElapsedSamples_ { 0 };
    float envX_ { 0.5f };
    float envY_ { 0.5f };
};

} // namespace VectorWaves