import React, { useState, useEffect } from 'react';

interface MidiPortSelectorProps {
  id: string;
  label: string;
  /** Fixed choices listed before the ports, e.g. "None" or "All inputs"; the first one is selected initially. */
  fixedOptions: { value: string; label: string }[];
  onSelect: (portName: string) => void;
  subscribePorts: (listener: (portNames: string[]) => void) => () => void;
}

const MidiPortSelector: React.FC<MidiPortSelectorProps> = React.memo(({ id, label, fixedOptions, onSelect, subscribePorts }) => {
  const [ports, setPorts] = useState<string[]>([]);

  useEffect(() => subscribePorts(setPorts), [subscribePorts]);

  return (
    <div className="grid grid-cols-[auto_1fr] items-center gap-x-3">
      <label htmlFor={id} className="text-gray-300 font-medium w-24 text-right">{label}</label>
      <select
        id={id}
        onChange={(e) => onSelect(e.target.value)}
        className="bg-gray-800 border border-gray-600 text-white text-sm rounded-lg focus:ring-yellow-500 focus:border-yellow-500 block w-full p-2.5"
      >
        {fixedOptions.map(({ value, label }) => (
          <option key={value} value={value}>{label}</option>
        ))}
        {ports.map(name => (
          <option key={name} value={name}>{name}</option>
        ))}
      </select>
    </div>
  );
});

export default MidiPortSelector;
