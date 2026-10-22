
export class MidiService {
    private midiAccess: WebMidi.MIDIAccess | null = null;
    private midiOutput: WebMidi.MIDIOutput | null = null;
    private outputListeners = new Set<(outputNames: string[]) => void>();

    constructor() {
        this.init();
    }

    private async init(): Promise<void> {
        if (!navigator.requestMIDIAccess) {
            console.warn("Web MIDI API is not supported in this browser.");
            return;
        }

        try {
            this.midiAccess = await navigator.requestMIDIAccess();
            console.log("MIDI Access granted.");
            this.listMidiOutputs();
            // Hot-plug: refresh the output list whenever a device appears or disappears
            this.midiAccess.onstatechange = () => this.notifyOutputs();
            this.notifyOutputs();

            // No auto-selection here. We rely on the UI (MidiOutputSelector) to set the port.
        } catch (error) {
            console.error("Failed to get MIDI access:", error);
        }
    }

    private listMidiOutputs(): void {
        if (!this.midiAccess) return;

        const outputs = this.midiAccess.outputs.values();
        if (this.midiAccess.outputs.size === 0) {
            console.log("No MIDI output devices found.");
            return;
        }

        console.log("Available MIDI output devices:");
        for (let output = outputs.next(); output && !output.done; output = outputs.next()) {
            const midiOutput = output.value;
            console.log(`  Name: ${midiOutput.name}, Manufacturer: ${midiOutput.manufacturer}, State: ${midiOutput.state}`);
        }
    }

    public setMidiOutput(outputName: string): void {
        if (!this.midiAccess) return;

        // If empty string or "None (Disabled)" is selected, disable MIDI output
        if (!outputName) {
            this.midiOutput = null;
            console.log("MIDI output disabled");
            return;
        }

        for (const output of this.midiAccess.outputs.values()) {
            if (output.name === outputName) {
                this.midiOutput = output;
                console.log(`MIDI output set to: ${this.midiOutput.name}`);
                return;
            }
        }

        console.warn(`MIDI output device "${outputName}" not found.`);
        // If device not found, set to null to ensure no output is sent
        this.midiOutput = null;
    }

    public sendStart(timestamp?: number): void {
        if (!this.midiOutput) {
            console.warn("No MIDI output available, cannot send MIDI Start message");
            return;
        }
        // Send start message
        try {
            if (timestamp) {
                this.midiOutput.send([0xFA], timestamp);
                console.log(`MIDI: Sent Start message (timestamp: ${timestamp.toFixed(2)}ms)`);
            } else {
                this.midiOutput.send([0xFA]);
                console.log(`MIDI: Sent Start message (immediate)`);
            }
        } catch (e) {
            console.warn("Failed to send start message:", e);
        }
    }

    public sendStop(timestamp?: number): void {
        if (!this.midiOutput) {
            console.warn("No MIDI output available, cannot send MIDI Stop message");
            return;
        }

        // Send stop message to reset slave state
        try {
            // Stop at the given time (performance.now() base), or immediately
            const stopTime = timestamp ?? performance.now();
            this.midiOutput.send([0xFC], stopTime);

            // Repeat the Stop a couple of times so the slave reliably processes it
            this.midiOutput.send([0xFC], stopTime + 5);
            this.midiOutput.send([0xFC], stopTime + 10);

        } catch (e) {
            console.warn("Failed to send stop message:", e);
        }
    }

    public sendTimingClock(timestamp: number): void {
        if (!this.midiOutput) {
            return;
        }
        try {
            // The timestamp should be a DOMHighResTimeStamp in milliseconds (performance.now() time base).
            this.midiOutput.send([0xF8], timestamp);
        } catch (e) {
            console.error('MIDI Clock send error:', e);
        }
    }


    public getAvailableOutputs(): string[] {
        if (!this.midiAccess) return [];
        // Filter out inputs that appear as outputs (common in Linux/ALSA for virtual ports)
        return Array.from(this.midiAccess.outputs.values())
            .filter(output => !output.name.toLowerCase().includes('input'))
            .map(output => output.name);
    }

    /** Calls `listener` now and whenever the available outputs change. Returns an unsubscribe function. */
    public subscribeOutputs(listener: (outputNames: string[]) => void): () => void {
        this.outputListeners.add(listener);
        listener(this.getAvailableOutputs());
        return () => { this.outputListeners.delete(listener); };
    }

    private notifyOutputs(): void {
        const outputNames = this.getAvailableOutputs();
        this.outputListeners.forEach(listener => listener(outputNames));
    }
}
