
import { Instrument } from './types';

export const STEPS = 16;
export const INITIAL_TEMPO = 120;

export const INSTRUMENTS: Instrument[] = [
  { id: 'kick', name: 'Bass Drum' },
  { id: 'snare', name: 'Snare Drum' },
  { id: 'clap', name: 'Hand Clap' },
  { id: 'closedHat', name: 'Closed Hat' },
  { id: 'openHat', name: 'Open Hat' },
  { id: 'tom1', name: 'Low Tom' },
  { id: 'tom2', name: 'Mid Tom' },
  { id: 'tom3', name: 'High Tom' },
];

export const initialSequence: boolean[][] = Array(INSTRUMENTS.length)
  .fill(null)
  .map(() => Array(STEPS).fill(false));
