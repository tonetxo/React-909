import React from 'react';
import { Instrument, InstrumentParams, Velocity } from '../types';
import Step from './Step';
import InstrumentControls from './InstrumentControls';
import ParameterControls from './ParameterControls';

interface SequencerProps {
  instruments: Instrument[];
  currentStep: number | null;
  selectedInstrumentId: string | null;
  onStepClick: (instrumentIndex: number, stepIndex: number) => void;
  onInstrumentSelect: (instrumentId: string) => void;
  onMuteToggle: (instrumentId: string) => void;
  onSoloToggle: (instrumentId: string) => void;
  onParamChange: (instrumentId: string, param: keyof InstrumentParams, value: number) => void;
  onVolumeChange: (instrumentId: string, value: number) => void;
}

const Sequencer: React.FC<SequencerProps> = ({ 
  instruments, 
  currentStep, 
  selectedInstrumentId,
  onStepClick,
  onInstrumentSelect,
  onMuteToggle,
  onSoloToggle,
  onParamChange,
  onVolumeChange,
}) => {
  return (
    <div className="bg-gray-900/50 p-4 rounded-lg border border-gray-700 shadow-inner w-full">
      <div className="flex flex-col gap-y-1">
        {instruments.map((instrument, instrumentIndex) => (
          <div key={instrument.id}>
            <div className="flex">
              <InstrumentControls 
                instrument={instrument}
                isSelected={selectedInstrumentId === instrument.id}
                onSelect={onInstrumentSelect}
                onMuteToggle={onMuteToggle}
                onSoloToggle={onSoloToggle}
              />
              <div className="flex items-center gap-1 ml-2 flex-grow">
                {instrument.sequence.map((velocity, stepIndex) => {
                  const isBeatSeparator = stepIndex > 0 && stepIndex % 4 === 0;
                  return (
                    <React.Fragment key={stepIndex}>
                      {isBeatSeparator && <div className="w-2" />}
                      <Step
                        velocity={velocity as Velocity}
                        isCurrent={currentStep === stepIndex}
                        onClick={() => onStepClick(instrumentIndex, stepIndex)}
                      />
                    </React.Fragment>
                  )
                })}
              </div>
            </div>
            {selectedInstrumentId === instrument.id && (
              <ParameterControls 
                instrument={instrument}
                onParamChange={onParamChange}
                onVolumeChange={onVolumeChange}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default Sequencer;