#!/bin/bash
echo "Cleaning up MIDI environment..."

# Kill any running electron slave processes
pkill -f "electron-slave.js"
pkill -f "electron-slave"

echo "Killed zombie slave processes."

# Check for node processes that might be slaves
ps aux | grep "node" | grep "slave"

echo "Please ensure only ONE instance of the slave is running."
echo "If you see 'RtMidi Input Client' persist in the app, you might need to restart the audio subsystem (pipewire/jack) or the main Electron app."
