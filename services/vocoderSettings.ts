// Vocoder settings saved in localStorage between sessions (separate from the project, whose JSON
// format is shared with other apps). The stored JSON is untrusted: every field is validated and
// clamped, and anything missing or invalid falls back to the default. Keep this module pure.

import { VocoderParams } from '../types';
import { INITIAL_VOCODER_PARAMS, VOCODER_CARRIERS, VOCODER_PARAM_RANGES, WAVEFORMS } from '../constants';

export const VOCODER_STORAGE_KEY = 'o-grove-son-vocoder';

const BOOLEAN_PARAMS = ['keyGate', 'poly'] as const;

/** Builds valid vocoder params from stored data. The vocoder always starts switched off (it needs the mic). */
export const parseVocoderSettings = (data: unknown): VocoderParams => {
    const params: VocoderParams = { ...INITIAL_VOCODER_PARAMS, enabled: false };
    if (typeof data !== 'object' || data === null || Array.isArray(data)) return params;
    const stored = data as Record<string, unknown>;

    for (const [key, { min, max, step }] of Object.entries(VOCODER_PARAM_RANGES) as [keyof typeof VOCODER_PARAM_RANGES, { min: number; max: number; step: number }][]) {
        const value = stored[key];
        if (typeof value !== 'number' || !Number.isFinite(value)) continue;
        const clamped = Math.min(Math.max(value, min), max);
        params[key] = step >= 1 ? Math.round(clamped) : clamped;
    }
    for (const key of BOOLEAN_PARAMS) {
        if (typeof stored[key] === 'boolean') params[key] = stored[key];
    }
    if (VOCODER_CARRIERS.includes(stored.carrier as VocoderParams['carrier'])) {
        params.carrier = stored.carrier as VocoderParams['carrier'];
    }
    if (WAVEFORMS.includes(stored.carrierWaveform as VocoderParams['carrierWaveform'])) {
        params.carrierWaveform = stored.carrierWaveform as VocoderParams['carrierWaveform'];
    }
    return params;
};

/** JSON for storage; `enabled` is left out on purpose. */
export const serializeVocoderSettings = (params: VocoderParams): string => {
    const { enabled: _enabled, ...settings } = params;
    return JSON.stringify(settings);
};
