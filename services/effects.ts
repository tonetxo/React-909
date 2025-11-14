// services/effects.ts
export let reverbNode: ConvolverNode;
export let delayNode: DelayNode;
export let flangerNode: DelayNode;

export const setupEffects = (audioContext: AudioContext, masterGain: GainNode) => {
    // Reverb
    reverbNode = audioContext.createConvolver();
    const reverbGain = audioContext.createGain();
    reverbGain.gain.value = 1.5;
    reverbNode.connect(reverbGain);
    reverbGain.connect(masterGain);
    generateImpulseResponse(audioContext).then(impulse => {
        reverbNode.buffer = impulse;
    });

    // Delay
    delayNode = audioContext.createDelay(1.0);
    const delayFeedback = audioContext.createGain();
    delayFeedback.gain.value = 0.4;
    delayNode.connect(delayFeedback);
    delayFeedback.connect(delayNode);
    delayNode.connect(masterGain);
    delayNode.delayTime.value = 0.375; // Dotted eighth note at 120bpm

    // Flanger
    flangerNode = audioContext.createDelay(0.01);
    const flangerFeedback = audioContext.createGain();
    const flangerLFO = audioContext.createOscillator();
    const flangerDepth = audioContext.createGain();

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
};

const generateImpulseResponse = async (audioContext: AudioContext): Promise<AudioBuffer> => {
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
};
