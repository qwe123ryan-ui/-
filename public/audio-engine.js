// NoteEngine - High-fidelity offline synthesis/audio engine
class NoteEngine {
  constructor() {
    this.ctx = new (window.AudioContext || window.webkitAudioContext)({
      sampleRate: 48000
    });
    this.voices = new Map();
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0.7;
    this.masterGain.connect(this.ctx.destination);
  }

  playNote(midiNote, velocity = 100, channel = 0) {
    const freq = 440 * Math.pow(2, (midiNote - 69) / 12);
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    
    osc.type = 'triangle';
    osc.frequency.value = freq;
    
    const now = this.ctx.currentTime;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(velocity / 127, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 2.0);
    
    osc.connect(gain);
    gain.connect(this.masterGain);
    
    osc.start(now);
    osc.stop(now + 2.0);
    
    return { osc, gain };
  }
}

// Export or expose to window
if (typeof window !== 'undefined') {
  window.NoteEngine = NoteEngine;
}
