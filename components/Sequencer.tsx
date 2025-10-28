import React from 'react';
import { Sequence } from '../types';
import { INSTRUMENTS } from '../constants';
import Step from './Step';

interface SequencerProps {
  sequence: Sequence;
  currentStep: number;
  onStepToggle: (instrumentIndex: number, stepIndex: number) => void;
}

const Sequencer: React.FC<SequencerProps> = ({ sequence, currentStep, onStepToggle }) => {
  return (
    <div className="bg-gray-900/50 p-4 rounded-lg border border-gray-700 shadow-2xl w-auto inline-block">
      <div className="grid grid-cols-[150px_auto] gap-x-4">
        {/* Instrument Labels */}
        <div className="flex flex-col gap-y-2">
          {INSTRUMENTS.map((instrument) => (
            <div key={instrument.id} className="h-8 flex items-center justify-end pr-4 bg-gray-800 rounded-md border border-gray-700">
              <span className="text-gray-300 font-semibold text-sm">{instrument.name}</span>
            </div>
          ))}
        </div>

        {/* Steps Grid */}
        <div className="flex flex-col gap-y-2">
          {sequence.map((instrumentTrack, instrumentIndex) => (
            <div key={instrumentIndex} className="flex items-center gap-x-4">
               {[0, 1, 2, 3].map(quarter => (
                 <div key={quarter} className="grid grid-cols-4 gap-x-1">
                   {instrumentTrack.slice(quarter * 4, quarter * 4 + 4).map((stepActive, i) => {
                     const stepIndex = quarter * 4 + i;
                     return (
                       <Step
                         key={stepIndex}
                         isActive={stepActive}
                         isCurrent={currentStep === stepIndex}
                         onClick={() => onStepToggle(instrumentIndex, stepIndex)}
                       />
                     );
                   })}
                 </div>
               ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default Sequencer;