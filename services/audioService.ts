import { Velocity, InstrumentParams, BasslineStep, BasslineParams, VocoderParams, VocoderCarrier, VocoderType } from '../types';

let audioContext: AudioContext;
let masterGain: GainNode;
let isInitialized = false;
let initializationPromise: Promise<void> | null = null;

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
let vocoderWorkletNode: AudioWorkletNode | null = null;
let vocoderWorkletNodeNew: AudioWorkletNode | null = null;
let currentVocoderType: VocoderType = 'original';
let carrierInput: GainNode | null = null;
let currentCarrierType: VocoderCarrier | null = null;
let vocoderEnabled = false;

let micStream: MediaStream | null = null;
let micSource: MediaStreamAudioSourceNode | null = null;
let micAnalyser: AnalyserNode | null = null;
let visualizerFrameId: number;


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
    dry.connect(reverbSend);
    dry.connect(delaySend);
    dry.connect(flangerSend);
    
    reverbSend.connect(reverbNode);
    delaySend.connect(delayNode);
    flangerSend.connect(flangerNode);

    return { input, dry, reverbSend, delaySend, flangerSend };
}

const initAudio = async (): Promise<void> => {
    if (isInitialized) {
        return;
    }
    if (initializationPromise) {
        return initializationPromise;
    }

    initializationPromise = new Promise(async (resolve) => {
        audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
            latencyHint: 'interactive',
        });

        masterGain = audioContext.createGain();
        masterGain.gain.value = 0.7;
        masterGain.connect(audioContext.destination);

        // --- Create Effects ---
        setupEffects();

        // --- Create Buses ---
        drumBus = audioContext.createGain();
        drumBus.gain.value = 1.5; // Boost drum volume
        bassBus = audioContext.createGain();
        bassBus.gain.value = 1.0;
        drumBus.connect(masterGain);
        bassBus.connect(masterGain);

        // --- Create Channel Strips ---
        const instrumentIds = ['kick', 'snare', 'clap', 'low_tom', 'mid_tom', 'hi_tom', 'hihat', 'openhat'];
        instrumentIds.forEach(id => {
            const channel = createChannelStrip(audioContext);
            channelStrips.set(id, channel);
            channel.dry.connect(drumBus);
        });

        const bassChannel = createChannelStrip(audioContext);
        channelStrips.set('bassline', bassChannel);
        bassChannel.dry.connect(bassBus);

        // --- Initialize Vocoder ---
        try {
            await audioContext.audioWorklet.addModule('services/vocoder-processor.js');
            await audioContext.audioWorklet.addModule('services/vocoder-processor-new.js');
            carrierInput = audioContext.createGain();
            vocoderWorkletNode = new AudioWorkletNode(audioContext, 'vocoder-processor', {
                numberOfInputs: 2,
                numberOfOutputs: 1,
                outputChannelCount: [1],
                processorOptions: {
                    sampleRate: audioContext.sampleRate
                }
            });
            vocoderWorkletNodeNew = new AudioWorkletNode(audioContext, 'vocoder-processor-new', {
                numberOfInputs: 1,
                numberOfOutputs: 1,
                outputChannelCount: [1],
                processorOptions: {
                    sampleRate: audioContext.sampleRate
                }
            });
            // Connect carrier input to the worklet's second input
            carrierInput.connect(vocoderWorkletNode, 0, 1);
            console.log("Vocoder AudioWorklets initialized successfully.");
        } catch (e) {
            console.error("Error loading or creating vocoder AudioWorklets:", e);
            // App can continue without vocoder functionality
        }

        isInitialized = true;
        resolve();
    });
    return initializationPromise;
};

export const setVocoderType = (type: VocoderType) => {
    if (type === currentVocoderType) return;
    currentVocoderType = type;
    if (vocoderEnabled) {
        // If the vocoder is running, stop and restart it with the new type
        toggleVocoder(false);
        setTimeout(() => toggleVocoder(true), 100);
    }
};

const setupEffects = () => {
    // Reverb
    reverbNode = audioContext.createConvolver();
    const reverbGain = audioContext.createGain();
    reverbGain.gain.value = 1.5;
    reverbNode.connect(reverbGain);
    reverbGain.connect(masterGain);
    generateImpulseResponse().then(impulse => {
        reverbNode.buffer = impulse;
    });

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
    flangerLFO.frequency.value = 0.25;
    flangerDepth.gain.value = 0.003;
    
    flangerNode.connect(flangerFeedback);
    flangerFeedback.connect(flangerNode);
    flangerLFO.connect(flangerDepth);
    flangerDepth.connect(flangerNode.delayTime);
    flangerNode.connect(masterGain);
    flangerLFO.start();
}

const generateImpulseResponse = async (): Promise<AudioBuffer> => {
    const sampleRate = audioContext.sampleRate;
    const impulseLength = sampleRate * 2;
    const impulse = audioContext.createBuffer(2, impulseLength, sampleRate);
    for (let channel = 0; channel < 2; channel++) {
        const channelData = impulse.getChannelData(channel);
        for (let i = 0; i < impulseLength; i++) {
            channelData[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / impulseLength, 2.5);
        }
    }
    return impulse;
}


export const getAudioContext = (): AudioContext | null => {
    return audioContext;
};

export const ensureAudioInitialized = async (): Promise<AudioContext> => {
    if (!isInitialized) {
        await initAudio();
    }
    return audioContext;
};


const midiToFreq = (midi: number) => {
    return Math.pow(2, (midi - 69) / 12) * 440;
};

// Bassline synth state
let basslineOsc: OscillatorNode | null = null;
let basslineVcf: BiquadFilterNode | null = null;
let basslineVca: GainNode | null = null;

export const playSound = (instrumentId: string, velocity: Velocity, params: InstrumentParams, volume: number) => {
  if (!isInitialized) return;
  const context = audioContext;
  const now = context.currentTime;
  
  const channel = channelStrips.get(instrumentId);
  if (!channel) return;

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
      const punch = params.punch ?? 0;

      const pitchStartFactor = 2 + (punch * 10);
      const pitchStart = pitch * pitchStartFactor;
      const minSweepTime = 0.005;
      const maxSweepTime = 0.05;
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
    if (!isInitialized) return;
    const context = audioContext;
    const now = context.currentTime;

    const channel = channelStrips.get('bassline');
    if (!channel) return;
    
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
    await ensureAudioInitialized();
    if (!vocoderWorkletNode || !vocoderWorkletNodeNew) {
        console.error("Vocoder is not available.");
        alert("Vocoder processor failed to load. Please check the console for errors.");
        return;
    }

    if (enabled) {
        if (micStream) return; // Already enabled
        try {
            console.log("Requesting microphone access...");
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: false, // Disable auto gain for more control
                    sampleRate: audioContext.sampleRate,
                }
            });
            
            micStream = stream;
            micSource = audioContext.createMediaStreamSource(micStream);
            micAnalyser = audioContext.createAnalyser();
            micAnalyser.fftSize = 256;

            if (currentVocoderType === 'original') {
                // Connect mic source to the vocoder's modulator input (input 0)
                micSource.connect(vocoderWorkletNode, 0, 0);
                // Connect the vocoder output to the master gain
                vocoderWorkletNode.connect(masterGain);
            } else {
                micSource.connect(vocoderWorkletNodeNew);
                vocoderWorkletNodeNew.connect(masterGain);
            }
            
            // Connect mic source to the analyser for visualization
            micSource.connect(micAnalyser);

            vocoderEnabled = true;
            console.log(`Microphone access granted. Vocoder (${currentVocoderType}) enabled and connected.`);

        } catch (err) {
            console.error('Error accessing microphone:', err);
            alert('Microphone access denied. Please grant permission to use the vocoder.');
            // Ensure we bubble up the error state
            throw err;
        }
    } else {
        if (!micStream || !micSource) return; // Already disabled

        console.log("Disabling vocoder and disconnecting microphone.");

        // Disconnect everything
        micSource.disconnect();
        try {
            vocoderWorkletNode.disconnect(masterGain);
        } catch (e) {}
        try {
            vocoderWorkletNodeNew.disconnect(masterGain);
        } catch (e) {}

        // Stop the microphone stream tracks
        micStream.getTracks().forEach(track => track.stop());

        // Clear references
        micStream = null;
        micSource = null;
        micAnalyser = null;
        vocoderEnabled = false;
        console.log("Vocoder disabled.");
    }
};

export const updateVocoderParams = (params: VocoderParams) => {
    if (!isInitialized || !vocoderWorkletNode || !vocoderWorkletNodeNew || !carrierInput) return;

    if (currentVocoderType === 'original') {
        // Send all relevant parameters to the AudioWorkletNode
        vocoderWorkletNode.port.postMessage({
            type: 'updateParams',
            payload: {
                mix: params.mix,
                formantShift: params.formantShift,
                synthPitch: params.synthPitch,
                carrier: params.carrier,
            }
        });
    } else {
        const now = audioContext.currentTime;
        vocoderWorkletNodeNew.parameters.get('voiceGain').setTargetAtTime(params.voiceGain ?? 30, now, 0.01);
        vocoderWorkletNodeNew.parameters.get('noiseGate').setTargetAtTime(params.noiseGate ?? 5, now, 0.01);
        vocoderWorkletNodeNew.parameters.get('attack').setTargetAtTime(params.attack ?? 0.001, now, 0.01);
        vocoderWorkletNodeNew.parameters.get('release').setTargetAtTime(params.release ?? 0.03, now, 0.01);
        vocoderWorkletNodeNew.parameters.get('sibilance').setTargetAtTime(params.sibilance ?? 0.2, now, 0.01);
        vocoderWorkletNodeNew.parameters.get('dryWet').setTargetAtTime(params.mix, now, 0.01); // Use mix for dryWet in new vocoder
        vocoderWorkletNodeNew.parameters.get('qFactor').setTargetAtTime(params.qFactor ?? 20, now, 0.01);
        vocoderWorkletNodeNew.parameters.get('carrierFreq').setTargetAtTime(params.carrierFreq ?? 110, now, 0.01);
        
        if (params.carrierWaveform) {
            vocoderWorkletNodeNew.port.postMessage({ type: 'SET_CARRIER_WAVEFORM', value: params.carrierWaveform });
        }
    }

    // Handle carrier routing, which happens outside the worklet
    if (params.carrier !== currentCarrierType) {
        // Disconnect all possible previous sources from the carrierInput
        if (currentCarrierType) {
            if (currentCarrierType === 'drums' || currentCarrierType === 'both') {
                try { drumBus.disconnect(carrierInput); } catch(e) {}
            }
            if (currentCarrierType === 'bass' || currentCarrierType === 'both') {
                try { bassBus.disconnect(carrierInput); } catch(e) {}
            }
        }

        // Connect the new source
        switch (params.carrier) {
            case 'drums':
                drumBus.connect(carrierInput);
                console.log("Vocoder carrier set to: Drums");
                break;
            case 'bass':
                bassBus.connect(carrierInput);
                console.log("Vocoder carrier set to: Bass");
                break;
            case 'both':
                drumBus.connect(carrierInput);
                bassBus.connect(carrierInput);
                console.log("Vocoder carrier set to: Both");
                break;
            case 'synth':
                // The 'synth' carrier is generated inside the worklet, so we just log it.
                console.log("Vocoder carrier set to: Internal Synth");
                break;
        }
        currentCarrierType = params.carrier;
    }
};

export const startMicVisualizer = (canvas: HTMLCanvasElement) => {
    const canvasCtx = canvas.getContext('2d');
    if (!canvasCtx) return;

    const draw = () => {
        visualizerFrameId = requestAnimationFrame(draw);

        if (!vocoderEnabled || !micAnalyser) {
            canvasCtx.clearRect(0, 0, canvas.width, canvas.height);
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
    };
    draw();
};

export const stopMicVisualizer = () => {
    cancelAnimationFrame(visualizerFrameId);
};