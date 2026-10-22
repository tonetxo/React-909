import { describe, it, expect } from 'vitest';
import { parseVocoderSettings, serializeVocoderSettings } from './vocoderSettings';
import { INITIAL_VOCODER_PARAMS, VOCODER_PARAM_RANGES } from '../constants';
import { VocoderParams } from '../types';

describe('parseVocoderSettings', () => {
    it('returns the defaults for missing or non-object data', () => {
        for (const data of [null, undefined, 42, 'text', [1, 2]]) {
            expect(parseVocoderSettings(data)).toEqual(INITIAL_VOCODER_PARAMS);
        }
    });

    it('round-trips saved settings, always starting switched off', () => {
        const settings: VocoderParams = {
            ...INITIAL_VOCODER_PARAMS,
            enabled: true,
            carrier: 'bass',
            carrierWaveform: 'square',
            synthPitch: 60,
            formantShift: -3,
            keyGate: true,
            poly: false,
            glide: 0.25,
            velocitySensitivity: 1,
            voiceGain: 55,
            qFactor: 7.5,
        };
        const parsed = parseVocoderSettings(JSON.parse(serializeVocoderSettings(settings)));
        expect(parsed).toEqual({ ...settings, enabled: false });
    });

    it('does not store the on/off switch', () => {
        expect(JSON.parse(serializeVocoderSettings({ ...INITIAL_VOCODER_PARAMS, enabled: true }))).not.toHaveProperty('enabled');
    });

    it('clamps numbers to their slider range and rounds whole-step values', () => {
        const parsed = parseVocoderSettings({ mix: 5, synthPitch: 200, formantShift: -2.6, voiceGain: -10, attack: 0 });
        expect(parsed.mix).toBe(VOCODER_PARAM_RANGES.mix.max);
        expect(parsed.synthPitch).toBe(VOCODER_PARAM_RANGES.synthPitch.max);
        expect(parsed.formantShift).toBe(-3);
        expect(parsed.voiceGain).toBe(VOCODER_PARAM_RANGES.voiceGain.min);
        expect(parsed.attack).toBe(VOCODER_PARAM_RANGES.attack.min);
    });

    it('falls back to the default for invalid fields and keeps the valid ones', () => {
        const parsed = parseVocoderSettings({
            carrier: 'kazoo', carrierWaveform: 'noise', poly: 'yes', glide: NaN, qFactor: '8',
            sibilance: 0.2, keyGate: true,
        });
        expect(parsed).toEqual({ ...INITIAL_VOCODER_PARAMS, sibilance: 0.2, keyGate: true });
    });
});
