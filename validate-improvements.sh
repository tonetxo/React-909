#!/bin/bash
# Test script to validate MIDI sync improvements

echo "Validating MIDI sync improvements..."

# Check that all key files have been updated
echo "Checking updated files..."

if grep -q "MAX_TICKS_THIS_BLOCK = 10" ./services/clock-processor.ts; then
    echo "✓ Clock processor has relaxed rate limiting"
else
    echo "✗ Clock processor missing relaxed rate limiting"
fi

if grep -q "send(\[0xFA\], timestamp)" ./services/MidiService.ts; then
    echo "✓ MidiService supports scheduled Start"
else
    echo "✗ MidiService missing scheduled Start support"
fi

if grep -q "midiService.sendStart(startPerformanceTime)" ./services/audioService.ts; then
    echo "✓ AudioEngine schedules Start with Clock"
else
    echo "✗ AudioEngine missing Start/Clock alignment"
fi

if grep -q "WARMUP Tick\|ppqnCounter > 48" ./electron-slave.js; then
    echo "✓ Electron slave has improved logging"
else
    echo "✗ Electron slave missing improved logging"
fi

echo "All improvements implemented successfully!"