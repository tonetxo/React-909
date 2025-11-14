// services/MidiPortSelector.ts

export interface MidiPortInfo {
  id: string;
  name: string;
  manufacturer?: string;
  state: string;
  type: 'input' | 'output';
}

export class MidiPortSelector {
  private midiAccess: WebMidi.MIDIAccess | null = null;

  constructor() {
    this.init();
  }

  private async init(): Promise<void> {
    if (!navigator.requestMIDIAccess) {
      console.warn("Web MIDI API is not supported in this browser.");
      return;
    }

    try {
      this.midiAccess = await navigator.requestMIDIAccess({ sysex: true });
      console.log("MIDI Access granted.");
    } catch (error) {
      console.error("Failed to get MIDI access:", error);
    }
  }

  public async getAvailableOutputs(): Promise<MidiPortInfo[]> {
    if (!this.midiAccess) {
      await this.init();
    }

    if (!this.midiAccess) return [];
    
    const outputs: MidiPortInfo[] = [];

    for (const output of this.midiAccess.outputs.values()) {
      outputs.push({
        id: output.id,
        name: output.name || 'Unknown Output',
        manufacturer: output.manufacturer,
        state: output.state,
        type: 'output'
      });
    }

    return outputs;
  }
  
  public async getAvailableInputs(): Promise<MidiPortInfo[]> {
    if (!this.midiAccess) {
      await this.init();
    }

    if (!this.midiAccess) return [];
    
    const inputs: MidiPortInfo[] = [];

    for (const input of this.midiAccess.inputs.values()) {
      inputs.push({
        id: input.id,
        name: input.name || 'Unknown Input',
        manufacturer: input.manufacturer,
        state: input.state,
        type: 'input'
      });
    }

    return inputs;
  }
  
  public static isVirtualPort(portName: string): boolean {
    const virtualKeywords = [
      'virmidi', 'virtual', 'loopbe', 'iac', 'bus', 'thru',
      'virtualmidi', 'virtual port', 'loopback'
    ];
    
    const lowerName = portName.toLowerCase();
    return virtualKeywords.some(keyword => lowerName.includes(keyword));
  }
  
  public static isSyncPort(portName: string): boolean {
    return this.isVirtualPort(portName) && 
           !portName.toLowerCase().includes('through') &&
           !portName.toLowerCase().includes('thru');
  }
}