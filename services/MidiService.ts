
export class MidiService {
    private midiAccess: WebMidi.MIDIAccess | null = null;
    private midiOutput: WebMidi.MIDIOutput | null = null;
    private midiInputs: WebMidi.MIDIInput[] = []; // Track MIDI inputs to avoid feedback

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
            this.listMidiOutputs();

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
            } else {
                this.midiOutput.send([0xFA]);
            }
        } catch (e) {
            console.warn("Failed to send start message:", e);
        }
    }

    public sendStop(): void {
        if (!this.midiOutput) {
            console.warn("No MIDI output available, cannot send MIDI Stop message");
            return;
        }
        // Send stop message to reset slave state
        try {
            // Send immediate stop message
            this.midiOutput.send([0xFC]);

            // Send a few more clocks to ensure the slave properly processes the stop
            // This helps clear any pending clock messages in the buffer
            setTimeout(() => {
                if (this.midiOutput) this.midiOutput.send([0xFC]);
            }, 5);

            setTimeout(() => {
                if (this.midiOutput) this.midiOutput.send([0xFC]);
            }, 10);

        } catch (e) {
            console.warn("Failed to send stop message:", e);
        }
    }

    public sendContinue(): void {
        if (!this.midiOutput) {
            console.warn("No MIDI output available, cannot send MIDI Continue message");
            return;
        }
        this.midiOutput.send([0xFB]);
    }

    public sendTimingClock(timestamp: number): void {
        if (!this.midiOutput) {
            return;
        }
        try {
            // The timestamp should be a DOMHighResTimeStamp in milliseconds (performance.now() time base).
            this.midiOutput.send([0xF8], timestamp);
        } catch (e) {
            // Ignore buffer full errors
        }
    }

    public setTempo(tempo: number): void {
        // This method is now just a placeholder for potential future use,
        // as tempo is managed directly in AudioEngine for clock generation.
        console.log(`MIDI service tempo updated to ${tempo} BPM (for logging)`);
    }

    public getAvailableOutputs(): string[] {
        if (!this.midiAccess) return [];
        return Array.from(this.midiAccess.outputs.values()).map(output => output.name);
    }

    // Method to check for potential feedback routes
    public checkPotentialFeedback(): void {
        if (!this.midiAccess) return;

        console.log("Checking for potential MIDI feedback routes...");

        // Check if any output is connected to any input in a way that could cause feedback
        const outputs = Array.from(this.midiAccess.outputs.values());
        const inputs = Array.from(this.midiAccess.inputs.values());

        console.log(`Found ${outputs.length} output(s) and ${inputs.length} input(s)`);

        for (const output of outputs) {
            for (const input of inputs) {
                if (output.name === input.name) {
                    console.warn(`WARNING: Output and input with the same name detected: "${output.name}". This could cause feedback loops.`);
                }
            }
        }

        // Check for common feedback-prone configurations
        const feedbackProneOutputs = outputs.filter(output =>
            output.name.toLowerCase().includes('through') ||
            output.name.toLowerCase().includes('midi through')
        );

        if (feedbackProneOutputs.length > 0) {
            console.warn("WARNING: Found potentially feedback-prone outputs:", feedbackProneOutputs.map(o => o.name));
            console.log("Consider using dedicated virtual MIDI ports for synchronization to avoid feedback.");
        }
    }

    public getAllInputs(): WebMidi.MIDIInput[] {
        if (!this.midiAccess) return [];
        return Array.from(this.midiAccess.inputs.values());
    }

    public getAllOutputs(): WebMidi.MIDIOutput[] {
        if (!this.midiAccess) return [];
        return Array.from(this.midiAccess.outputs.values());
    }
}
