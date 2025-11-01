import React, { useState, useEffect, useRef, useCallback } from 'react';
import { SequencerEngine } from './sequencer/SequencerEngine';
import Sequencer from './components/Sequencer';
import TransportControls from './components/TransportControls';
import PatternControls from './components/PatternControls';
import SongSequencer from './components/SongSequencer';
import BasslineSequencer from './components/BasslineSequencer';
import VocoderControls from './components/VocoderControls';
import { Instrument, Velocity, InstrumentParams, Pattern, ProjectData, BasslineParams, Waveform, BasslinePattern, VocoderParams, VocoderCarrier, VocoderType, TimeSignature } from './types';
import { getInitialInstruments, INITIAL_TEMPO, INITIAL_SWING, getInitialBasslinePattern, INITIAL_VOCODER_PARAMS } from './constants';
import { playSound, playBasslineNote, toggleVocoder, updateVocoderParams, startMicVisualizer, stopMicVisualizer, ensureAudioInitialized, setVocoderType as setAudioServiceVocoderType } from './services/audioService';

const PROJECT_STORAGE_KEY = 'gemini-groove-project';
const NUM_PATTERNS = 4;
const SONG_STEPS = 16;

const mergeInstrumentData = (loadedInstruments: Instrument[], steps: number): Instrument[] => {
    // Start with a fresh deep copy of the default instruments.
    const newInstruments = JSON.parse(JSON.stringify(getInitialInstruments(steps)));

    if (!Array.isArray(loadedInstruments)) {
        return newInstruments;
    }

    const loadedInstrumentsMap = new Map<string, Instrument>();
    loadedInstruments.forEach(inst => {
        if (inst && inst.id) {
            loadedInstrumentsMap.set(inst.id, inst);
        }
    });

    newInstruments.forEach((instrument: Instrument) => {
        const loadedData = loadedInstrumentsMap.get(instrument.id);
        if (loadedData) {
            instrument.volume = loadedData.volume ?? instrument.volume;
            instrument.isMuted = loadedData.isMuted ?? instrument.isMuted;
            instrument.isSolo = loadedData.isSolo ?? instrument.isSolo;
            
            if (loadedData.params) {
                instrument.params = { ...instrument.params, ...loadedData.params };
            }

            if (Array.isArray(loadedData.sequence) && loadedData.sequence.length === steps) {
                instrument.sequence = loadedData.sequence;
            }
        }
    });

    return newInstruments;
};


const mergePatternData = (loadedPattern: Pattern | null, timeSignature: TimeSignature, steps: number): Pattern => {
    const defaultBassline = JSON.parse(JSON.stringify(getInitialBasslinePattern(steps)));
    if (!loadedPattern) {
        return {
            tempo: INITIAL_TEMPO,
            swing: INITIAL_SWING,
            timeSignature: timeSignature,
            instruments: mergeInstrumentData([], steps),
            bassline: defaultBassline,
        };
    }
     // Basic migration for older projects without velocity
    const migratedBasslineSequence = (loadedPattern.bassline?.sequence || defaultBassline.sequence).map((step: any) => ({
        note: step.note,
        velocity: step.velocity ?? (step.accent ? 3 : 0),
        slide: step.slide ?? false,
    }));


    return {
        tempo: loadedPattern.tempo,
        swing: loadedPattern.swing,
        timeSignature: loadedPattern.timeSignature || timeSignature, // Use loaded or default
        instruments: mergeInstrumentData(loadedPattern.instruments, steps),
        bassline: loadedPattern.bassline 
            ? {
                sequence: migratedBasslineSequence.length === steps ? migratedBasslineSequence : defaultBassline.sequence,
                params: { ...defaultBassline.params, ...loadedPattern.bassline.params }
            }
            : defaultBassline,
    };
};

const App: React.FC = () => {
  const [timeSignature, setTimeSignature] = useState<TimeSignature>([4, 4]);
  const [stepsPerSequence, setStepsPerSequence] = useState<number>(16);
  const [instruments, setInstruments] = useState<Instrument[]>(getInitialInstruments(stepsPerSequence));
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [tempo, setTempo] = useState<number>(INITIAL_TEMPO);
  const [swing, setSwing] = useState<number>(INITIAL_SWING);
  const [currentStep, setCurrentStep] = useState<number | null>(null);
  const [selectedInstrumentId, setSelectedInstrumentId] = useState<string | null>(null);
  
  const [patterns, setPatterns] = useState<(Pattern | null)[]>(() => Array(NUM_PATTERNS).fill(null).map(() => ({
    tempo: INITIAL_TEMPO,
    swing: INITIAL_SWING,
    timeSignature: [4, 4],
    instruments: getInitialInstruments(stepsPerSequence),
    bassline: getInitialBasslinePattern(stepsPerSequence),
  })));
  const [selectedPatternIndex, setSelectedPatternIndex] = useState<number>(0);
  const [clipboard, setClipboard] = useState<Pattern | null>(null);
  
  const [basslinePattern, setBasslinePattern] = useState<BasslinePattern>(getInitialBasslinePattern(stepsPerSequence));
  const [vocoderType, setVocoderType] = useState<VocoderType>('original');
  const [vocoderParams, setVocoderParams] = useState<VocoderParams>(JSON.parse(JSON.stringify(INITIAL_VOCODER_PARAMS)));

  const vocoderParamsRef = useRef<VocoderParams>(JSON.parse(JSON.stringify(INITIAL_VOCODER_PARAMS)));
  vocoderParamsRef.current = vocoderParams;

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
        localStorage.setItem(PROJECT_STORAGE_KEY, JSON.stringify(projectData));
    } catch (error) {
        console.error("Failed to save project to localStorage:", error);
    }
  };

  useEffect(() => {
    try {
      const savedProject = localStorage.getItem(PROJECT_STORAGE_KEY);
      if (savedProject) {
        const parsedProject = JSON.parse(savedProject) as ProjectData;
        if (parsedProject.patterns && parsedProject.song) {
            const mergedPatterns = parsedProject.patterns.map(p => {
                const ts = p?.timeSignature || [4, 4];
                const steps = ts[1] === 8 ? ts[0] * 2 : ts[0] * 4;
                return mergePatternData(p, ts, steps);
            });
            setPatterns(mergedPatterns);
            setSongSequence(parsedProject.song.sequence ?? Array(SONG_STEPS).fill(null));
            setIsSongLooping(parsedProject.song.isLooping ?? false);
            
            const currentPattern = mergedPatterns[selectedPatternIndex];
            if (currentPattern) {
                setTempo(currentPattern.tempo);
                setSwing(currentPattern.swing);
                setTimeSignature(currentPattern.timeSignature);
                setInstruments(currentPattern.instruments);
                setBasslinePattern(currentPattern.bassline!);
            }
        } else {
            throw new Error("Invalid project data");
        }
      } else {
        const mergedPattern = mergePatternData(null, timeSignature, stepsPerSequence);
        setPatterns([mergedPattern, null, null, null]);
        setInstruments(mergedPattern.instruments);
        setBasslinePattern(mergedPattern.bassline!);
      }
    } catch (error) {
        console.error("Failed to load project:", error);
        const mergedPattern = mergePatternData(null, timeSignature, stepsPerSequence);
        setPatterns([mergedPattern, null, null, null]);
        setInstruments(mergedPattern.instruments);
        setBasslinePattern(mergedPattern.bassline!);
    } finally {
        setIsLoaded(true);
    }
  }, []);
  


  const loadPatternState = useCallback((patternIndex: number, songStepIndex: number | null = null) => {
    const patternToLoad = patterns[patternIndex];
    const ts = patternToLoad?.timeSignature || [4, 4];
    const steps = ts[1] === 8 ? ts[0] * 2 : ts[0] * 4;

    const mergedPattern = mergePatternData(patternToLoad, ts, steps);
    
    setSelectedPatternIndex(patternIndex);
    setCurrentSongStep(songStepIndex);
    
    setTempo(mergedPattern.tempo);
    setSwing(mergedPattern.swing);
    setTimeSignature(mergedPattern.timeSignature);
    setStepsPerSequence(steps);
    setInstruments(mergedPattern.instruments);
    setBasslinePattern(mergedPattern.bassline!);
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
  
  // --- Vocoder Initialization ---
  useEffect(() => {
    updateVocoderParams(vocoderParams);
    if (INITIAL_VOCODER_PARAMS.enabled) {
      toggleVocoder(true).catch(() => {
        setVocoderParams(prev => ({...prev, enabled: false}));
      });
    }
  }, []); // Run only once on mount

  const handlePlayToggle = async () => {
    if (!isLoaded) return;
    await sequencerEngine.togglePlayback(tempo, swing);
    setIsPlaying(sequencerEngine.isPlayingState());
  };

  const handleTempoChange = (e: React.ChangeEvent<HTMLInputElement>) => setTempo(Number(e.target.value));
  const handleSwingChange = (e: React.ChangeEvent<HTMLInputElement>) => setSwing(Number(e.target.value));

  useEffect(() => {
    const [beats, beatType] = timeSignature;
    const newStepsPerSequence = beatType === 8 ? beats * 2 : beats * 4;
    setStepsPerSequence(newStepsPerSequence);
  }, [timeSignature]);

  const handleTimeSignatureChange = (newTimeSignature: TimeSignature) => {
    setTimeSignature(newTimeSignature);

    const [beats, beatType] = newTimeSignature;
    const newSteps = beatType === 8 ? beats * 2 : beats * 4;

    const resizeSequence = (sequence: any[]) => {
      const currentLength = sequence.length;
      if (currentLength === newSteps) {
        return sequence;
      }
      if (currentLength > newSteps) {
        return sequence.slice(0, newSteps);
      }
      // Pad with default values
      const newSequence = [...sequence];
      for (let i = currentLength; i < newSteps; i++) {
        newSequence.push(0);
      }
      return newSequence;
    };

    setInstruments(prev => prev.map(instrument => ({
      ...instrument,
      sequence: resizeSequence(instrument.sequence),
    })));

    setBasslinePattern(prev => ({
      ...prev,
      sequence: resizeSequence(prev.sequence).map(s => typeof s === 'number' ? { note: null, velocity: 0, slide: false } : s),
    }));
  };

  const updateCurrentPattern = (updater: (pattern: Pattern) => Pattern) => {
      const newPatterns = [...patterns];
      const currentPattern = newPatterns[selectedPatternIndex] ?? mergePatternData(null, timeSignature, stepsPerSequence);
      newPatterns[selectedPatternIndex] = updater(currentPattern);
      setPatterns(newPatterns);
      return newPatterns;
  }

  const handleStepClick = (instrumentIndex: number, stepIndex: number) => {
    setInstruments(prev => {
      const newInstruments = JSON.parse(JSON.stringify(prev));
      const newSequence = newInstruments[instrumentIndex].sequence;
      newSequence[stepIndex] = ((newSequence[stepIndex] + 1) % 6) as Velocity;
      return newInstruments;
    });
  };

  const handleInstrumentSelect = (id: string) => setSelectedInstrumentId(prev => prev === id ? null : id);
  const handleMuteToggle = (id: string) => setInstruments(prev => prev.map(i => i.id === id ? { ...i, isMuted: !i.isMuted } : i));
  const handleSoloToggle = (id: string) => {
    setInstruments(prev => {
        const isSolo = !prev.find(i => i.id === id)?.isSolo;
        return prev.map(i => ({ ...i, isSolo: i.id === id ? isSolo : false }));
    });
  };
  const handleParamChange = (id: string, param: keyof InstrumentParams, value: number) => {
    setInstruments(prev => prev.map(i => i.id === id ? { ...i, params: { ...i.params, [param]: value } } : i));
  };
  const handleVolumeChange = (id: string, value: number) => {
    setInstruments(prev => prev.map(i => i.id === id ? { ...i, volume: value } : i));
  };

  const handleSavePattern = () => {
    const newPattern: Pattern = { tempo, swing, timeSignature, instruments, bassline: basslinePattern };
    const newPatterns = [...patterns];
    newPatterns[selectedPatternIndex] = newPattern;
    setPatterns(newPatterns);
    saveProject(newPatterns, songSequence, isSongLooping);
  };
  const handleLoadPattern = async (index: number) => {
    if (isPlaying) {
        await sequencerEngine.loadPattern(index);
    } else {
        loadPatternState(index);
    }
    setIsSongModeActive(false);
  };
  const handleCopyPattern = () => setClipboard({ tempo, swing, timeSignature, instruments, bassline: basslinePattern });
  const handlePastePattern = () => {
    if (clipboard) {
      // 1. Update the patterns array
      const newPatterns = [...patterns];
      // Deep copy the clipboard pattern to avoid reference issues
      const pastedPattern = JSON.parse(JSON.stringify(clipboard));
      newPatterns[selectedPatternIndex] = pastedPattern;
      setPatterns(newPatterns);
      saveProject(newPatterns, songSequence, isSongLooping);

      // 2. Load the state from the just-pasted pattern
      const ts = pastedPattern.timeSignature || [4, 4];
      const steps = ts[1] === 8 ? ts[0] * 2 : ts[0] * 4;
      const merged = mergePatternData(pastedPattern, ts, steps);
      
      setTempo(merged.tempo);
      setSwing(merged.swing);
      setTimeSignature(merged.timeSignature);
      setStepsPerSequence(steps); // This is important!
      setInstruments(merged.instruments);
      setBasslinePattern(merged.bassline!);
    }
  };
  const handleExportPatterns = () => {
    const projectData: ProjectData = { patterns, song: { sequence: songSequence, isLooping: isSongLooping } };
    const blob = new Blob([JSON.stringify(projectData, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `gemini-groove-project-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  };
  const handleImportPatterns = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = JSON.parse(e.target?.result as string);
            const projectData: ProjectData = Array.isArray(data) ? { patterns: data, song: { sequence: Array(SONG_STEPS).fill(null), isLooping: false } } : data;
            
            if (!projectData.patterns || !projectData.song) throw new Error("Invalid project file");
            
            const looping = projectData.song.isLooping ?? false;
            const mergedPatterns = projectData.patterns.map(p => mergePatternData(p, p?.timeSignature || [4, 4], p?.timeSignature ? (p.timeSignature[1] === 8 ? p.timeSignature[0] * 2 : p.timeSignature[0] * 4) : 16));
            setPatterns(mergedPatterns);
            setSongSequence(projectData.song.sequence);
            setIsSongLooping(looping);
            saveProject(mergedPatterns, projectData.song.sequence, looping);
            
            setIsSongModeActive(false);
            
            const currentPattern = mergedPatterns[selectedPatternIndex];
            if (currentPattern) {
                setTempo(currentPattern.tempo);
                setSwing(currentPattern.swing);
                setTimeSignature(currentPattern.timeSignature);
                setInstruments(currentPattern.instruments);
                setBasslinePattern(currentPattern.bassline!);
            }
            alert("Project imported successfully!");
        } catch (error) {
            alert(`Error importing project: ${error instanceof Error ? error.message : "Unknown error"}`);
        } finally {
            if (event.target) event.target.value = '';
        }
    };
    reader.readAsText(file);
  };

  const handleToggleSongMode = () => { if (isPlaying) setIsPlaying(false); setIsSongModeActive(prev => !prev); };
  const handleToggleSongLoop = () => {
    const newLoopingState = !isSongLooping;
    setIsSongLooping(newLoopingState);
    saveProject(patterns, songSequence, newLoopingState);
  };
  const handleSongStepClick = (stepIndex: number) => {
    const newSequence = [...songSequence];
    const currentValue = newSequence[stepIndex];
    
    let nextValue: number;

    if (currentValue === null) {
        nextValue = 0; // From null -> P1
    } else {
        // Cycle from 0 to 3, and then back to 0 (P1 -> P2 -> P3 -> P4 -> P1)
        nextValue = (currentValue + 1) % NUM_PATTERNS;
    }
    
    newSequence[stepIndex] = nextValue;
    setSongSequence(newSequence);
    saveProject(patterns, newSequence, isSongLooping);
  };
  const handleClearSong = () => {
    const newSequence = Array(SONG_STEPS).fill(null);
    setSongSequence(newSequence);
    saveProject(patterns, newSequence, isSongLooping);
  };

  const handleReset = () => {
    if (isPlaying) setIsPlaying(false); // Stop playback

    // Reset all state variables to their initial values
    setInstruments(getInitialInstruments(16)); // Deep copy
    setTempo(INITIAL_TEMPO);
    setSwing(INITIAL_SWING);
    setTimeSignature([4, 4]);
    setStepsPerSequence(16);
    setCurrentStep(null);
    setSelectedInstrumentId(null);
    setPatterns(Array(NUM_PATTERNS).fill(null));
    setSelectedPatternIndex(0);
    setClipboard(null);
    setBasslinePattern(getInitialBasslinePattern(16)); // Deep copy
    setVocoderParams(JSON.parse(JSON.stringify(INITIAL_VOCODER_PARAMS))); // Deep copy
    setIsSongModeActive(false);
    setSongSequence(Array(SONG_STEPS).fill(null));
    setIsSongLooping(false);
    setCurrentSongStep(null);

    // Clear local storage
    localStorage.removeItem(PROJECT_STORAGE_KEY);

    alert("Application state reset to defaults!");
  };

  // --- Bassline Handlers ---
  const handleBasslineParamChange = (param: keyof BasslineParams, value: number | Waveform) => {
    setBasslinePattern(prev => ({ ...prev, params: { ...prev.params, [param]: value }}));
  };

  // --- Vocoder Handlers ---
  const handleVocoderParamChange = (param: keyof VocoderParams, value: string | number | boolean) => {
    const newParams = { ...vocoderParams, [param]: value };
    setVocoderParams(newParams);
    updateVocoderParams(newParams);

    if (param === 'enabled') {
      toggleVocoder(value as boolean).catch(() => {
        // Revert the state if permission is denied
        setVocoderParams(prev => ({...prev, enabled: false}));
      });
    }
  };

  const handleVocoderTypeChange = (type: VocoderType) => {
    setVocoderType(type);
    setAudioServiceVocoderType(type);
  };



  const handleBasslineNoteClick = (stepIndex: number, note: number) => {
    setBasslinePattern(prev => {
        const newSequence = JSON.parse(JSON.stringify(prev.sequence));
        const step = newSequence[stepIndex];
        const currentNote = step.note;
        const currentVelocity = step.velocity;

        if (currentNote === note) {
            const newVelocity = ((currentVelocity + 1) % 6) as Velocity;
            if (newVelocity === 0) {
                newSequence[stepIndex] = { ...step, note: null, velocity: 0 };
            } else {
                newSequence[stepIndex] = { ...step, velocity: newVelocity };
            }
        } else {
            newSequence[stepIndex] = { ...step, note: note, velocity: 1 };
        }
        
        return { ...prev, sequence: newSequence };
    });
  };

  const handleBasslineControlToggle = (stepIndex: number, control: 'slide') => {
    setBasslinePattern(prev => {
        const newSequence = JSON.parse(JSON.stringify(prev.sequence));
        newSequence[stepIndex] = { ...newSequence[stepIndex], [control]: !newSequence[stepIndex][control] };
        return { ...prev, sequence: newSequence };
    });
  };

  return (
    <div className="bg-gray-900 text-white min-h-screen flex flex-col items-center justify-start p-4 font-sans">
      <div className="w-full max-w-7xl mx-auto space-y-6">
        <header className="text-center">
          <h1 className="text-4xl md:text-5xl font-bold text-yellow-400 tracking-tight">O Grove Son</h1>
          <p className="text-gray-400 mt-1">A web-based step sequencer</p>
        </header>
        <main className="space-y-6 flex flex-col items-center">
          <TransportControls isPlaying={isPlaying} onPlayToggle={handlePlayToggle} tempo={tempo} onTempoChange={handleTempoChange} swing={swing} onSwingChange={handleSwingChange} timeSignature={timeSignature} onTimeSignatureChange={handleTimeSignatureChange} />
          <PatternControls patterns={patterns} selectedPatternIndex={selectedPatternIndex} onLoad={handleLoadPattern} onSave={handleSavePattern} onExport={handleExportPatterns} onImport={handleImportPatterns} onCopy={handleCopyPattern} onPaste={handlePastePattern} isClipboardEmpty={clipboard === null} isPlaying={isPlaying} onReset={handleReset} />
          <SongSequencer sequence={songSequence} isActive={isSongModeActive} isLooping={isSongLooping} currentStep={currentSongStep} onToggle={handleToggleSongMode} onToggleLoop={handleToggleSongLoop} onStepClick={handleSongStepClick} onClear={handleClearSong} />
          
          {isLoaded && (
            <>
              <Sequencer instruments={instruments} currentStep={currentStep} selectedInstrumentId={selectedInstrumentId} timeSignature={timeSignature} onStepClick={handleStepClick} onInstrumentSelect={handleInstrumentSelect} onMuteToggle={handleMuteToggle} onSoloToggle={handleSoloToggle} onParamChange={handleParamChange} onVolumeChange={handleVolumeChange} />
              <BasslineSequencer basslinePattern={basslinePattern} currentStep={currentStep} timeSignature={timeSignature} onNoteClick={handleBasslineNoteClick} onParamChange={handleBasslineParamChange} onControlToggle={handleBasslineControlToggle} />
              <VocoderControls 
                params={vocoderParams} 
                onParamChange={handleVocoderParamChange}
                vocoderType={vocoderType}
                onVocoderTypeChange={handleVocoderTypeChange}
                startVisualizer={startMicVisualizer}
                stopVisualizer={stopMicVisualizer}
              />
            </>
          )}
        </main>
        
        <footer className="mt-8 text-center text-gray-500 text-sm">
          <p>Sound synthesis powered by the Web Audio API.</p>
        </footer>
      </div>
    </div>
  );
};

export default App;