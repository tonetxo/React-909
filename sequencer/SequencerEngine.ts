// sequencer/SequencerEngine.ts
import { Pattern } from '../types';
import { AudioEngine } from '../audio/AudioEngine';

export interface SequencerCallbacks {
  onStepChange: (step: number | null) => void;
  onSongStepChange: (step: number | null) => void;
  onPatternChange: (patternIndex: number) => void;
  onPlaybackEnd: () => void;
  onTimeSignatureChange: (timeSignature: [number, number]) => void;
}

export class SequencerEngine {
  private audioEngine: AudioEngine;
  private isPlaying: boolean = false;
  private isSongMode: boolean = false;
  private currentPatternIndex: number = 0;
  private patterns: (Pattern | null)[] = Array(4).fill(null);
  private songSequence: (number | null)[] = Array(16).fill(null);
  private isSongLooping: boolean = false;
  private currentSongStep: number | null = null;
  private callbacks: SequencerCallbacks | null = null;
  private currentTempo: number = 120;
  private currentSwing: number = 0;
  
  constructor() {
    this.audioEngine = new AudioEngine();
    this.audioEngine.setStepCallback(this.handleStepChange.bind(this));
  }
  
  setCallbacks(callbacks: SequencerCallbacks) {
    this.callbacks = callbacks;
  }
  
  setPatterns(patterns: (Pattern | null)[]) {
    // Create a deep copy of patterns to prevent reference sharing between engine and UI state
    this.patterns = patterns.map(pattern => {
      if (pattern === null) return null;
      
      // Copy instruments array with deep copy of sequences
      const instruments = pattern.instruments.map(instr => ({
        ...instr,
        sequence: [...instr.sequence] // Copy the sequence array
      }));
      
      // Copy bassline sequence if it exists
      const bassline = pattern.bassline ? {
        ...pattern.bassline,
        sequence: pattern.bassline.sequence.map(step => ({...step})) // Copy each step
      } : null;
      
      return {
        ...pattern,
        instruments,
        bassline
      };
    });
  }
  
  setSongSequence(sequence: (number | null)[]) {
    this.songSequence = sequence;
  }
  
  setSongLooping(isLooping: boolean) {
    this.isSongLooping = isLooping;
  }
  
  setSongMode(isActive: boolean) {
    this.isSongMode = isActive;
  }
  
  private handleStepChange(step: number) {
    if (this.callbacks) {
      if (this.isSongMode) {
        this.callbacks.onSongStepChange(this.currentSongStep);
      }
      this.callbacks.onStepChange(step);
    }
    
    // Check for pattern completion in song mode
    if (this.isSongMode && this.isPatternComplete(step)) {
      this.handlePatternTransition();
    }
  }
  
  private isPatternComplete(currentStep: number): boolean {
    // Check if it's the last step in the current pattern's sequence
    if (this.patterns[this.currentPatternIndex] && this.patterns[this.currentPatternIndex] !== null) {
      const pattern = this.patterns[this.currentPatternIndex]!;
      const expectedSteps = pattern.instruments[0]?.sequence.length || 16;
      return currentStep === expectedSteps - 1;
    }
    return false;
  }
  
  private handlePatternTransition() {
    if (!this.isSongMode || this.currentSongStep === null) return;

    let nextSongStep = -1;
    const songLength = this.songSequence.length;

    // Start searching from the step after the current one
    for (let i = this.currentSongStep + 1; i < songLength; i++) {
      if (this.songSequence[i] !== null) {
        nextSongStep = i;
        break;
      }
    }

    // If looping and nothing was found, search from the beginning
    if (nextSongStep === -1 && this.isSongLooping) {
      for (let i = 0; i < this.currentSongStep + 1; i++) {
        if (this.songSequence[i] !== null) {
          nextSongStep = i;
          break;
        }
      }
    }

    if (nextSongStep !== -1) {
      const nextPatternIndex = this.songSequence[nextSongStep];
      if (nextPatternIndex !== null && this.patterns[nextPatternIndex]) {
        this.currentSongStep = nextSongStep;
        this.currentPatternIndex = nextPatternIndex;
        const pattern = this.patterns[this.currentPatternIndex]!;

        if (this.isPlaying) {
          // Instead of restarting, just update the pattern data
          this.audioEngine.setPattern(
            pattern.instruments,
            pattern.bassline!,
            pattern.instruments[0]?.sequence.length || 16
          );
        }

        if (this.callbacks) {
          this.callbacks.onPatternChange(this.currentPatternIndex);
          this.callbacks.onSongStepChange(this.currentSongStep);
        }
      } else {
        // Next pattern is invalid, treat as end of song
        this.stop();
        if (this.callbacks) this.callbacks.onPlaybackEnd();
      }
    } else {
      // No more patterns to play
      this.stop();
      if (this.callbacks) this.callbacks.onPlaybackEnd();
    }
  }
  
  async start(tempo: number, swing: number) {
    this.currentTempo = tempo;
    this.currentSwing = swing;

    if (this.isPlaying) return;
    
    let patternIndexToPlay = this.currentPatternIndex;
    if (this.isSongMode) {
      const firstSongStep = this.songSequence.findIndex(p => p !== null);
      if (firstSongStep !== -1) {
        const patternIndex = this.songSequence[firstSongStep];
        if (patternIndex !== null && this.patterns[patternIndex]) {
          this.currentSongStep = firstSongStep;
          patternIndexToPlay = patternIndex;
        } else {
          this.stop(); return;
        }
      } else {
        this.stop(); return;
      }
    }
    
    this.currentPatternIndex = patternIndexToPlay;
    const pattern = this.patterns[this.currentPatternIndex];

    if (pattern) {
      this.isPlaying = true; // Set isPlaying only if start is successful
      if (this.callbacks) {
        this.callbacks.onPatternChange(this.currentPatternIndex);
        if (this.isSongMode) {
          this.callbacks.onSongStepChange(this.currentSongStep);
        }
      }
      await this.audioEngine.start(
        tempo,
        swing,
        pattern.instruments,
        pattern.bassline!,
        pattern.instruments[0]?.sequence.length || 16
      );
    }
  }
  
  stop() {
    if (this.isPlaying) {
      this.isPlaying = false;
      this.audioEngine.stop();
      
      if (this.callbacks) {
        this.callbacks.onStepChange(null);
        this.callbacks.onSongStepChange(null);
      }
    }
  }
  
  async togglePlayback(tempo: number, swing: number) {
    if (this.isPlaying) {
      this.stop();
    } else {
      await this.start(tempo, swing);
    }
  }
  
  async loadPattern(patternIndex: number) {
    if (patternIndex >= 0 && patternIndex < this.patterns.length) {
      const newPattern = this.patterns[patternIndex];
      if (newPattern) {
        const oldPattern = this.patterns[this.currentPatternIndex];
        this.currentPatternIndex = patternIndex;

        if (oldPattern &&
            JSON.stringify(oldPattern.timeSignature) !== JSON.stringify(newPattern.timeSignature) &&
            this.callbacks?.onTimeSignatureChange) {
          this.callbacks.onTimeSignatureChange(newPattern.timeSignature);
        }

        if (this.isPlaying) {
          // Just update the pattern instead of restarting
          this.audioEngine.setPattern(
            newPattern.instruments,
            newPattern.bassline!,
            newPattern.instruments[0]?.sequence.length || 16
          );
        }
      } else {
        this.currentPatternIndex = patternIndex;
      }
    }
  }
  
  // Method to reload the current pattern during playback (useful for updating mute/solo states)
  async reloadCurrentPattern(updatedPattern?: Pattern) {
    const patternToReload = updatedPattern || this.patterns[this.currentPatternIndex];

    if (patternToReload && this.isPlaying) {
      // Use setPattern to avoid restarting the engine
      this.audioEngine.setPattern(
        patternToReload.instruments,
        patternToReload.bassline!,
        patternToReload.instruments[0]?.sequence.length || 16
      );
    }
  }
  
  getCurrentPatternIndex(): number {
    return this.currentPatternIndex;
  }
  
  getCurrentStep(): number | null {
    return this.audioEngine.getCurrentStep();
  }
  
  getCurrentSongStep(): number | null {
    return this.currentSongStep;
  }
  
  isPlayingState(): boolean {
    return this.isPlaying;
  }
  
  destroy() {
    this.audioEngine.destroy();
    this.stop();
  }
}