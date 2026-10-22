import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import path from 'path';
import {
  NUM_PATTERNS, SONG_STEPS, stepsFromTimeSig, resizeSequence, sanitizeTimeSignature,
  mergePatternData, createDefaultProject, parseProjectData, serializeProject,
} from './projectIO';

const ROOT = path.resolve(__dirname, '..');
const NON_PROJECT_JSON = new Set(['package.json', 'package-lock.json', 'tsconfig.json', 'metadata.json']);
const fixtureFiles = readdirSync(ROOT).filter(f => f.endsWith('.json') && !NON_PROJECT_JSON.has(f));
const readFixture = (file: string) => JSON.parse(readFileSync(path.join(ROOT, file), 'utf8'));

describe('stepsFromTimeSig', () => {
  it('uses 16ths for x/4 and 8ths for x/8', () => {
    expect(stepsFromTimeSig([4, 4])).toBe(16);
    expect(stepsFromTimeSig([5, 4])).toBe(20);
    expect(stepsFromTimeSig([6, 8])).toBe(12);
    expect(stepsFromTimeSig([12, 8])).toBe(24);
  });
});

describe('resizeSequence', () => {
  it('truncates, pads and leaves equal lengths untouched', () => {
    const seq = [1, 2, 3];
    expect(resizeSequence(seq, 2, () => 0)).toEqual([1, 2]);
    expect(resizeSequence(seq, 5, () => 0)).toEqual([1, 2, 3, 0, 0]);
    expect(resizeSequence(seq, 3, () => 0)).toBe(seq);
  });

  it('creates a fresh value for each padded slot', () => {
    const padded = resizeSequence<{ n: number }>([], 2, () => ({ n: 0 }));
    expect(padded[0]).not.toBe(padded[1]);
  });
});

describe('sanitizeTimeSignature', () => {
  it('keeps valid signatures and falls back to 4/4 otherwise', () => {
    expect(sanitizeTimeSignature([7, 8])).toEqual([7, 8]);
    expect(sanitizeTimeSignature([4, 3])).toEqual([4, 4]);
    expect(sanitizeTimeSignature([0, 4])).toEqual([4, 4]);
    expect(sanitizeTimeSignature('4/4')).toEqual([4, 4]);
    expect(sanitizeTimeSignature(undefined)).toEqual([4, 4]);
  });
});

describe('mergePatternData', () => {
  it('returns a default 4/4 pattern for missing data', () => {
    const pattern = mergePatternData(null);
    expect(pattern.timeSignature).toEqual([4, 4]);
    expect(pattern.instruments.every(i => i.sequence.length === 16)).toBe(true);
    expect(pattern.bassline!.sequence).toHaveLength(16);
  });

  it('resizes sequences that do not match the time signature instead of dropping them', () => {
    const pattern = mergePatternData({
      timeSignature: [3, 4],
      instruments: [{ id: 'kick', sequence: [5, 0, 0, 0, 5, 0, 0, 0, 5, 0, 0, 0, 5, 0, 0, 0] }],
    });
    const kick = pattern.instruments.find(i => i.id === 'kick')!;
    expect(kick.sequence).toEqual([5, 0, 0, 0, 5, 0, 0, 0, 5, 0, 0, 0]);
  });

  it('clamps tempo/swing and sanitizes velocities', () => {
    const pattern = mergePatternData({
      tempo: 999,
      swing: -5,
      instruments: [{ id: 'snare', sequence: [9, -1, 'x', 3] }],
    });
    expect(pattern.tempo).toBe(240);
    expect(pattern.swing).toBe(0);
    expect(pattern.instruments.find(i => i.id === 'snare')!.sequence.slice(0, 4)).toEqual([0, 0, 0, 3]);
  });

  it('migrates legacy bassline accents to velocity', () => {
    const pattern = mergePatternData({
      bassline: { sequence: [{ note: 36, accent: true }, { note: 38, accent: false }] },
    });
    expect(pattern.bassline!.sequence[0]).toEqual({ note: 36, velocity: 3, slide: false, tie: false });
    expect(pattern.bassline!.sequence[1].velocity).toBe(0);
    expect(pattern.bassline!.sequence).toHaveLength(16);
  });

  it('ignores unknown instrument ids', () => {
    const pattern = mergePatternData({ instruments: [{ id: 'cowbell', sequence: [5] }] });
    expect(pattern.instruments.some(i => i.id === 'cowbell')).toBe(false);
  });
});

describe('parseProjectData', () => {
  it('rejects data without patterns', () => {
    expect(() => parseProjectData(null)).toThrow();
    expect(() => parseProjectData('hello')).toThrow();
    expect(() => parseProjectData({ song: {} })).toThrow();
  });

  it('accepts the legacy bare-array format', () => {
    const project = parseProjectData([{ tempo: 100 }]);
    expect(project.patterns).toHaveLength(NUM_PATTERNS);
    expect(project.patterns[0]!.tempo).toBe(100);
    expect(project.song).toEqual({ sequence: Array(SONG_STEPS).fill(null), isLooping: false });
  });

  it('sanitizes the song sequence', () => {
    const project = parseProjectData({ patterns: [], song: { sequence: [0, 3, 4, -1, 1.5, 'a', null], isLooping: 'yes' } });
    expect(project.song.sequence).toHaveLength(SONG_STEPS);
    expect(project.song.sequence.slice(0, 7)).toEqual([0, 3, null, null, null, null, null]);
    expect(project.song.isLooping).toBe(false);
  });

  it('survives a serialize/parse round trip', () => {
    const project = createDefaultProject();
    expect(parseProjectData(JSON.parse(serializeProject(project)))).toEqual(project);
  });

  it.each(fixtureFiles)('loads exported project %s consistently', (file) => {
    const raw = readFixture(file);
    const project = parseProjectData(raw);

    expect(project.patterns).toHaveLength(NUM_PATTERNS);
    project.patterns.forEach(pattern => {
      const steps = stepsFromTimeSig(pattern!.timeSignature);
      pattern!.instruments.forEach(inst => expect(inst.sequence).toHaveLength(steps));
      expect(pattern!.bassline!.sequence).toHaveLength(steps);
    });

    // Real exports must not lose any programmed steps
    raw.patterns.forEach((rawPattern: any, i: number) => {
      if (!rawPattern) return;
      rawPattern.instruments.forEach((rawInst: any) => {
        const inst = project.patterns[i]!.instruments.find(x => x.id === rawInst.id);
        expect(inst?.sequence).toEqual(rawInst.sequence);
      });
    });
    expect(project.song.sequence).toEqual(raw.song.sequence);
  });
});
