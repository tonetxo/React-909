#!/bin/bash

echo "Checking if MIDI clock messages are being sent..."
echo

# Check if virtual MIDI devices are available
echo "Checking ALSA MIDI devices:"
aconnect -l

echo
echo "Checking if virmidi module is loaded:"
lsmod | grep virmidi

echo
echo "To test MIDI clock, you can run aconnect to connect to a MIDI device:"
echo "Example: aconnect <your_app_port> <target_device_port>"
echo
echo "To monitor MIDI traffic in real-time, you can use:"
echo "  - amidi to send/receive MIDI messages"
echo "  - aseqdump to dump MIDI events"
echo "  - jack_midi_dump if using JACK"
echo
echo "For example, if you see a virtual MIDI port like 'virmidi' when running aconnect -l,"
echo "you can monitor it with: aseqdump -p <port_id>"

echo
echo "In your Electron app, when you start playback, the Web MIDI API should send:"
echo " - MIDI Start message (0xFA) when starting"
echo " - MIDI Timing Clock messages (0xF8) 24 times per quarter note (PPQ)"
echo " - MIDI Stop message (0xFC) when stopping"
echo
echo "You can verify by connecting your app's MIDI output to a DAW or hardware device"
echo "that can display incoming MIDI clock messages."