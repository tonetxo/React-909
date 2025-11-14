
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
            
            // Automatically select first available output after a brief delay to allow for initialization
            setTimeout(() => {
                this.autoSelectMidiOutput();
            }, 500);
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

    private autoSelectMidiOutput(): void {
        if (!this.midiAccess || this.midiOutput) return; // Don't override if already set

        const outputs = Array.from(this.midiAccess.outputs.values());

        // Look for specific virtual MIDI ports that are commonly used for sync
        // Prioritize ports that are more likely to be dedicated for sync purposes
        const syncPortNames = [
            'virmidi', 'virtualmidi', 'loopbe', 'virtual', 'iac', 'bus', 'thru'
        ];

        const preferredOutput = outputs.find(output => {
            const lowerName = output.name.toLowerCase();
            return syncPortNames.some(portName => lowerName.includes(portName)) &&
                   !lowerName.includes('through') &&
                   !lowerName.includes('midi through');
        });

        if (preferredOutput) {
            this.midiOutput = preferredOutput;
            console.log(`Auto-selected MIDI output: ${this.midiOutput.name}`);
            return;
        }

        // If no sync-specific port found, look for any virtual port that's not a "Midi Through" port
        const otherVirtualOutput = outputs.find(output =>
            (output.name.toLowerCase().includes('virtual') || output.name.toLowerCase().includes('virmidi')) &&
            !output.name.toLowerCase().includes('through')
        );

        if (otherVirtualOutput) {
            this.midiOutput = otherVirtualOutput;
            console.log(`Auto-selected MIDI output: ${this.midiOutput.name}`);
            return;
        }

        // As a last resort, select the first available output that's not a "Midi Through" port
        const nonThroughOutput = outputs.find(output =>
            !output.name.toLowerCase().includes('through')
        );

        if (nonThroughOutput) {
            this.midiOutput = nonThroughOutput;
            console.log(`Auto-selected MIDI output: ${this.midiOutput.name}`);
        } else if (outputs.length > 0) {
            // If all outputs are "through" ports, warn the user
            console.warn("Only 'Midi Through' ports available, which may cause feedback loops. Please check your MIDI routing configuration.");
            this.midiOutput = outputs[0];
            console.log(`Auto-selected MIDI output: ${this.midiOutput.name} (WARNING: may cause feedback)`);
        } else {
            console.warn("No MIDI output devices available to send clock messages to.");
        }
    }

    public setMidiOutput(outputName: string): void {
        if (!this.midiAccess) return;

        for (const output of this.midiAccess.outputs.values()) {
            if (output.name === outputName) {
                this.midiOutput = output;
                console.log(`MIDI output set to: ${this.midiOutput.name}`);
                return;
            }
        }

        console.warn(`MIDI output device "${outputName}" not found.`);
    }

    public sendStart(timestamp?: number): void {
        if (!this.midiOutput) {
            console.warn("No MIDI output available, cannot send MIDI Start message");
            return;
        }
        // Send start message immediately to ensure slave devices get the signal right away
        // Add small delay to ensure proper state transition
        setTimeout(() => {
            if (this.midiOutput) {
                this.midiOutput.send([0xFA]);
            }
        }, 1); // Very short delay to ensure proper state transition
    }

    public sendStop(): void {
        if (!this.midiOutput) {
            console.warn("No MIDI output available, cannot send MIDI Stop message");
            return;
        }
        // Send stop message to reset slave state
        try {
            if (this.midiOutput) {
                this.midiOutput.send([0xFC]);
            }
        } catch (e) {
            console.warn("Failed to send stop message:", e);
        }

        // Send additional clocks after stop to ensure slave devices process the stop command
        // This clears any pending clock messages in the buffer
        setTimeout(() => {
            if (this.midiOutput) {
                // Send one more stop to ensure state is cleared
                this.midiOutput.send([0xFC]);
            }
        }, 10);
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
            // Do not warn here to avoid flooding the console
            return;
        }
        try {
            // The timestamp from the AudioWorklet is in seconds (AudioContext time).
            // MIDIPort.send() expects a DOMHighResTimeStamp in milliseconds.
            // We pass the precise timestamp to schedule the message accurately.
            this.midiOutput.send([0xF8], timestamp * 1000);
        } catch (e) {
            // This can happen if the MIDI buffer is full. It's often safe to ignore
            // as the clock will quickly recover.
            // console.warn("Failed to send timing clock:", e);
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
}
