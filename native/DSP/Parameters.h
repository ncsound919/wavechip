#pragma once

// ============================================================================
//  VectorWaves — DSP Parameter Definitions
//  Pure C++20. No JUCE, no browser APIs.
//
//  Integer IDs 0..11 are the canonical M0 parameter set and MUST NOT be reordered:
//    native/include/vector_waves_dsp.h (C ABI param indices)
//    src/engine/parameters.ts (TypeScript M0ParamDescriptor)
//
//  Extended IDs 12+ cover the complete VectorChip synthesis engine:
//    Vector pad, Chip core, Fuse matrix, Mod matrix, and Studio FX.
// ============================================================================

#include <cmath>
#include <string_view>
#include <array>
#include <algorithm>

namespace VectorWaves {

// ---------------------------------------------------------------------------
//  Integer parameter IDs
// ---------------------------------------------------------------------------
enum ParamId : int {
    // --- Canonical M0 Parameters (0..11) ---
    kMasterGain          = 0,
    kTuneCents           = 1,
    kAttackSeconds       = 2,
    kDecaySeconds        = 3,
    kSustainLevel        = 4,
    kReleaseSeconds      = 5,
    kFilterCutoffHz      = 6,
    kDriftAmount         = 7,
    kDriftRate           = 8,
    kDriftSpread         = 9,
    kDriftWarmup         = 10,
    kDriftAge            = 11,

    // --- Extended Vector & Envelope (12..16) ---
    kVectorX             = 12,
    kVectorY             = 13,
    kVectorEnvLoop       = 14,
    kWaveFrame           = 15,
    kWaveMips            = 16,

    // --- Extended Fuse Matrix (17..23) ---
    kFuseChipifyOn       = 17,
    kFuseChipifyBits     = 18,
    kFuseChipifyAlias    = 19,
    kFuseChipToWaveMode  = 20,
    kFuseChipToWaveAmount= 21,
    kFuseWaveToChipMode  = 22,
    kFuseWaveToChipRate  = 23,

    // --- Extended Chip Core (24..45) ---
    kChipFamily          = 24, // 0=sid, 1=psg, 2=fm, 3=wavetable
    kChipVariant         = 25,
    kChipRackInstances   = 26, // 1..8
    kChipAuthenticTuning = 27, // 0=fine, 1=authentic
    kChipWaveTri         = 28,
    kChipWaveSaw         = 29,
    kChipWavePulse       = 30,
    kChipWaveNoise       = 31,
    kChipPulseWidth      = 32,
    kChipAttack          = 33,
    kChipDecay           = 34,
    kChipSustain         = 35,
    kChipRelease         = 36,
    kChipFilterMode      = 37, // 0=LP, 1=BP, 2=HP
    kChipCutoff          = 38,
    kChipReso            = 39,
    kChipFilterCurve     = 40,
    kChipFilterBias      = 41,
    kChipClock           = 42, // 0=PAL, 1=NTSC, 2=OC_2X
    kChipDacBits         = 43, // 4..12
    kChipFmAlgo          = 44, // 0..7
    kChipFmFeedback      = 45, // 0..7

    // --- Extended Drift & Silicon (46..47) ---
    kDriftTempCorr       = 46,
    kDriftSeed           = 47,

    // --- Extended Studio FX Rack (48..54) ---
    kFxAnalogSat         = 48,
    kFxAnalogLpf         = 49,
    kFxChorusMix         = 50,
    kFxChorusRate        = 51,
    kFxDelayMix          = 52,
    kFxDelayTime         = 53,
    kFxReverbMix         = 54,

    // --- Extended Silicon Customization (55..58) ---
    kChipNoiseLfsr       = 55, // 0=15-bit, 1=17-bit, 2=23-bit
    kChipWaveRamLen      = 56, // 16, 32, 64, 128
    kChipPwmRate         = 57, // 0..1
    kChipPwmDepth        = 58, // 0..1

    kNumParams           = 59
};

// ---------------------------------------------------------------------------
//  String IDs — match APVTS parameter IDs and TypeScript bridge keys
// ---------------------------------------------------------------------------
namespace ParamKey {
    inline constexpr std::string_view kMasterGain          = "masterGain";
    inline constexpr std::string_view kTuneCents           = "tuneCents";
    inline constexpr std::string_view kAttackSeconds       = "attackSeconds";
    inline constexpr std::string_view kDecaySeconds        = "decaySeconds";
    inline constexpr std::string_view kSustainLevel        = "sustainLevel";
    inline constexpr std::string_view kReleaseSeconds      = "releaseSeconds";
    inline constexpr std::string_view kFilterCutoffHz      = "filterCutoffHz";
    inline constexpr std::string_view kDriftAmount         = "driftAmount";
    inline constexpr std::string_view kDriftRate           = "driftRate";
    inline constexpr std::string_view kDriftSpread         = "driftSpread";
    inline constexpr std::string_view kDriftWarmup         = "driftWarmup";
    inline constexpr std::string_view kDriftAge            = "driftAge";

    inline constexpr std::string_view kVectorX             = "vectorX";
    inline constexpr std::string_view kVectorY             = "vectorY";
    inline constexpr std::string_view kVectorEnvLoop       = "vectorEnvLoop";
    inline constexpr std::string_view kWaveFrame           = "waveFrame";
    inline constexpr std::string_view kWaveMips            = "waveMips";

    inline constexpr std::string_view kFuseChipifyOn       = "chipifyEnabled";
    inline constexpr std::string_view kFuseChipifyBits     = "chipifyBits";
    inline constexpr std::string_view kFuseChipifyAlias    = "chipifyAliasing";
    inline constexpr std::string_view kFuseChipToWaveMode  = "chipToWaveMode";
    inline constexpr std::string_view kFuseChipToWaveAmount= "chipToWaveAmount";
    inline constexpr std::string_view kFuseWaveToChipMode  = "waveToChipMode";
    inline constexpr std::string_view kFuseWaveToChipRate  = "waveToChipRate";

    inline constexpr std::string_view kChipFamily          = "chipFamily";
    inline constexpr std::string_view kChipVariant         = "chipVariant";
    inline constexpr std::string_view kChipRackInstances   = "chipRackInstances";
    inline constexpr std::string_view kChipAuthenticTuning = "chipAuthenticTuning";
    inline constexpr std::string_view kChipWaveTri         = "chipWaveTri";
    inline constexpr std::string_view kChipWaveSaw         = "chipWaveSaw";
    inline constexpr std::string_view kChipWavePulse       = "chipWavePulse";
    inline constexpr std::string_view kChipWaveNoise       = "chipWaveNoise";
    inline constexpr std::string_view kChipPulseWidth      = "chipPulseWidth";
    inline constexpr std::string_view kChipAttack          = "chipAttack";
    inline constexpr std::string_view kChipDecay           = "chipDecay";
    inline constexpr std::string_view kChipSustain         = "chipSustain";
    inline constexpr std::string_view kChipRelease         = "chipRelease";
    inline constexpr std::string_view kChipFilterMode      = "chipFilterMode";
    inline constexpr std::string_view kChipCutoff          = "chipCutoff";
    inline constexpr std::string_view kChipReso            = "chipResonance";
    inline constexpr std::string_view kChipFilterCurve     = "chipFilterCurve";
    inline constexpr std::string_view kChipFilterBias      = "chipFilterBias";
    inline constexpr std::string_view kChipClock           = "chipClock";
    inline constexpr std::string_view kChipDacBits         = "chipDacBits";
    inline constexpr std::string_view kChipFmAlgo          = "chipFmAlgo";
    inline constexpr std::string_view kChipFmFeedback      = "chipFmFeedback";
    inline constexpr std::string_view kChipNoiseLfsr       = "chipNoiseLfsr";
    inline constexpr std::string_view kChipWaveRamLen      = "chipWaveRamLen";
    inline constexpr std::string_view kChipPwmRate         = "chipPwmRate";
    inline constexpr std::string_view kChipPwmDepth        = "chipPwmDepth";

    inline constexpr std::string_view kDriftTempCorr       = "driftTempCorr";
    inline constexpr std::string_view kDriftSeed           = "driftSeed";

    inline constexpr std::string_view kFxAnalogSat         = "analogSat";
    inline constexpr std::string_view kFxAnalogLpf         = "analogLpf";
    inline constexpr std::string_view kFxChorusMix         = "chorusMix";
    inline constexpr std::string_view kFxChorusRate        = "chorusRate";
    inline constexpr std::string_view kFxDelayMix          = "delayMix";
    inline constexpr std::string_view kFxDelayTime         = "delayTime";
    inline constexpr std::string_view kFxReverbMix         = "reverbMix";
} // namespace ParamKey

// ---------------------------------------------------------------------------
//  Parameter metadata table (ranges & defaults)
// ---------------------------------------------------------------------------
struct ParamInfo {
    std::string_view key;
    float            minVal;
    float            maxVal;
    float            defaultVal;
};

inline constexpr std::array<ParamInfo, kNumParams> kParamTable = {{
    // id  key                                 min       max        default
    { ParamKey::kMasterGain,                   0.0f,     1.0f,      0.8f    }, // 0
    { ParamKey::kTuneCents,                  -100.0f,  100.0f,      0.0f    }, // 1
    { ParamKey::kAttackSeconds,                0.001f,   8.0f,      0.01f   }, // 2
    { ParamKey::kDecaySeconds,                 0.001f,   8.0f,      0.1f    }, // 3
    { ParamKey::kSustainLevel,                 0.0f,     1.0f,      0.7f    }, // 4
    { ParamKey::kReleaseSeconds,               0.001f,  16.0f,      0.3f    }, // 5
    { ParamKey::kFilterCutoffHz,              20.0f, 20000.0f,  20000.0f    }, // 6
    { ParamKey::kDriftAmount,                  0.0f,     1.0f,      0.2f    }, // 7
    { ParamKey::kDriftRate,                    0.001f,  10.0f,      0.5f    }, // 8
    { ParamKey::kDriftSpread,                  0.0f,     1.0f,      0.5f    }, // 9
    { ParamKey::kDriftWarmup,                  0.0f,    60.0f,      2.0f    }, // 10
    { ParamKey::kDriftAge,                     0.0f,     1.0f,      0.0f    }, // 11

    { ParamKey::kVectorX,                      0.0f,     1.0f,      0.5f    }, // 12
    { ParamKey::kVectorY,                      0.0f,     1.0f,      0.5f    }, // 13
    { ParamKey::kVectorEnvLoop,                0.0f,     1.0f,      1.0f    }, // 14
    { ParamKey::kWaveFrame,                    0.0f,    63.0f,      0.0f    }, // 15
    { ParamKey::kWaveMips,                     0.0f,     1.0f,      1.0f    }, // 16

    { ParamKey::kFuseChipifyOn,                0.0f,     1.0f,      0.0f    }, // 17
    { ParamKey::kFuseChipifyBits,              4.0f,    16.0f,      8.0f    }, // 18
    { ParamKey::kFuseChipifyAlias,             0.0f,     1.0f,      0.25f   }, // 19
    { ParamKey::kFuseChipToWaveMode,           0.0f,     3.0f,      0.0f    }, // 20
    { ParamKey::kFuseChipToWaveAmount,         0.0f,     1.0f,      0.25f   }, // 21
    { ParamKey::kFuseWaveToChipMode,           0.0f,     2.0f,      0.0f    }, // 22
    { ParamKey::kFuseWaveToChipRate,           0.0f,     1.0f,      0.5f    }, // 23

    { ParamKey::kChipFamily,                   0.0f,     3.0f,      0.0f    }, // 24
    { ParamKey::kChipVariant,                  0.0f,     3.0f,      0.0f    }, // 25
    { ParamKey::kChipRackInstances,            1.0f,     8.0f,      1.0f    }, // 26
    { ParamKey::kChipAuthenticTuning,          0.0f,     1.0f,      1.0f    }, // 27
    { ParamKey::kChipWaveTri,                  0.0f,     1.0f,      0.0f    }, // 28
    { ParamKey::kChipWaveSaw,                  0.0f,     1.0f,      1.0f    }, // 29
    { ParamKey::kChipWavePulse,                0.0f,     1.0f,      1.0f    }, // 30
    { ParamKey::kChipWaveNoise,                0.0f,     1.0f,      0.0f    }, // 31
    { ParamKey::kChipPulseWidth,               0.0f,     1.0f,      0.5f    }, // 32
    { ParamKey::kChipAttack,                   0.0f,     1.0f,      0.05f   }, // 33
    { ParamKey::kChipDecay,                    0.0f,     1.0f,      0.45f   }, // 34
    { ParamKey::kChipSustain,                  0.0f,     1.0f,      0.65f   }, // 35
    { ParamKey::kChipRelease,                  0.0f,     1.0f,      0.4f    }, // 36
    { ParamKey::kChipFilterMode,               0.0f,     3.0f,      0.0f    }, // 37
    { ParamKey::kChipCutoff,                   0.0f,     1.0f,      0.6f    }, // 38
    { ParamKey::kChipReso,                     0.0f,     1.0f,      0.35f   }, // 39
    { ParamKey::kChipFilterCurve,              0.0f,     1.0f,      0.5f    }, // 40
    { ParamKey::kChipFilterBias,              -1.0f,     1.0f,      0.0f    }, // 41
    { ParamKey::kChipClock,                    0.0f,     2.0f,      0.0f    }, // 42
    { ParamKey::kChipDacBits,                  4.0f,    12.0f,      8.0f    }, // 43
    { ParamKey::kChipFmAlgo,                   0.0f,     7.0f,      0.0f    }, // 44
    { ParamKey::kChipFmFeedback,               0.0f,     7.0f,      3.0f    }, // 45

    { ParamKey::kDriftTempCorr,                0.0f,     1.0f,      0.6f    }, // 46
    { ParamKey::kDriftSeed,                 1000.0f,  9999.0f,   4242.0f    }, // 47

    { ParamKey::kFxAnalogSat,                  0.0f,     1.0f,      0.3f    }, // 48
    { ParamKey::kFxAnalogLpf,                  0.0f,     1.0f,      0.8f    }, // 49
    { ParamKey::kFxChorusMix,                  0.0f,     1.0f,      0.4f    }, // 50
    { ParamKey::kFxChorusRate,                 0.0f,     1.0f,      0.35f   }, // 51
    { ParamKey::kFxDelayMix,                   0.0f,     1.0f,      0.25f   }, // 52
    { ParamKey::kFxDelayTime,                  0.0f,     1.0f,      0.42f   }, // 53
    { ParamKey::kFxReverbMix,                  0.0f,     1.0f,      0.32f   }, // 54

    { ParamKey::kChipNoiseLfsr,                0.0f,     2.0f,      2.0f    }, // 55 (0=15b, 1=17b, 2=23b)
    { ParamKey::kChipWaveRamLen,              16.0f,   128.0f,     32.0f    }, // 56
    { ParamKey::kChipPwmRate,                  0.0f,     1.0f,      0.25f   }, // 57
    { ParamKey::kChipPwmDepth,                 0.0f,     1.0f,      0.0f    }, // 58
}};

inline constexpr float clamp01(float v) noexcept {
    return v < 0.0f ? 0.0f : (v > 1.0f ? 1.0f : v);
}

namespace detail {
    inline constexpr bool isLogParam(int id) noexcept {
        return id == kAttackSeconds  ||
               id == kDecaySeconds   ||
               id == kReleaseSeconds ||
               id == kFilterCutoffHz;
    }
} // namespace detail

inline float normToPlain(int id, float norm) noexcept {
    if (id < 0 || id >= kNumParams) return 0.0f;
    norm = clamp01(norm);
    const auto& info = kParamTable[id];
    if (detail::isLogParam(id)) {
        const float logMin = std::log(info.minVal);
        const float logMax = std::log(info.maxVal);
        return std::exp(logMin + norm * (logMax - logMin));
    }
    return info.minVal + norm * (info.maxVal - info.minVal);
}

inline float plainToNorm(int id, float plain) noexcept {
    if (id < 0 || id >= kNumParams) return 0.0f;
    const auto& info = kParamTable[id];
    if (detail::isLogParam(id)) {
        const float logMin = std::log(info.minVal);
        const float logMax = std::log(info.maxVal);
        const float logVal = std::log(std::max(plain, info.minVal));
        return clamp01((logVal - logMin) / (logMax - logMin));
    }
    return clamp01((plain - info.minVal) / (info.maxVal - info.minVal));
}

inline float clampPlain(int id, float plain) noexcept {
    if (id < 0 || id >= kNumParams) return 0.0f;
    const auto& info = kParamTable[id];
    return std::clamp(plain, info.minVal, info.maxVal);
}

} // namespace VectorWaves