// ============================================================================
//  VectorWaves — ChipCore implementation (Enhanced Silicon Engine)
//  Pure C++20. No JUCE, no allocation, no locks.
// ============================================================================

#include "ChipCore.h"
#include <cstring>
#include <cmath>
#include <numbers>
#include <algorithm>

namespace VectorWaves {

// 16-step AY-3-8910 logarithmic DAC voltage ladder (1.5 dB per step)
static constexpr std::array<float, 16> kAyDacTable = {{
    0.000000f, 0.009995f, 0.014451f, 0.021009f,
    0.030201f, 0.043245f, 0.062167f, 0.088656f,
    0.126590f, 0.180425f, 0.255973f, 0.363073f,
    0.511840f, 0.718136f, 0.871559f, 1.000000f
}};

// 32-step YM2149 logarithmic DAC ladder (higher resolution)
static constexpr std::array<float, 32> kYm2149DacTable = {{
    0.000000f, 0.007071f, 0.009995f, 0.012247f, 0.014451f, 0.017735f, 0.021009f, 0.025603f,
    0.030201f, 0.036723f, 0.043245f, 0.052706f, 0.062167f, 0.075412f, 0.088656f, 0.107623f,
    0.126590f, 0.153508f, 0.180425f, 0.218200f, 0.255973f, 0.309523f, 0.363073f, 0.437457f,
    0.511840f, 0.614988f, 0.718136f, 0.794848f, 0.871559f, 0.935780f, 0.967890f, 1.000000f
}};

ChipCore::ChipCore() noexcept {
    // Initialise 128-byte Wave RAM with retro waveforms
    for (int i = 0; i < 128; ++i) {
        const int cycle32 = i % 32;
        int v = (cycle32 < 16) ? cycle32 : (31 - cycle32);
        waveRam_[static_cast<size_t>(i)] = static_cast<uint8_t>(std::clamp(v, 0, 15));
    }
    reset();
    updateDerived();
}

void ChipCore::prepare(double sampleRate) noexcept {
    sampleRate_ = sampleRate > 8000.0 ? sampleRate : 44100.0;
    dcL_.prepare (static_cast<float> (sampleRate_));
    dcR_.prepare (static_cast<float> (sampleRate_));
    reset();
    updateDerived();
}

void ChipCore::reset() noexcept {
    dcL_.reset();
    dcR_.reset();
    for (auto& v : voices_) {
        v.phase24    = 0;
        v.lfsrState  = 0x7FFFFF;
        v.psgPeriod  = 1;
        v.psgCounter = 0;
        v.psgOutput  = false;
        v.noisePeriod  = 8;
        v.noiseCounter = 0;
        v.noiseBit     = false;
        v.fmPhase.fill(0.0f);
        v.fmEnv.fill(0.0f);
        v.fmFb1      = 0.0f;
        v.fmFb2      = 0.0f;
        v.ramPhase   = 0.0f;
        v.svfLp      = 0.0f;
        v.svfBp      = 0.0f;
        v.envStage   = VoiceSlot::EnvStage::Idle;
        v.envLevel   = 0.0f;
    }
    pwmLfoPhase_ = 0.0f;
    lastSample_  = 0.0f;
}

void ChipCore::noteOn(int midiNote, float velocity) noexcept {
    gate_        = true;
    currentNote_ = std::clamp(midiNote, 0, 127);
    velocity_    = std::clamp(velocity, 0.0f, 1.0f);

    const int activeCount = std::clamp(rackInstances_, 1, 8);
    for (int i = 0; i < activeCount; ++i) {
        auto& v = voices_[static_cast<size_t>(i)];
        v.envStage = VoiceSlot::EnvStage::Attack;
    }
}

void ChipCore::noteOff() noexcept {
    gate_ = false;
    for (auto& v : voices_) {
        if (v.envStage != VoiceSlot::EnvStage::Idle)
            v.envStage = VoiceSlot::EnvStage::Release;
    }
}

void ChipCore::setPitchBend(float bend) noexcept {
    pitchBend_ = std::clamp(bend, -1.0f, 1.0f);
}

void ChipCore::setModWheel(float mod) noexcept {
    modWheel_ = std::clamp(mod, 0.0f, 1.0f);
}

void ChipCore::setWaveRamNibble(int index, int val) noexcept {
    if (index >= 0 && index < 128)
        waveRam_[static_cast<size_t>(index)] = static_cast<uint8_t>(std::clamp(val, 0, 255));
}

void ChipCore::setWaveRamAll(const uint8_t* nibbles, int count) noexcept {
    if (!nibbles) return;
    const int copyLen = std::min(count, 128);
    for (int i = 0; i < copyLen; ++i)
        waveRam_[static_cast<size_t>(i)] = nibbles[i];
}

void ChipCore::triggerSync() noexcept {
    for (auto& v : voices_) {
        v.phase24 = 0;
        v.fmPhase[0] = 0.0f;
        v.ramPhase = 0.0f;
    }
}

// ---------------------------------------------------------------------------
//  Derived coefficients — recomputed only when a parameter changes, never per sample.
// ---------------------------------------------------------------------------
void ChipCore::updateDerived() noexcept {
    const float sr = static_cast<float>(sampleRate_);

    // Resonant filter: TPT/state-variable topology. g = tan(pi*fc/fs) with the
    // cutoff clamped below Nyquist, k = 2R damping.
    const float fcHz = 20.0f * std::pow(900.0f, cutoff_);
    const float fc   = std::min(fcHz, 0.45f * sr);
    filterG_  = std::tan(std::numbers::pi_v<float> * fc / sr);
    filterK_  = 2.0f * (1.0f - resonance_ * 0.95f);
    filterA1_ = 1.0f / (1.0f + filterG_ * (filterG_ + filterK_));
    filterA2_ = filterG_ * filterA1_;

    // DAC ladder: half-step scaling used by the quantiser (0 = bypass / 12-bit+).
    quantScale_ = (dacBits_ >= 12) ? 0.0f : 0.5f * std::pow(2.0f, static_cast<float>(dacBits_));

    // AY-3-8910 noise divider (register R6) is independent of the tone divider.
    // Hardware: noise clock = (master/16) / (2 * N6); N6 = 8 gives a bright hiss.
    constexpr float kN6 = 8.0f;
    const double psgClk = getMasterClockHz() / 16.0;
    const double noiseRateHz = std::max(1.0, psgClk / (2.0 * kN6));
    noisePeriodF_ = static_cast<float>(std::max(1.0, sampleRate_ / noiseRateHz));
}

void ChipCore::setParam(int id, float value) noexcept {
    switch (id) {
        case kChipFamily:          family_          = static_cast<int>(value); break;
        case kChipVariant:         variant_         = static_cast<int>(value); break;
        case kChipRackInstances:   rackInstances_   = std::clamp(static_cast<int>(value), 1, 8); break;
        case kChipAuthenticTuning: authenticTuning_ = (value >= 0.5f); break;
        case kChipWaveTri:         waveTri_         = (value >= 0.5f); break;
        case kChipWaveSaw:         waveSaw_         = (value >= 0.5f); break;
        case kChipWavePulse:       wavePulse_       = (value >= 0.5f); break;
        case kChipWaveNoise:       waveNoise_       = (value >= 0.5f); break;
        case kChipPulseWidth:      pulseWidth_      = std::clamp(value, 0.05f, 0.95f); break;
        case kChipAttack:          attack_          = std::clamp(value, 0.001f, 5.0f); break;
        case kChipDecay:           decay_           = std::clamp(value, 0.001f, 5.0f); break;
        case kChipSustain:         sustain_         = std::clamp(value, 0.0f, 1.0f); break;
        case kChipRelease:         release_         = std::clamp(value, 0.001f, 10.0f); break;
        case kChipFilterMode:      filterMode_      = static_cast<int>(value); break;
        case kChipCutoff:          cutoff_          = std::clamp(value, 0.0f, 1.0f); updateDerived(); break;
        case kChipReso:            resonance_       = std::clamp(value, 0.0f, 1.0f); updateDerived(); break;
        case kChipFilterCurve:     filterCurve_     = std::clamp(value, 0.0f, 1.0f); break;
        case kChipFilterBias:      filterBias_      = std::clamp(value, -1.0f, 1.0f); break;
        case kChipClock:           clockStandard_   = static_cast<int>(value); updateDerived(); break;
        case kChipDacBits:         dacBits_         = std::clamp(static_cast<int>(value), 4, 12); updateDerived(); break;
        case kChipFmAlgo:          fmAlgo_          = std::clamp(static_cast<int>(value), 0, 7); break;
        case kChipFmFeedback:      fmFeedback_      = std::clamp(static_cast<int>(value), 0, 7); break;
        case kChipNoiseLfsr:       noiseLfsrMode_   = std::clamp(static_cast<int>(value), 0, 2); break;
        case kChipWaveRamLen:      waveRamLength_   = std::clamp(static_cast<int>(value), 16, 128); break;
        case kChipPwmRate:         pwmRate_         = std::clamp(value, 0.0f, 1.0f); break;
        case kChipPwmDepth:        pwmDepth_        = std::clamp(value, 0.0f, 1.0f); break;
        default: break;
    }
}

double ChipCore::getSlotFrequency(int slotIdx) const noexcept {
    const double bendSemitones = static_cast<double>(pitchBend_) * 2.0;
    const double baseMidi = static_cast<double>(currentNote_) + bendSemitones;

    double detuneCents = 0.0;
    if (rackInstances_ > 1) {
        const double normSlot = (2.0 * slotIdx / (rackInstances_ - 1)) - 1.0;
        detuneCents = normSlot * 12.0;
    }

    const double continuousHz = 440.0 * std::pow(2.0, (baseMidi - 69.0 + detuneCents / 100.0) / 12.0);

    if (!authenticTuning_)
        return continuousHz;

    const double masterClk = getMasterClockHz();
    if (family_ == 0) {
        // SID: 24-bit accumulator divider
        const uint32_t freqReg = static_cast<uint32_t>(std::clamp((continuousHz * 16777216.0) / masterClk, 0.0, 65535.0));
        return (static_cast<double>(freqReg) * masterClk) / 16777216.0;
    } else if (family_ == 1) {
        // PSG (AY-3-8910): 12-bit period divider down from clk/16
        const double psgClock = masterClk / 16.0;
        const uint32_t period = static_cast<uint32_t>(std::clamp(psgClock / std::max(1.0, continuousHz * 2.0), 1.0, 4095.0));
        return psgClock / (2.0 * static_cast<double>(period));
    }

    return continuousHz;
}

// ---------------------------------------------------------------------------
//  SID (MOS 6581 & 8580) Sub-Engine
// ---------------------------------------------------------------------------
float ChipCore::renderSidVoice(VoiceSlot& voice, double freqHz, float activePw) noexcept {
    const double masterClk = getMasterClockHz();
    const uint32_t step = static_cast<uint32_t>(std::clamp((freqHz * 16777216.0) / masterClk, 0.0, 16777215.0));
    const uint32_t prevPhase = voice.phase24;
    voice.phase24 = (voice.phase24 + step) & 0xFFFFFF;

    // 12-bit oscillator waveforms
    uint32_t tri12 = (voice.phase24 >> 12);
    if (voice.phase24 & 0x800000)
        tri12 ^= 0xFFF;

    const uint32_t saw12 = (voice.phase24 >> 12) & 0xFFF;
    const uint32_t pwThreshold = static_cast<uint32_t>(activePw * 4095.0f);
    const bool pulseState = (saw12 >= pwThreshold);

    // 23-bit SID Galois LFSR noise: taps at 22 & 17
    if (!(prevPhase & 0x080000) && (voice.phase24 & 0x080000)) {
        const uint32_t b22 = (voice.lfsrState >> 22) & 1;
        const uint32_t b17 = (voice.lfsrState >> 17) & 1;
        voice.lfsrState = ((voice.lfsrState << 1) | (b22 ^ b17)) & 0x7FFFFF;
    }
    // Authentic SID noise output: 8 bits from non-consecutive LFSR taps
    // (SID 6581 bit positions: 0,2,5,9,11,14,18,20,22 of the 23-bit LFSR)
    const uint32_t s = voice.lfsrState;
    const uint32_t noiseByte = ((s >> 0)  & 1) << 7 |
                                ((s >> 2)  & 1) << 6 |
                                ((s >> 5)  & 1) << 5 |
                                ((s >> 9)  & 1) << 4 |
                                ((s >> 11) & 1) << 3 |
                                ((s >> 14) & 1) << 2 |
                                ((s >> 18) & 1) << 1 |
                                ((s >> 22) & 1) << 0;
    const uint32_t noise12 = noiseByte << 4; // scale to 12-bit range

    // Check for Authentic MOS Transistor Combined Waveforms:
    float sig = 0.0f;
    const int combo = (waveTri_ ? 1 : 0) | (waveSaw_ ? 2 : 0) | (wavePulse_ ? 4 : 0) | (waveNoise_ ? 8 : 0);

    switch (combo) {
        case 1:  // Tri only
            sig = (static_cast<float>(tri12) / 2048.0f) - 1.0f;
            break;
        case 2:  // Saw only
            sig = (static_cast<float>(saw12) / 2048.0f) - 1.0f;
            break;
        case 4:  // Pulse only
            sig = pulseState ? 1.0f : -1.0f;
            break;
        case 8:  // Noise only
            sig = (static_cast<float>(noise12) / 2048.0f) - 1.0f;
            break;
        case 3:  // Tri + Saw (0x30): MOS diode pulldown
            // FIX: was /1024.0f which could reach ~2.99 — now /2048.0f to stay in [-1,1]
            sig = (static_cast<float>(tri12 & saw12) / 2048.0f) - 1.0f;
            break;
        case 5:  // Tri + Pulse (0x50): Gated triangle
            sig = (pulseState ? (static_cast<float>(tri12) / 2048.0f) : -0.5f);
            break;
        case 6:  // Saw + Pulse (0x60): Authentic MOS ladder crunch
            // FIX: was /1024.0f which could reach ~1.5 — now /2048.0f to stay in [-1,1]
            sig = pulseState ? ((static_cast<float>(saw12 & (saw12 >> 1)) / 2048.0f) - 0.5f) : -1.0f;
            break;
        case 7:  // Tri + Saw + Pulse (0x70)
            // FIX: was /1024.0f which could reach ~3.49 — now /2048.0f to stay in [-1,1]
            sig = pulseState ? (static_cast<float>(tri12 & saw12) / 2048.0f) - 0.5f : -1.0f;
            break;
        default:
            if (waveSaw_) sig = (static_cast<float>(saw12) / 2048.0f) - 1.0f;
            else if (wavePulse_) sig = pulseState ? 1.0f : -1.0f;
            else if (waveTri_) sig = (static_cast<float>(tri12) / 2048.0f) - 1.0f;
            else sig = (static_cast<float>(saw12) / 2048.0f) - 1.0f;
            break;
    }

    return sig;
}

// ---------------------------------------------------------------------------
//  PSG (AY-3-8910 / YM2149) Sub-Engine
// ---------------------------------------------------------------------------
float ChipCore::renderPsgVoice(VoiceSlot& voice, double freqHz) noexcept {
    const double masterClk = getMasterClockHz();
    const double psgClk = masterClk / 16.0;
    const uint32_t period = static_cast<uint32_t>(std::clamp(psgClk / std::max(1.0, freqHz * 2.0), 1.0, 4095.0));

    voice.psgCounter++;
    if (voice.psgCounter >= period) {
        voice.psgCounter = 0;
        voice.psgOutput = !voice.psgOutput;
    }

    // Noise channel has its own divider (register R6), independent of the tone
    // divider, so the hiss spectrum no longer tracks the note pitch.
    const uint32_t noisePeriod = std::max(1u, static_cast<uint32_t>(noisePeriodF_));
    if (++voice.noiseCounter >= noisePeriod) {
        voice.noiseCounter = 0;

        if (noiseLfsrMode_ == 0) {
            // 15-bit: taps at 0 and 1
            const uint32_t b0 = voice.lfsrState & 1;
            const uint32_t b1 = (voice.lfsrState >> 1) & 1;
            voice.lfsrState = ((voice.lfsrState >> 1) | ((b0 ^ b1) << 14)) & 0x7FFF;
        } else if (noiseLfsrMode_ == 1) {
            // 17-bit (AY-3-8910 standard): taps at 0 and 3
            const uint32_t b0 = voice.lfsrState & 1;
            const uint32_t b3 = (voice.lfsrState >> 3) & 1;
            voice.lfsrState = ((voice.lfsrState >> 1) | ((b0 ^ b3) << 16)) & 0x1FFFF;
        } else {
            // 23-bit (SID standard): taps at 22 and 17
            const uint32_t b22 = (voice.lfsrState >> 22) & 1;
            const uint32_t b17 = (voice.lfsrState >> 17) & 1;
            voice.lfsrState = ((voice.lfsrState << 1) | (b22 ^ b17)) & 0x7FFFFF;
        }
    }
    voice.noiseBit = (voice.lfsrState & 1) != 0;

    // AY mixer: the enabled sources are ANDed (tone & noise), and a channel with
    // only one source enabled outputs that source.
    bool out = true;
    if (wavePulse_ || (! wavePulse_ && ! waveNoise_)) out = out && voice.psgOutput;
    if (waveNoise_) out = out && voice.noiseBit;

    return out ? 1.0f : -1.0f;
}

// ---------------------------------------------------------------------------
//  FM (Yamaha YM2612 / YM2151) Sub-Engine
// ---------------------------------------------------------------------------
float ChipCore::renderFmVoice(VoiceSlot& voice, double freqHz) noexcept {
    static constexpr std::array<float, 4> kRatios = { 1.0f, 2.0f, 1.0f, 1.0f };
    const float dt = static_cast<float>(freqHz / sampleRate_);

    // ENHANCEMENT-2: scale modulator depth by envelope so FM timbre decays naturally
    const float envScale = std::sqrt(std::max(0.0f, voice.envLevel));

    const float fbDepth = static_cast<float>(fmFeedback_) * 0.25f;
    const float fbMod = ((voice.fmFb1 + voice.fmFb2) * 0.5f) * fbDepth;

    // Op 1 (modulator)
    voice.fmPhase[0] += dt * kRatios[0];
    if (voice.fmPhase[0] >= 1.0f) voice.fmPhase[0] -= 1.0f;
    const float op1 = std::sin((voice.fmPhase[0] + fbMod) * 2.0f * std::numbers::pi_v<float>);
    voice.fmFb2 = voice.fmFb1;
    voice.fmFb1 = op1;

    // Op 2 (modulator) — modulation depth scaled by envScale
    voice.fmPhase[1] += dt * kRatios[1];
    if (voice.fmPhase[1] >= 1.0f) voice.fmPhase[1] -= 1.0f;
    const float op2 = std::sin((voice.fmPhase[1] + op1 * 0.5f * envScale) * 2.0f * std::numbers::pi_v<float>);

    // Op 3 (modulator) — modulation depth scaled by envScale
    voice.fmPhase[2] += dt * kRatios[2];
    if (voice.fmPhase[2] >= 1.0f) voice.fmPhase[2] -= 1.0f;
    const float op3 = std::sin((voice.fmPhase[2] + op2 * 0.5f * envScale) * 2.0f * std::numbers::pi_v<float>);

    // Op 4 (carrier) — NOT scaled by envScale; envelope applied by processEnvelope
    voice.fmPhase[3] += dt * kRatios[3];
    if (voice.fmPhase[3] >= 1.0f) voice.fmPhase[3] -= 1.0f;

    float carrier = 0.0f;
    switch (fmAlgo_) {
        case 0: carrier = std::sin((voice.fmPhase[3] + op3 * 0.7f * envScale) * 2.0f * std::numbers::pi_v<float>); break;
        case 1: carrier = std::sin((voice.fmPhase[3] + (op1 + op2) * 0.5f * envScale) * 2.0f * std::numbers::pi_v<float>); break;
        case 2: carrier = std::sin((voice.fmPhase[3] + op1 * 0.35f * envScale + op3 * 0.5f * envScale) * 2.0f * std::numbers::pi_v<float>); break;
        case 3: carrier = std::sin((voice.fmPhase[3] + (op2 + op3) * 0.5f * envScale) * 2.0f * std::numbers::pi_v<float>); break;
        case 4: carrier = (op2 * envScale + std::sin((voice.fmPhase[3] + op3 * 0.6f * envScale) * 2.0f * std::numbers::pi_v<float>)) * 0.5f; break;
        case 5: carrier = (op2 * envScale + op3 * envScale + std::sin((voice.fmPhase[3] + op1 * 0.5f * envScale) * 2.0f * std::numbers::pi_v<float>)) * 0.333f; break;
        case 6: carrier = (op2 * envScale + op3 * envScale + std::sin(voice.fmPhase[3] * 2.0f * std::numbers::pi_v<float>)) * 0.333f; break;
        case 7:
        default: carrier = (op1 * envScale + op2 * envScale + op3 * envScale + std::sin(voice.fmPhase[3] * 2.0f * std::numbers::pi_v<float>)) * 0.25f; break;
    }

    // YM2612 (Variant 0): Authentic Sega Genesis 9-bit DAC ladder crossover crunch
    if (variant_ == 0) {
        float q = std::round(carrier * 256.0f) / 256.0f;
        if (std::abs(q) < 0.05f) q *= 1.35f;
        return q;
    }

    return carrier;
}

// ---------------------------------------------------------------------------
//  Wave RAM (N163 / Game Boy / SCC / Namco WSG) Sub-Engine
// ---------------------------------------------------------------------------
float ChipCore::renderRamVoice(VoiceSlot& voice, double freqHz) noexcept {
    const int len = std::clamp(waveRamLength_, 16, 128);
    const float dt = static_cast<float>(freqHz / sampleRate_);
    voice.ramPhase += dt;
    if (voice.ramPhase >= 1.0f) voice.ramPhase -= 1.0f;

    const float exactPos = voice.ramPhase * static_cast<float>(len);
    const int idx0 = static_cast<int>(exactPos) % len;
    const int idx1 = (idx0 + 1) % len;
    const float frac = exactPos - std::floor(exactPos);

    const float s0 = (static_cast<float>(waveRam_[static_cast<size_t>(idx0)]) / 7.5f) - 1.0f;
    const float s1 = (static_cast<float>(waveRam_[static_cast<size_t>(idx1)]) / 7.5f) - 1.0f;

    // Game Boy (Variant 1) / SCC (Variant 3): 2x oversampled interpolation
    if (variant_ == 1 || variant_ == 3) {
        return s0 + (s1 - s0) * frac;
    }

    // N163 / Namco WSG: Authentic stepped DAC
    return s0;
}

// ---------------------------------------------------------------------------
//  Resonant Filter (SVF with 6581/8580 characteristics)
// ---------------------------------------------------------------------------
float ChipCore::processFilter(VoiceSlot& voice, float inSample) noexcept {
    if (filterMode_ == 3) return inSample;

    float x = inSample;

    // 6581 (Variant 0): transistor saturation and DC bias offset on the input stage.
    // Keeping the nonlinearity outside the integrators means the TPT filter stays
    // stable at any cutoff; the old in-loop tanh on a Chamberlin SVF could ring up
    // when a high cutoff met a high resonance.
    if (family_ == 0 && variant_ == 0) {
        auto fastTanh = [](float v) noexcept -> float {
            const float v2 = v * v;
            return v * (27.0f + v2) / (27.0f + 9.0f * v2);
        };
        x += filterBias_ * 0.15f;
        x = fastTanh(x * (1.0f + filterCurve_ * 0.5f));
    }

    // TPT (zero-delay-feedback) state-variable filter.
    const float v3 = x - voice.svfLp;
    const float v1 = filterA1_ * voice.svfBp + filterA2_ * v3;
    const float v2 = voice.svfLp + filterG_ * v1;
    voice.svfBp = 2.0f * v1 - voice.svfBp;
    voice.svfLp = 2.0f * v2 - voice.svfLp;

    switch (filterMode_) {
        case 1:  return v1;                              // bandpass
        case 2:  return x - filterK_ * v1 - v2;          // highpass
        default: return v2;                              // lowpass
    }
}

// ---------------------------------------------------------------------------
//  Volume Envelope Update
// ---------------------------------------------------------------------------
void ChipCore::processEnvelope(VoiceSlot& voice) noexcept {
    const float dt = static_cast<float>(1.0 / sampleRate_);

    switch (voice.envStage) {
        case VoiceSlot::EnvStage::Attack: {
            const float rate = 1.0f / std::max(0.001f, attack_);
            voice.envLevel += rate * dt;
            if (voice.envLevel >= 1.0f) {
                voice.envLevel = 1.0f;
                voice.envStage = VoiceSlot::EnvStage::Decay;
            }
            break;
        }
        case VoiceSlot::EnvStage::Decay: {
            const float rate = (1.0f - sustain_) / std::max(0.001f, decay_);
            voice.envLevel -= rate * dt;
            if (voice.envLevel <= sustain_) {
                voice.envLevel = sustain_;
                voice.envStage = VoiceSlot::EnvStage::Sustain;
            }
            break;
        }
        case VoiceSlot::EnvStage::Sustain: {
            voice.envLevel = sustain_;
            break;
        }
        case VoiceSlot::EnvStage::Release: {
            // FIX: use voice.envLevel (not sustain_) so release time is constant
            // regardless of whether note-off happened during Decay or Sustain.
            const float rate = voice.envLevel / std::max(0.001f, release_);
            voice.envLevel -= rate * dt;
            if (voice.envLevel <= 0.0f) {
                voice.envLevel = 0.0f;
                voice.envStage = VoiceSlot::EnvStage::Idle;
            }
            break;
        }
        case VoiceSlot::EnvStage::Idle:
            voice.envLevel = 0.0f;
            break;
    }
}

// ---------------------------------------------------------------------------
//  Main Render Loop
// ---------------------------------------------------------------------------
void ChipCore::process(float* outL, float* outR, int numFrames) noexcept {
    if (!outL && !outR) return;

    const int activeCount = std::clamp(rackInstances_, 1, 8);
    const float gainScale = 1.0f / std::sqrt(static_cast<float>(activeCount));

    // BUG-5 FIX: Pre-compute slot frequencies once per process() call.
    // getSlotFrequency() calls std::pow() which is expensive; note/pitchBend
    // do not change per-sample so this is safe and avoids O(voices*frames) pow calls.
    double slotFreqs[8];
    for (int i = 0; i < activeCount; ++i)
        slotFreqs[i] = getSlotFrequency(i);

    // PWM LFO increment: 0.1 Hz .. 8 Hz
    const float dtPwm = (0.1f + pwmRate_ * 7.9f) * 2.0f * std::numbers::pi_v<float> / static_cast<float>(sampleRate_);

    for (int frame = 0; frame < numFrames; ++frame) {
        // Step PWM LFO
        pwmLfoPhase_ += dtPwm;
        if (pwmLfoPhase_ >= 2.0f * std::numbers::pi_v<float>)
            pwmLfoPhase_ -= 2.0f * std::numbers::pi_v<float>;

        const float activePw = std::clamp(pulseWidth_ + std::sin(pwmLfoPhase_) * pwmDepth_ * 0.45f, 0.05f, 0.95f);

        float mixL = 0.0f;
        float mixR = 0.0f;

        for (int i = 0; i < activeCount; ++i) {
            auto& voice = voices_[static_cast<size_t>(i)];
            processEnvelope(voice);

            if (voice.envLevel <= 1e-5f)
                continue;

            const double freqHz = slotFreqs[i]; // BUG-5: use pre-computed value
            float rawSample = 0.0f;

            switch (family_) {
                case 0: rawSample = renderSidVoice(voice, freqHz, activePw); break;
                case 1: rawSample = renderPsgVoice(voice, freqHz); break;
                case 2: rawSample = renderFmVoice (voice, freqHz); break;
                case 3: rawSample = renderRamVoice(voice, freqHz); break;
                default: rawSample = renderSidVoice(voice, freqHz, activePw); break;
            }

            float filtered = processFilter(voice, rawSample);

            // DAC Resolution Quantization (4..12 bits) using the cached ladder scale.
            if (quantScale_ > 0.0f) {
                filtered = std::round(filtered * quantScale_) / quantScale_;
            }

            // AY/YM volume register is a 4/5-bit logarithmic DAC ladder, so the
            // envelope itself steps instead of sweeping continuously.
            float envLvl = voice.envLevel;
            if (family_ == 1) {
                const int steps = (variant_ == 1) ? 32 : 16;
                const int idx = std::clamp(static_cast<int>(std::lround(std::clamp(envLvl, 0.0f, 1.0f) * static_cast<float>(steps - 1))), 0, steps - 1);
                envLvl = (variant_ == 1) ? kYm2149DacTable[static_cast<size_t>(idx)]
                                         : kAyDacTable[static_cast<size_t>(idx)];
            }

            const float slotSig = filtered * envLvl * velocity_;

            float panL = 0.707f;
            float panR = 0.707f;
            if (activeCount > 1) {
                const float panPos = static_cast<float>(i) / static_cast<float>(activeCount - 1);
                panL = std::cos(panPos * (0.5f * std::numbers::pi_v<float>));
                panR = std::sin(panPos * (0.5f * std::numbers::pi_v<float>));
            }

            mixL += slotSig * panL;
            mixR += slotSig * panR;
        }

        // Pulse duty and the 6581 bias model both leave DC on the chip output;
        // block it here so the delay/reverb feedback tanks cannot amplify it.
        const float finalL = dcL_.process (mixL * gainScale);
        const float finalR = dcR_.process (mixR * gainScale);

        lastSample_ = (finalL + finalR) * 0.5f;

        if (outL) outL[frame] = finalL;
        if (outR) outR[frame] = finalR;
    }
}

} // namespace VectorWaves