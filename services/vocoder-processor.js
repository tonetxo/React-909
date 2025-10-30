// services/vocoder-processor.js

// Helper function for MIDI to frequency conversion
function midiToFreq(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12);
}

// Basic Biquad Filter implementation for AudioWorklet
class BiquadFilter {
    constructor(sampleRate) {
        this.sampleRate = sampleRate;
        this.a0 = 1; this.a1 = 0; this.a2 = 0;
        this.b0 = 1; this.b1 = 0; this.b2 = 0;
        this.x1 = 0; this.x2 = 0;
        this.y1 = 0; this.y2 = 0;
        this.setCoefficients(1, 0, 0, 1, 0, 0); // Default to passthrough
    }

    setCoefficients(b0, b1, b2, a0, a1, a2) {
        this.b0 = b0; this.b1 = b1; this.b2 = b2;
        this.a0 = a0; this.a1 = a1; this.a2 = a2;
    }

    // Calculate coefficients for a bandpass filter
    setBandpass(frequency, Q) {
        const omega = 2 * Math.PI * frequency / this.sampleRate;
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
    setLowpass(frequency, Q) {
        const omega = 2 * Math.PI * frequency / this.sampleRate;
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

    process(sample) {
        const output = (this.b0 * sample + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2);
        this.x2 = this.x1;
        this.x1 = sample;
        this.y2 = this.y1;
        this.y1 = output;
        return output;
    }
}

// Simple Oscillator implementation
class SimpleOscillator {
    constructor(sampleRate, type = 'sawtooth', frequency = 440) {
        this.sampleRate = sampleRate;
        this.type = type;
        this.frequency = frequency;
        this.phase = 0;
    }

    setFrequency(freq) {
        this.frequency = freq;
    }

    setType(type) {
        this.type = type;
    }

    process() {
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
            { name: 'mix', defaultValue: 0, automationRate: 'a-rate' },
            { name: 'formantShift', defaultValue: 0, automationRate: 'a-rate' },
            { name: 'synthPitch', defaultValue: 48, automationRate: 'a-rate' },
            { name: 'carrierGain', defaultValue: 1.0, automationRate: 'a-rate' },
            { name: 'modulatorGain', defaultValue: 1.0, automationRate: 'a-rate' },
        ];
    }

    constructor(options) {
        super();
        this.numBands = 8; // Reduced for better performance
        this.sampleRate = options.processorOptions?.sampleRate || 44100;
        
        // Define frequency bands logarithmically spaced
        this.bandFrequencies = [];
        const minFreq = 100;
        const maxFreq = 4000;
        for (let i = 0; i < this.numBands; i++) {
            const freq = minFreq * Math.pow(maxFreq / minFreq, i / (this.numBands - 1));
            this.bandFrequencies.push(freq);
        }
        
        // Initialize filters for each band and channel
        this.modulatorFilters = [];
        this.carrierFilters = [];
        this.envelopeFollowers = [];
        
        for (let i = 0; i < this.numBands; i++) {
            this.modulatorFilters.push([new BiquadFilter(this.sampleRate), new BiquadFilter(this.sampleRate)]); // Stereo
            this.carrierFilters.push([new BiquadFilter(this.sampleRate), new BiquadFilter(this.sampleRate)]);
            this.envelopeFollowers.push([new BiquadFilter(this.sampleRate), new BiquadFilter(this.sampleRate)]);
        }
        
        // Create internal synth
        this.internalSynth = new SimpleOscillator(this.sampleRate, 'sawtooth', midiToFreq(48));
        
        // Vocoder state parameters
        this.mix = 0;
        this.formantShift = 0;
        this.synthPitch = 48;
        this.internalSynthGain = 0; // Start muted
        
        // Carrier type state
        this.carrierType = 'drums';

        this.port.onmessage = (event) => {
            const { type, payload } = event.data;
            if (type === 'updateParams') {
                this.mix = payload.mix;
                this.formantShift = payload.formantShift;
                this.synthPitch = payload.synthPitch;
                this.carrierType = payload.carrier;
                
                // Update internal synth
                if (this.internalSynth) {
                    const freq = midiToFreq(this.synthPitch); // MIDI to frequency
                    this.internalSynth.setFrequency(freq);
                }
                
                // Control internal synth gain based on carrier type
                this.internalSynthGain = (this.carrierType === 'synth' || this.carrierType === 'both') ? 0.3 : 0;
            }
        };
    }

    process(inputs, outputs, parameters) {
        const modulatorInput = inputs[0]; // Microphone input
        const carrierInput = inputs[1];   // Carrier input (drums, bass, etc.)
        const output = outputs[0];        // Output

        // Safety check for inputs
        if (!modulatorInput || modulatorInput.length === 0 || 
            !carrierInput || carrierInput.length === 0 || 
            !output || output.length === 0) {
            return true;
        }

        // Get current parameter values
        const mix = parameters.mix.length > 0 ? parameters.mix[0] : this.mix;
        const formantShift = parameters.formantShift.length > 0 ? parameters.formantShift[0] : this.formantShift;
        const modulatorGain = parameters.modulatorGain.length > 0 ? parameters.modulatorGain[0] : 1.0;
        const carrierGain = parameters.carrierGain.length > 0 ? parameters.carrierGain[0] : 1.0;

        // Prepare carrier buffer - either from input or internal synth
        let carrierBuffer = carrierInput;
        if (this.carrierType === 'synth' || this.carrierType === 'both') {
            // Generate internal carrier if needed
            carrierBuffer = [
                new Float32Array(output[0].length),
                new Float32Array(output[0].length)
            ];
            
            for (let i = 0; i < output[0].length; i++) {
                const sample = this.internalSynth.process() * this.internalSynthGain;
                carrierBuffer[0][i] = sample;  // Left channel
                carrierBuffer[1][i] = sample;  // Right channel (duplicate for mono synth)
            }
        }

        // Main processing loop
        for (let channel = 0; channel < output.length; ++channel) {
            // Ensure the channel exists in both inputs
            if (!modulatorInput[channel] || !carrierBuffer[channel]) {
                // If not, fill output with zeros
                for (let sampleIdx = 0; sampleIdx < output[channel].length; ++sampleIdx) {
                    output[channel][sampleIdx] = 0;
                }
                continue;
            }
            
            for (let sampleIdx = 0; sampleIdx < output[channel].length; ++sampleIdx) {
                // Check bounds before accessing
                const modulatorValue = sampleIdx < modulatorInput[channel].length ? 
                    modulatorInput[channel][sampleIdx] : 0;
                const carrierValue = sampleIdx < carrierBuffer[channel].length ? 
                    carrierBuffer[channel][sampleIdx] : 0;
                
                const modulatorSample = modulatorValue * modulatorGain;
                const carrierSample = carrierValue * carrierGain;
                
                let outputSample = modulatorSample * (1 - mix); // Start with dry signal
                let wetSample = 0; // Vocoder effect

                // Process through each band
                for (let band = 0; band < this.numBands; band++) {
                    // Calculate shifted frequency
                    const originalFreq = this.bandFrequencies[band];
                    const shiftedFreq = Math.max(80, Math.min(5000, originalFreq * Math.pow(2, formantShift / 12)));
                    
                    // Update filter coefficients (less frequently for performance)
                    if (sampleIdx % 64 === 0) { // Update every 64 samples
                        this.modulatorFilters[band][channel].setBandpass(shiftedFreq, 3.0);
                        this.carrierFilters[band][channel].setBandpass(shiftedFreq, 3.0);
                        this.envelopeFollowers[band][channel].setLowpass(100, 0.707);
                    }
                    
                    // Modulator path: bandpass -> rectify -> envelope
                    const modFiltered = this.modulatorFilters[band][channel].process(modulatorSample);
                    const modRectified = Math.abs(modFiltered);
                    const modEnvelope = this.envelopeFollowers[band][channel].process(modRectified);
                    
                    // Carrier path: bandpass
                    const carFiltered = this.carrierFilters[band][channel].process(carrierSample);
                    
                    // Apply modulation: carrier * envelope
                    wetSample += carFiltered * modEnvelope * 2.0;
                }
                
                // Apply mix between dry and wet
                outputSample += wetSample * mix;
                
                // Apply soft limiting to prevent clipping
                output[channel][sampleIdx] = Math.tanh(outputSample);
            }
        }

        return true;
    }
}

registerProcessor('vocoder-processor', VocoderProcessor);