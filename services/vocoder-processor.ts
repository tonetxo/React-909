
// Helper function for MIDI to frequency conversion
const midiToFreq = (midi: number): number => {
    return 440 * Math.pow(2, (midi - 69) / 12);
};

// Simple state for a low-pass filter, used for envelope following.
class EnvelopeFollower {
    private y1: number = 0;
    private a0: number;
    private b1: number;

    constructor(sampleRate: number, cutoffFreq: number) {
        const T = 1.0 / sampleRate;
        const RC = 1.0 / (2 * Math.PI * cutoffFreq);
        this.a0 = T / (T + RC);
        this.b1 = RC / (T + RC);
    }

    process(sample: number): number {
        this.y1 = this.a0 * sample + this.b1 * this.y1;
        return this.y1;
    }
}

// Simple state for a band-pass filter.
class BandpassFilter {
    private y1: number = 0; private y2: number = 0;
    private x1: number = 0; private x2: number = 0;
    private a1: number = 0; private a2: number = 0;
    private b0: number = 0; private b1: number = 0; private b2: number = 0;

    constructor(sampleRate: number, freq: number, Q: number) {
        this.updateCoefficients(sampleRate, freq, Q);
    }

    updateCoefficients(sampleRate: number, freq: number, Q: number) {
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

class SimpleOscillator {
    private phase: number = 0;
    private frequency: number = 440;
    private type: OscillatorType = 'sawtooth';
    private sampleRate: number;

    constructor(sampleRate: number, type: OscillatorType = 'sawtooth', frequency: number = 440) {
        this.sampleRate = sampleRate;
        this.type = type;
        this.frequency = frequency;
    }

    setFrequency(freq: number) {
        this.frequency = freq;
    }

    process(): number {
        const phaseIncrement = this.frequency / this.sampleRate;
        const val = 2 * (this.phase - Math.floor(this.phase + 0.5)); // Sawtooth
        this.phase = (this.phase + phaseIncrement) % 1.0;
        return val;
    }
}

class VocoderProcessor extends AudioWorkletProcessor {
    private sampleRate: number;
    
    // Vocoder bands
    private numBands: number = 16;
    private modulatorFilters: BandpassFilter[] = [];
    private carrierFilters: BandpassFilter[] = [];
    private envelopeFollowers: EnvelopeFollower[] = [];

    // Internal synth
    private internalSynth: SimpleOscillator;

    // Parameters
    private mix: number = 0.5;
    private formantShift: number = 0;
    private carrierType: string = 'drums';

    constructor(options: AudioWorkletNodeOptions) {
        super();
        this.sampleRate = options.processorOptions.sampleRate;
        if (!this.sampleRate || this.sampleRate < 22050) {
            // Fallback if not provided, though it should be.
            this.sampleRate = 44100;
        }

        this.internalSynth = new SimpleOscillator(this.sampleRate, 'sawtooth', 110);

        const minFreq = 150;
        const maxFreq = 8000;

        for (let i = 0; i < this.numBands; i++) {
            const freq = minFreq * Math.pow(maxFreq / minFreq, i / (this.numBands - 1));
            this.modulatorFilters.push(new BandpassFilter(this.sampleRate, freq, 5));
            this.carrierFilters.push(new BandpassFilter(this.sampleRate, freq, 5));
            this.envelopeFollowers.push(new EnvelopeFollower(this.sampleRate, 20)); // Envelope cutoff
        }

        this.port.onmessage = (event) => {
            const { type, payload } = event.data;
            if (type === 'updateParams') {
                this.mix = payload.mix ?? this.mix;
                this.formantShift = payload.formantShift ?? this.formantShift;
                this.carrierType = payload.carrier ?? this.carrierType;
                if (payload.synthPitch) {
                    this.internalSynth.setFrequency(midiToFreq(payload.synthPitch));
                }
            }
        };
    }

    process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean {
        const modulatorInput = inputs[0][0];
        const externalCarrierInput = inputs[1][0];
        const output = outputs[0][0];

        if (!modulatorInput) {
            return true; // Nothing to process
        }

        for (let i = 0; i < output.length; i++) {
            const modulatorSample = modulatorInput[i];
            let carrierSample = 0;

            if (this.carrierType === 'synth') {
                carrierSample = this.internalSynth.process() * 0.5; // Use internal synth
            } else if (externalCarrierInput) {
                carrierSample = externalCarrierInput[i]; // Use external audio
            }

            let wetSignal = 0;
            for (let j = 0; j < this.numBands; j++) {
                const formantShiftedFreq = this.modulatorFilters[j]['freq'] * Math.pow(2, this.formantShift / 12);
                // This is a simplification. In a real scenario, you'd update filter coefficients.
                // For this example, we'll just process as is, assuming formant shift is handled by routing logic if complex.

                const modFiltered = this.modulatorFilters[j].process(modulatorSample);
                const envelope = this.envelopeFollowers[j].process(Math.abs(modFiltered));
                const carrierFiltered = this.carrierFilters[j].process(carrierSample);
                wetSignal += carrierFiltered * envelope;
            }

            // Final output mix
            const gainCorrectedWetSignal = wetSignal * (this.numBands * 0.5); // Boost gain
            output[i] = (gainCorrectedWetSignal * this.mix) + (modulatorSample * (1.0 - this.mix));
        }

        return true;
    }
}

registerProcessor('vocoder-processor', VocoderProcessor);
