import React from 'react';
import { Instrument, InstrumentParams, ParamDefinition } from '../types';
import { VOLUME_PARAM_DEFINITION } from '../constants';

interface ParameterControlsProps {
    instrument: Instrument;
    onParamChange: (instrumentId: string, param: keyof InstrumentParams, value: number) => void;
    onVolumeChange: (instrumentId: string, value: number) => void;
}

const ParamSlider: React.FC<{
    id: string;
    def: ParamDefinition;
    value: number;
    onChange: (value: number) => void;
}> = ({ id, def, value, onChange }) => (
    <div className="flex flex-col">
        <div className="flex justify-between items-center mb-1">
            <label htmlFor={id} className="text-xs text-gray-400 font-medium">
                {def.label}
            </label>
            <span className="text-xs font-mono bg-gray-700 text-white px-1.5 py-0.5 rounded">
                {value.toFixed(2)}
            </span>
        </div>
        <input
            type="range"
            id={id}
            min={def.min}
            max={def.max}
            step={def.step}
            value={value}
            onChange={(e) => onChange(parseFloat(e.target.value))}
            className="w-full accent-yellow-500 h-1.5"
        />
    </div>
);

const ParameterControls: React.FC<ParameterControlsProps> = ({ instrument, onParamChange, onVolumeChange }) => {
    // FIX: Changed type assertion to be more direct.
    const allParamKeys = Object.keys(instrument.paramDefinitions) as Array<keyof InstrumentParams>;
    
    const channelParamKeys: Array<keyof InstrumentParams> = ['reverbSend', 'delaySend', 'flangerSend'];
    const synthParamKeys = allParamKeys.filter(k => !channelParamKeys.includes(k));

    return (
        <div className="bg-gray-800/80 mt-1 p-3 rounded-md border border-gray-700 animate-fade-in">
            <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Synthesis</h4>
            <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                {synthParamKeys.map((paramKey) => {
                    const def = instrument.paramDefinitions[paramKey];
                    if (!def) return null;
                    // Only render slider if the parameter actually exists and is defined for this instrument
                    const paramValue = instrument.params[paramKey];
                    if (typeof paramValue === 'undefined') return null;
                    
                    return (
                        <ParamSlider
                            key={paramKey}
                            id={`${instrument.id}-${String(paramKey)}`}
                            def={def}
                            value={paramValue as number}
                            onChange={(value) => onParamChange(instrument.id, paramKey, value)}
                        />
                    );
                })}
            </div>

            <hr className="border-gray-700 my-3" />

            <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Channel</h4>
            <div className="grid grid-cols-3 gap-x-4 gap-y-2">
                <ParamSlider
                    id={`${instrument.id}-volume`}
                    def={VOLUME_PARAM_DEFINITION}
                    value={instrument.volume}
                    onChange={(value) => onVolumeChange(instrument.id, value)}
                />

                {channelParamKeys.map((paramKey) => {
                    const def = instrument.paramDefinitions[paramKey];
                    if (!def) return null;

                    return (
                        <ParamSlider
                            key={paramKey}
                            id={`${instrument.id}-${String(paramKey)}`}
                            def={def}
                            value={instrument.params[paramKey] as number}
                            onChange={(value) => onParamChange(instrument.id, paramKey, value)}
                        />
                    );
                })}
            </div>
        </div>
    )
}

export default ParameterControls;