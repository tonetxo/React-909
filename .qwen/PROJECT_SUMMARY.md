# Project Summary

## Overall Goal
Create a dual vocoder system in a Web Audio-based groovebox application that allows users to switch between two different vocoder implementations with minimal latency and audio artifacts.

## Key Knowledge
- **Technology Stack**: TypeScript, Web Audio API, React, Vite, Tailwind CSS
- **Architecture**: Dual vocoder system with selector - original AudioWorklet-based vocoder and new FFT-based vocoder
- **Build Commands**: `npm run dev` to run development server
- **Audio Management**: Coordinated microphone resource sharing between two vocoders
- **Vocoder Types**: 
  - Original vocoder: AudioWorklet-based with carrier input from sequencer instruments
  - New vocoder: FFT-based with internal synthesizer carrier
- **File Structure**: Core audio logic in `/services/audioService.ts`, UI in `/components/VocoderControls.tsx`

## Recent Actions
- [DONE] Implemented coordinated management between original and new vocoders to prevent microphone conflicts
- [DONE] Added selector in UI to switch between vocoder types
- [DONE] Created `switchToVocoder()` function for proper microphone resource management
- [DONE] Updated VocoderControls component to handle both vocoder types with appropriate parameters
- [DONE] Fixed microphone access and visualization for both vocoders
- [DONE] Applied audio smoothing techniques to reduce clicking sounds during activation/deactivation
- [DONE] Implemented proper fade-in/fade-out transitions when enabling/disabling vocoders
- [DONE] Removed reference folder `web-vocoder` to avoid Git conflicts

## Current Plan
- [IN PROGRESS] Fix issue where neither vocoder produces sound despite microphone permission being requested
- [TODO] Debug the microphone activation logic to ensure both vocoders work without requiring type change
- [TODO] Fine-tune audio processing parameters for optimal performance
- [TODO] Consider additional audio smoothing or crossfading for seamless transitions
- [TODO] Test with various input sources and carrier signals to validate functionality
- [TODO] Document the dual vocoder system and usage patterns

---

## Summary Metadata
**Update time**: 2025-10-30T21:33:24.570Z 
