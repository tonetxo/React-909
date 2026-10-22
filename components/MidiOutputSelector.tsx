import React, { useState, useEffect } from 'react';

interface MidiOutputSelectorProps {
  onOutputSelect: (outputName: string) => void;
  subscribeOutputs: (listener: (outputNames: string[]) => void) => () => void;
}

const MidiOutputSelector: React.FC<MidiOutputSelectorProps> = React.memo(({ onOutputSelect, subscribeOutputs }) => {
  const [outputs, setOutputs] = useState<string[]>([]);

  // Default to None - user must explicitly select a port
  useEffect(() => subscribeOutputs(setOutputs), [subscribeOutputs]);

  return (
    <div className="grid grid-cols-[auto_1fr] items-center gap-x-3">
      <label htmlFor="midi-output" className="text-gray-300 font-medium w-24 text-right">MIDI Output</label>
      <select
        id="midi-output"
        onChange={(e) => onOutputSelect(e.target.value)}
        className="bg-gray-800 border border-gray-600 text-white text-sm rounded-lg focus:ring-yellow-500 focus:border-yellow-500 block w-full p-2.5"
      >
        <option value="">None (Disabled)</option>
        {outputs.map(name => (
          <option key={name} value={name}>{name}</option>
        ))}
      </select>
    </div>
  );
});

export default MidiOutputSelector;
