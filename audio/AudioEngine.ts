import { Instrument, BasslinePattern, BasslineStep, Velocity } from '../types';
import { playSound, playBasslineNote, ensureAudioInitialized, stopAllSounds } from '../services/audioService';
import { MidiService } from '../services/MidiService';

type StepCallback = (step: number) => void;

export class AudioEngine {
  private audioContext: AudioContext | null = null;
  private stepCallback: StepCallback | null = null;
  private midiService: MidiService;
  private clockNode: AudioWorkletNode | null = null;

  private isRunning: boolean = false;
  private currentStep: number = 0;
  private tempo: number = 120;
  private swing: number = 0;
  private stepsPerSequence: number = 16;
  private instruments: Instrument[] = [];
  private basslinePattern: BasslinePattern | null = null;

  // Audio Scheduling
  private nextStepTime: number = 0.0;
  private scheduleAheadTime: number = 0.15; // seconds
  private lookaheadTimerId: number | null = null;
  private readonly lookaheadPeriod: number = 50.0; // ms

  constructor() {
    this.midiService = new MidiService();
  }

  public async init() {
    if (this.audioContext) return;
    this.audioContext = await ensureAudioInitialized();
    if (!this.audioContext) {
        console.error("Failed to initialize AudioContext.");
        return;
    }

    try {
        // Load the clock processor worklet from its predictable, compiled path
        await this.audioContext.audioWorklet.addModule('services/clock-processor.js');

        // Create the clock node
        this.clockNode = new AudioWorkletNode(this.audioContext, 'clock-processor');

        // Listen for ticks from the worklet
        this.clockNode.port.onmessage = (e: MessageEvent) => {
            if (e.data.time) {
                // Trust the worklet's timestamp completely, even if it appears to be in the
                // past on the main thread. This compensates for the inherent latency between
                // the two threads, as per the new synchronization strategy.
                this.midiService.sendTimingClock(e.data.time);
            }
        };

        // Connect the clock node to the destination to start processing
        this.clockNode.connect(this.audioContext.destination);

    } catch (error) {
        console.error("Error loading or creating AudioWorklet node:", error);
    }
  }

  setStepCallback(callback: StepCallback) {
    this.stepCallback = callback;
  }

  public setMidiOutput(outputName: string) {
    this.midiService.setMidiOutput(outputName);
  }
  
  public setPattern(
    instruments: Instrument[],
    basslinePattern: BasslinePattern | null,
    stepsPerSequence: number
  ) {
    this.instruments = instruments;
    this.basslinePattern = basslinePattern;
    if (stepsPerSequence !== this.stepsPerSequence) {
      this.stepsPerSequence = stepsPerSequence;
      this.currentStep = 0; // Reset step to avoid out-of-bounds
    }
  }

  public async start(
    tempo: number,
    swing: number,
    instruments: Instrument[],
    basslinePattern: BasslinePattern | null,
    stepsPerSequence: number,
  ) {
    await this.init();
    if (!this.audioContext) {
      console.error("AudioEngine not initialized, cannot start.");
      return;
    }

    if (this.isRunning) {
      return; // Already running
    }

    this.isRunning = true;
    this.tempo = tempo;
    this.swing = swing;
    this.setPattern(instruments, basslinePattern, stepsPerSequence);
    this.currentStep = 0;

    // --- Precise Sync Initialisation with High Tempo Compensation ---
    // Calculate compensation based on tempo
    // At high tempos, timing precision becomes more critical
    const baseCompensation = 0.005; // Base minimal delay
    const tempoCompensation = Math.min(0.02, (60.0 / tempo) * 0.1); // Adjust based on tempo
    const startTime = this.audioContext.currentTime + Math.max(baseCompensation, tempoCompensation);

    // Initialize the MIDI clock with a single atomic start command
    if (this.clockNode) {
        this.clockNode.port.postMessage({
            command: 'start',
            value: {
                tempo: this.tempo,
                startTime: startTime
            }
        });
    }

    // Send MIDI start immediately
    this.midiService.sendStart();

    // Start the internal sequencer immediately after to maintain sync
    this.nextStepTime = startTime;
    this.scheduleNextSteps();
  }

  public stop() {
    this.isRunning = false;
    if (this.lookaheadTimerId !== null) {
      clearTimeout(this.lookaheadTimerId);
      this.lookaheadTimerId = null;
    }

    // Stop internal audio processing first
    stopAllSounds();

    // Send MIDI stop message to signal end of sequence to slave devices
    this.midiService.sendStop();

    // Stop MIDI clock after to ensure slaves receive the stop command
    if (this.clockNode) {
        this.clockNode.port.postMessage({ command: 'stop' });
        // Reset clock state for cleaner restarts
        this.clockNode.port.postMessage({ command: 'resetState' });
    }

    // Small delay to ensure all devices have time to process the stop
    // Ensure all internal state is reset
    this.currentStep = 0;
    this.nextStepTime = 0.0;
  }

  public updateTempo(newTempo: number) {
    this.tempo = newTempo;
    if (this.clockNode) {
        this.clockNode.port.postMessage({ command: 'updateTempo', value: newTempo });
    }
  }

  public updateSwing(newSwing: number) {
    this.swing = newSwing;
  }

  private scheduleNextSteps() {
    if (!this.isRunning || !this.audioContext) return;

    const stepDuration = 60.0 / this.tempo / 4.0;

    const currentPlayTime = this.audioContext.currentTime;

    while (this.nextStepTime < currentPlayTime + this.scheduleAheadTime) {
      this.playStepAtTime(this.currentStep, this.nextStepTime);

      let currentStepDuration = stepDuration;
      if (this.swing > 0) {
        const swingAmount = Math.pow(this.swing / 100, 2) * 0.5;
        if (this.currentStep % 2 !== 0) {
          currentStepDuration = stepDuration * (1 + swingAmount);
        } else {
          currentStepDuration = Math.max(0.001, stepDuration * (1 - swingAmount));
        }
      }

      this.nextStepTime += currentStepDuration;
      this.currentStep = (this.currentStep + 1) % this.stepsPerSequence;
    }

    // Use a more precise timeout based on the lookahead period for better timing consistency
    this.lookaheadTimerId = window.setTimeout(() => this.scheduleNextSteps(), this.lookaheadPeriod);
  }

  private playStepAtTime(step: number, time: number) {
    if (!this.audioContext) return;

    // Calculate callback time without setTimeout to improve timing precision
    const callbackTime = time - this.audioContext.currentTime;
    if (callbackTime <= 0) {
      // If the time has already passed, execute immediately
      if (this.stepCallback && this.isRunning) {
        this.stepCallback(step);
      }
    } else {
      // Schedule the callback to run as close to the intended time as possible
      setTimeout(() => {
        if (this.stepCallback && this.isRunning) {
          this.stepCallback(step);
        }
      }, callbackTime * 1000);
    }

    const soloInstruments = this.instruments.filter(inst => inst.isSolo);
    this.instruments.forEach(instrument => {
      const velocity = instrument.sequence[step];
      if (velocity > 0) {
        const isSoloed = soloInstruments.length > 0;
        const canPlay = isSoloed
          ? soloInstruments.some(soloInst => soloInst.id === instrument.id)
          : !instrument.isMuted;

        if (canPlay) {
          playSound(instrument.id, velocity as Velocity, instrument.params, instrument.volume, time);
        }
      }
    });

    if (this.basslinePattern) {
      const stepData = this.basslinePattern.sequence[step];
      const prevStep = this.basslinePattern.sequence[(step - 1 + this.stepsPerSequence) % this.stepsPerSequence];
      const nextStep = this.basslinePattern.sequence[(step + 1) % this.stepsPerSequence];
      playBasslineNote(stepData, prevStep, nextStep, this.basslinePattern.params, time);
    }
  }

  getCurrentStep(): number | null {
    return this.isRunning ? this.currentStep : null;
  }

  destroy() {
    this.stop();
    if (this.clockNode) {
        this.clockNode.disconnect();
        this.clockNode.port.close();
    }
  }
}