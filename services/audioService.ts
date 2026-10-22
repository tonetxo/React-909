import { Velocity, InstrumentParams, BasslineStep, BasslineParams, VocoderParams, VocoderType, Instrument, BasslinePattern } from '../types';
import { playInstrument, BasslineSynth, midiToFreq } from './synthesis';
import { MidiService } from './MidiService';

type StepCallback = (step: number) => void;

interface ChannelStrip {
    input: GainNode;
    dry: GainNode;
    reverbSend: GainNode;
    delaySend: GainNode;
    flangerSend: GainNode;
}

export class AudioEngine {
    private audioContext: AudioContext | null = null;
    private masterGain: GainNode | null = null;
    private isInitialized = false;
    private initializationPromise: Promise<void> | null = null;

    // Buses
    private drumBus: GainNode | null = null;
    private bassBus: GainNode | null = null;

    // Effect nodes
    private reverbNode: ConvolverNode | null = null;
    private delayNode: DelayNode | null = null;
    private delayFeedback: GainNode | null = null;
    private flangerNode: DelayNode | null = null;
    private flangerFeedback: GainNode | null = null;
    private flangerLFO: OscillatorNode | null = null;
    private flangerDepth: GainNode | null = null;

    // --- Vocoder ---
    private vocoderWorkletNode: AudioWorkletNode | null = null;
    private vocoderEnabled = false;
    private vocoderParams: VocoderParams | null = null;
    // Route the drum / bass buses into the vocoder's carrier input (gain 0 or 1, set by the Carrier choice)
    private drumCarrierGain: GainNode | null = null;
    private bassCarrierGain: GainNode | null = null;
    private basslineSynth: BasslineSynth;

    private micStream: MediaStream | null = null;
    private micSource: MediaStreamAudioSourceNode | null = null;
    private micAnalyser: AnalyserNode | null = null;
    private visualizerFrameId: number | null = null;

    private channelStrips = new Map<string, ChannelStrip>();

    // --- Sequencing & Scheduling ---
    private stepCallback: StepCallback | null = null;
    private onStopCallback: (() => void) | null = null;
    private midiService: MidiService;

    private isRunning: boolean = false;
    private currentStep: number = 0;
    private tempo: number = 120;
    private swing: number = 0;
    private stepsPerSequence: number = 16;
    private instruments: Instrument[] = [];
    private basslinePattern: BasslinePattern | null = null;

    // Pattern Queuing for Song Mode
    private nextPattern: {
        instruments: Instrument[],
        bassline: BasslinePattern | null,
        stepsPerSequence: number
    } | null = null;

    private stopAtEndOfPattern: boolean = false;

    private nextStepTime: number = 0.0;
    private scheduleAheadTime: number = 0.15;
    private lookaheadTimerId: number | null = null;
    private readonly lookaheadPeriod: number = 50.0;

    // Anchor points for absolute time calculation to prevent drift
    private anchorAudioTime: number = 0;
    private anchorPerfTime: number = 0;

    constructor() {
        this.midiService = new MidiService();
        this.basslineSynth = new BasslineSynth();
    }

    public setMasterVolume(value: number) {
        if (this.masterGain && this.audioContext) {
            this.masterGain.gain.setTargetAtTime(value, this.audioContext.currentTime, 0.02);
        }
    }

    public async ensureAudioInitialized(): Promise<AudioContext> {
        if (!this.isInitialized) {
            await this.initAudio();
        }
        if (!this.audioContext) throw new Error("AudioContext failed to initialize");
        return this.audioContext;
    }

    private createChannelStrip(context: AudioContext): ChannelStrip {
        const input = context.createGain();
        const dry = context.createGain();
        const reverbSend = context.createGain();
        const delaySend = context.createGain();
        const flangerSend = context.createGain();

        input.connect(dry);
        dry.connect(reverbSend);
        dry.connect(delaySend);
        dry.connect(flangerSend);

        if (this.reverbNode) reverbSend.connect(this.reverbNode);
        if (this.delayNode) delaySend.connect(this.delayNode);
        if (this.flangerNode) flangerSend.connect(this.flangerNode);

        return { input, dry, reverbSend, delaySend, flangerSend };
    }

    public initAudio = async (): Promise<void> => {
        if (this.isInitialized) return;
        if (this.initializationPromise) return this.initializationPromise;

        this.initializationPromise = (async () => {
            this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
                latencyHint: 'interactive',
            });

            this.masterGain = this.audioContext.createGain();
            this.masterGain.gain.value = 0.7;
            this.masterGain.connect(this.audioContext.destination);

            await this.setupEffects();

            this.drumBus = this.audioContext.createGain();
            this.drumBus.gain.value = 1.5;
            this.bassBus = this.audioContext.createGain();
            this.bassBus.gain.value = 1.0;

            if (this.masterGain) {
                this.drumBus.connect(this.masterGain);
                this.bassBus.connect(this.masterGain);
            }

            const instrumentIds = ['kick', 'snare', 'clap', 'low_tom', 'mid_tom', 'hi_tom', 'hihat', 'openhat'];
            instrumentIds.forEach(id => {
                if (this.audioContext) {
                    const channel = this.createChannelStrip(this.audioContext);
                    this.channelStrips.set(id, channel);
                    if (this.drumBus) channel.dry.connect(this.drumBus);
                }
            });

            if (this.audioContext) {
                const bassChannel = this.createChannelStrip(this.audioContext);
                this.channelStrips.set('bassline', bassChannel);
                if (this.bassBus) bassChannel.dry.connect(this.bassBus);
            }

            await this.initVocoderWorklets();
            await this.resumeAudioContext();

            this.isInitialized = true;
        })();

        return this.initializationPromise;
    };

    private async resumeAudioContext() {
        if (this.audioContext) {
            if (this.audioContext.state === 'suspended') {
                await this.audioContext.resume();
            }
        }
    }

    private async initVocoderWorklets() {
        if (!this.audioContext) return;
        try {
            await this.audioContext.audioWorklet.addModule(new URL('./vocoder-processor.js', import.meta.url));

            // Input 0: mic (modulator), input 1: external carrier; both downmixed to mono
            this.vocoderWorkletNode = new AudioWorkletNode(this.audioContext, 'vocoder-processor-new', {
                numberOfInputs: 2,
                numberOfOutputs: 1,
                outputChannelCount: [1],
                channelCount: 1,
                channelCountMode: 'explicit',
                processorOptions: { sampleRate: this.audioContext.sampleRate }
            });

            this.drumCarrierGain = this.audioContext.createGain();
            this.bassCarrierGain = this.audioContext.createGain();
            this.drumCarrierGain.gain.value = 0;
            this.bassCarrierGain.gain.value = 0;
            this.drumBus?.connect(this.drumCarrierGain);
            this.bassBus?.connect(this.bassCarrierGain);
            this.drumCarrierGain.connect(this.vocoderWorkletNode, 0, 1);
            this.bassCarrierGain.connect(this.vocoderWorkletNode, 0, 1);
            this.applyVocoderParams();

            console.log("Vocoder AudioWorklet initialized.");
        } catch (e) {
            console.error("Error loading vocoder AudioWorklet:", e);
        }
    }

    public setVocoderType(type: VocoderType) {
        // Placeholder for future logic if multiple worklets are used
    }

    private setupEffects = async () => {
        if (!this.audioContext || !this.masterGain) return;

        this.reverbNode = this.audioContext.createConvolver();
        const reverbGain = this.audioContext.createGain();
        reverbGain.gain.value = 1.5;
        this.reverbNode.connect(reverbGain);
        reverbGain.connect(this.masterGain);
        const impulse = await this.generateImpulseResponse();
        this.reverbNode.buffer = impulse;

        this.delayNode = this.audioContext.createDelay(1.0);
        this.delayFeedback = this.audioContext.createGain();
        this.delayFeedback.gain.value = 0.4;
        this.delayNode.connect(this.delayFeedback);
        this.delayFeedback.connect(this.delayNode);
        this.delayNode.connect(this.masterGain);
        this.delayNode.delayTime.value = 0.375;

        this.flangerNode = this.audioContext.createDelay(0.01);
        this.flangerFeedback = this.audioContext.createGain();
        this.flangerLFO = this.audioContext.createOscillator();
        this.flangerDepth = this.audioContext.createGain();

        this.flangerFeedback.gain.value = 0.6;
        this.flangerLFO.type = 'sine';
        this.flangerLFO.frequency.value = 0.25;
        this.flangerDepth.gain.value = 0.003;

        this.flangerNode.connect(this.flangerFeedback);
        this.flangerFeedback.connect(this.flangerNode);
        this.flangerLFO.connect(this.flangerDepth);
        this.flangerDepth.connect(this.flangerNode.delayTime);
        this.flangerNode.connect(this.masterGain);
        this.flangerLFO.start();
    }

    private generateImpulseResponse = async (): Promise<AudioBuffer> => {
        if (!this.audioContext) throw new Error("AudioContext not initialized");
        const sampleRate = this.audioContext.sampleRate;
        const impulseLength = sampleRate * 2;
        const impulse = this.audioContext.createBuffer(2, impulseLength, sampleRate);
        for (let channel = 0; channel < 2; channel++) {
            const channelData = impulse.getChannelData(channel);
            for (let i = 0; i < impulseLength; i++) {
                channelData[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / impulseLength, 2.5);
            }
        }
        return impulse;
    }

    public playSound(
        instrumentId: string,
        velocity: Velocity,
        params: InstrumentParams,
        volume: number,
        time?: number
    ) {
        if (!this.isInitialized || !this.audioContext) return;
        const now = time ?? this.audioContext.currentTime;
        const channel = this.channelStrips.get(instrumentId);
        if (!channel) return;

        // Use smooth ramps to prevent clicks from parameter changes
        channel.dry.gain.setTargetAtTime(volume, now, 0.01);
        channel.reverbSend.gain.setTargetAtTime(params.reverbSend ?? 0, now, 0.01);
        channel.delaySend.gain.setTargetAtTime(params.delaySend ?? 0, now, 0.01);
        channel.flangerSend.gain.setTargetAtTime(params.flangerSend ?? 0, now, 0.01);

        playInstrument(this.audioContext, now, instrumentId, velocity, params, volume, channel);
    }

    public playBasslineNote(
        step: BasslineStep,
        prevStep: BasslineStep,
        nextStep: BasslineStep,
        params: BasslineParams,
        time?: number
    ) {
        if (!this.isInitialized || !this.audioContext) return;
        const now = time ?? this.audioContext.currentTime;
        const channel = this.channelStrips.get('bassline');
        if (!channel) return;

        // Use smooth ramps to prevent clicks from parameter changes
        channel.dry.gain.setTargetAtTime(params.volume, now, 0.01);
        channel.reverbSend.gain.setTargetAtTime(params.reverbSend, now, 0.01);
        channel.delaySend.gain.setTargetAtTime(params.delaySend, now, 0.01);
        channel.flangerSend.gain.setTargetAtTime(params.flangerSend, now, 0.01);

        if (params.enabled === false) {
            this.basslineSynth.stop(this.audioContext);
            return;
        }

        this.basslineSynth.playNote(this.audioContext, now, step, prevStep, nextStep, params, channel);
    }

    public stopAllSounds() {
        if (!this.isInitialized || !this.audioContext) return;
        this.basslineSynth.stop(this.audioContext);
    }

    public toggleVocoder = async (enabled: boolean) => {
        await this.ensureAudioInitialized();
        if (!this.vocoderWorkletNode) {
            console.error("Vocoder not available.");
            return;
        }

        if (enabled) {
            if (this.micStream) return;
            try {
                const stream = await navigator.mediaDevices.getUserMedia({
                    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false }
                });
                this.micStream = stream;
                this.micSource = this.audioContext.createMediaStreamSource(this.micStream);
                this.micAnalyser = this.audioContext.createAnalyser();
                this.micAnalyser.fftSize = 256;

                this.micSource.connect(this.vocoderWorkletNode);
                this.vocoderWorkletNode.connect(this.masterGain!);
                this.micSource.connect(this.micAnalyser);

                this.vocoderEnabled = true;
            } catch (err) {
                console.error('Mic access denied:', err);
                throw err;
            }
        } else {
            if (this.micSource) this.micSource.disconnect();
            if (this.vocoderWorkletNode && this.masterGain) this.vocoderWorkletNode.disconnect(this.masterGain);
            if (this.micStream) this.micStream.getTracks().forEach(t => t.stop());

            this.micStream = null;
            this.micSource = null;
            this.micAnalyser = null;
            this.vocoderEnabled = false;
        }
    };

    public updateVocoderParams(params: VocoderParams) {
        // Keep the latest params so they can be applied once the worklet exists
        this.vocoderParams = params;
        this.applyVocoderParams();
    }

    private applyVocoderParams() {
        const params = this.vocoderParams;
        if (!params || !this.vocoderWorkletNode || !this.audioContext) return;

        const now = this.audioContext.currentTime;
        const p = this.vocoderWorkletNode.parameters;

        p.get('voiceGain')?.setTargetAtTime(params.voiceGain ?? 30, now, 0.01);
        p.get('noiseGate')?.setTargetAtTime(params.noiseGate ?? 5, now, 0.01);
        p.get('attack')?.setTargetAtTime(params.attack ?? 0.003, now, 0.01);
        p.get('release')?.setTargetAtTime(params.release ?? 0.03, now, 0.01);
        p.get('sibilance')?.setTargetAtTime(params.sibilance ?? 0.5, now, 0.01);
        p.get('dryWet')?.setTargetAtTime(params.mix, now, 0.01);
        p.get('qFactor')?.setTargetAtTime(params.qFactor ?? 5, now, 0.01);
        p.get('carrierFreq')?.setTargetAtTime(midiToFreq(params.synthPitch), now, 0.01);
        p.get('formantShift')?.setTargetAtTime(params.formantShift, now, 0.01);

        const { carrier } = params;
        this.drumCarrierGain?.gain.setTargetAtTime(carrier === 'drums' || carrier === 'both' ? 1 : 0, now, 0.01);
        this.bassCarrierGain?.gain.setTargetAtTime(carrier === 'bass' || carrier === 'both' ? 1 : 0, now, 0.01);
        this.vocoderWorkletNode.port.postMessage({ type: 'SET_CARRIER_SOURCE', value: carrier === 'synth' ? 'internal' : 'external' });

        if (params.carrierWaveform) {
            this.vocoderWorkletNode.port.postMessage({ type: 'SET_CARRIER_WAVEFORM', value: params.carrierWaveform });
        }
    }

    public startMicVisualizer(canvas: HTMLCanvasElement) {
        const canvasCtx = canvas.getContext('2d');
        if (!canvasCtx) return;

        const draw = () => {
            if (!this.vocoderEnabled || !this.micAnalyser) {
                canvasCtx.clearRect(0, 0, canvas.width, canvas.height);
                this.visualizerFrameId = requestAnimationFrame(draw);
                return;
            }

            const bufferLength = this.micAnalyser.frequencyBinCount;
            const dataArray = new Uint8Array(bufferLength);
            this.micAnalyser.getByteTimeDomainData(dataArray);

            canvasCtx.fillStyle = 'rgb(17 24 39)';
            canvasCtx.fillRect(0, 0, canvas.width, canvas.height);

            let sum = 0;
            for (let i = 0; i < bufferLength; i++) {
                const v = (dataArray[i] - 128) / 128.0;
                sum += v * v;
            }
            const rms = Math.sqrt(sum / bufferLength);
            const height = rms * canvas.height;

            canvasCtx.fillStyle = 'rgb(250 204 21)';
            canvasCtx.fillRect(0, canvas.height - height, canvas.width, height);

            this.visualizerFrameId = requestAnimationFrame(draw);
        };
        draw();
    }

    public stopMicVisualizer() {
        if (this.visualizerFrameId) {
            cancelAnimationFrame(this.visualizerFrameId);
            this.visualizerFrameId = null;
        }
    }

    public setStepCallback(callback: StepCallback) {
        this.stepCallback = callback;
    }

    public setOnStopCallback(callback: () => void) {
        this.onStopCallback = callback;
    }

    public setMidiOutput(outputName: string) {
        this.midiService.setMidiOutput(outputName);
    }

    public subscribeMidiOutputs = (listener: (outputNames: string[]) => void): (() => void) =>
        this.midiService.subscribeOutputs(listener);

    /** Seconds to delay MIDI so it lines up with audible output (device latency + manual window.MIDI_LATENCY_OFFSET). */
    private getMidiLatency(): number {
        const manualOffset = (window as any).MIDI_LATENCY_OFFSET || 0.0;
        return (this.audioContext?.outputLatency || 0.0) + manualOffset;
    }

    public setPattern(instruments: Instrument[], bassline: BasslinePattern, stepsPerSequence: number) {
        this.instruments = instruments;
        this.basslinePattern = bassline;
        this.stepsPerSequence = stepsPerSequence;
        // Do NOT clear nextPattern or stopAtEndOfPattern here.
        // This method is called by the UI to update the *current* pattern (e.g. mutes, parameter changes).
        // Clearing the queue would break Song Mode transitions if the UI updates just before a transition.
    }

    public queuePattern(
        instruments: Instrument[],
        basslinePattern: BasslinePattern | null,
        stepsPerSequence: number
    ) {
        this.nextPattern = {
            instruments,
            bassline: basslinePattern,
            stepsPerSequence
        };
        this.stopAtEndOfPattern = false;
    }

    public setStopAtEndOfPattern(shouldStop: boolean) {
        this.stopAtEndOfPattern = shouldStop;
    }

    public async start(
        tempo: number,
        swing: number,
        instruments: Instrument[],
        basslinePattern: BasslinePattern | null,
        stepsPerSequence: number,
    ) {
        await this.ensureAudioInitialized();
        if (!this.audioContext) return;

        if (this.isRunning) return;

        // Reset queue state on start to ensure fresh playback
        this.nextPattern = null;
        this.stopAtEndOfPattern = false;

        this.isRunning = true;
        this.tempo = tempo;
        this.swing = swing;
        this.setPattern(instruments, basslinePattern, stepsPerSequence);

        // Use a safe offset for stability
        const startOffset = 0.25;
        const startTime = this.audioContext.currentTime + startOffset;

        // Establish timing anchors for Absolute Drift Correction
        // SIMPLIFIED: Use current performance.now() and audio.currentTime relationship directly
        // This avoids jitter from getOutputTimestamp() implementations in some environments
        const nowPerf = performance.now();
        const nowAudio = this.audioContext.currentTime;

        // Anchor: When audio reaches startTime, performance time will be:
        this.anchorPerfTime = nowPerf + ((startTime - nowAudio) * 1000);
        this.anchorAudioTime = startTime;

        // Calculate MIDI Start time with latency compensation
        const outputLatency = this.getMidiLatency();

        // MIDI Start should happen when audio starts physically exiting the device
        const midiStartTime = this.anchorPerfTime + (outputLatency * 1000);

        // Send Start 1ms before
        this.midiService.sendStart(midiStartTime - 1.0);

        this.nextStepTime = startTime;
        this.scheduleNextSteps();
    }

    public stop(midiStopTime?: number) {
        this.isRunning = false;
        if (this.lookaheadTimerId !== null) {
            clearTimeout(this.lookaheadTimerId);
            this.lookaheadTimerId = null;
        }

        this.stopAllSounds();
        this.midiService.sendStop(midiStopTime);

        this.currentStep = 0;
        this.nextStepTime = 0.0;
        this.anchorAudioTime = 0;
        this.anchorPerfTime = 0;

        if (this.onStopCallback) {
            this.onStopCallback();
        }

        // Reset queue state
        this.nextPattern = null;
        this.stopAtEndOfPattern = false;
    }

    public updateTempo(newTempo: number) {
        this.tempo = newTempo;
        // No re-anchoring needed: MIDI tick times are derived from the audio-clock
        // step times, so they follow tempo changes without drift.
    }

    public updateSwing(newSwing: number) {
        this.swing = newSwing;
    }

    private scheduleNextSteps() {
        if (!this.isRunning || !this.audioContext) return;

        const stepDuration = 60.0 / this.tempo / 4.0;
        const currentPlayTime = this.audioContext.currentTime;

        const outputLatency = this.getMidiLatency();

        while (this.nextStepTime < currentPlayTime + this.scheduleAheadTime) {
            // Calculate swing for this step
            let currentStepDuration = stepDuration;
            if (this.swing > 0) {
                const swingAmount = Math.pow(this.swing / 100, 2) * 0.5;
                if (this.currentStep % 2 === 0) {
                    currentStepDuration = stepDuration * (1 + swingAmount); // Lengthen downbeat
                } else {
                    currentStepDuration = Math.max(0.001, stepDuration * (1 - swingAmount)); // Shorten off-beat
                }
            }

            // Schedule Audio - Safety check: Don't play if time is too close to now
            if (this.nextStepTime >= currentPlayTime - 0.02) {
                this.playStepAtTime(this.currentStep, this.nextStepTime);
            }

            // Schedule MIDI Clock (6 ticks per 16th note step)
            // Use Absolute Calculation based on Anchors to prevent drift
            const tickDuration = currentStepDuration / 6;
            for (let i = 0; i < 6; i++) {
                const tickAudioTime = this.nextStepTime + (i * tickDuration);

                // Calculate precise time elapsed since start
                const timeFromStart = tickAudioTime - this.anchorAudioTime;

                // Calculate absolute performance time for this tick using the ROBUST ANCHOR
                const tickPerfTime = this.anchorPerfTime + (timeFromStart * 1000) + (outputLatency * 1000);

                this.midiService.sendTimingClock(tickPerfTime);
            }

            // Schedule UI callback
            const callbackTime = this.nextStepTime - this.audioContext.currentTime;
            const stepToNotify = this.currentStep; // Capture current value for closure
            if (callbackTime > 0) {
                setTimeout(() => {
                    if (this.stepCallback && this.isRunning) {
                        this.stepCallback(stepToNotify);
                    }
                }, callbackTime * 1000);
            } else if (this.stepCallback && this.isRunning) {
                this.stepCallback(stepToNotify);
            }

            this.nextStepTime += currentStepDuration;

            // Check for pattern transition at the end of the sequence
            if (this.currentStep === this.stepsPerSequence - 1) {
                if (this.stopAtEndOfPattern) {
                    // The last step is only scheduled here, it hasn't sounded yet.
                    // Stop when it ends instead of now, so it isn't cut off and
                    // the MIDI Stop lands after the last clock tick.
                    const endTime = this.nextStepTime;
                    const midiStopTime = this.anchorPerfTime + ((endTime - this.anchorAudioTime) * 1000) + (outputLatency * 1000);
                    const delayMs = Math.max(0, (endTime - this.audioContext.currentTime) * 1000);
                    this.lookaheadTimerId = window.setTimeout(() => this.stop(midiStopTime), delayMs);
                    return;
                }

                if (this.nextPattern) {
                    // Apply queued pattern
                    this.instruments = this.nextPattern.instruments;
                    this.basslinePattern = this.nextPattern.bassline;
                    this.stepsPerSequence = this.nextPattern.stepsPerSequence;
                    this.nextPattern = null;
                    this.currentStep = 0;
                } else {
                    // Loop current pattern
                    this.currentStep = 0;
                }
            } else {
                this.currentStep++;
            }
        }

        this.lookaheadTimerId = window.setTimeout(() => this.scheduleNextSteps(), this.lookaheadPeriod);
    }

    private playStepAtTime(step: number, time: number) {
        if (!this.audioContext) return;

        const soloInstruments = this.instruments.filter(inst => inst.isSolo);
        this.instruments.forEach(instrument => {
            const velocity = instrument.sequence[step];
            if (velocity > 0) {
                const isSoloed = soloInstruments.length > 0;
                const canPlay = isSoloed
                    ? soloInstruments.some(soloInst => soloInst.id === instrument.id)
                    : !instrument.isMuted;

                if (canPlay) {
                    this.playSound(instrument.id, velocity as Velocity, instrument.params, instrument.volume, time);
                }
            }
        });

        if (this.basslinePattern) {
            const stepData = this.basslinePattern.sequence[step];
            const prevStep = this.basslinePattern.sequence[(step - 1 + this.stepsPerSequence) % this.stepsPerSequence];
            const nextStep = this.basslinePattern.sequence[(step + 1) % this.stepsPerSequence];
            this.playBasslineNote(stepData, prevStep, nextStep, this.basslinePattern.params, time);
        }
    }

    public destroy() {
        this.stop();
    }
}

declare global {
    var __AUDIO_ENGINE__: AudioEngine | undefined;
}

if (import.meta.hot) {
    if (globalThis.__AUDIO_ENGINE__) {
        globalThis.__AUDIO_ENGINE__.destroy();
    }
}

export const audioEngine = new AudioEngine();

if (import.meta.hot) {
    globalThis.__AUDIO_ENGINE__ = audioEngine;
}
