import { Velocity, InstrumentParams, BasslineStep, BasslineParams } from '../types';

// This is a simplified version of the ChannelStrip for type safety here.
// The actual nodes are managed in audioService.ts
export interface SynthesisChannelStrip {
    input: GainNode;
}

const midiToFreq = (midi: number) => {
    return Math.pow(2, (midi - 69) / 12) * 440;
};

export class BasslineSynth {
    private osc: OscillatorNode | null = null;
    private vcf: BiquadFilterNode | null = null;
    private vca: GainNode | null = null;
    private lastNoteTime = 0;

    public playNote(
        context: AudioContext,
        time: number,
        step: BasslineStep,
        prevStep: BasslineStep | null,
        nextStep: BasslineStep | null,
        params: BasslineParams,
        channel: SynthesisChannelStrip
    ) {
        // Prevent duplicate scheduling for the exact same time (debounce)
        if (Math.abs(time - this.lastNoteTime) < 0.001) {
            return;
        }
        this.lastNoteTime = time;

        const freq = step.note ? midiToFreq(step.note) : 0;
        const velocityGain = 0.5 + (step.velocity / 5) * 0.5;
        const isAccent = step.velocity > 3;

        const effectiveCutoff = params.cutoff + (isAccent ? params.accent * 2500 : 0);
        const effectiveResonance = params.resonance + (isAccent ? params.accent * 8 : 0);
        const effectiveEnvMod = params.envelopeAmount + (isAccent ? params.accent * 2000 : 0);
        const effectiveVolume = velocityGain + (isAccent ? params.accent * 0.4 : 0);

        // --- Note Termination Logic ---
        if (!step || step.note === null || step.velocity === 0) {
            if (prevStep && !prevStep.tie && this.osc && this.vca) {
                const currentGain = this.vca.gain.value;
                this.vca.gain.cancelScheduledValues(time);
                this.vca.gain.setValueAtTime(currentGain, time);
                this.vca.gain.setTargetAtTime(0, time, 0.005);
                this.osc.stop(time + 0.03);
            }
            return;
        }

        // --- Note Continuation / Slide Logic ---
        if (this.osc && this.vca && prevStep && prevStep.note !== null && (step.slide || prevStep.tie)) {
            this.osc.frequency.setTargetAtTime(freq, time, step.slide ? 0.015 : 0.001);

            if (this.vcf) {
                this.vcf.frequency.setTargetAtTime(effectiveCutoff, time, 0.01);
                this.vcf.Q.setTargetAtTime(effectiveResonance, time, 0.01);
            }

            this.vca.gain.cancelScheduledValues(time);
            this.vca.gain.setTargetAtTime(effectiveVolume, time, 0.001);

            if (!step.tie) {
                this.vca.gain.setTargetAtTime(0, time + params.decay, 0.02);
                if (this.osc) {
                    this.osc.stop(time + params.decay + 0.1);
                }
            }
            return;
        }

        // --- New Note Logic ---
        if (this.osc && this.vca) {
            const currentGain = this.vca.gain.value;
            this.vca.gain.cancelScheduledValues(time);
            this.vca.gain.setValueAtTime(currentGain, time);
            this.vca.gain.setTargetAtTime(0, time, 0.005);
            this.osc.stop(time + 0.02);
            // Properly disconnect old nodes
            const oldOsc = this.osc;
            const oldVca = this.vca;
            const oldVcf = this.vcf;
            setTimeout(() => {
                oldOsc.disconnect();
                if (oldVcf) oldVcf.disconnect();
                oldVca.disconnect();
            }, (time - context.currentTime + 0.1) * 1000);
        }

        this.osc = context.createOscillator();
        this.vcf = context.createBiquadFilter();
        this.vca = context.createGain();

        this.osc.connect(this.vcf);
        this.vcf.connect(this.vca);
        this.vca.connect(channel.input);

        this.osc.type = params.waveform;
        this.osc.frequency.value = freq;

        this.vcf.type = 'lowpass';
        this.vcf.frequency.setValueAtTime(effectiveCutoff, time);
        this.vcf.Q.value = effectiveResonance;

        this.vcf.frequency.setTargetAtTime(effectiveCutoff + effectiveEnvMod, time, 0.001);
        this.vcf.frequency.setTargetAtTime(effectiveCutoff, time + 0.01, params.decay / 3);

        this.vca.gain.setValueAtTime(0, time);
        this.vca.gain.setTargetAtTime(effectiveVolume, time, 0.005);

        const isNextStepSlide = nextStep && nextStep.slide;

        if (!step.tie && !isNextStepSlide) {
            this.vca.gain.setTargetAtTime(0, time + params.decay, 0.02);
        }

        this.osc.start(time);

        if (!step.tie && !isNextStepSlide) {
            this.osc.stop(time + params.decay + 0.1);
        }
    }

    public stop(context: AudioContext) {
        const now = context.currentTime;
        if (this.vca) {
            this.vca.gain.cancelScheduledValues(now);
            this.vca.gain.setTargetAtTime(0, now, 0.01);
        }
        if (this.osc) {
            try {
                this.osc.stop(now + 0.02);
            } catch (e) { }
        }
        // Disconnect after stopping
        const osc = this.osc;
        const vca = this.vca;
        const vcf = this.vcf;
        setTimeout(() => {
            if (osc) osc.disconnect();
            if (vcf) vcf.disconnect();
            if (vca) vca.disconnect();
        }, 100);

        this.osc = null;
        this.vca = null;
        this.vcf = null;
    }
}

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
            osc.stop(time + decay + 0.02);
            setTimeout(() => { osc.disconnect(); gain.disconnect(); }, (time - context.currentTime + decay + 0.1) * 1000);
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
            noise.stop(time + decay + 0.02);

            const osc = context.createOscillator();
            const oscGain = context.createGain();
            osc.connect(oscGain);
            oscGain.connect(channel.input);

            osc.type = 'triangle';
            osc.frequency.value = params.pitch ?? 180;

            oscGain.gain.setValueAtTime(effectiveVolume * 0.8, time);
            oscGain.gain.exponentialRampToValueAtTime(0.001, time + decay * 0.8);

            osc.start(time);
            osc.stop(time + decay + 0.02);
            setTimeout(() => {
                noise.disconnect(); noiseFilter.disconnect(); noiseGain.disconnect();
                osc.disconnect(); oscGain.disconnect();
            }, (time - context.currentTime + decay + 0.1) * 1000);
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
                noise.stop(startTime + decay + 0.02);
                setTimeout(() => { noise.disconnect(); gain.disconnect(); }, (startTime - context.currentTime + decay + 0.1) * 1000);
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
            osc.stop(time + decay + 0.02);
            setTimeout(() => { osc.disconnect(); gain.disconnect(); }, (time - context.currentTime + decay + 0.1) * 1000);
            break;
        }

        case 'hihat':
        case 'openhat': {
            const ratios = [2, 3, 4.16, 5.43, 6.79, 8.21];

            const bandpass = context.createBiquadFilter();
            bandpass.type = 'bandpass';
            bandpass.frequency.value = 10000;

            const highpass = context.createBiquadFilter();
            highpass.type = 'highpass';
            highpass.frequency.value = 7000;

            const gain = context.createGain();

            bandpass.connect(highpass);
            highpass.connect(gain);
            gain.connect(channel.input);

            const baseDecay = instrumentId === 'hihat' ? 0.05 : 0.25;
            const decay = (params.decay ?? 0.5) * baseDecay * 4;

            ratios.forEach(ratio => {
                const osc = context.createOscillator();
                osc.type = 'square';
                osc.frequency.value = (params.pitch ?? 300) * ratio * (params.metal ?? 0.5);
                osc.connect(bandpass);
                osc.start(time);
                osc.stop(time + decay + 0.02);
                setTimeout(() => { osc.disconnect(); }, (time - context.currentTime + decay + 0.1) * 1000);
            });

            const peakVolume = instrumentId === 'hihat' ? effectiveVolume * 3.5 : effectiveVolume * 2.0;
            gain.gain.setValueAtTime(0.001, time);
            gain.gain.linearRampToValueAtTime(peakVolume, time + 0.005);
            gain.gain.exponentialRampToValueAtTime(0.001, time + 0.005 + decay);

            setTimeout(() => {
                bandpass.disconnect();
                highpass.disconnect();
                gain.disconnect();
            }, (time - context.currentTime + decay + 0.1) * 1000);
            break;
        }
    }
};