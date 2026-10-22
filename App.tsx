import React, { useState, useEffect, useRef, useCallback } from 'react';
import { SequencerEngine } from './sequencer/SequencerEngine';
import Sequencer from './components/Sequencer';
import TransportControls from './components/TransportControls';
import PatternControls from './components/PatternControls';
import SongSequencer from './components/SongSequencer';
import BasslineSequencer from './components/BasslineSequencer';
import VocoderControls from './components/VocoderControls';
import MidiPortSelector from './components/MidiPortSelector';
import { Velocity, InstrumentParams, Pattern, ProjectData, BasslineParams, Waveform, VocoderParams, TimeSignature } from './types';
import { INITIAL_VOCODER_PARAMS, SYNTH_PITCH_MIN, SYNTH_PITCH_MAX, MAX_SYNTH_VOICES } from './constants';
import { audioEngine } from './services/audioService';
import { ALL_MIDI_INPUTS } from './services/MidiService';
import { VOCODER_STORAGE_KEY, parseVocoderSettings, serializeVocoderSettings } from './services/vocoderSettings';
import { HeldNotes, fitToRange, pcKeyToNote, velocityToGain, DEFAULT_VELOCITY, PC_OCTAVE_DOWN, PC_OCTAVE_UP } from './services/noteInput';
import { NUM_PATTERNS, SONG_STEPS, stepsFromTimeSig, resizeSequence, emptyBasslineStep, createDefaultPattern, createDefaultProject, parseProjectData, serializeProject } from './services/projectIO';

const PROJECT_STORAGE_KEY = 'gemini-groove-project';

const MIDI_OUTPUT_OPTIONS = [{ value: '', label: 'None (Disabled)' }];
const MIDI_INPUT_OPTIONS = [{ value: ALL_MIDI_INPUTS, label: 'All inputs' }, { value: '', label: 'None (Disabled)' }];
const DEFAULT_PC_KEYBOARD_BASE = 48; // the A key plays C3

const loadVocoderSettings = (): VocoderParams => {
  try {
    const saved = localStorage.getItem(VOCODER_STORAGE_KEY);
    return parseVocoderSettings(saved ? JSON.parse(saved) : null);
  } catch (error) {
    console.error("Failed to load vocoder settings:", error);
    return parseVocoderSettings(null);
  }
};

const App: React.FC = () => {
  const [timeSignature, setTimeSignature] = useState<TimeSignature>([4, 4]);

  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentStep, setCurrentStep] = useState<number | null>(null);
  const [selectedInstrumentId, setSelectedInstrumentId] = useState<string | null>(null);

  const [patterns, setPatterns] = useState<(Pattern | null)[]>(() => createDefaultProject().patterns);
  const [selectedPatternIndex, setSelectedPatternIndex] = useState<number>(0);
  const [clipboard, setClipboard] = useState<Pattern | null>(null);
  const [instrumentClipboard, setInstrumentClipboard] = useState<Velocity[] | null>(null);

  const [masterVolume, setMasterVolume] = useState<number>(0.7);

  const [vocoderParams, setVocoderParams] = useState<VocoderParams>(loadVocoderSettings);
  const [pcKeyboardBase, setPcKeyboardBase] = useState<number>(DEFAULT_PC_KEYBOARD_BASE);
  // Latest vocoder params for the note input listeners, which live outside React's render cycle
  const vocoderParamsRef = useRef(vocoderParams);
  vocoderParamsRef.current = vocoderParams;

  // --- Derived State ---
  const activePattern = patterns[selectedPatternIndex] ?? createDefaultPattern(timeSignature);
  const { tempo, swing, instruments, bassline: basslinePattern } = activePattern;

  const saveTimeoutRef = useRef<number | null>(null);

  // Song Mode State
  const [isSongModeActive, setIsSongModeActive] = useState<boolean>(false);
  const [songSequence, setSongSequence] = useState<(number | null)[]>(() => Array(SONG_STEPS).fill(null));
  const [isSongLooping, setIsSongLooping] = useState<boolean>(false);
  const [currentSongStep, setCurrentSongStep] = useState<number | null>(null);



  const [isLoaded, setIsLoaded] = useState<boolean>(false);


  const saveProject = (patternsToSave: (Pattern | null)[], songSeqToSave: (number | null)[], isLoopingToSave: boolean) => {
    try {
      const projectData: ProjectData = {
        patterns: patternsToSave,
        song: { sequence: songSeqToSave, isLooping: isLoopingToSave },
      };
      localStorage.setItem(PROJECT_STORAGE_KEY, serializeProject(projectData));
    } catch (error) {
      console.error("Failed to save project to localStorage:", error);
    }
  };

  const applyProject = (project: ProjectData, patternIndex: number) => {
    setPatterns(project.patterns);
    setSongSequence(project.song.sequence);
    setIsSongLooping(project.song.isLooping);
    const pattern = project.patterns[patternIndex];
    if (pattern) setTimeSignature(pattern.timeSignature);
  };

  useEffect(() => {
    try {
      const savedProject = localStorage.getItem(PROJECT_STORAGE_KEY);
      if (savedProject) {
        applyProject(parseProjectData(JSON.parse(savedProject)), selectedPatternIndex);
      }
    } catch (error) {
      console.error("Failed to load project, using defaults:", error);
    } finally {
      setIsLoaded(true);
    }
  }, []);

  // Autosave project changes
  useEffect(() => {
    if (isLoaded) {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      saveTimeoutRef.current = window.setTimeout(() => {
        saveProject(patterns, songSequence, isSongLooping);
      }, 1000); // Autosave after 1 second of inactivity
    }
  }, [patterns, songSequence, isSongLooping, isLoaded]);



  const loadPatternState = useCallback((patternIndex: number, songStepIndex: number | null = null) => {
    const patternToLoad = patterns[patternIndex];
    if (!patternToLoad) return;

    setSelectedPatternIndex(patternIndex);
    setCurrentSongStep(songStepIndex);
    setTimeSignature(patternToLoad.timeSignature);
    setCurrentStep(null);
  }, [patterns]);

  const sequencerEngineRef = useRef<SequencerEngine | null>(null);
  if (sequencerEngineRef.current === null) {
    sequencerEngineRef.current = new SequencerEngine();
  }
  const sequencerEngine = sequencerEngineRef.current;

  useEffect(() => {
    sequencerEngine.setCallbacks({
      onStepChange: setCurrentStep,
      onSongStepChange: setCurrentSongStep,
      onPatternChange: (patternIndex) => {
        loadPatternState(patternIndex);
      },
      onPlaybackEnd: () => setIsPlaying(false),
      onTimeSignatureChange: setTimeSignature,
    });
  }, [sequencerEngine, loadPatternState]);

  useEffect(() => {
    sequencerEngine.setPatterns(patterns);
  }, [sequencerEngine, patterns]);

  useEffect(() => {
    sequencerEngine.setSongSequence(songSequence);
  }, [sequencerEngine, songSequence]);

  useEffect(() => {
    sequencerEngine.setSongLooping(isSongLooping);
  }, [sequencerEngine, isSongLooping]);

  useEffect(() => {
    sequencerEngine.setSongMode(isSongModeActive);
  }, [sequencerEngine, isSongModeActive]);

  // This effect syncs the main app state to the engine when not playing
  useEffect(() => {
    if (!isPlaying) {
      const currentPattern = patterns[selectedPatternIndex];
      if (currentPattern) {
        sequencerEngine.loadPattern(selectedPatternIndex);
      }
    }
  }, [isPlaying, selectedPatternIndex, patterns, sequencerEngine]);

  // This effect syncs pattern changes (mutes, steps, params) to the engine WHILE playing
  useEffect(() => {
    if (isPlaying && activePattern) {
      sequencerEngine.reloadCurrentPattern(activePattern);
      sequencerEngine.updateTempo(tempo);
      sequencerEngine.updateSwing(swing);
    }
  }, [isPlaying, activePattern, tempo, swing, sequencerEngine]);

  // Save vocoder settings (debounced: sliders fire many changes)
  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      try {
        localStorage.setItem(VOCODER_STORAGE_KEY, serializeVocoderSettings(vocoderParams));
      } catch (error) {
        console.error("Failed to save vocoder settings:", error);
      }
    }, 300);
    return () => clearTimeout(timeoutId);
  }, [vocoderParams]);

  // --- Vocoder Initialization ---
  useEffect(() => {
    audioEngine.updateVocoderParams(vocoderParams);
    if (INITIAL_VOCODER_PARAMS.enabled) {
      audioEngine.toggleVocoder(true).catch(() => {
        setVocoderParams(prev => ({ ...prev, enabled: false }));
      });
    }
  }, []); // Run only once on mount

  const handlePlayToggle = useCallback(async () => {
    if (!isLoaded) return;
    await sequencerEngine.togglePlayback(tempo, swing);
    setIsPlaying(sequencerEngine.isPlayingState());
  }, [isLoaded, sequencerEngine, tempo, swing]);

  const updateCurrentPattern = useCallback((updater: (pattern: Pattern) => Pattern) => {
    setPatterns(prevPatterns => {
      const newPatterns = [...prevPatterns];
      const currentPattern = newPatterns[selectedPatternIndex] ?? createDefaultPattern(timeSignature);
      newPatterns[selectedPatternIndex] = updater(currentPattern);
      return newPatterns;
    });
  }, [selectedPatternIndex, timeSignature]);

  const handleTempoChange = useCallback((newTempo: number) => updateCurrentPattern(p => ({ ...p, tempo: newTempo })), [updateCurrentPattern]);
  const handleSwingChange = useCallback((newSwing: number) => updateCurrentPattern(p => ({ ...p, swing: newSwing })), [updateCurrentPattern]);

  const handleMasterVolumeChange = useCallback((value: number) => {
    setMasterVolume(value);
    audioEngine.setMasterVolume(value);
  }, []);

  const handleTimeSignatureChange = useCallback((newTimeSignature: TimeSignature) => {
    setTimeSignature(newTimeSignature);
    const newSteps = stepsFromTimeSig(newTimeSignature);
    updateCurrentPattern(p => ({
      ...p,
      timeSignature: newTimeSignature,
      instruments: p.instruments.map(inst => ({ ...inst, sequence: resizeSequence(inst.sequence, newSteps, () => 0 as Velocity) })),
      bassline: { ...p.bassline!, sequence: resizeSequence(p.bassline!.sequence, newSteps, emptyBasslineStep) }
    }));
  }, [updateCurrentPattern]);

  const handleStepClick = useCallback((instrumentIndex: number, stepIndex: number) => {
    updateCurrentPattern(p => {
      const newInstruments = JSON.parse(JSON.stringify(p.instruments));
      const sequence = newInstruments[instrumentIndex].sequence;
      sequence[stepIndex] = ((sequence[stepIndex] + 1) % 6) as Velocity;
      return { ...p, instruments: newInstruments };
    });
  }, [updateCurrentPattern]);

  const handleClearStep = useCallback((instrumentIndex: number, stepIndex: number) => {
    updateCurrentPattern(p => {
      const newInstruments = JSON.parse(JSON.stringify(p.instruments));
      newInstruments[instrumentIndex].sequence[stepIndex] = 0;
      return { ...p, instruments: newInstruments };
    });
  }, [updateCurrentPattern]);

  const handleInstrumentSelect = useCallback((id: string) => setSelectedInstrumentId(prev => prev === id ? null : id), []);
  const handleMuteToggle = useCallback((id: string) => updateCurrentPattern(p => ({ ...p, instruments: p.instruments.map(i => i.id === id ? { ...i, isMuted: !i.isMuted } : i) })), [updateCurrentPattern]);
  const handleSoloToggle = useCallback((id: string) => updateCurrentPattern(p => ({ ...p, instruments: p.instruments.map(i => i.id === id ? { ...i, isSolo: !i.isSolo } : i) })), [updateCurrentPattern]);
  const handleParamChange = useCallback((id: string, param: keyof InstrumentParams, value: number) => updateCurrentPattern(p => ({ ...p, instruments: p.instruments.map(i => i.id === id ? { ...i, params: { ...i.params, [param]: value } } : i) })), [updateCurrentPattern]);
  const handleVolumeChange = useCallback((id: string, value: number) => updateCurrentPattern(p => ({ ...p, instruments: p.instruments.map(i => i.id === id ? { ...i, volume: value } : i) })), [updateCurrentPattern]);

  const handleInstrumentAction = useCallback((id: string, action: 'copy' | 'paste' | 'clear') => {
    switch (action) {
      case 'copy':
        const instrument = activePattern.instruments.find(inst => inst.id === id);
        if (instrument) {
          setInstrumentClipboard(instrument.sequence);
        }
        break;
      case 'paste':
        if (instrumentClipboard) {
          // Fit the copied steps to this pattern's length (it may use another time signature)
          updateCurrentPattern(p => ({
            ...p,
            instruments: p.instruments.map(inst => inst.id === id
              ? { ...inst, sequence: resizeSequence([...instrumentClipboard], inst.sequence.length, () => 0 as Velocity) }
              : inst)
          }));
        }
        break;
      case 'clear':
        updateCurrentPattern(p => ({
          ...p,
          instruments: p.instruments.map(inst => inst.id === id ? { ...inst, sequence: Array(inst.sequence.length).fill(0) as Velocity[] } : inst)
        }));
        break;
    }
  }, [activePattern, instrumentClipboard, updateCurrentPattern]);

  const handleSavePattern = useCallback(() => {
    // The pattern is now updated in real-time, so we just need to save the project.
    saveProject(patterns, songSequence, isSongLooping);
  }, [patterns, songSequence, isSongLooping]);

  const handleLoadPattern = useCallback(async (index: number) => {
    if (isPlaying) {
      await sequencerEngine.loadPattern(index);
    }
    setSelectedPatternIndex(index);
    setIsSongModeActive(false);
  }, [isPlaying, sequencerEngine, setSelectedPatternIndex, setIsSongModeActive]);

  const handleCopyPattern = useCallback(() => setClipboard(activePattern), [activePattern, setClipboard]);
  const handlePastePattern = useCallback(() => {
    if (clipboard) {
      updateCurrentPattern(() => JSON.parse(JSON.stringify(clipboard)));
      // The pasted pattern brings its own time signature
      setTimeSignature(clipboard.timeSignature);
    }
  }, [clipboard, updateCurrentPattern]);
  const handleExportPatterns = useCallback(() => {
    const projectData: ProjectData = { patterns, song: { sequence: songSequence, isLooping: isSongLooping } };
    const blob = new Blob([serializeProject(projectData, true)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `gemini-groove-project-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  }, [patterns, songSequence, isSongLooping]);

  const handleImportPatterns = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const projectData = parseProjectData(JSON.parse(e.target?.result as string));
        applyProject(projectData, 0);
        setSelectedPatternIndex(0);
        setIsSongModeActive(false);

        alert("Project imported successfully!");
      } catch (error) {
        alert(`Error importing project: ${error instanceof Error ? error.message : "Unknown error"}`);
      } finally {
        if (event.target) event.target.value = '';
      }
    };
    reader.readAsText(file);
  }, [setPatterns, setSongSequence, setIsSongLooping, setTimeSignature, setSelectedPatternIndex, setIsSongModeActive]);

  const handleToggleSongMode = useCallback(() => {
    if (isPlaying) {
      sequencerEngine.stop();
      setIsPlaying(false);
    }
    setIsSongModeActive(prev => !prev);
  }, [isPlaying, sequencerEngine, setIsPlaying, setIsSongModeActive]);
  const handleToggleSongLoop = useCallback(() => {
    const newLoopingState = !isSongLooping;
    setIsSongLooping(newLoopingState);
    saveProject(patterns, songSequence, newLoopingState);
  }, [isSongLooping, patterns, songSequence, setIsSongLooping]);

  const handleSongStepClick = useCallback((stepIndex: number) => {
    setSongSequence(prevSequence => {
      const newSequence = [...prevSequence];
      const currentValue = newSequence[stepIndex];
      let nextValue: number | null = null;
      if (currentValue === null) {
        nextValue = 0;
      } else if (currentValue < NUM_PATTERNS - 1) {
        nextValue = currentValue + 1;
      }
      newSequence[stepIndex] = nextValue;
      return newSequence;
    });
  }, [setSongSequence]);

  const handleClearSong = useCallback(() => {
    setSongSequence(Array(SONG_STEPS).fill(null));
  }, [setSongSequence]);

  const handleReset = useCallback(() => {
    if (isPlaying) {
      sequencerEngine.stop();
      setIsPlaying(false);
    }
    applyProject(createDefaultProject(), 0);
    setSelectedPatternIndex(0);
    setClipboard(null);
    setVocoderParams(JSON.parse(JSON.stringify(INITIAL_VOCODER_PARAMS)));
    setIsSongModeActive(false);
    localStorage.removeItem(PROJECT_STORAGE_KEY);
    alert("Application state reset to defaults!");
  }, [isPlaying, sequencerEngine, setIsPlaying, setTimeSignature, setPatterns, setSelectedPatternIndex, setClipboard, setVocoderParams, setIsSongModeActive, setSongSequence, setIsSongLooping]);

  // --- MIDI Output Handlers ---
  const handleMidiOutputChange = useCallback((outputName: string) => {
    sequencerEngine.setMidiOutput(outputName);
  }, [sequencerEngine]);

  const handleMidiInputChange = useCallback((inputName: string) => {
    audioEngine.setMidiInput(inputName);
  }, [audioEngine]);

  // --- Note input (MIDI keyboard / PC keyboard) plays the vocoder's Synth Pitch ---
  const setSynthPitch = useCallback((note: number) => {
    const synthPitch = fitToRange(note, SYNTH_PITCH_MIN, SYNTH_PITCH_MAX);
    if (vocoderParamsRef.current.synthPitch === synthPitch) return;
    const newParams = { ...vocoderParamsRef.current, synthPitch };
    vocoderParamsRef.current = newParams;
    setVocoderParams(newParams);
    audioEngine.updateVocoderParams(newParams);
  }, [audioEngine]);

  // Held note keys from MIDI and the PC keyboard together. The latest one sets Synth Pitch; the synth
  // plays the latest MAX_SYNTH_VOICES of them (Poly) or just the latest (Mono). With no key held it plays
  // Synth Pitch, and the key gate (if on) closes.
  const heldNotesRef = useRef(new HeldNotes());
  // Velocity per held note, and of the last pressed one (used for Synth Pitch when no key is held)
  const noteVelocitiesRef = useRef(new Map<number, number>());
  const lastVelocityRef = useRef(DEFAULT_VELOCITY);
  const updateSynthVoices = useCallback(() => {
    const params = vocoderParamsRef.current;
    const held = heldNotesRef.current.latest(params.poly ? MAX_SYNTH_VOICES : 1);
    const notes = held.length > 0 ? held : [params.synthPitch];
    const velocities = held.length > 0 ? held.map(note => noteVelocitiesRef.current.get(note) ?? DEFAULT_VELOCITY) : [lastVelocityRef.current];
    audioEngine.setSynthNotes(
      notes.map(note => fitToRange(note, SYNTH_PITCH_MIN, SYNTH_PITCH_MAX)),
      // Glide only makes sense for a single line of notes, so it applies in Mono only
      params.poly ? 0 : params.glide,
      velocities.map(velocity => velocityToGain(velocity, params.velocitySensitivity)),
    );
    audioEngine.setNoteKeyHeld(held.length > 0);
  }, [audioEngine]);

  const handleNoteKey = useCallback((note: number, on: boolean, velocity: number) => {
    const held = heldNotesRef.current;
    if (on) {
      noteVelocitiesRef.current.set(note, velocity);
      lastVelocityRef.current = velocity;
    } else {
      noteVelocitiesRef.current.delete(note);
    }
    const current = on ? held.press(note) : held.release(note);
    if (current !== null) setSynthPitch(current);
    updateSynthVoices();
  }, [setSynthPitch, updateSynthVoices]);

  useEffect(() => audioEngine.subscribeMidiNotes(({ note, on, velocity }) => handleNoteKey(note, on, velocity)), [audioEngine, handleNoteKey]);

  // Synth Pitch slider, Mono/Poly and velocity sensitivity changes
  useEffect(() => {
    updateSynthVoices();
  }, [vocoderParams.synthPitch, vocoderParams.poly, vocoderParams.velocitySensitivity, updateSynthVoices]);

  const pcKeyboardBaseRef = useRef(pcKeyboardBase);
  pcKeyboardBaseRef.current = pcKeyboardBase;

  useEffect(() => {
    // Note per key code, as pressed: releasing must stop that note even if the octave changed meanwhile
    const pressed = new Map<string, number>();
    const isTyping = (target: EventTarget | null) =>
      target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName));

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
      if (e.code === PC_OCTAVE_DOWN || e.code === PC_OCTAVE_UP) {
        const step = e.code === PC_OCTAVE_UP ? 12 : -12;
        setPcKeyboardBase(base => Math.min(Math.max(base + step, SYNTH_PITCH_MIN), SYNTH_PITCH_MAX - 12));
        return;
      }
      const note = pcKeyToNote(e.code, pcKeyboardBaseRef.current);
      if (note === undefined) return;
      pressed.set(e.code, note);
      handleNoteKey(note, true, DEFAULT_VELOCITY); // the PC keyboard has no velocity
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      const note = pressed.get(e.code);
      if (note === undefined) return;
      pressed.delete(e.code);
      handleNoteKey(note, false, 0);
    };
    // Keys released while the window is unfocused never send keyup
    const handleBlur = () => {
      pressed.forEach(note => handleNoteKey(note, false, 0));
      pressed.clear();
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, [handleNoteKey]);

  // --- Bassline Handlers ---
  const handleBasslineParamChange = useCallback((param: keyof BasslineParams, value: number | Waveform | boolean) => {
    updateCurrentPattern(p => ({ ...p, bassline: { ...p.bassline!, params: { ...p.bassline!.params, [param]: value } } }));
  }, [updateCurrentPattern]);

  // --- Vocoder Handlers ---
  const handleVocoderParamChange = useCallback((param: keyof VocoderParams, value: string | number | boolean) => {
    const newParams = { ...vocoderParams, [param]: value };
    setVocoderParams(newParams);
    audioEngine.updateVocoderParams(newParams);

    if (param === 'enabled') {
      audioEngine.toggleVocoder(value as boolean).catch(() => {
        setVocoderParams(prev => ({ ...prev, enabled: false }));
      });
    }
  }, [vocoderParams, setVocoderParams, audioEngine]);

  // Stable references so the memoised VocoderControls doesn't restart the visualizer on every render
  const startMicVisualizer = useCallback((canvas: HTMLCanvasElement) => audioEngine.startMicVisualizer(canvas), [audioEngine]);
  const stopMicVisualizer = useCallback(() => audioEngine.stopMicVisualizer(), [audioEngine]);

  const handleBasslineNoteClick = useCallback((stepIndex: number, note: number) => {
    updateCurrentPattern(p => {
      const newSequence = JSON.parse(JSON.stringify(p.bassline!.sequence));
      const step = newSequence[stepIndex];
      if (step.note === note) {
        const newVelocity = ((step.velocity + 1) % 6) as Velocity;
        newSequence[stepIndex] = newVelocity === 0 ? { ...step, note: null, velocity: 0 } : { ...step, velocity: newVelocity };
      } else {
        newSequence[stepIndex] = { ...step, note: note, velocity: 1 };
      }
      return { ...p, bassline: { ...p.bassline!, sequence: newSequence } };
    });
  }, [updateCurrentPattern]);

  const handleClearBasslineStep = useCallback((stepIndex: number) => {
    updateCurrentPattern(p => {
      const newSequence = JSON.parse(JSON.stringify(p.bassline!.sequence));
      newSequence[stepIndex] = { ...newSequence[stepIndex], note: null, velocity: 0 };
      return { ...p, bassline: { ...p.bassline!, sequence: newSequence } };
    });
  }, [updateCurrentPattern]);

  const handleBasslineControlToggle = useCallback((stepIndex: number, control: 'slide' | 'tie') => {
    updateCurrentPattern(p => {
      const newSequence = JSON.parse(JSON.stringify(p.bassline!.sequence));
      newSequence[stepIndex] = { ...newSequence[stepIndex], [control]: !newSequence[stepIndex][control] };
      return { ...p, bassline: { ...p.bassline!, sequence: newSequence } };
    });
  }, [updateCurrentPattern]);

  return (
    <div className="bg-gray-900 text-white min-h-screen flex flex-col items-center justify-start p-4 font-sans">
      <div className="w-full max-w-7xl mx-auto space-y-6">
        <header className="text-center">
          <h1 className="text-4xl md:text-5xl font-bold text-yellow-400 tracking-tight">O Grove Son</h1>
          <p className="text-gray-400 mt-1">Unha caixa de ritmos con liña de baixo e vocoder</p>
        </header>
        <main className="space-y-6 flex flex-col items-center">
          <TransportControls isPlaying={isPlaying} onPlayToggle={handlePlayToggle} tempo={tempo} onTempoChange={handleTempoChange} swing={swing} onSwingChange={handleSwingChange} timeSignature={timeSignature} onTimeSignatureChange={handleTimeSignatureChange} masterVolume={masterVolume} onMasterVolumeChange={handleMasterVolumeChange} />
          <div className="flex flex-col md:flex-row gap-4">
            <MidiPortSelector id="midi-output" label="MIDI Output" fixedOptions={MIDI_OUTPUT_OPTIONS} onSelect={handleMidiOutputChange} subscribePorts={audioEngine.subscribeMidiOutputs} />
            <MidiPortSelector id="midi-input" label="MIDI Input" fixedOptions={MIDI_INPUT_OPTIONS} onSelect={handleMidiInputChange} subscribePorts={audioEngine.subscribeMidiInputs} />
          </div>
          <PatternControls patterns={patterns} selectedPatternIndex={selectedPatternIndex} onLoad={handleLoadPattern} onSave={handleSavePattern} onExport={handleExportPatterns} onImport={handleImportPatterns} onCopy={handleCopyPattern} onPaste={handlePastePattern} isClipboardEmpty={clipboard === null} isPlaying={isPlaying} onReset={handleReset} />
          <SongSequencer sequence={songSequence} isActive={isSongModeActive} isLooping={isSongLooping} currentStep={currentSongStep} onToggle={handleToggleSongMode} onToggleLoop={handleToggleSongLoop} onStepClick={handleSongStepClick} onClear={handleClearSong} />

          {isLoaded && (
            <>
              <Sequencer instruments={instruments} currentStep={currentStep} selectedInstrumentId={selectedInstrumentId} timeSignature={timeSignature} onStepClick={handleStepClick} onStepClear={handleClearStep} onInstrumentSelect={handleInstrumentSelect} onMuteToggle={handleMuteToggle} onSoloToggle={handleSoloToggle} onParamChange={handleParamChange} onVolumeChange={handleVolumeChange} onInstrumentAction={handleInstrumentAction} isInstrumentPasteDisabled={instrumentClipboard === null} />
              <BasslineSequencer basslinePattern={basslinePattern} currentStep={currentStep} timeSignature={timeSignature} onNoteClick={handleBasslineNoteClick} onStepClear={handleClearBasslineStep} onParamChange={handleBasslineParamChange} onControlToggle={handleBasslineControlToggle} />
              <VocoderControls
                params={vocoderParams}
                onParamChange={handleVocoderParamChange}
                pcKeyboardBase={pcKeyboardBase}
                startVisualizer={startMicVisualizer}
                stopVisualizer={stopMicVisualizer}
              />
            </>
          )}
        </main>

        <footer className="text-center text-gray-500 text-sm">
          <p>Sound synthesis powered by the Web Audio API.</p>
        </footer>
      </div>
    </div>
  );
};

export default App;