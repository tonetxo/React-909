import { Instrument, BasslinePattern, BasslineStep, Velocity } from '../types';
import { playSound, playBasslineNote, ensureAudioInitialized, stopAllSounds } from '../services/audioService';

type StepCallback = (step: number) => void;

export class AudioEngine {
  private audioContext: AudioContext | null = null;
  private stepCallback: StepCallback | null = null;

  private isRunning: boolean = false;
  private currentStep: number = 0;
  private tempo: number = 120;
  private swing: number = 0;
  private stepsPerSequence: number = 16;
  private instruments: Instrument[] = [];
  private basslinePattern: BasslinePattern | null = null;

  // Scheduling
  private nextStepTime: number = 0.0;
  private scheduleAheadTime: number = 0.1; // seconds
  private lookaheadTimerId: number | null = null;
  private readonly lookaheadPeriod: number = 25.0; // ms

  constructor() {
    // The audio context will be initialized on start
  }

  public async init() {
    if (this.audioContext) return;
    this.audioContext = await ensureAudioInitialized();
  }

  setStepCallback(callback: StepCallback) {
    this.stepCallback = callback;
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
    this.nextStepTime = this.audioContext.currentTime + 0.05; // Start with a small buffer

    this.scheduleNextSteps();
  }

  public stop() {
    this.isRunning = false;
    if (this.lookaheadTimerId !== null) {
      clearTimeout(this.lookaheadTimerId);
      this.lookaheadTimerId = null;
    }
    stopAllSounds();
    // Note: This doesn't stop sounds that are already scheduled.
    // A full "panic" stop would require more complex gain management.
  }

  public updateTempo(newTempo: number) {
    this.tempo = newTempo;
  }

  public updateSwing(newSwing: number) {
    this.swing = newSwing;
  }

  private scheduleNextSteps() {
    if (!this.isRunning || !this.audioContext) return;

    const stepDuration = 60.0 / this.tempo / 4.0; // Duration of a 16th note

    while (this.nextStepTime < this.audioContext.currentTime + this.scheduleAheadTime) {
      this.playStepAtTime(this.currentStep, this.nextStepTime);

      let currentStepDuration = stepDuration;
      if (this.swing > 0) {
        const swingAmount = Math.pow(this.swing / 100, 2) * 0.5;
        if (this.currentStep % 2 !== 0) { // Off-beat
          currentStepDuration += stepDuration * swingAmount;
        } else { // On-beat
          currentStepDuration -= stepDuration * swingAmount;
        }
      }
      
      this.nextStepTime += currentStepDuration;
      this.currentStep = (this.currentStep + 1) % this.stepsPerSequence;
    }

    this.lookaheadTimerId = window.setTimeout(() => this.scheduleNextSteps(), this.lookaheadPeriod);
  }

  private playStepAtTime(step: number, time: number) {
    if (!this.audioContext) return;
    
    const callbackDelay = (time - this.audioContext.currentTime) * 1000;
    setTimeout(() => {
      if (this.stepCallback && this.isRunning) {
        this.stepCallback(step);
      }
    }, callbackDelay);

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
      const stepData = this.basslinePattern.sequence[step] as BasslineStep;
      const prevStep = this.basslinePattern.sequence[(step - 1 + this.stepsPerSequence) % this.stepsPerSequence] as BasslineStep;
      const nextStep = this.basslinePattern.sequence[(step + 1) % this.stepsPerSequence] as BasslineStep;
      playBasslineNote(stepData, prevStep, nextStep, this.basslinePattern.params, time);
    }
  }

  getCurrentStep(): number | null {
    return this.isRunning ? this.currentStep : null;
  }

  destroy() {
    this.stop();
  }
}