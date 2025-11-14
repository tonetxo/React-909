import React, { useState, useEffect, useRef, useCallback } from 'react';
import { SequencerEngine } from './sequencer/SequencerEngine';
import Sequencer from './components/Sequencer';
import TransportControls from './components/TransportControls';
import PatternControls from './components/PatternControls';
import SongSequencer from './components/SongSequencer';
import BasslineSequencer from './components/BasslineSequencer';
import VocoderControls from './components/VocoderControls';
import MidiOutputSelector from './components/MidiOutputSelector';
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
        tie: step.tie ?? false, // Add this line
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

  const [isPlaying, setIsPlaying] = useState<boolean>(false);
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
  const [instrumentClipboard, setInstrumentClipboard] = useState<Velocity[] | null>(null);
  
  const [vocoderType, setVocoderType] = useState<VocoderType>('original');
  const [vocoderParams, setVocoderParams] = useState<VocoderParams>(JSON.parse(JSON.stringify(INITIAL_VOCODER_PARAMS)));

  // --- Derived State ---
  const activePattern = patterns[selectedPatternIndex] ?? mergePatternData(null, timeSignature, stepsPerSequence);
  const { tempo, swing, instruments, bassline: basslinePattern } = activePattern;

  

  const vocoderParamsRef = useRef<VocoderParams>(JSON.parse(JSON.stringify(INITIAL_VOCODER_PARAMS)));
  vocoderParamsRef.current = vocoderParams;

  const saveTimeoutRef = useRef<number | null>(null);

  // Song Mode State
  const [isSongModeActive, setIsSongModeActive] = useState<boolean>(false);
  const [songSequence, setSongSequence] = useState<(number | null)[]>(() => Array(SONG_STEPS).fill(null));
  const [isSongLooping, setIsSongLooping] = useState<boolean>(false);
  const [currentSongStep, setCurrentSongStep] = useState<number | null>(null);



  const [isLoaded, setIsLoaded] = useState<boolean>(false);
  
  // MIDI Output Selection
  const [selectedMidiOutput, setSelectedMidiOutput] = useState<string>('');
  
  const saveProject = (patternsToSave: (Pattern | null)[], songSeqToSave: (number | null)[], isLoopingToSave: boolean) => {
     try {
        const projectData: ProjectData = {
            patterns: patternsToSave,
            song: { sequence: songSeqToSave, isLooping: isLoopingToSave },
        };
        localStorage.setItem(PROJECT_STORAGE_KEY, JSON.stringify(projectData));
        console.log("Project saved to localStorage.");
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
                setTimeSignature(currentPattern.timeSignature);
            }
        } else {
            throw new Error("Invalid project data");
        }
      } else {
        // If no saved project, ensure the initial pattern is correctly set up
        // based on the initial time signature and steps.
        const mergedPattern = mergePatternData(null, timeSignature, stepsPerSequence);
        setPatterns([mergedPattern, null, null, null]);
      }
    } catch (error) {
        console.error("Failed to load project:", error);
        // If loading fails, create a default pattern.
        const mergedPattern = mergePatternData(null, timeSignature, stepsPerSequence);
        setPatterns([mergedPattern, null, null, null]);
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

  const handleTempoChange = (newTempo: number) => updateCurrentPattern(p => ({ ...p, tempo: newTempo }));
  const handleSwingChange = (newSwing: number) => updateCurrentPattern(p => ({ ...p, swing: newSwing }));

  useEffect(() => {
    const [beats, beatType] = timeSignature;
    const newStepsPerSequence = beatType === 8 ? beats * 2 : beats * 4;
    setStepsPerSequence(newStepsPerSequence);
  }, [timeSignature]);

  const updateCurrentPattern = useCallback((updater: (pattern: Pattern) => Pattern) => {
    setPatterns(prevPatterns => {
      const newPatterns = [...prevPatterns];
      const currentPattern = newPatterns[selectedPatternIndex] ?? mergePatternData(null, timeSignature, stepsPerSequence);
      newPatterns[selectedPatternIndex] = updater(currentPattern);
      return newPatterns;
    });
  }, [selectedPatternIndex, timeSignature, stepsPerSequence]);

  const handleTimeSignatureChange = (newTimeSignature: TimeSignature) => {
    setTimeSignature(newTimeSignature);
    const newSteps = newTimeSignature[1] === 8 ? newTimeSignature[0] * 2 : newTimeSignature[0] * 4;
    const resize = (seq: any[]) => {
        if (seq.length === newSteps) return seq;
        return seq.length > newSteps ? seq.slice(0, newSteps) : [...seq, ...Array(newSteps - seq.length).fill(0)];
    };
    updateCurrentPattern(p => ({
        ...p,
        timeSignature: newTimeSignature,
        instruments: p.instruments.map(inst => ({ ...inst, sequence: resize(inst.sequence) })),
        bassline: { ...p.bassline!, sequence: resize(p.bassline!.sequence).map(s => typeof s === 'number' ? { note: null, velocity: 0, slide: false, tie: false } : s) }
    }));
  };

  const handleStepClick = (instrumentIndex: number, stepIndex: number) => {
    updateCurrentPattern(p => {
        const newInstruments = JSON.parse(JSON.stringify(p.instruments));
        const sequence = newInstruments[instrumentIndex].sequence;
        sequence[stepIndex] = ((sequence[stepIndex] + 1) % 6) as Velocity;
        return { ...p, instruments: newInstruments };
    });
  };

  const handleClearStep = (instrumentIndex: number, stepIndex: number) => {
    updateCurrentPattern(p => {
        const newInstruments = JSON.parse(JSON.stringify(p.instruments));
        newInstruments[instrumentIndex].sequence[stepIndex] = 0;
        return { ...p, instruments: newInstruments };
    });
  };

  const handleInstrumentSelect = (id: string) => setSelectedInstrumentId(prev => prev === id ? null : id);
  const handleMuteToggle = (id: string) => updateCurrentPattern(p => ({ ...p, instruments: p.instruments.map(i => i.id === id ? { ...i, isMuted: !i.isMuted } : i) }));
  const handleSoloToggle = (id: string) => {
    updateCurrentPattern(p => {
        const isCurrentlySolo = p.instruments.find(i => i.id === id)?.isSolo;
        return { ...p, instruments: p.instruments.map(i => ({ ...i, isSolo: i.id === id ? !isCurrentlySolo : false })) };
    });
  };
  const handleParamChange = (id: string, param: keyof InstrumentParams, value: number) => updateCurrentPattern(p => ({ ...p, instruments: p.instruments.map(i => i.id === id ? { ...i, params: { ...i.params, [param]: value } } : i) }));
  const handleVolumeChange = (id: string, value: number) => updateCurrentPattern(p => ({ ...p, instruments: p.instruments.map(i => i.id === id ? { ...i, volume: value } : i) }));

  const handleCopyInstrument = (instrumentId: string) => {
    const instrument = activePattern.instruments.find(inst => inst.id === instrumentId);
    if (instrument) {
        setInstrumentClipboard(instrument.sequence);
    }
  };

  const handlePasteInstrument = (instrumentId: string) => {
      if (instrumentClipboard) {
          updateCurrentPattern(p => {
              const newInstruments = p.instruments.map(inst => {
                  if (inst.id === instrumentId) {
                      return { ...inst, sequence: [...instrumentClipboard] };
                  }
                  return inst;
              });
              return { ...p, instruments: newInstruments };
          });
      }
  };

  const handleClearInstrument = (instrumentId: string) => {
      updateCurrentPattern(p => {
          const newInstruments = p.instruments.map(inst => {
              if (inst.id === instrumentId) {
                  return { ...inst, sequence: Array(inst.sequence.length).fill(0) as Velocity[] };
              }
              return inst;
          });
          return { ...p, instruments: newInstruments };
      });
  };

  const handleSavePattern = () => {
    // The pattern is now updated in real-time, so we just need to save the project.
    saveProject(patterns, songSequence, isSongLooping);
  };
  const handleLoadPattern = async (index: number) => {
    if (isPlaying) {
        await sequencerEngine.loadPattern(index);
    }
    setSelectedPatternIndex(index);
    setIsSongModeActive(false);
  };
  const handleCopyPattern = () => setClipboard(activePattern);
  const handlePastePattern = () => {
    if (clipboard) {
      updateCurrentPattern(() => JSON.parse(JSON.stringify(clipboard)));
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
            
            const firstPattern = mergedPatterns[0];
            if (firstPattern) {
                setTimeSignature(firstPattern.timeSignature);
            }
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
  };

  const handleToggleSongMode = () => { if (isPlaying) setIsPlaying(false); setIsSongModeActive(prev => !prev); };
  const handleToggleSongLoop = () => {
    const newLoopingState = !isSongLooping;
    setIsSongLooping(newLoopingState);
    saveProject(patterns, songSequence, newLoopingState);
  };
  const handleSongStepClick = (stepIndex: number) => {
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
  };
  const handleClearSong = () => {
    setSongSequence(Array(SONG_STEPS).fill(null));
  };

  const handleReset = () => {
    if (isPlaying) setIsPlaying(false);
    setTimeSignature([4, 4]);
    setPatterns(Array(NUM_PATTERNS).fill(null).map(() => mergePatternData(null, [4, 4], 16)));
    setSelectedPatternIndex(0);
    setClipboard(null);
    setVocoderParams(JSON.parse(JSON.stringify(INITIAL_VOCODER_PARAMS)));
    setIsSongModeActive(false);
    setSongSequence(Array(SONG_STEPS).fill(null));
    setIsSongLooping(false);
    localStorage.removeItem(PROJECT_STORAGE_KEY);
    alert("Application state reset to defaults!");
  };

  // --- MIDI Output Handlers ---
  const handleMidiOutputChange = useCallback((outputName: string) => {
    setSelectedMidiOutput(outputName);
    sequencerEngine.setMidiOutput(outputName);
  }, [sequencerEngine]);

  // --- Bassline Handlers ---
  const handleBasslineParamChange = (param: keyof BasslineParams, value: number | Waveform) => {
    updateCurrentPattern(p => ({ ...p, bassline: { ...p.bassline!, params: { ...p.bassline!.params, [param]: value } } }));
  };

  // --- Vocoder Handlers ---
  const handleVocoderParamChange = (param: keyof VocoderParams, value: string | number | boolean) => {
    const newParams = { ...vocoderParams, [param]: value };
    setVocoderParams(newParams);
    updateVocoderParams(newParams);

    if (param === 'enabled') {
      toggleVocoder(value as boolean).catch(() => {
        setVocoderParams(prev => ({...prev, enabled: false}));
      });
    }
  };

  const handleVocoderTypeChange = (type: VocoderType) => {
    setVocoderType(type);
    setAudioServiceVocoderType(type);
  };

  const handleBasslineNoteClick = (stepIndex: number, note: number) => {
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
  };

  const handleClearBasslineStep = (stepIndex: number) => {
    updateCurrentPattern(p => {
        const newSequence = JSON.parse(JSON.stringify(p.bassline!.sequence));
        newSequence[stepIndex] = { ...newSequence[stepIndex], note: null, velocity: 0 };
        return { ...p, bassline: { ...p.bassline!, sequence: newSequence } };
    });
  };

  const handleBasslineControlToggle = (stepIndex: number, control: 'slide' | 'tie') => {
    updateCurrentPattern(p => {
        const newSequence = JSON.parse(JSON.stringify(p.bassline!.sequence));
        newSequence[stepIndex] = { ...newSequence[stepIndex], [control]: !newSequence[stepIndex][control] };
        return { ...p, bassline: { ...p.bassline!, sequence: newSequence } };
    });
  };

  return (
    <div className="bg-gray-900 text-white min-h-screen flex flex-col items-center justify-start p-4 font-sans">
      <div className="w-full max-w-7xl mx-auto space-y-6">
        <header className="text-center">
          <h1 className="text-4xl md:text-5xl font-bold text-yellow-400 tracking-tight">O Grove Son</h1>
          <p className="text-gray-400 mt-1">Unha caixa de ritmos con liña de baixo e vocoder</p>
        </header>
        <main className="space-y-6 flex flex-col items-center">
          <TransportControls isPlaying={isPlaying} onPlayToggle={handlePlayToggle} tempo={tempo} onTempoChange={handleTempoChange} swing={swing} onSwingChange={handleSwingChange} timeSignature={timeSignature} onTimeSignatureChange={handleTimeSignatureChange} />
          <MidiOutputSelector onOutputSelect={handleMidiOutputChange} />
          <PatternControls patterns={patterns} selectedPatternIndex={selectedPatternIndex} onLoad={handleLoadPattern} onSave={handleSavePattern} onExport={handleExportPatterns} onImport={handleImportPatterns} onCopy={handleCopyPattern} onPaste={handlePastePattern} isClipboardEmpty={clipboard === null} isPlaying={isPlaying} onReset={handleReset} />
          <SongSequencer sequence={songSequence} isActive={isSongModeActive} isLooping={isSongLooping} currentStep={currentSongStep} onToggle={handleToggleSongMode} onToggleLoop={handleToggleSongLoop} onStepClick={handleSongStepClick} onClear={handleClearSong} />
          
          {isLoaded && (
            <>
              <Sequencer instruments={instruments} currentStep={currentStep} selectedInstrumentId={selectedInstrumentId} timeSignature={timeSignature} onStepClick={handleStepClick} onStepClear={handleClearStep} onInstrumentSelect={handleInstrumentSelect} onMuteToggle={handleMuteToggle} onSoloToggle={handleSoloToggle} onParamChange={handleParamChange} onVolumeChange={handleVolumeChange} onCopyInstrument={handleCopyInstrument} onPasteInstrument={handlePasteInstrument} onClearInstrument={handleClearInstrument} isInstrumentPasteDisabled={instrumentClipboard === null} />
              <BasslineSequencer basslinePattern={basslinePattern} currentStep={currentStep} timeSignature={timeSignature} onNoteClick={handleBasslineNoteClick} onStepClear={handleClearBasslineStep} onParamChange={handleBasslineParamChange} onControlToggle={handleBasslineControlToggle} />
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