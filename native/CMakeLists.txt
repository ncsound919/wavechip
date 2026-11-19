cmake_minimum_required(VERSION 3.22)
project(VectorChip VERSION 1.0.0 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# MSVC-specific flags required by AGENTS.md
if(MSVC)
    add_compile_options(/MP /permissive-)
endif()

# ============================================================================
#  JUCE discovery
#  Priority: 1) JUCE_DIR cache/env variable, 2) local .deps path, 3) FetchContent
# ============================================================================

# Allow the developer to override via -DJUCE_DIR=... or env JUCE_DIR
if(NOT DEFINED JUCE_DIR)
    if(DEFINED ENV{JUCE_DIR})
        set(JUCE_DIR "$ENV{JUCE_DIR}" CACHE PATH "Path to JUCE root")
    elseif(EXISTS "C:/Users/Asus/Desktop/Plugins/VST DAW/third_party/JUCE/CMakeLists.txt")
        set(JUCE_DIR "C:/Users/Asus/Desktop/Plugins/VST DAW/third_party/JUCE" CACHE PATH "Path to JUCE root")
    else()
        set(JUCE_DIR "C:/Users/Asus/Desktop/Plugins/.deps/JUCE" CACHE PATH "Path to JUCE root")
    endif()
endif()

# WebView2: shared setup (defines, SDK include, static loader). Must be included
# BEFORE add_subdirectory(JUCE) so JUCE picks up the same package location.
include("${CMAKE_CURRENT_SOURCE_DIR}/../../cmake/WebView2Plugin.cmake")

if(EXISTS "${JUCE_DIR}/CMakeLists.txt")
    message(STATUS "VectorChip: Using JUCE from ${JUCE_DIR}")
    add_subdirectory("${JUCE_DIR}" JUCE EXCLUDE_FROM_ALL)
else()
    message(STATUS "VectorChip: JUCE not found at ${JUCE_DIR}, fetching from GitHub (tag 8.0.14)")
    include(FetchContent)
    FetchContent_Declare(
        JUCE
        GIT_REPOSITORY https://github.com/juce-framework/JUCE.git
        GIT_TAG        8.0.14
        GIT_SHALLOW    TRUE)
    FetchContent_MakeAvailable(JUCE)
endif()

# ============================================================================
#  Binary data — React dist bundle
#  NOT fatal if dist/ doesn't exist yet (developer configures before first
#  `npm run build`). An empty placeholder list produces a valid but empty target.
# ============================================================================
file(GLOB_RECURSE DIST_FILES CONFIGURE_DEPENDS
    "${CMAKE_CURRENT_SOURCE_DIR}/../dist/*")

if(NOT DIST_FILES)
    message(WARNING
        "VectorChip: dist/ is empty or missing. Run `npm run build` before "
        "building the VST to populate the embedded UI bundle. "
        "Continuing with an empty VectorChipUI binary-data target.")

    # Create a stub source so juce_add_binary_data has something to link.
    set(DIST_STUB_PATH "${CMAKE_CURRENT_BINARY_DIR}/dist_stub_placeholder.txt")
    if(NOT EXISTS "${DIST_STUB_PATH}")
        file(WRITE "${DIST_STUB_PATH}" "placeholder")
    endif()
    set(DIST_FILES "${DIST_STUB_PATH}")
endif()

juce_add_binary_data(VectorChipUI
    NAMESPACE   VectorChipUI
    HEADER_NAME VectorChipUI.h
    SOURCES     ${DIST_FILES})

# ============================================================================
#  Plugin target
# ============================================================================
juce_add_plugin(VectorChip
    FORMATS                 VST3 Standalone
    IS_SYNTH                TRUE
    NEEDS_MIDI_INPUT        TRUE
    PLUGIN_MANUFACTURER_CODE Vcwv
    PLUGIN_CODE             Vchp
    COMPANY_NAME            "VectorChip"
    PRODUCT_NAME            "VectorChip"
    VST3_CATEGORIES         "Instrument|Synth"
    DESCRIPTION             "VectorChip M0 — wavetable synthesiser"
    VERSION                 "1.0.0")

# Sources — DSP (pure C++, no JUCE) + JUCE host layer
file(GLOB DSP_SOURCES CONFIGURE_DEPENDS "${CMAKE_CURRENT_SOURCE_DIR}/DSP/*.cpp")
file(GLOB HOST_SOURCES CONFIGURE_DEPENDS "${CMAKE_CURRENT_SOURCE_DIR}/Source/*.cpp")

target_sources(VectorChip PRIVATE ${DSP_SOURCES} ${HOST_SOURCES})

# Include paths
target_include_directories(VectorChip PRIVATE
    "${CMAKE_CURRENT_SOURCE_DIR}"        # native/ root (for quoted DSP/ includes)
    "${CMAKE_CURRENT_SOURCE_DIR}/DSP"
    "${CMAKE_CURRENT_SOURCE_DIR}/Source")

# Compile definitions
target_compile_definitions(VectorChip
    PUBLIC
        JUCE_DISPLAY_SPLASH_SCREEN=0
        JUCE_VST3_CAN_REPLACE_VST2=0)

synths_configure_webview2(VectorChip)

# Link libraries
target_link_libraries(VectorChip
    PRIVATE
        juce::juce_audio_processors
        juce::juce_audio_utils
        juce::juce_dsp
        juce::juce_gui_extra
        VectorChipUI
        juce::juce_recommended_config_flags
        juce::juce_recommended_lto_flags
        juce::juce_recommended_warning_flags)

# ============================================================================
#  Optional test target
#  Enable with: cmake -DVECTORCHIP_BUILD_TESTS=ON
# ============================================================================
option(VECTORCHIP_BUILD_TESTS "Build VectorChip DSP unit tests" OFF)

if(VECTORCHIP_BUILD_TESTS)
    juce_add_console_app(VectorChipTests
        PRODUCT_NAME "VectorChipTests")

    file(GLOB TEST_SOURCES CONFIGURE_DEPENDS "${CMAKE_CURRENT_SOURCE_DIR}/Tests/*.cpp")
    file(GLOB DSP_SOURCES_FOR_TEST CONFIGURE_DEPENDS "${CMAKE_CURRENT_SOURCE_DIR}/DSP/*.cpp")

    target_sources(VectorChipTests PRIVATE
        ${TEST_SOURCES}
        ${DSP_SOURCES_FOR_TEST})

    target_include_directories(VectorChipTests PRIVATE
        "${CMAKE_CURRENT_SOURCE_DIR}"
        "${CMAKE_CURRENT_SOURCE_DIR}/DSP")

    target_compile_definitions(VectorChipTests PRIVATE
        JUCE_STANDALONE_APPLICATION=1)

    target_link_libraries(VectorChipTests PRIVATE
        juce::juce_audio_basics
        juce::juce_audio_formats
        juce::juce_dsp
        juce::juce_recommended_config_flags
        juce::juce_recommended_warning_flags)
endif()
