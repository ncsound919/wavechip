#pragma once

// ============================================================================
//  VectorWaves — WavetableVoice (M0)
//  Pure C++20. No JUCE in this header.
//
//  Owns: Wavetable, Envelope, Filter, DriftState.
//  The render loop is allocation-free and I/O-free.
//
//  Control-rate boundary: every kControlPeriod (64) samples.
//    - LPF coefficient update
//    - Drift oscillator advance
//    - ADSR coefficient update if params changed
// ============================================================================

#include "Wavetable.h"
#include "Envelope.h"
#include "Filter.h"
#include "DriftState.h"
#include "Parameters.h"

#include <atomic>
#include <cmath>
#include <cstdint>
#include <numbers>

namespace VectorWaves {

// ---------------------------------------------------------------------------
//  Control-rate period (samples between coefficient updates)
// ---------------------------------------------------------------------------
inline constexpr int kControlPeriod = 64;

// ---------------------------------------------------------------------------
//  WavetableVoice
// ---------------------------------------------------------------------------
class WavetableVoice {
public:
    WavetableVoice();

    // -----------------------------------------------------------------------
    //  Lifecycle
    // -----------------------------------------------------------------------

    /// Must be called before process(). Not real-time safe (sets sr_).
    void prepare(double sampleRate) noexcept;

    // -----------------------------------------------------------------------
    //  MIDI triggers — real-time safe (no allocation, no I/O).
    // -----------------------------------------------------------------------

    /// Start a new note. midiNote in [0,127], velocity in [0,1].
    void noteOn(int midiNote, float velocity) noexcept;

    /// Begin release phase.
    void noteOff() noexcept;

    /// True while ADSR is not in Idle state.
    [[nodiscard]] bool isActive() const noexcept { return adsr_.isActive(); }

    /// Reset voice state (e.g. on audio stream stop)
    void reset() noexcept {
        adsr_.reset();
        filter_.reset();
        phase_ = 0.0;
        phaseInc_ = 0.0;
    }

    /// Set pitch bend in range [-1.0, 1.0] (maps to ±200 cents)
    void setPitchBend(float bend) noexcept {
        pitchBendCents_.store(bend * 200.0f, std::memory_order_relaxed);
    }

    /// Set modulation wheel in range [0.0, 1.0]
    void setModWheel(float mod) noexcept {
        modWheel_.store(mod, std::memory_order_relaxed);
    }

    // -----------------------------------------------------------------------
    //  Parameter update — real-time safe.
    //  id  : one of VectorWaves::ParamId (0-11)
    //  value : plain-unit value (NOT normalised)
    // -----------------------------------------------------------------------
    void setParam(int id, float value) noexcept;

    // -----------------------------------------------------------------------
    //  process — the render loop.
    //  Writes numFrames of stereo output to outL / outR.
    //  Accumulates (+=) so the caller can zero buffers and mix voices.
    //  ZERO allocation. ZERO I/O.
    // -----------------------------------------------------------------------
    void process(float* outL, float* outR, int numFrames) noexcept;

    // -----------------------------------------------------------------------
    //  loadTable — called from the message thread / JUCE background thread.
    //  Builds the mip pyramid for `cycle2048` and atomically publishes it.
    //  MUST NOT be called from the render callback.
    // -----------------------------------------------------------------------
    void loadTable(const float* cycle2048, int sr);

    /// Set deterministic drift seed (for testing and fixed voice personalities)
    void setDriftSeed(uint32_t seed) noexcept { drift_.seed(seed); }

private:
    // -----------------------------------------------------------------------
    //  Helpers
    // -----------------------------------------------------------------------
    static float midiToHz(int note, float tuneCents = 0.0f) noexcept {
        return 440.0f * std::pow(2.0f, (static_cast<float>(note) - 69.0f + tuneCents / 100.0f) / 12.0f);
    }

    /// Compute mip level from frequency.
    // BUG-2 fix: choose finest mip where tableSize covers >= 1 full cycle period.
    // level = floor(log2(kBaseTableSize * freq / sr_)), clamped to [0, kMipLevels-1].
    int selectMip(float freq) const noexcept {
        if (freq <= 0.0f || sr_ <= 0.0) return 0;
        const double ratio = static_cast<double>(kBaseTableSize) * static_cast<double>(freq) / sr_;
        if (ratio <= 1.0) return 0;
        const int level = static_cast<int>(std::floor(std::log2(ratio)));
        return std::max(0, std::min(level, kMipLevels - 1));
    }

    void applyControlRate() noexcept;

    // -----------------------------------------------------------------------
    //  DSP modules (owned, no heap)
    // -----------------------------------------------------------------------
    Wavetable   mipMap_;   // M1: wavetable storage + mip pyramid
    AdsrEnvelope adsr_;    // M1: ADSR state machine
    OnePoleLP   filter_;   // M1: LPF
    DriftState  drift_;    // M1: seeded drift

    // -----------------------------------------------------------------------
    //  Render state (audio thread only)
    // -----------------------------------------------------------------------
    double sr_          = 44100.0;
    double phase_       = 0.0;      // normalised [0,1)
    double phaseInc_    = 0.0;      // per-sample phase increment
    float  velocity_    = 1.0f;
    int    midiNote_    = 69;
    int    controlCount_= 0;        // sample counter for control-rate boundary
    int    mipLvl_      = 0;        // resolved at control rate (no log2 per sample)
    float  levelMod_    = 0.0f;     // drift level mod (+/-0.1 at full amount)
    uint32_t lastSeed_  = 0xFFFFFFFFu; // drift seed dedupe (setParam is per-block)

    // Haas-effect stereo widener state (R channel gets a 7-sample delay)
    float stereoDelayBuf_[7] = {};
    int   stereoDelayIdx_    = 0;

    // -----------------------------------------------------------------------
    //  Params (written by setParam, read at control-rate boundary)
    //  Use atomic for params shared between message thread and audio thread.
    // -----------------------------------------------------------------------
    std::atomic<float> pMasterGain_     {0.8f};
    std::atomic<float> pTuneCents_      {0.0f};
    std::atomic<float> pAttackSec_      {0.01f};
    std::atomic<float> pDecaySec_       {0.1f};
    std::atomic<float> pSustainLevel_   {0.7f};
    std::atomic<float> pReleaseSec_     {0.3f};
    std::atomic<float> pFilterCutoffHz_ {20000.0f};
    std::atomic<float> pDriftAmount_    {0.2f};
    std::atomic<float> pDriftRate_      {0.5f};
    std::atomic<float> pDriftSpread_    {0.5f};
    std::atomic<float> pDriftWarmup_    {2.0f};
    std::atomic<float> pDriftAge_       {0.0f};
    std::atomic<float> pDriftTempCorr_  {0.6f};
    std::atomic<float> pDriftSeed_      {4242.0f};
    std::atomic<float> pitchBendCents_  {0.0f};
    std::atomic<float> modWheel_        {0.0f};
};

} // namespace VectorWaves
