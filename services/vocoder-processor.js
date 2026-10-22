// services/vocoder-processor.js
//
// Channel vocoder: the mic (modulator, input 0) is split into bands, and each band's envelope
// is imposed on the same band of the carrier: either the internal oscillator or input 1
// (the app routes the drum and/or bass buses there).
// The per-sample band loop works on flat typed arrays: it runs NUM_BANDS * 4 biquads per sample.

const NUM_BANDS = 24;
const MIN_BAND_FREQ = 100;
const MAX_BAND_FREQ = 10000;

// Each carrier band is normalised to unit level, so the carrier's own spectral tilt
// doesn't colour the result; levels below the floor are not boosted any further.
const CARRIER_NORM_FLOOR = 0.01;
const OUTPUT_GAIN = 0.06;

// Sibilance mixes noise into the carrier, fading in between these frequencies
const NOISE_FADE_START = 2500;
const NOISE_FADE_END = 5000;
const NOISE_LEVEL = 0.3;

const DENORMAL_LIMIT = 1e-15;

const timeToCoeff = (seconds) => 1 - Math.exp(-1 / (sampleRate * seconds));

// PolyBLEP correction: removes most of the aliasing of naive saw/square waves
const polyBlep = (t, dt) => {
    if (t < dt) {
        t /= dt;
        return t + t - t * t - 1;
    }
    if (t > 1 - dt) {
        t = (t - 1) / dt;
        return t * t + t + t + 1;
    }
    return 0;
};

class Oscillator {
    constructor() {
        this.phase = 0;
        this.frequency = 110;
        this.type = 'sawtooth';
    }

    process() {
        const dt = this.frequency / sampleRate;
        const t = this.phase;
        let value;

        switch (this.type) {
            case 'sine':
                value = Math.sin(2 * Math.PI * t);
                break;
            case 'square':
                value = (t < 0.5 ? 1 : -1) + polyBlep(t, dt) - polyBlep((t + 0.5) % 1, dt);
                break;
            case 'triangle':
                // Its harmonics fall at 12 dB/octave, so aliasing is negligible
                value = 1 - 4 * Math.abs(t - 0.5);
                break;
            default: // sawtooth
                value = 2 * t - 1 - polyBlep(t, dt);
        }

        this.phase += dt;
        if (this.phase >= 1) this.phase -= 1;
        return value;
    }
}

// 2nd-order Butterworth highpass, removes rumble and DC from the mic before analysis
class Highpass {
    constructor(freq) {
        const omega = 2 * Math.PI * freq / sampleRate;
        const alpha = Math.sin(omega) / (2 * Math.SQRT1_2);
        const cos = Math.cos(omega);
        const a0Inv = 1 / (1 + alpha);
        this.b0 = (1 + cos) / 2 * a0Inv;
        this.b1 = -(1 + cos) * a0Inv;
        this.a1 = -2 * cos * a0Inv;
        this.a2 = (1 - alpha) * a0Inv;
        this.x1 = 0; this.x2 = 0; this.y1 = 0; this.y2 = 0;
    }

    process(x) {
        const y = this.b0 * (x + this.x2) + this.b1 * this.x1 - this.a1 * this.y1 - this.a2 * this.y2;
        this.x2 = this.x1; this.x1 = x;
        this.y2 = this.y1; this.y1 = y;
        return y;
    }
}

// Biquad state layout: 4 filters per band (modulator stage 1/2, carrier stage 1/2), 4 values each
const STATE_PER_BAND = 16;

class VocoderProcessorNew extends AudioWorkletProcessor {

    static get parameterDescriptors() {
        return [
            { name: 'voiceGain', defaultValue: 30, minValue: 1, maxValue: 100 },
            { name: 'noiseGate', defaultValue: 5, minValue: 0, maxValue: 50 },
            { name: 'attack', defaultValue: 0.003, minValue: 0.001, maxValue: 0.1 },
            { name: 'release', defaultValue: 0.03, minValue: 0.01, maxValue: 0.2 },
            { name: 'sibilance', defaultValue: 0.5, minValue: 0, maxValue: 1 },
            { name: 'dryWet', defaultValue: 1.0, minValue: 0, maxValue: 1 },
            { name: 'qFactor', defaultValue: 5, minValue: 1, maxValue: 12 },
            { name: 'carrierFreq', defaultValue: 110, minValue: 30, maxValue: 1100 },
        ];
    }

    constructor() {
        super();
        this.carrierOsc = new Oscillator();
        this.useExternalCarrier = false;
        this.modulatorHighpass = new Highpass(70);

        // Constant 0 dB peak bandpass (RBJ): b1 = 0 and b2 = -b0, so only b0, a1, a2 are stored.
        // Modulator and carrier bands share the same coefficients (two cascaded stages = 4th order).
        this.bandFreqs = new Float64Array(NUM_BANDS);
        this.b0 = new Float64Array(NUM_BANDS);
        this.a1 = new Float64Array(NUM_BANDS);
        this.a2 = new Float64Array(NUM_BANDS);
        this.filterState = new Float64Array(NUM_BANDS * STATE_PER_BAND);
        this.modulatorLevels = new Float64Array(NUM_BANDS);
        this.modulatorSmoothed = new Float64Array(NUM_BANDS);
        this.carrierLevels = new Float64Array(NUM_BANDS);
        this.noiseWeights = new Float64Array(NUM_BANDS);

        const ratio = Math.pow(MAX_BAND_FREQ / MIN_BAND_FREQ, 1 / (NUM_BANDS - 1));
        for (let j = 0; j < NUM_BANDS; j++) {
            const freq = MIN_BAND_FREQ * Math.pow(ratio, j);
            this.bandFreqs[j] = freq;
            const fade = (freq - NOISE_FADE_START) / (NOISE_FADE_END - NOISE_FADE_START);
            this.noiseWeights[j] = Math.min(Math.max(fade, 0), 1);
        }

        // Broadband mic level and gate state for the noise gate
        this.inputLevel = 0;
        this.gateOpen = false;
        this.gateGain = 0;

        this.lastQFactor = -1;
        this.lastAttack = -1;
        this.lastRelease = -1;
        this.attackCoeff = 0;
        this.releaseCoeff = 0;

        // Fixed time constants for the carrier normaliser, input level and gate
        this.carrierAttackCoeff = timeToCoeff(0.002);
        this.carrierReleaseCoeff = timeToCoeff(0.1);
        this.inputAttackCoeff = timeToCoeff(0.001);
        this.inputReleaseCoeff = timeToCoeff(0.05);
        this.gateOpenCoeff = timeToCoeff(0.002);
        this.gateCloseCoeff = timeToCoeff(0.06);

        this.port.onmessage = (event) => {
            if (event.data.type === 'SET_CARRIER_WAVEFORM') {
                this.carrierOsc.type = event.data.value;
            } else if (event.data.type === 'SET_CARRIER_SOURCE') {
                this.useExternalCarrier = event.data.value === 'external';
            }
        };
    }

    setQ(Q) {
        for (let j = 0; j < NUM_BANDS; j++) {
            const omega = 2 * Math.PI * this.bandFreqs[j] / sampleRate;
            const alpha = Math.sin(omega) / (2 * Q);
            const a0Inv = 1 / (1 + alpha);
            this.b0[j] = alpha * a0Inv;
            this.a1[j] = -2 * Math.cos(omega) * a0Inv;
            this.a2[j] = (1 - alpha) * a0Inv;
        }
    }

    // Once the input goes silent, filter states and envelopes decay into denormals, which are very slow
    flushDenormals() {
        const s = this.filterState;
        for (let i = 0; i < s.length; i++) if (Math.abs(s[i]) < DENORMAL_LIMIT) s[i] = 0;
        for (let j = 0; j < NUM_BANDS; j++) {
            if (this.modulatorLevels[j] < DENORMAL_LIMIT) this.modulatorLevels[j] = 0;
            if (this.modulatorSmoothed[j] < DENORMAL_LIMIT) this.modulatorSmoothed[j] = 0;
            if (this.carrierLevels[j] < DENORMAL_LIMIT) this.carrierLevels[j] = 0;
        }
        if (this.inputLevel < DENORMAL_LIMIT) this.inputLevel = 0;
        if (this.gateGain < DENORMAL_LIMIT) this.gateGain = 0;
    }

    process(inputs, outputs, parameters) {
        const modulatorInput = inputs[0][0];
        // Undefined while nothing is playing into input 1
        const externalCarrier = this.useExternalCarrier ? inputs[1] && inputs[1][0] : undefined;
        const output = outputs[0][0];

        if (!modulatorInput) {
            return true; // No input to process
        }

        const voiceGain = parameters.voiceGain[0];
        const gateThreshold = parameters.noiseGate[0] * 0.0005;
        const attack = parameters.attack[0];
        const release = parameters.release[0];
        const noiseAmount = parameters.sibilance[0] * NOISE_LEVEL;
        const dryWet = parameters.dryWet[0];
        const qFactor = parameters.qFactor[0];
        this.carrierOsc.frequency = parameters.carrierFreq[0];

        if (qFactor !== this.lastQFactor) {
            this.setQ(qFactor);
            this.lastQFactor = qFactor;
        }
        if (attack !== this.lastAttack) {
            this.attackCoeff = timeToCoeff(attack / 2);
            this.lastAttack = attack;
        }
        if (release !== this.lastRelease) {
            this.releaseCoeff = timeToCoeff(release / 2);
            this.lastRelease = release;
        }

        const { b0, a1, a2, filterState: s, modulatorLevels, modulatorSmoothed, carrierLevels, noiseWeights } = this;
        const attackCoeff = this.attackCoeff, releaseCoeff = this.releaseCoeff;
        const carrierAttackCoeff = this.carrierAttackCoeff, carrierReleaseCoeff = this.carrierReleaseCoeff;
        const bandGain = voiceGain * OUTPUT_GAIN;

        for (let i = 0; i < output.length; i++) {
            const drySample = modulatorInput[i];
            const modulatorSample = this.modulatorHighpass.process(drySample);
            const oscSample = this.useExternalCarrier
                ? (externalCarrier ? externalCarrier[i] : 0)
                : this.carrierOsc.process();
            const noiseSample = noiseAmount > 0 ? (Math.random() * 2 - 1) * noiseAmount : 0;

            let wetSignal = 0;
            for (let j = 0, k = 0; j < NUM_BANDS; j++, k += STATE_PER_BAND) {
                const g = b0[j], c1 = a1[j], c2 = a2[j];

                // Modulator: 4th-order bandpass, then envelope: rectify + two attack/release smoothing
                // stages (each with half the time), which suppress ripple at the voice pitch far better than one
                let y = g * (modulatorSample - s[k + 1]) - c1 * s[k + 2] - c2 * s[k + 3];
                s[k + 1] = s[k]; s[k] = modulatorSample; s[k + 3] = s[k + 2]; s[k + 2] = y;
                let x = y;
                y = g * (x - s[k + 5]) - c1 * s[k + 6] - c2 * s[k + 7];
                s[k + 5] = s[k + 4]; s[k + 4] = x; s[k + 7] = s[k + 6]; s[k + 6] = y;

                let level = y < 0 ? -y : y;
                let env = modulatorLevels[j];
                env += (level - env) * (level > env ? attackCoeff : releaseCoeff);
                modulatorLevels[j] = env;
                let smoothed = modulatorSmoothed[j];
                smoothed += (env - smoothed) * (env > smoothed ? attackCoeff : releaseCoeff);
                modulatorSmoothed[j] = smoothed;

                // Carrier: same bandpass, normalised by its own envelope
                x = oscSample + noiseSample * noiseWeights[j];
                y = g * (x - s[k + 9]) - c1 * s[k + 10] - c2 * s[k + 11];
                s[k + 9] = s[k + 8]; s[k + 8] = x; s[k + 11] = s[k + 10]; s[k + 10] = y;
                x = y;
                y = g * (x - s[k + 13]) - c1 * s[k + 14] - c2 * s[k + 15];
                s[k + 13] = s[k + 12]; s[k + 12] = x; s[k + 15] = s[k + 14]; s[k + 14] = y;

                level = y < 0 ? -y : y;
                let carrierEnv = carrierLevels[j];
                carrierEnv += (level - carrierEnv) * (level > carrierEnv ? carrierAttackCoeff : carrierReleaseCoeff);
                carrierLevels[j] = carrierEnv;

                wetSignal += y / (carrierEnv > CARRIER_NORM_FLOOR ? carrierEnv : CARRIER_NORM_FLOOR) * smoothed;
            }

            // Noise gate with hysteresis on the smoothed input level, so it doesn't chatter
            const inputAbs = Math.abs(modulatorSample);
            this.inputLevel += (inputAbs - this.inputLevel) *
                (inputAbs > this.inputLevel ? this.inputAttackCoeff : this.inputReleaseCoeff);
            if (this.inputLevel > gateThreshold) this.gateOpen = true;
            else if (this.inputLevel < gateThreshold * 0.5) this.gateOpen = false;
            const gateTarget = this.gateOpen ? 1 : 0;
            this.gateGain += (gateTarget - this.gateGain) *
                (gateTarget > this.gateGain ? this.gateOpenCoeff : this.gateCloseCoeff);

            // Soft clip so loud input saturates gently instead of clipping
            const wet = Math.tanh(wetSignal * bandGain * this.gateGain);
            output[i] = drySample * (1 - dryWet) + wet * dryWet;
        }

        this.flushDenormals();
        return true;
    }
}

registerProcessor('vocoder-processor-new', VocoderProcessorNew);
