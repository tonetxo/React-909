// types/midi.d.ts
declare global {
  interface Navigator {
    requestMIDIAccess(options?: MIDIOptions): Promise<WebMidi.MIDIAccess>;
  }

  namespace WebMidi {
    interface MIDIOptions {
      sysex: boolean;
      software: boolean;
    }

    interface MIDIAccess extends EventTarget {
      inputs: MIDIInputMap;
      outputs: MIDIOutputMap;
      onstatechange: ((this: MIDIAccess, ev: MIDIConnectionEvent) => any) | null;
    }

    interface MIDIInputMap {
      size: number;
      forEach: (callbackfn: (value: MIDIInput, key: string, map: MIDIInputMap) => void, thisArg?: any) => void;
      get: (key: string) => MIDIInput | undefined;
      values: () => IterableIterator<MIDIInput>;
      [Symbol.iterator](): IterableIterator<[string, MIDIInput]>;
    }

    interface MIDIOutputMap {
      size: number;
      forEach: (callbackfn: (value: MIDIOutput, key: string, map: MIDIOutputMap) => void, thisArg?: any) => void;
      get: (key: string) => MIDIOutput | undefined;
      values: () => IterableIterator<MIDIOutput>;
      [Symbol.iterator](): IterableIterator<[string, MIDIOutput]>;
    }

    interface MIDIOutput extends MIDIPort {
      send(data: number[], timestamp?: number): void;
      clear(): void;
    }

    interface MIDIInput extends MIDIPort {
      onmidimessage: ((this: MIDIInput, ev: MIDIMessageEvent) => any) | null;
    }

    interface MIDIPort extends EventTarget {
      id: string;
      manufacturer?: string;
      name?: string;
      type: string;
      version?: string;
      state: string;
      connection: string;
      onstatechange: ((this: MIDIPort, ev: MIDIConnectionEvent) => any) | null;
    }

    interface MIDIMessageEvent extends Event {
      data: Uint8Array;
      receivedTime: number;
    }

    interface MIDIConnectionEvent extends Event {
      port: MIDIPort;
      reason: string;
    }
  }
}

export {};