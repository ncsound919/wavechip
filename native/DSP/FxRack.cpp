// ============================================================================
//  VectorWaves — FxRack implementation
//  Pure C++20. No JUCE, no allocation in process().
// ============================================================================

#include "FxRack.h"
#include <cmath>
#include <numbers>
#include <algorithm>

namespace VectorWaves {

FxRack::FxRack() noexcept {
    reset();
}

void FxRack::prepare(float sampleRate) noexcept {
    sr_ = sampleRate > 8000.0f ? sampleRate : 44100.0f;

    inDcL_.prepare (sr_);  inDcR_.prepare (sr_);
    outDcL_.prepare (sr_); outDcR_.prepare (sr_);

    // Filters
    preEmphL_.setHiShelf(4000.0f, 3.0f, sr_);
    preEmphR_.setHiShelf(4000.0f, 3.0f, sr_);
    masterLpfL_.setCoeff(lpfCutoffHz_, sr_);
    masterLpfR_.setCoeff(lpfCutoffHz_, sr_);

    delayDampL_.setCoeff(3500.0f, sr_);
    delayDampR_.setCoeff(3500.0f, sr_);

    // Reverb Pre-allocation (Schroeder-Moorer delay times scaled to sample rate)
    // Comb filter base lengths at 44.1kHz: 1116, 1188, 1277, 1356 (prime tuned)
    static constexpr std::array<int, 4> kBaseCombL = { 1116, 1188, 1277, 1356 };
    static constexpr std::array<int, 4> kBaseCombR = { 1139, 1211, 1300, 1379 };
    const float scale = sr_ / 44100.0f;

    for (size_t i = 0; i < 4; ++i) {
        combsL_[i].setSize(static_cast<size_t>(kBaseCombL[i] * scale));
        combsR_[i].setSize(static_cast<size_t>(kBaseCombR[i] * scale));
    }

    // All-pass diffuser lengths: 225, 556
    static constexpr std::array<int, 2> kBaseAllPassL = { 225, 556 };
    static constexpr std::array<int, 2> kBaseAllPassR = { 248, 579 };

    for (size_t i = 0; i < 2; ++i) {
        allPassL_[i].setSize(static_cast<size_t>(kBaseAllPassL[i] * scale));
        allPassR_[i].setSize(static_cast<size_t>(kBaseAllPassR[i] * scale));
    }

    chorusBufferL_.assign(kChorusBufferSize, 0.0f);
    chorusBufferR_.assign(kChorusBufferSize, 0.0f);
    delayBufferL_.assign(kDelayBufferSize, 0.0f);
    delayBufferR_.assign(kDelayBufferSize, 0.0f);

    reset();
}

void FxRack::reset() noexcept {
    inDcL_.reset(); inDcR_.reset();
    outDcL_.reset(); outDcR_.reset();
    if (!chorusBufferL_.empty()) {
        std::fill(chorusBufferL_.begin(), chorusBufferL_.end(), 0.0f);
        std::fill(chorusBufferR_.begin(), chorusBufferR_.end(), 0.0f);
    }
    chorusWritePos_ = 0;
    chorusLfoPhase_ = 0.0f;

    if (!delayBufferL_.empty()) {
        std::fill(delayBufferL_.begin(), delayBufferL_.end(), 0.0f);
        std::fill(delayBufferR_.begin(), delayBufferR_.end(), 0.0f);
    }
    delayWritePos_ = 0;

    for (auto& c : combsL_) c.setSize(c.buffer.size());
    for (auto& c : combsR_) c.setSize(c.buffer.size());
    for (auto& a : allPassL_) a.setSize(a.buffer.size());
    for (auto& a : allPassR_) a.setSize(a.buffer.size());
}

float FxRack::normToLogHz(float norm, float sr) noexcept {
    const float logMin = std::log(20.0f);
    const float logMax = std::log(sr * 0.4999f);
    return std::exp(logMin + norm * (logMax - logMin));
}

float FxRack::softClip(float x) noexcept {
    return std::tanh(x);
}

void FxRack::setSaturation(float drive) noexcept {
    const float d = drive * 8.0f;
    // Only mark dirty on an actual change — this is called every block, and the
    // shelf rebuild costs a pow() plus a sin/cos pair.
    if (! satDirty_ && std::fabs (d - satDrive_) < 1e-5f) return;
    satDrive_ = d;
    satDirty_ = true;  // BUG-5: defer shelf recalc to process()
}

void FxRack::setMasterLpf(float normCutoff) noexcept {
    const float hz = normToLogHz(normCutoff, sr_);
    if (! lpfDirty_ && std::fabs (hz - lpfCutoffHz_) < 1e-3f) return;
    lpfCutoffHz_ = hz;
    lpfDirty_ = true;  // BUG-5: defer coeff recalc to process()
}

void FxRack::setChorus(float mix, float rate) noexcept {
    chorusMix_  = std::clamp(mix, 0.0f, 1.0f);
    chorusRate_ = std::clamp(rate, 0.05f, 5.0f);
}

void FxRack::setDelay(float mix, float time) noexcept {
    delayMix_     = std::clamp(mix, 0.0f, 1.0f);
    delayTimeSec_ = 0.06f + std::clamp(time, 0.0f, 1.0f) * 0.74f; // 60ms .. 800ms
}

void FxRack::setReverb(float mix) noexcept {
    reverbMix_ = std::clamp(mix, 0.0f, 1.0f);
}

void FxRack::process(float* L, float* R, int numFrames,
                     float satAmt, float lpfNorm, float masterGain) noexcept {
    setSaturation(satAmt);
    setMasterLpf(lpfNorm);

    // BUG-5: Only recalculate filter coefficients when parameters actually changed
    if (satDirty_) {
        const float shelfGainDb = (satDrive_ / 8.0f) * 6.0f;
        preEmphL_.setHiShelf(4000.0f, shelfGainDb, sr_);
        preEmphR_.setHiShelf(4000.0f, shelfGainDb, sr_);
        satDirty_ = false;
    }
    if (lpfDirty_) {
        masterLpfL_.setCoeff(lpfCutoffHz_, sr_);
        masterLpfR_.setCoeff(lpfCutoffHz_, sr_);
        lpfDirty_ = false;
    }

    const float drive = satDrive_;
    // tanh(drive) is constant for the whole block: hoist it out of the sample loop.
    const float driveNorm = (drive > 1e-4f) ? 1.0f / std::tanh (drive) : 1.0f;
    const float dtLfo = (chorusRate_ * 2.0f * std::numbers::pi_v<float>) / sr_;
    const size_t delaySamples = std::clamp(static_cast<size_t>(delayTimeSec_ * sr_), size_t(1), kDelayBufferSize - 1);

    for (int i = 0; i < numFrames; ++i) {
        float l = inDcL_.process (L[i]);
        float r = inDcR_.process (R[i]);

        // -------------------------------------------------------------------
        //  1. Analog Stage (Pre-emphasis + Soft Saturation + Post LPF)
        // -------------------------------------------------------------------
        if (drive > 1e-4f) {
            l = preEmphL_.process(l);
            r = preEmphR_.process(r);

            l = std::tanh(l * drive) * driveNorm;
            r = std::tanh(r * drive) * driveNorm;

            l = masterLpfL_.process(l);
            r = masterLpfR_.process(r);
        }

        // -------------------------------------------------------------------
        //  2. BBD Stereo Chorus (Dual quadrature delay modulation)
        // -------------------------------------------------------------------
        if (chorusMix_ > 0.001f) {
            chorusBufferL_[chorusWritePos_] = l;
            chorusBufferR_[chorusWritePos_] = r;

            // LFOs in quadrature (0 and 90 degrees)
            const float modL = std::sin(chorusLfoPhase_);
            const float modR = std::cos(chorusLfoPhase_);
            chorusLfoPhase_ += dtLfo;
            if (chorusLfoPhase_ >= 2.0f * std::numbers::pi_v<float>)
                chorusLfoPhase_ -= 2.0f * std::numbers::pi_v<float>;

            // Center delay 10ms, modulation depth +/- 4ms
            const float baseDelay = 0.010f * sr_;
            const float depth     = 0.004f * sr_;

            const float tapDelayL = baseDelay + modL * depth;
            const float tapDelayR = baseDelay + modR * depth;

            // BUG-3 fix: use fmod with 2x buffer size to prevent underflow
            auto readChorus = [](const std::vector<float>& buf, size_t wPos, float delay) {
                const float rPos = std::fmod(
                    static_cast<float>(wPos) - delay + static_cast<float>(kChorusBufferSize) * 2.0f,
                    static_cast<float>(kChorusBufferSize));
                const size_t i0 = static_cast<size_t>(rPos) % kChorusBufferSize;
                const size_t i1 = (i0 + 1) % kChorusBufferSize;
                const float frac = rPos - std::floor(rPos);
                return buf[i0] + (buf[i1] - buf[i0]) * frac;
            };

            const float wetL = readChorus(chorusBufferL_, chorusWritePos_, tapDelayL);
            const float wetR = readChorus(chorusBufferR_, chorusWritePos_, tapDelayR);

            chorusWritePos_ = (chorusWritePos_ + 1) % kChorusBufferSize;

            l = l * (1.0f - chorusMix_ * 0.5f) + wetL * (chorusMix_ * 0.7f);
            r = r * (1.0f - chorusMix_ * 0.5f) + wetR * (chorusMix_ * 0.7f);
        }

        // -------------------------------------------------------------------
        //  3. Tape Delay (Ping-pong feedback with tape damping)
        // -------------------------------------------------------------------
        if (delayMix_ > 0.001f) {
            // ENHANCEMENT-2: Tape wow LFO (~0.3 Hz, ±3 samples)
            tapeWowPhase_ += (0.3f * 2.0f * std::numbers::pi_v<float>) / sr_;
            if (tapeWowPhase_ >= 2.0f * std::numbers::pi_v<float>)
                tapeWowPhase_ -= 2.0f * std::numbers::pi_v<float>;
            const float wowOffset = std::sin(tapeWowPhase_) * 3.0f;
            const size_t wowReadPos = (delayWritePos_ + kDelayBufferSize -
                static_cast<size_t>(delaySamples + 1 + static_cast<size_t>(wowOffset + 3.0f))) % kDelayBufferSize;

            const float delayedL = delayBufferL_[wowReadPos];
            const float delayedR = delayBufferR_[wowReadPos];

            // Ping-pong cross feedback with tape saturation and high-frequency damping
            const float fbL = delayDampL_.process(std::tanh(delayedR * delayFeedback_));
            const float fbR = delayDampR_.process(std::tanh(delayedL * delayFeedback_));

            delayBufferL_[delayWritePos_] = l + fbL;
            delayBufferR_[delayWritePos_] = r + fbR;
            delayWritePos_ = (delayWritePos_ + 1) % kDelayBufferSize;

            l = l * (1.0f - delayMix_) + delayedL * delayMix_;
            r = r * (1.0f - delayMix_) + delayedR * delayMix_;
        }

        // -------------------------------------------------------------------
        //  4. Plate Reverb (Schroeder-Moorer algorithmic reverberator)
        // -------------------------------------------------------------------
        if (reverbMix_ > 0.001f) {
            const float revInL = l * 0.5f;
            const float revInR = r * 0.5f;

            // 4 Parallel Comb Filters
            float combSumL = 0.0f;
            float combSumR = 0.0f;
            for (size_t c = 0; c < 4; ++c) {
                combSumL += combsL_[c].process(revInL);
                combSumR += combsR_[c].process(revInR);
            }

            // 2 Cascaded All-Pass Diffusers
            float apL = combSumL;
            float apR = combSumR;
            for (size_t a = 0; a < 2; ++a) {
                apL = allPassL_[a].process(apL);
                apR = allPassR_[a].process(apR);
            }

            // ENHANCEMENT-1: Stereo cross-feed for more diffuse plate sound
            const float crossAmt = 0.12f;
            const float xL = apL * (1.0f - crossAmt) + apR * crossAmt;
            const float xR = apR * (1.0f - crossAmt) + apL * crossAmt;

            l = l * (1.0f - reverbMix_ * 0.4f) + xL * (reverbMix_ * 0.6f);
            r = r * (1.0f - reverbMix_ * 0.4f) + xR * (reverbMix_ * 0.6f);
        }

        // -------------------------------------------------------------------
        //  5. Master Gain & Soft Peak Limiter Protection
        // -------------------------------------------------------------------
        l *= masterGain;
        r *= masterGain;

        // BUG-4 fix: knee clipper — passes signal below 0.85 unchanged
        auto kneeClip = [](float x) noexcept -> float {
            const float absX = std::abs(x);
            if (absX <= 0.85f) return x;
            const float sign = x > 0.0f ? 1.0f : -1.0f;
            return sign * (0.85f + (1.0f - std::exp(-(absX - 0.85f) * 6.0f)) * 0.1f);
        };
        l = kneeClip(l);
        r = kneeClip(r);

        L[i] = outDcL_.process (l);
        R[i] = outDcR_.process (r);
    }
}

} // namespace VectorWaves