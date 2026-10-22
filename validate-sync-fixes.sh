#!/bin/bash
# Updated validation script for MIDI sync and critical fixes

echo "Validating project integrity and critical fixes..."

# 1. Check infinite loop fix in clock-processor.js
echo "Checking clock-processor.js..."
if grep -q "ticksSent++; // Safety" ./services/clock-processor.js; then
    echo "✓ clock-processor.js has infinite loop protection"
else
    echo "✗ clock-processor.js missing infinite loop protection"
fi

# 2. Check dead code removal in SequencerEngine.ts
echo "Checking SequencerEngine.ts..."
if grep -q "if (nextSongStep === -1)" ./sequencer/SequencerEngine.ts; then
    echo "✗ SequencerEngine.ts still contains unreachable dead code"
else
    echo "✓ SequencerEngine.ts dead code removed"
fi

# 3. Check for abandoned state file
echo "Checking for unused AppState.ts..."
if [ -f "./state/AppState.ts" ]; then
    echo "✗ state/AppState.ts still exists (should be deleted)"
else
    echo "✓ state/AppState.ts deleted"
fi

# 4. Check core AudioEngine features
echo "Checking AudioEngine..."
if grep -q "anchorPerfTime =" ./services/audioService.ts; then
    echo "✓ AudioEngine has robust timing anchors"
else
    echo "✗ AudioEngine missing robust timing anchors"
fi

if grep -q "startOffset = 0.25" ./services/audioService.ts; then
    echo "✓ AudioEngine has correct start offset"
else
    echo "✗ AudioEngine has incorrect or missing start offset"
fi

# 5. Check MidiService stop sequence
echo "Checking MidiService..."
if grep -A 15 "sendStop(" ./services/MidiService.ts | grep -q "0xFC"; then
    echo "✓ MidiService has MIDI Stop command"
else
    echo "✗ MidiService missing MIDI Stop command"
fi

echo ""
echo "Validation complete."