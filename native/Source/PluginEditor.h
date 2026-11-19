#pragma once

// ============================================================================
//  VectorChip — PluginEditor
//  Embeds a juce::WebBrowserComponent (WebView2 on Windows) serving the React
//  dist bundle from VectorChipUI binary data.
//
//  Follows the WebEditorBase.cpp pattern from ChordStudio exactly:
//    - buildWebOptions() wires native functions via .withNativeFunction()
//    - getWebResource() walks VectorChipUI::namedResourceList[]
//    - parameterChanged() triggers AsyncUpdater → emitEventIfBrowserIsVisible
//    - timerCallback() at 30 Hz closes stale drag gestures
// ============================================================================

#include <juce_audio_processors/juce_audio_processors.h>
#include <juce_gui_extra/juce_gui_extra.h>

#include <map>
#include <optional>
#include <set>

namespace VectorChip
{

class VectorChipProcessor; // forward declaration

// ============================================================================
class VectorChipEditor final : public juce::AudioProcessorEditor,
                               private juce::AudioProcessorValueTreeState::Listener,
                               private juce::AsyncUpdater,
                               private juce::Timer
{
public:
    explicit VectorChipEditor (VectorChipProcessor& processor);
    ~VectorChipEditor() override;

    void paint  (juce::Graphics&) override;
    void resized() override;

private:
    // ---- Web resource serving -----------------------------------------------
    juce::WebBrowserComponent::Options buildWebOptions();

    std::optional<juce::WebBrowserComponent::Resource>
        getWebResource (const juce::String& path) const;

    // ---- State snapshot sent to React ----------------------------------------
    juce::var buildState() const;

    // ---- Gesture tracking (same coalescing logic as WebEditorBase) -----------
    void setParamFromUI (const juce::String& id, double value);
    void beginGesture   (const juce::String& id);
    void endGesture     (const juce::String& id);
    void endAllGestures();

    // ---- juce::AudioProcessorValueTreeState::Listener -----------------------
    void parameterChanged (const juce::String& parameterID, float newValue) override;

    // ---- juce::AsyncUpdater --------------------------------------------------
    void handleAsyncUpdate() override;

    // ---- juce::Timer (30 Hz) --------------------------------------------------
    // Closes gestures whose drag has gone quiet (>150 ms since last write).
    void timerCallback() override;

    // ---- Members -------------------------------------------------------------
    VectorChipProcessor&                 proc;
    juce::AudioProcessorValueTreeState&  apvts;
    std::unique_ptr<juce::WebBrowserComponent> webView;

    // Gesture state (message-thread only)
    std::map<juce::String, juce::uint32> activeGestures; // id → timestamp
    std::set<juce::String>              heldGestures;   // explicitly held open

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (VectorChipEditor)
};

} // namespace VectorChip
