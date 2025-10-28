import React from 'react';

interface StepProps {
  isActive: boolean;
  isCurrent: boolean;
  onClick: () => void;
}

const Step: React.FC<StepProps> = ({ isActive, isCurrent, onClick }) => {
  const baseClasses = "w-8 h-8 rounded-md border-2 transition-all duration-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 focus:ring-yellow-400";
  
  const activeClasses = isActive 
    ? "bg-yellow-500 border-yellow-400 shadow-md shadow-yellow-500/50" 
    : "bg-gray-700 border-gray-600 hover:bg-gray-600";
  
  const currentStepClasses = isCurrent 
    ? "border-white transform scale-110 ring-2 ring-white" 
    : "";

  return (
    <button
      onClick={onClick}
      className={`${baseClasses} ${activeClasses} ${currentStepClasses}`}
      aria-pressed={isActive}
    />
  );
};

export default Step;