import { Velocity, InstrumentParams, BasslineStep, BasslineParams, VocoderParams, VocoderCarrier, VocoderType, Instrument, BasslinePattern } from '../types';
import { playInstrument, playScheduledBasslineNote, stopBassline } from './synthesis';
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
    private currentVocoderType: VocoderType = 'original'; // Kept for UI compatibility, but underlying engine is unified
    private carrierInput: GainNode | null = null;
    private currentCarrierType: VocoderCarrier | null = null;
    private vocoderEnabled = false;

    private micStream: MediaStream | null = null;
    private micSource: MediaStreamAudioSourceNode | null = null;
    private micAnalyser: AnalyserNode | null = null;
    private visualizerFrameId: number | null = null;

    private channelStrips = new Map<string, ChannelStrip>();

    // --- Sequencing & Scheduling ---
    private stepCallback: StepCallback | null = null;
    private midiService: MidiService;
    private clockNode: AudioWorkletNode | null = null;

    private isRunning: boolean = false;
    private currentStep: number = 0;
    private tempo: number = 120;
    private swing: number = 0;
    private stepsPerSequence: number = 16;
    private instruments: Instrument[] = [];
    private basslinePattern: BasslinePattern | null = null;

    private nextStepTime: number = 0.0;
    private scheduleAheadTime: number = 0.15; // seconds
    private lookaheadTimerId: number | null = null;
    private readonly lookaheadPeriod: number = 50.0; // ms

    constructor() {
        // Singleton instance is created on export
        this.midiService = new MidiService();
    }

    public getAudioContext(): AudioContext | null {
        return this.audioContext;
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

        this.initializationPromise = new Promise(async (resolve) => {
            this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
                latencyHint: 'interactive',
            });

            this.masterGain = this.audioContext.createGain();
            this.masterGain.gain.value = 0.7;
            this.masterGain.connect(this.audioContext.destination);

            // --- Create Effects ---
            await this.setupEffects();

            // --- Create Buses ---
            this.drumBus = this.audioContext.createGain();
            this.drumBus.gain.value = 1.5; // Boost drum volume
            this.bassBus = this.audioContext.createGain();
            this.bassBus.gain.value = 1.0;

            if (this.masterGain) {
                this.drumBus.connect(this.masterGain);
                this.bassBus.connect(this.masterGain);
            }

            // --- Create Channel Strips ---
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

            // --- Initialize Vocoder ---
            await this.initVocoderWorklets();

            // --- Initialize Clock ---
            await this.initClock();

            this.isInitialized = true;
            resolve();
        });
        return this.initializationPromise;
    };

    private async initClock() {
        if (!this.audioContext) return;

        // CLEANUP: Ensure no previous clock node is running to prevent double-clocking
        if (this.clockNode) {
            try {
                this.clockNode.port.postMessage({ command: 'stop' });
                this.clockNode.disconnect();
                this.clockNode.port.close();
            } catch (e) {
                console.warn("Error cleaning up old clock node:", e);
            }
            this.clockNode = null;
        }

        try {
            await this.audioContext.audioWorklet.addModule(new URL('./clock-processor.js', import.meta.url));
            this.clockNode = new AudioWorkletNode(this.audioContext, 'clock-processor');

            this.clockNode.port.onmessage = (e: MessageEvent) => {
                if (e.data.time && this.audioContext) {
                    // Correctly convert audio context time to performance time
                    // Get the current relationship between audio context time and performance time
                    const currentPerformanceTime = window.performance.now();
                    const currentAudioTime = this.audioContext.currentTime;

                    // Calculate the performance time that corresponds to the worklet's scheduled time
                    const timeDifference = e.data.time - currentAudioTime;
                    const scheduledPerformanceTime = currentPerformanceTime + (timeDifference * 1000);

                    // Apply minimal compensation for system transport delay
                    const compensatedPerformanceTime = scheduledPerformanceTime + 0.2; // 0.2ms compensation

                    // Ensure we never schedule in the past to maintain timing accuracy
                    const finalPerformanceTime = Math.max(compensatedPerformanceTime, currentPerformanceTime - 1); // Allow 1ms tolerance

                    this.midiService.sendTimingClock(finalPerformanceTime);
                }
            };

            this.clockNode.connect(this.audioContext.destination);
        } catch (error) {
            console.error("Error loading or creating Clock AudioWorklet:", error);
        }
    }

    private async initVocoderWorklets() {
        if (!this.audioContext) return;
        try {
            // Load the unified vocoder processor (formerly new)
            await this.audioContext.audioWorklet.addModule(new URL('./vocoder-processor.js', import.meta.url));
            this.carrierInput = this.audioContext.createGain();

            // Note: The processor is registered as 'vocoder-processor-new' inside the TS file
            this.vocoderWorkletNode = new AudioWorkletNode(this.audioContext, 'vocoder-processor-new', {
                numberOfInputs: 1,
                numberOfOutputs: 1,
                outputChannelCount: [1],
                processorOptions: {
                    sampleRate: this.audioContext.sampleRate
                }
            });

            // Connect carrier input is handled via routing buses directly to carrierInput, 
            // but the new processor design might handle carrier differently or mix internally.
            // Based on previous code, the new processor takes 1 input (modulator) and generates carrier internally 
            // OR mixes. Let's keep the carrierInput setup just in case future expansion needs it, 
            // but the current 'vocoder-processor-new' seems to handle carrier generation internally or via params.

            console.log("Vocoder AudioWorklet initialized successfully.");
        } catch (e) {
            console.error("Error loading or creating vocoder AudioWorklet:", e);
        }
    }

    public setVocoderType(type: VocoderType) {
        // This method is now largely cosmetic as we only have one engine,
        // but we can keep it if we want to switch presets in the future.
        if (type === this.currentVocoderType) return;
        this.currentVocoderType = type;
    }

    private setupEffects = async () => {
        if (!this.audioContext || !this.masterGain) return;

        // Reverb
        this.reverbNode = this.audioContext.createConvolver();
        const reverbGain = this.audioContext.createGain();
        reverbGain.gain.value = 1.5;
        this.reverbNode.connect(reverbGain);
        reverbGain.connect(this.masterGain);
        const impulse = await this.generateImpulseResponse();
        this.reverbNode.buffer = impulse;

        // Delay
        this.delayNode = this.audioContext.createDelay(1.0);
        this.delayFeedback = this.audioContext.createGain();
        this.delayFeedback.gain.value = 0.4;
        this.delayNode.connect(this.delayFeedback);
        this.delayFeedback.connect(this.delayNode);
        this.delayNode.connect(this.masterGain);
        this.delayNode.delayTime.value = 0.375;

        // Flanger
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

        channel.dry.gain.setValueAtTime(volume, now);
        channel.reverbSend.gain.setValueAtTime(params.reverbSend ?? 0, now);
        channel.delaySend.gain.setValueAtTime(params.delaySend ?? 0, now);
        channel.flangerSend.gain.setValueAtTime(params.flangerSend ?? 0, now);

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

        channel.dry.gain.setValueAtTime(params.volume, now);
        channel.reverbSend.gain.setValueAtTime(params.reverbSend, now);
        channel.delaySend.gain.setValueAtTime(params.delaySend, now);
        channel.flangerSend.gain.setValueAtTime(params.flangerSend, now);

        playScheduledBasslineNote(this.audioContext, now, step, prevStep, nextStep, params, channel);
    }

    public stopAllSounds() {
        if (!this.isInitialized || !this.audioContext) return;
        stopBassline(this.audioContext);
    }

    public toggleVocoder = async (enabled: boolean) => {
        await this.ensureAudioInitialized();
        if (!this.vocoderWorkletNode) {
            console.error("Vocoder is not available.");
            alert("Vocoder processor failed to load. Please check the console for errors.");
            return;
        }

        if (enabled) {
            if (this.micStream) return;
            try {
                console.log("Requesting microphone access...");
                const stream = await navigator.mediaDevices.getUserMedia({
                    audio: {
                        echoCancellation: true,
                        noiseSuppression: true,
                        autoGainControl: false,
                        sampleRate: this.audioContext!.sampleRate,
                    }
                });

                this.micStream = stream;
                this.micSource = this.audioContext!.createMediaStreamSource(this.micStream);
                this.micAnalyser = this.audioContext!.createAnalyser();
                this.micAnalyser.fftSize = 256;

                // Connect Mic -> Vocoder -> Master
                this.micSource.connect(this.vocoderWorkletNode);
                this.vocoderWorkletNode.connect(this.masterGain!);

                this.micSource.connect(this.micAnalyser);

                this.vocoderEnabled = true;
                console.log(`Microphone access granted. Vocoder enabled.`);

            } catch (err) {
                console.error('Error accessing microphone:', err);
                alert('Microphone access denied. Please grant permission to use the vocoder.');
                throw err;
            }
        } else {
            if (!this.micStream || !this.micSource) return;

            console.log("Disabling vocoder and disconnecting microphone.");

            this.micSource.disconnect();
            try {
                this.vocoderWorkletNode.disconnect(this.masterGain!);
            } catch (e) { }

            this.micStream.getTracks().forEach(track => track.stop());

            this.micStream = null;
            this.micSource = null;
            this.micAnalyser = null;
            this.vocoderEnabled = false;
            console.log("Vocoder disabled.");
        }
    };

    public updateVocoderParams(params: VocoderParams) {
        if (!this.isInitialized || !this.vocoderWorkletNode || !this.carrierInput || !this.audioContext) return;

        const now = this.audioContext.currentTime;
        const p = this.vocoderWorkletNode.parameters;

        // Apply parameters to the single unified node
        p.get('voiceGain')?.setTargetAtTime(params.voiceGain ?? 30, now, 0.01);
        p.get('noiseGate')?.setTargetAtTime(params.noiseGate ?? 5, now, 0.01);
        p.get('attack')?.setTargetAtTime(params.attack ?? 0.001, now, 0.01);
        p.get('release')?.setTargetAtTime(params.release ?? 0.03, now, 0.01);
        p.get('sibilance')?.setTargetAtTime(params.sibilance ?? 0.2, now, 0.01);
        p.get('dryWet')?.setTargetAtTime(params.mix, now, 0.01);
        p.get('qFactor')?.setTargetAtTime(params.qFactor ?? 20, now, 0.01);
        p.get('carrierFreq')?.setTargetAtTime(params.carrierFreq ?? 110, now, 0.01);

        if (params.carrierWaveform) {
            this.vocoderWorkletNode.port.postMessage({ type: 'SET_CARRIER_WAVEFORM', value: params.carrierWaveform });
        }

        // Legacy carrier routing handling (kept if needed for future external carrier support)
        if (params.carrier !== this.currentCarrierType) {
            if (this.currentCarrierType) {
                if (this.currentCarrierType === 'drums' || this.currentCarrierType === 'both') {
                    try { this.drumBus?.disconnect(this.carrierInput); } catch (e) { }
                }
                if (this.currentCarrierType === 'bass' || this.currentCarrierType === 'both') {
                    try { this.bassBus?.disconnect(this.carrierInput); } catch (e) { }
                }
            }

            switch (params.carrier) {
                case 'drums':
                    this.drumBus?.connect(this.carrierInput);
                    break;
                case 'bass':
                    this.bassBus?.connect(this.carrierInput);
                    break;
                case 'both':
                    this.drumBus?.connect(this.carrierInput);
                    this.bassBus?.connect(this.carrierInput);
                    break;
                case 'synth':
                    break;
            }
            this.currentCarrierType = params.carrier;
        }
    };

    public startMicVisualizer(canvas: HTMLCanvasElement) {
        const canvasCtx = canvas.getContext('2d');
        if (!canvasCtx) return;

        const draw = () => {
            this.visualizerFrameId = requestAnimationFrame(draw);

            if (!this.vocoderEnabled || !this.micAnalyser) {
                canvasCtx.clearRect(0, 0, canvas.width, canvas.height);
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
        };
        draw();
    };

    public stopMicVisualizer() {
        if (this.visualizerFrameId) {
            cancelAnimationFrame(this.visualizerFrameId);
            this.visualizerFrameId = null;
        }
    };

    // --- Sequencing Methods ---

    public setStepCallback(callback: StepCallback) {
        this.stepCallback = callback;
    }

    public setMidiOutput(outputName: string) {
        this.midiService.setMidiOutput(outputName);
    }

    public setPattern(
        instruments: Instrument[],
        basslinePattern: BasslinePattern | null,
        stepsPerSequence: number
    ) {
        this.instruments = instruments;
        this.basslinePattern = basslinePattern;
        if (stepsPerSequence !== this.stepsPerSequence) {
            this.stepsPerSequence = stepsPerSequence;
            this.currentStep = 0;
        }
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

        this.isRunning = true;
        this.tempo = tempo;
        this.swing = swing;
        this.setPattern(instruments, basslinePattern, stepsPerSequence);
        this.currentStep = 0;

        // Calculate start time with proper offset to account for processing delays
        // We schedule the clock slightly in the future to account for message processing time
        const startOffset = 0.025; // 25ms - reduced from 50ms for better precision at high tempos
        const startTime = this.audioContext.currentTime + startOffset;

        // Send MIDI Start synchronized with the audio clock
        // We convert the AudioContext time to Performance time for WebMIDI
        const currentPerformanceTime = window.performance.now();
        const currentAudioTime = this.audioContext.currentTime;
        const timeDifference = startTime - currentAudioTime;
        const startPerformanceTime = currentPerformanceTime + (timeDifference * 1000);

        // Send Start scheduled at the exact same time as the first clock tick
        this.midiService.sendStart(startPerformanceTime);

        if (this.clockNode) {
            this.clockNode.port.postMessage({
                command: 'start',
                value: {
                    tempo: this.tempo,
                    startTime: startTime
                }
            });
        }

        // Align internal audio sequencer with the MIDI clock start time
        this.nextStepTime = startTime;
        this.scheduleNextSteps();
    }

    public stop() {
        this.isRunning = false;
        if (this.lookaheadTimerId !== null) {
            clearTimeout(this.lookaheadTimerId);
            this.lookaheadTimerId = null;
        }

        this.stopAllSounds();
        this.midiService.sendStop();

        if (this.clockNode) {
            this.clockNode.port.postMessage({ command: 'stop' });
        }

        this.currentStep = 0;
        this.nextStepTime = 0.0;
    }

    public updateTempo(newTempo: number) {
        this.tempo = newTempo;
        if (this.clockNode && this.isRunning) {
            this.clockNode.port.postMessage({ command: 'updateTempo', value: newTempo });
        }
    }

    public updateSwing(newSwing: number) {
        this.swing = newSwing;
    }

    private scheduleNextSteps() {
        if (!this.isRunning || !this.audioContext) return;

        const stepDuration = 60.0 / this.tempo / 4.0;
        const currentPlayTime = this.audioContext.currentTime;

        while (this.nextStepTime < currentPlayTime + this.scheduleAheadTime) {
            this.playStepAtTime(this.currentStep, this.nextStepTime);

            let currentStepDuration = stepDuration;
            if (this.swing > 0) {
                const swingAmount = Math.pow(this.swing / 100, 2) * 0.5;
                if (this.currentStep % 2 !== 0) {
                    currentStepDuration = stepDuration * (1 + swingAmount);
                } else {
                    currentStepDuration = Math.max(0.001, stepDuration * (1 - swingAmount));
                }
            }

            this.nextStepTime += currentStepDuration;
            this.currentStep = (this.currentStep + 1) % this.stepsPerSequence;
        }

        this.lookaheadTimerId = window.setTimeout(() => this.scheduleNextSteps(), this.lookaheadPeriod);
    }

    private playStepAtTime(step: number, time: number) {
        if (!this.audioContext) return;

        const callbackTime = time - this.audioContext.currentTime;
        if (callbackTime <= 0) {
            if (this.stepCallback && this.isRunning) {
                this.stepCallback(step);
            }
        } else {
            setTimeout(() => {
                if (this.stepCallback && this.isRunning) {
                    this.stepCallback(step);
                }
            }, callbackTime * 1000);
        }

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

    public getCurrentStep(): number | null {
        return this.isRunning ? this.currentStep : null;
    }

    public destroy() {
        this.stop();
        if (this.clockNode) {
            try {
                this.clockNode.port.postMessage({ command: 'stop' });
                this.clockNode.disconnect();
                this.clockNode.port.close();
            } catch (e) { }
            this.clockNode = null;
        }
        // Close MIDI connections if possible (needs MidiService support)
    }
}

// Singleton management for HMR
declare global {
    var __AUDIO_ENGINE__: AudioEngine | undefined;
}

if (import.meta.hot) {
    if (globalThis.__AUDIO_ENGINE__) {
        console.log("♻️ HMR: Destroying previous AudioEngine instance to prevent resource leaks.");
        globalThis.__AUDIO_ENGINE__.destroy();
    }
}

export const audioEngine = new AudioEngine();

if (import.meta.hot) {
    globalThis.__AUDIO_ENGINE__ = audioEngine;
}