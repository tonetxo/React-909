// state/AppState.ts
import { useState, useEffect, useRef } from 'react';
import { SequencerEngine, SequencerCallbacks } from '../sequencer/SequencerEngine';
import { Pattern, TimeSignature, Velocity } from '../types';
import { useAudioScheduler } from '../hooks/useAudioScheduler'; // We'll update this later

// Define the application state interface
export interface AppState {
  isPlaying: boolean;
  tempo: number;
  swing: number;
  timeSignature: TimeSignature;
  stepsPerSequence: number;
  currentStep: number | null;
  currentSongStep: number | null;
  selectedPatternIndex: number;
  isSongModeActive: boolean;
  songSequence: (number | null)[];
  isSongLooping: boolean;
  patterns: (Pattern | null)[];
}

// Default initial state
const DEFAULT_STATE: AppState = {
  isPlaying: false,
  tempo: 120,
  swing: 0,
  timeSignature: [4, 4],
  stepsPerSequence: 16,
  currentStep: null,
  currentSongStep: null,
  selectedPatternIndex: 0,
  isSongModeActive: false,
  songSequence: Array(16).fill(null),
  isSongLooping: false,
  patterns: Array(4).fill(null),
};

export const useAppState = () => {
  const [state, setState] = useState<AppState>(DEFAULT_STATE);
  const sequencerEngineRef = useRef<SequencerEngine | null>(null);
  const clipboardRef = useRef<Velocity[] | null>(null);

  // Initialize the sequencer engine once
  useEffect(() => {
    const engine = new SequencerEngine();
    sequencerEngineRef.current = engine;

    // Set up callbacks
    const callbacks: SequencerCallbacks = {
      onStepChange: (step) => setState(prev => ({ ...prev, currentStep: step })),
      onSongStepChange: (step) => setState(prev => ({ ...prev, currentSongStep: step })),
      onPatternChange: (patternIndex) => setState(prev => ({ ...prev, selectedPatternIndex: patternIndex })),
      onPlaybackEnd: () => setState(prev => ({ ...prev, isPlaying: false })),
      onTimeSignatureChange: (timeSignature) => setState(prev => ({ 
        ...prev, 
        timeSignature,
        stepsPerSequence: timeSignature[1] === 8 ? timeSignature[0] * 2 : timeSignature[0] * 4
      })),
    };

    engine.setCallbacks(callbacks);

    // Initialize engine with default state
    engine.setPatterns(DEFAULT_STATE.patterns);
    engine.setSongSequence(DEFAULT_STATE.songSequence);
    engine.setSongLooping(DEFAULT_STATE.isSongLooping);
    engine.setSongMode(DEFAULT_STATE.isSongModeActive);

    return () => {
      engine.destroy();
    };
  }, []);

  // Update engine when patterns or sequence changes
  useEffect(() => {
    if (sequencerEngineRef.current) {
      sequencerEngineRef.current.setPatterns(state.patterns);
      sequencerEngineRef.current.setSongSequence(state.songSequence);
      sequencerEngineRef.current.setSongLooping(state.isSongLooping);
      sequencerEngineRef.current.setSongMode(state.isSongModeActive);
    }
  }, [state.patterns, state.songSequence, state.isSongLooping, state.isSongModeActive]);

  const togglePlayback = () => {
    if (sequencerEngineRef.current) {
      const isCurrentlyPlaying = sequencerEngineRef.current.isPlayingState();
      if (isCurrentlyPlaying) {
        sequencerEngineRef.current.stop();
        setState(prev => ({ ...prev, isPlaying: false }));
      } else {
        sequencerEngineRef.current.start(state.tempo, state.swing);
        setState(prev => ({ ...prev, isPlaying: true }));
      }
    }
  };

  const loadPattern = (patternIndex: number) => {
    if (sequencerEngineRef.current) {
      sequencerEngineRef.current.loadPattern(patternIndex);
      setState(prev => ({ ...prev, selectedPatternIndex: patternIndex }));
    }
  };

  const setTimeSignature = (timeSig: TimeSignature) => {
    const [beats, beatType] = timeSig;
    const newStepsPerSequence = beatType === 8 ? beats * 2 : beats * 4;
    setState(prev => ({
      ...prev,
      timeSignature: timeSig,
      stepsPerSequence: newStepsPerSequence
    }));
  };

  const setTempo = (tempo: number) => {
    setState(prev => ({ ...prev, tempo }));
    // If playing, restart with new tempo by restarting the engine
    if (state.isPlaying && sequencerEngineRef.current) {
      const currentPatternIndex = sequencerEngineRef.current.getCurrentPatternIndex();
      sequencerEngineRef.current.stop();
      sequencerEngineRef.current.loadPattern(currentPatternIndex); // Reload to get the new tempo
      sequencerEngineRef.current.start(tempo, state.swing);
      setState(prev => ({ ...prev, isPlaying: true })); // Keep playing state in sync
    }
  };

  const setSwing = (swing: number) => {
    setState(prev => ({ ...prev, swing }));
    // If playing, restart with new swing by restarting the engine
    if (state.isPlaying && sequencerEngineRef.current) {
      const currentPatternIndex = sequencerEngineRef.current.getCurrentPatternIndex();
      sequencerEngineRef.current.stop();
      sequencerEngineRef.current.loadPattern(currentPatternIndex); // Reload to get the new swing
      sequencerEngineRef.current.start(state.tempo, swing);
      setState(prev => ({ ...prev, isPlaying: true })); // Keep playing state in sync
    }
  };

  const setPatterns = (patterns: (Pattern | null)[]) => {
    setState(prev => ({ ...prev, patterns }));
  };

  const setSongSequence = (sequence: (number | null)[]) => {
    setState(prev => ({ ...prev, songSequence: sequence }));
  };

  const setSongMode = (isActive: boolean) => {
    if (sequencerEngineRef.current) {
      sequencerEngineRef.current.setSongMode(isActive);
    }
    setState(prev => ({ ...prev, isSongModeActive: isActive }));
  };

  const setSongLoop = (isLooping: boolean) => {
    if (sequencerEngineRef.current) {
      sequencerEngineRef.current.setSongLooping(isLooping);
    }
    setState(prev => ({ ...prev, isSongLooping: isLooping }));
  };

  const reloadCurrentPattern = (updatedPattern?: Pattern) => {
    if (sequencerEngineRef.current && state.isPlaying) {
      sequencerEngineRef.current.reloadCurrentPattern(updatedPattern);
    }
  };

  const copyInstrumentPattern = (instrumentId: string) => {
    const currentPattern = state.patterns[state.selectedPatternIndex];
    if (!currentPattern) return;

    const instrument = currentPattern.instruments.find(inst => inst.id === instrumentId);
    if (instrument) {
        clipboardRef.current = [...instrument.sequence];
        // Force a re-render to update the disabled state of the paste button
        setState(prev => ({...prev})); 
    }
  };

  const pasteInstrumentPattern = (instrumentId: string) => {
      if (!clipboardRef.current) return;

      const updatedPatterns = [...state.patterns];
      const currentPattern = updatedPatterns[state.selectedPatternIndex];
      if (!currentPattern) return;

      const instrumentIndex = currentPattern.instruments.findIndex(inst => inst.id === instrumentId);
      if (instrumentIndex !== -1) {
          currentPattern.instruments[instrumentIndex].sequence = [...clipboardRef.current];
          setState(prev => ({ ...prev, patterns: updatedPatterns }));
      }
  };

  const clearInstrumentPattern = (instrumentId: string) => {
      const updatedPatterns = [...state.patterns];
      const currentPattern = updatedPatterns[state.selectedPatternIndex];
      if (!currentPattern) return;

      const instrumentIndex = currentPattern.instruments.findIndex(inst => inst.id === instrumentId);
      if (instrumentIndex !== -1) {
          const sequenceLength = currentPattern.instruments[instrumentIndex].sequence.length;
          currentPattern.instruments[instrumentIndex].sequence = Array(sequenceLength).fill(0) as Velocity[];
          setState(prev => ({ ...prev, patterns: updatedPatterns }));
      }
  };

  return {
    state,
    togglePlayback,
    loadPattern,
    setTimeSignature,
    setTempo,
    setSwing,
    setPatterns,
    setSongSequence,
    setSongMode,
    setSongLoop,
    reloadCurrentPattern,
    copyInstrumentPattern,
    pasteInstrumentPattern,
    clearInstrumentPattern,
    isPasteDisabled: clipboardRef.current === null,
  };
};