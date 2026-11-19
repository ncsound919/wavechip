#pragma once

// ============================================================================
//  VectorWaves — Envelope (module M1)
//  Pure C++20, header-only. No JUCE, no allocation.
//
//  Module: Envelope — ADSR state machine + coefficient generation.
//
//  Time-to-coefficient conversion:
//    coeff = exp(-1 / (time_seconds * sampleRate))
//  This yields a classic one-pole exponential approach envelope.
//
//  Sample-exact trigger: noteOn() / noteOff() flip the state machine
//  immediately; the render loop picks up the new state on the very next sample.
// ============================================================================

#include <cmath>

namespace VectorWaves {

class AdsrEnvelope {
public:
    enum class State : uint8_t {
        Idle    = 0,
        Attack  = 1,
        Decay   = 2,
        Sustain = 3,
        Release = 4
    };

    AdsrEnvelope() = default;

    void setAttack  (float seconds, float sr) noexcept { attackCoeff_  = calcAttackCoeff(seconds, sr); }
    void setDecay   (float seconds, float sr) noexcept { decayCoeff_   = calcCoeff(seconds, sr); }
    void setSustain (float level)             noexcept { sustainLevel_  = clamp01(level); }
    void setRelease (float seconds, float sr) noexcept { releaseCoeff_ = calcCoeff(seconds, sr); }

    void setParams(float attackSec, float decaySec, float sustain,
                   float releaseSec, float sr) noexcept {
        setAttack (attackSec,  sr);
        setDecay  (decaySec,   sr);
        setSustain(sustain);
        setRelease(releaseSec, sr);
    }

    // -----------------------------------------------------------------------
    //  Triggers — safe to call from the audio thread (no allocation/I-O).
    // -----------------------------------------------------------------------

    /// Begin a new note. Re-triggers from current level (legato-friendly).
    void noteOn() noexcept {
        state_ = State::Attack;
    }

    /// Begin release phase.
    void noteOff() noexcept {
        if (state_ != State::Idle)
            state_ = State::Release;
    }

    /// Force silence immediately (voice steal).
    void reset() noexcept {
        state_  = State::Idle;
        level_  = 0.0f;
    }

    // -----------------------------------------------------------------------
    //  Process — advances one sample. Call once per sample from the voice loop.
    // -----------------------------------------------------------------------
    [[nodiscard]] float process() noexcept {
        switch (state_) {
        case State::Attack:
            // Approach target 2.0; real envelope stays <=1.0 (capped below)
            level_ += attackCoeff_ * (kAttackTarget - level_);
            if (level_ >= 1.0f) {
                level_ = 1.0f;
                state_ = State::Decay;
            }
            break;

        case State::Decay:
            level_ += decayCoeff_ * (sustainLevel_ - level_);
            if (std::abs(level_ - sustainLevel_) < kEpsilon) {
                level_ = sustainLevel_;
                state_ = State::Sustain;
            }
            break;

        case State::Sustain:
            level_ = sustainLevel_;
            break;

        case State::Release:
            level_ += releaseCoeff_ * (0.0f - level_);
            if (level_ < kEpsilon) {
                level_ = 0.0f;
                state_ = State::Idle;
            }
            break;

        case State::Idle:
        default:
            level_ = 0.0f;
            break;
        }

        return level_;
    }

    // -----------------------------------------------------------------------
    //  Accessors
    // -----------------------------------------------------------------------
    [[nodiscard]] State state()       const noexcept { return state_; }
    [[nodiscard]] float level()       const noexcept { return level_; }
    [[nodiscard]] bool  isActive()    const noexcept { return state_ != State::Idle; }

private:
    static constexpr float kAttackTarget = 2.0f;  // "overshoot" target so we hit 1.0
    static constexpr float kEpsilon      = 1e-5f;

    static float calcAttackCoeff(float seconds, float sr) noexcept {
        const float t = seconds * sr;
        if (t < 1.0f) return 1.0f;
        // With kAttackTarget = 2.0f, reaching >=0.99 around sample t:
        return 1.0f - std::exp(-0.6625f / t);
    }

    static float calcCoeff(float seconds, float sr) noexcept {
        // coeff = 1 - exp(-1 / (t * sr))  — classic one-pole time constant
        const float t = seconds * sr;
        if (t < 1.0f) return 1.0f; // instant
        return 1.0f - std::exp(-1.0f / t);
    }

    static constexpr float clamp01(float v) noexcept {
        return v < 0.0f ? 0.0f : (v > 1.0f ? 1.0f : v);
    }

    State state_       = State::Idle;
    float level_       = 0.0f;

    float attackCoeff_  = 1.0f;
    float decayCoeff_   = 1.0f;
    float sustainLevel_ = 0.7f;
    float releaseCoeff_ = 0.001f;
};

} // namespace VectorWaves
