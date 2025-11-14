// services/vocoder.ts
import { VocoderParams, VocoderCarrier, VocoderType } from '../types';

export let vocoderWorkletNode: AudioWorkletNode | null = null;
export let vocoderWorkletNodeNew: AudioWorkletNode | null = null;
export let currentVocoderType: VocoderType = 'original';
export let carrierInput: GainNode | null = null;
export let currentCarrierType: VocoderCarrier | null = null;
export let vocoderEnabled = false;
export let micStream: MediaStream | null = null;
export let micSource: MediaStreamAudioSourceNode | null = null;
export let micAnalyser: AnalyserNode | null = null;

export const initVocoder = async (audioContext: AudioContext) => {
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
        vocoderWorkletNode.onerror = (e) => console.error("Error in vocoder-processor:", e);

        vocoderWorkletNodeNew = new AudioWorkletNode(audioContext, 'vocoder-processor-new', {
            numberOfInputs: 1,
            numberOfOutputs: 1,
            outputChannelCount: [1],
            processorOptions: {
                sampleRate: audioContext.sampleRate
            }
        });
        vocoderWorkletNodeNew.onerror = (e) => console.error("Error in vocoder-processor-new:", e);

        carrierInput.connect(vocoderWorkletNode, 0, 1);
        console.log("Vocoder AudioWorklets initialized successfully.");
    } catch (e) {
        console.error("Error loading or creating vocoder AudioWorklets:", e);
    }
};

export const setVocoderType = (type: VocoderType) => {
    if (type === currentVocoderType) return;
    currentVocoderType = type;
    if (vocoderEnabled) {
        toggleVocoder(false);
        setTimeout(() => toggleVocoder(true), 100);
    }
};

export const toggleVocoder = async (enabled: boolean) => {
    // This function will be implemented in the next step
};
