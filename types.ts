export type Velocity = 0 | 1 | 2 | 3 | 4 | 5;

export type Waveform = 'sine' | 'square' | 'sawtooth' | 'triangle';

export interface ParamDefinition {
  label: string;
  min: number;
  max: number;
  step: number;
}

export interface InstrumentParams {
  // Common
  decay?: number;
  pitch?: number;
  // BD
  punch?: number;
  // Snare
  snappy?: number;
  // Hi-hat
  metal?: number;
  // Clap
  spread?: number;
  // Reverb/Delay sends
  reverbSend?: number;
  delaySend?: number;
  flangerSend?: number;
}

export interface Instrument {
  id: string;
  name: string;
  sequence: number[];
  volume: number;
  isMuted: boolean;
  isSolo: boolean;
  params: InstrumentParams;
  paramDefinitions: {
    [key in keyof InstrumentParams]: ParamDefinition;
  };
}

export interface BasslineStep {
  note: number | null; // MIDI note number
  velocity: Velocity;
  slide: boolean;
}

export interface BasslineParams {
  waveform: Waveform;
  cutoff: number;
  resonance: number;
  envelopeAmount: number;
  decay: number;
  accent: number;
  volume: number;
  reverbSend: number;
  delaySend: number;
  flangerSend: number;
}

export interface BasslinePattern {
  sequence: BasslineStep[];
  params: BasslineParams;
}

export interface Pattern {
  tempo: number;
  swing: number;
  instruments: Instrument[];
  bassline: BasslinePattern | null;
}

export type VocoderCarrier = 'drums' | 'bass' | 'both' | 'synth';

export type VocoderType = 'original' | 'new';

export interface VocoderParams {
  enabled: boolean;
  carrier: VocoderCarrier;
  mix: number; // 0 (dry) to 1 (wet)
  bands: number; // e.g. 8, 16, 32
  formantShift: number; // e.g. from -1 to 1 octave
  synthPitch: number; // MIDI note for internal synth

  // New vocoder params
  voiceGain?: number;
  noiseGate?: number;
  attack?: number;
  release?: number;
  sibilance?: number;
  dryWet?: number;
  qFactor?: number;
  carrierFreq?: number;
  carrierWaveform?: Waveform;
}

export interface ProjectData {
  patterns: (Pattern | null)[];
  song: {
    sequence: (number | null)[];
    isLooping: boolean;
  };
}
