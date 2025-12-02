/// <reference types="audioworklet" />

// services/vocoder-processor-new.ts

// --- Helper Classes (reused from the original vocoder-processor for consistency)

class BandpassFilter {
    private y1: number = 0; private y2: number = 0;
    private x1: number = 0; private x2: number = 0;
    private a1: number = 0; private a2: number = 0;
    private b0: number = 0; private b1: number = 0; private b2: number = 0;
    public freq: number;

    constructor(sampleRate: number, freq: number, Q: number) {
        this.freq = freq;
        this.updateCoefficients(sampleRate, freq, Q);
    }

    updateCoefficients(sampleRate: number, freq: number, Q: number) {
        this.freq = freq;
        const omega = 2 * Math.PI * freq / sampleRate;
        const sinOmega = Math.sin(omega);
        const cosOmega = Math.cos(omega);
        const alpha = sinOmega / (2 * Q);

        const a0_inv = 1 / (1 + alpha);
        this.a1 = -2 * cosOmega * a0_inv;
        this.a2 = (1 - alpha) * a0_inv;
        this.b0 = alpha * a0_inv;
        this.b1 = 0;
        this.b2 = -alpha * a0_inv;
    }

    process(sample: number): number {
        const output = this.b0 * sample + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
        this.x2 = this.x1;
        this.x1 = sample;
        this.y2 = this.y1;
        this.y1 = output;
        return output;
    }
}

class HighpassFilter {
    private y1: number = 0;
    private x1: number = 0;
    private a0: number;
    private a1: number;
    private b1: number;

    constructor(sampleRate: number, freq: number) {
        const RC = 1.0 / (2 * Math.PI * freq);
        const T = 1.0 / sampleRate;
        const alpha = RC / (RC + T);
        this.a0 = alpha;
        this.a1 = -alpha;
        this.b1 = alpha;
    }

    process(sample: number): number {
        this.y1 = this.a0 * sample + this.a1 * this.x1 + this.b1 * this.y1;
        this.x1 = sample;
        return this.y1;
    }
}


type OscillatorType = 'sine' | 'square' | 'sawtooth' | 'triangle';

class SimpleOscillator {
    private phase: number = 0;
    private _frequency: number = 440;
    private _type: OscillatorType = 'sawtooth';
    private sampleRate: number;

    constructor(sampleRate: number, type: OscillatorType = 'sawtooth', frequency: number = 440) {
        this.sampleRate = sampleRate;
        this.type = type;
        this.frequency = frequency;
    }

    public set frequency(freq: number) {
        this._frequency = freq;
    }

    public set type(type: OscillatorType) {
        this._type = type;
    }

    process(): number {
        const phaseIncrement = this._frequency / this.sampleRate;
        let val = 0;

        switch (this._type) {
            case 'sine':
                val = Math.sin(this.phase * 2 * Math.PI);
                break;
            case 'square':
                val = Math.sign(Math.sin(this.phase * 2 * Math.PI));
                break;
            case 'sawtooth':
                val = 2 * (this.phase - Math.floor(this.phase + 0.5));
                break;
            case 'triangle':
                val = 2 * Math.abs(2 * (this.phase - Math.floor(this.phase + 0.5))) - 1;
                break;
        }

        this.phase = (this.phase + phaseIncrement) % 1.0;
        return val;
    }
}


// --- Vocoder AudioWorklet Processor ---

class VocoderProcessorNew extends AudioWorkletProcessor {

    private readonly numBands: number = 20; // Reduced from 40 for better performance
    private modulatorFilters: BandpassFilter[] = [];
    private carrierFilters: BandpassFilter[] = [];
    private lastGainValues: number[] = new Array(this.numBands).fill(0);

    private sibilanceFilter: HighpassFilter;

    private carrierOsc: SimpleOscillator;

    // Caching for performance optimization
    private lastQFactor: number = -1;
    private attackCoeff: number = 0;
    private releaseCoeff: number = 0;
    private lastAttack: number = -1;
    private lastRelease: number = -1;

    static get parameterDescriptors() {
        return [
            { name: 'voiceGain', defaultValue: 30, minValue: 1, maxValue: 100 },
            { name: 'noiseGate', defaultValue: 5, minValue: 0, maxValue: 50 },
            { name: 'attack', defaultValue: 0.001, minValue: 0.001, maxValue: 0.1 },
            { name: 'release', defaultValue: 0.03, minValue: 0.01, maxValue: 0.2 },
            { name: 'sibilance', defaultValue: 0.2, minValue: 0, maxValue: 1 },
            { name: 'dryWet', defaultValue: 1.0, minValue: 0, maxValue: 1 },
            { name: 'qFactor', defaultValue: 20, minValue: 1, maxValue: 50 },
            { name: 'carrierFreq', defaultValue: 110, minValue: 40, maxValue: 500 },
        ];
    }

    constructor(options: AudioWorkletNodeOptions) {
        super();
        const sampleRate = options.processorOptions.sampleRate || 44100;

        this.carrierOsc = new SimpleOscillator(sampleRate, 'sawtooth', 110);
        this.sibilanceFilter = new HighpassFilter(sampleRate, 4000);

        const minFreq = 80;
        const maxFreq = 12000;
        const factor = Math.pow(maxFreq / minFreq, 1 / (this.numBands - 1));

        for (let i = 0; i < this.numBands; i++) {
            const freq = minFreq * Math.pow(factor, i);
            const q = 20; // Initial Q
            this.modulatorFilters.push(new BandpassFilter(sampleRate, freq, q));
            this.carrierFilters.push(new BandpassFilter(sampleRate, freq, q));
        }

        this.port.onmessage = (event) => {
            if (event.data.type === 'SET_CARRIER_WAVEFORM') {
                this.carrierOsc.type = event.data.value;
            }
        };
    }

    process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean {
        const modulatorInput = inputs[0][0];
        const output = outputs[0][0];

        if (!modulatorInput) {
            return true; // No input to process
        }

        const voiceGain = parameters.voiceGain[0];
        const noiseGate = parameters.noiseGate[0];
        const attack = parameters.attack[0];
        const release = parameters.release[0];
        const sibilance = parameters.sibilance[0];
        const dryWet = parameters.dryWet[0];
        const qFactor = parameters.qFactor[0];
        const carrierFreq = parameters.carrierFreq[0];

        this.carrierOsc.frequency = carrierFreq;

        // OPTIMIZATION: Only update Q factor for all filters if it has changed
        if (qFactor !== this.lastQFactor) {
            this.modulatorFilters.forEach(f => f.updateCoefficients(sampleRate, f.freq, qFactor));
            this.carrierFilters.forEach(f => f.updateCoefficients(sampleRate, f.freq, qFactor));
            this.lastQFactor = qFactor;
        }

        // OPTIMIZATION: Pre-calculate envelope coefficients when attack/release change
        if (attack !== this.lastAttack) {
            this.attackCoeff = 1 - Math.exp(-1 / (sampleRate * attack));
            this.lastAttack = attack;
        }
        if (release !== this.lastRelease) {
            this.releaseCoeff = 1 - Math.exp(-1 / (sampleRate * release));
            this.lastRelease = release;
        }

        // --- Per-sample processing loop ---
        for (let i = 0; i < output.length; i++) {
            const modulatorSample = modulatorInput[i];
            const carrierSample = this.carrierOsc.process();

            let wetSignal = 0;

            // --- Band processing ---
            for (let j = 0; j < this.numBands; j++) {
                // 1. Analyze modulator for this band
                const modFiltered = this.modulatorFilters[j].process(modulatorSample);

                // Use absolute value as energy proxy (simplified RMS)
                let rms = Math.abs(modFiltered);

                // 2. Apply noise gate
                const gateThreshold = noiseGate / 500.0;
                if (rms < gateThreshold) {
                    rms = 0;
                }

                // 3. Calculate gain and apply smoothing (attack/release)
                const gainValue = Math.min(rms * voiceGain, 1.5);

                // OPTIMIZATION: Use pre-calculated coefficients instead of Math.exp()
                const coeff = gainValue > this.lastGainValues[j] ? this.attackCoeff : this.releaseCoeff;
                const smoothedGain = this.lastGainValues[j] + (gainValue - this.lastGainValues[j]) * coeff;
                this.lastGainValues[j] = smoothedGain;

                // 4. Synthesize carrier for this band
                const carrierFiltered = this.carrierFilters[j].process(carrierSample);

                // 5. Apply gain and add to wet signal
                wetSignal += carrierFiltered * smoothedGain;
            }

            // --- Sibilance ("Clarity") path ---
            const sibilanceSignal = this.sibilanceFilter.process(modulatorSample) * sibilance;

            // --- Final Mix ---
            const finalWetSignal = wetSignal + sibilanceSignal;
            output[i] = (modulatorSample * (1 - dryWet)) + (finalWetSignal * dryWet);
        }

        return true;
    }
}

registerProcessor('vocoder-processor-new', VocoderProcessorNew);
