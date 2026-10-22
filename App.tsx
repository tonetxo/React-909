import React, { useState, useEffect, useRef, useCallback } from 'react';
import { SequencerEngine } from './sequencer/SequencerEngine';
import Sequencer from './components/Sequencer';
import TransportControls from './components/TransportControls';
import PatternControls from './components/PatternControls';
import SongSequencer from './components/SongSequencer';
import BasslineSequencer from './components/BasslineSequencer';
import VocoderControls from './components/VocoderControls';
import MidiOutputSelector from './components/MidiOutputSelector';
import { Velocity, InstrumentParams, Pattern, ProjectData, BasslineParams, Waveform, VocoderParams, VocoderType, TimeSignature } from './types';
import { INITIAL_VOCODER_PARAMS } from './constants';
import { audioEngine } from './services/audioService';
import { NUM_PATTERNS, SONG_STEPS, stepsFromTimeSig, resizeSequence, emptyBasslineStep, createDefaultPattern, createDefaultProject, parseProjectData, serializeProject } from './services/projectIO';

const PROJECT_STORAGE_KEY = 'gemini-groove-project';

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

  const [vocoderType, setVocoderType] = useState<VocoderType>('original');
  const [vocoderParams, setVocoderParams] = useState<VocoderParams>(JSON.parse(JSON.stringify(INITIAL_VOCODER_PARAMS)));

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

  const handleVocoderTypeChange = useCallback((type: VocoderType) => {
    setVocoderType(type);
    audioEngine.setVocoderType(type);
  }, [setVocoderType, audioEngine]);

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
          <MidiOutputSelector onOutputSelect={handleMidiOutputChange} subscribeOutputs={audioEngine.subscribeMidiOutputs} />
          <PatternControls patterns={patterns} selectedPatternIndex={selectedPatternIndex} onLoad={handleLoadPattern} onSave={handleSavePattern} onExport={handleExportPatterns} onImport={handleImportPatterns} onCopy={handleCopyPattern} onPaste={handlePastePattern} isClipboardEmpty={clipboard === null} isPlaying={isPlaying} onReset={handleReset} />
          <SongSequencer sequence={songSequence} isActive={isSongModeActive} isLooping={isSongLooping} currentStep={currentSongStep} onToggle={handleToggleSongMode} onToggleLoop={handleToggleSongLoop} onStepClick={handleSongStepClick} onClear={handleClearSong} />

          {isLoaded && (
            <>
              <Sequencer instruments={instruments} currentStep={currentStep} selectedInstrumentId={selectedInstrumentId} timeSignature={timeSignature} onStepClick={handleStepClick} onStepClear={handleClearStep} onInstrumentSelect={handleInstrumentSelect} onMuteToggle={handleMuteToggle} onSoloToggle={handleSoloToggle} onParamChange={handleParamChange} onVolumeChange={handleVolumeChange} onInstrumentAction={handleInstrumentAction} isInstrumentPasteDisabled={instrumentClipboard === null} />
              <BasslineSequencer basslinePattern={basslinePattern} currentStep={currentStep} timeSignature={timeSignature} onNoteClick={handleBasslineNoteClick} onStepClear={handleClearBasslineStep} onParamChange={handleBasslineParamChange} onControlToggle={handleBasslineControlToggle} />
              <VocoderControls
                params={vocoderParams}
                onParamChange={handleVocoderParamChange}
                vocoderType={vocoderType}
                onVocoderTypeChange={handleVocoderTypeChange}
                startVisualizer={(canvas) => audioEngine.startMicVisualizer(canvas)}
                stopVisualizer={() => audioEngine.stopMicVisualizer()}
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