
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Sequence } from './types';
import { initialSequence, INITIAL_TEMPO } from './constants';
import Sequencer from './components/Sequencer';
import TransportControls from './components/TransportControls';
import { AudioEngine } from './services/audioService';

const App: React.FC = () => {
  const [sequence, setSequence] = useState<Sequence>(initialSequence);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [tempo, setTempo] = useState<number>(INITIAL_TEMPO);
  const [currentStep, setCurrentStep] = useState<number>(-1);
  const [isInitialized, setIsInitialized] = useState<boolean>(false);

  const audioEngineRef = useRef<AudioEngine | null>(null);

  useEffect(() => {
    if (!audioEngineRef.current) {
        audioEngineRef.current = new AudioEngine();
    }
  }, []);
  
  const initAudio = async () => {
    if (isInitialized || !audioEngineRef.current) return;
    await audioEngineRef.current.init((step) => setCurrentStep(step));
    setIsInitialized(true);
  };
  
  useEffect(() => {
    if(audioEngineRef.current && isInitialized) {
        audioEngineRef.current.updateTempo(tempo);
    }
  }, [tempo, isInitialized]);
  
  useEffect(() => {
    if(audioEngineRef.current && isInitialized) {
        audioEngineRef.current.updateSequence(sequence);
    }
  }, [sequence, isInitialized]);


  const handlePlayToggle = useCallback(() => {
    if (!isInitialized) return;
    const engine = audioEngineRef.current;
    if (!engine) return;

    if (engine.getIsPlaying()) {
      engine.stop();
      setIsPlaying(false);
    } else {
      engine.start();
      setIsPlaying(true);
    }
  }, [isInitialized]);

  const handleTempoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setTempo(Number(e.target.value));
  };
  
  const handleStepToggle = (instrumentIndex: number, stepIndex: number) => {
    const newSequence = sequence.map(track => [...track]);
    newSequence[instrumentIndex][stepIndex] = !newSequence[instrumentIndex][stepIndex];
    setSequence(newSequence);
  };

  return (
    <div className="min-h-screen bg-gray-800 text-white flex flex-col items-center justify-center p-4 sm:p-8 font-sans">
      <div className="w-full max-w-7xl space-y-8">
        <header className="text-center">
            <h1 className="text-4xl sm:text-6xl font-bold tracking-tighter text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 to-orange-500">
                React-909
            </h1>
            <p className="text-gray-400 mt-2 text-lg">A Web Audio Groovebox</p>
        </header>
        
        {!isInitialized ? (
            <div className="flex justify-center">
                <button
                    onClick={initAudio}
                    className="px-8 py-4 bg-yellow-500 text-gray-900 font-bold text-xl rounded-md hover:bg-yellow-400 transition-transform transform hover:scale-105 duration-200 shadow-lg"
                >
                    Start Engine
                </button>
            </div>
        ) : (
            <main className="flex flex-col items-center space-y-6">
              <TransportControls
                isPlaying={isPlaying}
                onPlayToggle={handlePlayToggle}
                tempo={tempo}
                onTempoChange={handleTempoChange}
              />
              <Sequencer
                sequence={sequence}
                currentStep={currentStep}
                onStepToggle={handleStepToggle}
              />
            </main>
        )}
      </div>
    </div>
  );
};

export default App;
