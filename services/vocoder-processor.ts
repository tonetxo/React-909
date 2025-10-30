// services/vocoder-processor.ts

// Helper function for MIDI to frequency conversion
function midiToFreq(midi: number): number {
    return 440 * Math.pow(2, (midi - 69) / 12);
}

// Basic Biquad Filter implementation for AudioWorklet
// Coefficients (a0, a1, a2, b0, b1, b2) and state variables (x1, x2, y1, y2)
class BiquadFilter {
    private sampleRate: number;
    private a0: number = 1; private a1: number = 0; private a2: number = 0;
    private b0: number = 1; private b1: number = 0; private b2: number = 0;
    private x1: number = 0; private x2: number = 0;
    private y1: number = 0; private y2: number = 0;

    constructor(sampleRate: number) {
        this.sampleRate = sampleRate;
        this.setCoefficients(1, 0, 0, 1, 0, 0); // Default to passthrough
    }

    setCoefficients(b0: number, b1: number, b2: number, a0: number, a1: number, a2: number) {
        this.b0 = b0; this.b1 = b1; this.b2 = b2;
        this.a0 = a0; this.a1 = a1; this.a2 = a2;
    }

    // Calculate coefficients for a bandpass filter
    setBandpass(frequency: number, Q: number, sampleRate: number) {
        const omega = 2 * Math.PI * frequency / sampleRate;
        const sinOmega = Math.sin(omega);
        const cosOmega = Math.cos(omega);
        const alpha = sinOmega / (2 * Q);

        const b0 = alpha;
        const b1 = 0;
        const b2 = -alpha;
        const a0 = 1 + alpha;
        const a1 = -2 * cosOmega;
        const a2 = 1 - alpha;

        this.setCoefficients(b0 / a0, b1 / a0, b2 / a0, 1, a1 / a0, a2 / a0);
    }

    // Calculate coefficients for a lowpass filter (for envelope follower)
    setLowpass(frequency: number, Q: number, sampleRate: number) {
        const omega = 2 * Math.PI * frequency / sampleRate;
        const sinOmega = Math.sin(omega);
        const cosOmega = Math.cos(omega);
        const alpha = sinOmega / (2 * Q);

        const b0 = (1 - cosOmega) / 2;
        const b1 = 1 - cosOmega;
        const b2 = (1 - cosOmega) / 2;
        const a0 = 1 + alpha;
        const a1 = -2 * cosOmega;
        const a2 = 1 - alpha;

        this.setCoefficients(b0 / a0, b1 / a0, b2 / a0, 1, a1 / a0, a2 / a0);
    }

    process(sample: number): number {
        const output = (this.b0 * sample + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2);
        this.x2 = this.x1;
        this.x1 = sample;
        this.y2 = this.y1;
        this.y1 = output;
        return output;
    }

    // Reset filter state
    reset() {
        this.x1 = this.x2 = this.y1 = this.y2 = 0;
    }
}

// Simple Oscillator implementation
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

    setType(type: OscillatorType) {
        this.type = type;
    }

    process(): number {
        let sample = 0;
        const phaseIncrement = this.frequency / this.sampleRate;

        switch (this.type) {
            case 'sine':
                sample = Math.sin(2 * Math.PI * this.phase);
                break;
            case 'square':
                sample = this.phase < 0.5 ? 1 : -1;
                break;
            case 'sawtooth':
                sample = 2 * (this.phase - Math.floor(this.phase + 0.5));
                break;
            case 'triangle':
                sample = 2 * Math.abs(2 * (this.phase - Math.floor(this.phase + 0.5))) - 1;
                break;
        }

        this.phase = (this.phase + phaseIncrement) % 1;
        return sample;
    }
}


class VocoderProcessor extends AudioWorkletProcessor {
    static get parameterDescriptors() {
        return [
            { name: 'mix', defaultValue: 0.5, automationRate: 'a-rate' },
            { name: 'formantShift', defaultValue: 0, automationRate: 'a-rate' },
            { name: 'synthPitch', defaultValue: 48, automationRate: 'a-rate' },
            { name: 'carrierGain', defaultValue: 1.0, automationRate: 'a-rate' }, // New param for carrier gain
            { name: 'modulatorGain', defaultValue: 1.0, automationRate: 'a-rate' }, // New param for modulator gain
        ];
    }

    private numBands: number = 12;
    private bandFrequencies: number[] = [];
    private minFreq: number = 100;
    private maxFreq: number = 6000;

    private modulatorFilters: BiquadFilter[][] = [];
    private carrierFilters: BiquadFilter[][] = [];
    private envelopeFollowers: BiquadFilter[][] = [];
    private vcaGains: number[] = []; // Store VCA gain values directly

    private internalSynth: SimpleOscillator | null = null;
    private internalSynthGain: number = 0; // Start muted, controlled by updateParams

    private carrierType: string = 'drums'; // 'drums', 'bass', 'both', 'synth'
    private currentFormantShift: number = 0;
    private currentSynthPitch: number = 48;
    private sampleRate: number;

    // Add the missing properties
    private mix: number = 0.5;
    private formantShift: number = 0;

    constructor() {
        super();
        this.sampleRate = sampleRate; // Capture the sampleRate from global scope

        // Generate logarithmically spaced band frequencies
        for (let i = 0; i < this.numBands; i++) {
            const freq = this.minFreq * Math.pow(this.maxFreq / this.minFreq, i / (this.numBands - 1));
            this.bandFrequencies.push(freq);
        }

        // Initialize filters and VCA gains for each band
        for (let i = 0; i < this.numBands; i++) {
            this.modulatorFilters.push([new BiquadFilter(this.sampleRate), new BiquadFilter(this.sampleRate)]); // Stereo
            this.carrierFilters.push([new BiquadFilter(this.sampleRate), new BiquadFilter(this.sampleRate)]);   // Stereo
            this.envelopeFollowers.push([new BiquadFilter(this.sampleRate), new BiquadFilter(this.sampleRate)]); // Stereo
            this.vcaGains.push(0); // Initial VCA gain
        }

        this.internalSynth = new SimpleOscillator(this.sampleRate, 'sawtooth', midiToFreq(this.currentSynthPitch));

        this.port.onmessage = (event) => {
            const { type, payload } = event.data;
            switch (type) {
                case 'updateParams': // Handle all params in one message
                    this.mix = payload.mix;
                    this.formantShift = payload.formantShift;
                    this.currentSynthPitch = payload.synthPitch;
                    this.carrierType = payload.carrier;
                    // Update synth pitch immediately
                    if (this.internalSynth) {
                        this.internalSynth.setFrequency(midiToFreq(this.currentSynthPitch));
                    }
                    // Control internal synth gain based on carrier type
                    if (this.carrierType === 'synth' || this.carrierType === 'both') {
                        this.internalSynthGain = 0.1; // Set gain when active
                    } else {
                        this.internalSynthGain = 0; // Mute when inactive
                    }
                    break;
            }
        };
    }

    process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean {
        const modulatorInput = inputs[0]; // Mic input
        const carrierInput = inputs[1];   // Instrument/Synth input
        const output = outputs[0];        // Vocoder output

        const mix = parameters.mix[0];
        const formantShift = parameters.formantShift[0];
        const synthPitch = parameters.synthPitch[0]; // Not used directly, updated via message
        const carrierGain = parameters.carrierGain[0];
        const modulatorGain = parameters.modulatorGain[0];

        // Ensure output buffers are cleared
        for (let channel = 0; channel < output.length; ++channel) {
            output[channel].fill(0);
        }

        // If no modulator input, output dry carrier or silence
        if (!modulatorInput || modulatorInput.length === 0) {
            if (mix < 1.0 && carrierInput && carrierInput.length > 0) {
                for (let channel = 0; channel < output.length; ++channel) {
                    for (let sample = 0; sample < output[channel].length; ++sample) {
                        output[channel][sample] = carrierInput[channel][sample] * (1.0 - mix);
                    }
                }
            } else {
                // No modulator and no dry carrier to output, so just silence
                for (let channel = 0; channel < output.length; ++channel) {
                    output[channel].fill(0);
                }
            }
            return true;
        }

        // Generate internal synth carrier if selected
        let currentCarrierBuffer: Float32Array[] = [];
        if (this.carrierType === 'synth' && this.internalSynth) {
            for (let channel = 0; channel < output.length; ++channel) {
                const synthBuffer = new Float32Array(output[channel].length);
                for (let sample = 0; sample < output[channel].length; ++sample) {
                    synthBuffer[sample] = this.internalSynth.process() * this.internalSynthGain;
                }
                currentCarrierBuffer.push(synthBuffer);
            }
        } else if (carrierInput && carrierInput.length > 0 && carrierInput[0].length > 0) { // Check if carrierInput is defined and has data
            currentCarrierBuffer = carrierInput;
        } else {
            // No external carrier, fill with zeros
            for (let channel = 0; channel < output.length; ++channel) {
                currentCarrierBuffer.push(new Float32Array(output[channel].length).fill(0));
            }
        }


        for (let channel = 0; channel < output.length; ++channel) {
            for (let sample = 0; sample < output[channel].length; ++sample) {
                let wetSample = 0;
                const currentModulatorSample = modulatorInput[channel][sample] * modulatorGain;
                const currentCarrierSample = currentCarrierBuffer[channel][sample] * carrierGain;

                for (let i = 0; i < this.numBands; i++) {
                    const originalFreq = this.bandFrequencies[i];
                    const formantAdjustedFreq = Math.max(50, Math.min(8000, originalFreq * Math.pow(2, formantShift)));

                    // Update filter coefficients for current sample block
                    this.modulatorFilters[i][channel].setBandpass(formantAdjustedFreq, 1.0, this.sampleRate);
                    this.carrierFilters[i][channel].setBandpass(formantAdjustedFreq, 1.0, this.sampleRate);
                    this.envelopeFollowers[i][channel].setLowpass(100, 0.707, this.sampleRate); // Responsive envelope

                    // Modulator path: filter -> rectify -> envelope follower
                    const filteredModulator = this.modulatorFilters[i][channel].process(currentModulatorSample);
                    const rectifiedModulator = Math.abs(filteredModulator);
                    const envelope = this.envelopeFollowers[i][channel].process(rectifiedModulator);

                    // Carrier path: filter -> VCA
                    const filteredCarrier = this.carrierFilters[i][channel].process(currentCarrierSample);
                    wetSample += filteredCarrier * envelope * 2.0; // Multiply by 2.0 for more gain
                }
                
                // Mix wet and dry signals
                output[channel][sample] = (wetSample * mix) + (currentModulatorSample * (1.0 - mix));
            }
        }

        return true;
    }
}

registerProcessor('vocoder-processor', VocoderProcessor);