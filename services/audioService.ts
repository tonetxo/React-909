
import { Sequence } from '../types';

export class AudioEngine {
  private audioContext: AudioContext | null = null;
  private schedulerTimer: number | null = null;
  private currentStep = 0;
  private nextNoteTime = 0.0;
  private lookaheadMs = 25.0;
  private scheduleAheadTime = 0.1;

  private sequence: Sequence = [];
  private tempo = 120;
  private isPlaying = false;
  private onStepChange: (step: number) => void = () => {};

  constructor() {}

  public async init(onStepChange: (step: number) => void): Promise<void> {
    if (this.audioContext) return;
    this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    await this.audioContext.resume();
    this.onStepChange = onStepChange;
  }

  public updateTempo(newTempo: number) {
    this.tempo = newTempo;
  }

  public updateSequence(newSequence: Sequence) {
    this.sequence = newSequence;
  }

  private nextStep() {
    const secondsPerBeat = 60.0 / this.tempo;
    this.nextNoteTime += 0.25 * secondsPerBeat; // 16th note
    this.currentStep = (this.currentStep + 1) % 16;
  }

  private scheduleNote(step: number, time: number) {
    if (!this.audioContext) return;
    
    this.sequence.forEach((instrumentTrack, instrumentIndex) => {
      if (instrumentTrack[step]) {
        switch (instrumentIndex) {
          case 0: this.playKick(time); break;
          case 1: this.playSnare(time); break;
          case 2: this.playClap(time); break;
          case 3: this.playClosedHat(time); break;
          case 4: this.playOpenHat(time); break;
          case 5: this.playTom(time, 150); break;
          case 6: this.playTom(time, 250); break;
          case 7: this.playTom(time, 350); break;
        }
      }
    });
  }

  private scheduler() {
    if (!this.audioContext) return;
    while (this.nextNoteTime < this.audioContext.currentTime + this.scheduleAheadTime) {
      this.scheduleNote(this.currentStep, this.nextNoteTime);
      this.onStepChange(this.currentStep);
      this.nextStep();
    }
  }

  public start() {
    if (this.isPlaying || !this.audioContext) return;
    this.isPlaying = true;
    this.currentStep = 0;
    this.nextNoteTime = this.audioContext.currentTime;
    this.scheduler();
    this.schedulerTimer = window.setInterval(() => this.scheduler(), this.lookaheadMs);
  }

  public stop() {
    if (!this.isPlaying || this.schedulerTimer === null) return;
    this.isPlaying = false;
    window.clearInterval(this.schedulerTimer);
    this.schedulerTimer = null;
    this.onStepChange(-1); // Reset step indicator
  }

  public getIsPlaying(): boolean {
    return this.isPlaying;
  }
  
  // --- Sound Synthesis Functions ---

  private playKick(time: number) {
    if (!this.audioContext) return;
    const osc = this.audioContext.createOscillator();
    const gain = this.audioContext.createGain();
    osc.connect(gain);
    gain.connect(this.audioContext.destination);

    osc.frequency.setValueAtTime(150, time);
    osc.frequency.exponentialRampToValueAtTime(0.01, time + 0.5);

    gain.gain.setValueAtTime(1, time);
    gain.gain.exponentialRampToValueAtTime(0.01, time + 0.5);

    osc.start(time);
    osc.stop(time + 0.5);
  }

  private playSnare(time: number) {
    if (!this.audioContext) return;
    const noise = this.audioContext.createBufferSource();
    const bufferSize = this.audioContext.sampleRate;
    const buffer = this.audioContext.createBuffer(1, bufferSize, this.audioContext.sampleRate);
    const output = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
        output[i] = Math.random() * 2 - 1;
    }
    noise.buffer = buffer;

    const noiseFilter = this.audioContext.createBiquadFilter();
    noiseFilter.type = 'highpass';
    noiseFilter.frequency.value = 1000;

    const noiseEnvelope = this.audioContext.createGain();
    noise.connect(noiseFilter).connect(noiseEnvelope).connect(this.audioContext.destination);

    noiseEnvelope.gain.setValueAtTime(1, time);
    noiseEnvelope.gain.exponentialRampToValueAtTime(0.01, time + 0.2);
    noise.start(time);

    const osc = this.audioContext.createOscillator();
    osc.type = 'triangle';
    const oscEnvelope = this.audioContext.createGain();
    osc.connect(oscEnvelope).connect(this.audioContext.destination);
    
    osc.frequency.setValueAtTime(100, time);
    oscEnvelope.gain.setValueAtTime(0.7, time);
    oscEnvelope.gain.exponentialRampToValueAtTime(0.01, time + 0.1);
    osc.start(time);
    
    osc.stop(time + 0.2);
    noise.stop(time + 0.2);
  }

  private playClap(time: number) {
    if (!this.audioContext) return;
    const noise = this.audioContext.createBufferSource();
    const bufferSize = this.audioContext.sampleRate;
    const buffer = this.audioContext.createBuffer(1, bufferSize, this.audioContext.sampleRate);
    const output = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
        output[i] = Math.random() * 2 - 1;
    }
    noise.buffer = buffer;

    const bandpass = this.audioContext.createBiquadFilter();
    bandpass.type = 'bandpass';
    bandpass.frequency.value = 1000;
    
    const envelope = this.audioContext.createGain();
    noise.connect(bandpass).connect(envelope).connect(this.audioContext.destination);
    
    envelope.gain.setValueAtTime(1, time);
    envelope.gain.exponentialRampToValueAtTime(0.1, time + 0.01);
    envelope.gain.setValueAtTime(1, time + 0.01);
    envelope.gain.exponentialRampToValueAtTime(0.1, time + 0.02);
    envelope.gain.setValueAtTime(1, time + 0.02);
    envelope.gain.exponentialRampToValueAtTime(0.01, time + 0.15);

    noise.start(time);
    noise.stop(time + 1);
  }

  private playHat(time: number, decay: number) {
    if (!this.audioContext) return;
    const noise = this.audioContext.createBufferSource();
    const bufferSize = this.audioContext.sampleRate;
    const buffer = this.audioContext.createBuffer(1, bufferSize, this.audioContext.sampleRate);
    const output = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
        output[i] = Math.random() * 2 - 1;
    }
    noise.buffer = buffer;

    const bandpass = this.audioContext.createBiquadFilter();
    bandpass.type = 'highpass';
    bandpass.frequency.value = 7000;
    
    const envelope = this.audioContext.createGain();
    noise.connect(bandpass).connect(envelope).connect(this.audioContext.destination);

    envelope.gain.setValueAtTime(1, time);
    envelope.gain.exponentialRampToValueAtTime(0.01, time + decay);
    
    noise.start(time);
    noise.stop(time + decay + 0.1);
  }

  private playClosedHat(time: number) {
    this.playHat(time, 0.05);
  }

  private playOpenHat(time: number) {
    this.playHat(time, 0.3);
  }

  private playTom(time: number, freq: number) {
    if (!this.audioContext) return;
    const osc = this.audioContext.createOscillator();
    const gain = this.audioContext.createGain();
    osc.connect(gain);
    gain.connect(this.audioContext.destination);

    osc.frequency.setValueAtTime(freq, time);
    osc.frequency.exponentialRampToValueAtTime(0.01, time + 0.4);

    gain.gain.setValueAtTime(1, time);
    gain.gain.exponentialRampToValueAtTime(0.01, time + 0.4);

    osc.start(time);
    osc.stop(time + 0.5);
  }

}
