// services/vocoder-processor.js

class BandpassFilter {
    constructor(sampleRate, freq, Q) {
        this.y1 = 0; this.y2 = 0;
        this.x1 = 0; this.x2 = 0;
        this.a1 = 0; this.a2 = 0;
        this.b0 = 0; this.b1 = 0; this.b2 = 0;
        this.freq = freq;
        this.updateCoefficients(sampleRate, freq, Q);
    }

    updateCoefficients(sampleRate, freq, Q) {
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

    process(sample) {
        const output = this.b0 * sample + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
        this.x2 = this.x1;
        this.x1 = sample;
        this.y2 = this.y1;
        this.y1 = output;
        return output;
    }
}

class HighpassFilter {
    constructor(sampleRate, freq) {
        this.y1 = 0;
        this.x1 = 0;
        const RC = 1.0 / (2 * Math.PI * freq);
        const T = 1.0 / sampleRate;
        const alpha = RC / (RC + T);
        this.a0 = alpha;
        this.a1 = -alpha;
        this.b1 = alpha;
    }

    process(sample) {
        this.y1 = this.a0 * sample + this.a1 * this.x1 + this.b1 * this.y1;
        this.x1 = sample;
        return this.y1;
    }
}

class SimpleOscillator {
    constructor(sampleRate, type = 'sawtooth', frequency = 440) {
        this.phase = 0;
        this._frequency = frequency;
        this._type = type;
        this.sampleRate = sampleRate;
    }

    set frequency(freq) {
        this._frequency = freq;
    }

    set type(type) {
        this._type = type;
    }

    process() {
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

class VocoderProcessorNew extends AudioWorkletProcessor {
    
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

    constructor(options) {
        super();
        const sampleRate = options.processorOptions.sampleRate || 44100;
        this.numBands = 40;
        this.lastGainValues = new Array(this.numBands).fill(0);
        
        this.carrierOsc = new SimpleOscillator(sampleRate, 'sawtooth', 110);
        this.sibilanceFilter = new HighpassFilter(sampleRate, 4000);
        this.modulatorFilters = [];
        this.carrierFilters = [];

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

    process(inputs, outputs, parameters) {
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
        
        // Update Q factor for all filters if it has changed
        this.modulatorFilters.forEach(f => f.updateCoefficients(sampleRate, f.freq, qFactor));
        this.carrierFilters.forEach(f => f.updateCoefficients(sampleRate, f.freq, qFactor));


        // --- Per-sample processing loop ---
        for (let i = 0; i < output.length; i++) {
            const modulatorSample = modulatorInput[i];
            const carrierSample = this.carrierOsc.process();

            let wetSignal = 0;

            // --- Band processing ---
            for (let j = 0; j < this.numBands; j++) {
                // 1. Analyze modulator for this band
                const modFiltered = this.modulatorFilters[j].process(modulatorSample);
                
                // Use abs as rough energy proxy
                let rms = Math.abs(modFiltered);

                // 2. Apply noise gate
                const gateThreshold = noiseGate / 500.0;
                if (rms < gateThreshold) {
                    rms = 0;
                }

                // 3. Calculate gain and apply smoothing (attack/release)
                const gainValue = Math.min(rms * voiceGain, 1.5);
                const timeConstant = gainValue > this.lastGainValues[j] ? attack : release;
                
                // Simple one-pole smoothing
                const smoothedGain = this.lastGainValues[j] + (gainValue - this.lastGainValues[j]) * (1 - Math.exp(-1 / (sampleRate * timeConstant)));
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
