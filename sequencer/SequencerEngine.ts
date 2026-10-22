// sequencer/SequencerEngine.ts
import { Pattern } from '../types';
import { AudioEngine, audioEngine } from '../services/audioService';

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
  private queuedPatternIndex: number | null = null;
  private ignoreFirstStepZero: boolean = false;

  constructor() {
    this.audioEngine = audioEngine;
    this.audioEngine.setStepCallback(this.handleStepChange.bind(this));
    this.audioEngine.setOnStopCallback(() => {
      this.isPlaying = false;
      if (this.callbacks) {
        this.callbacks.onPlaybackEnd();
        this.callbacks.onStepChange(null);
        this.callbacks.onSongStepChange(null);
      }
    });
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
        sequence: pattern.bassline.sequence.map(step => ({ ...step })) // Copy each step
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

  setMidiOutput(outputName: string) {
    this.audioEngine.setMidiOutput(outputName);
  }

  private handleStepChange(step: number) {
    if (this.callbacks) {
      this.callbacks.onStepChange(step);
      if (this.isSongMode) {
        this.callbacks.onSongStepChange(this.currentSongStep);
      }
    }

    // Ignore the very first step 0 event after start(), as we already set up the initial state
    // and queued the next pattern. We just want to clear the flag.
    if (step === 0 && this.ignoreFirstStepZero) {
      this.ignoreFirstStepZero = false;
      return;
    }

    // Handle queued pattern transition at the start of the new pattern
    if (step === 0 && this.queuedPatternIndex !== null) {
      this.currentPatternIndex = this.queuedPatternIndex;
      this.queuedPatternIndex = null;

      if (this.queuedSongStep !== null) {
        this.currentSongStep = this.queuedSongStep;
        this.queuedSongStep = null;
      }

      if (this.callbacks) {
        this.callbacks.onPatternChange(this.currentPatternIndex);
        if (this.isSongMode) {
          this.callbacks.onSongStepChange(this.currentSongStep);
        }
      }
    }

    // Queue next pattern early in the current pattern (at step 0)
    if (this.isSongMode && step === 0) {
      this.queueNextPattern();
    }
  }

  private queueNextPattern() {
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
        // We don't update currentSongStep/currentPatternIndex yet.
        // We just queue it in the audio engine and store the index for later.

        // Store the NEXT song step so we can update it when the pattern actually switches
        this.queuedPatternIndex = nextPatternIndex;
        this.queuedSongStep = nextSongStep;

        const pattern = this.patterns[nextPatternIndex]!;
        this.audioEngine.queuePattern(
          pattern.instruments,
          pattern.bassline!,
          this.getPatternLength(pattern)
        );
      }
    } else {
      // End of song
      this.audioEngine.setStopAtEndOfPattern(true);
    }
  }

  private queuedSongStep: number | null = null;



  async start(tempo: number, swing: number) {
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
      if (this.isSongMode) {
        this.ignoreFirstStepZero = true;
      }

      const patternLength = this.getPatternLength(pattern);
      await this.audioEngine.start(
        tempo,
        swing,
        pattern.instruments,
        pattern.bassline!,
        patternLength
      );

      // Immediately queue the next pattern (or stop) to avoid missed deadlines for short patterns
      // or if the first pattern needs to transition immediately.
      if (this.isSongMode) {
        this.queueNextPattern();
      }
    }
  }

  stop() {
    if (this.isPlaying) {
      this.isPlaying = false;
      // Callbacks to React are fired by the AudioEngine onStop handler
      this.audioEngine.stop();
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

  updateTempo(tempo: number) {
    if (this.isPlaying) {
      this.audioEngine.updateTempo(tempo);
    }
  }

  updateSwing(swing: number) {
    if (this.isPlaying) {
      this.audioEngine.updateSwing(swing);
    }
  }

  isPlayingState(): boolean {
    return this.isPlaying;
  }

  private getPatternLength(pattern: Pattern): number {
    if (pattern.instruments && pattern.instruments.length > 0) {
      // Find the first instrument with a sequence and use its length
      const instr = pattern.instruments.find(i => i.sequence && i.sequence.length > 0);
      if (instr) return instr.sequence.length;
    }
    return 16;
  }
}