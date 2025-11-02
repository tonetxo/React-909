import React from 'react';
import { Velocity } from '../types';
import { DRUM_VELOCITY_COLORS } from '../constants';

interface StepProps {
  velocity: Velocity;
  isCurrent: boolean;
  onClick: () => void;
  onContextMenu: (event: React.MouseEvent) => void;
}

const Step: React.FC<StepProps> = ({ velocity, isCurrent, onClick, onContextMenu }) => {
  const baseClasses = "w-full h-8 rounded-md border-2 transition-all duration-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 focus:ring-yellow-400";
  
  const activeClasses = velocity > 0 && velocity <= DRUM_VELOCITY_COLORS.length
    ? `${DRUM_VELOCITY_COLORS[velocity - 1]} shadow-md`
    : "bg-gray-700 border-gray-600 hover:bg-gray-600";
  
  const currentStepClasses = isCurrent 
    ? "border-white transform scale-110 ring-2 ring-white z-10" 
    : "";

  return (
    <button
      onClick={onClick}
      onContextMenu={onContextMenu}
      className={`${baseClasses} ${activeClasses} ${currentStepClasses}`}
      aria-pressed={velocity > 0}
      aria-label={`Step, Velocity ${velocity}`}
    />
  );
};

export default Step;