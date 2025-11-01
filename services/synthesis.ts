import { Velocity, InstrumentParams, BasslineStep, BasslineParams } from '../types';

// This is a simplified version of the ChannelStrip for type safety here.
// The actual nodes are managed in audioService.ts
export interface SynthesisChannelStrip {
  input: GainNode;
}

const midiToFreq = (midi: number) => {
    return Math.pow(2, (midi - 69) / 12) * 440;
};

// Keep track of the bassline synth parts to implement slide
let basslineOsc: OscillatorNode | null = null;
let basslineVcf: BiquadFilterNode | null = null;
let basslineVca: GainNode | null = null;

export const playInstrument = (
    context: AudioContext,
    time: number,
    instrumentId: string,
    velocity: Velocity,
    params: InstrumentParams,
    volume: number,
    channel: SynthesisChannelStrip
) => {
  const effectiveVolume = (velocity / 5);

  switch (instrumentId) {
    case 'kick': {
      const osc = context.createOscillator();
      const gain = context.createGain();
      osc.connect(gain);
      gain.connect(channel.input);

      const pitch = params.pitch ?? 50;
      const decay = params.decay ?? 0.5;
      const punch = params.punch ?? 0;

      const pitchStartFactor = 2 + (punch * 10);
      const pitchStart = pitch * pitchStartFactor;
      const minSweepTime = 0.005;
      const maxSweepTime = 0.05;
      const pitchSweepTime = maxSweepTime - (punch * (maxSweepTime - minSweepTime));

      osc.frequency.setValueAtTime(pitchStart, time);
      osc.frequency.exponentialRampToValueAtTime(pitch, time + Math.max(minSweepTime, pitchSweepTime));
      
      gain.gain.setValueAtTime(effectiveVolume * 1.5, time);
      gain.gain.exponentialRampToValueAtTime(0.001, time + decay);

      osc.start(time);
      osc.stop(time + decay);
      break;
    }

    case 'snare': {
        const noise = context.createBufferSource();
        const noiseBuffer = context.createBuffer(1, context.sampleRate * 0.5, context.sampleRate);
        const output = noiseBuffer.getChannelData(0);
        for (let i = 0; i < output.length; i++) {
            output[i] = Math.random() * 2 - 1;
        }
        noise.buffer = noiseBuffer;
        
        const noiseFilter = context.createBiquadFilter();
        noiseFilter.type = 'highpass';
        noiseFilter.frequency.value = 1000;

        const noiseGain = context.createGain();
        
        noise.connect(noiseFilter);
        noiseFilter.connect(noiseGain);
        noiseGain.connect(channel.input);
        
        const decay = params.decay ?? 0.2;
        noiseGain.gain.setValueAtTime(effectiveVolume * (params.snappy ?? 0.5), time);
        noiseGain.gain.exponentialRampToValueAtTime(0.001, time + decay);

        noise.start(time);
        noise.stop(time + decay);

        const osc = context.createOscillator();
        const oscGain = context.createGain();
        osc.connect(oscGain);
        oscGain.connect(channel.input);

        osc.type = 'triangle';
        osc.frequency.value = params.pitch ?? 180;
        
        oscGain.gain.setValueAtTime(effectiveVolume * 0.8, time);
        oscGain.gain.exponentialRampToValueAtTime(0.001, time + decay * 0.8);
        
        osc.start(time);
        osc.stop(time + decay);
        break;
    }

    case 'clap': {
        const decay = params.decay ?? 0.15;
        for (let i = 0; i < 3; i++) {
            const noise = context.createBufferSource();
            const noiseBuffer = context.createBuffer(1, context.sampleRate * 0.2, context.sampleRate);
            const output = noiseBuffer.getChannelData(0);
            for (let j = 0; j < output.length; j++) {
                output[j] = Math.random() * 2 - 1;
            }
            noise.buffer = noiseBuffer;

            const gain = context.createGain();
            noise.connect(gain);
            gain.connect(channel.input);

            const startTime = time + i * 0.01 * (params.spread ?? 0.8);
            gain.gain.setValueAtTime(effectiveVolume / 3, startTime);
            gain.gain.exponentialRampToValueAtTime(0.001, startTime + decay);

            noise.start(startTime);
            noise.stop(startTime + decay);
        }
        break;
    }
    
    case 'low_tom':
    case 'mid_tom':
    case 'hi_tom': {
        const osc = context.createOscillator();
        const gain = context.createGain();
        osc.connect(gain);
        gain.connect(channel.input);

        const pitch = params.pitch ?? 150;
        const decay = params.decay ?? 0.3;

        osc.frequency.setValueAtTime(pitch * 1.5, time);
        osc.frequency.exponentialRampToValueAtTime(pitch, time + 0.02);
        
        gain.gain.setValueAtTime(effectiveVolume, time);
        gain.gain.exponentialRampToValueAtTime(0.001, time + decay);

        osc.start(time);
        osc.stop(time + decay);
        break;
    }

    case 'hihat':
    case 'openhat': {
        const ratios = [2, 3, 4.16, 5.43, 6.79, 8.21];
        const gain = context.createGain();
        gain.connect(channel.input);
        
        ratios.forEach(ratio => {
            const osc = context.createOscillator();
            osc.type = 'square';
            osc.frequency.value = (params.pitch ?? 300) * ratio * (params.metal ?? 0.5);
            osc.connect(gain);
            osc.start(time);
            osc.stop(time + (params.decay ?? 0.1));
        });

        const decay = params.decay ?? 0.1;
        gain.gain.setValueAtTime(effectiveVolume * 0.1, time);
        gain.gain.exponentialRampToValueAtTime(0.001, time + decay);
        break;
    }
  }
};

export const playScheduledBasslineNote = (
    context: AudioContext,
    time: number,
    step: BasslineStep,
    prevStep: BasslineStep,
    params: BasslineParams,
    channel: SynthesisChannelStrip
) => {
    if (basslineOsc && basslineVcf && basslineVca) {
        if (!prevStep.slide) {
            basslineVca.gain.cancelScheduledValues(time);
            basslineVca.gain.setTargetAtTime(0, time, 0.01);
            basslineOsc.stop(time + 0.02);
        }
    }

    if (!step || step.note === null || step.velocity === 0) {
        return;
    }
    
    const freq = midiToFreq(step.note);
    const velocityGain = 0.5 + (step.velocity / 5) * 0.5;
    const isAccent = step.velocity > 3;
    
    const effectiveCutoff = params.cutoff + (isAccent ? params.accent * 2500 : 0);
    const effectiveResonance = params.resonance + (isAccent ? params.accent * 8 : 0);
    const effectiveEnvMod = params.envelopeAmount + (isAccent ? params.accent * 2000 : 0);
    const effectiveVolume = velocityGain + (isAccent ? params.accent * 0.4 : 0);

    if (prevStep.slide && basslineOsc) {
        basslineOsc.frequency.setTargetAtTime(freq, time, 0.015);
        basslineVcf!.frequency.setTargetAtTime(effectiveCutoff, time, 0.01);
        basslineVcf!.Q.setTargetAtTime(effectiveResonance, time, 0.01);
        return;
    }
    
    const osc = context.createOscillator();
    const vcf = context.createBiquadFilter();
    const vca = context.createGain();

    osc.connect(vcf);
    vcf.connect(vca);
    vca.connect(channel.input);

    osc.type = params.waveform;
    osc.frequency.value = freq;
    
    vcf.type = 'lowpass';
    vcf.frequency.setValueAtTime(effectiveCutoff, time);
    vcf.Q.value = effectiveResonance;
    
    vcf.frequency.setTargetAtTime(effectiveCutoff + effectiveEnvMod, time, 0.001);
    vcf.frequency.setTargetAtTime(effectiveCutoff, time + 0.01, params.decay / 3);
    
    vca.gain.setValueAtTime(0, time);
    vca.gain.setTargetAtTime(effectiveVolume, time, 0.005);
    vca.gain.setTargetAtTime(0, time + params.decay, 0.02);

    osc.start(time);
    
    if (!step.slide) {
        osc.stop(time + params.decay + 0.2);
    }

    basslineOsc = osc;
    basslineVcf = vcf;
    basslineVca = vca;
};