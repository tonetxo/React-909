// services/channelStrip.ts
import { reverbNode, delayNode, flangerNode } from './effects';

export interface ChannelStrip {
    input: GainNode;
    dry: GainNode;
    reverbSend: GainNode;
    delaySend: GainNode;
    flangerSend: GainNode;
}

export const channelStrips = new Map<string, ChannelStrip>();

export const createChannelStrip = (context: AudioContext): ChannelStrip => {
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
};
