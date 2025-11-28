import React, { useState, useEffect } from 'react';

interface MidiOutputSelectorProps {
  onOutputSelect: (outputName: string) => void;
}

const MidiOutputSelector: React.FC<MidiOutputSelectorProps> = React.memo(({ onOutputSelect }) => {
  const [outputs, setOutputs] = useState<WebMidi.MIDIOutput[]>([]);

  useEffect(() => {
    const getMidiOutputs = async () => {
      if (navigator.requestMIDIAccess) {
        try {
          const midiAccess = await navigator.requestMIDIAccess();
          const outputDevices = Array.from(midiAccess.outputs.values())
            .filter(output => 
              // Filter out inputs that appear as outputs (common in Linux/ALSA for virtual ports)
              !output.name.toLowerCase().includes('input')
            );
          setOutputs(outputDevices);
          // Default to None - user must explicitly select a port
        } catch (error) {
          console.error('Error accessing MIDI devices:', error);
        }
      }
    };

    getMidiOutputs();
  }, [onOutputSelect]);

  return (
    <div className="grid grid-cols-[auto_1fr] items-center gap-x-3">
      <label htmlFor="midi-output" className="text-gray-300 font-medium w-24 text-right">MIDI Output</label>
      <select
        id="midi-output"
        onChange={(e) => onOutputSelect(e.target.value)}
        className="bg-gray-800 border border-gray-600 text-white text-sm rounded-lg focus:ring-yellow-500 focus:border-yellow-500 block w-full p-2.5"
      >
        <option value="">None (Disabled)</option>
        {outputs.map(output => (
          <option key={output.id} value={output.name}>{output.name}</option>
        ))}
      </select>
    </div>
  );
});

export default MidiOutputSelector;
