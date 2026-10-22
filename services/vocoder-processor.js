// services/vocoder-processor.js
//
// Channel vocoder: the mic (modulator, input 0) is split into bands, and each band's envelope
// is imposed on the same band of the carrier: either the internal polyphonic synth or input 1
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
// Internal synth carrier normaliser: a slow envelope doesn't follow the beating between chord notes
// that share a band (which would distort chords); the fast envelope, half-weighted, still caps the
// boost when a note starts in a band that was silent. External carriers use the fast envelope alone.
const SLOW_ATTACK = 0.1;
const SLOW_RELEASE = 0.5;
const FAST_WEIGHT = 0.5;

// Output trims for the internal synth, measured with speech so every waveform matches the external
// carriers' level. Smoother waveforms need more: after per-band normalisation every band carries the
// same few harmonics, which add up coherently.
const WAVEFORM_TRIM = {
    sawtooth: Math.pow(10, -3.4 / 20),
    square: Math.pow(10, -4.7 / 20),
    triangle: Math.pow(10, -4.9 / 20),
    sine: Math.pow(10, -5.0 / 20),
};

const timeToCoeff = (seconds) => 1 - Math.exp(-1 / (sampleRate * seconds));

// Constant 0 dB peak gain bandpass (RBJ cookbook), stored at index j of the coefficient arrays
const setBandpass = (b0, a1, a2, j, freq, Q) => {
    const omega = 2 * Math.PI * freq / sampleRate;
    const alpha = Math.sin(omega) / (2 * Q);
    const a0Inv = 1 / (1 + alpha);
    b0[j] = alpha * a0Inv;
    a1[j] = -2 * Math.cos(omega) * a0Inv;
    a2[j] = (1 - alpha) * a0Inv;
};

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

const MAX_SYNTH_VOICES = 4;
const midiToFreq = (note) => 440 * Math.pow(2, (note - 69) / 12);

// Internal carrier: up to MAX_SYNTH_VOICES oscillators, one per held note. Each voice ramps its
// gain in and out (no clicks), and a held note keeps its voice so its phase stays continuous.
// With a glide time and a single note (Mono), the sounding voice slides to the new pitch instead.
class PolySynth {
    constructor() {
        // logFreq / glideTarget: current and target pitch as ln(Hz), so a glide takes the same time for any interval
        this.voices = Array.from({ length: MAX_SYNTH_VOICES }, () => ({ osc: new Oscillator(), note: -1, gain: 0, target: 0, logFreq: 0, glideTarget: 0 }));
        this.glideCoeff = 1;
        this.attackCoeff = timeToCoeff(0.003);
        this.releaseCoeff = timeToCoeff(0.03);
        this.level = 1;
        this.setNotes([45]); // A2 (110 Hz) until the app sends notes
        this.voices[0].gain = 1;
    }

    get type() {
        return this.voices[0].osc.type;
    }

    set type(type) {
        for (const voice of this.voices) voice.osc.type = type;
    }

    /** `glide`: seconds to (nearly, ~95%) reach a new single note; 0 jumps. */
    setNotes(notes, glide = 0) {
        const wanted = [...new Set(notes)].slice(0, MAX_SYNTH_VOICES);
        if (glide > 0 && wanted.length === 1) {
            const sounding = this.voices.filter(voice => voice.target === 1);
            if (sounding.length === 1) {
                const voice = sounding[0];
                voice.note = wanted[0];
                voice.glideTarget = Math.log(midiToFreq(wanted[0]));
                this.glideCoeff = timeToCoeff(glide / 3); // three time constants = 95%
                this.level = 1;
                return;
            }
        }
        // Keep voices whose note is still wanted, release the rest
        for (const voice of this.voices) {
            if (voice.target === 0) continue;
            const index = wanted.indexOf(voice.note);
            if (index >= 0) wanted.splice(index, 1);
            else voice.target = 0;
        }
        // New notes take the quietest released voice
        for (const note of wanted) {
            let free = null;
            for (const voice of this.voices) if (voice.target === 0 && (!free || voice.gain < free.gain)) free = voice;
            free.note = note;
            free.osc.frequency = midiToFreq(note);
            free.logFreq = free.glideTarget = Math.log(free.osc.frequency);
            free.target = 1;
        }
        // Keep the summed tone at a similar level next to the sibilance noise, whatever the chord size
        const active = this.voices.filter(voice => voice.target === 1).length;
        this.level = 1 / Math.sqrt(Math.max(active, 1));
    }

    process() {
        let sum = 0;
        for (const voice of this.voices) {
            if (voice.target === 0 && voice.gain === 0) continue;
            voice.gain += (voice.target - voice.gain) * (voice.target > voice.gain ? this.attackCoeff : this.releaseCoeff);
            if (voice.target === 0 && voice.gain < 1e-4) {
                voice.gain = 0;
                continue;
            }
            if (voice.logFreq !== voice.glideTarget) {
                const remaining = voice.glideTarget - voice.logFreq;
                voice.logFreq = Math.abs(remaining) < 1e-5 ? voice.glideTarget : voice.logFreq + remaining * this.glideCoeff;
                voice.osc.frequency = Math.exp(voice.logFreq);
            }
            sum += voice.osc.process() * voice.gain;
        }
        return sum * this.level;
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
            // Semitones: moves the carrier bands relative to the modulator bands (voice size/timbre)
            { name: 'formantShift', defaultValue: 0, minValue: -12, maxValue: 12 },
            // 0..1 multiplier on the vocoded output, automated by the app for the key gate (a-rate: smooth ramps)
            { name: 'keyGate', defaultValue: 1, minValue: 0, maxValue: 1 },
        ];
    }

    constructor() {
        super();
        this.carrierSynth = new PolySynth();
        this.useExternalCarrier = false;
        this.modulatorHighpass = new Highpass(70);

        // Constant 0 dB peak bandpass (RBJ): b1 = 0 and b2 = -b0, so only b0, a1, a2 are stored.
        // Each band is two cascaded stages (4th order). Carrier bands get their own coefficients
        // because the formant shift moves them away from the modulator bands.
        this.bandFreqs = new Float64Array(NUM_BANDS);
        this.b0 = new Float64Array(NUM_BANDS);
        this.a1 = new Float64Array(NUM_BANDS);
        this.a2 = new Float64Array(NUM_BANDS);
        this.carrierB0 = new Float64Array(NUM_BANDS);
        this.carrierA1 = new Float64Array(NUM_BANDS);
        this.carrierA2 = new Float64Array(NUM_BANDS);
        this.filterState = new Float64Array(NUM_BANDS * STATE_PER_BAND);
        this.modulatorLevels = new Float64Array(NUM_BANDS);
        this.modulatorSmoothed = new Float64Array(NUM_BANDS);
        this.carrierLevels = new Float64Array(NUM_BANDS);
        this.carrierSlowLevels = new Float64Array(NUM_BANDS);
        this.noiseWeights = new Float64Array(NUM_BANDS);

        const ratio = Math.pow(MAX_BAND_FREQ / MIN_BAND_FREQ, 1 / (NUM_BANDS - 1));
        for (let j = 0; j < NUM_BANDS; j++) {
            this.bandFreqs[j] = MIN_BAND_FREQ * Math.pow(ratio, j);
        }

        // Broadband mic level and gate state for the noise gate
        this.inputLevel = 0;
        this.gateOpen = false;
        this.gateGain = 0;

        this.lastQFactor = -1;
        this.lastFormantShift = NaN;
        this.lastAttack = -1;
        this.lastRelease = -1;
        this.attackCoeff = 0;
        this.releaseCoeff = 0;

        // Fixed time constants for the carrier normaliser, input level and gate
        this.carrierAttackCoeff = timeToCoeff(0.002);
        this.carrierReleaseCoeff = timeToCoeff(0.1);
        this.carrierSlowAttackCoeff = timeToCoeff(SLOW_ATTACK);
        this.carrierSlowReleaseCoeff = timeToCoeff(SLOW_RELEASE);
        this.inputAttackCoeff = timeToCoeff(0.001);
        this.inputReleaseCoeff = timeToCoeff(0.05);
        this.gateOpenCoeff = timeToCoeff(0.002);
        this.gateCloseCoeff = timeToCoeff(0.06);

        this.port.onmessage = (event) => {
            if (event.data.type === 'SET_CARRIER_WAVEFORM') {
                this.carrierSynth.type = event.data.value;
            } else if (event.data.type === 'SET_SYNTH_NOTES') {
                this.carrierSynth.setNotes(event.data.value, event.data.glide);
            } else if (event.data.type === 'SET_CARRIER_SOURCE') {
                this.useExternalCarrier = event.data.value === 'external';
            }
        };
    }

    setFilters(Q, formantShift) {
        const shiftRatio = Math.pow(2, formantShift / 12);
        const maxFreq = sampleRate * 0.45;
        for (let j = 0; j < NUM_BANDS; j++) {
            setBandpass(this.b0, this.a1, this.a2, j, this.bandFreqs[j], Q);
            const carrierFreq = Math.min(this.bandFreqs[j] * shiftRatio, maxFreq);
            setBandpass(this.carrierB0, this.carrierA1, this.carrierA2, j, carrierFreq, Q);
            // Sibilance noise goes where the consonants end up after the shift
            const fade = (carrierFreq - NOISE_FADE_START) / (NOISE_FADE_END - NOISE_FADE_START);
            this.noiseWeights[j] = Math.min(Math.max(fade, 0), 1);
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
            if (this.carrierSlowLevels[j] < DENORMAL_LIMIT) this.carrierSlowLevels[j] = 0;
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

        const formantShift = parameters.formantShift[0];
        if (qFactor !== this.lastQFactor || formantShift !== this.lastFormantShift) {
            this.setFilters(qFactor, formantShift);
            this.lastQFactor = qFactor;
            this.lastFormantShift = formantShift;
        }
        if (attack !== this.lastAttack) {
            this.attackCoeff = timeToCoeff(attack / 2);
            this.lastAttack = attack;
        }
        if (release !== this.lastRelease) {
            this.releaseCoeff = timeToCoeff(release / 2);
            this.lastRelease = release;
        }

        const { b0, a1, a2, carrierB0, carrierA1, carrierA2, filterState: s, modulatorLevels, modulatorSmoothed, carrierLevels, carrierSlowLevels, noiseWeights } = this;
        const slowAttackCoeff = this.carrierSlowAttackCoeff, slowReleaseCoeff = this.carrierSlowReleaseCoeff;
        const fastWeight = this.useExternalCarrier ? 1 : FAST_WEIGHT;
        const useSlow = !this.useExternalCarrier;
        const attackCoeff = this.attackCoeff, releaseCoeff = this.releaseCoeff;
        const carrierAttackCoeff = this.carrierAttackCoeff, carrierReleaseCoeff = this.carrierReleaseCoeff;
        const carrierTrim = this.useExternalCarrier ? 1 : WAVEFORM_TRIM[this.carrierSynth.type] ?? 1;
        const bandGain = voiceGain * OUTPUT_GAIN * carrierTrim;
        const keyGate = parameters.keyGate;

        for (let i = 0; i < output.length; i++) {
            const drySample = modulatorInput[i];
            const modulatorSample = this.modulatorHighpass.process(drySample);
            const oscSample = this.useExternalCarrier
                ? (externalCarrier ? externalCarrier[i] : 0)
                : this.carrierSynth.process();
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
                const cg = carrierB0[j], cc1 = carrierA1[j], cc2 = carrierA2[j];
                x = oscSample + noiseSample * noiseWeights[j];
                y = cg * (x - s[k + 9]) - cc1 * s[k + 10] - cc2 * s[k + 11];
                s[k + 9] = s[k + 8]; s[k + 8] = x; s[k + 11] = s[k + 10]; s[k + 10] = y;
                x = y;
                y = cg * (x - s[k + 13]) - cc1 * s[k + 14] - cc2 * s[k + 15];
                s[k + 13] = s[k + 12]; s[k + 12] = x; s[k + 15] = s[k + 14]; s[k + 14] = y;

                level = y < 0 ? -y : y;
                let carrierEnv = carrierLevels[j];
                carrierEnv += (level - carrierEnv) * (level > carrierEnv ? carrierAttackCoeff : carrierReleaseCoeff);
                carrierLevels[j] = carrierEnv;
                let divisor = carrierEnv * fastWeight;
                if (useSlow) {
                    let slowEnv = carrierSlowLevels[j];
                    slowEnv += (level - slowEnv) * (level > slowEnv ? slowAttackCoeff : slowReleaseCoeff);
                    carrierSlowLevels[j] = slowEnv;
                    if (slowEnv > divisor) divisor = slowEnv;
                }

                wetSignal += y / (divisor > CARRIER_NORM_FLOOR ? divisor : CARRIER_NORM_FLOOR) * smoothed;
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
            const wet = Math.tanh(wetSignal * bandGain * this.gateGain) * (keyGate.length > 1 ? keyGate[i] : keyGate[0]);
            output[i] = drySample * (1 - dryWet) + wet * dryWet;
        }

        this.flushDenormals();
        return true;
    }
}

registerProcessor('vocoder-processor-new', VocoderProcessorNew);
