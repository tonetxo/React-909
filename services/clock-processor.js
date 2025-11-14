// This is the compiled version of clock-processor.ts
// services/clock-processor.ts

class ClockProcessor extends AudioWorkletProcessor {
    constructor() {
      super();
      this.tickInterval = 60.0 / (120.0 * 24); // Default to 120 BPM
      this.isRunning = false;
      this.syncOriginTime = 0;
      this.ticksGenerated = 0;

      this.port.onmessage = (e) => {
        if (e.data.command === 'updateTempo') {
          const newTempo = e.data.value;
          const newTickInterval = 60.0 / (newTempo * 24);

          // To prevent a time jump when tempo changes, we establish a new origin.
          // The new origin is calculated by projecting back from the current time.
          const newOrigin = currentTime - (this.ticksGenerated * newTickInterval);
          this.syncOriginTime = newOrigin;
          this.tickInterval = newTickInterval;

        } else if (e.data.command === 'start') {
            this.isRunning = true;
            // A new session starts, reset everything from the provided start time.
            this.syncOriginTime = e.data.value || currentTime;
            this.ticksGenerated = 0;
        } else if (e.data.command === 'stop') {
            this.isRunning = false;
        } else if (e.data.command === 'resetState') {
            // Reset all internal state for clean restarts
            this.ticksGenerated = 0;
            this.syncOriginTime = 0;
        }
      };
    }

    process(inputs, outputs, parameters) {
      if (!this.isRunning) {
          return true;
      }

      const blockEndTime = currentTime + (128 / sampleRate);

      // --- Absolute Time Calculation Loop ---
      // This loop is immune to clock drift.
      while (true) {
        // Calculate the absolute, drift-free time of the next tick.
        const nextTickTime = this.syncOriginTime + ((this.ticksGenerated + 1) * this.tickInterval);

        if (nextTickTime < blockEndTime) {
          // Send the tick with some tolerance to account for tiny timing variations
          // but only if it's not too far in the past to prevent excessive flooding
          // Enhanced tolerance for high tempo scenarios
          if (nextTickTime >= currentTime - 0.002) { // Slightly more tolerance for high tempos
            this.port.postMessage({ time: nextTickTime });
          }
          this.ticksGenerated++;
        } else {
          // The next tick is outside this block, so we're done for now.
          break;
        }
      }

      return true;
    }
}

registerProcessor('clock-processor', ClockProcessor);