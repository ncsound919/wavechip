#pragma once

// ============================================================================
//  VectorWaves — Lock-free SPSC MIDI Event Queue (M0)
//  Pure C++20. No JUCE, no heap allocation in push/pop.
//
//  Single-Producer Single-Consumer ring buffer.
//  Capacity must be a power of two.
//
//  Memory order protocol:
//    push (audio / message thread):
//      write slot then release-store tail
//    pop (audio render thread, single consumer):
//      acquire-load tail, then relaxed-load head
// ============================================================================

#include <atomic>
#include <cstdint>
#include <optional>

namespace VectorWaves {

// ---------------------------------------------------------------------------
//  MIDI event payload
// ---------------------------------------------------------------------------
struct MidiEvent {
    enum class Type : uint8_t {
        NoteOn    = 0,
        NoteOff   = 1,
        PitchBend = 2,
        ModWheel  = 3
    };

    Type    type  = Type::NoteOff;
    uint8_t note  = 0;    // MIDI note 0-127; channel pitch for PitchBend/Mod
    float   value = 0.0f; // velocity [0,1], pitch-bend [-1,1], mod [0,1]
};

// ---------------------------------------------------------------------------
//  MidiEventQueue — fixed capacity 256, power-of-two ring
// ---------------------------------------------------------------------------
template<std::size_t Capacity = 256>
class MidiEventQueue {
    static_assert((Capacity & (Capacity - 1)) == 0,
                  "Capacity must be a power of two");
    static constexpr std::size_t kMask = Capacity - 1;

public:
    MidiEventQueue() noexcept {
        // Ensure indices start at 0
        head_.store(0, std::memory_order_relaxed);
        tail_.store(0, std::memory_order_relaxed);
    }

    // -----------------------------------------------------------------------
    //  push — called from the PRODUCER thread only (message / MIDI thread).
    //  Returns false if the queue is full (event is dropped).
    //  No allocation. No locks.
    // -----------------------------------------------------------------------
    [[nodiscard]] bool push(const MidiEvent& ev) noexcept {
        const std::size_t tail = tail_.load(std::memory_order_relaxed);
        const std::size_t head = head_.load(std::memory_order_acquire);

        if ((tail - head) >= Capacity)
            return false; // full — drop event

        buffer_[tail & kMask] = ev;
        tail_.store(tail + 1, std::memory_order_release);
        return true;
    }

    // -----------------------------------------------------------------------
    //  pop — called from the CONSUMER thread only (audio render thread).
    //  Returns std::nullopt if empty.
    //  No allocation. No locks.
    // -----------------------------------------------------------------------
    [[nodiscard]] std::optional<MidiEvent> pop() noexcept {
        const std::size_t head = head_.load(std::memory_order_relaxed);
        const std::size_t tail = tail_.load(std::memory_order_acquire);

        if (head == tail)
            return std::nullopt; // empty

        MidiEvent ev = buffer_[head & kMask];
        head_.store(head + 1, std::memory_order_release);
        return ev;
    }

    // -----------------------------------------------------------------------
    //  Helpers — safe to call from either thread for diagnostics only.
    //  Do NOT use the returned value to make audio-thread decisions.
    // -----------------------------------------------------------------------
    [[nodiscard]] bool empty() const noexcept {
        return head_.load(std::memory_order_acquire) ==
               tail_.load(std::memory_order_acquire);
    }

    [[nodiscard]] std::size_t size() const noexcept {
        const auto t = tail_.load(std::memory_order_acquire);
        const auto h = head_.load(std::memory_order_acquire);
        return t - h;
    }

    void clear() noexcept {
        head_.store(tail_.load(std::memory_order_acquire),
                    std::memory_order_release);
    }

private:
    // Pad to separate cache lines (false-sharing avoidance).
    alignas(64) std::atomic<std::size_t> head_{0};
    alignas(64) std::atomic<std::size_t> tail_{0};

    MidiEvent buffer_[Capacity];
};

// Default alias used throughout VectorWaves
using DefaultMidiQueue = MidiEventQueue<256>;

} // namespace VectorWaves
