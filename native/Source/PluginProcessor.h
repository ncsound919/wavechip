#pragma once

// ============================================================================
//  VectorChip — PluginProcessor
//  JUCE AudioProcessor wrapping the complete VectorChip synthesis engine.
//
//  Hard rules:
//    - processBlock must be allocation-free and lock-free.
//    - Deterministic drift from explicit seed.
//    - Real-time parameter sync between JUCE APVTS and DSP components.
// ============================================================================

#include <juce_audio_processors/juce_audio_processors.h>
#include <juce_audio_utils/juce_audio_utils.h>

// DSP headers — pure C++20, no JUCE inside
#include "../DSP/Parameters.h"
#include "../DSP/MidiEventQueue.h"
#include "../DSP/WavetableVoice.h"
#include "../DSP/ChipCore.h"
#include "../DSP/FuseEngine.h"
#include "../DSP/VectorMixer.h"
#include "../DSP/FxRack.h"

namespace VectorChip
{

// ============================================================================
//  APVTS parameter layout helper
// ============================================================================
inline juce::AudioProcessorValueTreeState::ParameterLayout createParameterLayout()
{
    using namespace VectorWaves;
    using APF = juce::AudioParameterFloat;
    using APB = juce::AudioParameterBool;
    using API = juce::AudioParameterInt;
    using APC = juce::AudioParameterChoice;
    using NRange = juce::NormalisableRange<float>;

    auto logRange = [] (float mn, float mx, float def) -> NRange
    {
        (void) def;
        return NRange { mn, mx,
            [](float start, float end, float norm) {
                return start * std::pow (end / start, norm);
            },
            [](float start, float end, float plain) {
                return std::log (std::max(plain, start) / start) / std::log (end / start);
            },
            [](float start, float end, float v) {
                return juce::jlimit (start, end, v);
            }
        };
    };

    std::vector<std::unique_ptr<juce::RangedAudioParameter>> params;
    params.reserve (kNumParams + 10);

    // --- 0..11 Canonical M0 Parameters ---
    params.push_back (std::make_unique<APF> ("masterGain", "Master Gain", NRange { 0.0f, 1.0f }, 0.8f));
    params.push_back (std::make_unique<APF> ("tuneCents", "Tune (cents)", NRange { -100.0f, 100.0f }, 0.0f));
    params.push_back (std::make_unique<APF> ("attackSeconds", "Attack", logRange (0.001f, 8.0f, 0.01f), 0.01f));
    params.push_back (std::make_unique<APF> ("decaySeconds", "Decay", logRange (0.001f, 8.0f, 0.1f), 0.1f));
    params.push_back (std::make_unique<APF> ("sustainLevel", "Sustain", NRange { 0.0f, 1.0f }, 0.7f));
    params.push_back (std::make_unique<APF> ("releaseSeconds", "Release", logRange (0.001f, 16.0f, 0.3f), 0.3f));
    params.push_back (std::make_unique<APF> ("filterCutoffHz", "Filter Cutoff", logRange (20.0f, 20000.0f, 20000.0f), 20000.0f));
    params.push_back (std::make_unique<APF> ("driftAmount", "Drift Amount", NRange { 0.0f, 1.0f }, 0.2f));
    params.push_back (std::make_unique<APF> ("driftRate", "Drift Rate", logRange (0.001f, 10.0f, 0.5f), 0.5f));
    params.push_back (std::make_unique<APF> ("driftSpread", "Drift Spread", NRange { 0.0f, 1.0f }, 0.5f));
    params.push_back (std::make_unique<APF> ("driftWarmup", "Drift Warmup", NRange { 0.0f, 60.0f }, 2.0f));
    params.push_back (std::make_unique<APF> ("driftAge", "Drift Age", NRange { 0.0f, 1.0f }, 0.0f));

    // --- Vector Core ---
    params.push_back (std::make_unique<APF> ("vectorX", "Vector X", NRange { 0.0f, 1.0f }, 0.5f));
    params.push_back (std::make_unique<APF> ("vectorY", "Vector Y", NRange { 0.0f, 1.0f }, 0.5f));
    params.push_back (std::make_unique<APB> ("vectorEnvLoop", "Vector Env Loop", true));
    params.push_back (std::make_unique<APF> ("waveFrame", "Wave Frame", NRange { 0.0f, 63.0f, 1.0f }, 0.0f));
    params.push_back (std::make_unique<APB> ("waveMips", "Wave 11 Mips", true));

    // --- Fuse Matrix ---
    params.push_back (std::make_unique<APB> ("chipifyEnabled", "Chipify Active", false));
    params.push_back (std::make_unique<API> ("chipifyBits", "Chipify Bits", 4, 16, 8));
    params.push_back (std::make_unique<APF> ("chipifyAliasing", "Chipify Aliasing", NRange { 0.0f, 1.0f }, 0.25f));
    params.push_back (std::make_unique<API> ("chipToWaveMode", "Chip->Wave Mode", 0, 3, 0));
    params.push_back (std::make_unique<APF> ("chipToWaveAmount", "Chip->Wave Depth", NRange { 0.0f, 1.0f }, 0.25f));
    params.push_back (std::make_unique<API> ("waveToChipMode", "Wave->Chip Mode", 0, 2, 0));
    params.push_back (std::make_unique<APF> ("waveToChipRate", "Wave->Chip Rate", NRange { 0.0f, 1.0f }, 0.5f));

    // --- Chip Core ---
    params.push_back (std::make_unique<API> ("chipFamily", "Chip Family", 0, 3, 0));
    params.push_back (std::make_unique<API> ("chipVariant", "Chip Variant", 0, 3, 0));
    params.push_back (std::make_unique<API> ("chipRackInstances", "Rack Instances", 1, 8, 1));
    params.push_back (std::make_unique<APB> ("chipAuthenticTuning", "Authentic Tuning", true));
    params.push_back (std::make_unique<APB> ("chipWaveTri", "Chip Wave Tri", false));
    params.push_back (std::make_unique<APB> ("chipWaveSaw", "Chip Wave Saw", true));
    params.push_back (std::make_unique<APB> ("chipWavePulse", "Chip Wave Pulse", true));
    params.push_back (std::make_unique<APB> ("chipWaveNoise", "Chip Wave Noise", false));
    params.push_back (std::make_unique<APF> ("chipPulseWidth", "Chip Pulse Width", NRange { 0.05f, 0.95f }, 0.5f));
    params.push_back (std::make_unique<APF> ("chipAttack", "Chip Attack", NRange { 0.001f, 5.0f }, 0.05f));
    params.push_back (std::make_unique<APF> ("chipDecay", "Chip Decay", NRange { 0.001f, 5.0f }, 0.45f));
    params.push_back (std::make_unique<APF> ("chipSustain", "Chip Sustain", NRange { 0.0f, 1.0f }, 0.65f));
    params.push_back (std::make_unique<APF> ("chipRelease", "Chip Release", NRange { 0.001f, 10.0f }, 0.4f));
    params.push_back (std::make_unique<API> ("chipFilterMode", "Chip Filter Mode", 0, 3, 0));
    params.push_back (std::make_unique<APF> ("chipCutoff", "Chip Cutoff", NRange { 0.0f, 1.0f }, 0.6f));
    params.push_back (std::make_unique<APF> ("chipResonance", "Chip Resonance", NRange { 0.0f, 1.0f }, 0.35f));
    params.push_back (std::make_unique<APF> ("chipFilterCurve", "Chip Filter Curve", NRange { 0.0f, 1.0f }, 0.5f));
    params.push_back (std::make_unique<APF> ("chipFilterBias", "Chip Filter Bias", NRange { -1.0f, 1.0f }, 0.0f));
    params.push_back (std::make_unique<API> ("chipClock", "Chip Clock", 0, 2, 0));
    params.push_back (std::make_unique<API> ("chipDacBits", "Chip DAC Bits", 4, 12, 8));
    params.push_back (std::make_unique<API> ("chipFmAlgo", "Chip FM Algo", 0, 7, 0));
    params.push_back (std::make_unique<API> ("chipFmFeedback", "Chip FM Feedback", 0, 7, 3));
    params.push_back (std::make_unique<API> ("chipNoiseLfsr", "Chip Noise LFSR", 0, 2, 2));
    params.push_back (std::make_unique<API> ("chipWaveRamLen", "Chip Wave RAM Length", 16, 128, 32));
    params.push_back (std::make_unique<APF> ("chipPwmRate", "Chip PWM Rate", NRange { 0.0f, 1.0f }, 0.25f));
    params.push_back (std::make_unique<APF> ("chipPwmDepth", "Chip PWM Depth", NRange { 0.0f, 1.0f }, 0.0f));

    // --- Drift ---
    params.push_back (std::make_unique<APF> ("driftTempCorr", "Drift Temp Corr", NRange { 0.0f, 1.0f }, 0.6f));
    params.push_back (std::make_unique<APF> ("driftSeed", "Drift Seed", NRange { 1000.0f, 9999.0f, 1.0f }, 4242.0f));

    // --- Studio FX Rack ---
    params.push_back (std::make_unique<APF> ("analogSat", "Analog Saturation", NRange { 0.0f, 1.0f }, 0.3f));
    params.push_back (std::make_unique<APF> ("analogLpf", "Post Analog LPF", NRange { 0.0f, 1.0f }, 0.8f));
    params.push_back (std::make_unique<APF> ("chorusMix", "Chorus Mix", NRange { 0.0f, 1.0f }, 0.4f));
    params.push_back (std::make_unique<APF> ("chorusRate", "Chorus Rate", NRange { 0.05f, 5.0f }, 0.35f));
    params.push_back (std::make_unique<APF> ("delayMix", "Delay Mix", NRange { 0.0f, 1.0f }, 0.25f));
    params.push_back (std::make_unique<APF> ("delayTime", "Delay Time", NRange { 0.0f, 1.0f }, 0.42f));
    params.push_back (std::make_unique<APF> ("reverbMix", "Reverb Mix", NRange { 0.0f, 1.0f }, 0.32f));

    return { params.begin(), params.end() };
}

// ============================================================================
//  VectorChipProcessor
// ============================================================================
class VectorChipProcessor final : public juce::AudioProcessor
{
public:
    VectorChipProcessor();
    ~VectorChipProcessor() override;

    const juce::String getName() const override { return "VectorChip"; }

    bool acceptsMidi()  const override { return true;  }
    bool producesMidi() const override { return false; }
    bool isMidiEffect() const override { return false; }
    double getTailLengthSeconds() const override { return 0.0; }

    int  getNumPrograms()  override { return 1; }
    int  getCurrentProgram() override { return 0; }
    void setCurrentProgram (int) override {}
    const juce::String getProgramName (int) override { return "Default"; }
    void changeProgramName (int, const juce::String&) override {}

    void prepareToPlay (double sampleRate, int samplesPerBlock) override;
    void releaseResources() override;

    bool isBusesLayoutSupported (const BusesLayout& layouts) const override;

    // *** HARD RULE: no allocation, no locks in this method ***
    void processBlock (juce::AudioBuffer<float>&, juce::MidiBuffer&) override;

    juce::AudioProcessorEditor* createEditor() override;
    bool hasEditor() const override { return true; }

    void getStateInformation (juce::MemoryBlock& destData) override;
    void setStateInformation (const void* data, int sizeInBytes) override;

    void handleNativeEvent (const juce::String& name, const juce::var& payload);
    void scheduleTableLoad (const std::vector<float>& frame);

    // ---- Automation engine: per-parameter MIDI CC mapping ---------------------
    // The UI opens a small panel when a knob/slider is clicked; these are the
    // only three native calls behind it.
    juce::String getAutomationJson (const juce::String& paramId) const;
    void setAutomationJson (const juce::String& paramId, const juce::String& json);
    void beginCCLearn (const juce::String& paramId);

    // Diagnostics surface (V2.2): read-only snapshot for the UI / smoke tests.
    juce::var buildDiagnostics() const;

    std::atomic<float> cpuLoad { 0.0f };

    juce::AudioProcessorValueTreeState apvts;
    VectorWaves::DefaultMidiQueue      midiRing;

private:
    // Complete DSP Engine
    VectorWaves::WavetableVoice voice;
    VectorWaves::ChipCore       chipCore;
    VectorWaves::FuseEngine     fuse;
    VectorWaves::VectorMixer    mixer;
    VectorWaves::FxRack         fx;

    // Per-block scratch buffers (pre-allocated in prepareToPlay)
    juce::AudioBuffer<float> voiceBuffer;
    juce::AudioBuffer<float> chipBuffer;

    double currentSampleRate { 44100.0 };
    int    currentBlockSize  { 512 };

    void syncParamsToVoice() noexcept;

    // ---- Automation engine ---------------------------------------------------
    struct ParamAutomation
    {
        int   cc      = -1;     // -1 = not mapped
        float minV    = 0.0f;   // normalised sub-range the CC sweeps
        float maxV    = 1.0f;
        float slewMs  = 0.0f;   // 0 = instant
        float pos     = 0.0f;   // current normalised value while driven
        float target  = -1.0f;  // >= 0 while a CC drive is in flight
        bool  gesture = false;
    };

    void applyCcAutomation (const juce::MidiBuffer&, int numSamples);
    void loadAutomationFromState();
    void storeAutomationToState();
    int  automationIndex (const juce::String& paramId) const;

    std::vector<ParamAutomation> automation;
    std::vector<juce::String>    automationIds;
    mutable juce::SpinLock       automationLock;
    std::atomic<int>             learningIndex { -1 };

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (VectorChipProcessor)
};

} // namespace VectorChip