
import React from 'react';

interface TransportControlsProps {
  isPlaying: boolean;
  onPlayToggle: () => void;
  tempo: number;
  onTempoChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
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


const TransportControls: React.FC<TransportControlsProps> = ({ isPlaying, onPlayToggle, tempo, onTempoChange }) => {
  return (
    <div className="flex items-center space-x-6 p-4 bg-gray-900/50 rounded-lg border border-gray-700">
      <button
        onClick={onPlayToggle}
        className="px-6 py-3 bg-yellow-500 text-gray-900 font-bold rounded-md hover:bg-yellow-400 transition-colors duration-200 flex items-center space-x-2 shadow-lg"
        aria-label={isPlaying ? 'Stop' : 'Play'}
      >
        {isPlaying ? <StopIcon /> : <PlayIcon />}
        <span>{isPlaying ? 'Stop' : 'Play'}</span>
      </button>
      <div className="flex items-center space-x-3">
        <label htmlFor="tempo" className="text-gray-300 font-medium">Tempo</label>
        <input
          type="range"
          id="tempo"
          min="40"
          max="240"
          value={tempo}
          onChange={onTempoChange}
          className="w-48 accent-yellow-500"
        />
        <span className="text-lg font-mono bg-gray-800 text-white px-3 py-1 rounded-md w-20 text-center">{tempo} BPM</span>
      </div>
    </div>
  );
};

export default TransportControls;
