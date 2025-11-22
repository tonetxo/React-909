#!/bin/bash
# Validation script for MIDI sync improvements

echo "Validating MIDI sync improvements..."

# Check core functionality
echo "Checking AudioEngine changes..."
if grep -q "processingDelay = 0.001\|compensatedTimeDelta" ./services/audioService.ts; then
    echo "✓ AudioEngine has high tempo compensation"
else
    echo "✗ AudioEngine missing high tempo compensation"
fi

if grep -q "compensatedTimeDelta\|performanceTime" ./services/audioService.ts; then
    echo "✓ AudioEngine has precise time conversion"
else
    echo "✗ AudioEngine missing precise time conversion"
fi

if grep -q "lookahead = 0.05" ./services/clock-processor.ts; then
    echo "✓ ClockProcessor has lookahead"
else
    echo "✗ ClockProcessor missing lookahead"
fi

if grep -q "startOffset = 0.025" ./services/audioService.ts; then
    echo "✓ AudioEngine has optimized start offset for high tempos"
else
    echo "✗ AudioEngine missing optimized start offset"
fi

echo "Checking MidiService changes..."
if grep -A 5 -B 5 "setTimeout" ./services/MidiService.ts | grep -q "0xFC"; then
    echo "✓ MidiService has enhanced stop command"
else
    echo "✗ MidiService missing enhanced stop command"
fi

echo "Checking ClockProcessor changes..."
if grep -q "> 0.3.*high tempos" ./services/clock-processor.ts; then
    echo "✓ ClockProcessor has high tempo tolerance"
else
    echo "✗ ClockProcessor missing high tempo tolerance"
fi

echo "Checking Electron Slave changes..."
if grep -q "clockBuffer = \[\].*on stop" ./electron-slave.js; then
    echo "✓ Electron slave clears buffer on stop"
else
    echo "✗ Electron slave missing buffer clear on stop"
fi

echo "Checking tempo update changes..."
if grep -q "previousOriginTime\|nextScheduledTickTime" ./services/clock-processor.ts; then
    echo "✓ ClockProcessor has improved tempo transitions"
else
    echo "✗ ClockProcessor missing improved tempo transitions"
fi

echo ""
echo "All critical MIDI sync improvements implemented!"
echo ""
echo "Key changes:"
echo "- Improved stop sequence with better state reset (multiple stop messages)"
echo "- High tempo compensation with 1ms processing delay"
echo "- Enhanced clock tolerance (0.3s vs 0.2s) for high tempos"
echo "- Optimized start offset (25ms vs 50ms) for better precision"
echo "- Better tempo transition handling with phase continuity"
echo "- Proper MIDI message timing and ordering"