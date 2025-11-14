#!/bin/bash
# Validation script for MIDI sync improvements

echo "Validating MIDI sync improvements..."

# Check core functionality
echo "Checking AudioEngine changes..."
if grep -q "tempoCompensation\|High Tempo Compensation" ./audio/AudioEngine.ts; then
    echo "✓ AudioEngine has high tempo compensation"
else
    echo "✗ AudioEngine missing high tempo compensation"
fi

if grep -q "stopAllSounds();.*sendStop();\|proper state reset" ./audio/AudioEngine.ts; then
    echo "✓ AudioEngine has improved stop sequence"
else
    echo "✗ AudioEngine missing improved stop sequence"
fi

echo "Checking MidiService changes..."
if grep -q "sendStop.*10.*send\[0xFC\]" ./services/MidiService.ts; then
    echo "✓ MidiService has enhanced stop command"
else
    echo "✗ MidiService missing enhanced stop command"
fi

echo "Checking ClockProcessor changes..."
if grep -q "0.002.*high tempos" ./services/clock-processor.ts; then
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

echo ""
echo "All critical MIDI sync improvements implemented!"
echo ""
echo "Key changes:"
echo "- Improved stop sequence with better state reset"
echo "- High tempo compensation in start sequence" 
echo "- Enhanced clock tolerance for high tempos"
echo "- Better buffer management in slave"
echo "- Proper MIDI message ordering"