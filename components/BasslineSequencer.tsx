import React from 'react';
import { BasslinePattern, BasslineParams, Waveform, TimeSignature } from '../types';
import { BASSLINE_NOTES, BASSLINE_VELOCITY_COLORS, WAVEFORMS, WAVEFORM_LABELS } from '../constants';

interface BasslineSequencerProps {
    basslinePattern: BasslinePattern;
    currentStep: number | null;
    timeSignature: TimeSignature;
    onNoteClick: (stepIndex: number, note: number) => void;
    onStepClear: (stepIndex: number) => void;
    onParamChange: (param: keyof BasslineParams, value: number | Waveform | boolean) => void;
    onControlToggle: (stepIndex: number, control: 'slide' | 'tie') => void;
}

const ParamSlider: React.FC<{
    id: string;
    def: { label: string; min: number; max: number; step: number };
    value: number;
    onChange: (value: number) => void;
}> = ({ id, def, value, onChange }) => (
    <div>
        <div className="flex justify-between items-center mb-1">
            <label htmlFor={id} className="text-xs text-gray-400 font-medium">{def.label}</label>
            <span className="text-xs font-mono bg-gray-700 text-white px-1.5 py-0.5 rounded-sm">{value.toFixed(2)}</span>
        </div>
        <input
            type="range" id={id}
            min={def.min} max={def.max} step={def.step}
            value={value}
            onChange={(e) => onChange(parseFloat(e.target.value))}
            className="w-full accent-yellow-500 h-1.5"
        />
    </div>
);


const BasslineSequencer: React.FC<BasslineSequencerProps> = React.memo(({
    basslinePattern,
    currentStep,
    timeSignature,
    onNoteClick,
    onStepClear,
    onParamChange,
    onControlToggle
}) => {
    const { sequence, params } = basslinePattern;
    const beatsPerMeasure = timeSignature[0];

    const paramDefinitions = {
        cutoff: { label: 'Cutoff', min: 100, max: 5000, step: 10 },
        resonance: { label: 'Resonance', min: 0, max: 20, step: 0.1 },
        envelopeAmount: { label: 'Env Mod', min: 0, max: 4000, step: 10 },
        decay: { label: 'Decay', min: 0.1, max: 2, step: 0.01 },
        accent: { label: 'Accent Amt', min: 0, max: 1, step: 0.01 },
        volume: { label: 'Volume', min: 0, max: 1, step: 0.01 },
        reverbSend: { label: 'Reverb', min: 0, max: 1, step: 0.01 },
        delaySend: { label: 'Delay', min: 0, max: 1, step: 0.01 },
        flangerSend: { label: 'Flanger', min: 0, max: 1, step: 0.01 },
    };

    const synthParams: (keyof BasslineParams)[] = ['cutoff', 'resonance', 'envelopeAmount', 'decay', 'accent'];
    const channelParams: (keyof BasslineParams)[] = ['volume', 'reverbSend', 'delaySend', 'flangerSend'];

    const handleContextMenu = (event: React.MouseEvent, stepIndex: number) => {
        event.preventDefault();
        onStepClear(stepIndex);
    };

    return (
        <div className="bg-gray-900/50 p-4 rounded-lg border border-gray-700 shadow-inner w-full">
            {/* Component Header */}
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-4">
                    <h4 className="text-sm font-bold text-gray-400 uppercase tracking-wider">Bassline</h4>
                    <button
                        onClick={() => onParamChange('enabled', !params.enabled)}
                        role="switch"
                        aria-checked={params.enabled}
                        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-hidden focus:ring-2 focus:ring-yellow-500 focus:ring-offset-2 focus:ring-offset-gray-800 ${params.enabled ? 'bg-yellow-500' : 'bg-gray-600'
                            }`}
                    >
                        <span
                            aria-hidden="true"
                            className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${params.enabled ? 'translate-x-5' : 'translate-x-0'
                                }`}
                        />
                    </button>
                </div>
            </div>

            <div className="flex flex-col md:flex-row gap-4">
                {/* Parameters */}
                <div className="flex flex-col gap-y-4 w-52 shrink-0">
                    <div className={`transition-opacity ${params.enabled ? 'opacity-100' : 'opacity-40 pointer-events-none'}`}>
                        <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Synthesis</h4>
                        <div className="flex flex-col space-y-4">
                            <div>
                                <label className="text-xs text-gray-400 font-medium mb-1 block">Waveform</label>
                                <div className="flex gap-1">
                                    {WAVEFORMS.map(wf => (
                                        <button key={wf} onClick={() => onParamChange('waveform', wf)} className={`text-xs font-semibold flex-1 py-1 rounded-sm transition-colors ${params.waveform === wf ? 'bg-yellow-500 text-gray-900' : 'bg-gray-700 hover:bg-gray-600'}`}>
                                            {WAVEFORM_LABELS[wf]}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {synthParams.map(key => (
                                <ParamSlider
                                    key={key}
                                    id={`bass-${key}`}
                                    def={paramDefinitions[key]}
                                    value={params[key] as number}
                                    onChange={(value) => onParamChange(key, value)}
                                />
                            ))}
                        </div>
                    </div>
                    <div className={`transition-opacity ${params.enabled ? 'opacity-100' : 'opacity-40 pointer-events-none'}`}>
                        <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Channel</h4>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-4">
                            {channelParams.map(key => (
                                <ParamSlider
                                    key={key}
                                    id={`bass-${key}`}
                                    def={paramDefinitions[key]}
                                    value={params[key] as number}
                                    onChange={(value) => onParamChange(key, value)}
                                />
                            ))}
                        </div>
                    </div>
                </div>

                {/* Sequencer Grid */}
                <div className="grow flex overflow-x-auto pb-2">
                    {/* Piano Keys */}
                    <div className="flex flex-col gap-px sticky left-0 z-20 bg-gray-900/80 pr-2">
                        {BASSLINE_NOTES.map(({ name, isBlack }) => (
                            <div key={name} className={`h-5 flex items-center justify-end pr-2 text-xs font-mono rounded-l-xs w-8 ${isBlack ? 'bg-gray-800 text-white' : 'bg-gray-600 text-gray-200'}`}>
                                {name}
                            </div>
                        ))}
                        <div className="h-5 mt-2"></div>
                        <div className="h-5 mt-1"></div>
                    </div>

                    <div className="grow">
                        <div className="flex flex-col gap-px">
                            {BASSLINE_NOTES.map(({ note, isBlack }) => (
                                <div key={note} className="flex items-center gap-1">
                                    {sequence.map((step, stepIndex) => {
                                        const isBeatSeparator = stepIndex > 0 && stepIndex % beatsPerMeasure === 0;
                                        const isActive = step.note === note && step.velocity > 0;
                                        const isCurrent = currentStep === stepIndex;

                                        return (
                                            <React.Fragment key={stepIndex}>
                                                {isBeatSeparator && <div className="w-1.5" />}
                                                <button
                                                    onClick={() => onNoteClick(stepIndex, note)}
                                                    onContextMenu={(e) => handleContextMenu(e, stepIndex)}
                                                    className={`w-full h-5 rounded-xs border transition-all duration-100 
                                                ${isCurrent ? 'ring-2 ring-white z-10' : ''}
                                                ${isActive ? BASSLINE_VELOCITY_COLORS[step.velocity - 1] : `${isBlack ? 'bg-gray-800/60' : 'bg-gray-700/50'} border-gray-600/50 hover:bg-gray-600`}
                                            `}
                                                    aria-label={`Step ${stepIndex + 1}, Note ${note}, Velocity ${step.velocity}`}
                                                />
                                            </React.Fragment>
                                        )
                                    })}
                                </div>
                            ))}
                        </div>
                        {/* Control Rows */}
                        <div className="flex items-center gap-1 mt-2">
                            {sequence.map((step, stepIndex) => {
                                const isBeatSeparator = stepIndex > 0 && stepIndex % beatsPerMeasure === 0;
                                return (
                                    <React.Fragment key={stepIndex}>
                                        {isBeatSeparator && <div className="w-1.5" />}
                                        <button
                                            onClick={() => onControlToggle(stepIndex, 'slide')}
                                            className={`w-full h-5 text-xs font-bold rounded-sm border transition-colors ${step.slide ? 'bg-orange-600 text-white border-orange-500' : 'bg-gray-800 text-gray-500 border-gray-700 hover:bg-gray-700'
                                                }`}
                                            aria-pressed={step.slide}
                                            title="Toggle Slide"
                                        >
                                            SL
                                        </button>
                                    </React.Fragment>
                                )
                            })}
                        </div>
                        <div className="flex items-center gap-1 mt-1">
                            {sequence.map((step, stepIndex) => {
                                const isBeatSeparator = stepIndex > 0 && stepIndex % beatsPerMeasure === 0;
                                return (
                                    <React.Fragment key={stepIndex}>
                                        {isBeatSeparator && <div className="w-1.5" />}
                                        <button
                                            onClick={() => onControlToggle(stepIndex, 'tie')}
                                            className={`w-full h-5 text-xs font-bold rounded-sm border transition-colors ${step.tie ? 'bg-green-600 text-white border-green-500' : 'bg-gray-800 text-gray-500 border-gray-700 hover:bg-gray-700'
                                                }`}
                                            aria-pressed={step.tie}
                                            title="Toggle Tie"
                                        >
                                            TIE
                                        </button>
                                    </React.Fragment>
                                )
                            })}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
});

export default BasslineSequencer;