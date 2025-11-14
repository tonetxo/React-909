// electron-slave.js

const easymidi = require('easymidi');

class MidiSlave {
  constructor(inputName) {
    this.inputName = inputName;
    this.input = null;
    this.ppqnCounter = 0;
    this.lastTickTime = null;
    this.isRunning = false;
    this.smoothedDelta = 0;
    this.alpha = 0.15; // Increased smoothing factor for high tempo stability
    this.clockBuffer = []; // Buffer to calculate more stable tempo
    this.bufferSize = 24; // Buffer size for tempo calculation (1 quarter note at 24 PPQ)
    this.syncAttempts = 0; // Track sync attempts to handle sync loss

    this.init();
  }

  init() {
    try {
      this.input = new easymidi.Input(this.inputName);
      console.log(`Listening for MIDI on: ${this.inputName}`);

      this.input.on('clock', () => {
        if (!this.isRunning) return;

        const now = process.hrtime.bigint();
        if (this.lastTickTime) {
          const delta = Number(now - this.lastTickTime); // Delta in nanoseconds
          const deltaMs = (delta / 1_000_000).toFixed(3);
          const instantaneousTempo = (1_000_000_000 * 60) / (24 * delta);

          // Add to buffer for more stable tempo calculation
          this.clockBuffer.push(delta);
          if (this.clockBuffer.length > this.bufferSize) {
            this.clockBuffer.shift(); // Remove oldest value
          }

          // Calculate average from buffer for stable tempo
          const avgDelta = this.clockBuffer.reduce((sum, val) => sum + val, 0) / this.clockBuffer.length;
          const bufferedTempo = (1_000_000_000 * 60) / (24 * avgDelta);

          // For the first ticks after start, use more aggressive smoothing
          let displayTempo = bufferedTempo;
          if (this.ppqnCounter < 24) { // First quarter note
            // Use even more smoothing for initial ticks to reduce perceived instability
            const earlyBufferDelta = this.clockBuffer.reduce((sum, val) => sum + val, 0) / this.clockBuffer.length;
            displayTempo = (1_000_000_000 * 60) / (24 * earlyBufferDelta);
          }

          // Show detailed logging from the first tick
          if (this.ppqnCounter % 6 === 0) { // Every 6th tick (1/4 note at 24 ppq) to reduce log spam
            console.log(`Tick: ${String(this.ppqnCounter).padStart(3)} | Delta: ${deltaMs} ms | Inst. Tempo: ${instantaneousTempo.toFixed(2)} BPM | Buffered: ${displayTempo.toFixed(2)} BPM`);
          }
        }
        this.lastTickTime = now;
        this.ppqnCounter++;
      });

      this.input.on('start', () => {
        console.log('--- MIDI Start Received ---');
        this.isRunning = true;
        this.ppqnCounter = 0;
        this.lastTickTime = null;
        this.clockBuffer = []; // Clear buffer on start
        this.syncAttempts = 0; // Reset sync attempts

        // Reset state properly to ensure clean start
        setTimeout(() => {
          // Additional logging to confirm start
          console.log(`MIDI Slave ready - Buffer cleared, counter reset to 0, expecting 24 ticks per quarter note`);
        }, 10);
      });

      this.input.on('stop', () => {
        console.log('--- MIDI Stop Received ---');
        this.isRunning = false;
        this.syncAttempts = 0; // Reset sync attempts

        // Clear any pending state to ensure clean stops
        this.lastTickTime = null;
        this.clockBuffer = []; // Clear buffer on stop as well
      });

      this.input.on('continue', () => {
        console.log('--- MIDI Continue Received ---');
        this.isRunning = true;
        this.syncAttempts = 0; // Reset sync attempts
      });

    } catch (error) {
      console.error(`Error opening MIDI input: ${this.inputName}`, error);
      console.log('Available MIDI inputs:', easymidi.getInputs());
    }
  }

  getTempo() {
    if (this.clockBuffer.length === 0) {
      return 0;
    }

    // Calculate tempo from the buffered data for more stability
    const avgDelta = this.clockBuffer.reduce((sum, val) => sum + val, 0) / this.clockBuffer.length;
    // (1_000_000_000 ns/s * 60 s/min) / (24 ppqn * smoothedDelta ns/tick)
    const tempo = (1_000_000_000 * 60) / (24 * avgDelta);
    return tempo;
  }

  getCurrentStep() {
    if (!this.isRunning) {
      return -1;
    }
    return Math.floor(this.ppqnCounter / 24);
  }

  close() {
    if (this.input) {
      this.input.close();
    }
  }
}

// Example usage:
// const slave = new MidiSlave('Your Virtual MIDI Port Name');
// setInterval(() => {
//   if (slave.isRunning) {
//     console.log(`Tempo: ${slave.getTempo().toFixed(2)} BPM, Step: ${slave.getCurrentStep()}`);
//   }
// }, 1000);

module.exports = MidiSlave;
