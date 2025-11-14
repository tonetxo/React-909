// hooks/usePatterns.ts
import { useState, useCallback } from 'react';
import { Pattern, Velocity, TimeSignature } from '../types';
import { INITIAL_TEMPO, INITIAL_SWING, getInitialInstruments, getInitialBasslinePattern } from '../constants';

const NUM_PATTERNS = 4;

const mergePatternData = (loadedPattern: Pattern | null, timeSignature: TimeSignature, steps: number): Pattern => {
    const defaultBassline = structuredClone(getInitialBasslinePattern(steps));
    if (!loadedPattern) {
        return {
            tempo: INITIAL_TEMPO,
            swing: INITIAL_SWING,
            timeSignature: timeSignature,
            instruments: getInitialInstruments(steps),
            bassline: defaultBassline,
        };
    }
     // Basic migration for older projects without velocity
    const migratedBasslineSequence = (loadedPattern.bassline?.sequence || defaultBassline.sequence).map((step: any) => ({
        note: step.note,
        velocity: step.velocity ?? (step.accent ? 3 : 0),
        slide: step.slide ?? false,
        tie: step.tie ?? false, // Add this line
    }));


    return {
        tempo: loadedPattern.tempo,
        swing: loadedPattern.swing,
        timeSignature: loadedPattern.timeSignature || timeSignature, // Use loaded or default
        instruments: loadedPattern.instruments,
        bassline: loadedPattern.bassline
            ? {
                sequence: migratedBasslineSequence.length === steps ? migratedBasslineSequence : defaultBassline.sequence,
                params: { ...defaultBassline.params, ...loadedPattern.bassline.params }
            }
            : defaultBassline,
    };
};

export const usePatterns = (timeSignature: TimeSignature, stepsPerSequence: number) => {
    const [patterns, setPatterns] = useState<(Pattern | null)[]>(() => Array(NUM_PATTERNS).fill(null).map(() => ({
        tempo: INITIAL_TEMPO,
        swing: INITIAL_SWING,
        timeSignature: [4, 4],
        instruments: getInitialInstruments(16),
        bassline: getInitialBasslinePattern(16),
    })));
    const [selectedPatternIndex, setSelectedPatternIndex] = useState<number>(0);
    const [clipboard, setClipboard] = useState<Pattern | null>(null);
    const [instrumentClipboard, setInstrumentClipboard] = useState<Velocity[] | null>(null);

    const updateCurrentPattern = useCallback((updater: (pattern: Pattern) => Pattern) => {
        setPatterns(prevPatterns => {
            const newPatterns = [...prevPatterns];
            const currentPattern = newPatterns[selectedPatternIndex] ?? mergePatternData(null, timeSignature, stepsPerSequence);
            newPatterns[selectedPatternIndex] = updater(currentPattern);
            return newPatterns;
        });
    }, [selectedPatternIndex, timeSignature, stepsPerSequence]);

    return {
        patterns,
        setPatterns,
        selectedPatternIndex,
        setSelectedPatternIndex,
        clipboard,
        setClipboard,
        instrumentClipboard,
        setInstrumentClipboard,
        updateCurrentPattern,
        mergePatternData,
    };
};
