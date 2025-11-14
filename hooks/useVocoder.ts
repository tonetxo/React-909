// hooks/useVocoder.ts
import { useState } from 'react';
import { VocoderParams, VocoderType } from '../types';
import { INITIAL_VOCODER_PARAMS } from '../constants';
import {
  toggleVocoder,
  updateVocoderParams,
  setVocoderType as setAudioServiceVocoderType,
} from '../services/audioService';

export const useVocoder = () => {
  const [vocoderType, setVocoderType] = useState<VocoderType>('original');
  const [vocoderParams, setVocoderParams] = useState<VocoderParams>(
    structuredClone(INITIAL_VOCODER_PARAMS)
  );

  const handleVocoderParamChange = (
    param: keyof VocoderParams,
    value: string | number | boolean
  ) => {
    const newParams = { ...vocoderParams, [param]: value };
    setVocoderParams(newParams);
    updateVocoderParams(newParams);

    if (param === 'enabled') {
      toggleVocoder(value as boolean).catch(() => {
        setVocoderParams((prev) => ({ ...prev, enabled: false }));
      });
    }
  };

  const handleVocoderTypeChange = (type: VocoderType) => {
    setVocoderType(type);
    setAudioServiceVocoderType(type);
  };

  return {
    vocoderType,
    vocoderParams,
    handleVocoderParamChange,
    handleVocoderTypeChange,
  };
};
