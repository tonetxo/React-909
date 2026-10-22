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
  sequence: Velocity[];
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
  tie: boolean;
}

export interface BasslineParams {
  enabled: boolean;
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

export type TimeSignature = [number, number]; // [beats, beatType]

export interface Pattern {
  tempo: number;
  swing: number;
  timeSignature: TimeSignature;
  instruments: Instrument[];
  bassline: BasslinePattern | null;
}

export type VocoderCarrier = 'drums' | 'bass' | 'both' | 'synth';

export interface VocoderParams {
  enabled: boolean;
  carrier: VocoderCarrier;
  mix: number; // 0 (dry) to 1 (wet)
  formantShift: number; // semitones, -12 to 12
  synthPitch: number; // MIDI note for internal synth
  voiceGain: number;
  noiseGate: number;
  attack: number; // seconds
  release: number; // seconds
  sibilance: number;
  qFactor: number;
  carrierWaveform: Waveform; // internal synth carrier
  keyGate: boolean; // synth carrier only sounds while a note key is held
  poly: boolean; // synth carrier plays up to MAX_SYNTH_VOICES held notes (otherwise the last one)
  glide: number; // seconds for the Mono synth to slide to a new note (0 = jump)
}

export interface ProjectData {
  patterns: (Pattern | null)[];
  song: {
    sequence: (number | null)[];
    isLooping: boolean;
  };
}
