// services/clock-processor.ts

class ClockProcessor extends AudioWorkletProcessor {
    private tickInterval: number;
    private isRunning: boolean;

    // State for drift-free, absolute clock generation
    private syncOriginTime: number; // The master time origin for this sync session.
    private ticksGenerated: number;   // How many ticks have been generated in this session.

    constructor() {
      super();
      this.tickInterval = 60.0 / (120.0 * 24); // Default to 120 BPM
      this.isRunning = false;
      this.syncOriginTime = 0;
      this.ticksGenerated = 0;

      this.port.onmessage = (e) => {
        if (e.data.command === 'updateTempo') {
          // This logic is only for making smooth tempo changes DURING playback.
          if (this.isRunning) {
            const newTempo = e.data.value;
            const newTickInterval = 60.0 / (newTempo * 24);

            // To prevent a time jump when tempo changes, we establish a new origin.
            const newOrigin = currentTime - (this.ticksGenerated * newTickInterval);
            this.syncOriginTime = newOrigin;
            this.tickInterval = newTickInterval;
          }
          // If not running, we do nothing. The new tempo will be picked up
          // by the atomic 'start' command when playback begins.
        } else if (e.data.command === 'start') {
            this.isRunning = true;
            // The start command is now atomic and contains all necessary info.
            const { tempo, startTime } = e.data.value;
            this.tickInterval = 60.0 / (tempo * 24);
            this.syncOriginTime = startTime || currentTime;
            this.ticksGenerated = 0; // Full state reset on start
        } else if (e.data.command === 'stop') {
            this.isRunning = false;
            // A session has ended. Reset tick counter to ensure updateTempo doesn't use stale data.
            // DO NOT reset syncOriginTime, as 0 is a valid (but wrong) time.
            // The next 'start' command will provide the correct new origin time.
            this.ticksGenerated = 0;
        } else if (e.data.command === 'resetState') {
            // Reset for safety, but avoid setting time to 0.
            this.ticksGenerated = 0;
        }
      };
    }

    process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean {
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