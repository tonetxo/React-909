import { Velocity, InstrumentParams, BasslineStep, BasslineParams, VocoderParams, VocoderCarrier, Waveform } from '../types';

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

// --- Vocoder (Current) ---
let micInput: GainNode;        // Input from microphone
let dryOutput: GainNode;       // Direct microphone output
let vocoderInput: GainNode;    // Input to vocoder processor
let vocoderOutput: GainNode;   // Output from vocoder processor
let carrierInput: GainNode;
let currentCarrierType: VocoderCarrier | null = null;
let vocoderEnabled: boolean = false;
let micStream: MediaStream | null = null;
let micSource: MediaStreamAudioSourceNode | null = null;
let micAnalyser: AnalyserNode | null = null;
let micCompressor: DynamicsCompressorNode | null = null; // Added missing declaration
let dcBlocker: BiquadFilterNode | null = null; // Added missing declaration
let visualizerFrameId: number;
let mixControl: GainNode;      // Mix control between dry and wet signals
let vocoderWorkletNode: AudioWorkletNode; // Declare AudioWorkletNode

// --- New Vocoder Variables ---
let newVocoderEnabled: boolean = false;
let newVocoderOscillator: OscillatorNode | null = null;
let newVocoderOscillatorType: Waveform = 'sawtooth';
let newVocoderOscillatorFrequency: number = 110;
let newVocoderQFactor: number = 10;
let newVocoderVoiceGain: number = 30;
let newVocoderAttack: number = 0.01;
let newVocoderRelease: number = 0.05;
let newVocoderNoiseGate: number = 5;
let newVocoderDryWet: number = 1.0;
let newVocoderModulatorFilters: BiquadFilterNode[] = [];
let newVocoderCarrierFilters: BiquadFilterNode[] = [];
let newVocoderModulatorAnalysers: AnalyserNode[] = [];
let newVocoderCarrierGains: GainNode[] = [];
let newVocoderLastGainValues: number[] = [];
let newVocoderModulatorHPF: BiquadFilterNode | null = null;
let newVocoderCarrierDelay: DelayNode | null = null;
let newVocoderDryGain: GainNode | null = null;
let newVocoderWetGain: GainNode | null = null;
let newVocoderAnimationId: number | null = null;
let newVocoderTimeDomainData: Uint8Array | null = null;
let newVocoderVisualizerAnalyser: AnalyserNode | null = null;

// Constants for new vocoder
const FFT_SIZE = 1024;
const NUM_NEW_BANDS = 20;
const MIN_NEW_FREQ = 80;
const MAX_NEW_FREQ = 12000;
const LOOKAHEAD_DELAY_S = 0.02; // 20ms

// Calculate band frequencies for new vocoder
const NEW_BAND_FREQUENCIES = (() => {
    const factor = Math.pow(MAX_NEW_FREQ / MIN_NEW_FREQ, 1 / (NUM_NEW_BANDS - 1));
    return Array.from({ length: NUM_NEW_BANDS }, (_, i) => Math.round(MIN_NEW_FREQ * Math.pow(factor, i)));
})();


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
    // Only initialize vocoder if basic audio is ready and vocoder isn't already being initialized
    if (!audioContext || !masterGain || !drumBus || !bassBus) {
        // Basic audio not ready, initialize it first
        initBasicAudio();
    }
    
    // Load vocoder AudioWorklet module (this can happen in the background)
    audioContext.audioWorklet.addModule('services/vocoder-processor.js')
        .then(() => {
            // Create vocoder
            createVocoder(audioContext);
            
            // Update vocoder params with default settings after initialization
            updateVocoderParams({
                enabled: false,
                carrier: 'drums',
                mix: 0.5,
                bands: 16,
                formantShift: 0,
                synthPitch: 48,
            });
            
            console.log("Vocoder initialized successfully");
        })
        .catch(e => {
            console.error("Error loading vocoder AudioWorklet:", e);
            // vocoder won't be available, but rest of app should work
        });
};


const createVocoder = (context: AudioContext) => { // numBands is now handled by worklet
    // Inputs and outputs for proper mix control
    micInput = context.createGain();          // Input from microphone
    dryOutput = context.createGain();         // Direct microphone output
    carrierInput = context.createGain();      // Input to vocoder processor
    
    // Add a simple compressor to control dynamics in the vocoder output
    const vocoderCompressor = context.createDynamicsCompressor();
    vocoderCompressor.threshold.value = -10;   // Gentler threshold
    vocoderCompressor.ratio.value = 2;        // Gentler ratio
    vocoderCompressor.attack.value = 0.001;   // Faster attack
    vocoderCompressor.release.value = 0.01;   // Faster release
    
    // Mix control node to blend dry and wet signals
    mixControl = context.createGain();
    
    // Create a DC blocker to prevent any DC offset that might cause issues
    dcBlocker = context.createBiquadFilter();
    dcBlocker.type = 'highpass';
    dcBlocker.frequency.value = 80; // Higher DC block frequency to prevent rumble
    dcBlocker.Q.value = 0.707;
    
    // Connect mic input to dry output
    micInput.connect(dryOutput);              // Direct path for dry signal

    // Instantiate AudioWorkletNode with optimized buffer size for low latency
    vocoderWorkletNode = new AudioWorkletNode(context, 'vocoder-processor', {
        numberOfInputs: 2, // Modulator, Carrier
        numberOfOutputs: 1,
        outputChannelCount: [2], // Stereo output
        processorOptions: {
            sampleRate: context.sampleRate,
        }
    });

    // Connect inputs to AudioWorkletNode
    micInput.connect(dcBlocker);              // Connect mic to DC blocker first
    dcBlocker.connect(vocoderWorkletNode, 0, 0); // Connect DC blocker to modulator input (input 0)
    carrierInput.connect(vocoderWorkletNode, 0, 1); // Connect carrier to carrier input (input 1)

    // Connect AudioWorkletNode output to compressor and then to mix control
    vocoderWorkletNode.connect(vocoderCompressor);
    vocoderCompressor.connect(mixControl);           // Connect compressor to mix control
    
    // Connect dry signal to mix control
    dryOutput.connect(mixControl);            // Dry signal to mix

    // Don't connect to master yet - toggleVocoder will handle connections
    mixControl.gain.value = 1.0;  // Set to pass through when connected
};


// Promise to track initialization completion
let initializationPromise: Promise<void> | null = null;

// Async version to wait for full initialization
export const getAudioContextAsync = async (): Promise<AudioContext> => {
  if (!isInitialized) {
    if (!initializationPromise) {
      initializationPromise = new Promise((resolve) => {
        initAudio();
        // Wait for initialization to complete
        const checkInitialized = () => {
          if (isInitialized) {
            resolve();
          } else {
            setTimeout(checkInitialized, 10);
          }
        };
        checkInitialized();
      });
    }
    await initializationPromise;
  }
  return audioContext;
};

// Initialize basic audio system without vocoder
const initBasicAudio = (): AudioContext => {
  if (audioContext) {
    return audioContext; // Already initialized
  }
  
  audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
    latencyHint: 'interactive',
  });
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

  // Mark basic initialization as complete
  isInitialized = true;
  
  return audioContext;
};

const getAudioContext = (): AudioContext => {
  if (!audioContext) {
    initBasicAudio();
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
    
    // Ensure basic audio context is available
    getAudioContext(); // This will initialize basic audio if needed
    
    // Wait for vocoder to be properly initialized only if needed
    if (enabled && !vocoderWorkletNode) {
        console.log("Waiting for vocoder to initialize...");
        // Wait a moment for initialization to complete
        await new Promise(resolve => setTimeout(resolve, 300));
        if (!vocoderWorkletNode) {
            console.error("Vocoder not properly initialized");
            // Allow to continue even if vocoder is not ready, just won't work
            return; // Exit if vocoder is required but not available
        }
    }
    
    if (enabled) {
        if (!micStream) {
            try {
                console.log("Requesting microphone access...");
                // Enable audio processing options to reduce feedback
                micStream = await navigator.mediaDevices.getUserMedia({ 
                    audio: { 
                        echoCancellation: true, 
                        noiseSuppression: true, 
                        autoGainControl: true,
                        // Try to get the best audio quality possible
                        sampleRate: audioContext.sampleRate,
                        channelCount: 2
                    } 
                });
                micSource = audioContext.createMediaStreamSource(micStream);
                
                // Create mic analyser for visualization
                micAnalyser = audioContext.createAnalyser();
                micAnalyser.fftSize = 256;
                
                // Create mic compressor to prevent clipping
                if (!micCompressor) {
                    micCompressor = audioContext.createDynamicsCompressor();
                    micCompressor.threshold.value = -12; // Higher threshold to prevent over-compression
                    micCompressor.ratio.value = 3;      // Lower ratio
                    micCompressor.attack.value = 0.003;  // Balanced attack
                    micCompressor.release.value = 0.025; // Balanced release
                }
                
                // Create DC blocker to prevent DC offset
                if (!dcBlocker) {
                    dcBlocker = audioContext.createBiquadFilter();
                    dcBlocker.type = 'highpass';
                    dcBlocker.frequency.value = 80;  // Higher frequency to remove rumble
                    dcBlocker.Q.value = 0.5;         // Lower Q for smoother response
                }
                
                // Connect microphone source: micSource -> micCompressor -> micInput and micAnalyser
                micSource.connect(micCompressor);
                micCompressor.connect(micInput);
                micSource.connect(micAnalyser);  // Connect to analyser for visualization (parallel)
                
                // Set initial gain for microphone input
                micInput.gain.value = 0.8;  // Prevent overloading
                
                // Connect vocoder output to master when enabled
                if (!mixControl.numberOfOutputs > 0) { // Only connect if not already connected
                    try {
                        mixControl.connect(masterGain);
                    } catch (e) {
                        // Already connected, ignore error
                    }
                }
                
                vocoderEnabled = true;
                console.log("Microphone access granted. Vocoder microphone enabled and connected.");
            } catch (err) {
                console.error('Error accessing microphone:', err);
                alert('Microphone access denied or an error occurred. Please ensure your microphone is connected and permissions are granted.');
                return;
            }
        } else {
            console.log("Microphone already connected");
            // Connect vocoder output to master when enabled (in case it was disconnected)
            try {
                mixControl.connect(masterGain);
            } catch (e) {
                // Already connected, ignore error
            }
            vocoderEnabled = true;
        }
    } else {
        if (micStream) {
            console.log("Stopping microphone stream and disconnecting nodes.");
            
            // Disconnect nodes in the correct order, checking if nodes exist and are connected
            try {
                // Disconnect the mic source from all destinations
                if (micSource) {
                    micSource.disconnect();
                }
                if (micCompressor) {
                    micCompressor.disconnect();
                }
                if (micInput) {
                    micInput.disconnect();
                }
                if (micAnalyser) {
                    micAnalyser.disconnect();
                }
                
                // Disconnect vocoder output from master when disabled
                try {
                    mixControl.disconnect(masterGain);
                } catch (e) {
                    // Not connected, ignore error
                }
                
                // Stop all tracks in the stream
                micStream.getTracks().forEach(track => track.stop());
                
            } catch (e) {
                console.warn("Error disconnecting nodes:", e);
            }
            
            micStream = null;
            micSource = null;
            micAnalyser = null;
        } else {
            console.log("Microphone stream not active, no disconnection needed.");
            // Still disconnect vocoder output from master when disabled
            try {
                mixControl.disconnect(masterGain);
            } catch (e) {
                // Not connected, ignore error
            }
        }
        vocoderEnabled = false;
        console.log("Vocoder disabled and microphone disconnected.");
    }
};

export const updateVocoderParams = (params: VocoderParams) => {
    if (!isInitialized || !audioContext || !vocoderWorkletNode) return;
    const now = audioContext.currentTime;

    // Send parameters to AudioWorkletNode
    vocoderWorkletNode.port.postMessage({
        type: 'updateParams',
        payload: {
            mix: params.mix,
            formantShift: params.formantShift,
            synthPitch: params.synthPitch,
            carrier: params.carrier,
        }
    });

    // Update mix control: balance between direct mic signal and vocoded signal
    if (params.enabled && micStream) {
        // When enabled, allow the mix to be controlled by the AudioWorklet
        mixControl.gain.setTargetAtTime(1.0, now, 0.01); // Keep full signal path open when vocoder is active
    } else {
        // When disabled, don't completely mute - just reduce level significantly
        // This ensures that if the vocoder output is connected to master, there's still some signal
        mixControl.gain.setTargetAtTime(0.001, now, 0.01); // Very low gain instead of complete mute
    }

    // Handle carrier type changes (connections to carrierInput)
    // This logic remains here as carrierInput is an AudioNode outside the worklet
    if (params.carrier !== currentCarrierType) {
        // Disconnect the old carrier(s) if they exist
        if (currentCarrierType === 'drums' || currentCarrierType === 'both') {
            const drumIds = ['kick', 'snare', 'clap', 'low_tom', 'mid_tom', 'hi_tom', 'hihat', 'openhat'];
            drumIds.forEach(id => {
                const channel = channelStrips.get(id);
                if (channel && carrierInput) {
                    try {
                        channel.dry.disconnect(carrierInput);
                    } catch (e) { /* Ignore if not connected */ }
                }
            });
        }
        if (currentCarrierType === 'bass' || currentCarrierType === 'both') {
            const bassChannel = channelStrips.get('bassline');
            if (bassChannel && carrierInput) {
                try {
                    bassChannel.dry.disconnect(carrierInput);
                } catch (e) { /* Ignore if not connected */ }
            }
        }
        // The internal synth is now managed within the AudioWorkletProcessor,
        // so we don't connect/disconnect internalSynthGain here.

        // Connect the new carrier
        switch (params.carrier) {
            case 'drums': {
                const drumIds = ['kick', 'snare', 'clap', 'low_tom', 'mid_tom', 'hi_tom', 'hihat', 'openhat'];
                drumIds.forEach(id => {
                    const channel = channelStrips.get(id);
                    if (channel && carrierInput) {
                        try {
                            channel.dry.connect(carrierInput);
                        } catch (e) { console.warn(`Could not connect drum channel ${id} to vocoder carrier input:`, e); }
                    }
                });
                break;
            }
            case 'bass': {
                const bassChannel = channelStrips.get('bassline');
                if (bassChannel && carrierInput) {
                    try {
                        bassChannel.dry.connect(carrierInput);
                        console.log("Connected bass to vocoder carrier input");
                    } catch (e) { console.warn('Could not connect bass channel to vocoder carrier input:', e); }
                }
                break;
            }
            case 'both': {
                const drumIds = ['kick', 'snare', 'clap', 'low_tom', 'mid_tom', 'hi_tom', 'hihat', 'openhat'];
                drumIds.forEach(id => {
                    const channel = channelStrips.get(id);
                    if (channel && carrierInput) {
                        try {
                            channel.dry.connect(carrierInput);
                        } catch (e) { console.warn(`Could not connect drum channel ${id} to vocoder carrier input:`, e); }
                    }
                });
                const bassChannel = channelStrips.get('bassline');
                if (bassChannel && carrierInput) {
                    try {
                        bassChannel.dry.connect(carrierInput);
                    } catch (e) { console.warn('Could not connect bass channel to vocoder carrier input:', e); }
                }
                break;
            }
            case 'synth':
                // Internal synth is handled within the AudioWorkletProcessor
                break;
        }
        currentCarrierType = params.carrier;
    }
    // The internal synth gain and pitch are now controlled via postMessage to the worklet.
    // The formant shift is also controlled via postMessage.
};

export const startMicVisualizer = (canvas: HTMLCanvasElement) => {
    const canvasCtx = canvas.getContext('2d');
    if (!canvasCtx) return;

    const draw = () => {
        // Try to use the analyser from the active vocoder
        let analyser: AnalyserNode | null = null;
        
        if (vocoderEnabled && micAnalyser) {
            // If original vocoder is active, use its analyser
            analyser = micAnalyser;
        } else if (newVocoderEnabled && newVocoderVisualizerAnalyser) {
            // If new vocoder is active, use its analyser
            analyser = newVocoderVisualizerAnalyser;
        } else if (micAnalyser) {
            // Fallback to original analyser if available
            analyser = micAnalyser;
        }

        if (!analyser) {
            canvasCtx.clearRect(0, 0, canvas.width, canvas.height);
            visualizerFrameId = requestAnimationFrame(draw);
            return;
        }
        
        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        analyser.getByteTimeDomainData(dataArray);

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

// --- Shared Microphone Management ---
let currentVocoderType: 'original' | 'new' | null = null;

// Toggle between vocoders properly
export const switchToVocoder = async (targetVocoderType: 'original' | 'new') => {
    if (currentVocoderType === targetVocoderType) {
        // Already using this vocoder, just return
        return;
    }
    
    // If we're switching from one to another, stop the current one first
    if (currentVocoderType === 'original') {
        await toggleVocoder(false);
    } else if (currentVocoderType === 'new') {
        await toggleNewVocoder(false);
    }
    
    // Now start the target vocoder
    if (targetVocoderType === 'original') {
        await toggleVocoder(true);
    } else {
        await toggleNewVocoder(true);
    }
    
    currentVocoderType = targetVocoderType;
};

// --- New Vocoder Implementation ---
export const toggleNewVocoder = async (enabled: boolean) => {
    if (!audioContext) {
        getAudioContext(); // Initialize basic audio context
    }

    if (enabled) {
        if (!micStream) {
            try {
                console.log("Requesting microphone access for new vocoder...");
                micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });

                // --- CARRIER (SYNTH) PATH ---
                newVocoderOscillator = audioContext.createOscillator();
                newVocoderOscillator.type = newVocoderOscillatorType;
                newVocoderOscillator.frequency.setValueAtTime(newVocoderOscillatorFrequency, audioContext.currentTime);
                
                // Lookahead delay for the carrier signal
                newVocoderCarrierDelay = audioContext.createDelay(0.1); // Max 100ms delay
                newVocoderCarrierDelay.delayTime.setValueAtTime(LOOKAHEAD_DELAY_S, audioContext.currentTime);
                newVocoderOscillator.connect(newVocoderCarrierDelay);

                // --- MODULATOR (VOICE) PATH ---
                micSource = audioContext.createMediaStreamSource(micStream);
                
                newVocoderModulatorHPF = audioContext.createBiquadFilter();
                newVocoderModulatorHPF.type = 'highpass';
                newVocoderModulatorHPF.frequency.setValueAtTime(100, audioContext.currentTime);
                micSource.connect(newVocoderModulatorHPF);

                // --- MIXER & OUTPUT ---
                newVocoderDryGain = audioContext.createGain();
                newVocoderWetGain = audioContext.createGain(); // This will be the master gain for all vocoder bands
                
                // Set initial mix levels
                newVocoderDryGain.gain.value = 1 - newVocoderDryWet;
                newVocoderWetGain.gain.value = newVocoderDryWet;

                newVocoderVisualizerAnalyser = audioContext.createAnalyser();
                newVocoderVisualizerAnalyser.fftSize = FFT_SIZE;
                
                newVocoderDryGain.connect(newVocoderVisualizerAnalyser);
                newVocoderWetGain.connect(newVocoderVisualizerAnalyser);
                newVocoderVisualizerAnalyser.connect(audioContext.destination);

                // --- VOCODER BAND CREATION ---
                newVocoderModulatorFilters = [];
                newVocoderCarrierFilters = [];
                newVocoderModulatorAnalysers = [];
                newVocoderCarrierGains = [];
                
                NEW_BAND_FREQUENCIES.forEach((freq) => {
                    // Modulator path for this band
                    const modulatorFilter = audioContext.createBiquadFilter();
                    modulatorFilter.type = 'bandpass';
                    modulatorFilter.frequency.value = freq;
                    modulatorFilter.Q.value = newVocoderQFactor;
                    newVocoderModulatorHPF!.connect(modulatorFilter);
                    newVocoderModulatorFilters.push(modulatorFilter);

                    const modulatorAnalyser = audioContext.createAnalyser();
                    modulatorAnalyser.fftSize = 256;
                    modulatorFilter.connect(modulatorAnalyser);
                    newVocoderModulatorAnalysers.push(modulatorAnalyser);

                    // Carrier path for this band
                    const carrierFilter = audioContext.createBiquadFilter();
                    carrierFilter.type = 'bandpass';
                    carrierFilter.frequency.value = freq;
                    carrierFilter.Q.value = newVocoderQFactor;
                    newVocoderCarrierDelay!.connect(carrierFilter); // Connect from delayed carrier
                    
                    const carrierGain = audioContext.createGain();
                    carrierGain.gain.value = 0.0;
                    carrierFilter.connect(carrierGain);
                    carrierGain.connect(newVocoderWetGain!); // Connect to the wet gain node
                    newVocoderCarrierGains.push(carrierGain);
                });

                newVocoderLastGainValues = new Array(NUM_NEW_BANDS).fill(0);
                newVocoderTimeDomainData = new Uint8Array(256);

                newVocoderOscillator.start();
                newVocoderEnabled = true;
                
                // Start animation frame for processing
                animateNewVocoder();

                console.log("New vocoder started successfully");
            } catch (err) {
                console.error('Error accessing microphone for new vocoder:', err);
                alert('Could not access the microphone. Please check permissions and try again.');
                return;
            }
        } else {
            // Microphone already active, just enable new vocoder
            // Make sure we're not conflicting with original vocoder
            if (vocoderEnabled) {
                // We need to stop original vocoder first
                if (micSource && mixControl) {
                    // Disconnect original vocoder from mic source
                    try {
                        micSource.disconnect(micCompressor);
                    } catch (e) {
                        // May not be connected, ignore
                    }
                }
            }
            newVocoderEnabled = true;
            
            // Start animation frame for processing if not already running
            if (!newVocoderAnimationId) {
                animateNewVocoder();
            }
        }
    } else {
        // Stop the new vocoder
        if (newVocoderAnimationId) {
            cancelAnimationFrame(newVocoderAnimationId);
            newVocoderAnimationId = null;
        }

        if (newVocoderOscillator) {
            newVocoderOscillator.stop();
            newVocoderOscillator.disconnect();
            newVocoderOscillator = null;
        }

        if (newVocoderModulatorHPF) {
            newVocoderModulatorHPF.disconnect();
            newVocoderModulatorHPF = null;
        }

        // Don't stop micStream here if original vocoder is active
        if (micStream && !vocoderEnabled) {
            micStream.getTracks().forEach(track => track.stop());
            micStream = null;
            micSource = null;
        }

        // Disconnect and clear all arrays
        newVocoderModulatorFilters.forEach(filter => filter.disconnect());
        newVocoderCarrierFilters.forEach(filter => filter.disconnect());
        newVocoderModulatorAnalysers.forEach(analyser => analyser.disconnect());
        newVocoderCarrierGains.forEach(gain => gain.disconnect());

        newVocoderModulatorFilters = [];
        newVocoderCarrierFilters = [];
        newVocoderModulatorAnalysers = [];
        newVocoderCarrierGains = [];

        newVocoderEnabled = false;
        console.log("New vocoder stopped");
    }
};

const animateNewVocoder = () => {
    if (!audioContext || !newVocoderTimeDomainData || !newVocoderEnabled) return;
    
    const analysers = newVocoderModulatorAnalysers;
    const gains = newVocoderCarrierGains;
    const timeDomainData = newVocoderTimeDomainData;
    const currentTime = audioContext.currentTime;

    analysers.forEach((analyser, i) => {
        analyser.getByteTimeDomainData(timeDomainData);
        
        let sumSquares = 0.0;
        for (let j = 0; j < timeDomainData.length; j++) {
            const floatSample = (timeDomainData[j] / 128.0) - 1.0;
            sumSquares += floatSample * floatSample;
        }
        let rms = Math.sqrt(sumSquares / timeDomainData.length);
        
        const gateThreshold = newVocoderNoiseGate / 500.0;
        if (rms < gateThreshold) {
            rms = 0;
        }

        const gainValue = Math.min(rms * newVocoderVoiceGain, 1.5);
        
        const gainNode = gains[i];
        const lastGain = newVocoderLastGainValues[i] || 0;
        const timeConstant = gainValue > lastGain ? newVocoderAttack : newVocoderRelease;

        gainNode.gain.setTargetAtTime(gainValue, currentTime, timeConstant + 0.001); // Add small offset to prevent 0
        newVocoderLastGainValues[i] = gainValue;
    });

    // Continue animation loop
    newVocoderAnimationId = requestAnimationFrame(animateNewVocoder);
};

// Update new vocoder parameters
export const updateNewVocoderParams = (params: {
    carrierType?: Waveform;
    carrierFreq?: number;
    qFactor?: number;
    voiceGain?: number;
    attack?: number;
    release?: number;
    noiseGate?: number;
    dryWet?: number;
}) => {
    if (!audioContext) return;

    if (params.carrierType !== undefined) {
        newVocoderOscillatorType = params.carrierType;
        if (newVocoderOscillator) {
            newVocoderOscillator.type = params.carrierType;
        }
    }
    
    if (params.carrierFreq !== undefined) {
        newVocoderOscillatorFrequency = params.carrierFreq;
        if (newVocoderOscillator && audioContext) {
            newVocoderOscillator.frequency.setTargetAtTime(params.carrierFreq, audioContext.currentTime, 0.01);
        }
    }
    
    if (params.qFactor !== undefined) {
        newVocoderQFactor = params.qFactor;
        if (audioContext) {
            const currentTime = audioContext.currentTime;
            newVocoderModulatorFilters.forEach(filter => filter.Q.setTargetAtTime(params.qFactor!, currentTime, 0.01));
            newVocoderCarrierFilters.forEach(filter => filter.Q.setTargetAtTime(params.qFactor!, currentTime, 0.01));
        }
    }
    
    if (params.dryWet !== undefined) {
        newVocoderDryWet = params.dryWet;
        if (newVocoderDryGain && newVocoderWetGain && audioContext) {
            const currentTime = audioContext.currentTime;
            newVocoderDryGain.gain.setTargetAtTime(1 - params.dryWet, currentTime, 0.01);
            newVocoderWetGain.gain.setTargetAtTime(params.dryWet, currentTime, 0.01);
        }
    }
    
    // Update other params
    if (params.voiceGain !== undefined) newVocoderVoiceGain = params.voiceGain;
    if (params.attack !== undefined) newVocoderAttack = params.attack;
    if (params.release !== undefined) newVocoderRelease = params.release;
    if (params.noiseGate !== undefined) newVocoderNoiseGate = params.noiseGate;
};
