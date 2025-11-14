import { Velocity, InstrumentParams, BasslineStep, BasslineParams, VocoderParams, VocoderCarrier, VocoderType } from '../types';
import { playInstrument, playScheduledBasslineNote, stopBassline } from './synthesis';
import { setupEffects } from './effects';
import { initVocoder, setVocoderType as setVocoderTypeInVocoder, vocoderWorkletNode, vocoderWorkletNodeNew, currentVocoderType, carrierInput, currentCarrierType, vocoderEnabled, micStream, micSource, micAnalyser } from './vocoder';
import { createChannelStrip, channelStrips } from './channelStrip';

let audioContext: AudioContext;
let masterGain: GainNode;
let isInitialized = false;
let initializationPromise: Promise<void> | null = null;

// Buses
let drumBus: GainNode;
let bassBus: GainNode;

let visualizerFrameId: number;

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

        setupEffects(audioContext, masterGain);

        drumBus = audioContext.createGain();
        drumBus.gain.value = 1.5;
        bassBus = audioContext.createGain();
        bassBus.gain.value = 1.0;
        drumBus.connect(masterGain);
        bassBus.connect(masterGain);

        const instrumentIds = ['kick', 'snare', 'clap', 'low_tom', 'mid_tom', 'hi_tom', 'hihat', 'openhat'];
        instrumentIds.forEach(id => {
            const channel = createChannelStrip(audioContext);
            channelStrips.set(id, channel);
            channel.dry.connect(drumBus);
        });

        const bassChannel = createChannelStrip(audioContext);
        channelStrips.set('bassline', bassChannel);
        bassChannel.dry.connect(bassBus);

        await initVocoder(audioContext);

        isInitialized = true;
        resolve();
    });
    return initializationPromise;
};

export const setVocoderType = (type: VocoderType) => {
    setVocoderTypeInVocoder(type);
};


export const getAudioContext = (): AudioContext | null => {
    return audioContext;
};

export const ensureAudioInitialized = async (): Promise<AudioContext> => {
    if (!isInitialized) {
        await initAudio();
    }
    return audioContext;
};




export const playSound = (
  instrumentId: string,
  velocity: Velocity,
  params: InstrumentParams,
  volume: number,
  time?: number
) => {
  if (!isInitialized) return;
  const context = audioContext;
  const now = time ?? context.currentTime;

  const channel = channelStrips.get(instrumentId);
  if (!channel) return;

  // Set channel strip gains at the scheduled time
  channel.dry.gain.setValueAtTime(volume, now);
  channel.reverbSend.gain.setValueAtTime(params.reverbSend ?? 0, now);
  channel.delaySend.gain.setValueAtTime(params.delaySend ?? 0, now);
  channel.flangerSend.gain.setValueAtTime(params.flangerSend ?? 0, now);

  // Call the dedicated synthesis function
  playInstrument(context, now, instrumentId, velocity, params, volume, channel);
};

export const playBasslineNote = (
  step: BasslineStep,
  prevStep: BasslineStep,
  nextStep: BasslineStep,
  params: BasslineParams,
  time?: number
) => {
  if (!isInitialized) return;
  const context = audioContext;
  const now = time ?? context.currentTime;

  const channel = channelStrips.get('bassline');
  if (!channel) return;

  // Set channel strip gains at the scheduled time
  channel.dry.gain.setValueAtTime(params.volume, now);
  channel.reverbSend.gain.setValueAtTime(params.reverbSend, now);
  channel.delaySend.gain.setValueAtTime(params.delaySend, now);
  channel.flangerSend.gain.setValueAtTime(params.flangerSend, now);

  // Call the dedicated synthesis function
  playScheduledBasslineNote(context, now, step, prevStep, nextStep, params, channel);
};

export const stopAllSounds = () => {
  if (!isInitialized) return;
  stopBassline(audioContext);
};

const disconnectMic = () => {
    if (micSource) {
        micSource.disconnect();
        micSource = null;
    }
    if (micStream) {
        micStream.getTracks().forEach(track => track.stop());
        micStream = null;
    }
    if (vocoderWorkletNode) {
        try {
            vocoderWorkletNode.disconnect(masterGain);
        } catch (e) { /* ignore */ }
    }
    if (vocoderWorkletNodeNew) {
        try {
            vocoderWorkletNodeNew.disconnect(masterGain);
        } catch (e) { /* ignore */ }
    }
    micAnalyser = null;
    vocoderEnabled = false;
};
const enableVocoder = async () => {
    if (micStream) return; // Already enabled
    try {
        console.log("Requesting microphone access...");
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: false,
                sampleRate: audioContext.sampleRate,
            }
        });

        micStream = stream;
        micSource = audioContext.createMediaStreamSource(micStream);
        micAnalyser = audioContext.createAnalyser();
        micAnalyser.fftSize = 256;
        micSource.connect(micAnalyser);

        if (currentVocoderType === 'original') {
            micSource.connect(vocoderWorkletNode, 0, 0);
            vocoderWorkletNode.connect(masterGain);
        } else {
            micSource.connect(vocoderWorkletNodeNew);
            vocoderWorkletNodeNew.connect(masterGain);
        }

        vocoderEnabled = true;
        console.log(`Microphone access granted. Vocoder (${currentVocoderType}) enabled and connected.`);

    } catch (err) {
        console.error('Error accessing microphone:', err);
        alert('Microphone access denied. Please grant permission to use the vocoder.');
        throw err;
    }
};

const disableVocoder = () => {
    if (!micStream || !micSource) return;
    console.log("Disabling vocoder and disconnecting microphone.");
    disconnectMic();
    console.log("Vocoder disabled.");
};

export const toggleVocoder = async (enabled: boolean) => {
    await ensureAudioInitialized();
    if (!vocoderWorkletNode || !vocoderWorkletNodeNew) {
        console.error("Vocoder is not available.");
        alert("Vocoder processor failed to load. Please check the console for errors.");
        return;
    }

    if (enabled) {
        await enableVocoder();
    } else {
        disableVocoder();
    }
};

const updateOriginalVocoderParams = (params: VocoderParams) => {
    vocoderWorkletNode.port.postMessage({
        type: 'updateParams',
        payload: {
            mix: params.mix,
            formantShift: params.formantShift,
            synthPitch: params.synthPitch,
            carrier: params.carrier,
        }
    });
};

const updateNewVocoderParams = (params: VocoderParams) => {
    const now = audioContext.currentTime;
    vocoderWorkletNodeNew.parameters.get('voiceGain').setTargetAtTime(params.voiceGain ?? 30, now, 0.01);
    vocoderWorkletNodeNew.parameters.get('noiseGate').setTargetAtTime(params.noiseGate ?? 5, now, 0.01);
    vocoderWorkletNodeNew.parameters.get('attack').setTargetAtTime(params.attack ?? 0.001, now, 0.01);
    vocoderWorkletNodeNew.parameters.get('release').setTargetAtTime(params.release ?? 0.03, now, 0.01);
    vocoderWorkletNodeNew.parameters.get('sibilance').setTargetAtTime(params.sibilance ?? 0.2, now, 0.01);
    vocoderWorkletNodeNew.parameters.get('dryWet').setTargetAtTime(params.mix, now, 0.01);
    vocoderWorkletNodeNew.parameters.get('qFactor').setTargetAtTime(params.qFactor ?? 20, now, 0.01);
    vocoderWorkletNodeNew.parameters.get('carrierFreq').setTargetAtTime(params.carrierFreq ?? 110, now, 0.01);

    if (params.carrierWaveform) {
        vocoderWorkletNodeNew.port.postMessage({ type: 'SET_CARRIER_WAVEFORM', value: params.carrierWaveform });
    }
};

const updateCarrierRouting = (carrier: VocoderCarrier) => {
    if (carrier === currentCarrierType) return;

    if (currentCarrierType) {
        if (currentCarrierType === 'drums' || currentCarrierType === 'both') {
            try { drumBus.disconnect(carrierInput); } catch(e) {}
        }
        if (currentCarrierType === 'bass' || currentCarrierType === 'both') {
            try { bassBus.disconnect(carrierInput); } catch(e) {}
        }
    }

    switch (carrier) {
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
            console.log("Vocoder carrier set to: Internal Synth");
            break;
    }
    currentCarrierType = carrier;
};

export const updateVocoderParams = (params: VocoderParams) => {
    if (!isInitialized || !vocoderWorkletNode || !vocoderWorkletNodeNew || !carrierInput) return;

    if (currentVocoderType === 'original') {
        updateOriginalVocoderParams(params);
    } else {
        updateNewVocoderParams(params);
    }

    updateCarrierRouting(params.carrier);
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