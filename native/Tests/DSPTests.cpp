// ============================================================================
//  VectorChip DSP Unit Tests (native/Tests/DSPTests.cpp)
//
//  Tests:
//    1. Tuning â€” A4 (MIDI 69, tuneCents=0) â†’ FFT peak within Â±2 cents of 440 Hz
//    2. ADSR Attack â€” attack=0.01s @48kHz reaches â‰¥0.99 within 490-510 samples
//    3. Drift reproducibility â€” same seed + events â†’ identical render
//    4. No NaN/Inf â€” 10 s render at min/max parameter extremes
//    5. ChipCore â€” SID, PSG, FM, Wave RAM authentic engines
//    6. FuseEngine â€” Chipify bit-reduction, aliasing downsample, cross-mod
//    7. FxRack â€” Analog Stage, BBD Chorus, Tape Delay, Schroeder Reverb
//    8. VectorMixer â€” 4-quadrant bilinear mix & 4-stage Vector Envelope
// ============================================================================

#include "../DSP/Parameters.h"
#include "../DSP/WavetableVoice.h"
#include "../DSP/Envelope.h"
#include "../DSP/DriftState.h"
#include "../DSP/ChipCore.h"
#include "../DSP/FuseEngine.h"
#include "../DSP/VectorMixer.h"
#include "../DSP/FxRack.h"

#include <juce_audio_basics/juce_audio_basics.h>
#include <juce_core/juce_core.h>
#include <juce_dsp/juce_dsp.h>

#include <cmath>
#include <cstdio>
#include <numbers>
#include <vector>

namespace
{
    std::vector<float> makeSineTable (int partial = 1)
    {
        std::vector<float> table (2048);
        const double twoPi = 2.0 * std::numbers::pi;
        for (int i = 0; i < 2048; ++i)
            table[i] = static_cast<float> (std::sin (twoPi * partial * i / 2048.0));
        return table;
    }

    double peakFrequency (const std::vector<float>& signal, double sampleRate)
    {
        const int fftOrder = static_cast<int> (
            std::ceil (std::log2 (static_cast<double> (signal.size()))));
        const int fftSize = 1 << fftOrder;

        juce::dsp::FFT fft (fftOrder);

        std::vector<float> buf (static_cast<std::size_t> (fftSize * 2), 0.0f);
        const int copyLen = std::min (static_cast<int> (signal.size()), fftSize);
        for (int i = 0; i < copyLen; ++i)
            buf[static_cast<std::size_t> (i)] = signal[static_cast<std::size_t> (i)];

        fft.performRealOnlyForwardTransform (buf.data(), true);

        int peakBin = 1;
        float peakMag = 0.0f;
        for (int k = 1; k <= fftSize / 2; ++k)
        {
            const float re  = buf[static_cast<std::size_t> (2 * k)];
            const float im  = buf[static_cast<std::size_t> (2 * k + 1)];
            const float mag = std::sqrt (re * re + im * im);
            if (mag > peakMag) { peakMag = mag; peakBin = k; }
        }

        return static_cast<double> (peakBin) * sampleRate / static_cast<double> (fftSize);
    }

    double hzToCents440 (double hz)
    {
        return 1200.0 * std::log2 (hz / 440.0);
    }

    bool renderVoice (VectorWaves::WavetableVoice& voice,
                      int midiNote, float velocity,
                      double sampleRate, int numSamples,
                      std::vector<float>& outL, std::vector<float>& outR)
    {
        outL.assign (static_cast<std::size_t> (numSamples), 0.0f);
        outR.assign (static_cast<std::size_t> (numSamples), 0.0f);

        voice.noteOn (static_cast<uint8_t> (midiNote), velocity);
        voice.process (outL.data(), outR.data(), numSamples);
        return true;
    }
} // namespace

// ============================================================================
//  Test 1 â€” Tuning accuracy at A4
// ============================================================================
class TuningTest final : public juce::UnitTest
{
public:
    TuningTest() : juce::UnitTest ("Tuning â€” A4 within Â±2 cents") {}

    void runTest() override
    {
        beginTest ("A4 (MIDI 69, tuneCents=0) FFT peak â‰¤ Â±2 cents");

        constexpr double sampleRate = 48000.0;
        constexpr int    numSamples = static_cast<int> (sampleRate);

        VectorWaves::WavetableVoice voice;
        voice.prepare (sampleRate);
        voice.loadTable (makeSineTable().data(), static_cast<int> (sampleRate));

        for (int id = 0; id < 12; ++id)
            voice.setParam (id, VectorWaves::kParamTable[id].defaultVal);

        voice.setParam (VectorWaves::kTuneCents,     0.0f);
        voice.setParam (VectorWaves::kFilterCutoffHz, 20000.0f);
        voice.setParam (VectorWaves::kAttackSeconds,  0.001f);
        voice.setParam (VectorWaves::kSustainLevel,   1.0f);

        std::vector<float> outL, outR;
        renderVoice (voice, 69, 1.0f, sampleRate, numSamples, outL, outR);

        const std::vector<float> analysisWindow (outL.begin() + 512, outL.end());

        const double peakHz    = peakFrequency (analysisWindow, sampleRate);
        const double centsOff  = hzToCents440 (peakHz);
        const bool   pass      = std::abs (centsOff) <= 2.0;

        logMessage (juce::String ("Peak: ") + juce::String (peakHz, 3) + " Hz  ("
                    + juce::String (centsOff, 2) + " cents from 440)");

        expect (pass, "FFT peak should be within Â±2 cents of 440 Hz");
    }
};

// ============================================================================
//  Test 2 â€” ADSR attack time
// ============================================================================
class AdsrAttackTest final : public juce::UnitTest
{
public:
    AdsrAttackTest() : juce::UnitTest ("ADSR â€” attack 0.01s reaches 0.99") {}

    void runTest() override
    {
        beginTest ("Attack 0.01 s @48 kHz reaches â‰¥0.99 in 490â€“510 samples");

        constexpr double sampleRate    = 48000.0;
        constexpr float  attackSeconds = 0.01f;

        VectorWaves::AdsrEnvelope env;
        env.setAttack  (attackSeconds, static_cast<float>(sampleRate));
        env.setDecay   (8.0f,          static_cast<float>(sampleRate));
        env.setSustain (1.0f);
        env.setRelease (8.0f,          static_cast<float>(sampleRate));

        env.noteOn();

        int reachedAt = -1;
        for (int i = 0; i < 1000; ++i)
        {
            const float level = env.process();
            if (reachedAt < 0 && level >= 0.99f)
                reachedAt = i;
        }

        logMessage (juce::String ("Envelope reached 0.99 at sample ") + juce::String (reachedAt));

        expect (reachedAt >= 490 && reachedAt <= 510,
                "Attack envelope should reach 0.99 between samples 490 and 510");
    }
};

// ============================================================================
//  Test 3 â€” Drift reproducibility
// ============================================================================
class DriftReproducibilityTest final : public juce::UnitTest
{
public:
    DriftReproducibilityTest() : juce::UnitTest ("Drift â€” reproducible from same seed") {}

    void runTest() override
    {
        beginTest ("Same seed + same events â†’ identical 100-frame output");

        constexpr double sampleRate = 48000.0;
        constexpr int    blockSize  = 256;
        constexpr int    numBlocks  = 100;

        auto runRender = [&] (uint32_t seed) -> std::vector<float>
        {
            VectorWaves::WavetableVoice voice;
            voice.prepare (sampleRate);
            voice.loadTable (makeSineTable().data(), static_cast<int> (sampleRate));

            for (int id = 0; id < 12; ++id)
                voice.setParam (id, VectorWaves::kParamTable[id].defaultVal);

            voice.setDriftSeed (seed);
            voice.noteOn (69, 1.0f);

            std::vector<float> resultL;
            resultL.reserve (static_cast<std::size_t> (blockSize * numBlocks));

            std::vector<float> blockL (static_cast<std::size_t> (blockSize));
            std::vector<float> blockR (static_cast<std::size_t> (blockSize));

            for (int b = 0; b < numBlocks; ++b)
            {
                std::fill (blockL.begin(), blockL.end(), 0.0f);
                std::fill (blockR.begin(), blockR.end(), 0.0f);

                voice.process (blockL.data(), blockR.data(), blockSize);

                for (float s : blockL)
                    resultL.push_back (s);
            }

            return resultL;
        };

        constexpr uint32_t seed = 0xDEADBEEFu;
        const auto run1 = runRender (seed);
        const auto run2 = runRender (seed);

        expectEquals (static_cast<int> (run1.size()),
                      static_cast<int> (run2.size()),
                      "Output sizes must match");

        bool identical = true;
        for (std::size_t i = 0; i < run1.size(); ++i)
        {
            if (run1[i] != run2[i])
            {
                identical = false;
                break;
            }
        }

        expect (identical, "Same seed must produce bit-identical output on replay");
    }
};

// ============================================================================
//  Test 4 â€” No NaN or Inf at parameter extremes
// ============================================================================
class NoNaNTest final : public juce::UnitTest
{
public:
    NoNaNTest() : juce::UnitTest ("Stability â€” no NaN/Inf at param extremes") {}

    void runTest() override
    {
        beginTest ("10 s render at min/max parameter values produces no NaN or Inf");

        constexpr double sampleRate = 48000.0;
        constexpr int    blockSize  = 512;
        const int        numBlocks  = static_cast<int> (10.0 * sampleRate / blockSize);

        for (int extreme = 0; extreme < 2; ++extreme)
        {
            const juce::String label = (extreme == 0) ? "MIN params" : "MAX params";
            beginTest (label);

            VectorWaves::WavetableVoice voice;
            voice.prepare (sampleRate);
            voice.loadTable (makeSineTable().data(), static_cast<int> (sampleRate));

            for (int id = 0; id < 12; ++id)
            {
                const auto& info = VectorWaves::kParamTable[id];
                voice.setParam (id, extreme == 0 ? info.minVal : info.maxVal);
            }

            voice.noteOn (69, 1.0f);

            std::vector<float> blockL (static_cast<std::size_t> (blockSize));
            std::vector<float> blockR (static_cast<std::size_t> (blockSize));

            bool foundBad = false;

            for (int b = 0; b < numBlocks && !foundBad; ++b)
            {
                std::fill (blockL.begin(), blockL.end(), 0.0f);
                std::fill (blockR.begin(), blockR.end(), 0.0f);

                voice.process (blockL.data(), blockR.data(), blockSize);

                for (int i = 0; i < blockSize && !foundBad; ++i)
                {
                    const float sl = blockL[static_cast<std::size_t> (i)];
                    const float sr = blockR[static_cast<std::size_t> (i)];

                    if (!std::isfinite (sl) || !std::isfinite (sr))
                        foundBad  = true;
                }
            }

            expect (!foundBad, label + " â€” render must remain finite");
        }
    }
};

// ============================================================================
//  Test 4b â€” Drift parameter handling (kDriftTempCorr / kDriftSeed)
// ============================================================================
class DriftParamHandlingTest final : public juce::UnitTest
{
public:
    DriftParamHandlingTest() : juce::UnitTest ("Drift â€” temp corr + seed params handled") {}

    void runTest() override
    {
        beginTest ("kDriftTempCorr / kDriftSeed change the render, remain finite");

        constexpr double sampleRate = 48000.0;
        constexpr int    blockSize  = 256;

        auto renderWith = [&] (float tempCorr, float seed) -> std::vector<float>
        {
            VectorWaves::WavetableVoice voice;
            voice.prepare (sampleRate);
            voice.loadTable (makeSineTable().data(), static_cast<int> (sampleRate));

            for (int id = 0; id < 12; ++id)
                voice.setParam (id, VectorWaves::kParamTable[id].defaultVal);

            voice.setParam (VectorWaves::kDriftAmount, 1.0f);
            voice.setParam (VectorWaves::kDriftTempCorr, tempCorr);
            voice.setParam (VectorWaves::kDriftSeed, seed);

            voice.noteOn (69, 1.0f);

            std::vector<float> out;
            out.reserve (static_cast<std::size_t> (blockSize * 64));
            std::vector<float> l (static_cast<std::size_t> (blockSize));
            std::vector<float> r (static_cast<std::size_t> (blockSize));

            for (int b = 0; b < 64; ++b)
            {
                std::fill (l.begin(), l.end(), 0.0f);
                std::fill (r.begin(), r.end(), 0.0f);
                voice.process (l.data(), r.data(), blockSize);
                out.insert (out.end(), l.begin(), l.end());
            }
            return out;
        };

        const auto cold  = renderWith (0.0f, 1234.0f);
        const auto warm  = renderWith (1.0f, 1234.0f);
        const auto other = renderWith (0.6f, 9999.0f);

        auto allFinite = [] (const std::vector<float>& v)
        {
            for (float s : v)
                if (! std::isfinite (s)) return false;
            return true;
        };

        expect (allFinite (cold) && allFinite (warm) && allFinite (other),
                "drift renders must stay finite");
        expect (cold != warm,  "kDriftTempCorr must change drift depth");
        expect (other != warm, "kDriftSeed must change drift personality");
    }
};

// ============================================================================
//  Test 5 â€” ChipCore Multi-Engine Synthesis
// ============================================================================
class ChipCoreTest final : public juce::UnitTest
{
public:
    ChipCoreTest() : juce::UnitTest ("ChipCore â€” SID, PSG, FM, Wave RAM synthesis") {}

    void runTest() override
    {
        beginTest ("ChipCore audio output across all chip families");

        constexpr double sampleRate = 44100.0;
        constexpr int numSamples = 1024;
        std::vector<float> outL (numSamples, 0.0f);
        std::vector<float> outR (numSamples, 0.0f);

        VectorWaves::ChipCore chip;
        chip.prepare (sampleRate);

        // Test 1: SID (Family 0)
        chip.setParam (VectorWaves::kChipFamily, 0.0f);
        chip.setParam (VectorWaves::kChipWaveSaw, 1.0f);
        chip.setParam (VectorWaves::kChipAttack, 0.001f);
        chip.setParam (VectorWaves::kChipSustain, 1.0f);
        chip.noteOn (60, 0.8f);
        chip.process (outL.data(), outR.data(), numSamples);

        float maxSid = 0.0f;
        for (float s : outL) {
            expect (std::isfinite (s), "SID output must be finite");
            maxSid = std::max (maxSid, std::abs (s));
        }
        expect (maxSid > 0.01f, "SID oscillator must produce audible sound");

        // Test 2: PSG (Family 1)
        chip.setParam (VectorWaves::kChipFamily, 1.0f);
        std::fill (outL.begin(), outL.end(), 0.0f);
        chip.process (outL.data(), outR.data(), numSamples);
        float maxPsg = 0.0f;
        for (float s : outL) {
            expect (std::isfinite (s), "PSG output must be finite");
            maxPsg = std::max (maxPsg, std::abs (s));
        }
        expect (maxPsg > 0.01f, "PSG square wave generator must produce sound");

        // Test 3: FM (Family 2)
        chip.setParam (VectorWaves::kChipFamily, 2.0f);
        chip.setParam (VectorWaves::kChipFmAlgo, 0.0f);
        std::fill (outL.begin(), outL.end(), 0.0f);
        chip.process (outL.data(), outR.data(), numSamples);
        float maxFm = 0.0f;
        for (float s : outL) {
            expect (std::isfinite (s), "FM output must be finite");
            maxFm = std::max (maxFm, std::abs (s));
        }
        expect (maxFm > 0.01f, "FM 4-Op cascade must produce sound");

        // Test 4: Wave RAM (Family 3)
        chip.setParam (VectorWaves::kChipFamily, 3.0f);
        std::fill (outL.begin(), outL.end(), 0.0f);
        chip.process (outL.data(), outR.data(), numSamples);
        float maxRam = 0.0f;
        for (float s : outL) {
            expect (std::isfinite (s), "Wave RAM output must be finite");
            maxRam = std::max (maxRam, std::abs (s));
        }
        expect (maxRam > 0.01f, "Wave RAM playback must produce sound");
    }
};

// ============================================================================
//  Test 6 â€” FuseEngine Chipification & Cross-Modulation
// ============================================================================
class FuseEngineTest final : public juce::UnitTest
{
public:
    FuseEngineTest() : juce::UnitTest ("FuseEngine â€” Chipify & Cross-Mod") {}

    void runTest() override
    {
        beginTest ("Chipify bit quantization ladder");

        VectorWaves::FuseEngine fuse;
        fuse.prepare (44100.0);
        fuse.setChipify (true, 4, 0.0f); // 4-bit = 8 steps

        float wL = 0.63f;
        float wR = -0.42f;
        fuse.processChipify (wL, wR);

        // 4-bit steps: step size is 1/8 = 0.125
        expect (std::abs (std::round (wL * 8.0f) - (wL * 8.0f)) < 1e-4f,
                "4-bit Chipify must quantize to multiples of 1/8");

        beginTest ("Cross-mod FM & Ring Modulation");
        fuse.setChipToWave (2, 1.0f); // Ring mod 100%
        float waveL = 0.5f;
        float waveR = 0.5f;
        fuse.applyChipToWave (waveL, waveR, 0.4f, 0.4f);
        expect (std::abs (waveL - 0.4f) < 1e-4f, "100% ring mod should equal 2 * 0.5 * 0.4 = 0.4");
    }
};

// ============================================================================
//  Test 7 â€” Studio FX Rack (Chorus, Delay, Reverb, Saturation)
// ============================================================================
class FxRackTest final : public juce::UnitTest
{
public:
    FxRackTest() : juce::UnitTest ("FxRack â€” Analog Sat, Chorus, Delay, Reverb") {}

    void runTest() override
    {
        beginTest ("Analog Saturation & Master LPF");

        VectorWaves::FxRack fx;
        fx.prepare (44100.0f);
        fx.setSaturation (0.5f);

        std::vector<float> bufL (256, 0.8f);
        std::vector<float> bufR (256, 0.8f);
        fx.process (bufL.data(), bufR.data(), 256, 0.5f, 1.0f, 1.0f);

        for (float s : bufL) {
            expect (std::isfinite (s), "FX output must be finite");
            expect (std::abs (s) <= 1.0f, "Soft-clipper must contain peaks within Â±1.0");
        }

        beginTest ("Plate Reverb diffusion");
        fx.setSaturation (0.0f);
        fx.setReverb (0.5f);

        // Feed impulse at sample 0, rest silence (buffer long enough for comb delays ~1116..1356)
        std::vector<float> revL (4096, 0.0f);
        std::vector<float> revR (4096, 0.0f);
        revL[0] = 1.0f;
        revR[0] = 1.0f;
        fx.process (revL.data(), revR.data(), 4096, 0.0f, 1.0f, 1.0f);

        // Check tail exists past sample 1500
        float tailEnergy = 0.0f;
        for (size_t i = 1500; i < revL.size(); ++i)
            tailEnergy += std::abs (revL[i]);

        expect (tailEnergy > 0.001f, "Plate Reverb must generate dense diffuse tail");
    }
};

// ============================================================================
//  Test 8 â€” VectorMixer 4-Quadrant Blending & Envelope
// ============================================================================
class VectorMixerTest final : public juce::UnitTest
{
public:
    VectorMixerTest() : juce::UnitTest ("VectorMixer â€” 4-quadrant mix & envelope") {}

    void runTest() override
    {
        beginTest ("Corner quadrant blending");

        VectorWaves::VectorMixer mixer;
        mixer.prepare (44100.0);
        mixer.setEnvLoop (false);

        float outL[1], outR[1];
        float waveL[1] = { 1.0f }, waveR[1] = { 1.0f };
        float chipL[1] = { 0.5f }, chipR[1] = { 0.5f };

        // Corner (0,0): 100% Wave 1
        mixer.mix (outL, outR, waveL, waveR, chipL, chipR, 1, 0.0f, 0.0f);
        expect (std::abs (outL[0] - 1.0f) < 1e-3f, "At (0,0) output must be Wave 1");

        // Corner (1,0): 100% Chip 1
        mixer.mix (outL, outR, waveL, waveR, chipL, chipR, 1, 1.0f, 0.0f);
        expect (std::abs (outL[0] - 0.5f) < 1e-3f, "At (1,0) output must be Chip 1");
    }
};

// ============================================================================
//  Test 9 â€” Silicon integrity: filter stability, PSG noise clock, stereo delay
// ============================================================================
class SiliconIntegrityTest final : public juce::UnitTest
{
public:
    SiliconIntegrityTest() : juce::UnitTest ("Silicon â€” filter stability & PSG noise") {}

    void runTest() override
    {
        beginTest ("Resonant filter stays bounded at max cutoff/resonance");

        constexpr double sampleRate = 48000.0;
        bool finite = true;
        float worstGrowth = 0.0f;

        for (int family = 0; family < 4; ++family)
        {
            for (int mode = 0; mode < 3; ++mode)
            {
                VectorWaves::ChipCore chip;
                chip.prepare (sampleRate);
                chip.setParam (VectorWaves::kChipFamily,      static_cast<float> (family));
                chip.setParam (VectorWaves::kChipFilterMode,  static_cast<float> (mode));
                chip.setParam (VectorWaves::kChipCutoff,      1.0f);
                chip.setParam (VectorWaves::kChipReso,        1.0f);
                chip.setParam (VectorWaves::kChipRackInstances, 8.0f);
                chip.setParam (VectorWaves::kChipAttack,      0.001f);
                chip.setParam (VectorWaves::kChipSustain,     1.0f);
                chip.noteOn (60, 1.0f);

                std::vector<float> blockL (512), blockR (512);
                float early = 0.0f, late = 0.0f;

                for (int b = 0; b < 200; ++b)
                {
                    chip.process (blockL.data(), blockR.data(), 512);
                    for (float s : blockL)
                    {
                        if (! std::isfinite (s)) finite = false;
                        const float a = std::abs (s);
                        if (b < 100) early = std::max (early, a);
                        else         late  = std::max (late,  a);
                    }
                }

                worstGrowth = std::max (worstGrowth, late / std::max (1.0e-4f, early));
            }
        }

        logMessage (juce::String ("worst late/early peak growth: ") + juce::String (worstGrowth, 2));
        expect (finite, "filter output must stay finite");
        expect (worstGrowth < 1.5f, "filter must not ring up at max resonance");

        beginTest ("PSG noise runs on its own divider, not the tone divider");

        auto noiseCrossings = [&] (int note)
        {
            VectorWaves::ChipCore chip;
            chip.prepare (sampleRate);
            chip.setParam (VectorWaves::kChipFamily,    1.0f);
            chip.setParam (VectorWaves::kChipWavePulse, 0.0f);
            chip.setParam (VectorWaves::kChipWaveNoise, 1.0f);
            chip.setParam (VectorWaves::kChipFilterMode, 3.0f);
            chip.setParam (VectorWaves::kChipAttack,    0.001f);
            chip.setParam (VectorWaves::kChipSustain,   1.0f);
            chip.noteOn (note, 1.0f);

            std::vector<float> l (8192), r (8192);
            chip.process (l.data(), r.data(), 8192);

            int crossings = 0;
            for (std::size_t i = 1; i < l.size(); ++i)
                if ((l[i - 1] < 0.0f) != (l[i] < 0.0f)) ++crossings;
            return crossings;
        };

        const int lowCross  = noiseCrossings (36);
        const int highCross = noiseCrossings (96);
        logMessage (juce::String ("noise zero-crossings â€” note 36: ") + juce::String (lowCross)
                    + "  note 96: " + juce::String (highCross));
        expect (lowCross > 100, "noise channel must produce broadband hiss");
        expect (std::abs (lowCross - highCross) < std::max (lowCross, highCross) / 3,
                "noise spectrum must not follow the note pitch");

        beginTest ("Voice stereo widener delivers a 7-sample delay");

        VectorWaves::WavetableVoice voice;
        voice.prepare (sampleRate);

        std::vector<float> table (2048);
        for (int i = 0; i < 2048; ++i)
            table[static_cast<std::size_t> (i)] = static_cast<float> (
                std::sin (2.0 * std::numbers::pi * i / 2048.0));

        voice.loadTable (table.data(), static_cast<int> (sampleRate));
        for (int id = 0; id < 12; ++id)
            voice.setParam (id, VectorWaves::kParamTable[static_cast<std::size_t> (id)].defaultVal);

        voice.setParam (VectorWaves::kAttackSeconds,  0.001f);
        voice.setParam (VectorWaves::kSustainLevel,   1.0f);
        voice.setParam (VectorWaves::kFilterCutoffHz, 20000.0f);
        voice.setParam (VectorWaves::kDriftAmount,    0.0f);
        voice.noteOn (69, 1.0f);

        std::vector<float> l (4096), r (4096);
        voice.process (l.data(), r.data(), 4096);

        bool delayed = true;
        for (std::size_t i = 32; i < l.size(); ++i)
            if (std::abs (r[i] - l[i - 7]) > 1.0e-6f) { delayed = false; break; }

        expect (delayed, "right channel should be the left channel delayed by 7 samples");
    }
};

// ============================================================================
//  Test 10 â€” Chip character fidelity
// ============================================================================
class ChipFidelityTest final : public juce::UnitTest
{
public:
    ChipFidelityTest() : juce::UnitTest ("Chip â€” wave/noise/FM character") {}

    void runTest() override
    {
        constexpr double sampleRate = 48000.0;

        auto renderChip = [&] (int family, bool tri, bool saw, bool noise, float feedback)
            -> std::vector<float>        {
            VectorWaves::ChipCore chip;
            chip.prepare (sampleRate);
            chip.setParam (VectorWaves::kChipFamily,    static_cast<float> (family));
            chip.setParam (VectorWaves::kChipWaveTri,   tri   ? 1.0f : 0.0f);
            chip.setParam (VectorWaves::kChipWaveSaw,   saw   ? 1.0f : 0.0f);
            chip.setParam (VectorWaves::kChipWavePulse, 0.0f);
            chip.setParam (VectorWaves::kChipWaveNoise, noise ? 1.0f : 0.0f);
            chip.setParam (VectorWaves::kChipFmFeedback, feedback);
            chip.setParam (VectorWaves::kChipAttack,    0.001f);
            chip.setParam (VectorWaves::kChipSustain,   1.0f);
            chip.noteOn (57, 1.0f);

            std::vector<float> l (8192), r (8192);
            chip.process (l.data(), r.data(), 8192);
            return l;
        };

        auto hf = [] (const std::vector<float>& v)
        {
            double acc = 0.0;
            for (std::size_t i = 1; i < v.size(); ++i)
                acc += std::abs (v[i] - v[i - 1]);
            return acc / static_cast<double> (v.size());
        };

        beginTest ("PSG saw is brighter than its triangle");
        const auto tri  = renderChip (0, true,  false, false, 0.0f);
        const auto saw  = renderChip (0, false, true,  false, 0.0f);
        const auto hiss = renderChip (0, false, false, true,  0.0f);
        logMessage ("tri hf=" + juce::String (hf (tri))
                    + "  saw hf=" + juce::String (hf (saw))
                    + "  noise hf=" + juce::String (hf (hiss)));
        expect (hf (saw) > hf (tri) * 1.2, "saw must carry more high-frequency energy than triangle");

        beginTest ("noise is broadband relative to the triangle");
        expect (hf (hiss) > hf (tri), "noise channel must be brighter than a triangle");

        beginTest ("FM feedback adds sideband energy");
        const auto fm0 = renderChip (2, false, false, false, 0.0f);
        const auto fm7 = renderChip (2, false, false, false, 7.0f);
        logMessage ("fm fb0 hf=" + juce::String (hf (fm0))
                    + "  fb7 hf=" + juce::String (hf (fm7)));
        expect (std::abs (hf (fm7) - hf (fm0)) > 0.002,
                "feedback must change the FM spectrum");
    }
};

// ============================================================================
//  Test 11 â€” 10-minute full-chain soak
// ============================================================================
class LongSoakTest final : public juce::UnitTest
{
public:
    LongSoakTest() : juce::UnitTest ("Soak â€” 10 minute full-chain render") {}

    void runTest() override
    {
        beginTest ("600 s of voice + chip + fuse + mixer + fx stays finite");

        constexpr double sampleRate = 48000.0;
        constexpr int    blockSize  = 1024;
        const int        blocks     = static_cast<int> (600.0 * sampleRate / blockSize);

        VectorWaves::WavetableVoice voice;
        VectorWaves::ChipCore       chip;
        VectorWaves::FuseEngine     fuse;
        VectorWaves::VectorMixer    mixer;
        VectorWaves::FxRack         fx;

        voice.prepare (sampleRate);
        chip.prepare (sampleRate);
        fuse.prepare (sampleRate);
        mixer.prepare (sampleRate);
        fx.prepare (static_cast<float> (sampleRate));

        auto table = makeSineTable();
        voice.loadTable (table.data(), static_cast<int> (sampleRate));
        for (int id = 0; id < 12; ++id)
            voice.setParam (id, VectorWaves::kParamTable[static_cast<std::size_t> (id)].defaultVal);

        voice.noteOn (57, 0.9f);
        chip.noteOn (57, 0.9f);

        std::vector<float> vL (blockSize), vR (blockSize), cL (blockSize), cR (blockSize);
        std::vector<float> oL (blockSize), oR (blockSize);

        bool finite = true;
        float peakOut = 0.0f;

        for (int b = 0; b < blocks && finite; ++b)
        {
            std::fill (vL.begin(), vL.end(), 0.0f);
            std::fill (vR.begin(), vR.end(), 0.0f);
            std::fill (cL.begin(), cL.end(), 0.0f);
            std::fill (cR.begin(), cR.end(), 0.0f);

            voice.process (vL.data(), vR.data(), blockSize);
            chip.process (cL.data(), cR.data(), blockSize);

            for (int i = 0; i < blockSize; ++i)
            {
                fuse.processChipify (vL[(std::size_t) i], vR[(std::size_t) i]);
                fuse.applyChipToWave (vL[(std::size_t) i], vR[(std::size_t) i],
                                      cL[(std::size_t) i], cR[(std::size_t) i]);
            }

            mixer.mix (oL.data(), oR.data(),
                       vL.data(), vR.data(), cL.data(), cR.data(),
                       blockSize, 0.5f, 0.5f);
            fx.process (oL.data(), oR.data(), blockSize, 0.3f, 0.8f, 0.8f);

            for (int i = 0; i < blockSize; ++i)
            {
                if (! std::isfinite (oL[(std::size_t) i]) || ! std::isfinite (oR[(std::size_t) i]))
                {
                    finite = false;
                    break;
                }
                peakOut = std::max (peakOut, std::abs (oL[(std::size_t) i]));
            }
        }

        logMessage ("soak peak=" + juce::String (peakOut) + " over 600 s");
        expect (finite, "10 minutes of full-chain audio must stay finite");
        expect (peakOut > 0.0005f && peakOut < 1.0f, "soak must stay audible and unclipped");
    }
};

// ============================================================================
//  Registration and entry point
// ============================================================================
static TuningTest               tuningTest;
static AdsrAttackTest           adsrTest;
static DriftReproducibilityTest driftTest;
static DriftParamHandlingTest driftParamTest;
static NoNaNTest                nanTest;
static ChipCoreTest             chipTest;
static FuseEngineTest           fuseTest;
static FxRackTest               fxTest;
static VectorMixerTest          vectorTest;
static SiliconIntegrityTest     siliconTest;
static ChipFidelityTest         chipFidelityTest;
static LongSoakTest             longSoakTest;

int main (int argc, char* argv[])
{
    juce::ignoreUnused (argc, argv);

    juce::UnitTestRunner runner;
    runner.setAssertOnFailure (false);
    runner.runAllTests();

    int failures = 0;
    for (int i = 0; i < runner.getNumResults(); ++i)
    {
        if (auto* r = runner.getResult (i))
        {
            failures += r->failures;
            std::printf ("Test [%s]: %d passes, %d failures\n",
                         r->unitTestName.toRawUTF8(), r->passes, r->failures);
            for (const auto& msg : r->messages)
                std::printf ("   %s\n", msg.toRawUTF8());
        }
    }

    std::printf ("\n========================================\n");
    std::printf ("  VectorChip DSP Tests: %s (%d failures)\n",
                 failures == 0 ? "PASSED" : "FAILED", failures);
    std::printf ("========================================\n\n");

    return failures == 0 ? 0 : 1;
}
