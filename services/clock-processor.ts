// services/clock-processor.ts

class ClockProcessor extends AudioWorkletProcessor {
  private tickInterval: number;
  private isRunning: boolean;

  // State for drift-free, absolute clock generation
  private syncOriginTime: number; // The master time origin for this sync session.
  private ticksGenerated: number;   // How many ticks have been generated in this session.

  // Safety limits
  private readonly MAX_TICKS_PER_BLOCK = 24; // Prevent infinite loops/flooding

  constructor() {
    super();
    this.tickInterval = 60.0 / (120.0 * 24); // Default to 120 BPM
    this.isRunning = false;
    this.syncOriginTime = 0;
    this.ticksGenerated = 0;

    this.port.onmessage = (e) => {
      const { command, value } = e.data;

      if (command === 'updateTempo') {
        const newTempo = value;
        const newTickInterval = 60.0 / (newTempo * 24);

        if (this.isRunning) {
          // When running, we need to reset the sync to avoid accumulated drift
          // Reset to current time and start fresh tick counting
          this.syncOriginTime = currentTime;
          this.ticksGenerated = 0;
        }

        // Always update the tick interval, even when stopped
        this.tickInterval = newTickInterval;
      } else if (command === 'start') {
        const { tempo, startTime } = value;
        this.tickInterval = 60.0 / (tempo * 24);

        // CRITICAL FIX: Ensure we start from NOW or the specified future time.
        // Never start in the past to avoid "catch-up" bursts.
        // 'currentTime' is the AudioContext time in seconds.
        this.syncOriginTime = Math.max(startTime, currentTime);

        this.ticksGenerated = 0;
        this.isRunning = true;

      } else if (command === 'stop') {
        this.isRunning = false;
        this.ticksGenerated = 0;
        this.syncOriginTime = 0;
      }
    };
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean {
    if (!this.isRunning) {
      return true;
    }

    // Lookahead: Process events slightly into the future to allow main thread processing time
    const lookahead = 0.05; // 50ms
    const blockEndTime = currentTime + (128 / sampleRate) + lookahead;

    // RATE LIMITER: Strict safety mechanism against "Fatal Acceleration" / Bursts.
    // At 44.1kHz, a block is ~2.9ms.
    // At 300 BPM, ticks occur every ~8.3ms.
    // We should rarely need to send more than 1 tick per block unless catching up very slightly.
    // However, with a 50ms lookahead, we might see multiple ticks (2-3) in one block.
    // Increasing limit to avoid artificial jitter.
    const MAX_TICKS_THIS_BLOCK = 10;

    let ticksInThisBlock = 0;

    while (true) {
      // Safety break to prevent freezing the audio thread AND clamp burst speed
      if (ticksInThisBlock >= MAX_TICKS_THIS_BLOCK) {
        break;
      }

      const nextTickTime = this.syncOriginTime + (this.ticksGenerated * this.tickInterval);

      if (nextTickTime < blockEndTime) {
        // For high tempo stability, increase tolerance threshold
        // At high tempos, slight timing variations are more noticeable
        // so we allow a bit more tolerance before resyncing to prevent jumps
        if (currentTime - nextTickTime > 0.3) { // Increased from 0.2 to 0.3 for high tempos
          // Resync origin to now to stop the drift
          this.syncOriginTime = currentTime - (this.ticksGenerated * this.tickInterval);
          // Don't send this old tick, loop again with new time
          continue;
        }

        this.port.postMessage({ time: nextTickTime });
        this.ticksGenerated++;
        ticksInThisBlock++;
      } else {
        break;
      }
    }

    return true;
  }
}

registerProcessor('clock-processor', ClockProcessor);
