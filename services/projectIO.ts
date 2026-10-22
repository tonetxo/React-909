// services/projectIO.ts
// Pure helpers to build, migrate and validate project data (localStorage + JSON import/export).
import { Instrument, Pattern, ProjectData, TimeSignature, BasslineStep, Velocity } from '../types';
import { getInitialInstruments, getInitialBasslinePattern, INITIAL_TEMPO, INITIAL_SWING } from '../constants';

export const NUM_PATTERNS = 4;
export const SONG_STEPS = 16;
export const TEMPO_MIN = 40;
export const TEMPO_MAX = 240;
export const SWING_MIN = 0;
export const SWING_MAX = 100;

const DEFAULT_TIME_SIGNATURE: TimeSignature = [4, 4];

export const stepsFromTimeSig = (ts: TimeSignature): number =>
  ts[1] === 8 ? ts[0] * 2 : ts[0] * 4;

const isObject = (value: unknown): value is Record<string, any> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const clampNumber = (value: unknown, min: number, max: number, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;

const toVelocity = (value: unknown): Velocity =>
  (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 5 ? value : 0) as Velocity;

export const sanitizeTimeSignature = (value: unknown): TimeSignature => {
  if (Array.isArray(value) && value.length === 2) {
    const [beats, beatType] = value;
    if (Number.isInteger(beats) && beats >= 1 && beats <= 16 && (beatType === 4 || beatType === 8)) {
      return [beats, beatType];
    }
  }
  return [...DEFAULT_TIME_SIGNATURE];
};

/** Truncates or pads a sequence to `length`, filling new slots with `makeEmpty()`. */
export const resizeSequence = <T>(sequence: T[], length: number, makeEmpty: () => T): T[] => {
  if (sequence.length === length) return sequence;
  if (sequence.length > length) return sequence.slice(0, length);
  return [...sequence, ...Array.from({ length: length - sequence.length }, makeEmpty)];
};

export const emptyBasslineStep = (): BasslineStep => ({ note: null, velocity: 0, slide: false, tie: false });

const sanitizeBasslineStep = (step: unknown): BasslineStep => {
  if (!isObject(step)) return emptyBasslineStep();
  const note = typeof step.note === 'number' && Number.isInteger(step.note) && step.note >= 0 && step.note <= 127 ? step.note : null;
  // Older projects stored `accent: boolean` instead of a velocity
  const velocity = step.velocity !== undefined ? toVelocity(step.velocity) : (step.accent ? 3 : 0) as Velocity;
  return { note, velocity, slide: step.slide === true, tie: step.tie === true };
};

export const mergeInstrumentData = (loadedInstruments: unknown, steps: number): Instrument[] => {
  const newInstruments = getInitialInstruments(steps);
  if (!Array.isArray(loadedInstruments)) return newInstruments;

  const loadedById = new Map<string, Record<string, any>>();
  loadedInstruments.forEach(inst => {
    if (isObject(inst) && typeof inst.id === 'string') loadedById.set(inst.id, inst);
  });

  return newInstruments.map(instrument => {
    const loaded = loadedById.get(instrument.id);
    if (!loaded) return instrument;
    return {
      ...instrument,
      volume: clampNumber(loaded.volume, 0, 1, instrument.volume),
      isMuted: typeof loaded.isMuted === 'boolean' ? loaded.isMuted : instrument.isMuted,
      isSolo: typeof loaded.isSolo === 'boolean' ? loaded.isSolo : instrument.isSolo,
      params: isObject(loaded.params) ? { ...instrument.params, ...loaded.params } : instrument.params,
      sequence: Array.isArray(loaded.sequence)
        ? resizeSequence(loaded.sequence.map(toVelocity), steps, () => 0 as Velocity)
        : instrument.sequence,
    };
  });
};

export const createDefaultPattern = (timeSignature: TimeSignature = DEFAULT_TIME_SIGNATURE): Pattern => {
  const steps = stepsFromTimeSig(timeSignature);
  return {
    tempo: INITIAL_TEMPO,
    swing: INITIAL_SWING,
    timeSignature: [...timeSignature] as TimeSignature,
    instruments: getInitialInstruments(steps),
    bassline: getInitialBasslinePattern(steps),
  };
};

/** Builds a complete, valid pattern from possibly partial/legacy data. */
export const mergePatternData = (loadedPattern: unknown): Pattern => {
  if (!isObject(loadedPattern)) return createDefaultPattern();

  const timeSignature = sanitizeTimeSignature(loadedPattern.timeSignature);
  const steps = stepsFromTimeSig(timeSignature);
  const defaultBassline = getInitialBasslinePattern(steps);
  const loadedBassline = isObject(loadedPattern.bassline) ? loadedPattern.bassline : null;

  return {
    tempo: clampNumber(loadedPattern.tempo, TEMPO_MIN, TEMPO_MAX, INITIAL_TEMPO),
    swing: clampNumber(loadedPattern.swing, SWING_MIN, SWING_MAX, INITIAL_SWING),
    timeSignature,
    instruments: mergeInstrumentData(loadedPattern.instruments, steps),
    bassline: loadedBassline
      ? {
        sequence: Array.isArray(loadedBassline.sequence)
          ? resizeSequence(loadedBassline.sequence.map(sanitizeBasslineStep), steps, emptyBasslineStep)
          : defaultBassline.sequence,
        params: { ...defaultBassline.params, ...(isObject(loadedBassline.params) ? loadedBassline.params : {}) },
      }
      : defaultBassline,
  };
};

const sanitizeSongSequence = (value: unknown): (number | null)[] => {
  const sequence = Array.isArray(value) ? value : [];
  return Array.from({ length: SONG_STEPS }, (_, i) => {
    const entry = sequence[i];
    return Number.isInteger(entry) && entry >= 0 && entry < NUM_PATTERNS ? entry : null;
  });
};

export const createDefaultProject = (): ProjectData => ({
  patterns: Array.from({ length: NUM_PATTERNS }, () => createDefaultPattern()),
  song: { sequence: Array(SONG_STEPS).fill(null), isLooping: false },
});

/**
 * Validates and migrates untrusted project data (localStorage or an imported file).
 * Accepts the legacy format (a bare array of patterns). Throws if the data is unusable.
 */
export const parseProjectData = (data: unknown): ProjectData => {
  const raw = Array.isArray(data) ? { patterns: data, song: null } : data;
  if (!isObject(raw) || !Array.isArray(raw.patterns)) {
    throw new Error('Ficheiro de proxecto non válido: faltan os patróns');
  }

  const song = isObject(raw.song) ? raw.song : {};
  return {
    patterns: Array.from({ length: NUM_PATTERNS }, (_, i) => mergePatternData(raw.patterns[i])),
    song: {
      sequence: sanitizeSongSequence(song.sequence),
      isLooping: song.isLooping === true,
    },
  };
};

export const serializeProject = (project: ProjectData, pretty = false): string =>
  JSON.stringify(project, null, pretty ? 2 : undefined);
