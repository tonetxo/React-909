# MIDI Clock Synchronization Guide

## Setup
1. Make sure the `snd_virmidi` module is loaded: `sudo modprobe snd_virmidi`
2. Run `aconnect -l` to verify virtual MIDI ports are available
3. Launch your Electron app

## Usage
1. In the app UI, you'll see a "MIDI Output" selector near the transport controls
2. Select one of the virtual MIDI ports (e.g., `VirMIDI 2-0`) from the dropdown
3. When you press Play, the app will:
   - Send MIDI Start message (0xFA)
   - Send MIDI Timing Clock messages (0xF8) at 24 pulses per quarter note (PPQ)
   - Send MIDI Stop message (0xFC) when you press Stop

## Connecting to Other Devices
To connect your app's MIDI clock to other software:
```bash
# List available ports
aconnect -l

# Connect your app's output to another application's input
aconnect "Your App Name" "Target App Name:input_port"

# Example: Connect to a DAW like Qtractor
aconnect "Your App Name" "qtractor:in_1"
```

## Monitoring MIDI Clock
To monitor the MIDI clock traffic:
```bash
# Monitor a specific port
aseqdump -p "VirMIDI 2-0"
# or using client:port format
aseqdump -p 24:0
```

You should see MIDI Start (FA) when playback begins and Timing Clock (F8) messages being sent 24 times per quarter note.

## Troubleshooting
- If no MIDI devices appear in the dropdown, ensure the Web MIDI API is enabled in your browser
- If clock isn't being received by other apps, check the connection with `aconnect`
- Make sure your target application is configured to receive external MIDI clock

## Preventing MIDI Feedback Loops
- The application now prevents auto-selection of "Midi Through" ports which are notorious for causing feedback loops
- When connecting your MIDI output to other devices, ensure you're not creating a loop where the output feeds back to the input
- Use the `aconnect` command to verify your MIDI routing and avoid circular connections:
  ```bash
  # Check current connections to avoid feedback loops
  aconnect -l
  
  # Disconnect problematic connections
  aconnect -d source_port destination_port
  ```
- The application will now warn you if it detects potentially problematic feedback routes