class ClockProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.tickInterval = 0;
    this.isRunning = false;
    this.syncOriginTime = 0;
    this.ticksGenerated = 0;
    this.RESYNC_THRESHOLD = 0.3; // seconds

    this.port.onmessage = (e) => {
      const { command, value } = e.data;

      if (command === 'updateTempo') {
        const newTempo = value;
        const newTickInterval = 60.0 / (newTempo * 24);

        if (this.isRunning && this.ticksGenerated > 0) {
          // FIX: Use the last generated tick time as reference instead of currentTime.
          // Since we use lookahead, we might have generated ticks in the future.
          // Resetting to currentTime would cause "time travel" (timestamps going backward).
          
          // NewOrigin = OldOrigin + (n-1) * (OldInterval - NewInterval)
          // This ensures that Tick(n) = Tick(n-1) + NewInterval
          this.syncOriginTime = this.syncOriginTime + (this.ticksGenerated - 1) * (this.tickInterval - newTickInterval);
        }

        this.tickInterval = newTickInterval;
      } else if (command === 'start') {
        const { tempo, startTime } = value;
        this.tickInterval = 60.0 / (tempo * 24);

        // ✅ CRITICAL: Use the scheduled startTime, not currentTime
        // This ensures perfect alignment with the audio engine's plan
        this.syncOriginTime = startTime;
        this.ticksGenerated = 0;
        this.isRunning = true;
      } else if (command === 'stop') {
        this.isRunning = false;
        this.ticksGenerated = 0;
        this.syncOriginTime = 0;
      }
    };
  }

  process(inputs, outputs, parameters) {
    if (!this.isRunning || this.tickInterval === 0) return true;

    // Lookahead set to 0.1s (100ms) - Balance between stability and responsiveness
    const lookahead = 0.1; 
    const blockEndTime = currentTime + (128 / sampleRate) + lookahead;

    // Prevent infinite loops
    const MAX_TICKS_PER_BLOCK = 24;
    let ticksSent = 0;

    while (ticksSent < MAX_TICKS_PER_BLOCK) {
      const nextTickTime = this.syncOriginTime + (this.ticksGenerated * this.tickInterval);

      if (nextTickTime < blockEndTime) {
        // If we're too far behind, resync to avoid burst
        if (currentTime - nextTickTime > this.RESYNC_THRESHOLD) {
          console.warn(`Clock resync: too far behind (${(currentTime - nextTickTime).toFixed(3)}s)`);
          this.syncOriginTime = currentTime - (this.ticksGenerated * this.tickInterval);
          ticksSent++; // Safety: ensure loop makes progress
          continue;
        }

        // Only send ticks that are not in the distant past (relaxed to 0.1s)
        if (nextTickTime >= currentTime - 0.1) {
          this.port.postMessage({ time: nextTickTime });

          // Diagnostic logging (remove after debugging)
          // if (this.ticksGenerated % 24 === 0) { 
          //   console.log(`Worklet: Generated tick #${this.ticksGenerated} at ${nextTickTime.toFixed(3)}s`);
          // }
        } else {
          console.warn(`Skipped tick #${this.ticksGenerated} (too far in past)`);
        }

        this.ticksGenerated++;
        ticksSent++;
      } else {
        break;
      }
    }

    return true;
  }
}

registerProcessor('clock-processor', ClockProcessor);