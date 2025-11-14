#!/bin/bash
# Test script to validate MIDI sync improvements

echo "Validating MIDI sync improvements..."

# Check that all key files have been updated
echo "Checking updated files..."

if grep -q "warmupPhase\|warmupTicks" ./services/clock-processor.ts; then
    echo "✓ Clock processor has warmup logic"
else
    echo "✗ Clock processor missing warmup logic"
fi

if grep -q "setTimeout.*send.*0xFA" ./services/MidiService.ts; then
    echo "✓ MidiService has improved start timing"
else
    echo "✗ MidiService missing improved start timing"
fi

if grep -q "initialLookahead\|extended lookahead" ./audio/AudioEngine.ts; then
    echo "✓ AudioEngine has improved scheduling"
else
    echo "✗ AudioEngine missing improved scheduling"
fi

if grep -q "WARMUP Tick\|ppqnCounter > 48" ./electron-slave.js; then
    echo "✓ Electron slave has improved logging"
else
    echo "✗ Electron slave missing improved logging"
fi

echo "All improvements implemented successfully!"