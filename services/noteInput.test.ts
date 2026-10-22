import { describe, it, expect } from 'vitest';
import { HeldNotes, parseNoteMessage, fitToRange, pcKeyToNote, velocityToGain } from './noteInput';

describe('HeldNotes', () => {
    it('plays the last pressed note and falls back to the previous held one', () => {
        const held = new HeldNotes();
        expect(held.press(48)).toBe(48);
        expect(held.press(52)).toBe(52);
        expect(held.press(55)).toBe(55);
        expect(held.release(55)).toBe(52);
        expect(held.release(48)).toBe(52);
        expect(held.release(52)).toBeNull();
    });

    it('moves a re-pressed note to the top without duplicating it', () => {
        const held = new HeldNotes();
        held.press(48);
        held.press(52);
        held.press(48);
        expect(held.release(48)).toBe(52);
        expect(held.release(52)).toBeNull();
    });

    it('reports whether any note is held', () => {
        const held = new HeldNotes();
        expect(held.isEmpty).toBe(true);
        held.press(60);
        expect(held.isEmpty).toBe(false);
        held.release(60);
        expect(held.isEmpty).toBe(true);
        held.press(62);
        held.clear();
        expect(held.isEmpty).toBe(true);
    });

    it('returns the latest held notes, oldest first', () => {
        const held = new HeldNotes();
        [48, 52, 55, 59, 62].forEach(n => held.press(n));
        expect(held.latest(4)).toEqual([52, 55, 59, 62]);
        expect(held.latest(1)).toEqual([62]);
        held.release(59);
        expect(held.latest(4)).toEqual([48, 52, 55, 62]);
    });

    it('ignores releases of notes that are not held', () => {
        const held = new HeldNotes();
        held.press(60);
        expect(held.release(61)).toBe(60);
    });
});

describe('parseNoteMessage', () => {
    it('reads note on and off on any melodic channel', () => {
        expect(parseNoteMessage([0x90, 60, 100])).toEqual({ note: 60, on: true, velocity: 100 });
        expect(parseNoteMessage([0x93, 61, 1])).toEqual({ note: 61, on: true, velocity: 1 });
        expect(parseNoteMessage([0x80, 60, 64])).toEqual({ note: 60, on: false, velocity: 0 });
    });

    it('treats note on with velocity 0 as note off', () => {
        expect(parseNoteMessage([0x90, 60, 0])).toEqual({ note: 60, on: false, velocity: 0 });
    });

    it('ignores the drum channel, clock and controllers', () => {
        expect(parseNoteMessage([0x99, 36, 100])).toBeNull(); // channel 10 (pads)
        expect(parseNoteMessage([0xf8])).toBeNull(); // clock
        expect(parseNoteMessage([0xb0, 1, 64])).toBeNull(); // CC
    });
});

describe('velocityToGain', () => {
    const db = (gain: number) => 20 * Math.log10(gain);

    it('plays full velocity at unity gain', () => {
        expect(velocityToGain(127, 1)).toBeCloseTo(1);
        expect(velocityToGain(127, 0.5)).toBeCloseTo(1);
    });

    it('scales the level in dB with velocity and sensitivity', () => {
        expect(db(velocityToGain(0, 1))).toBeCloseTo(-40);
        expect(db(velocityToGain(63.5, 1))).toBeCloseTo(-20);
        expect(db(velocityToGain(63.5, 0.75))).toBeCloseTo(-15);
    });

    it('ignores velocity at zero sensitivity', () => {
        expect(velocityToGain(10, 0)).toBe(1);
    });
});

describe('fitToRange', () => {
    it('keeps notes inside the range', () => {
        expect(fitToRange(60, 24, 84)).toBe(60);
    });

    it('moves out-of-range notes by whole octaves', () => {
        expect(fitToRange(12, 24, 84)).toBe(24);
        expect(fitToRange(97, 24, 84)).toBe(73);
        expect(fitToRange(0, 30, 84)).toBe(36);
    });
});

describe('pcKeyToNote', () => {
    it('maps the home row to white keys and the row above to black keys', () => {
        expect(pcKeyToNote('KeyA', 48)).toBe(48); // C
        expect(pcKeyToNote('KeyW', 48)).toBe(49); // C#
        expect(pcKeyToNote('KeyK', 48)).toBe(60); // next C
        expect(pcKeyToNote('Semicolon', 48)).toBe(64); // E (Ñ on a Spanish layout)
    });

    it('ignores other keys', () => {
        expect(pcKeyToNote('KeyQ', 48)).toBeUndefined();
        expect(pcKeyToNote('Space', 48)).toBeUndefined();
    });
});
