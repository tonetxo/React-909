import { Velocity, InstrumentParams, BasslineStep, BasslineParams, VocoderParams, VocoderCarrier } from '../types';

let audioContext: AudioContext;
let masterGain: GainNode;
let isInitialized = false;

// Buses
let drumBus: GainNode;
let bassBus: GainNode;

// Effect nodes
let reverbNode: ConvolverNode;
let delayNode: DelayNode;
let delayFeedback: GainNode;
let flangerNode: DelayNode;
let flangerFeedback: GainNode;
let flangerLFO: OscillatorNode;
let flangerDepth: GainNode;

// --- Vocoder ---
interface VocoderBand {
    modulatorFilter: BiquadFilterNode;
    carrierFilter: BiquadFilterNode;
    envelopeFollower: BiquadFilterNode;
    vca: GainNode;
    originalFreq: number;
}
let micInput: GainNode;        // Input from microphone
let dryOutput: GainNode;       // Direct microphone output
let vocoderInput: GainNode;    // Input to vocoder processor
let vocoderOutput: GainNode;   // Output from vocoder processor
let vocoderBands: VocoderBand[] = [];
let internalSynth: OscillatorNode;
let internalSynthGain: GainNode;
let carrierInput: GainNode;
let currentCarrierType: VocoderCarrier | null = null;
let vocoderEnabled: boolean = false;
let micStream: MediaStream | null = null;
let micSource: MediaStreamAudioSourceNode | null = null;
let micAnalyser: AnalyserNode | null = null;
let visualizerFrameId: number;
let mixControl: GainNode;      // Mix control between dry and wet signals


interface ChannelStrip {
    input: GainNode;
    dry: GainNode;
    reverbSend: GainNode;
    delaySend: GainNode;
    flangerSend: GainNode;
}
const channelStrips = new Map<string, ChannelStrip>();

const createChannelStrip = (context: AudioContext): ChannelStrip => {
    const input = context.createGain();
    const dry = context.createGain();
    const reverbSend = context.createGain();
    const delaySend = context.createGain();
    const flangerSend = context.createGain();

    input.connect(dry);
    // Se conectará a buses en initAudio, no directamente al masterGain
    dry.connect(reverbSend);
    dry.connect(delaySend);
    dry.connect(flangerSend);
    
    reverbSend.connect(reverbNode);
    delaySend.connect(delayNode);
    flangerSend.connect(flangerNode);

    return { input, dry, reverbSend, delaySend, flangerSend };
}


const initAudio = () => {
    if (isInitialized) return;
    
    audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    masterGain = audioContext.createGain();
    masterGain.gain.value = 0.7;
    masterGain.connect(audioContext.destination);

    // --- Create Effects Chain ---
    // Reverb
    reverbNode = audioContext.createConvolver();
    const reverbGain = audioContext.createGain();
    reverbGain.gain.value = 1.5;
    reverbNode.connect(reverbGain);
    reverbGain.connect(masterGain);
    
    // Generate a simple impulse response for reverb
    const sampleRate = audioContext.sampleRate;
    const impulseLength = sampleRate * 2; // 2 seconds reverb
    const impulse = audioContext.createBuffer(2, impulseLength, sampleRate);
    const left = impulse.getChannelData(0);
    const right = impulse.getChannelData(1);
    for (let i = 0; i < impulseLength; i++) {
        left[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / impulseLength, 2.5);
        right[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / impulseLength, 2.5);
    }
    reverbNode.buffer = impulse;

    // Delay
    delayNode = audioContext.createDelay(1.0);
    delayFeedback = audioContext.createGain();
    delayFeedback.gain.value = 0.4;
    delayNode.connect(delayFeedback);
    delayFeedback.connect(delayNode);
    delayNode.connect(masterGain);
    delayNode.delayTime.value = 0.375; // Dotted eighth note at 120bpm

    // Flanger
    flangerNode = audioContext.createDelay(0.01);
    flangerFeedback = audioContext.createGain();
    flangerLFO = audioContext.createOscillator();
    flangerDepth = audioContext.createGain();
    
    flangerFeedback.gain.value = 0.6;
    flangerLFO.type = 'sine';
    flangerLFO.frequency.value = 0.25; // Flange rate
    flangerDepth.gain.value = 0.003; // Flange depth
    
    flangerNode.connect(flangerFeedback);
    flangerFeedback.connect(flangerNode);
    flangerLFO.connect(flangerDepth);
    flangerDepth.connect(flangerNode.delayTime);
    flangerNode.connect(masterGain);
    flangerLFO.start();

    // Create Buses
    drumBus = audioContext.createGain();
    drumBus.gain.value = 2.0; // Boost drum bus gain
    bassBus = audioContext.createGain();
    bassBus.gain.value = 0.7;
    drumBus.connect(masterGain);
    bassBus.connect(masterGain);

    // Create channel strips for all instruments
    const instrumentIds = ['kick', 'snare', 'clap', 'low_tom', 'mid_tom', 'hi_tom', 'hihat', 'openhat'];
    const basslineId = 'bassline';
    
    instrumentIds.forEach(id => {
        const channel = createChannelStrip(audioContext);
        channelStrips.set(id, channel);
        // Connect drum channels to drum bus
        channel.dry.connect(drumBus);
    });

    // Create bass channel and connect to bass bus
    const bassChannel = createChannelStrip(audioContext);
    channelStrips.set(basslineId, bassChannel);
    bassChannel.dry.connect(bassBus);

    // Create vocoder
    createVocoder(audioContext, 16);

    // Update vocoder params with default settings after initialization
    updateVocoderParams({
        enabled: false,
        carrier: 'drums',
        mix: 0.5,
        bands: 16,
        formantShift: 0,
        synthPitch: 48,
    });

    isInitialized = true;
};


const createVocoder = (context: AudioContext, numBands: number) => {
    // Inputs and outputs for proper mix control
    micInput = context.createGain();          // Input from microphone
    dryOutput = context.createGain();         // Direct microphone output
    vocoderInput = context.createGain();      // Input to vocoder processor
    vocoderInput.gain.value = 1.5;            // Lower gain to prevent overdrive
    vocoderOutput = context.createGain();
    carrierInput = context.createGain();
    
    // Add a simple compressor to control dynamics in the vocoder output
    const vocoderCompressor = context.createDynamicsCompressor();
    vocoderCompressor.threshold.value = -6;   // Reduce loud peaks
    vocoderCompressor.ratio.value = 3;        // 3:1 compression ratio
    vocoderCompressor.attack.value = 0.003;   // Fast attack to respond quickly
    vocoderCompressor.release.value = 0.3;    // Medium release for balance
    
    // Mix control node to blend dry and wet signals
    mixControl = context.createGain();
    
    // Create a DC blocker to prevent any DC offset that might cause issues
    const dcBlocker = context.createBiquadFilter();
    dcBlocker.type = 'highpass';
    dcBlocker.frequency.value = 10; // Block DC and very low frequencies
    dcBlocker.Q.value = 0.707;
    
    // Connect mic input to both dry output and vocoder input through DC blocker
    micInput.connect(dryOutput);              // Direct path for dry signal
    micInput.connect(dcBlocker);              // Connect to DC blocker first
    dcBlocker.connect(vocoderInput);          // Then to vocoder processor
    
    // Connect both dry and wet signals to mix control
    dryOutput.connect(mixControl);            // Dry signal to mix
    vocoderOutput.connect(vocoderCompressor); // Wet signal first to compressor
    vocoderCompressor.connect(mixControl);    // Then to mix
    


    // Use fewer, well-spaced frequency bands for better clarity
    const bandFrequencies = [200, 400, 800, 1200, 2000, 3000]; // 6 bands for stability

    vocoderBands = [];
    for (let i = 0; i < bandFrequencies.length; i++) {
        const freq = bandFrequencies[i];

        // Modulator filter (for the microphone signal)
        const modulatorFilter = context.createBiquadFilter();
        modulatorFilter.type = 'bandpass';
        modulatorFilter.frequency.value = freq;
        modulatorFilter.Q.value = 1.0; // Lower Q to reduce resonance

        // Carrier filter (for the synth/drums/bass signal)
        const carrierFilter = context.createBiquadFilter();
        carrierFilter.type = 'bandpass';
        carrierFilter.frequency.value = freq;
        carrierFilter.Q.value = 1.0; // Lower Q to reduce resonance

        // Improved envelope follower with smoothing for better note retention
        // Create a low-pass filter to smooth the envelope and prevent silence gaps
        const envelopeFollower = context.createBiquadFilter();
        envelopeFollower.type = 'lowpass';
        envelopeFollower.frequency.value = 25; // Higher frequency to reduce oscillations
        envelopeFollower.Q.value = 0.707; // Butterworth response for smoothness
        
        // Additional gain node to adjust the envelope sensitivity
        const envelopeGain = context.createGain();
        envelopeGain.gain.value = 2.0; // Reduce sensitivity to prevent oscillations
        
        // Voltage Controlled Amplifier to control the carrier band
        const vca = context.createGain();
        vca.gain.value = 0; // Start at 0, will be controlled by envelope follower

        // Connect modulator path: mic -> filter -> envelope follower -> gain -> VCA gain control
        vocoderInput.connect(modulatorFilter);
        modulatorFilter.connect(envelopeFollower);
        envelopeFollower.connect(envelopeGain);
        envelopeGain.connect(vca.gain);

        // Connect carrier path: carrier -> filter -> VCA -> output
        carrierInput.connect(carrierFilter);
        carrierFilter.connect(vca);
        vca.connect(vocoderOutput);

        const band: VocoderBand = {
            modulatorFilter,
            carrierFilter,
            envelopeFollower, // This is now the low-pass filter for smoothing
            vca,
            originalFreq: freq
        };
        
        vocoderBands.push(band);
    }

    // Create internal synth for 'synth' carrier mode
    internalSynth = context.createOscillator();
    internalSynth.type = 'sawtooth';
    internalSynth.frequency.value = midiToFreq(48); // C3
    internalSynthGain = context.createGain();
    internalSynthGain.gain.value = 0.1; // Even more conservative level to prevent distortion
    internalSynth.connect(internalSynthGain);
    internalSynth.start();
    
    // Connect mix output to master but start with gain at 0
    // It will be controlled by updateVocoderParams function
    mixControl.connect(masterGain);
    mixControl.gain.value = 0;  // Initially muted until vocoder is enabled
};


const getAudioContext = (): AudioContext => {
  if (!isInitialized) {
    initAudio();
  }
  return audioContext;
};

// A simple function to convert MIDI note to frequency
const midiToFreq = (midi: number) => {
    return Math.pow(2, (midi - 69) / 12) * 440;
};

// Bassline synth state to handle slides
let basslineOsc: OscillatorNode | null = null;
let basslineVcf: BiquadFilterNode | null = null;
let basslineVca: GainNode | null = null;

export const playSound = (instrumentId: string, velocity: Velocity, params: InstrumentParams, volume: number) => {
  const context = getAudioContext();
  const now = context.currentTime;
  
  const channel = channelStrips.get(instrumentId);
  if (!channel) return;

  // Update channel volumes and sends
  channel.dry.gain.setValueAtTime(volume, now);
  channel.reverbSend.gain.setValueAtTime(params.reverbSend ?? 0, now);
  channel.delaySend.gain.setValueAtTime(params.delaySend ?? 0, now);
  channel.flangerSend.gain.setValueAtTime(params.flangerSend ?? 0, now);

  const effectiveVolume = (velocity / 5);

  switch (instrumentId) {
    case 'kick': {
      const osc = context.createOscillator();
      const gain = context.createGain();
      osc.connect(gain);
      gain.connect(channel.input);

      const pitch = params.pitch ?? 50;
      const decay = params.decay ?? 0.5;
      const punch = params.punch ?? 0; // Default punch to 0

      // Adjust pitch sweep based on punch
      // Adjust pitch sweep based on punch
      // A higher punch value should mean a higher starting pitch and a faster sweep
      const pitchStartFactor = 2 + (punch * 10); // Max pitchStartFactor of 12 (pitch * 12)
      const pitchStart = pitch * pitchStartFactor;

      const minSweepTime = 0.005; // Minimum sweep time
      const maxSweepTime = 0.05; // Base sweep time
      // As punch increases, sweep time decreases from maxSweepTime towards minSweepTime
      const pitchSweepTime = maxSweepTime - (punch * (maxSweepTime - minSweepTime));

      osc.frequency.setValueAtTime(pitchStart, now);
      osc.frequency.exponentialRampToValueAtTime(pitch, now + Math.max(minSweepTime, pitchSweepTime));
      
      gain.gain.setValueAtTime(effectiveVolume * 1.5, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + decay);

      osc.start(now);
      osc.stop(now + decay);
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
        noiseGain.gain.setValueAtTime(effectiveVolume * (params.snappy ?? 0.5), now);
        noiseGain.gain.exponentialRampToValueAtTime(0.001, now + decay);

        noise.start(now);
        noise.stop(now + decay);

        const osc = context.createOscillator();
        const oscGain = context.createGain();
        osc.connect(oscGain);
        oscGain.connect(channel.input);

        osc.type = 'triangle';
        osc.frequency.value = params.pitch ?? 180;
        
        oscGain.gain.setValueAtTime(effectiveVolume * 0.8, now);
        oscGain.gain.exponentialRampToValueAtTime(0.001, now + decay * 0.8);
        
        osc.start(now);
        osc.stop(now + decay);
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

            const startTime = now + i * 0.01 * (params.spread ?? 0.8);
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

        osc.frequency.setValueAtTime(pitch * 1.5, now);
        osc.frequency.exponentialRampToValueAtTime(pitch, now + 0.02);
        
        gain.gain.setValueAtTime(effectiveVolume, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + decay);

        osc.start(now);
        osc.stop(now + decay);
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
            osc.start(now);
            osc.stop(now + (params.decay ?? 0.1));
        });

        const decay = params.decay ?? 0.1;
        gain.gain.setValueAtTime(effectiveVolume * 0.1, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + decay);
        break;
    }
  }
};

export const playBasslineNote = (step: BasslineStep, prevStep: BasslineStep, params: BasslineParams) => {
    const context = getAudioContext();
    const now = context.currentTime;

    const channel = channelStrips.get('bassline');
    if (!channel) return;
    
    // Update channel volumes and sends
    channel.dry.gain.setValueAtTime(params.volume, now);
    channel.reverbSend.gain.setValueAtTime(params.reverbSend, now);
    channel.delaySend.gain.setValueAtTime(params.delaySend, now);
    channel.flangerSend.gain.setValueAtTime(params.flangerSend, now);

    if (basslineOsc && basslineVcf && basslineVca) {
        if (!prevStep.slide) {
            basslineVca.gain.cancelScheduledValues(now);
            basslineVca.gain.setTargetAtTime(0, now, 0.01);
            basslineOsc.stop(now + 0.02);
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
        basslineOsc.frequency.setTargetAtTime(freq, now, 0.015);
        basslineVcf!.frequency.setTargetAtTime(effectiveCutoff, now, 0.01);
        basslineVcf!.Q.setTargetAtTime(effectiveResonance, now, 0.01);
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
    vcf.frequency.setValueAtTime(effectiveCutoff, now);
    vcf.Q.value = effectiveResonance;
    
    vcf.frequency.setTargetAtTime(effectiveCutoff + effectiveEnvMod, now, 0.001);
    vcf.frequency.setTargetAtTime(effectiveCutoff, now + 0.01, params.decay / 3);
    
    vca.gain.setValueAtTime(0, now);
    vca.gain.setTargetAtTime(effectiveVolume, now, 0.005);
    vca.gain.setTargetAtTime(0, now + params.decay, 0.02);

    osc.start(now);
    
    if (!step.slide) {
        osc.stop(now + params.decay + 0.2);
    }

    basslineOsc = osc;
    basslineVcf = vcf;
    basslineVca = vca;
};

export const toggleVocoder = async (enabled: boolean) => {
    console.log(`toggleVocoder called with enabled: ${enabled}`);
    
    // Initialize audio if not already done
    if (!isInitialized) {
        console.log("Initializing audio context...");
        getAudioContext(); // This will call initAudio() if needed
        if (!isInitialized) {
            console.error("Failed to initialize audio context");
            return;
        }
    }
    
    if (enabled) {
        if (!micStream) {
            try {
                console.log("Requesting microphone access...");
                micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
                micSource = audioContext.createMediaStreamSource(micStream);
                micAnalyser = audioContext.createAnalyser();
                micAnalyser.fftSize = 512; // Smaller FFT size for lower latency
                micAnalyser.smoothingTimeConstant = 0.5; // Smooth the visualizer without affecting audio
                micSource.connect(micAnalyser);
                micAnalyser.connect(micInput);  // Connect mic to our input node
                vocoderEnabled = true;
                console.log("Vocoder microphone enabled and connected");
            } catch (err) {
                console.error('Error accessing microphone:', err);
                return;
            }
        } else {
            console.log("Microphone already connected");
            vocoderEnabled = true;
        }
    } else {
        if (micStream) {
            micStream.getTracks().forEach(track => track.stop());
            micSource?.disconnect();
            micStream = null;
            micSource = null;
            micAnalyser = null;
        }
        vocoderEnabled = false;
        console.log("Vocoder disabled and microphone disconnected");
    }
};

export const updateVocoderParams = (params: VocoderParams) => {
    if (!isInitialized) return;
    const now = audioContext.currentTime;

    // Update mix control: balance between direct mic signal and vocoded signal
    if (params.enabled && micStream) {
        // When enabled, mix = 0 means all dry (direct mic), mix = 1 means all wet (vocoded)
        dryOutput.gain.setTargetAtTime(1 - params.mix, now, 0.02);  // Faster transition
        vocoderOutput.gain.setTargetAtTime(params.mix, now, 0.02); // Faster transition
        // Also enable the final output
        mixControl.gain.setTargetAtTime(0.7, now, 0.02); // Faster transition
    } else {
        // When disabled, no signal passes through
        mixControl.gain.setTargetAtTime(0, now, 0.02); // Faster fade out
    }
    
    // Handle carrier type changes
    if (params.carrier !== currentCarrierType) {
        // Disconnect the old carrier(s) if they exist
        if (currentCarrierType === 'drums' || currentCarrierType === 'both') {
            // Find the drum bus in channelStrips
            const drumIds = ['kick', 'snare', 'clap', 'low_tom', 'mid_tom', 'hi_tom', 'hihat', 'openhat'];
            drumIds.forEach(id => {
                const channel = channelStrips.get(id);
                if (channel) {
                    try {
                        channel.dry.disconnect(carrierInput);
                    } catch (e) {
                        // Ignore error if the connection doesn't exist
                    }
                }
            });
        }
        if (currentCarrierType === 'bass' || currentCarrierType === 'both') {
            const bassChannel = channelStrips.get('bassline');
            if (bassChannel) {
                try {
                    bassChannel.dry.disconnect(carrierInput);
                } catch (e) {
                    // Ignore error if the connection doesn't exist
                }
            }
        }
        if (currentCarrierType === 'synth') {
            try {
                internalSynthGain.disconnect(carrierInput);
            } catch (e) {
                // Ignore error if the connection doesn't exist
            }
        }

        // Connect the new carrier
        switch (params.carrier) {
            case 'drums': {
                const drumIds = ['kick', 'snare', 'clap', 'low_tom', 'mid_tom', 'hi_tom', 'hihat', 'openhat'];
                drumIds.forEach(id => {
                    const channel = channelStrips.get(id);
                    if (channel) {
                        try {
                            channel.dry.connect(carrierInput);
                        } catch (e) {
                            console.warn(`Could not connect drum channel ${id} to vocoder carrier input:`, e);
                        }
                    }
                });
                break;
            }
            case 'bass': {
                const bassChannel = channelStrips.get('bassline');
                if (bassChannel) {
                    try {
                        bassChannel.dry.connect(carrierInput);
                    } catch (e) {
                        console.warn('Could not connect bass channel to vocoder carrier input:', e);
                    }
                }
                break;
            }
            case 'both': {
                const drumIds = ['kick', 'snare', 'clap', 'low_tom', 'mid_tom', 'hi_tom', 'hihat', 'openhat'];
                drumIds.forEach(id => {
                    const channel = channelStrips.get(id);
                    if (channel) {
                        try {
                            channel.dry.connect(carrierInput);
                        } catch (e) {
                            console.warn(`Could not connect drum channel ${id} to vocoder carrier input:`, e);
                        }
                    }
                });
                const bassChannel = channelStrips.get('bassline');
                if (bassChannel) {
                    try {
                        bassChannel.dry.connect(carrierInput);
                    } catch (e) {
                        console.warn('Could not connect bass channel to vocoder carrier input:', e);
                    }
                }
                break;
            }
            case 'synth':
                try {
                    internalSynthGain.connect(carrierInput);
                } catch (e) {
                    console.warn('Could not connect internal synth to vocoder carrier input:', e);
                }
                break;
        }
        currentCarrierType = params.carrier;
    }

    // Update internal synth pitch (for synth carrier mode)
    internalSynth.frequency.setTargetAtTime(midiToFreq(params.synthPitch), now, 0.01);
    
    // Apply formant shift
    if (vocoderBands.length > 0) {
        const freqMultiplier = Math.pow(2, params.formantShift);
        vocoderBands.forEach(band => {
            const newFreq = band.originalFreq * freqMultiplier;
            const clampedFreq = Math.max(50, Math.min(8000, newFreq));
            band.modulatorFilter.frequency.value = clampedFreq;
            band.carrierFilter.frequency.value = clampedFreq;
        });
    }
};

export const startMicVisualizer = (canvas: HTMLCanvasElement) => {
    const canvasCtx = canvas.getContext('2d');
    if (!canvasCtx) return;

    const draw = () => {
        if (!micAnalyser) {
            canvasCtx.clearRect(0, 0, canvas.width, canvas.height);
            visualizerFrameId = requestAnimationFrame(draw);
            return;
        }
        const bufferLength = micAnalyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        micAnalyser.getByteTimeDomainData(dataArray);

        canvasCtx.fillStyle = 'rgb(17 24 39)'; // bg-gray-900
        canvasCtx.fillRect(0, 0, canvas.width, canvas.height);
        
        let sum = 0;
        for(let i = 0; i < bufferLength; i++) {
            const v = (dataArray[i] - 128) / 128.0;
            sum += v * v;
        }
        const rms = Math.sqrt(sum / bufferLength);
        const height = rms * canvas.height;

        canvasCtx.fillStyle = 'rgb(250 204 21)'; // yellow-400
        canvasCtx.fillRect(0, canvas.height - height, canvas.width, height);
        
        visualizerFrameId = requestAnimationFrame(draw);
    };
    draw();
};

export const stopMicVisualizer = () => {
    cancelAnimationFrame(visualizerFrameId);
};
