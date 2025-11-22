class ClockProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.tickInterval = 0;
    this.isRunning = false;
    this.syncOriginTime = 0;
    this.ticksGenerated = 0;

    this.port.onmessage = (e) => {
      if (e.data.command === 'updateTempo') {
        if (this.isRunning) {
          const newTempo = e.data.value;
          const newTickInterval = 60.0 / (newTempo * 24);
          // Recalculate origin to maintain phase continuity
          const newOrigin = currentTime - (this.ticksGenerated * newTickInterval);
          this.syncOriginTime = newOrigin;
          this.tickInterval = newTickInterval;
        }
      } else if (e.data.command === 'start') {
        this.isRunning = true;
        const { tempo } = e.data.value;
        this.tickInterval = 60.0 / (tempo * 24);
        
        // CRITICAL FIX: Ignore external startTime.
        // Trust strictly the AudioWorklet's internal clock.
        // We start "now" (currentTime).
        // We add a tiny offset (1 tick) to ensure the first tick isn't "missed" 
        // if it falls exactly on the boundary, providing a clean start.
        this.syncOriginTime = currentTime;
        
        this.ticksGenerated = 0;
      } else if (e.data.command === 'stop') {
        this.isRunning = false;
        this.ticksGenerated = 0;
      } else if (e.data.command === 'resetState') {
        this.ticksGenerated = 0;
        this.isRunning = false;
      }
    };
  }

  process(inputs, outputs, parameters) {
    if (!this.isRunning) {
      return true;
    }

    // Reduced lookahead for tighter control
    const lookahead = 0.04; // 40ms
    const blockEndTime = currentTime + (128 / sampleRate) + lookahead;

    // Safety valve: Don't generate more than 20 ticks in a single block 
    // to prevent infinite loop freezes or massive bursts if math goes wrong.
    let loops = 0;
    const MAX_LOOPS = 20; 

    while (loops < MAX_LOOPS) {
      const nextTickTime = this.syncOriginTime + (this.ticksGenerated * this.tickInterval);

      if (nextTickTime < blockEndTime) {
        // Only emit if valid.
        if (nextTickTime >= currentTime - 0.02) {
            this.port.postMessage({ time: nextTickTime });
        }
        this.ticksGenerated++;
        loops++;
      } else {
        break;
      }
    }

    return true;
  }
}

registerProcessor('clock-processor', ClockProcessor);