import React, { useState, useEffect } from 'react';

import { TimeSignature } from '../types';

interface TransportControlsProps {
  isPlaying: boolean;
  onPlayToggle: () => void;
  tempo: number;
  onTempoChange: (value: number) => void;
  swing: number;
  onSwingChange: (value: number) => void;
  timeSignature: TimeSignature;
  onTimeSignatureChange: (timeSignature: TimeSignature) => void;
}

const PlayIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6">
        <path fillRule="evenodd" d="M4.5 5.653c0-1.426 1.529-2.33 2.779-1.643l11.54 6.647c1.295.742 1.295 2.545 0 3.286L7.279 20.99c-1.25.717-2.779-.217-2.779-1.643V5.653z" clipRule="evenodd" />
    </svg>
);

const StopIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6">
        <path fillRule="evenodd" d="M4.5 7.5a3 3 0 013-3h9a3 3 0 013 3v9a3 3 0 01-3 3h-9a3 3 0 01-3-3v-9z" clipRule="evenodd" />
    </svg>
);

const TransportControls: React.FC<TransportControlsProps> = ({ 
  isPlaying, 
  onPlayToggle, 
  tempo, 
  onTempoChange, 
  swing, 
  onSwingChange,
  timeSignature,
  onTimeSignatureChange
}) => {
  const [tempoInput, setTempoInput] = useState(String(tempo));
  const [swingInput, setSwingInput] = useState(String(swing));

  useEffect(() => {
    setTempoInput(String(tempo));
  }, [tempo]);

  useEffect(() => {
    setSwingInput(String(swing));
  }, [swing]);

  const handleTempoSubmit = () => {
    const newTempo = parseInt(tempoInput, 10);
    if (!isNaN(newTempo) && newTempo >= 40 && newTempo <= 240) {
      onTempoChange(newTempo);
    } else {
      setTempoInput(String(tempo)); // revert if invalid
    }
  };

  const handleSwingSubmit = () => {
    const newSwing = parseInt(swingInput, 10);
    if (!isNaN(newSwing) && newSwing >= 0 && newSwing <= 100) {
      onSwingChange(newSwing);
    } else {
      setSwingInput(String(swing)); // revert if invalid
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, submitter: () => void) => {
    if (e.key === 'Enter') {
      submitter();
      e.currentTarget.blur();
    }
  };

  const timeSignatures: { label: string; value: TimeSignature }[] = [
    { label: '4/4', value: [4, 4] },
    { label: '3/4', value: [3, 4] },
    { label: '5/4', value: [5, 4] },
    { label: '6/8', value: [6, 8] },
    { label: '7/8', value: [7, 8] },
    { label: '9/8', value: [9, 8] },
    { label: '12/8', value: [12, 8] },
  ];

  const handleTimeSignatureChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const [beats, beatType] = e.target.value.split(',').map(Number);
    onTimeSignatureChange([beats, beatType] as TimeSignature);
  };

  return (
    <div className="grid grid-cols-[auto_1fr] items-center gap-x-6 gap-y-4 p-4 bg-gray-900/50 rounded-lg border border-gray-700">
        <button
            onClick={onPlayToggle}
            className="row-span-3 px-6 py-3 bg-yellow-500 text-gray-900 font-bold rounded-md hover:bg-yellow-400 transition-colors duration-200 flex items-center justify-center space-x-2 shadow-lg h-full"
            aria-label={isPlaying ? 'Stop' : 'Play'}
        >
            {isPlaying ? <StopIcon /> : <PlayIcon />}
            <span>{isPlaying ? 'Stop' : 'Play'}</span>
        </button>

        <div className="grid grid-cols-[auto_1fr_auto] items-center gap-x-3">
            <label htmlFor="tempo" className="text-gray-300 font-medium w-16 text-right">Tempo</label>
            <input
            type="range"
            id="tempo"
            min="40"
            max="240"
            value={tempo}
            onChange={(e) => onTempoChange(Number(e.target.value))}
            className="w-full accent-yellow-500"
            />
            <input
                type="text"
                value={tempoInput}
                onChange={(e) => setTempoInput(e.target.value)}
                onKeyDown={(e) => handleKeyDown(e, handleTempoSubmit)}
                onBlur={handleTempoSubmit}
                className="text-lg font-mono bg-gray-800 text-white px-3 py-1 rounded-md w-24 text-center"
            />
        </div>
      
        <div className="grid grid-cols-[auto_1fr_auto] items-center gap-x-3">
            <label htmlFor="swing" className="text-gray-300 font-medium w-16 text-right">Swing</label>
            <input
            type="range"
            id="swing"
            min="0"
            max="100"
            value={swing}
            onChange={(e) => onSwingChange(Number(e.target.value))}
            className="w-full accent-yellow-500"
            />
            <input
                type="text"
                value={swingInput}
                onChange={(e) => setSwingInput(e.target.value)}
                onKeyDown={(e) => handleKeyDown(e, handleSwingSubmit)}
                onBlur={handleSwingSubmit}
                className="text-lg font-mono bg-gray-800 text-white px-3 py-1 rounded-md w-24 text-center"
            />
        </div>

        <div className="grid grid-cols-[auto_1fr_auto] items-center gap-x-3">
            <label htmlFor="time-signature" className="text-gray-300 font-medium w-16 text-right">Time Sig</label>
            <select
              id="time-signature"
              value={timeSignature.join(',')}
              onChange={handleTimeSignatureChange}
              className="bg-gray-800 border border-gray-600 text-white text-sm rounded-lg focus:ring-yellow-500 focus:border-yellow-500 block w-full p-2.5"
            >
              {timeSignatures.map(ts => (
                <option key={ts.label} value={ts.value.join(',')}>{ts.label}</option>
              ))}
            </select>
            <span className="text-lg font-mono bg-gray-800 text-white px-3 py-1 rounded-md w-24 text-center">{timeSignature.join('/')}</span>
        </div>
    </div>
  );
};

export default TransportControls;
