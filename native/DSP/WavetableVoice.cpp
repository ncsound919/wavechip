// ============================================================================
//  VectorWaves — WavetableVoice implementation (M0)
//  Pure C++20. No JUCE, no allocation in process().
// ============================================================================

#include "WavetableVoice.h"

#include <algorithm>
#include <cmath>
#include <numbers>

namespace VectorWaves {

// ---------------------------------------------------------------------------
//  Constructor
// ---------------------------------------------------------------------------
WavetableVoice::WavetableVoice() {
    drift_.seed(0xABCD1234u);
}

// ---------------------------------------------------------------------------
//  prepare
// ---------------------------------------------------------------------------
void WavetableVoice::prepare(double sampleRate) noexcept {
    sr_ = sampleRate > 0.0 ? sampleRate : 44100.0;

    // Set initial ADSR coefficients
    adsr_.setParams(
        pAttackSec_ .load(std::memory_order_relaxed),
        pDecaySec_  .load(std::memory_order_relaxed),
        pSustainLevel_.load(std::memory_order_relaxed),
        pReleaseSec_.load(std::memory_order_relaxed),
        static_cast<float>(sr_)
    );

    // Set initial filter coefficient
    filter_.setCoeff(pFilterCutoffHz_.load(std::memory_order_relaxed),
                     static_cast<float>(sr_));

    controlCount_ = 0;
    phase_        = 0.0;
    phaseInc_     = 0.0;
}

// ---------------------------------------------------------------------------
//  noteOn
// ---------------------------------------------------------------------------
void WavetableVoice::noteOn(int midiNote, float velocity) noexcept {
    midiNote_ = std::max(0, std::min(midiNote, 127));
    velocity_ = std::max(0.0f, std::min(velocity, 1.0f));

    const float tuneCents = pTuneCents_.load(std::memory_order_relaxed);
    const float freq      = midiToHz(midiNote_, tuneCents);
    phaseInc_ = freq / sr_;

    // Reset/re-seed drift for deterministic personality
    const uint32_t driftSeed = static_cast<uint32_t>(midiNote_ * 1337 + 42);
    drift_.seed(driftSeed);

    const float warmupSec  = pDriftWarmup_.load(std::memory_order_relaxed);
    const int   warmupTicks = static_cast<int>(warmupSec * static_cast<float>(sr_) / kControlPeriod);
    drift_.setWarmup(warmupTicks);
    drift_.burnWarmup();

    adsr_.noteOn();
}

// ---------------------------------------------------------------------------
//  noteOff
// ---------------------------------------------------------------------------
void WavetableVoice::noteOff() noexcept {
    adsr_.noteOff();
}

// ---------------------------------------------------------------------------
//  setParam — real-time safe atomic store
// ---------------------------------------------------------------------------
void WavetableVoice::setParam(int id, float value) noexcept {
    // Clamp to valid range
    value = clampPlain(id, value);

    switch (static_cast<ParamId>(id)) {
    case kMasterGain:      pMasterGain_    .store(value, std::memory_order_relaxed); break;
    case kTuneCents:       pTuneCents_     .store(value, std::memory_order_relaxed); break;
    case kAttackSeconds:   pAttackSec_     .store(value, std::memory_order_relaxed); break;
    case kDecaySeconds:    pDecaySec_      .store(value, std::memory_order_relaxed); break;
    case kSustainLevel:    pSustainLevel_  .store(value, std::memory_order_relaxed); break;
    case kReleaseSeconds:  pReleaseSec_    .store(value, std::memory_order_relaxed); break;
    case kFilterCutoffHz:  pFilterCutoffHz_.store(value, std::memory_order_relaxed); break;
    case kDriftAmount:     pDriftAmount_   .store(value, std::memory_order_relaxed); break;
    case kDriftRate:       pDriftRate_     .store(value, std::memory_order_relaxed); break;
    case kDriftSpread:     pDriftSpread_   .store(value, std::memory_order_relaxed); break;
    case kDriftWarmup:     pDriftWarmup_   .store(value, std::memory_order_relaxed); break;
    case kDriftAge:        pDriftAge_      .store(value, std::memory_order_relaxed); break;
    case kDriftTempCorr:   pDriftTempCorr_.store(value, std::memory_order_relaxed); break;
    case kDriftSeed:       pDriftSeed_     .store(value, std::memory_order_relaxed); break;
    default: break;
    }
}

// ---------------------------------------------------------------------------
//  applyControlRate — called every kControlPeriod samples from process()
// ---------------------------------------------------------------------------
void WavetableVoice::applyControlRate() noexcept {
    const float sr = static_cast<float>(sr_);

    // --- ADSR coefficients ---
    adsr_.setAttack (pAttackSec_    .load(std::memory_order_relaxed), sr);
    adsr_.setDecay  (pDecaySec_     .load(std::memory_order_relaxed), sr);
    adsr_.setSustain(pSustainLevel_ .load(std::memory_order_relaxed));
    adsr_.setRelease(pReleaseSec_   .load(std::memory_order_relaxed), sr);

    // --- Drift advance ---
    // Temp coefficient biases drift depth (warmer silicon wanders more).
    const float driftRate   = pDriftRate_  .load(std::memory_order_relaxed);
    const float tempCorr    = pDriftTempCorr_.load(std::memory_order_relaxed);
    const float driftAmount = pDriftAmount_.load(std::memory_order_relaxed)
                              * (0.3f + 0.7f * tempCorr);
    const DriftOutput drift = drift_.update(driftRate, driftAmount);

    // Deterministic personality: reseed only when the seed parameter changes
    // (setParam is called every block, so blind reseeding would kill drift).
    const auto seedVal = static_cast<uint32_t>(pDriftSeed_.load(std::memory_order_relaxed));
    if (seedVal != lastSeed_)
    {
        lastSeed_ = seedVal;
        drift_.seed(seedVal);
    }

    // Level drift: apply the mild amplitude wander the oscillator already computes.
    levelMod_ = drift.levelMod;

    // Apply pitch drift and pitch bend to phaseInc_
    const float tuneCents  = pTuneCents_.load(std::memory_order_relaxed);
    const float pitchBend  = pitchBendCents_.load(std::memory_order_relaxed);
    const float totalCents = tuneCents + drift.pitchCents + pitchBend;
    const float freq = midiToHz(midiNote_, totalCents);
    phaseInc_ = freq / sr_;

    // Apply filter drift: drift.filterMod in [-1,1], modulates cutoff ±2 octaves
    const float baseCutoff = pFilterCutoffHz_.load(std::memory_order_relaxed);
    const float driftedCutoff = baseCutoff * std::pow(2.0f, drift.filterMod * 2.0f);
    filter_.setCoeff(std::max(20.0f, std::min(driftedCutoff, sr * 0.4999f)), sr);

    // The mip level depends only on pitch, which is resolved here — selecting it per
    // sample meant a log2() call inside the render loop.
    mipLvl_ = selectMip(static_cast<float>(phaseInc_ * sr_));
}

// ---------------------------------------------------------------------------
//  process — the render loop. ZERO allocation. ZERO I/O.
// ---------------------------------------------------------------------------
void WavetableVoice::process(float* outL, float* outR, int numFrames) noexcept {
    if (!adsr_.isActive() && adsr_.level() < 1e-6f)
        return; // silent — do not write zeros over existing buffer content

    const float gain = pMasterGain_.load(std::memory_order_relaxed);

    for (int i = 0; i < numFrames; ++i) {
        // Control-rate boundary
        if (controlCount_ == 0)
            applyControlRate();

        if (++controlCount_ >= kControlPeriod)
            controlCount_ = 0;

        // Wavetable read (cubic interpolation inside mipMap_.read); the mip level is
        // resolved once per control period in applyControlRate().
        const float sample  = mipMap_.read(mipLvl_, phase_);

        // Advance phase
        phase_ += phaseInc_;
        if (phase_ >= 1.0) phase_ -= 1.0;

        // ADSR
        const float env   = adsr_.process();

        // One-pole LPF
        const float filt  = filter_.process(sample);

        // Final sample (level drift wander is subtle; envelope still gates it)
        const float out   = filt * env * velocity_ * gain * (1.0f + levelMod_);

        // Stereo widening: R gets a 7-sample Haas delay (~0.16 ms @ 44.1 kHz).
        // Read before writing so the delay really is 7 samples (it used to read the
        // just-advanced slot, which delivered only 6).
        const float delayedR = stereoDelayBuf_[stereoDelayIdx_];
        stereoDelayBuf_[stereoDelayIdx_] = out;
        stereoDelayIdx_ = (stereoDelayIdx_ + 1) % 7;
        outL[i] += out;
        outR[i] += delayedR;
    }
}

// ---------------------------------------------------------------------------
//  loadTable — message thread / background thread only.
// ---------------------------------------------------------------------------
void WavetableVoice::loadTable(const float* cycle2048, int sr) {
    // build() fills the inactive buffer slot and atomically publishes it.
    // MUST NOT be called from the render callback.
    mipMap_.build(cycle2048, sr);
}

} // namespace VectorWaves
