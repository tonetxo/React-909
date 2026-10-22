// Note input helpers (MIDI keyboard / PC keyboard) for playing the vocoder's synth carrier.
// Pure functions and state only, so they can be unit tested.

/** Mono note priority: the most recently pressed key that is still held wins. */
export class HeldNotes {
    private notes: number[] = [];

    /** Returns the note that should sound now. */
    press(note: number): number {
        this.notes = this.notes.filter(n => n !== note);
        this.notes.push(note);
        return note;
    }

    /** Returns the note that should sound now, or null when no key is held. */
    release(note: number): number | null {
        this.notes = this.notes.filter(n => n !== note);
        return this.notes.length > 0 ? this.notes[this.notes.length - 1] : null;
    }

    clear(): void {
        this.notes = [];
    }

    /** The `count` most recently pressed held notes, oldest first. */
    latest(count: number): number[] {
        return this.notes.slice(-count);
    }

    get isEmpty(): boolean {
        return this.notes.length === 0;
    }
}

export interface NoteMessage {
    note: number;
    on: boolean;
}

// MIDI channel 10 (index 9) is the drum channel: the pads of most controllers send there
const DRUM_CHANNEL = 9;

/** Parses a raw MIDI message into a note on/off, or null for anything else. */
export const parseNoteMessage = (data: ArrayLike<number>): NoteMessage | null => {
    if (data.length < 3) return null;
    const type = data[0] & 0xf0;
    const channel = data[0] & 0x0f;
    if (channel === DRUM_CHANNEL) return null;
    if (type === 0x90) return { note: data[1], on: data[2] > 0 }; // Note on with velocity 0 = note off
    if (type === 0x80) return { note: data[1], on: false };
    return null;
};

/** Moves a note by octaves until it lies within [min, max]. */
export const fitToRange = (note: number, min: number, max: number): number => {
    let n = note;
    while (n < min) n += 12;
    while (n > max) n -= 12;
    return n < min ? min : n;
};

// PC keyboard as a piano, by physical key (KeyboardEvent.code), so it works on any layout:
// white keys on the home row, black keys on the row above.
const PC_KEY_OFFSETS: Record<string, number> = {
    KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6, KeyG: 7,
    KeyY: 8, KeyH: 9, KeyU: 10, KeyJ: 11, KeyK: 12, KeyO: 13, KeyL: 14, KeyP: 15, Semicolon: 16,
};
export const PC_OCTAVE_DOWN = 'KeyZ';
export const PC_OCTAVE_UP = 'KeyX';

/** MIDI note for a PC key code, with `baseNote` on the A key; undefined for other keys. */
export const pcKeyToNote = (code: string, baseNote: number): number | undefined => {
    const offset = PC_KEY_OFFSETS[code];
    return offset === undefined ? undefined : baseNote + offset;
};
