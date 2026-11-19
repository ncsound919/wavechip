#include "PluginProcessor.h"
#include "PluginEditor.h"

namespace VectorChip
{

// ============================================================================
//  VectorChipProcessor — construction & destruction
// ============================================================================
VectorChipProcessor::VectorChipProcessor()
    : juce::AudioProcessor (BusesProperties()
                                .withOutput ("Output", juce::AudioChannelSet::stereo(), true)),
      apvts (*this, nullptr, "VectorChipState", createParameterLayout())
{
    for (auto* p : getParameters())
        if (auto* rp = dynamic_cast<juce::RangedAudioParameter*> (p))
            automationIds.push_back (rp->getParameterID());

    automation.assign (automationIds.size(), {});
    loadAutomationFromState();
}

VectorChipProcessor::~VectorChipProcessor() = default;

// ============================================================================
//  Lifecycle
// ============================================================================
void VectorChipProcessor::prepareToPlay (double sampleRate, int samplesPerBlock)
{
    currentSampleRate = sampleRate;
    currentBlockSize  = samplesPerBlock;

    voice.prepare (sampleRate);
    chipCore.prepare (sampleRate);
    fuse.prepare (sampleRate);
    mixer.prepare (sampleRate);
    fx.prepare (static_cast<float> (sampleRate));

    // Pre-allocate scratch buffers so processBlock never touches the heap.
    voiceBuffer.setSize (2, samplesPerBlock, false, true, true);
    chipBuffer.setSize  (2, samplesPerBlock, false, true, true);

    syncParamsToVoice();
}

void VectorChipProcessor::releaseResources()
{
    {
        // Close any CC gesture still in flight, or the host keeps it open.
        const juce::SpinLock::ScopedLockType sl (automationLock);
        for (size_t i = 0; i < automation.size(); ++i)
        {
            auto& a = automation[i];
            if (! a.gesture) continue;
            if (auto* p = apvts.getParameter (automationIds[i])) p->endChangeGesture();
            a.gesture = false;
            a.target = -1.0f;
        }
    }

    voice.reset();
    chipCore.reset();
    fuse.reset();
    mixer.reset();
    fx.reset();
}

bool VectorChipProcessor::isBusesLayoutSupported (const BusesLayout& layouts) const
{
    if (layouts.getMainOutputChannelSet() != juce::AudioChannelSet::stereo())
        return false;
    return true;
}

// ============================================================================
//  processBlock — HARD RULE: NO allocation, NO locks.
// ============================================================================
void VectorChipProcessor::processBlock (juce::AudioBuffer<float>& buffer,
                                        juce::MidiBuffer&         midiMessages)
{
    juce::ScopedNoDenormals noDenormals;

    const auto tStart = juce::Time::getHighResolutionTicks();

    const int numFrames   = buffer.getNumSamples();
    const int numChannels = buffer.getNumChannels();

    for (auto i = getTotalNumInputChannels(); i < numChannels; ++i)
        buffer.clear (i, 0, numFrames);

    // --- Automation: a mapped CC moves its parameter through APVTS ---
    applyCcAutomation (midiMessages, numFrames);

    // --- Drain JUCE MIDI buffer into the native ring (no alloc) ---
    for (const auto meta : midiMessages)
    {
        const auto msg = meta.getMessage();

        if (msg.isNoteOn())
        {
            VectorWaves::MidiEvent ev;
            ev.type  = VectorWaves::MidiEvent::Type::NoteOn;
            ev.note  = static_cast<uint8_t> (msg.getNoteNumber());
            ev.value = msg.getFloatVelocity();
            midiRing.push (ev);
        }
        else if (msg.isNoteOff())
        {
            VectorWaves::MidiEvent ev;
            ev.type  = VectorWaves::MidiEvent::Type::NoteOff;
            ev.note  = static_cast<uint8_t> (msg.getNoteNumber());
            ev.value = 0.0f;
            midiRing.push (ev);
        }
        else if (msg.isPitchWheel())
        {
            VectorWaves::MidiEvent ev;
            ev.type  = VectorWaves::MidiEvent::Type::PitchBend;
            ev.note  = 0;
            ev.value = (static_cast<float> (msg.getPitchWheelValue()) / 8192.0f) - 1.0f;
            midiRing.push (ev);
        }
        else if (msg.isControllerOfType (1)) // Mod-wheel CC1
        {
            VectorWaves::MidiEvent ev;
            ev.type  = VectorWaves::MidiEvent::Type::ModWheel;
            ev.note  = 0;
            ev.value = static_cast<float> (msg.getControllerValue()) / 127.0f;
            midiRing.push (ev);
        }
    }

    // --- Drain the ring into the voice & chip (audio thread, zero alloc) ---
    while (auto optEv = midiRing.pop())
    {
        const auto& ev = *optEv;
        switch (ev.type)
        {
            case VectorWaves::MidiEvent::Type::NoteOn:
                voice.noteOn (ev.note, ev.value);
                chipCore.noteOn (ev.note, ev.value);
                mixer.noteOn();
                break;
            case VectorWaves::MidiEvent::Type::NoteOff:
                voice.noteOff();
                chipCore.noteOff();
                break;
            case VectorWaves::MidiEvent::Type::PitchBend:
                voice.setPitchBend (ev.value);
                chipCore.setPitchBend (ev.value);
                break;
            case VectorWaves::MidiEvent::Type::ModWheel:
                voice.setModWheel (ev.value);
                chipCore.setModWheel (ev.value);
                break;
        }
    }

    // --- Sync APVTS → DSP modules (control-rate, zero allocation) ---
    syncParamsToVoice();

    // --- 1. Render Wavetable voice ---
    voiceBuffer.clear();
    voice.process (voiceBuffer.getWritePointer (0),
                   voiceBuffer.getWritePointer (1),
                   numFrames);

    // --- 2. Render Chip voice ---
    chipBuffer.clear();
    chipCore.process (chipBuffer.getWritePointer (0),
                      chipBuffer.getWritePointer (1),
                      numFrames);

    // --- 3. Fuse Matrix (Chipify + Cross Modulation) ---
    float* vL = voiceBuffer.getWritePointer (0);
    float* vR = voiceBuffer.getWritePointer (1);
    const float* cL = chipBuffer.getReadPointer (0);
    const float* cR = chipBuffer.getReadPointer (1);

    for (int i = 0; i < numFrames; ++i)
    {
        // Chipify Wave (Bit depth & aliasing downsampling)
        fuse.processChipify (vL[i], vR[i]);

        // Wave->Chip Sync & RAM Drive
        if (fuse.checkWaveSync (vL[i]))
            chipCore.triggerSync();

        int ramIdx = 0;
        uint8_t ramNibble = 0;
        if (fuse.checkRamDrive (vL[i], ramIdx, ramNibble))
            chipCore.setWaveRamNibble (ramIdx, ramNibble);

        // Chip->Wave Cross-Mod (FM, Ring, Wavefolder)
        fuse.applyChipToWave (vL[i], vR[i], cL[i], cR[i]);
    }

    // --- 4. VectorMixer (Bilinear 4-quadrant blend + moving Vector Envelope) ---
    const float vecX = *apvts.getRawParameterValue ("vectorX");
    const float vecY = *apvts.getRawParameterValue ("vectorY");

    float* outL = buffer.getWritePointer (0);
    float* outR = buffer.getWritePointer (1);

    mixer.mix (outL, outR,
               voiceBuffer.getReadPointer (0), voiceBuffer.getReadPointer (1),
               chipBuffer.getReadPointer (0),  chipBuffer.getReadPointer (1),
               numFrames,
               vecX, vecY);

    // --- 5. Studio FX Rack (Analog Sat + Post LPF + Chorus + Tape Delay + Plate Reverb) ---
    const float masterGain = *apvts.getRawParameterValue ("masterGain");
    const float cutoff     = *apvts.getRawParameterValue ("filterCutoffHz");
    const float lpfNorm    = std::clamp (std::log (std::max (20.0f, cutoff) / 20.0f) / std::log (20000.0f / 20.0f), 0.0f, 1.0f);
    const float satAmt     = *apvts.getRawParameterValue ("analogSat");

    fx.process (outL, outR, numFrames, satAmt, lpfNorm, masterGain);

    // Diagnostics (V2.2): EMA render load, no allocations on the audio thread.
    if (currentSampleRate > 0.0 && numFrames > 0)
    {
        const auto elapsed = juce::Time::highResolutionTicksToSeconds (
            juce::Time::getHighResolutionTicks() - tStart);
        const float load = (float) (elapsed / ((double) numFrames / currentSampleRate));
        cpuLoad.store (cpuLoad.load() * 0.85f + load * 0.15f);
    }
}

// ============================================================================
//  State save / restore (APVTS XML)
// ============================================================================
void VectorChipProcessor::getStateInformation (juce::MemoryBlock& destData)
{
    storeAutomationToState();   // pick up CC numbers learned since the last save
    if (auto xml = apvts.copyState().createXml())
        copyXmlToBinary (*xml, destData);
}

void VectorChipProcessor::setStateInformation (const void* data, int sizeInBytes)
{
    if (auto xml = getXmlFromBinary (data, sizeInBytes))
        if (xml->hasTagName (apvts.state.getType()))
        {
            apvts.replaceState (juce::ValueTree::fromXml (*xml));
            loadAutomationFromState();
        }
}

// ============================================================================
//  Automation engine
//
//  A mapped CC drives the parameter through APVTS, so the host records it as a
//  normal parameter gesture. Each mapping can sweep a sub-range and can slew, so
//  coarse 7-bit CC steps do not zipper. A slew starts from the live parameter
//  value, never from the bottom of the range.
// ============================================================================
int VectorChipProcessor::automationIndex (const juce::String& paramId) const
{
    for (size_t i = 0; i < automationIds.size(); ++i)
        if (automationIds[i] == paramId) return (int) i;
    return -1;
}

juce::String VectorChipProcessor::getAutomationJson (const juce::String& paramId) const
{
    const int idx = automationIndex (paramId);
    ParamAutomation a {};
    {
        const juce::SpinLock::ScopedLockType sl (automationLock);
        if (idx >= 0 && idx < (int) automation.size()) a = automation[(size_t) idx];
    }

    auto* o = new juce::DynamicObject();
    o->setProperty ("cc", a.cc);
    o->setProperty ("min", a.minV);
    o->setProperty ("max", a.maxV);
    o->setProperty ("slew", a.slewMs);
    o->setProperty ("learning", learningIndex.load() == idx);
    return juce::JSON::toString (juce::var (o));
}

void VectorChipProcessor::setAutomationJson (const juce::String& paramId, const juce::String& json)
{
    const int idx = automationIndex (paramId);
    if (idx < 0) return;

    juce::var v;
    if (juce::JSON::parse (json, v).failed()) return;
    auto* o = v.getDynamicObject();
    if (o == nullptr) return;

    ParamAutomation a;
    {
        const juce::SpinLock::ScopedLockType sl (automationLock);
        a = automation[(size_t) idx];
    }

    if (o->hasProperty ("cc"))   a.cc     = juce::jlimit (-1, 127, (int) (double) o->getProperty ("cc"));
    if (o->hasProperty ("min"))  a.minV   = juce::jlimit (0.0f, 1.0f, (float) (double) o->getProperty ("min"));
    if (o->hasProperty ("max"))  a.maxV   = juce::jlimit (0.0f, 1.0f, (float) (double) o->getProperty ("max"));
    if (o->hasProperty ("slew")) a.slewMs = juce::jlimit (0.0f, 2000.0f, (float) (double) o->getProperty ("slew"));
    if (a.minV > a.maxV) std::swap (a.minV, a.maxV);

    {
        const juce::SpinLock::ScopedLockType sl (automationLock);
        automation[(size_t) idx] = a;
    }
    storeAutomationToState();
}

void VectorChipProcessor::beginCCLearn (const juce::String& paramId)
{
    learningIndex = automationIndex (paramId);
}

void VectorChipProcessor::applyCcAutomation (const juce::MidiBuffer& midi, int numSamples)
{
    if (automation.empty()) return;

    const juce::SpinLock::ScopedTryLockType sl (automationLock);
    if (! sl.isLocked()) return;    // the editor is rewriting the map; skip one block

    const float blockSecs = (float) numSamples / (float) juce::jmax (8000.0, currentSampleRate);
    auto paramAt = [this] (int i) { return apvts.getParameter (automationIds[(size_t) i]); };

    for (const auto meta : midi)
    {
        const auto m = meta.getMessage();
        if (! m.isController()) continue;

        const int cc = m.getControllerNumber();
        const int learn = learningIndex.load();
        if (learn >= 0 && learn < (int) automation.size())
        {
            automation[(size_t) learn].cc = cc;
            learningIndex.store (-1);
        }

        for (size_t i = 0; i < automation.size(); ++i)
        {
            auto& a = automation[i];
            if (a.cc != cc) continue;

            const float t = (float) m.getControllerValue() / 127.0f;
            a.target = a.minV + (a.maxV - a.minV) * t;

            if (auto* p = paramAt ((int) i))
            {
                // Seed the ramp from where the knob actually is.
                const bool starting = ! a.gesture;
                if (starting) { a.pos = p->getValue(); p->beginChangeGesture(); a.gesture = true; }

                if (a.slewMs <= 0.0f)
                {
                    p->setValueNotifyingHost (a.target);
                    a.pos = a.target;
                    a.target = -1.0f;
                    p->endChangeGesture();   // the slew loop will never run for this one
                    a.gesture = false;
                }
            }
        }
    }

    for (size_t i = 0; i < automation.size(); ++i)
    {
        auto& a = automation[i];

        if (a.cc < 0 && a.gesture)     // unlearned mid-gesture
        {
            if (auto* p = paramAt ((int) i)) p->endChangeGesture();
            a.gesture = false;
            a.target = -1.0f;
            continue;
        }

        if (a.target < 0.0f) continue;

        const float step = blockSecs / (a.slewMs * 0.001f);
        a.pos = a.target > a.pos ? juce::jmin (a.target, a.pos + step)
                                 : juce::jmax (a.target, a.pos - step);

        if (auto* p = paramAt ((int) i)) p->setValueNotifyingHost (a.pos);

        if (std::abs (a.pos - a.target) < 1.0e-4f)
        {
            a.target = -1.0f;
            if (a.gesture)
            {
                if (auto* p = paramAt ((int) i)) p->endChangeGesture();
                a.gesture = false;
            }
        }
    }
}

void VectorChipProcessor::loadAutomationFromState()
{
    const juce::SpinLock::ScopedLockType sl (automationLock);
    for (size_t i = 0; i < automation.size(); ++i)
    {
        ParamAutomation a {};
        const auto child = apvts.state.getChildWithName ("AUTOMATION_" + automationIds[i]);
        if (child.isValid())
        {
            a.cc     = (int) (double) child.getProperty ("cc", -1.0);
            a.minV   = (float) (double) child.getProperty ("min", 0.0);
            a.maxV   = (float) (double) child.getProperty ("max", 1.0);
            a.slewMs = (float) (double) child.getProperty ("slew", 0.0);
        }
        if (auto* p = apvts.getParameter (automationIds[i])) a.pos = p->getValue();
        automation[i] = a;
    }
}

void VectorChipProcessor::storeAutomationToState()
{
    const juce::SpinLock::ScopedLockType sl (automationLock);
    for (size_t i = 0; i < automation.size(); ++i)
    {
        const auto& a = automation[i];
        const juce::String name ("AUTOMATION_" + automationIds[i]);

        if (a.cc < 0 && a.minV <= 0.0f && a.maxV >= 1.0f && a.slewMs <= 0.0f)
        {
            if (const auto existing = apvts.state.getChildWithName (name); existing.isValid())
                apvts.state.removeChild (existing, nullptr);
            continue;
        }

        auto child = apvts.state.getOrCreateChildWithName (name, nullptr);
        child.setProperty ("cc",   a.cc,     nullptr);
        child.setProperty ("min",  a.minV,   nullptr);
        child.setProperty ("max",  a.maxV,   nullptr);
        child.setProperty ("slew", a.slewMs, nullptr);
    }
}

// ============================================================================
//  Native event dispatch (message thread, from PluginEditor)
// ============================================================================
void VectorChipProcessor::handleNativeEvent (const juce::String& name,
                                             const juce::var&    payload)
{
    jassert (juce::MessageManager::getInstance()->isThisTheMessageThread());

    if (name == "noteOn")
    {
        const int   note = static_cast<int> (payload["note"]);
        const float vel  = static_cast<float> (static_cast<double> (payload["velocity"]));

        VectorWaves::MidiEvent ev;
        ev.type  = VectorWaves::MidiEvent::Type::NoteOn;
        ev.note  = static_cast<uint8_t> (juce::jlimit (0, 127, note));
        ev.value = juce::jlimit (0.0f, 1.0f, vel);
        midiRing.push (ev);
    }
    else if (name == "noteOff")
    {
        const int note = static_cast<int> (payload["note"]);

        VectorWaves::MidiEvent ev;
        ev.type  = VectorWaves::MidiEvent::Type::NoteOff;
        ev.note  = static_cast<uint8_t> (juce::jlimit (0, 127, note));
        ev.value = 0.0f;
        midiRing.push (ev);
    }
    else if (name == "loadWavetable")
    {
        if (auto* arr = payload["frame"].getArray())
        {
            if (arr->size() == 2048)
            {
                std::vector<float> frame;
                frame.reserve (2048);
                for (const auto& v : *arr)
                    frame.push_back (static_cast<float> (static_cast<double> (v)));
                scheduleTableLoad (frame);
            }
        }
    }
    else if (name == "setWaveRam")
    {
        if (auto* arr = payload["ram"].getArray())
        {
            for (int i = 0; i < std::min (32, arr->size()); ++i)
                chipCore.setWaveRamNibble (i, static_cast<int> ((*arr)[i]));
        }
    }
}

void VectorChipProcessor::scheduleTableLoad (const std::vector<float>& frame)
{
    voice.loadTable (frame.data(), static_cast<int> (currentSampleRate));
}

// ============================================================================
//  Editor
// ============================================================================
juce::AudioProcessorEditor* VectorChipProcessor::createEditor()
{
    return new VectorChipEditor (*this);
}

// ============================================================================
//  syncParamsToVoice — Poll all APVTS values to DSP (zero alloc, zero lock)
// ============================================================================
void VectorChipProcessor::syncParamsToVoice() noexcept
{
    // Canonical M0
    voice.setParam (VectorWaves::kMasterGain,     *apvts.getRawParameterValue ("masterGain"));
    voice.setParam (VectorWaves::kTuneCents,      *apvts.getRawParameterValue ("tuneCents"));
    voice.setParam (VectorWaves::kAttackSeconds,  *apvts.getRawParameterValue ("attackSeconds"));
    voice.setParam (VectorWaves::kDecaySeconds,   *apvts.getRawParameterValue ("decaySeconds"));
    voice.setParam (VectorWaves::kSustainLevel,   *apvts.getRawParameterValue ("sustainLevel"));
    voice.setParam (VectorWaves::kReleaseSeconds, *apvts.getRawParameterValue ("releaseSeconds"));
    voice.setParam (VectorWaves::kFilterCutoffHz, *apvts.getRawParameterValue ("filterCutoffHz"));
    voice.setParam (VectorWaves::kDriftAmount,    *apvts.getRawParameterValue ("driftAmount"));
    voice.setParam (VectorWaves::kDriftRate,      *apvts.getRawParameterValue ("driftRate"));
    voice.setParam (VectorWaves::kDriftSpread,    *apvts.getRawParameterValue ("driftSpread"));
    voice.setParam (VectorWaves::kDriftWarmup,    *apvts.getRawParameterValue ("driftWarmup"));
    voice.setParam (VectorWaves::kDriftAge,       *apvts.getRawParameterValue ("driftAge"));

    // Chip Core
    chipCore.setParam (VectorWaves::kChipFamily,          *apvts.getRawParameterValue ("chipFamily"));
    chipCore.setParam (VectorWaves::kChipVariant,         *apvts.getRawParameterValue ("chipVariant"));
    chipCore.setParam (VectorWaves::kChipRackInstances,   *apvts.getRawParameterValue ("chipRackInstances"));
    chipCore.setParam (VectorWaves::kChipAuthenticTuning, *apvts.getRawParameterValue ("chipAuthenticTuning"));
    chipCore.setParam (VectorWaves::kChipWaveTri,         *apvts.getRawParameterValue ("chipWaveTri"));
    chipCore.setParam (VectorWaves::kChipWaveSaw,         *apvts.getRawParameterValue ("chipWaveSaw"));
    chipCore.setParam (VectorWaves::kChipWavePulse,       *apvts.getRawParameterValue ("chipWavePulse"));
    chipCore.setParam (VectorWaves::kChipWaveNoise,       *apvts.getRawParameterValue ("chipWaveNoise"));
    chipCore.setParam (VectorWaves::kChipPulseWidth,      *apvts.getRawParameterValue ("chipPulseWidth"));
    chipCore.setParam (VectorWaves::kChipAttack,          *apvts.getRawParameterValue ("chipAttack"));
    chipCore.setParam (VectorWaves::kChipDecay,           *apvts.getRawParameterValue ("chipDecay"));
    chipCore.setParam (VectorWaves::kChipSustain,         *apvts.getRawParameterValue ("chipSustain"));
    chipCore.setParam (VectorWaves::kChipRelease,         *apvts.getRawParameterValue ("chipRelease"));
    chipCore.setParam (VectorWaves::kChipFilterMode,      *apvts.getRawParameterValue ("chipFilterMode"));
    chipCore.setParam (VectorWaves::kChipCutoff,          *apvts.getRawParameterValue ("chipCutoff"));
    chipCore.setParam (VectorWaves::kChipReso,            *apvts.getRawParameterValue ("chipResonance"));
    chipCore.setParam (VectorWaves::kChipFilterCurve,     *apvts.getRawParameterValue ("chipFilterCurve"));
    chipCore.setParam (VectorWaves::kChipFilterBias,      *apvts.getRawParameterValue ("chipFilterBias"));
    chipCore.setParam (VectorWaves::kChipClock,           *apvts.getRawParameterValue ("chipClock"));
    chipCore.setParam (VectorWaves::kChipDacBits,         *apvts.getRawParameterValue ("chipDacBits"));
    chipCore.setParam (VectorWaves::kChipFmAlgo,          *apvts.getRawParameterValue ("chipFmAlgo"));
    chipCore.setParam (VectorWaves::kChipFmFeedback,      *apvts.getRawParameterValue ("chipFmFeedback"));
    chipCore.setParam (VectorWaves::kChipNoiseLfsr,       *apvts.getRawParameterValue ("chipNoiseLfsr"));
    chipCore.setParam (VectorWaves::kChipWaveRamLen,      *apvts.getRawParameterValue ("chipWaveRamLen"));
    chipCore.setParam (VectorWaves::kChipPwmRate,         *apvts.getRawParameterValue ("chipPwmRate"));
    chipCore.setParam (VectorWaves::kChipPwmDepth,        *apvts.getRawParameterValue ("chipPwmDepth"));

    // Fuse Matrix
    const bool chipifyOn    = *apvts.getRawParameterValue ("chipifyEnabled") >= 0.5f;
    const int  chipifyBits  = static_cast<int> (*apvts.getRawParameterValue ("chipifyBits"));
    const float chipifyAlias = *apvts.getRawParameterValue ("chipifyAliasing");
    fuse.setChipify (chipifyOn, chipifyBits, chipifyAlias);

    const int   c2wMode   = static_cast<int> (*apvts.getRawParameterValue ("chipToWaveMode"));
    const float c2wAmt    = *apvts.getRawParameterValue ("chipToWaveAmount");
    fuse.setChipToWave (c2wMode, c2wAmt);

    const int   w2cMode   = static_cast<int> (*apvts.getRawParameterValue ("waveToChipMode"));
    const float w2cRate   = *apvts.getRawParameterValue ("waveToChipRate");
    fuse.setWaveToChip (w2cMode, w2cRate);

    // Vector Envelope loop
    mixer.setEnvLoop (*apvts.getRawParameterValue ("vectorEnvLoop") >= 0.5f);

    // Studio FX
    fx.setChorus (*apvts.getRawParameterValue ("chorusMix"),
                  *apvts.getRawParameterValue ("chorusRate"));
    fx.setDelay  (*apvts.getRawParameterValue ("delayMix"),
                  *apvts.getRawParameterValue ("delayTime"));
    fx.setReverb (*apvts.getRawParameterValue ("reverbMix"));
}

juce::var VectorChipProcessor::buildDiagnostics() const
{
    auto* o = new juce::DynamicObject();
    o->setProperty ("cpu",        cpuLoad.load());
    o->setProperty ("sampleRate", currentSampleRate);
    o->setProperty ("blockSize",  currentBlockSize);
    o->setProperty ("voiceActive", voice.isActive());
    o->setProperty ("numParams",  (int) automationIds.size());
    return juce::var (o);
}

} // namespace VectorChip

// ============================================================================
//  JUCE plugin factory entry point
// ============================================================================
juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter()
{
    return new VectorChip::VectorChipProcessor();
}