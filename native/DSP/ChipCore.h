#pragma once

// ============================================================================
//  VectorWaves — ChipCore (Enhanced Silicon Engine)
//  Pure C++20. No JUCE, no allocation, no locks.
//
//  Authentic Vintage Chip Synthesis Engine:
//    - SID (MOS 6581 & 8580): 24-bit accumulators, 23-bit Galois LFSR noise,
//      authentic PWM + PWM LFO, MOS non-linear combined waveforms (0x30, 0x50,
//      0x60, 0x70), non-linear multi-mode SVF with 6581 saturation/bias and
//      8580 linear resonance.
//    - PSG (AY-3-8910 / YM2149): 12-bit clock divider square waves, selectable
//      15-bit / 17-bit / 23-bit LFSR noise, and authentic 16-step / 32-step DAC ladder.
//    - FM (Yamaha YM2612 & YM2151): 4-Operator FM with 8 classic algorithms,
//      Op1 self-feedback, Genesis 9-bit DAC ladder crossover crunch.
//    - Wave RAM (Namco WSG / N163 / Game Boy / SCC): 16..128-sample 4-bit / 8-bit RAM
//      with authentic discrete clock downsampling and step DAC.
//    - Rack polyphony / unison: 1..8 instances with detuning and stereo spread.
// ============================================================================

#include "DcBlocker.h"
#include "Parameters.h"
#include <array>
#include <cmath>
#include <cstdint>
#include <numbers>
#include <algorithm>

namespace VectorWaves {

class ChipCore {
public:
    ChipCore() noexcept;
    ~ChipCore() noexcept = default;

    ChipCore(const ChipCore&)            = delete;
    ChipCore& operator=(const ChipCore&) = delete;

    void prepare(double sampleRate) noexcept;
    void reset() noexcept;

    void noteOn(int midiNote, float velocity) noexcept;
    void noteOff() noexcept;

    void setParam(int id, float value) noexcept;
    void setPitchBend(float bend) noexcept;
    void setModWheel(float mod) noexcept;

    // RAM table update (from UI painting or Wave->Chip cross-mod)
    void setWaveRamNibble(int index, int val) noexcept;
    void setWaveRamAll(const uint8_t* nibbles, int count) noexcept;

    // Main real-time render method: zero heap alloc, zero locks
    void process(float* outL, float* outR, int numFrames) noexcept;

    // Direct access to current audio sample for Fuse FM / sync cross-mod
    [[nodiscard]] float getLastSample() const noexcept { return lastSample_; }

    // External hard sync trigger (from Wave zero crossing)
    void triggerSync() noexcept;

private:
    double sampleRate_ { 44100.0 };
    float  pitchBend_  { 0.0f };
    float  modWheel_   { 0.0f };
    float  lastSample_ { 0.0f };

    // Removes the DC that pulse duty / 6581 bias modelling puts on the chip output.
    DcBlocker dcL_, dcR_;

    bool   gate_       { false };
    int    currentNote_{ 60 };
    float  velocity_   { 0.8f };

    // Parameters
    int    family_          { 0 };     // 0=sid, 1=psg, 2=fm, 3=wavetable
    int    variant_         { 0 };     // 0=6581/AY/YM2612/N163, 1=8580/YM2149/YM2151/GB, etc.
    int    rackInstances_   { 1 };     // 1..8
    bool   authenticTuning_ { true };
    bool   waveTri_         { false };
    bool   waveSaw_         { true };
    bool   wavePulse_       { true };
    bool   waveNoise_       { false };
    float  pulseWidth_      { 0.5f };
    float  attack_          { 0.05f };
    float  decay_           { 0.45f };
    float  sustain_         { 0.65f };
    float  release_         { 0.4f };
    int    filterMode_      { 0 };     // 0=LP, 1=BP, 2=HP, 3=OFF
    float  cutoff_          { 0.6f };
    float  resonance_       { 0.35f };
    float  filterCurve_     { 0.5f };
    float  filterBias_      { 0.0f };
    int    clockStandard_   { 0 };     // 0=PAL, 1=NTSC, 2=OC_2X
    int    dacBits_         { 8 };
    int    fmAlgo_          { 0 };
    int    fmFeedback_      { 3 };
    int    noiseLfsrMode_   { 2 };     // 0=15-bit, 1=17-bit, 2=23-bit
    int    waveRamLength_   { 32 };    // 16, 32, 64, 128
    float  pwmRate_         { 0.25f };
    float  pwmDepth_        { 0.0f };
    float  pwmLfoPhase_     { 0.0f };

    // 128-byte Wave RAM (supports 16..128 samples)
    std::array<uint8_t, 128> waveRam_ {};

    // --- Voice Instance Struct (up to 8 rack instances) ---
    struct VoiceSlot {
        uint32_t phase24     { 0 };
        uint32_t lfsrState   { 0x7FFFFF };
        uint32_t psgPeriod   { 1 };
        uint32_t psgCounter  { 0 };
        bool     psgOutput   { false };

        // AY-3-8910 noise channel: independent 5-bit period divider (register R6).
        // Previously noise was clocked from the tone divider, which locked its
        // spectrum to the note pitch.
        uint32_t noisePeriod  { 8 };
        uint32_t noiseCounter { 0 };
        bool     noiseBit     { false };

        std::array<float, 4> fmPhase   { 0.0f, 0.0f, 0.0f, 0.0f };
        std::array<float, 4> fmEnv     { 0.0f, 0.0f, 0.0f, 0.0f };
        float                fmFb1     { 0.0f };
        float                fmFb2     { 0.0f };

        float ramPhase       { 0.0f };

        float svfLp          { 0.0f };   // TPT integrator state 2 (ic2eq)
        float svfBp          { 0.0f };   // TPT integrator state 1 (ic1eq)

        enum class EnvStage { Idle, Attack, Decay, Sustain, Release } envStage { EnvStage::Idle };
        float envLevel       { 0.0f };
    };

    std::array<VoiceSlot, 8> voices_;

    [[nodiscard]] double getMasterClockHz() const noexcept {
        switch (clockStandard_) {
            case 0: return family_ == 0 ? 985248.0 : 1773400.0; // PAL
            case 1: return family_ == 0 ? 1022727.0 : 1789772.0; // NTSC
            case 2: return (family_ == 0 ? 985248.0 : 1773400.0) * 2.0; // 2x OC
            default: return 985248.0;
        }
    }

    // Recomputes sample-rate-dependent coefficients (filter g/k, DAC ladder scale,
    // noise divider). Called from prepare() and from setParam() so the render loop
    // never has to call pow()/sin() per sample.
    void updateDerived() noexcept;

    // TPT filter coefficients
    float filterG_  { 0.1f };
    float filterA1_ { 0.1f };
    float filterA2_ { 0.01f };
    float filterK_  { 1.0f };   // damping (2R)
    float quantScale_ { 128.0f }; // 0 => no quantisation
    float noisePeriodF_ { 8.0f };

    [[nodiscard]] double getSlotFrequency(int slotIdx) const noexcept;

    float renderSidVoice(VoiceSlot& voice, double freqHz, float activePw) noexcept;
    float renderPsgVoice(VoiceSlot& voice, double freqHz) noexcept;
    float renderFmVoice (VoiceSlot& voice, double freqHz) noexcept;
    float renderRamVoice(VoiceSlot& voice, double freqHz) noexcept;

    float processFilter(VoiceSlot& voice, float inSample) noexcept;
    void processEnvelope(VoiceSlot& voice) noexcept;
};

} // namespace VectorWaves