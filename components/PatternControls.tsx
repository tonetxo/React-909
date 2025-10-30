import React, { useRef } from 'react';
import { Pattern } from '../types';

interface PatternControlsProps {
    patterns: (Pattern | null)[];
    selectedPatternIndex: number;
    onLoad: (index: number) => void;
    onSave: () => void;
    onExport: () => void;
    onImport: (event: React.ChangeEvent<HTMLInputElement>) => void;
    onCopy: () => void;
    onPaste: () => void;
    isClipboardEmpty: boolean;
    isPlaying: boolean;
    onReset: () => void; // Add onReset prop
}

const PatternControls: React.FC<PatternControlsProps> = ({ 
    patterns, 
    selectedPatternIndex, 
    onLoad, 
    onSave, 
    onExport, 
    onImport,
    onCopy,
    onPaste,
    isClipboardEmpty,
    isPlaying,
    onReset // Add onReset here
}) => {
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleImportClick = () => {
        fileInputRef.current?.click();
    };

    return (
        <div className="p-4 bg-gray-900/50 rounded-lg border border-gray-700 w-full">
             <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3 text-center">Patterns</h4>
            <div className="flex items-center justify-center gap-4 flex-wrap">
                <div className="flex gap-2" role="group" aria-label="Pattern Slots">
                    {patterns.map((pattern, index) => {
                        const isSelected = index === selectedPatternIndex;
                        const hasData = pattern !== null;
                        const isCurrentlyPlaying = isSelected && isPlaying;

                        const baseClasses = "relative w-12 h-10 rounded-md font-bold text-lg transition-all duration-150 focus:outline-none";
                        let stateClasses = "bg-gray-700 text-gray-400 hover:bg-gray-600";
                        if (hasData) {
                            stateClasses = "bg-gray-600 text-white hover:bg-gray-500";
                        }
                        if (isSelected) {
                            stateClasses += " ring-2 ring-offset-2 ring-offset-gray-800 ring-yellow-400";
                        }

                        return (
                            <button
                                key={index}
                                onClick={() => onLoad(index)}
                                className={`${baseClasses} ${stateClasses}`}
                                aria-pressed={isSelected}
                                aria-label={`Select and load pattern ${index + 1}${hasData ? ' (has data)' : ''}`}
                            >
                                {isCurrentlyPlaying && (
                                  <span className="absolute top-1.5 right-1.5 w-2.5 h-2.5 bg-green-400 rounded-full animate-pulse" title="Currently Playing"></span>
                                )}
                                {index + 1}
                            </button>
                        );
                    })}
                </div>
                <div className="flex gap-2 flex-wrap justify-center" role="group" aria-label="Pattern Actions">
                    <button
                        onClick={onSave}
                        className="px-5 py-2 bg-yellow-500 text-gray-900 font-bold rounded-md hover:bg-yellow-400 transition-colors duration-200 shadow-lg h-10"
                        aria-label={`Save current sequence to pattern slot ${selectedPatternIndex + 1}`}
                    >
                        Save
                    </button>
                     <button
                        onClick={onCopy}
                        className="px-5 py-2 bg-gray-600 text-white font-bold rounded-md hover:bg-gray-500 transition-colors duration-200 shadow-lg h-10"
                        aria-label={`Copy current pattern to clipboard`}
                    >
                        Copy
                    </button>
                    <button
                        onClick={onPaste}
                        disabled={isClipboardEmpty}
                        className="px-5 py-2 font-bold rounded-md transition-colors duration-200 shadow-lg h-10 disabled:bg-gray-800 disabled:text-gray-500 disabled:cursor-not-allowed bg-gray-600 text-white hover:bg-gray-500"
                        aria-label={`Paste copied pattern to slot ${selectedPatternIndex + 1}`}
                    >
                        Paste
                    </button>
                    <button
                        onClick={onExport}
                        className="px-5 py-2 bg-blue-500 text-white font-bold rounded-md hover:bg-blue-400 transition-colors duration-200 shadow-lg h-10"
                        aria-label="Export project (patterns and song) to a JSON file"
                    >
                        Export
                    </button>
                    <button
                        onClick={handleImportClick}
                        className="px-5 py-2 bg-green-500 text-white font-bold rounded-md hover:bg-green-400 transition-colors duration-200 shadow-lg h-10"
                        aria-label="Import project from a JSON file"
                    >
                        Import
                    </button>
                    <button
                        onClick={onReset}
                        className="px-5 py-2 bg-red-500 text-white font-bold rounded-md hover:bg-red-400 transition-colors duration-200 shadow-lg h-10"
                        aria-label="Reset all patterns and song to initial state"
                    >
                        Reset
                    </button>
                    <input
                        type="file"
                        ref={fileInputRef}
                        onChange={onImport}
                        accept=".json,application/json"
                        className="hidden"
                        aria-hidden="true"
                    />
                </div>
            </div>
        </div>
    );
};

export default PatternControls;
