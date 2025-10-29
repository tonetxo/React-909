import React from 'react';

interface SongSequencerProps {
  sequence: (number | null)[];
  isActive: boolean;
  isLooping: boolean;
  currentStep: number | null;
  onToggle: () => void;
  onToggleLoop: () => void;
  onStepClick: (stepIndex: number) => void;
  onClear: () => void;
}

const SongSequencer: React.FC<SongSequencerProps> = ({
  sequence,
  isActive,
  isLooping,
  currentStep,
  onToggle,
  onToggleLoop,
  onStepClick,
  onClear,
}) => {
  return (
    <div className="p-4 bg-gray-900/50 rounded-lg border border-gray-700 w-full">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-4">
          <h4 className="text-sm font-bold text-gray-400 uppercase tracking-wider">Song Mode</h4>
          <button
            onClick={onToggle}
            role="switch"
            aria-checked={isActive}
            className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-yellow-500 focus:ring-offset-2 focus:ring-offset-gray-800 ${
              isActive ? 'bg-yellow-500' : 'bg-gray-600'
            }`}
          >
            <span
              aria-hidden="true"
              className={`inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                isActive ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
           <div className={`flex items-center gap-2 transition-opacity duration-200 ${isActive ? 'opacity-100' : 'opacity-40 pointer-events-none'}`}>
             <label className="text-sm font-medium text-gray-300" htmlFor="song-loop-toggle">Loop</label>
             <button
                id="song-loop-toggle"
                onClick={onToggleLoop}
                role="switch"
                aria-checked={isLooping}
                disabled={!isActive}
                className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-yellow-500 focus:ring-offset-2 focus:ring-offset-gray-800 disabled:cursor-not-allowed ${
                  isLooping ? 'bg-yellow-500' : 'bg-gray-600'
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    isLooping ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
          </div>
        </div>
        <button
            onClick={onClear}
            className="px-4 py-1 text-xs bg-red-800/80 text-red-100 font-semibold rounded-md hover:bg-red-700 transition-colors duration-200"
            aria-label="Clear song sequence"
        >
            Clear
        </button>
      </div>

      <div className={`flex items-center gap-1 transition-opacity duration-300 ${isActive ? 'opacity-100' : 'opacity-40 pointer-events-none'}`}>
        {sequence.map((patternIndex, stepIndex) => {
          const isBeatSeparator = stepIndex > 0 && stepIndex % 4 === 0;
          const isCurrent = currentStep === stepIndex;
          
          return (
            <React.Fragment key={stepIndex}>
              {isBeatSeparator && <div className="w-1" />}
              <button
                onClick={() => onStepClick(stepIndex)}
                className={`w-10 h-10 rounded-md border text-lg font-bold transition-all duration-100 flex items-center justify-center
                  ${
                    isCurrent
                      ? 'border-white transform scale-110 ring-2 ring-white'
                      : patternIndex !== null
                      ? 'bg-blue-800/70 border-blue-600 text-blue-100 hover:bg-blue-700/70'
                      : 'bg-gray-700 border-gray-600 text-gray-500 hover:bg-gray-600'
                  }
                `}
                aria-label={`Song step ${stepIndex + 1}, currently set to ${patternIndex !== null ? `Pattern ${patternIndex + 1}` : 'Empty'}`}
              >
                {patternIndex !== null ? `P${patternIndex + 1}`: '-'}
              </button>
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
};

export default SongSequencer;