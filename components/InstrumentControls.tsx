import React from 'react';
import { Instrument } from '../types';

interface InstrumentControlsProps {
  instrument: Instrument;
  isSelected: boolean;
  onSelect: (instrumentId: string) => void;
  onMuteToggle: (instrumentId: string) => void;
  onSoloToggle: (instrumentId: string) => void;
}

const InstrumentControls: React.FC<InstrumentControlsProps> = ({ instrument, isSelected, onSelect, onMuteToggle, onSoloToggle }) => {
  
  const nameButtonClasses = `text-sm font-semibold tracking-wider truncate text-left w-full h-full px-2 rounded-l-md transition-colors duration-150 ${
    isSelected ? 'bg-yellow-500 text-gray-900' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
  }`;

  const muteButtonClasses = `text-xs font-bold w-6 h-6 rounded-md transition-colors duration-150 ${
      instrument.isMuted ? 'bg-red-500 text-white' : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
  }`;

  const soloButtonClasses = `text-xs font-bold w-6 h-6 rounded-md transition-colors duration-150 ${
      instrument.isSolo ? 'bg-yellow-400 text-gray-900' : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
  }`;
  
  return (
    <div className="flex items-center justify-start bg-gray-800 border-r-2 border-gray-600 w-48 shrink-0 h-8">
      <button onClick={() => onSelect(instrument.id)} className={nameButtonClasses}>
        {instrument.name}
      </button>
      <div className="flex items-center gap-1 p-1 bg-gray-800">
          <button onClick={() => onMuteToggle(instrument.id)} className={muteButtonClasses} aria-label={`Mute ${instrument.name}`}>M</button>
          <button onClick={() => onSoloToggle(instrument.id)} className={soloButtonClasses} aria-label={`Solo ${instrument.name}`}>S</button>
      </div>
    </div>
  );
};

export default InstrumentControls;
