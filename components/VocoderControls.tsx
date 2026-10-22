import React, { useRef, useEffect } from 'react';
import { VocoderParams, VocoderCarrier } from '../types';
import { WAVEFORMS, WAVEFORM_LABELS, VOCODER_CARRIERS, VOCODER_PARAM_RANGES } from '../constants';

interface VocoderControlsProps {
    params: VocoderParams;
    onParamChange: (param: keyof VocoderParams, value: string | number | boolean) => void;
    /** Note played by the A key of the PC keyboard */
    pcKeyboardBase: number;
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
    format?: (value: number) => string;
    disabled?: boolean;
}> = ({ id, label, value, onChange, format = (v) => v.toFixed(2), disabled = false, ...rest }) => (
    <div className={`flex flex-col ${disabled ? 'opacity-50' : ''}`}>
        <div className="flex justify-between items-center mb-1">
            <label htmlFor={id} className="text-xs text-gray-400 font-medium">
                {label}
            </label>
            <span className="text-xs font-mono bg-gray-700 text-white px-1.5 py-0.5 rounded-sm">
                {format(value)}
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

const CARRIER_LABELS: Record<VocoderCarrier, string> = { drums: 'Drums', bass: 'Bass', both: 'Both', synth: 'Synth' };
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const formatNote = (midi: number) => `${NOTE_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`; // 60 = C4
const formatPercent = (v: number) => `${Math.round(v * 100)}%`;
const formatMs = (v: number) => `${Math.round(v * 1000)} ms`;
const formatSemitones = (v: number) => `${v > 0 ? '+' : ''}${v} st`;
const formatInteger = (v: number) => v.toFixed(0);

const VocoderControls: React.FC<VocoderControlsProps> = React.memo(({ params, onParamChange, pcKeyboardBase, startVisualizer, stopVisualizer }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const carriers = VOCODER_CARRIERS.map(id => ({ id, label: CARRIER_LABELS[id] }));

    useEffect(() => {
        if (params.enabled && canvasRef.current) {
            startVisualizer(canvasRef.current);
        }
        // Return a cleanup function that calls stopVisualizer
        return () => {
            stopVisualizer();
        };
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
                                    className={`text-xs font-semibold flex-1 py-2 rounded-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${params.carrier === id ? 'bg-yellow-500 text-gray-900' : 'bg-gray-700 hover:bg-gray-600'}`}
                                >
                                    {label}
                                </button>
                            ))}
                        </div>
                    </div>

                    <ParamSlider id="vocoder-mix" label="Mix" {...VOCODER_PARAM_RANGES.mix} value={params.mix} onChange={(v) => onParamChange('mix', v)} format={formatPercent} disabled={!params.enabled} />
                    <ParamSlider id="vocoder-formant" label="Formant" {...VOCODER_PARAM_RANGES.formantShift} value={params.formantShift} onChange={(v) => onParamChange('formantShift', v)} format={formatSemitones} disabled={!params.enabled} />

                    <ParamSlider
                        id="vocoder-pitch"
                        label="Synth Pitch"
                        {...VOCODER_PARAM_RANGES.synthPitch}
                        value={params.synthPitch}
                        onChange={(v) => onParamChange('synthPitch', v)}
                        format={formatNote}
                        disabled={!params.enabled || params.carrier !== 'synth'}
                    />

                    <div className={`flex flex-col ${!params.enabled || params.carrier !== 'synth' ? 'opacity-50' : ''}`}>
                        <label className="text-xs text-gray-400 font-medium mb-1">Synth Wave</label>
                        <div className="flex gap-1" role="group">
                            {WAVEFORMS.map(wf => (
                                <button
                                    key={wf}
                                    onClick={() => onParamChange('carrierWaveform', wf)}
                                    disabled={!params.enabled || params.carrier !== 'synth'}
                                    className={`text-xs font-semibold flex-1 py-1 rounded-sm transition-colors disabled:cursor-not-allowed ${params.carrierWaveform === wf ? 'bg-yellow-500 text-gray-900' : 'bg-gray-700 hover:bg-gray-600'}`}
                                >
                                    {WAVEFORM_LABELS[wf]}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="col-span-2 md:col-span-4 flex items-center gap-3">
                        <button
                            onClick={() => onParamChange('poly', !params.poly)}
                            disabled={!params.enabled || params.carrier !== 'synth'}
                            aria-pressed={params.poly}
                            title="Poly: ata 4 notas á vez; Mono: só a última nota pulsada"
                            className={`shrink-0 text-xs font-semibold px-3 py-1 rounded-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${params.poly ? 'bg-yellow-500 text-gray-900' : 'bg-gray-700 hover:bg-gray-600'}`}
                        >
                            {params.poly ? 'Poly 4' : 'Mono'}
                        </button>
                        <button
                            onClick={() => onParamChange('keyGate', !params.keyGate)}
                            disabled={!params.enabled || params.carrier !== 'synth'}
                            aria-pressed={params.keyGate}
                            title="Gate: o vocoder só soa mentres mantés unha tecla pulsada"
                            className={`shrink-0 text-xs font-semibold px-3 py-1 rounded-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${params.keyGate ? 'bg-yellow-500 text-gray-900' : 'bg-gray-700 hover:bg-gray-600'}`}
                        >
                            Gate {params.keyGate ? 'ON' : 'OFF'}
                        </button>
                        <div className="w-36 shrink-0" title="Glide (só en Mono): tempo para esvarar dunha nota á seguinte">
                            <ParamSlider id="vocoder-glide" label="Glide" {...VOCODER_PARAM_RANGES.glide} value={params.glide} onChange={(v) => onParamChange('glide', v)} format={formatMs} disabled={!params.enabled || params.carrier !== 'synth' || params.poly} />
                        </div>
                        <div className="w-36 shrink-0" title="Sensibilidade á velocidade das teclas MIDI (0% = todas soan igual)">
                            <ParamSlider id="vocoder-velocity" label="Velocity" {...VOCODER_PARAM_RANGES.velocitySensitivity} value={params.velocitySensitivity} onChange={(v) => onParamChange('velocitySensitivity', v)} format={formatPercent} disabled={!params.enabled || params.carrier !== 'synth'} />
                        </div>
                        <p className="text-xs text-gray-500">
                            Toca Synth Pitch co teclado MIDI ou co do PC: fila A–Ñ (A = {formatNote(pcKeyboardBase)}), W E T Y U O P para as negras, Z / X baixan ou soben a oitava.
                        </p>
                    </div>
                </div>

                <div className="flex flex-col items-center">
                    <label className="text-xs text-gray-400 font-medium mb-1">Mic In</label>
                    <div className="w-16 h-24 bg-gray-900 rounded-sm border border-gray-700">
                        <canvas ref={canvasRef} width="64" height="96" className="w-full h-full"></canvas>
                    </div>
                </div>
            </div>
            <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4">
                <h5 className="col-span-full text-xs text-gray-400 font-medium border-b border-gray-700 pb-1 mb-1">Settings</h5>
                <ParamSlider id="vocoder-voice-gain" label="Voice Gain" {...VOCODER_PARAM_RANGES.voiceGain} value={params.voiceGain} onChange={(v) => onParamChange('voiceGain', v)} format={formatInteger} disabled={!params.enabled} />
                <ParamSlider id="vocoder-noise-gate" label="Noise Gate" {...VOCODER_PARAM_RANGES.noiseGate} value={params.noiseGate} onChange={(v) => onParamChange('noiseGate', v)} format={formatInteger} disabled={!params.enabled} />
                <ParamSlider id="vocoder-attack" label="Attack" {...VOCODER_PARAM_RANGES.attack} value={params.attack} onChange={(v) => onParamChange('attack', v)} format={formatMs} disabled={!params.enabled} />
                <ParamSlider id="vocoder-release" label="Release" {...VOCODER_PARAM_RANGES.release} value={params.release} onChange={(v) => onParamChange('release', v)} format={formatMs} disabled={!params.enabled} />
                <ParamSlider id="vocoder-sibilance" label="Sibilance" {...VOCODER_PARAM_RANGES.sibilance} value={params.sibilance} onChange={(v) => onParamChange('sibilance', v)} format={formatPercent} disabled={!params.enabled} />
                <ParamSlider id="vocoder-q-factor" label="Q-Factor" {...VOCODER_PARAM_RANGES.qFactor} value={params.qFactor} onChange={(v) => onParamChange('qFactor', v)} format={(v) => v.toFixed(1)} disabled={!params.enabled} />
            </div>
        </div>
    );
});

export default VocoderControls;