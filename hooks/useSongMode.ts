// hooks/useSongMode.ts
import { useState } from 'react';

const SONG_STEPS = 16;
const NUM_PATTERNS = 4;

export const useSongMode = () => {
  const [isSongModeActive, setIsSongModeActive] = useState<boolean>(false);
  const [songSequence, setSongSequence] = useState<(number | null)[]>(() =>
    Array(SONG_STEPS).fill(null)
  );
  const [isSongLooping, setIsSongLooping] = useState<boolean>(false);

  const handleToggleSongMode = () => {
    setIsSongModeActive((prev) => !prev);
  };

  const handleToggleSongLoop = () => {
    setIsSongLooping((prev) => !prev);
  };

  const handleSongStepClick = (stepIndex: number) => {
    setSongSequence((prevSequence) => {
      const newSequence = [...prevSequence];
      const currentValue = newSequence[stepIndex];
      let nextValue: number | null = null;
      if (currentValue === null) {
        nextValue = 0;
      } else if (currentValue < NUM_PATTERNS - 1) {
        nextValue = currentValue + 1;
      }
      newSequence[stepIndex] = nextValue;
      return newSequence;
    });
  };

  const handleClearSong = () => {
    setSongSequence(Array(SONG_STEPS).fill(null));
  };

  return {
    isSongModeActive,
    songSequence,
    isSongLooping,
    handleToggleSongMode,
    handleToggleSongLoop,
    handleSongStepClick,
    handleClearSong,
    setSongSequence,
    setIsSongLooping,
  };
};
