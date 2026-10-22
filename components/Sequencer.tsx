import React from 'react';
import { Instrument, InstrumentParams, Velocity, TimeSignature } from '../types';
import Step from './Step';
import InstrumentControls from './InstrumentControls';
import ParameterControls from './ParameterControls';

interface SequencerProps {
  instruments: Instrument[];
  currentStep: number | null;
  selectedInstrumentId: string | null;
  timeSignature: TimeSignature;
  onStepClick: (instrumentIndex: number, stepIndex: number) => void;
  onStepClear: (instrumentIndex: number, stepIndex: number) => void;
  onInstrumentSelect: (instrumentId: string) => void;
  onMuteToggle: (instrumentId: string) => void;
  onSoloToggle: (instrumentId: string) => void;
  onParamChange: (instrumentId: string, param: keyof InstrumentParams, value: number) => void;
  onVolumeChange: (instrumentId: string, value: number) => void;
  onInstrumentAction: (instrumentId: string, action: 'copy' | 'paste' | 'clear') => void;
  isInstrumentPasteDisabled: boolean;
}

const Sequencer: React.FC<SequencerProps> = React.memo(({
  instruments,
  currentStep,
  selectedInstrumentId,
  timeSignature,
  onStepClick,
  onStepClear,
  onInstrumentSelect,
  onMuteToggle,
  onSoloToggle,
  onParamChange,
  onVolumeChange,
  onInstrumentAction,
  isInstrumentPasteDisabled,
}) => {
  const beatsPerMeasure = timeSignature[0];

  const handleContextMenu = (event: React.MouseEvent, instrumentIndex: number, stepIndex: number) => {
    event.preventDefault();
    onStepClear(instrumentIndex, stepIndex);
  };

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
                onCopy={(id) => onInstrumentAction(id, 'copy')}
                onPaste={(id) => onInstrumentAction(id, 'paste')}
                onClear={(id) => onInstrumentAction(id, 'clear')}
                isPasteDisabled={isInstrumentPasteDisabled}
              />
              <div className="flex items-center gap-1 ml-2 flex-grow">
                {instrument.sequence.map((velocity, stepIndex) => {
                  const isBeatSeparator = stepIndex > 0 && stepIndex % beatsPerMeasure === 0;
                  return (
                    <React.Fragment key={stepIndex}>
                      {isBeatSeparator && <div className="w-2" />}
                      <Step
                        velocity={velocity as Velocity}
                        isCurrent={currentStep === stepIndex}
                        onClick={() => onStepClick(instrumentIndex, stepIndex)}
                        onContextMenu={(e) => handleContextMenu(e, instrumentIndex, stepIndex)}
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
});

export default Sequencer;