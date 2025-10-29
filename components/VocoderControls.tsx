import React, { useRef, useEffect } from 'react';
import { VocoderParams, VocoderCarrier } from '../types';

interface VocoderControlsProps {
    params: VocoderParams;
    onParamChange: (param: keyof VocoderParams, value: string | number | boolean) => void;
    startVisualizer: (canvas: HTMLCanvasElement) => void;
    stopVisualizer: () => void;
}

const ParamSlider: React.FC<{
    id: string;
    label: string;
    min: number;
    max: number;
    step: number;
    value: number;
    onChange: (value: number) => void;
    unit?: string;
    disabled?: boolean;
}> = ({ id, label, value, onChange, unit = '', disabled=false, ...rest }) => (
    <div className={`flex flex-col ${disabled ? 'opacity-50' : ''}`}>
        <div className="flex justify-between items-center mb-1">
            <label htmlFor={id} className="text-xs text-gray-400 font-medium">
                {label}
            </label>
            <span className="text-xs font-mono bg-gray-700 text-white px-1.5 py-0.5 rounded">
                {value.toFixed(2)} {unit}
            </span>
        </div>
        <input
            type="range" id={id}
            value={value}
            onChange={(e) => onChange(parseFloat(e.target.value))}
            className="w-full accent-yellow-500 h-1.5 disabled:cursor-not-allowed"
            disabled={disabled}
            {...rest}
        />
    </div>
);

const VocoderControls: React.FC<VocoderControlsProps> = ({ params, onParamChange, startVisualizer, stopVisualizer }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const carriers: { id: VocoderCarrier, label: string }[] = [
        { id: 'drums', label: 'Drums' },
        { id: 'bass', label: 'Bass' },
        { id: 'both', label: 'Both' },
        { id: 'synth', label: 'Synth' }
    ];

    useEffect(() => {
        if (params.enabled && canvasRef.current) {
            startVisualizer(canvasRef.current);
        }
        return () => stopVisualizer();
    }, [params.enabled, startVisualizer, stopVisualizer]);

    return (
        <div className="p-4 bg-gray-900/50 rounded-lg border border-gray-700 w-full">
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-4">
                    <h4 className="text-sm font-bold text-gray-400 uppercase tracking-wider">Vocoder</h4>
                    <button
                        onClick={() => onParamChange('enabled', !params.enabled)}
                        role="switch"
                        aria-checked={params.enabled}
                        className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-yellow-500 focus:ring-offset-2 focus:ring-offset-gray-800 ${
                        params.enabled ? 'bg-yellow-500' : 'bg-gray-600'
                        }`}
                    >
                        <span
                        aria-hidden="true"
                        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                            params.enabled ? 'translate-x-5' : 'translate-x-0'
                        }`}
                        />
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr] gap-x-8 gap-y-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="flex flex-col space-y-2 col-span-2 md:col-span-4">
                        <label className="text-xs text-gray-400 font-medium">Carrier</label>
                        <div className="flex gap-2" role="group">
                            {carriers.map(({ id, label }) => (
                                <button
                                    key={id}
                                    onClick={() => onParamChange('carrier', id)}
                                    disabled={!params.enabled}
                                    className={`text-xs font-semibold flex-1 py-2 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${params.carrier === id ? 'bg-yellow-500 text-gray-900' : 'bg-gray-700 hover:bg-gray-600'}`}
                                >
                                    {label}
                                </button>
                            ))}
                        </div>
                    </div>
                    
                    <ParamSlider id="vocoder-mix" label="Mix" min={0} max={1} step={0.01} value={params.mix} onChange={(v) => onParamChange('mix', v)} disabled={!params.enabled} />
                    <ParamSlider id="vocoder-formant" label="Formant" min={-12} max={12} step={1} value={params.formantShift} onChange={(v) => onParamChange('formantShift', v)} unit="st" disabled={!params.enabled} />
                    
                    <ParamSlider 
                        id="vocoder-pitch" 
                        label="Synth Pitch" 
                        min={24} max={72} step={1} 
                        value={params.synthPitch} 
                        onChange={(v) => onParamChange('synthPitch', v)} 
                        unit="MIDI"
                        disabled={!params.enabled || params.carrier !== 'synth'}
                    />
                </div>
                
                <div className="flex flex-col items-center">
                    <label className="text-xs text-gray-400 font-medium mb-1">Mic In</label>
                    <div className="w-16 h-24 bg-gray-900 rounded border border-gray-700">
                        <canvas ref={canvasRef} width="64" height="96" className="w-full h-full"></canvas>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default VocoderControls;
