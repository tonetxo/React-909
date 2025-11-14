# Electron MIDI Slave and Linux Audio Optimization Guide

This guide provides instructions on how to integrate the MIDI slave logic into your Electron application and how to optimize your Linux environment for real-time audio.

## 1. Integrating the MIDI Slave in Electron

The `electron-slave.js` file contains a `MidiSlave` class that listens for MIDI clock messages and calculates a stable tempo using a Software Phase-Locked Loop (SPLL).

To use it in your Electron application, you need to:

1.  **Place `electron-slave.js` in your Electron project.**
2.  **In your Electron main process file (e.g., `main.js` or `index.js`), import and instantiate the `MidiSlave` class:**

```javascript
const { app, BrowserWindow } = require('electron');
const path = require('path');
const MidiSlave = require('./electron-slave.js'); // Adjust the path if necessary

let mainWindow;
let midiSlave;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      // It's recommended to use a preload script for security
    },
  });

  // Load your Vite app's URL
  mainWindow.loadURL('http://localhost:5173'); // Or your Vite dev server URL

  // --- MIDI Slave Integration ---
  // Replace 'Your Virtual MIDI Port Name' with the name of the virtual MIDI port
  // created by the Vite application (e.g., 'Electron Master Out' from the analysis).
  // You can see available ports by running `easymidi.getInputs()`
  const midiInputName = 'Your Virtual MIDI Port Name'; 
  midiSlave = new MidiSlave(midiInputName);

  // You can now use the midiSlave object to get the tempo and current step
  // and send it to your renderer process using IPC.
  setInterval(() => {
    if (midiSlave.isRunning) {
      const tempo = midiSlave.getTempo();
      const step = midiSlave.getCurrentStep();
      mainWindow.webContents.send('midi-clock-update', { tempo, step });
    }
  }, 10); // Send updates frequently

  mainWindow.on('closed', () => {
    mainWindow = null;
    if (midiSlave) {
      midiSlave.close();
    }
  });
}

app.on('ready', createWindow);

// ... other Electron app lifecycle methods
```

3.  **In your Electron renderer process (or preload script), you can listen for these updates:**

```javascript
// preload.js or in your renderer's main script
const { ipcRenderer } = require('electron');

ipcRenderer.on('midi-clock-update', (event, { tempo, step }) => {
  // Now you have the stable tempo and step in your renderer process
  // Use this information to drive your synthesizer's sequencer.
  console.log(`Tempo: ${tempo.toFixed(2)} BPM, Step: ${step}`);
});
```

## 2. Linux Audio Optimization

For stable, low-latency audio on Linux, it's crucial to make the following system-level changes:

### a. Install a Low-Latency Kernel

A low-latency kernel allows audio processes to run at a higher priority, reducing jitter and dropouts.

On Debian/Ubuntu-based systems (like Linux Mint), you can install it with:

```bash
sudo apt update
sudo apt install linux-lowlatency
```

After installation, **reboot your computer** and make sure you select the low-latency kernel from the GRUB menu.

### b. Set CPU Governor to "Performance"

This prevents the CPU from throttling down, which can cause audio glitches.

1.  Install a tool to manage CPU frequency:
    ```bash
    sudo apt install cpupower-gui
    ```
2.  Run `cpupower-gui` and set the governor for all CPU cores to **"Performance"**.

### c. Use PipeWire for Audio

Modern Linux distributions use PipeWire to manage all audio. It provides low-latency performance and compatibility with both JACK and PulseAudio applications.

1.  **Ensure PipeWire is installed and running:**
    ```bash
    sudo apt install pipewire pipewire-audio-client-libraries pipewire-jack
    ```
2.  **Verify that PipeWire is active:**
    ```bash
    pactl info | grep "Server Name: PipeWire"
    ```
    This command should show `Server Name: PipeWire...`.

3.  **(Optional) Fine-tune PipeWire for lower latency:**
    You can adjust PipeWire's buffer size for even lower latency. Create a file at `~/.config/pipewire/jack.conf` with the following content:

    ```
    # ~/.config/pipewire/jack.conf
    jack.properties = {
        node.latency = 128/48000
    }
    ```
    This sets the buffer size to 128 samples for a 48kHz sample rate. You can experiment with lower values (like 64), but it may increase CPU usage.

### d. Create a Virtual MIDI Port

To connect the Vite app's MIDI output to the Electron app's MIDI input, you need a virtual MIDI port.

The recommended way is to use the `snd-virmidi` kernel module:

1.  **Load the module:**
    ```bash
    sudo modprobe snd-virmidi
    ```
2.  **Check that the virtual MIDI ports are available:**
    ```bash
    amidi -l
    ```
    You should see one or more "Virtual Raw MIDI" devices.

3.  **Make the module load on boot:**
    Create a file at `/etc/modules-load.d/virmidi.conf` with the following content:
    ```
    snd-virmidi
    ```

Now, your Vite application should be able to select one of these virtual MIDI ports as its output, and your Electron application can listen on the same port.
