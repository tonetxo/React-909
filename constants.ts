import { Instrument, Velocity, BasslinePattern, ParamDefinition, VocoderParams, Waveform } from './types';

export const WAVEFORMS: Waveform[] = ['sawtooth', 'square', 'sine', 'triangle'];
export const WAVEFORM_LABELS: Record<Waveform, string> = { sawtooth: 'SAW', square: 'SQR', sine: 'SIN', triangle: 'TRI' };

export const INITIAL_TEMPO = 120;
export const INITIAL_SWING = 0;

export const DRUM_VELOCITY_COLORS = [
  'bg-yellow-200 border-yellow-100', // 1 (Pale Yellow)
  'bg-yellow-400 border-yellow-300', // 2
  'bg-orange-400 border-orange-300', // 3
  'bg-red-500 border-red-400',       // 4
  'bg-red-600 border-red-500',       // 5 (Red)
];

export const BASSLINE_VELOCITY_COLORS = [
  'bg-sky-200/80 border-sky-100',    // 1 (Light Sky Blue)
  'bg-sky-400/80 border-sky-300',    // 2
  'bg-sky-600/80 border-sky-500',    // 3
  'bg-blue-600/80 border-blue-500',  // 4
  'bg-blue-800/80 border-blue-700',  // 5 (Dark Cobalt Blue)
];

export const BASSLINE_MIDI_MIN = 24; // C1
export const BASSLINE_MIDI_MAX = 47; // B2

export const BASSLINE_NOTES = [
  { note: 47, name: 'B2', isBlack: false }, { note: 46, name: 'A#2', isBlack: true },
  { note: 45, name: 'A2', isBlack: false }, { note: 44, name: 'G#2', isBlack: true },
  { note: 43, name: 'G2', isBlack: false }, { note: 42, name: 'F#2', isBlack: true },
  { note: 41, name: 'F2', isBlack: false }, { note: 40, name: 'E2', isBlack: false },
  { note: 39, name: 'D#2', isBlack: true }, { note: 38, name: 'D2', isBlack: false },
  { note: 37, name: 'C#2', isBlack: true }, { note: 36, name: 'C2', isBlack: false },
  { note: 35, name: 'B1', isBlack: false }, { note: 34, name: 'A#1', isBlack: true },
  { note: 33, name: 'A1', isBlack: false }, { note: 32, name: 'G#1', isBlack: true },
  { note: 31, name: 'G1', isBlack: false }, { note: 30, name: 'F#1', isBlack: true },
  { note: 29, name: 'F1', isBlack: false }, { note: 28, name: 'E1', isBlack: false },
  { note: 27, name: 'D#1', isBlack: true }, { note: 26, name: 'D1', isBlack: false },
  { note: 25, name: 'C#1', isBlack: true }, { note: 24, name: 'C1', isBlack: false },
];

export const VOLUME_PARAM_DEFINITION: ParamDefinition = {
  label: 'Volume',
  min: 0,
  max: 1,
  step: 0.01,
};

const defaultSequence = (steps: number) => Array(steps).fill(0 as Velocity);

export const getInitialInstruments = (steps: number): Instrument[] => [
  {
    id: 'kick',
    name: 'Kick Drum',
    sequence: defaultSequence(steps),
    volume: 1,
    isMuted: false,
    isSolo: false,
    params: {
      pitch: 50,
      decay: 0.5,
      punch: 0,
      reverbSend: 0,
      delaySend: 0,
      flangerSend: 0,
    },
    paramDefinitions: {
      pitch: { label: 'Pitch', min: 20, max: 100, step: 0.1 },
      decay: { label: 'Decay', min: 0.1, max: 1, step: 0.01 },
      punch: { label: 'Punch', min: 0, max: 1, step: 0.01 },
      reverbSend: { label: 'Reverb', min: 0, max: 1, step: 0.01 },
      delaySend: { label: 'Delay', min: 0, max: 1, step: 0.01 },
      flangerSend: { label: 'Flanger', min: 0, max: 1, step: 0.01 },
    },
  },
  {
    id: 'snare',
    name: 'Snare Drum',
    sequence: defaultSequence(steps),
    volume: 0.6,
    isMuted: false,
    isSolo: false,
    params: {
      pitch: 180,
      decay: 0.2,
      snappy: 0.5,
      reverbSend: 0,
      delaySend: 0,
      flangerSend: 0,
    },
    paramDefinitions: {
      pitch: { label: 'Pitch', min: 80, max: 300, step: 1 },
      decay: { label: 'Decay', min: 0.1, max: 0.5, step: 0.01 },
      snappy: { label: 'Snappy', min: 0, max: 1, step: 0.01 },
      reverbSend: { label: 'Reverb', min: 0, max: 1, step: 0.01 },
      delaySend: { label: 'Delay', min: 0, max: 1, step: 0.01 },
      flangerSend: { label: 'Flanger', min: 0, max: 1, step: 0.01 },
    },
  },
  {
    id: 'clap',
    name: 'Clap',
    sequence: defaultSequence(steps),
    volume: 0.5,
    isMuted: false,
    isSolo: false,
    params: {
      decay: 0.15,
      spread: 0.8,
      reverbSend: 0,
      delaySend: 0,
      flangerSend: 0,
    },
    paramDefinitions: {
      decay: { label: 'Decay', min: 0.1, max: 0.3, step: 0.01 },
      spread: { label: 'Spread', min: 0, max: 1, step: 0.01 },
      reverbSend: { label: 'Reverb', min: 0, max: 1, step: 0.01 },
      delaySend: { label: 'Delay', min: 0, max: 1, step: 0.01 },
      flangerSend: { label: 'Flanger', min: 0, max: 1, step: 0.01 },
    }
  },
  {
    id: 'low_tom',
    name: 'Low Tom',
    sequence: defaultSequence(steps),
    volume: 0.55,
    isMuted: false,
    isSolo: false,
    params: {
      pitch: 100,
      decay: 0.4,
      reverbSend: 0,
      delaySend: 0,
      flangerSend: 0,
    },
    paramDefinitions: {
      pitch: { label: 'Pitch', min: 60, max: 150, step: 1 },
      decay: { label: 'Decay', min: 0.1, max: 0.8, step: 0.01 },
      reverbSend: { label: 'Reverb', min: 0, max: 1, step: 0.01 },
      delaySend: { label: 'Delay', min: 0, max: 1, step: 0.01 },
      flangerSend: { label: 'Flanger', min: 0, max: 1, step: 0.01 },
    }
  },
  {
    id: 'mid_tom',
    name: 'Mid Tom',
    sequence: defaultSequence(steps),
    volume: 0.55,
    isMuted: false,
    isSolo: false,
    params: {
      pitch: 150,
      decay: 0.3,
      reverbSend: 0,
      delaySend: 0,
      flangerSend: 0,
    },
    paramDefinitions: {
      pitch: { label: 'Pitch', min: 100, max: 250, step: 1 },
      decay: { label: 'Decay', min: 0.1, max: 0.6, step: 0.01 },
      reverbSend: { label: 'Reverb', min: 0, max: 1, step: 0.01 },
      delaySend: { label: 'Delay', min: 0, max: 1, step: 0.01 },
      flangerSend: { label: 'Flanger', min: 0, max: 1, step: 0.01 },
    }
  },
  {
    id: 'hi_tom',
    name: 'High Tom',
    sequence: defaultSequence(steps),
    volume: 0.55,
    isMuted: false,
    isSolo: false,
    params: {
      pitch: 220,
      decay: 0.25,
      reverbSend: 0,
      delaySend: 0,
      flangerSend: 0,
    },
    paramDefinitions: {
      pitch: { label: 'Pitch', min: 150, max: 350, step: 1 },
      decay: { label: 'Decay', min: 0.1, max: 0.5, step: 0.01 },
      reverbSend: { label: 'Reverb', min: 0, max: 1, step: 0.01 },
      delaySend: { label: 'Delay', min: 0, max: 1, step: 0.01 },
      flangerSend: { label: 'Flanger', min: 0, max: 1, step: 0.01 },
    }
  },
  {
    id: 'hihat',
    name: 'Closed Hi-hat',
    sequence: defaultSequence(steps),
    volume: 0.45,
    isMuted: false,
    isSolo: false,
    params: {
      pitch: 300,
      metal: 0.5,
      reverbSend: 0,
      delaySend: 0,
      flangerSend: 0,
    },
    paramDefinitions: {
      pitch: { label: 'Pitch', min: 200, max: 800, step: 1 },
      decay: { label: 'Decay', min: 0.01, max: 0.2, step: 0.001 },
      metal: { label: 'Metal', min: 0, max: 1, step: 0.01 },
      reverbSend: { label: 'Reverb', min: 0, max: 1, step: 0.01 },
      delaySend: { label: 'Delay', min: 0, max: 1, step: 0.01 },
      flangerSend: { label: 'Flanger', min: 0, max: 1, step: 0.01 },
    },
  },
  {
    id: 'openhat',
    name: 'Open Hi-hat',
    sequence: defaultSequence(steps),
    volume: 0.45,
    isMuted: false,
    isSolo: false,
    params: {
      pitch: 300,
      decay: 0.5,
      metal: 0.5,
      reverbSend: 0,
      delaySend: 0,
      flangerSend: 0,
    },
    paramDefinitions: {
      pitch: { label: 'Pitch', min: 200, max: 800, step: 1 },
      decay: { label: 'Decay', min: 0.1, max: 1, step: 0.01 },
      metal: { label: 'Metal', min: 0, max: 1, step: 0.01 },
      reverbSend: { label: 'Reverb', min: 0, max: 1, step: 0.01 },
      delaySend: { label: 'Delay', min: 0, max: 1, step: 0.01 },
      flangerSend: { label: 'Flanger', min: 0, max: 1, step: 0.01 },
    },
  },
];

export const getInitialBasslinePattern = (steps: number): BasslinePattern => ({
  sequence: Array(steps).fill(0).map(() => ({ note: null, velocity: 0, slide: false, tie: false })),
  params: {
    enabled: true,
    waveform: 'sawtooth',
    cutoff: 800,
    resonance: 5,
    envelopeAmount: 2000,
    decay: 0.3,
    accent: 0.5,
    volume: 0.25,
    reverbSend: 0,
    delaySend: 0,
    flangerSend: 0,
  }
});

// Synth Pitch range (MIDI notes); played notes outside it are moved by octaves into it
export const SYNTH_PITCH_MIN = 24; // C1
export const SYNTH_PITCH_MAX = 84; // C6
// Keep in step with MAX_SYNTH_VOICES in services/vocoder-processor.js
export const MAX_SYNTH_VOICES = 4;

export const INITIAL_VOCODER_PARAMS: VocoderParams = {
  enabled: false,
  carrier: 'synth',
  mix: 1, // fully wet: dry mic in the mix feeds back through speakers
  formantShift: 0,
  synthPitch: 48, // C3
  carrierWaveform: 'sawtooth',
  keyGate: false,
  poly: true,
  voiceGain: 30,
  noiseGate: 5,
  attack: 0.003,
  release: 0.03,
  sibilance: 0.5,
  qFactor: 5,
};