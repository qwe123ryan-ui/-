import { ChangeDetectionStrategy, Component, ElementRef, HostListener, OnDestroy, OnInit, PLATFORM_ID, ViewChild, inject, signal, effect } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';

interface KeyState {
  midi: number;
  name: string;
  label: string;
  pitchClass: number; // 0 to 11
  isBlack: boolean;
  keyboardKey: string;
  keyboardLabel: string;
  arabicLabel: string;
  leftOffsetPct?: number; // pre-computed styling offset for absolute black keys overlay
  colorLabel?: string;
}

interface RecordingSession {
  id: string;
  name: string;
  timestamp: string;
  notes: { time: number; type: 'ON' | 'OFF'; midi: number }[];
  bpm: number;
  scaleName: string;
  instrumentName: string;
}

interface InstrumentVoiceDef {
  name: string;
  arabicName: string;
  wave: OscillatorType;
  harmonics: number[];
  env: { a: number; d: number; s: number; r: number };
}

interface SoundPackInstrument {
  key: string;
  name: string;
  arabicName: string;
  wave: string;
  harmonics: number[];
  env: { a: number; d: number; s: number; r: number };
}

interface SoundPack {
  id: string;
  name: string;
  arabicName: string;
  description: string;
  arabicDescription: string;
  style: string;
  arabicStyle: string;
  price: string;
  tag: string;
  coverGradient: string;
  instruments: SoundPackInstrument[];
  status: 'available' | 'downloading' | 'downloaded';
  downloadProgress?: number;
}

export interface OrganPreset {
  id: string;
  name: string;
  arabicName: string;
  isCustom?: boolean;
  instrument: string;
  sustain: boolean;
  reverb: boolean;
  splitMode: boolean;
  dualMode: boolean;
  reverbWet: number;
  delayLevel: number;
  eqLow: number;
  eqMid: number;
  eqHigh: number;
  quarterTones: boolean[];
  activeScalePreset: string;
  activeRhythm?: string;
  masterTuning?: number;
  velocitySensitive?: boolean;
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-root',
  imports: [CommonModule, MatIconModule],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App implements OnInit, OnDestroy {
  // Expose Math object to template
  protected readonly Math = Math;
  @ViewChild('visualizerCanvas', { static: false }) visualizerCanvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('pitchSpectrumCanvas', { static: false }) pitchSpectrumCanvas!: ElementRef<HTMLCanvasElement>;

  private platformId = inject(PLATFORM_ID);
  private isBrowser: boolean = isPlatformBrowser(this.platformId);

  // Core Web Audio nodes
  audioContext: AudioContext | null = null;
  masterGain: GainNode | null = null;
  compressor: DynamicsCompressorNode | null = null;
  reverbNode: ConvolverNode | null = null;
  reverbDryNode: GainNode | null = null;
  reverbWetNode: GainNode | null = null;
  delayNode: DelayNode | null = null;
  delayFeedbackNode: GainNode | null = null;
  analyser: AnalyserNode | null = null;
  pitchAnalyser: AnalyserNode | null = null;
  mediaRecorder: MediaRecorder | null = null;
  recordedChunks: BlobPart[] = [];
  recorderDestination: MediaStreamAudioDestinationNode | null = null;
  
  // 3-Band EQ Nodes
  eqLowNode: BiquadFilterNode | null = null;
  eqMidNode: BiquadFilterNode | null = null;
  eqHighNode: BiquadFilterNode | null = null;

  // 12-Voice Yamaha Library Definitions
  voicesDef: Record<string, InstrumentVoiceDef> = {
    piano: { name: 'Grand Piano', arabicName: 'بيانو كلاسيك', wave: 'triangle', harmonics: [1.0, 0.5, 0.25, 0.1], env: { a: 0.01, d: 0.35, s: 0.5, r: 1.5 } },
    organ: { name: 'Jazz Organ', arabicName: 'أورغ جاز', wave: 'sawtooth', harmonics: [1.0, 0.8, 0.6, 0.4, 0.2], env: { a: 0.02, d: 0.1, s: 0.85, r: 0.5 } },
    strings: { name: 'Strings', arabicName: 'وتريات شرقية', wave: 'sine', harmonics: [1.0, 0.4, 0.2, 0.1], env: { a: 0.12, d: 0.3, s: 0.75, r: 2.05 } },
    oud: { name: 'Oud', arabicName: 'عود بلدي', wave: 'square', harmonics: [1.3, 0.7, 0.3, 0.12], env: { a: 0.005, d: 0.45, s: 0.3, r: 1.05 } },
    qanun: { name: 'Qanun', arabicName: 'قانون دوزان', wave: 'triangle', harmonics: [1.2, 0.65, 0.4, 0.2, 0.15], env: { a: 0.008, d: 0.5, s: 0.35, r: 1.8 } },
    nay: { name: 'Nay Flute', arabicName: 'ناي خشب', wave: 'sine', harmonics: [1.0, 0.3, 0.1, 0.05], env: { a: 0.08, d: 0.2, s: 0.8, r: 1.4 } },
    accordion: { name: 'Accordion', arabicName: 'أكورديون شرقي', wave: 'sawtooth', harmonics: [1.0, 0.95, 0.7, 0.5, 0.3], env: { a: 0.05, d: 0.2, s: 0.7, r: 0.8 } },
    sax: { name: 'Alto Sax', arabicName: 'ساكسفون', wave: 'square', harmonics: [1.0, 0.65, 0.35, 0.1], env: { a: 0.04, d: 0.25, s: 0.6, r: 1.15 } },
    guitar: { name: 'Nylon Guitar', arabicName: 'غيتار نايلون', wave: 'triangle', harmonics: [1.0, 0.45, 0.15], env: { a: 0.005, d: 0.65, s: 0.3, r: 0.6 } },
    violin: { name: 'Violin', arabicName: 'كمالجا', wave: 'sawtooth', harmonics: [1.0, 0.45, 0.2, 0.08], env: { a: 0.15, d: 0.3, s: 0.7, r: 1.9 } },
    ney: { name: 'Turkish Ney', arabicName: 'ناي تركي', wave: 'sine', harmonics: [1.0, 0.25, 0.1, 0.05], env: { a: 0.16, d: 0.15, s: 0.85, r: 2.3 } },
    buzuq: { name: 'Buzuq', arabicName: 'بزق جبلي', wave: 'square', harmonics: [1.0, 0.85, 0.45, 0.2], env: { a: 0.008, d: 0.55, s: 0.4, r: 0.95 } }
  };

  // 61-Key Layout spans C2 to C7 (midi 36 to 96)
  keys: KeyState[] = [];
  keyMap: Record<string, KeyState> = {};

  // Interactive UI Settings (Signals)
  enginePower = signal<boolean>(true); // start in powered state for instant loading
  activeTheme = signal<'steel' | 'wood'>('steel'); // Theme choice signal
  activeInstrument = signal<string>('piano'); // Default Grand Piano matching standard Yamaha boots
  activeSoundPackId = signal<string>('tarab_classic'); // Active sound pack
  activeRhythm = signal<string>('none'); // current rhythm
  masterVolume = signal<number>(0.7); // default 70% matching user layout
  tempoBpm = signal<number>(120); // default 120 tempo matching user display
  sustain = signal<boolean>(false); // sustain status
  velocitySensitive = signal<boolean>(false); // keypress velocity & duration mapping toggle
  reverb = signal<boolean>(false); // reverb status
  splitMode = signal<boolean>(false); // split keyboard mode
  dualMode = signal<boolean>(false); // dual voice layered mode
  
  // Custom MN-ORG 24 Layout signals
  activePage = signal<string>('dashboard'); // Active screen/page state
  pageHistory: string[] = []; // Page navigation history stack
  activeDNC = signal<number>(1); // Selected DNC Voice Model (1, 2, 3)
  balance = signal<number>(0.5); // Right/Left volume balance
  isMicActive = signal<boolean>(false); // Microphone/line input active flag
  isAftertouchActive = signal<boolean>(false); // Keyboard pressure sensitivity flag
  isMetronomeActive = signal<boolean>(false); // Metronome click state
  isLockActive = signal<boolean>(false); // Lock state for tempo/scale presets
  octaveShift = signal<number>(0); // Octave transposition (-2 to +2)
  transposeShift = signal<number>(0); // Pitch transposition (-12 to +12 semitones)
  isSplitMixActive = signal<boolean>(false); // Split keyboard sub-mixer active flag
  isChordMemoryActive = signal<boolean>(false); // Chord memory auto accompaniment active flag
  isAutoFillActive = signal<boolean>(true); // Auto-fill rhythm triggers flag
  isChordScanLowerActive = signal<boolean>(false); // Chord scan on lower key range
  isChordScanUpperActive = signal<boolean>(true); // Chord scan on upper key range
  isChordMuteActive = signal<boolean>(false); // Mute chord accompaniment channel
  isDrumMuteActive = signal<boolean>(false); // Mute rhythm drums channel
  isStyleToKbdActive = signal<boolean>(false); // Sync keyboard set with selected rhythm style
  selectedKbdSet = signal<number>(1); // Selected Keyboard Set preset slot (1, 2, 3, 4)
  isSynchroStartActive = signal<boolean>(false); // Synchro start rhythm on key press
  isSynchroStopActive = signal<boolean>(false); // Synchro stop rhythm on key release
  isFadeInOutActive = signal<boolean>(false); // Automatic fade in/out modifier active
  selectedChordType = signal<string>('major'); // Chord dictionary active type
  selectedChordRoot = signal<number>(60); // Chord dictionary root note (MIDI 60 = C4)
  
  // Touch/Spring responsive wheels
  pitchBend = signal<number>(0); // -1.0 to 1.0 (spring loaded)
  modulation = signal<boolean>(false); // vibrato LFO active

  // FX ranges
  reverbWet = signal<number>(0.35);
  delayLevel = signal<number>(0.3);
  delayFeedback = signal<number>(0.4);
  glideTime = signal<number>(0.05); // Glide time in seconds

  // Equalizer values (dB offsets)
  eqLow = signal<number>(0);
  eqMid = signal<number>(0);
  eqHigh = signal<number>(0);

  // Eastern Quarter-Tones Matrix Array (12 notes C to B flat)
  quarterTones = signal<boolean[]>([false, false, false, false, false, false, false, false, false, false, false, false]);  // "-50 cents" matrix
  activeScalePreset = signal<string>('custom'); // bayati | rast | sika | saba | huzam | chromatic | custom
  autoTuneActive = signal<boolean>(false); // dynamic auto-tune snapper
  private autoTuneActiveSnaps: Record<number, number> = {};

  // Keyboard live mapping
  activeNotesMap = signal<Record<number, boolean>>({});
  lastPressedNoteName = signal<string>('--');
  lastPressedFrequency = signal<string>('0 Hz');
  midiStatusMessage = signal<string>('MIDI Devices Scanning...');

  // MIDI External Devices Port Diagnostic List
  midiConnectedDevices = signal<{ id: string; name: string; manufacturer: string }[]>([]);
  midiSignalActive = signal<boolean>(false);
  midiTranspose = signal<number>(0);
  masterTuning = signal<number>(0); // -50 to +50 cents fine tuning
  noteOnTimeStamps: Record<number, number> = {};

  // Sound sequence tape recorder
  recordedSessions = signal<RecordingSession[]>([]);
  activeRecordedSessionId = signal<string | null>(null);
  isRecording = signal<boolean>(false);
  recordingStartTimestamp = 0;
  private recordingNotesTape: { time: number; type: 'ON' | 'OFF'; midi: number }[] = [];
  private playbackTimers: ReturnType<typeof setTimeout>[] = [];

  // Presets and Custom Organ registration states
  customPresets = signal<OrganPreset[]>([]);
  presetsList = signal<OrganPreset[]>([]);
  presetNameInput = signal<string>('');

  defaultPresets: OrganPreset[] = [
    {
      id: 'shaabi-sika',
      name: 'Shaabi Sika Organ',
      arabicName: 'أورج سيكاه شعبي حار',
      instrument: 'organ',
      sustain: true,
      reverb: true,
      splitMode: false,
      dualMode: false,
      reverbWet: 0.45,
      delayLevel: 0.35,
      eqLow: 2,
      eqMid: 5,
      eqHigh: -1,
      quarterTones: [false, false, false, false, true, false, false, false, false, false, false, true],
      activeScalePreset: 'sika',
      activeRhythm: 'oriental'
    },
    {
      id: 'classic-bayati',
      name: 'Classic Bayati Qanun',
      arabicName: 'قانون بياتي دوزان',
      instrument: 'qanun',
      sustain: true,
      reverb: true,
      splitMode: false,
      dualMode: false,
      reverbWet: 0.35,
      delayLevel: 0.2,
      eqLow: 0,
      eqMid: 3,
      eqHigh: 2,
      quarterTones: [false, false, false, false, true, false, false, false, false, false, false, false],
      activeScalePreset: 'bayati',
      activeRhythm: 'wahda'
    },
    {
      id: 'tarab-rast',
      name: 'Tarab Rast Oud',
      arabicName: 'عود طرب الراست',
      instrument: 'oud',
      sustain: false,
      reverb: true,
      splitMode: false,
      dualMode: false,
      reverbWet: 0.45,
      delayLevel: 0.4,
      eqLow: 3,
      eqMid: 2,
      eqHigh: 0,
      quarterTones: [false, false, false, false, true, false, false, false, false, false, false, true],
      activeScalePreset: 'rast',
      activeRhythm: 'baladi'
    },
    {
      id: 'sufi-nay',
      name: 'Sufi Ambient Nay',
      arabicName: 'ناي روحي صوفي',
      instrument: 'nay',
      sustain: true,
      reverb: true,
      splitMode: false,
      dualMode: true,
      reverbWet: 0.65,
      delayLevel: 0.55,
      eqLow: -2,
      eqMid: 3,
      eqHigh: 4,
      quarterTones: [false, false, false, false, true, false, false, false, false, false, false, false],
      activeScalePreset: 'bayati',
      activeRhythm: 'none'
    },
    {
      id: 'baladi-accordion',
      name: 'Solo Baladi Accordion',
      arabicName: 'صولو أكورديون بلدي',
      instrument: 'accordion',
      sustain: true,
      reverb: true,
      splitMode: true,
      dualMode: false,
      reverbWet: 0.35,
      delayLevel: 0.3,
      eqLow: 1,
      eqMid: 5,
      eqHigh: 1,
      quarterTones: [false, false, false, false, true, false, false, false, false, false, false, true],
      activeScalePreset: 'custom',
      activeRhythm: 'dabke'
    }
  ];

  // Drum machine custom step sequencer matrices
  activeSequencerStep = signal<number>(0);
  drumSequencerMatrix = signal<Record<string, boolean[]>>({
    kick: [true, false, false, false, false, false, false, false, true, false, false, false, false, false, false, false],
    snare: [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false],
    closedHat: [true, false, true, false, true, false, true, false, true, false, true, false, true, false, true, false],
    openHat: [false, false, false, false, false, false, false, true, false, false, false, false, false, false, false, true]
  });

  drumQuantize = signal<boolean>(true);
  drumSequencerOffsets = signal<Record<string, number[]>>({
    kick: Array(16).fill(0),
    snare: Array(16).fill(0),
    closedHat: Array(16).fill(0),
    openHat: Array(16).fill(0)
  });
  drumHistory = signal<{ matrix: Record<string, boolean[]>; offsets: Record<string, number[]> }[]>([]);

  drumSequencerPresets = {
    shaabi: {
      name: 'Shaabi Darbuka',
      arabicName: 'دربكة شعبي شرقي',
      matrix: {
        kick: [true, false, false, false, false, false, false, false, true, false, false, false, false, false, false, false],
        snare: [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false],
        closedHat: [true, false, true, false, true, false, true, false, true, false, true, false, true, false, true, false],
        openHat: [false, false, false, false, false, false, false, true, false, false, false, false, false, false, false, true]
      }
    },
    dabke: {
      name: 'Dabke Sequencer',
      arabicName: 'دبكة حماسية جبلية',
      matrix: {
        kick: [true, true, false, false, false, false, false, false, true, true, false, false, false, false, false, false],
        snare: [false, false, false, true, false, false, true, false, false, false, false, true, false, false, true, false],
        closedHat: [true, false, true, false, true, false, true, false, true, false, true, false, true, false, true, false],
        openHat: [false, false, false, false, false, false, false, true, false, false, false, false, false, false, false, true]
      }
    },
    house: {
      name: 'Modern House Beats',
      arabicName: 'دي جي تكنو غربي',
      matrix: {
        kick: [true, false, false, false, true, false, false, false, true, false, false, false, true, false, false, false],
        snare: [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false],
        closedHat: [false, false, true, false, false, false, true, false, false, false, true, false, false, false, true, false],
        openHat: [false, false, false, false, false, false, false, true, false, false, false, false, false, false, false, true]
      }
    },
    hiphop: {
      name: 'Hip Hop BoomBap',
      arabicName: 'هيب هوب إيقاع هادئ',
      matrix: {
        kick: [true, false, false, false, false, false, false, false, false, true, true, false, false, false, false, false],
        snare: [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false],
        closedHat: [true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true],
        openHat: [false, false, false, false, false, false, false, true, false, false, false, false, false, false, false, true]
      }
    },
    empty: {
      name: 'Empty Sequencer',
      arabicName: 'تصميم إيقاع فارغ',
      matrix: {
        kick: [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
        snare: [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
        closedHat: [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
        openHat: [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false]
      }
    }
  };

  // Step Sequencer enhancements
  sequencerPatternLength = signal<number>(16);
  selectedSequencerKit = signal<string>('808'); // '808' | 'arabic' | 'acoustic' | 'scifi'
  userSavedSequences = signal<{id: string, name: string, date: string, matrix: Record<string, boolean[]>, patternLength: number, bpm: number, kit: string}[]>([]);
  newSequenceName = signal<string>('');

  // Drum Pads states
  drumPadsList = signal<{id: number, name: string, soundKey: string, volume: number, pitch: number, customName?: string, activeFlag?: boolean}[]>([]);
  selectedDrumPad = signal<number | null>(0); // active drum pad to show edit controls
  keyboardPadPlayActive = signal<boolean>(false); // if true, computer keyboard triggers pads instead of note sounds
  padBuffers: Record<number, AudioBuffer> = {}; // decodes custom samples

  // Web Audio scheduled drum loops parameters
  beatIndicator = signal<boolean>(false); // tempo flashing indicator
  private nextDrumStepTime = 0;
  private currentDrumStep = 0;
  private drumSchedulerTimer: ReturnType<typeof setTimeout> | null = null;
  private lookaheadMs = 25.0;
  private scheduleAheadTimeSec = 0.1;

  // Arpeggiator System States
  arpActive = signal<boolean>(false);
  arpPattern = signal<'up' | 'down' | 'updown'>('up');
  arpSpeed = signal<number>(8);
  arpHeldNotes = signal<number[]>([]);
  arpActiveSoundingNote = signal<number | null>(null);

  private arpSchedulerTimer: ReturnType<typeof setTimeout> | null = null;
  private nextArpStepTime = 0;
  private currentArpIdx = 0;
  private arpScheduledVoices: { oscillators: OscillatorNode[]; gainNode: GainNode; stopTime: number; noiseSource?: AudioBufferSourceNode }[] = [];

  // Real-time Visualizer Animation
  private visualizerAnimationFrameId = 0;
  private pitchAnimationFrameId = 0;
  dominantPeaks = signal<{ frequency: number; note: string; amplitude: number }[]>([]);

  // Time-of-day LED display string
  currentTimeString = signal<string>('00:00:00');
  private clockIntervalTimer: ReturnType<typeof setInterval> | null = null;

  // Touch sliding glissando triggers
  isMouseDownOnKeys = false;

  // Synthesis voices lists
  polyActiveNodes: Record<number, {
    oscillators: OscillatorNode[];
    gainNode: GainNode;
    pressureGainNode?: GainNode;
    filterNode?: BiquadFilterNode;
    baseFilterFreq?: number;
    noiseSource?: AudioBufferSourceNode;
  }> = {};
  soloActiveNode: {
    oscillators: OscillatorNode[];
    gainNode: GainNode;
    pressureGainNode?: GainNode;
    filterNode?: BiquadFilterNode;
    baseFilterFreq?: number;
    noiseSource?: AudioBufferSourceNode;
    midi: number;
  } | null = null;

  // ORG Shaan Pro Layout signals
  zoomScale = signal<number>(1.0);
  activeViewTab = signal<'main' | 'slider' | 'effect' | 'liveStyle' | 'drum' | 'midi' | 'store'>('main');
  showEngineeringGrid = signal<boolean>(false);

  // Sound Pack Store state lists
  soundPacks = signal<SoundPack[]>([
    {
      id: "tarab_classic",
      name: "Classic Tarab Pack",
      arabicName: "مجموعة الطرب الأصيل",
      description: "Vintage Tarab instruments calibrated for classic Egyptian compositions.",
      arabicDescription: "أصوات وآلات طربية عريقة تم ضبط حرارتها ورنينها لملائمة تقسيمات الطرب الكلثومي والموشحات.",
      style: "Classical Tarab",
      arabicStyle: "طربي كلاسيكي",
      price: "Free",
      tag: "Tarab",
      coverGradient: "from-amber-900 via-[#8a6a28] to-stone-900",
      status: "available",
      instruments: [
        {
          key: "oud_gold",
          name: "Oud Gold Premium",
          arabicName: "العود الذهبي الراقي",
          wave: "square",
          harmonics: [1.3, 0.75, 0.45, 0.22, 0.1],
          env: { a: 0.003, d: 0.52, s: 0.22, r: 1.1 }
        },
        {
          key: "nay_breath",
          name: "Breathy Nay Solo",
          arabicName: "ناي حنون دافئ",
          wave: "sine",
          harmonics: [1.0, 0.45, 0.2, 0.1, 0.05],
          env: { a: 0.18, d: 0.25, s: 0.8, r: 2.15 }
        }
      ]
    },
    {
      id: "mahraganat_pro",
      name: "Electro Mahraganat Pro",
      arabicName: "مهرجانات شعبي بلاس",
      description: "Sharp digital sounds customized for modern street synthesizer leads.",
      arabicDescription: "أصوات حادة مكررة مخصصة لعزف السولوهات الشعبية ومهرجانات البير ميز جيل جديد صاخب.",
      style: "Electronic / Electro",
      arabicStyle: "شعبي إلكتروني جيل جديد",
      price: "Free Download",
      tag: "Electro",
      coverGradient: "from-violet-900 via-[#5d144a] to-stone-950",
      status: "available",
      instruments: [
        {
          key: "cyber_mezmar",
          name: "Cyber Mezmar Lead",
          arabicName: "مزمار إلكتروني صاخب",
          wave: "sawtooth",
          harmonics: [1.2, 1.1, 0.9, 0.72, 0.5, 0.3],
          env: { a: 0.01, d: 0.15, s: 0.9, r: 0.4 }
        },
        {
          key: "electro_rababa",
          name: "Electro Rababa Heavy",
          arabicName: "ربابة إلكترونية صاخبة",
          wave: "square",
          harmonics: [1.1, 0.85, 0.6, 0.42, 0.2],
          env: { a: 0.05, d: 0.3, s: 0.7, r: 0.95 }
        }
      ]
    },
    {
      id: "khaleeji_solo",
      name: "Khaleeji Roots Soloist",
      arabicName: "رصيد السولوهات الخليجية",
      description: "Light string instruments meticulously tuned for Gulf rhythms and solos.",
      arabicDescription: "آلات وتريات خفيفة بزق وسيتار خليجي تم معايرتها لمدارات التخت اليمني والصوت النجدي الشعبي.",
      style: "Folk Acoustic",
      arabicStyle: "فلكلور خليجي يمني",
      price: "Free",
      tag: "Gulf",
      coverGradient: "from-emerald-900 via-teal-900 to-stone-900",
      status: "available",
      instruments: [
        {
          key: "khaleeji_oud",
          name: "Khaleeji Oud Sweet",
          arabicName: "العود الخليجي الرنان",
          wave: "triangle",
          harmonics: [1.5, 0.75, 0.35, 0.12],
          env: { a: 0.002, d: 0.32, s: 0.25, r: 0.85 }
        },
        {
          key: "mirwas_lead",
          name: "Mirwas Synth Organ",
          arabicName: "سنت مرواس غنائي",
          wave: "sine",
          harmonics: [1.0, 0.9, 0.7, 0.55, 0.3],
          env: { a: 0.03, d: 0.22, s: 0.78, r: 1.15 }
        }
      ]
    },
    {
      id: "cosmic_ambient",
      name: "Cosmic Cinematic Pad",
      arabicName: "آفاق السكون الكوني",
      description: "Immersive atmospheric pads for ambient scoring and spiritual sessions.",
      arabicDescription: "وسائد نغمية عميقة ممتدة وسيتارات هوائية تسافر بالمستمع إلى فضاءات صوفية وعوالم روحانية هائمة.",
      style: "Cinematic / Drone",
      arabicStyle: "سينمائي تأملي وروحاني",
      price: "Free Beta",
      tag: "Ambient",
      coverGradient: "from-slate-900 via-sky-950 to-[#12121c]",
      status: "available",
      instruments: [
        {
          key: "space_sitar",
          name: "Space Sitar Ambient",
          arabicName: "السيتار الفضائي الروحي",
          wave: "sawtooth",
          harmonics: [1.0, 0.9, 0.8, 0.62, 0.4, 0.2],
          env: { a: 0.24, d: 0.5, s: 0.8, r: 2.8 }
        },
        {
          key: "dream_pad",
          name: "Ethereal Dream Pad",
          arabicName: "بادة الأحلام الهائمة",
          wave: "sine",
          harmonics: [1.0, 0.52, 0.32, 0.15, 0.05],
          env: { a: 0.45, d: 0.4, s: 0.85, r: 3.4 }
        }
      ]
    }
  ]);

  // MIDI Controller Configurations & Monitoring Logs
  midiEventsLog = signal<{ time: string; msg: string; type: 'on' | 'off' | 'cc' | 'pitch' }[]>([]);
  selectedMidiInputId = signal<string>('all');
  midiCCMappings = signal<{ cc: number; target: 'vibrato' | 'cutoff' | 'volume' | 'reverbWet' | 'delayLevel' | 'tempoBpm'; label: string; arabicLabel: string }[]>([
    { cc: 1, target: 'vibrato', label: 'Modulation (Vibrato)', arabicLabel: 'العجلة الترددية (الفيبراتو)' },
    { cc: 7, target: 'volume', label: 'Channel Volume', arabicLabel: 'حجم الصوت العام' },
    { cc: 10, target: 'reverbWet', label: 'Reverb Depth', arabicLabel: 'عمق صدى الصوت' },
    { cc: 11, target: 'cutoff', label: 'Filter Cutoff', arabicLabel: 'تردد الفلتر النغمتين' }
  ]);
  
  // Custom helper to quickly resolve active MIDI Mapping Target values
  midiTargetOptions = [
    { target: 'vibrato', label: 'Modulation (Vibrato) / فيبراتو', arabicLabel: 'العجلة الترددية (الفيبراتو)' },
    { target: 'cutoff', label: 'Filter Cutoff / فلاتر التردد', arabicLabel: 'فلتر تردد النغمات' },
    { target: 'volume', label: 'Channel Volume / ليفل الماستر', arabicLabel: 'حجم الصوت العام' },
    { target: 'reverbWet', label: 'Reverb Depth / الصدى الرطب', arabicLabel: 'عمق صدى الصوت' },
    { target: 'delayLevel', label: 'Delay Time % / التكرار التماثلي', arabicLabel: 'زمن تكرار التأخير' },
    { target: 'tempoBpm', label: 'Tempo BPM / سرعة المازورة', arabicLabel: 'سرعة المازورة ونبض الإيقاع' }
  ];

  cycleVolume() {
    let next = this.masterVolume() + 0.2;
    if (next > 1.05) {
      next = 0.2;
    }
    this.masterVolume.set(Math.min(1.0, next));
    if (this.masterGain && this.audioContext) {
      this.masterGain.gain.setValueAtTime(this.masterVolume(), this.audioContext.currentTime);
    }
  }

  constructor() {
    this.keys = this.generateKeyboardLayout();
    this.keys.forEach(k => {
      if (k.keyboardKey) {
        this.keyMap[k.keyboardKey.toLowerCase()] = k;
      }
    });

    // Handle initial reading of local sessions
    effect(() => {
      if (this.isBrowser) {
        const saved = localStorage.getItem('yamaha_mnorg_tape');
        if (saved) {
          try {
            this.recordedSessions.set(JSON.parse(saved) as RecordingSession[]);
          } catch {
            // Safe fallback
          }
        }
      }
    });
  }

  startPitchBend() {
    // Implement spring-back logic and audio update
    this.pitchBend.set(0.5); // Example
  }

  stopPitchBend() {
    this.pitchBend.set(0.0);
  }

  toggleModulation(val: boolean) {
    this.modulation.set(val);
  }

  calculateScale() {
    if (this.isBrowser) {
      const width = window.innerWidth;
      const scale = Math.min(1.0, (width - 32) / 1920);
      this.zoomScale.set(Math.max(0.35, scale));
    }
  }

  @HostListener('window:resize')
  onResize() {
    this.calculateScale();
  }

  ngOnInit() {
    if (this.isBrowser) {
      const savedTheme = localStorage.getItem('yamaha_theme');
      if (savedTheme === 'steel' || savedTheme === 'wood') {
        this.activeTheme.set(savedTheme);
      }
      this.initEngine();
      this.setupMidiBridge();
      this.startClockTicker();
      this.loadCustomPresets();
      this.loadUserSavedSequences();
      this.initDefaultDrumPads();
      this.calculateScale();
      this.loadSoundPacks();
    }
  }

  ngOnDestroy() {
    this.stopEngine();
    if (this.visualizerAnimationFrameId) {
      cancelAnimationFrame(this.visualizerAnimationFrameId);
    }
    if (this.pitchAnimationFrameId) {
      cancelAnimationFrame(this.pitchAnimationFrameId);
    }
    if (this.clockIntervalTimer) {
      clearInterval(this.clockIntervalTimer);
    }
  }

  // --- Custom MN-ORG 24 Layout Handlers ---
  selectPage(pageName: string) {
    const current = this.activePage();
    if (current !== pageName) {
      this.pageHistory.push(current);
      this.activePage.set(pageName);
    }
  }

  exitPage() {
    if (this.pageHistory.length > 0) {
      const prev = this.pageHistory.pop();
      this.activePage.set(prev || 'dashboard');
    } else {
      this.activePage.set('dashboard');
    }
  }

  selectKbdSetPreset(num: number) {
    this.selectedKbdSet.set(num);
    // Custom presets for Keyboard Sets (1, 2, 3, 4)
    if (num === 1) {
      this.selectInstrument('piano');
      this.reverb.set(true);
      this.eqHigh.set(2);
    } else if (num === 2) {
      this.selectInstrument('oud_gold');
      this.reverb.set(true);
      this.eqMid.set(3);
    } else if (num === 3) {
      this.selectInstrument('nay_breath');
      this.reverb.set(false);
      this.eqHigh.set(4);
    } else if (num === 4) {
      this.selectInstrument('accordion');
      this.reverb.set(true);
      this.eqLow.set(2);
    }
  }

  cycleBalance() {
    const b = this.balance();
    if (b === 0.5) {
      this.balance.set(1.0); // right
    } else if (b === 1.0) {
      this.balance.set(0.0); // left
    } else {
      this.balance.set(0.5); // center
    }
  }

  // Plays chord sounds dynamically in the chord dictionary
  playChordPreset(root: number, type: string) {
    if (!this.audioContext) {
      this.initEngine();
    }
    if (this.audioContext && this.audioContext.state === 'suspended') {
      this.audioContext.resume();
    }

    // Formulas representing semi-tone intervals
    let intervals: number[] = [0, 4, 7]; // Major
    if (type === 'minor') intervals = [0, 3, 7];
    else if (type === '7th') intervals = [0, 4, 7, 10];
    else if (type === 'dim') intervals = [0, 3, 6];
    else if (type === 'aug') intervals = [0, 4, 8];
    else if (type === 'sus4') intervals = [0, 5, 7];

    const midiNotes = intervals.map(v => root + v);

    // Play chord notes in unison with standard synthesizer harmonics voice
    midiNotes.forEach(noteMidi => {
      this.playNoteManual(noteMidi, 0.8);
      setTimeout(() => {
        this.stopNoteManual(noteMidi);
      }, 1000);
    });
  }

  getChordMidiNotes(root: number, type: string): number[] {
    let intervals: number[] = [0, 4, 7];
    if (type === 'minor') intervals = [0, 3, 7];
    else if (type === '7th') intervals = [0, 4, 7, 10];
    else if (type === 'dim') intervals = [0, 3, 6];
    else if (type === 'aug') intervals = [0, 4, 8];
    else if (type === 'sus4') intervals = [0, 5, 7];
    return intervals.map(v => root + v);
  }

  private metronomeTimer: ReturnType<typeof setTimeout> | null = null;
  toggleMetronomeClick() {
    this.isMetronomeActive.set(!this.isMetronomeActive());
    if (this.isMetronomeActive()) {
      const scheduleMetronome = () => {
        if (!this.isMetronomeActive()) return;
        
        // Sound a simple click sound using a short synthetic bleep
        if (this.audioContext && this.enginePower()) {
          const osc = this.audioContext.createOscillator();
          const gain = this.audioContext.createGain();
          osc.connect(gain);
          gain.connect(this.masterGain || this.audioContext.destination);
          
          osc.frequency.setValueAtTime(880, this.audioContext.currentTime); // 880Hz beep
          gain.gain.setValueAtTime(0.15, this.audioContext.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.001, this.audioContext.currentTime + 0.08);
          
          osc.start();
          osc.stop(this.audioContext.currentTime + 0.1);
        }
        
        const intervalMs = (60 / this.tempoBpm()) * 1000;
        this.metronomeTimer = setTimeout(scheduleMetronome, intervalMs);
      };
      scheduleMetronome();
    } else {
      if (this.metronomeTimer) {
        clearTimeout(this.metronomeTimer);
        this.metronomeTimer = null;
      }
    }
  }

  // Generate 61 standard piano keys mapping
  private generateKeyboardLayout(): KeyState[] {
    const arabicNames: Record<string, string> = { 
      'C': 'دو', 'C#': 'دو#', 'D': 'ري', 'D#': 'ري#', 'E': 'مي', 'F': 'فا', 
      'F#': 'فا#', 'G': 'صول', 'G#': 'صول#', 'A': 'لا', 'A#': 'لا#', 'B': 'سي' 
    };

    // Keyboard letter mappings for computer keyboard keys triggering notes
    const customKeyMap: Record<string, string> = {
      'F5': 'a', 'F#5': 'w', 'G5': 's', 'G#5': 'e', 'A5': 'd', 'A#5': 'r', 'B5': 'f',
      'C6': 'g', 'C#6': 'y', 'D6': 'h', 'D#6': 'u', 'E6': 'j',
      'F6': 'k', 'F#6': 'o', 'G6': 'l', 'G#6': 'p', 'A6': ';', 'A#6': '[', 'B6': '\''
    };

    const whiteKeysDef = [
      { name: 'F5', midi: 65, label: 'F5', color: 'green' },
      { name: 'G5', midi: 67, label: 'G5', color: 'green' },
      { name: 'A5', midi: 69, label: 'A5', color: 'green' },
      { name: 'B5', midi: 71, label: 'B5', color: 'green' },
      { name: 'C6', midi: 72, label: 'C6 (C)', color: 'red' },
      { name: 'D6', midi: 74, label: 'D6', color: 'red' },
      { name: 'E6', midi: 76, label: 'E6', color: 'red' },
      { name: 'F6', midi: 77, label: 'F6', color: 'red' },
      { name: 'G6', midi: 79, label: 'G6', color: 'red' },
      { name: 'A6', midi: 81, label: 'A6', color: 'red' },
      { name: 'B6', midi: 83, label: 'B6', color: 'red' },
      { name: 'C7', midi: 84, label: 'C7', color: 'red' },
      { name: 'D7', midi: 86, label: 'D7', color: 'red' },
      { name: 'E7', midi: 88, label: 'E7', color: 'red' },
      { name: 'F7', midi: 89, label: 'F7', color: 'red' },
      { name: 'G7', midi: 91, label: 'G7', color: 'red' }
    ];

    const blackKeysDef = [
      { name: 'F#5', midi: 66, label: 'F#5', left: 84 },
      { name: 'G#5', midi: 68, label: 'G#5', left: 204 },
      { name: 'A#5', midi: 70, label: 'A#5', left: 324 },
      { name: 'C#6', midi: 73, label: 'C#6', left: 564 },
      { name: 'D#6', midi: 75, label: 'D#6', left: 684 },
      { name: 'F#6', midi: 78, label: 'F#6', left: 924 },
      { name: 'G#6', midi: 80, label: 'G#6', left: 1044 },
      { name: 'A#6', midi: 82, label: 'A#6', left: 1164 },
      { name: 'C#7', midi: 85, label: 'C#7', left: 1404 },
      { name: 'D#7', midi: 87, label: 'D#7', left: 1524 },
      { name: 'F#7', midi: 90, label: 'F#7', left: 1764 },
      { name: 'G#7', midi: 92, label: 'G#7', left: 1884 }
    ];

    const keys: KeyState[] = [];

    // Add white keys (width 120px)
    whiteKeysDef.forEach((wk, index) => {
      const noteLetter = wk.name.slice(0, -1); // e.g. "F", "C"
      const kKey = customKeyMap[wk.name] || '';
      keys.push({
        midi: wk.midi,
        name: wk.name,
        label: wk.label,
        pitchClass: ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'].indexOf(noteLetter),
        isBlack: false,
        keyboardKey: kKey,
        keyboardLabel: kKey.toUpperCase(),
        arabicLabel: `${arabicNames[noteLetter] || noteLetter} ${wk.name.slice(-1)}`,
        leftOffsetPct: index * 120, // raw pixel position for layout
        colorLabel: wk.color
      });
    });

    // Add black keys (width 72px)
    blackKeysDef.forEach((bk) => {
      const noteLetter = bk.name.slice(0, -1); // e.g. "F#"
      const kKey = customKeyMap[bk.name] || '';
      keys.push({
        midi: bk.midi,
        name: bk.name,
        label: bk.label,
        pitchClass: ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'].indexOf(noteLetter),
        isBlack: true,
        keyboardKey: kKey,
        keyboardLabel: kKey.toUpperCase(),
        arabicLabel: `${arabicNames[noteLetter] || noteLetter} ${bk.name.slice(-1)}`,
        leftOffsetPct: bk.left // raw pixel position for layout
      });
    });

    // Sort keys by midi value
    keys.sort((a, b) => a.midi - b.midi);
    return keys;
  }

  // Setup Clock Indicator
  private startClockTicker() {
    const updateTime = () => {
      const d = new Date();
      const currentStr = d.toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
      this.currentTimeString.set(currentStr);
    };
    updateTime();
    this.clockIntervalTimer = setInterval(updateTime, 1000);
  }

  // Boot standard synthesis engine
  initEngine() {
    if (!this.isBrowser) return;

    try {
      const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.audioContext = new AudioContextClass();
      
      this.masterGain = this.audioContext.createGain();
      this.masterGain.gain.setValueAtTime(this.masterVolume(), this.audioContext.currentTime);

      // Dynamics Compressor prevents clipping
      this.compressor = this.audioContext.createDynamicsCompressor();
      this.compressor.threshold.setValueAtTime(-14, this.audioContext.currentTime);
      this.compressor.ratio.setValueAtTime(8, this.audioContext.currentTime);
      this.compressor.attack.setValueAtTime(0.003, this.audioContext.currentTime);
      this.compressor.release.setValueAtTime(0.15, this.audioContext.currentTime);

      // Reverb Nodes Layout
      this.reverbNode = this.audioContext.createConvolver();
      this.reverbNode.buffer = this.createReverbBufferChannel();
      
      this.reverbDryNode = this.audioContext.createGain();
      this.reverbWetNode = this.audioContext.createGain();
      
      const wetGainVal = this.reverb() ? this.reverbWet() : 0.0;
      this.reverbDryNode.gain.setValueAtTime(Math.cos(wetGainVal * 0.5 * Math.PI), this.audioContext.currentTime);
      this.reverbWetNode.gain.setValueAtTime(Math.sin(wetGainVal * 0.5 * Math.PI) * 1.2, this.audioContext.currentTime);

      // FeedBack Delay nodes
      this.delayNode = this.audioContext.createDelay(2.0);
      this.delayNode.delayTime.setValueAtTime(this.delayLevel() * 1.5, this.audioContext.currentTime);
      this.delayFeedbackNode = this.audioContext.createGain();
      this.delayFeedbackNode.gain.setValueAtTime(this.delayFeedback(), this.audioContext.currentTime);

      this.delayNode.connect(this.delayFeedbackNode);
      this.delayFeedbackNode.connect(this.delayNode);

      // 3-Band Parametric EQ Filters
      this.eqLowNode = this.audioContext.createBiquadFilter();
      this.eqLowNode.type = 'lowshelf';
      this.eqLowNode.frequency.setValueAtTime(220, this.audioContext.currentTime);
      this.eqLowNode.gain.setValueAtTime(this.eqLow(), this.audioContext.currentTime);

      this.eqMidNode = this.audioContext.createBiquadFilter();
      this.eqMidNode.type = 'peaking';
      this.eqMidNode.frequency.setValueAtTime(1500, this.audioContext.currentTime);
      this.eqMidNode.Q.setValueAtTime(1.0, this.audioContext.currentTime);
      this.eqMidNode.gain.setValueAtTime(this.eqMid(), this.audioContext.currentTime);

      this.eqHighNode = this.audioContext.createBiquadFilter();
      this.eqHighNode.type = 'highshelf';
      this.eqHighNode.frequency.setValueAtTime(6000, this.audioContext.currentTime);
      this.eqHighNode.gain.setValueAtTime(this.eqHigh(), this.audioContext.currentTime);

      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 256;

      this.pitchAnalyser = this.audioContext.createAnalyser();
      this.pitchAnalyser.fftSize = 2048;
      this.analyser.connect(this.pitchAnalyser);

      // Series chain links: masterGain -> eqLow -> eqMid -> eqHigh
      this.masterGain.connect(this.eqLowNode);
      this.eqLowNode.connect(this.eqMidNode);
      this.eqMidNode.connect(this.eqHighNode);

      // Split filter routing
      this.eqHighNode.connect(this.reverbDryNode);
      this.reverbDryNode.connect(this.analyser);

      this.eqHighNode.connect(this.reverbNode);
      this.reverbNode.connect(this.reverbWetNode);
      this.reverbWetNode.connect(this.analyser);

      this.eqHighNode.connect(this.delayNode);
      this.delayNode.connect(this.analyser);

      this.analyser.connect(this.compressor);
      this.compressor.connect(this.audioContext.destination);

      if ('createMediaStreamDestination' in this.audioContext) {
        this.recorderDestination = this.audioContext.createMediaStreamDestination();
        this.compressor.connect(this.recorderDestination);
      }

      this.enginePower.set(true);
      setTimeout(() => {
        this.drawVisualizerSpectrum();
        this.drawPitchSpectrum();
      }, 100);
      
      this.applyScalePreset('bayati'); // Default Arabic scaling
    } catch (e) {
      console.error('Audiocore setup failed', e);
      this.midiStatusMessage.set('AudioContext Error');
    }
  }

  stopEngine() {
    this.arpActive.set(false);
    this.stopArpLoop();
    this.arpHeldNotes.set([]);

    this.stopAllVoicesOscillators();
    this.stopRhythmLoop();
    this.stopPlaybackSequence();

    if (this.audioContext) {
      try {
        this.audioContext.close();
      } catch {
        // Safe closure
      }
      this.audioContext = null;
    }
    this.eqLowNode = null;
    this.eqMidNode = null;
    this.eqHighNode = null;
    this.analyser = null;
    this.pitchAnalyser = null;
    
    this.enginePower.set(false);
    this.activeNotesMap.set({});
    this.autoTuneActiveSnaps = {};
  }

  togglePower() {
    if (this.enginePower()) {
      this.stopEngine();
    } else {
      this.initEngine();
    }
  }

  toggleTheme() {
    const nextTheme = this.activeTheme() === 'steel' ? 'wood' : 'steel';
    this.activeTheme.set(nextTheme);
    if (this.isBrowser) {
      localStorage.setItem('yamaha_theme', nextTheme);
    }
  }

  toggleAutoTune() {
    this.autoTuneActive.set(!this.autoTuneActive());
    this.autoTuneActiveSnaps = {};
    this.midiStatusMessage.set(this.autoTuneActive() ? 'تم تفعيل المصحح النغمي (Auto-Tune)' : 'تم إيقاف المصحح النغمي');
  }

  snapToScale(midi: number): number {
    const currentScale = this.activeScalePreset();
    let allowed: number[];
    
    if (currentScale === 'bayati') {
      allowed = [0, 2, 4, 5, 7, 9, 10]; // Bayati on D scale (C, D, E_quarter, F, G, A, Bb)
    } else if (currentScale === 'rast') {
      allowed = [0, 2, 4, 5, 7, 9, 11]; // Rast on C scale (C, D, E_quarter, F, G, A, B_quarter)
    } else if (currentScale === 'sika') {
      allowed = [0, 2, 4, 5, 7, 9, 11]; // Sika scale
    } else if (currentScale === 'saba') {
      allowed = [0, 1, 2, 4, 5, 6, 9, 10]; // Saba on D scale
    } else if (currentScale === 'huzam') {
      allowed = [0, 2, 4, 5, 7, 8, 11]; // Huzam scale
    } else {
      return midi; // Chromatic/Custom
    }
    
    const originalPitchClass = midi % 12;
    const octave = Math.floor(midi / 12);
    
    let bestPitchClass = allowed[0];
    let minDiff = 999;
    
    for (const p of allowed) {
      const diff = Math.abs(originalPitchClass - p);
      const wrapDiff = 12 - diff;
      const finalDiff = Math.min(diff, wrapDiff);
      
      if (finalDiff < minDiff) {
        minDiff = finalDiff;
        bestPitchClass = p;
      }
    }
    
    const snappedMidi = octave * 12 + bestPitchClass;
    const candidates = [snappedMidi, snappedMidi - 12, snappedMidi + 12];
    let closest = snappedMidi;
    let leastDiff = 999;
    
    for (const cand of candidates) {
      const diff = Math.abs(cand - midi);
      if (diff < leastDiff) {
        leastDiff = diff;
        closest = cand;
      }
    }
    
    return closest;
  }

  // Create an artificial room decay impulse channel
  private createReverbBufferChannel(): AudioBuffer {
    const sampleRate = this.audioContext ? this.audioContext.sampleRate : 44100;
    const size = sampleRate * 2.0;
    const buffer = this.audioContext ? this.audioContext.createBuffer(2, size, sampleRate) : {} as AudioBuffer;
    
    if (buffer.getChannelData) {
      const left = buffer.getChannelData(0);
      const right = buffer.getChannelData(1);
      
      for (let i = 0; i < size; i++) {
        const decay = Math.exp(-4.0 * (i / size));
        left[i] = (Math.random() * 2 - 1) * decay;
        right[i] = (Math.random() * 2 - 1) * decay;
      }
    }
    return buffer;
  }

  private createReverbBufferChannelForOffline(offlineCtx: OfflineAudioContext): AudioBuffer {
    const sampleRate = offlineCtx.sampleRate;
    const size = sampleRate * 2.0;
    const buffer = offlineCtx.createBuffer(2, size, sampleRate);
    const left = buffer.getChannelData(0);
    const right = buffer.getChannelData(1);
    
    for (let i = 0; i < size; i++) {
      const decay = Math.exp(-4.0 * (i / size));
      left[i] = (Math.random() * 2 - 1) * decay;
      right[i] = (Math.random() * 2 - 1) * decay;
    }
    return buffer;
  }

  private scheduleOfflineVoice(
    offlineCtx: OfflineAudioContext,
    midi: number,
    startTime: number,
    duration: number,
    voice: InstrumentVoiceDef,
    masterGainNode: GainNode,
    velPercent: number
  ) {
    const frequency = this.getAdjustedFrequency(midi);
    const waveType = voice.wave;
    const harmonics = voice.harmonics;
    const env = voice.env;

    const oscs: OscillatorNode[] = [];
    const envelopeGain = offlineCtx.createGain();
    
    harmonics.forEach((amp, idx) => {
      const osc = offlineCtx.createOscillator();
      osc.type = waveType;
      
      const overtoneFreq = frequency * (idx + 1);
      osc.frequency.setValueAtTime(overtoneFreq, startTime);

      if (this.modulation()) {
        const vibratoSpeed = 6.4;
        const targetVibratoDepth = overtoneFreq * 0.015;
        const lfoOsc = offlineCtx.createOscillator();
        const lfoGainNode = offlineCtx.createGain();
        lfoOsc.frequency.setValueAtTime(vibratoSpeed, startTime);
        lfoGainNode.gain.setValueAtTime(targetVibratoDepth, startTime);
        
        lfoOsc.connect(lfoGainNode);
        lfoGainNode.connect(osc.frequency);
        lfoOsc.start(startTime);
        lfoOsc.stop(startTime + duration + env.r + 0.1);
        oscs.push(lfoOsc);
      }

      const harmGain = offlineCtx.createGain();
      const baseScale = (this.splitMode() || this.dualMode()) ? 0.35 : 0.45;
      const finalVolumeGain = amp * baseScale * velPercent;
      
      harmGain.gain.setValueAtTime(finalVolumeGain, startTime);

      osc.connect(harmGain);
      harmGain.connect(envelopeGain);
      osc.start(startTime);
      osc.stop(startTime + duration + env.r + 0.1);
      oscs.push(osc);
    });

    const instName = this.activeInstrument();
    if ((instName === 'oud' || instName === 'qanun' || instName === 'guitar' || instName === 'buzuq') && midi < 1000) {
      const sizeRatio = offlineCtx.sampleRate * 0.007;
      const noiseBuffer = offlineCtx.createBuffer(1, sizeRatio, offlineCtx.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < sizeRatio; i++) {
        data[i] = (Math.random() * 2.0 - 1.0) * 0.55;
      }
      const transientNoiseSource = offlineCtx.createBufferSource();
      transientNoiseSource.buffer = noiseBuffer;
      const noiseGainNode = offlineCtx.createGain();
      noiseGainNode.gain.setValueAtTime(0.3 * velPercent, startTime);

      transientNoiseSource.connect(noiseGainNode);
      noiseGainNode.connect(envelopeGain);
      transientNoiseSource.start(startTime);
      transientNoiseSource.stop(startTime + 0.05);
    }

    envelopeGain.connect(masterGainNode);

    envelopeGain.gain.setValueAtTime(0.0001, startTime);
    envelopeGain.gain.linearRampToValueAtTime(1.0, startTime + env.a);
    envelopeGain.gain.linearRampToValueAtTime(env.s, startTime + env.a + env.d);

    const releaseStartTime = startTime + duration;
    let releaseTime = env.r;
    
    if (this.velocitySensitive() && duration < 0.180) {
      const factor = Math.max(0.18, duration / 0.180);
      releaseTime = releaseTime * factor;
    }

    envelopeGain.gain.cancelScheduledValues(releaseStartTime);
    envelopeGain.gain.setValueAtTime(env.s, releaseStartTime);
    envelopeGain.gain.exponentialRampToValueAtTime(0.0001, releaseStartTime + releaseTime);
  }

  private scheduleOfflineNote(
    offlineCtx: OfflineAudioContext,
    midi: number,
    startTime: number,
    duration: number,
    sessionInstrumentName: string,
    masterGainNode: GainNode,
    velPercent: number
  ) {
    if (this.splitMode() && midi < 60) {
      const stringsVoice = this.voicesDef['strings'];
      if (stringsVoice) {
        this.scheduleOfflineVoice(offlineCtx, midi, startTime, duration, stringsVoice, masterGainNode, velPercent * 0.45);
      }
      return;
    }

    const voice = this.voicesDef[sessionInstrumentName] || this.voicesDef[this.activeInstrument()] || this.voicesDef['piano'];
    this.scheduleOfflineVoice(offlineCtx, midi, startTime, duration, voice, masterGainNode, velPercent * 0.7);

    if (this.dualMode()) {
      const stringsLayer = this.voicesDef['strings'];
      if (stringsLayer) {
        const subMidi = midi - 12;
        this.scheduleOfflineVoice(offlineCtx, subMidi, startTime, duration, stringsLayer, masterGainNode, velPercent * 0.3);
      }
    }
  }

  private bufferToWav(buffer: AudioBuffer): Blob {
    const numOfChan = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const format = 1; // 1 = raw PCM (16-bit)
    const bitDepth = 16;
    
    let result;
    if (numOfChan === 2) {
      result = this.interleave(buffer.getChannelData(0), buffer.getChannelData(1));
    } else {
      result = buffer.getChannelData(0);
    }
    
    const bufferLen = result.length * 2;
    const arrayBuffer = new ArrayBuffer(44 + bufferLen);
    const view = new DataView(arrayBuffer);
    
    this.writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + bufferLen, true);
    this.writeString(view, 8, 'WAVE');
    this.writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, format, true);
    view.setUint16(22, numOfChan, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numOfChan * (bitDepth / 8), true);
    view.setUint16(32, numOfChan * (bitDepth / 8), true);
    view.setUint16(34, bitDepth, true);
    this.writeString(view, 36, 'data');
    view.setUint32(40, bufferLen, true);
    
    this.floatTo16BitPCM(view, 44, result);
    
    return new Blob([view], { type: 'audio/wav' });
  }

  private interleave(inputL: Float32Array, inputR: Float32Array): Float32Array {
    const length = inputL.length + inputR.length;
    const result = new Float32Array(length);
    let index = 0;
    let inputIndex = 0;
    
    while (index < length) {
      result[index++] = inputL[inputIndex];
      result[index++] = inputR[inputIndex];
      inputIndex++;
    }
    return result;
  }

  private floatTo16BitPCM(output: DataView, offset: number, input: Float32Array) {
    for (let i = 0; i < input.length; i++, offset += 2) {
      const s = Math.max(-1, Math.min(1, input[i]));
      output.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    }
  }

  private writeString(view: DataView, offset: number, string: string) {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  }

  // Pitch bend sliders
  onPitchBendSliderChange(event: Event) {
    const target = event.target as HTMLInputElement;
    const val = parseFloat(target.value);
    this.pitchBend.set(val);
    this.applyPitchBendToAllPlaying();
  }

  resetPitchBendWheel() {
    this.pitchBend.set(0.0);
    this.applyPitchBendToAllPlaying();
  }

  setVolumeUp() {
    const next = Math.min(1.0, this.masterVolume() + 0.05);
    this.masterVolume.set(next);
    if (this.masterGain && this.audioContext) {
      this.masterGain.gain.setValueAtTime(next, this.audioContext.currentTime);
    }
  }

  setVolumeDown() {
    const next = Math.max(0.0, this.masterVolume() - 0.05);
    this.masterVolume.set(next);
    if (this.masterGain && this.audioContext) {
      this.masterGain.gain.setValueAtTime(next, this.audioContext.currentTime);
    }
  }

  setTempoUp() {
    const next = Math.min(300, this.tempoBpm() + 5);
    this.tempoBpm.set(next);
  }

  setTempoDown() {
    const next = Math.max(30, this.tempoBpm() - 5);
    this.tempoBpm.set(next);
  }

  toggleSustain() {
    const current = this.sustain();
    this.sustain.set(!current);
    if (!current) {
      this.stopAllVoicesOscillators();
    }
  }

  toggleReverb() {
    const current = this.reverb();
    this.reverb.set(!current);
    if (this.audioContext && this.reverbWetNode && this.reverbDryNode) {
      const now = this.audioContext.currentTime;
      const wetVal = !current ? this.reverbWet() : 0.0;
      const dryCos = Math.cos(wetVal * 0.5 * Math.PI);
      const wetSin = Math.sin(wetVal * 0.5 * Math.PI);
      this.reverbDryNode.gain.setValueAtTime(dryCos, now);
      this.reverbWetNode.gain.setValueAtTime(wetSin * 1.2, now);
    }
  }

  onReverbWetChange(event: Event) {
    const target = event.target as HTMLInputElement;
    const val = parseFloat(target.value);
    this.reverbWet.set(val);
    if (this.audioContext && this.reverbWetNode && this.reverbDryNode) {
      const now = this.audioContext.currentTime;
      const dryCos = Math.cos(val * 0.5 * Math.PI);
      const wetSin = Math.sin(val * 0.5 * Math.PI);
      this.reverbDryNode.gain.setValueAtTime(dryCos, now);
      this.reverbWetNode.gain.setValueAtTime(wetSin * 1.2, now);
    }
  }

  toggleSplitMode() {
    const current = this.splitMode();
    this.splitMode.set(!current);
    this.stopAllVoicesOscillators();
  }

  toggleDualMode() {
    const current = this.dualMode();
    this.dualMode.set(!current);
    this.stopAllVoicesOscillators();
  }

  toggleQuarterToneNote(pitchIdx: number) {
    const current = [...this.quarterTones()];
    current[pitchIdx] = !current[pitchIdx];
    this.quarterTones.set(current);
    this.activeScalePreset.set('custom');
    this.applyPitchBendToAllPlaying();
  }

  applyScalePreset(preset: string) {
    this.activeScalePreset.set(preset);
    const scaleArray = [false, false, false, false, false, false, false, false, false, false, false, false];

    switch (preset) {
      case 'bayati':
        // Bayati: E (4) and B (11) flattened (-50 cents)
        scaleArray[4] = true;
        scaleArray[11] = true;
        break;
      case 'rast':
        // Rast: E (4) and B (11) flattened (-50 cents)
        scaleArray[4] = true;
        scaleArray[11] = true;
        break;
      case 'sika':
        // Sika: E(4), A(9), and B(11) flattened
        scaleArray[4] = true;
        scaleArray[9] = true;
        scaleArray[11] = true;
        break;
      case 'saba':
        // Saba: E(4), B(11) flattened and G-flat or D-sharp flattened
        scaleArray[4] = true;
        scaleArray[11] = true;
        scaleArray[3] = true;
        break;
      case 'huzam':
        // Huzam: E(4), B(11) and G#(8) or A(9) flattened
        scaleArray[4] = true;
        scaleArray[11] = true;
        scaleArray[8] = true;
        break;
      case 'chromatic':
        // All values false (equal temperament)
        break;
    }
    this.quarterTones.set(scaleArray);
    this.applyPitchBendToAllPlaying();
  }

  getArabicPresetName(id: string): string {
    switch (id) {
      case 'bayati': return 'بياتي شرقي';
      case 'rast': return 'راست عتيق';
      case 'sika': return 'سيكاه أصيل';
      case 'saba': return 'صبا حزين';
      case 'huzam': return 'هزام دوزان';
      case 'chromatic': return 'غربي طبيعي';
      default: return 'مقام يدوي';
    }
  }

  // Pitch Calculations with Eastern micro-flats and fine master tuning
  getAdjustedFrequency(midi: number): number {
    const pitchClass = midi % 12;
    let baseFreq = 440 * Math.pow(2, (midi - 69) / 12);
    
    // Apply Master Tuning in cents (-50 to +50 cents)
    const tuneCents = this.masterTuning();
    if (tuneCents !== 0) {
      baseFreq *= Math.pow(2, tuneCents / 1200);
    }
    
    // Flatten 50 cents (-50 cents translation: 2^(-50/1200))
    if (this.quarterTones()[pitchClass]) {
      return baseFreq * Math.pow(2, -50 / 1200);
    }
    return baseFreq;
  }

  // Apply real-time bend
  private applyPitchBendToAllPlaying() {
    if (!this.audioContext) return;
    const bendAmt = this.pitchBend(); // -1.0 to 1.0
    const bendRatio = Math.pow(2, (bendAmt * 2.0) / 12); // maximum bend standard +/- 2 semitones

    if (this.soloActiveNode) {
      const targetFreq = this.getAdjustedFrequency(this.soloActiveNode.midi);
      this.soloActiveNode.oscillators.forEach((osc, idx) => {
        try {
          osc.frequency.setValueAtTime(targetFreq * (idx + 1) * bendRatio, this.audioContext!.currentTime);
        } catch {
          // Safe bend transition
        }
      });
    }

    Object.keys(this.polyActiveNodes).forEach((midiStr) => {
      const midiNum = parseInt(midiStr, 10);
      const groupObj = this.polyActiveNodes[midiNum];
      const targetFreq = this.getAdjustedFrequency(midiNum);
      
      groupObj.oscillators.forEach((osc, idx) => {
        try {
          osc.frequency.setValueAtTime(targetFreq * (idx + 1) * bendRatio, this.audioContext!.currentTime);
        } catch {
          // Safe bend transition
        }
      });
    });
  }

  pitchBendOn() {
    this.pitchBend.set(1.0); // full bend up (+2 semitones)
    this.applyPitchBendToAllPlaying();
  }

  pitchBendOff() {
    this.pitchBend.set(0.0);
    this.applyPitchBendToAllPlaying();
  }

  modOn() {
    this.modulation.set(true);
  }

  modOff() {
    this.modulation.set(false);
  }

  // Physical USB/Bluetooth MIDI accessories controller Setup
  setupMidiBridge() {
    if (typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator) {
      const nav = navigator as unknown as {
        requestMIDIAccess: (opts?: { sysex?: boolean }) => Promise<{
          inputs: { forEach: (cb: (port: unknown) => void) => void };
          onstatechange: ((v: unknown) => void) | null;
        }>;
      };

      nav.requestMIDIAccess({ sysex: false }).then((access) => {
        this.midiStatusMessage.set('MIDI جهاز جاهز');
        this.scanMidiPorts(access);

        access.onstatechange = () => {
          this.scanMidiPorts(access);
        };
      }).catch(() => {
        this.midiStatusMessage.set('MIDI غير مدعوم');
      });
    } else {
      this.midiStatusMessage.set('لا يدعم المتصفح MIDI');
    }
  }

  scanMidiPorts(access: { inputs: { forEach: (cb: (port: unknown) => void) => void } }) {
    const devices: { id: string; name: string; manufacturer: string }[] = [];
    access.inputs.forEach((port: unknown) => {
      const p = port as { id: string; name?: string; manufacturer?: string; onmidimessage: ((e: { data: Uint8Array }) => void) | null };
      devices.push({
        id: p.id,
        name: p.name || 'External Keyboard',
        manufacturer: p.manufacturer || 'Yamaha'
      });
      p.onmidimessage = (e) => this.handleExternalMidiEvent(e, p.id);
    });
    this.midiConnectedDevices.set(devices);
    if (devices.length > 0) {
      this.midiStatusMessage.set(`متصل بـ: ${devices[0].name}`);
    } else {
      this.midiStatusMessage.set('لا توجد أجهزة متصلة باليو إس بي');
    }
  }

  getMidiNoteNameArabic(midiNum: number): string {
    const notesList = ['دو Do', 'دو# Do#', 'ري Re', 'ري# Re#', 'مي Mi', 'فا Fa', 'فا# Fa#', 'صول Sol', 'صول# Sol#', 'لا La', 'لا# La#', 'سي Si'];
    const note = notesList[midiNum % 12];
    const octave = Math.floor(midiNum / 12) - 1;
    return `${note} (الأوكتاف ${octave})`;
  }

  addMidiLog(msg: string, type: 'on' | 'off' | 'cc' | 'pitch') {
    const egyptTime = new Date().toLocaleTimeString('ar-EG', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const log = { time: egyptTime, msg, type };
    this.midiEventsLog.update(arr => [log, ...arr.slice(0, 39)]);
  }

  private handleExternalMidiEvent(event: { data: Uint8Array }, deviceId?: string) {
    if (this.selectedMidiInputId() !== 'all' && deviceId && this.selectedMidiInputId() !== deviceId) {
      return;
    }

    const [status, note, velocity] = event.data;
    const msgType = status & 0xf0;

    this.midiSignalActive.set(true);
    setTimeout(() => this.midiSignalActive.set(false), 80);

    const adjustedMidiNote = note + this.midiTranspose();

    if (msgType === 0x90 && velocity > 0) {
      // NOTE ON
      if (this.keys.some(k => k.midi === adjustedMidiNote)) {
        const normVelocity = velocity / 127;
        this.addMidiLog(`عزف نغمة: ${this.getMidiNoteNameArabic(adjustedMidiNote)} | MIDI ${adjustedMidiNote} بقوة ${velocity}`, 'on');
        this.playNoteManual(adjustedMidiNote, normVelocity);
      }
    } else if (msgType === 0x80 || (msgType === 0x90 && velocity === 0)) {
      // NOTE OFF
      if (this.keys.some(k => k.midi === adjustedMidiNote)) {
        this.addMidiLog(`إيقاف النغمة: ${this.getMidiNoteNameArabic(adjustedMidiNote)}`, 'off');
        this.stopNoteManual(adjustedMidiNote);
      }
    } else if (msgType === 0xa0) {
      // Polyphonic Aftertouch (Key Pressure)
      this.addMidiLog(`إفترتاتش ضغط هولدر: نغمة ${adjustedMidiNote} ضغط ${velocity}`, 'cc');
      this.handlePolyphonicAftertouch(adjustedMidiNote, velocity);
    } else if (msgType === 0xe0) {
      // Pitch Bend
      const rawBendVal = ((velocity << 7) | note) - 8192;
      const normalized = rawBendVal / 8192.0;
      this.pitchBend.set(normalized);
      this.addMidiLog(`انحراف سيكاه (Pitch Bend): ${(normalized * 100).toFixed(0)}%`, 'pitch');
      this.applyPitchBendToAllPlaying();
    } else if (msgType === 0xb0) {
      // Control Change
      this.handleMidiControlChange(note, velocity);
    }
  }

  handleMidiControlChange(cc: number, value: number) {
    const mapping = this.midiCCMappings().find(m => m.cc === cc);
    const targetLabel = mapping ? mapping.arabicLabel : `كابل غير مخصص`;
    this.addMidiLog(`تغيير تحكم CC ${cc}: قيمة ${value} (${targetLabel})`, 'cc');

    if (!mapping) return;
    const norm = value / 127.0;

    switch (mapping.target) {
      case 'vibrato':
        this.modulation.set(value > 10);
        break;
      case 'cutoff':
        Object.keys(this.polyActiveNodes).forEach((key) => {
          const voiceId = parseInt(key, 10);
          const voice = this.polyActiveNodes[voiceId];
          if (voice && voice.filterNode && voice.baseFilterFreq) {
            const sweepFreq = voice.baseFilterFreq * (0.3 + norm * 3.5);
            try {
              voice.filterNode.frequency.setTargetAtTime(sweepFreq, this.audioContext?.currentTime || 0, 0.05);
            } catch {
              void 0;
            }
          }
        });
        break;
      case 'volume':
        this.masterVolume.set(norm);
        if (this.masterGain && this.audioContext) {
          try {
            this.masterGain.gain.setTargetAtTime(norm, this.audioContext.currentTime, 0.05);
          } catch {
            void 0;
          }
        }
        break;
      case 'reverbWet':
        this.reverbWet.set(norm);
        if (this.reverbWetNode && this.audioContext) {
          try {
            this.reverbWetNode.gain.setTargetAtTime(norm, this.audioContext.currentTime, 0.05);
          } catch {
            void 0;
          }
        }
        break;
      case 'delayLevel':
        this.delayLevel.set(norm * 0.9);
        break;
      case 'tempoBpm':
        this.tempoBpm.set(Math.round(60 + norm * 180));
        break;
    }
  }

  handlePolyphonicAftertouch(midi: number, pressureVal: number) {
    if (!this.audioContext || !this.enginePower()) return;

    // Apply to main note
    this.applyPressureToRefId(midi, pressureVal);

    // Apply to dual-layer voice (such as strings sub-octave layer) if active
    this.applyPressureToRefId(1000 + midi, pressureVal);

    // Apply to any potential third layer reference
    this.applyPressureToRefId(2000 + midi, pressureVal);
  }

  private applyPressureToRefId(refId: number, pressureVal: number) {
    const voice = this.polyActiveNodes[refId];
    if (voice && voice.filterNode && voice.pressureGainNode && voice.baseFilterFreq) {
      const now = this.audioContext!.currentTime;
      const pressureRatio = pressureVal / 127.0;

      // 1. Filter Cutoff Modulation:
      // Sweep cutoff frequency based on pressure (0 to 127)
      // Range: baseFilterFreq * 1.0 up to baseFilterFreq * 3.5
      const targetFreq = voice.baseFilterFreq * (1.0 + 2.5 * pressureRatio);
      voice.filterNode.frequency.setTargetAtTime(targetFreq, now, 0.05);

      // 2. Volume Modulation:
      // Swell volume based on pressure (0 to 127)
      // Range: 0.6 up to 1.5
      const targetGain = 0.6 + pressureRatio * 0.9;
      voice.pressureGainNode.gain.setTargetAtTime(targetGain, now, 0.05);
    }
  }

  adjustMidiTranspose(semitones: number) {
    const next = Math.max(-24, Math.min(24, this.midiTranspose() + semitones));
    this.midiTranspose.set(next);
  }

  // Computer physical typings listener
  @HostListener('window:keydown', ['$event'])
  onKeyDown(event: KeyboardEvent) {
    if (event.repeat || !this.enginePower()) return;
    const target = event.target as HTMLElement;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
      return;
    }
    const keyChar = event.key.toLowerCase();

    // Check if keyboard drum play is active
    if (this.keyboardPadPlayActive()) {
      const padKeyMap: Record<string, number> = {
        '1': 1, '2': 2, '3': 3, '4': 4,
        'q': 5, 'w': 6, 'e': 7, 'r': 8,
        'a': 9, 's': 10, 'd': 11, 'f': 12,
        'z': 13, 'x': 14, 'c': 15, 'v': 16
      };
      const padId = padKeyMap[keyChar];
      if (padId !== undefined) {
        event.preventDefault();
        this.triggerPad(padId);
        return;
      }
    }

    const keyObj = this.keyMap[keyChar];
    if (keyObj) {
      event.preventDefault();
      this.playNoteManual(keyObj.midi);
    }
  }

  @HostListener('window:keyup', ['$event'])
  onKeyUp(event: KeyboardEvent) {
    const target = event.target as HTMLElement;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
      return;
    }
    const keyChar = event.key.toLowerCase();
    const keyObj = this.keyMap[keyChar];
    if (keyObj) {
      event.preventDefault();
      this.stopNoteManual(keyObj.midi);
    }
  }

  // Main interactive sound triggers
  playNoteManual(midi: number, velocity?: number) {
    if (!this.enginePower()) {
      this.initEngine();
    }

    if (this.audioContext && this.audioContext.state === 'suspended') {
      this.audioContext.resume();
    }

    let activeMidi = midi;
    if (this.autoTuneActive()) {
      activeMidi = this.snapToScale(midi);
      this.autoTuneActiveSnaps[midi] = activeMidi;
    }

    // Save timestamp of note attack for duration release calculations (Staccato / Legato release modulation)
    this.noteOnTimeStamps[activeMidi] = performance.now();

    const keyObj = this.keys.find(k => k.midi === activeMidi);
    if (keyObj) {
      this.lastPressedNoteName.set(keyObj.name);
      const freq = this.getAdjustedFrequency(activeMidi);
      this.lastPressedFrequency.set(`${freq.toFixed(1)} Hz`);
    }

    if (this.isRecording()) {
      const curTick = performance.now() - this.recordingStartTimestamp;
      this.recordingNotesTape.push({ time: curTick, type: 'ON', midi: activeMidi });
    }

    const nextMap = { ...this.activeNotesMap() };
    nextMap[activeMidi] = true;
    this.activeNotesMap.set(nextMap);

    if (this.arpActive()) {
      const current = this.arpHeldNotes();
      if (!current.includes(activeMidi)) {
        const nextArpHeld = [...current, activeMidi];
        this.arpHeldNotes.set(nextArpHeld);
        if (current.length === 0) {
          this.startArpLoop();
        }
      }
      return;
    }

    const computedFreq = this.getAdjustedFrequency(activeMidi);

    if (this.splitMode() || this.dualMode()) {
      this.playCustomInstrumentLayers(activeMidi, computedFreq, velocity);
    } else {
      this.playStandardHarmonicsVoice(activeMidi, computedFreq, velocity);
    }
  }

  stopNoteManual(midi: number) {
    if (!this.enginePower()) return;

    let activeMidi = midi;
    if (this.autoTuneActiveSnaps[midi] !== undefined) {
      activeMidi = this.autoTuneActiveSnaps[midi];
      delete this.autoTuneActiveSnaps[midi];
    }

    if (this.isRecording()) {
      const curTick = performance.now() - this.recordingStartTimestamp;
      this.recordingNotesTape.push({ time: curTick, type: 'OFF', midi: activeMidi });
    }

    const nextMap = { ...this.activeNotesMap() };
    delete nextMap[activeMidi];
    this.activeNotesMap.set(nextMap);

    if (this.arpActive()) {
      const current = this.arpHeldNotes();
      const filtered = current.filter(m => m !== activeMidi);
      this.arpHeldNotes.set(filtered);
      if (filtered.length === 0) {
        this.stopArpLoop();
      }
      return;
    }

    this.stopKeyAcousticEnvelope(activeMidi);
  }

  // --- ARPEGGIATOR OPERATIONS ---
  toggleArpActive() {
    const nextVal = !this.arpActive();
    this.arpActive.set(nextVal);
    
    if (nextVal) {
      const activeMap = this.activeNotesMap();
      const heldKeys = Object.keys(activeMap)
        .map(k => parseInt(k, 10))
        .filter(k => activeMap[k]);
      
      this.arpHeldNotes.set(heldKeys);
      if (heldKeys.length > 0) {
        this.startArpLoop();
      }
    } else {
      this.stopArpLoop();
      this.arpHeldNotes.set([]);
    }
  }

  startArpLoop() {
    if (!this.enginePower()) {
      this.initEngine();
    }

    this.stopArpLoop();
    if (this.audioContext) {
      this.nextArpStepTime = this.audioContext.currentTime;
      this.currentArpIdx = 0;
      this.scheduleArpPipeline();
    }
  }

  stopArpLoop() {
    if (this.arpSchedulerTimer) {
      clearTimeout(this.arpSchedulerTimer);
      this.arpSchedulerTimer = null;
    }
    this.killAllArpVoices();
  }

  private scheduleArpPipeline() {
    if (!this.audioContext || !this.arpActive()) return;

    const currentNotes = [...this.arpHeldNotes()];
    if (currentNotes.length === 0) {
      this.arpSchedulerTimer = setTimeout(() => {
        this.scheduleArpPipeline();
      }, this.lookaheadMs);
      return;
    }

    const stepLengthSec = 60.0 / this.tempoBpm() / (this.arpSpeed() / 4.0);

    while (this.nextArpStepTime < this.audioContext.currentTime + this.scheduleAheadTimeSec) {
      let notesToRun = [...currentNotes].sort((a, b) => a - b);
      if (this.arpPattern() === 'down') {
        notesToRun.reverse();
      } else if (this.arpPattern() === 'updown') {
        const seq: number[] = [];
        if (notesToRun.length > 0) {
          seq.push(...notesToRun);
          for (let i = notesToRun.length - 2; i > 0; i--) {
            seq.push(notesToRun[i]);
          }
        }
        notesToRun = seq;
      }

      if (notesToRun.length > 0) {
        const idx = this.currentArpIdx % notesToRun.length;
        const midi = notesToRun[idx];
        const duration = stepLengthSec * 0.8;
        this.triggerArpNote(midi, this.nextArpStepTime, duration);
      }

      this.nextArpStepTime += stepLengthSec;
      this.currentArpIdx++;
    }

    this.arpSchedulerTimer = setTimeout(() => {
      this.scheduleArpPipeline();
    }, this.lookaheadMs);
  }

  private triggerArpNote(midi: number, time: number, duration: number) {
    if (!this.audioContext || !this.masterGain) return;

    setTimeout(() => {
      this.arpActiveSoundingNote.set(midi);
      const keyObj = this.keys.find(k => k.midi === midi);
      if (keyObj) {
        this.lastPressedNoteName.set(keyObj.name);
        const freq = this.getAdjustedFrequency(midi);
        this.lastPressedFrequency.set(`${freq.toFixed(1)} Hz`);
      }
    }, Math.max(0, (time - this.audioContext.currentTime) * 1000));

    setTimeout(() => {
      if (this.arpActiveSoundingNote() === midi) {
        this.arpActiveSoundingNote.set(null);
      }
    }, Math.max(0, (time + duration - this.audioContext.currentTime) * 1000));

    const computedFreq = this.getAdjustedFrequency(midi);
    this.triggerScheduledVoice(midi, computedFreq, time, duration);
  }

  private triggerScheduledVoice(midi: number, frequency: number, startTime: number, duration: number) {
    if (!this.audioContext || !this.masterGain) return;

    const voice = this.voicesDef[this.activeInstrument()] || this.voicesDef['piano'];
    const volScale = (this.splitMode() || this.dualMode()) ? 0.55 : 0.65;

    const oscs: OscillatorNode[] = [];
    const envelopeGain = this.audioContext.createGain();
    envelopeGain.gain.setValueAtTime(0.0001, startTime);

    const bendAmt = this.pitchBend();
    const bendRatio = Math.pow(2, (bendAmt * 2.0) / 12);

    let transientNoiseSource: AudioBufferSourceNode | undefined;
    const instName = this.activeInstrument();
    if ((instName === 'oud' || instName === 'qanun' || instName === 'guitar' || instName === 'buzuq') && midi < 1000) {
      const sizeRatio = this.audioContext.sampleRate * 0.007;
      const noiseBuffer = this.audioContext.createBuffer(1, sizeRatio, this.audioContext.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < sizeRatio; i++) {
        data[i] = (Math.random() * 2.0 - 1.0) * 0.55;
      }
      transientNoiseSource = this.audioContext.createBufferSource();
      transientNoiseSource.buffer = noiseBuffer;
      const noiseGainNode = this.audioContext.createGain();
      noiseGainNode.gain.setValueAtTime(0.3, startTime);

      transientNoiseSource.connect(noiseGainNode);
      noiseGainNode.connect(envelopeGain);
    }

    voice.harmonics.forEach((amp, idx) => {
      const osc = this.audioContext!.createOscillator();
      osc.type = voice.wave;
      
      const overtoneFreq = frequency * (idx + 1);
      osc.frequency.setValueAtTime(overtoneFreq * bendRatio, startTime);

      if (this.modulation()) {
        const vibratoSpeed = 6.4;
        const targetVibratoDepth = overtoneFreq * 0.015;
        const lfoOsc = this.audioContext!.createOscillator();
        const lfoGainNode = this.audioContext!.createGain();
        lfoOsc.frequency.setValueAtTime(vibratoSpeed, startTime);
        lfoGainNode.gain.setValueAtTime(targetVibratoDepth, startTime);
        
        lfoOsc.connect(lfoGainNode);
        lfoGainNode.connect(osc.frequency);
        lfoOsc.start(startTime);
        oscs.push(lfoOsc);
      }

      const harmGain = this.audioContext!.createGain();
      harmGain.gain.setValueAtTime(amp * volScale, startTime);

      osc.connect(harmGain);
      harmGain.connect(envelopeGain);
      osc.start(startTime);
      oscs.push(osc);
    });

    envelopeGain.connect(this.masterGain);

    const env = voice.env;
    const attackTime = env.a;
    const decayTime = env.d;
    const sustainLevel = env.s;
    const releaseTime = env.r;

    envelopeGain.gain.cancelScheduledValues(startTime);
    envelopeGain.gain.setValueAtTime(0.0001, startTime);
    envelopeGain.gain.linearRampToValueAtTime(1.0, startTime + attackTime);
    envelopeGain.gain.linearRampToValueAtTime(sustainLevel, startTime + attackTime + decayTime);

    const releaseStartTime = startTime + duration;
    envelopeGain.gain.setValueAtTime(sustainLevel, releaseStartTime);
    envelopeGain.gain.exponentialRampToValueAtTime(0.0001, releaseStartTime + releaseTime);

    if (transientNoiseSource) {
      transientNoiseSource.start(startTime);
    }

    const stopTime = releaseStartTime + releaseTime + 0.1;
    oscs.forEach(osc => {
      try {
        osc.stop(stopTime);
      } catch {
        // Safe play; ignore already stopped oscillator
      }
    });

    if (transientNoiseSource) {
      try {
        transientNoiseSource.stop(stopTime);
      } catch {
        // Safe play; ignore noise source stopped
      }
    }

    const voiceItem = {
      oscillators: oscs,
      gainNode: envelopeGain,
      stopTime: stopTime,
      noiseSource: transientNoiseSource
    };
    this.arpScheduledVoices.push(voiceItem);

    setTimeout(() => {
      this.arpScheduledVoices = this.arpScheduledVoices.filter(v => v !== voiceItem);
    }, Math.max(0, (stopTime - this.audioContext!.currentTime) * 1000) + 100);
  }

  killAllArpVoices() {
    const now = this.audioContext ? this.audioContext.currentTime : 0;
    this.arpScheduledVoices.forEach(voice => {
      try {
        voice.gainNode.gain.cancelScheduledValues(now);
        voice.gainNode.gain.setValueAtTime(voice.gainNode.gain.value, now);
        voice.gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.05);
        voice.oscillators.forEach(osc => {
          try {
            osc.stop(now + 0.1);
          } catch {
            // Safe play; ignore oscillator stop error
          }
        });
        if (voice.noiseSource) {
          try {
            voice.noiseSource.stop(now + 0.1);
          } catch {
            // Safe play; ignore noise source stop error
          }
        }
      } catch {
        // Safe play; ignore envelope gain cleanup error
      }
    });
    this.arpScheduledVoices = [];
    this.arpActiveSoundingNote.set(null);
  }

  // Schedule layered accordion/splits
  private playCustomInstrumentLayers(midi: number, frequency: number, velocityVal?: number) {
    if (!this.audioContext || !this.masterGain) return;

    const velPercent = (this.velocitySensitive() && velocityVal !== undefined) ? velocityVal : 1.0;

    // Split Mode logic: under C4 (midi 60) plays warm accompaniment strings
    if (this.splitMode() && midi < 60) {
      const stringsVoice = this.voicesDef['strings'];
      this.triggerFreshOscillators(midi, frequency, stringsVoice, 0.4 * velPercent);
      return;
    }

    const defVoice = this.voicesDef[this.activeInstrument()] || this.voicesDef['piano'];
    this.triggerFreshOscillators(midi, frequency, defVoice, 0.6 * velPercent);

    // Dual layered strings octave down
    if (this.dualMode()) {
      const stringsLayer = this.voicesDef['strings'];
      // Layer a strings synth at sub octave
      this.triggerFreshOscillators(1000 + midi, frequency * 0.5, stringsLayer, 0.25 * velPercent);
    }
  }

  private playStandardHarmonicsVoice(midi: number, frequency: number, velocityVal?: number) {
    const defVoice = this.voicesDef[this.activeInstrument()] || this.voicesDef['piano'];
    const velPercent = (this.velocitySensitive() && velocityVal !== undefined) ? velocityVal : 1.0;
    this.triggerFreshOscillators(midi, frequency, defVoice, 0.7 * velPercent);
  }

  // Low level oscillator sound triggers
  private triggerFreshOscillators(midiKeyRefID: number, frequency: number, voice: InstrumentVoiceDef, volScale: number) {
    if (!this.audioContext || !this.masterGain) return;

    // Shut down previous overlapping sound
    this.killSoundByMidiRefID(midiKeyRefID);

    const now = this.audioContext.currentTime;
    const oscs: OscillatorNode[] = [];
    const envelopeGain = this.audioContext.createGain();
    envelopeGain.gain.setValueAtTime(0.001, now);

    const bendAmt = this.pitchBend();
    const bendRatio = Math.pow(2, (bendAmt * 2.0) / 12);

    let transientNoiseSource: AudioBufferSourceNode | undefined;

    // Oud/Qanun pluck simulation using high-register noise pluck click transients
    const instName = this.activeInstrument();
    if ((instName === 'oud' || instName === 'qanun' || instName === 'guitar' || instName === 'buzuq') && midiKeyRefID < 1000) {
      const sizeRatio = this.audioContext.sampleRate * 0.007; // 7ms burst
      const noiseBuffer = this.audioContext.createBuffer(1, sizeRatio, this.audioContext.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < sizeRatio; i++) {
        data[i] = (Math.random() * 2.0 - 1.0) * 0.55;
      }
      transientNoiseSource = this.audioContext.createBufferSource();
      transientNoiseSource.buffer = noiseBuffer;
      const noiseGainNode = this.audioContext.createGain();
      noiseGainNode.gain.setValueAtTime(0.3, now);

      transientNoiseSource.connect(noiseGainNode);
      noiseGainNode.connect(envelopeGain);
    }

    // Connect voices harmonics
    voice.harmonics.forEach((amp, idx) => {
      const osc = this.audioContext!.createOscillator();
      osc.type = voice.wave;
      
      const overtoneFreq = frequency * (idx + 1);
      osc.frequency.setValueAtTime(overtoneFreq * bendRatio, now);

      // Connect vibrato sweep
      if (this.modulation()) {
        const vibratoSpeed = 6.4; // 6.4Hz standard singing vibrato speed
        const targetVibratoDepth = overtoneFreq * 0.015; // 1.5% vibrato depth range
        const lfoOsc = this.audioContext!.createOscillator();
        const lfoGainNode = this.audioContext!.createGain();
        lfoOsc.frequency.setValueAtTime(vibratoSpeed, now);
        lfoGainNode.gain.setValueAtTime(targetVibratoDepth, now);
        
        lfoOsc.connect(lfoGainNode);
        lfoGainNode.connect(osc.frequency);
        lfoOsc.start(now);
        // Osc tracks internal reference mapping
        oscs.push(lfoOsc);
      }

      const harmGain = this.audioContext!.createGain();
      harmGain.gain.setValueAtTime(amp * volScale, now);

      osc.connect(harmGain);
      harmGain.connect(envelopeGain);
      osc.start(now);
      
      oscs.push(osc);
    });

    const pressureGain = this.audioContext.createGain();
    pressureGain.gain.setValueAtTime(1.0, now);

    const filterNode = this.audioContext.createBiquadFilter();
    filterNode.type = 'lowpass';
    const baseFilterFreq = Math.max(frequency * 2.0, 1000);
    filterNode.frequency.setValueAtTime(baseFilterFreq, now);
    filterNode.Q.setValueAtTime(1.5, now);

    envelopeGain.connect(pressureGain);
    pressureGain.connect(filterNode);
    filterNode.connect(this.masterGain);

    // Apply ADSR Trigger values
    const env = voice.env;
    envelopeGain.gain.cancelScheduledValues(now);
    envelopeGain.gain.setValueAtTime(0.0001, now);
    envelopeGain.gain.linearRampToValueAtTime(1.0, now + env.a);
    envelopeGain.gain.linearRampToValueAtTime(env.s, now + env.a + env.d);

    if (transientNoiseSource) {
      transientNoiseSource.start(now);
    }

    this.polyActiveNodes[midiKeyRefID] = {
      oscillators: oscs,
      gainNode: envelopeGain,
      pressureGainNode: pressureGain,
      filterNode: filterNode,
      baseFilterFreq: baseFilterFreq,
      noiseSource: transientNoiseSource
    };
  }

  // Release Key envelopes
  private stopKeyAcousticEnvelope(midiKeyRefID: number) {
    if (!this.audioContext || this.sustain()) return; // Sustain overrides instant release

    const currentVoice = this.polyActiveNodes[midiKeyRefID];
    if (currentVoice) {
      const now = this.audioContext.currentTime;
      const instrument = this.activeInstrument();
      const activeDef = this.voicesDef[instrument] || this.voicesDef['piano'];
      
      let releaseTime = activeDef.env.r;

      // If velocity sensitive mode is active, check held duration to dynamically alter the release envelope
      const onTime = this.noteOnTimeStamps[midiKeyRefID];
      if (this.velocitySensitive() && onTime) {
        const duration = performance.now() - onTime;
        // Fast release if staccato (pressed < 180ms)
        if (duration < 180) {
          const factor = Math.max(0.18, duration / 180);
          releaseTime = releaseTime * factor;
        }
      }
      const nodeToRelease = currentVoice;

      try {
        nodeToRelease.gainNode.gain.cancelScheduledValues(now);
        nodeToRelease.gainNode.gain.setValueAtTime(nodeToRelease.gainNode.gain.value, now);
        nodeToRelease.gainNode.gain.exponentialRampToValueAtTime(0.0001, now + releaseTime);

        nodeToRelease.oscillators.forEach(osc => {
          try {
            osc.stop(now + releaseTime + 0.1);
          } catch {
            // Safe stop
          }
        });

        if (nodeToRelease.noiseSource) {
          try {
            nodeToRelease.noiseSource.stop(now + releaseTime + 0.1);
          } catch {
            // Safe stop
          }
        }
      } catch {
        // Safe closure state
      }

      delete this.polyActiveNodes[midiKeyRefID];
    }

    // Re-check Dual Mode layer release
    const dualRefId = 1000 + midiKeyRefID;
    const dualVoice = this.polyActiveNodes[dualRefId];
    if (dualVoice) {
      const now = this.audioContext.currentTime;
      const stringsDef = this.voicesDef['strings'];
      const rel = stringsDef.env.r;

      try {
        dualVoice.gainNode.gain.cancelScheduledValues(now);
        dualVoice.gainNode.gain.setValueAtTime(dualVoice.gainNode.gain.value, now);
        dualVoice.gainNode.gain.exponentialRampToValueAtTime(0.0001, now + rel);

        dualVoice.oscillators.forEach(osc => {
          try {
            osc.stop(now + rel + 0.1);
          } catch {
            // Safe stop
          }
        });
      } catch {
        // Safe key lift
      }
      delete this.polyActiveNodes[dualRefId];
    }
  }

  private killSoundByMidiRefID(midiRefID: number) {
    const prev = this.polyActiveNodes[midiRefID];
    if (prev) {
      try {
        prev.oscillators.forEach(o => o.stop());
        if (prev.noiseSource) prev.noiseSource.stop();
      } catch {
        // Safe sound kill
      }
      delete this.polyActiveNodes[midiRefID];
    }
  }

  public selectInstrument(id: string) {
    this.activeInstrument.set(id);
    this.stopAllVoicesOscillators();
  }

  public switchSoundPack(packId: string) {
    const pack = this.soundPacks().find(p => p.id === packId);
    if (pack) {
      this.activeSoundPackId.set(packId);
      if (pack.instruments.length > 0) {
        this.selectInstrument(pack.instruments[0].key);
      }
    }
  }

  getVoicesKeys(): string[] {
    return Object.keys(this.voicesDef);
  }

  loadSoundPacks() {
    if (!this.isBrowser) return;
    const saved = localStorage.getItem('shanan_downloaded_packs');
    if (saved) {
      try {
        const downloadedIds = JSON.parse(saved) as string[];
        this.soundPacks.update((packs) => {
          return packs.map((p) => {
            if (downloadedIds.includes(p.id)) {
              p.instruments.forEach((inst) => {
                this.voicesDef[inst.key] = {
                  name: inst.name,
                  arabicName: inst.arabicName,
                  wave: inst.wave as OscillatorType,
                  harmonics: inst.harmonics,
                  env: inst.env
                };
              });
              return { ...p, status: 'downloaded' as const };
            }
            return p;
          });
        });
      } catch (e) {
        console.error('Error loading sound packs', e);
      }
    }
  }

  downloadSoundPack(packId: string) {
    this.soundPacks.update((packs) =>
      packs.map((p) => (p.id === packId ? { ...p, status: 'downloading', downloadProgress: 0 } : p))
    );

    let progress = 0;
    const interval = setInterval(() => {
      progress += 10;
      this.soundPacks.update((packs) =>
        packs.map((p) => (p.id === packId ? { ...p, downloadProgress: progress } : p))
      );

      if (progress >= 100) {
        clearInterval(interval);
        this.soundPacks.update((packs) =>
          packs.map((p) => {
            if (p.id === packId) {
              p.instruments.forEach((inst) => {
                this.voicesDef[inst.key] = {
                  name: inst.name,
                  arabicName: inst.arabicName,
                  wave: inst.wave as OscillatorType,
                  harmonics: inst.harmonics,
                  env: inst.env
                };
              });
              
              if (this.isBrowser) {
                const downloaded = this.getDownloadedPackIds();
                if (!downloaded.includes(packId)) {
                  downloaded.push(packId);
                  localStorage.setItem('shanan_downloaded_packs', JSON.stringify(downloaded));
                }
              }

              return { ...p, status: 'downloaded', downloadProgress: 100 };
            }
            return p;
          })
        );
        this.addMidiLog(`تم تثبيت وتحميل حزمة الأصوات: ${packId}`, 'cc');
      }
    }, 150);
  }

  getDownloadedPackIds(): string[] {
    return this.soundPacks()
      .filter(p => p.status === 'downloaded')
      .map(p => p.id);
  }

  removeSoundPack(packId: string) {
    this.soundPacks.update((packs) =>
      packs.map((p) => {
        if (p.id === packId) {
          p.instruments.forEach((inst) => {
            delete this.voicesDef[inst.key];
          });
          
          if (p.instruments.some(inst => inst.key === this.activeInstrument())) {
            this.activeInstrument.set('piano');
          }

          return { ...p, status: 'available', downloadProgress: 0 };
        }
        return p;
      })
    );

    if (this.isBrowser) {
      const downloaded = this.getDownloadedPackIds();
      localStorage.setItem('shanan_downloaded_packs', JSON.stringify(downloaded));
    }
    this.addMidiLog(`تم حذف وإلغاء حزمة الأصوات: ${packId}`, 'cc');
  }

  updateMidiCCMapping(index: number, newTarget: 'vibrato' | 'cutoff' | 'volume' | 'reverbWet' | 'delayLevel' | 'tempoBpm') {
    this.midiCCMappings.update(mappings => {
      return mappings.map((m, i) => {
        if (i === index) {
          const matchedOption = this.midiTargetOptions.find(opt => opt.target === newTarget);
          return {
            ...m,
            target: newTarget,
            label: matchedOption ? matchedOption.label : m.label,
            arabicLabel: matchedOption ? matchedOption.arabicLabel : m.arabicLabel
          };
        }
        return m;
      });
    });
  }

  updateMidiCCNumber(index: number, newCcValue: number) {
    this.midiCCMappings.update(mappings => {
      return mappings.map((m, i) => {
        if (i === index) {
          return { ...m, cc: newCcValue };
        }
        return m;
      });
    });
  }

  public stopAllVoicesOscillators() {
    Object.keys(this.polyActiveNodes).forEach(keyRef => {
      const refId = parseInt(keyRef, 10);
      const voice = this.polyActiveNodes[refId];
      if (voice) {
        try {
          voice.oscillators.forEach(o => o.stop());
          if (voice.noiseSource) voice.noiseSource.stop();
        } catch {
          // Safe stop
        }
      }
    });
    this.polyActiveNodes = {};
    this.soloActiveNode = null;
  }

  // --- PRESET MANAGER OPERATIONS ---
  loadCustomPresets() {
    if (this.isBrowser) {
      const saved = localStorage.getItem('shanan_custom_presets');
      if (saved) {
        try {
          const parsed = JSON.parse(saved) as OrganPreset[];
          this.customPresets.set(parsed);
        } catch {
          // Fallback
        }
      }
    }
    this.rebuildPresetsList();
  }

  rebuildPresetsList() {
    this.presetsList.set([...this.defaultPresets, ...this.customPresets()]);
  }

  loadPreset(preset: OrganPreset) {
    this.activeInstrument.set(preset.instrument);
    this.sustain.set(preset.sustain);
    this.reverb.set(preset.reverb);
    this.splitMode.set(preset.splitMode);
    this.dualMode.set(preset.dualMode);
    this.reverbWet.set(preset.reverbWet);
    this.applyReverbGains(preset.reverb, preset.reverbWet);
    
    this.updateDelayLevel(preset.delayLevel !== undefined ? preset.delayLevel : 0.3);
    this.updateEqLow(preset.eqLow);
    this.updateEqMid(preset.eqMid);
    this.updateEqHigh(preset.eqHigh);
    
    if (preset.quarterTones && preset.quarterTones.length === 12) {
      this.quarterTones.set([...preset.quarterTones]);
    }
    this.activeScalePreset.set(preset.activeScalePreset);
    
    this.masterTuning.set(preset.masterTuning !== undefined ? preset.masterTuning : 0);
    this.velocitySensitive.set(preset.velocitySensitive !== undefined ? preset.velocitySensitive : false);
    this.applyPitchBendToAllPlaying();

    if (preset.activeRhythm && preset.activeRhythm !== 'none') {
      this.startRhythmLoop(preset.activeRhythm);
    } else {
      this.stopRhythmLoop();
    }
  }

  toggleVelocitySensitive() {
    this.velocitySensitive.set(!this.velocitySensitive());
  }

  saveCurrentPreset(customName: string) {
    if (!customName.trim()) return;
    
    const newPreset: OrganPreset = {
      id: 'custom-' + Date.now(),
      name: customName.trim(),
      arabicName: customName.trim(),
      isCustom: true,
      instrument: this.activeInstrument(),
      sustain: this.sustain(),
      reverb: this.reverb(),
      splitMode: this.splitMode(),
      dualMode: this.dualMode(),
      reverbWet: this.reverbWet(),
      delayLevel: this.delayLevel(),
      eqLow: this.eqLow(),
      eqMid: this.eqMid(),
      eqHigh: this.eqHigh(),
      quarterTones: [...this.quarterTones()],
      activeScalePreset: this.activeScalePreset(),
      activeRhythm: this.activeRhythm(),
      masterTuning: this.masterTuning(),
      velocitySensitive: this.velocitySensitive()
    };

    const updated = [...this.customPresets(), newPreset];
    this.customPresets.set(updated);
    if (this.isBrowser) {
      localStorage.setItem('shanan_custom_presets', JSON.stringify(updated));
    }
    this.rebuildPresetsList();
    this.presetNameInput.set('');
  }

  deletePreset(id: string) {
    const updated = this.customPresets().filter(p => p.id !== id);
    this.customPresets.set(updated);
    if (this.isBrowser) {
      localStorage.setItem('shanan_custom_presets', JSON.stringify(updated));
    }
    this.rebuildPresetsList();
  }

  updateEqLow(val: number) {
    this.eqLow.set(val);
    if (this.audioContext && this.eqLowNode) {
      this.eqLowNode.gain.setValueAtTime(val, this.audioContext.currentTime);
    }
  }

  updateEqMid(val: number) {
    this.eqMid.set(val);
    if (this.audioContext && this.eqMidNode) {
      this.eqMidNode.gain.setValueAtTime(val, this.audioContext.currentTime);
    }
  }

  updateEqHigh(val: number) {
    this.eqHigh.set(val);
    if (this.audioContext && this.eqHighNode) {
      this.eqHighNode.gain.setValueAtTime(val, this.audioContext.currentTime);
    }
  }

  updateDelayLevel(val: number) {
    this.delayLevel.set(val);
    if (this.audioContext && this.delayNode) {
      this.delayNode.delayTime.setValueAtTime(val * 1.5, this.audioContext.currentTime);
    }
  }

  updateDelayFeedback(val: number) {
    this.delayFeedback.set(val);
    if (this.audioContext && this.delayFeedbackNode) {
      this.delayFeedbackNode.gain.setValueAtTime(val, this.audioContext.currentTime);
    }
  }

  updateMasterTuning(val: number | string) {
    const numericVal = typeof val === 'number' ? val : parseFloat(val);
    if (!isNaN(numericVal)) {
      this.masterTuning.set(numericVal);
      this.applyPitchBendToAllPlaying();
    }
  }

  setMasterTuningUp() {
    const current = this.masterTuning();
    if (current < 50) {
      const next = Math.min(50, current + 1);
      this.updateMasterTuning(next);
    }
  }

  setMasterTuningDown() {
    const current = this.masterTuning();
    if (current > -50) {
      const next = Math.max(-50, current - 1);
      this.updateMasterTuning(next);
    }
  }

  resetMasterTuning() {
    this.updateMasterTuning(0);
  }

  applyReverbGains(isReverbActive: boolean, wetLevel: number) {
    if (this.audioContext && this.reverbWetNode && this.reverbDryNode) {
      const now = this.audioContext.currentTime;
      const wetVal = isReverbActive ? wetLevel : 0.0;
      const dryCos = Math.cos(wetVal * 0.5 * Math.PI);
      const wetSin = Math.sin(wetVal * 0.5 * Math.PI);
      this.reverbDryNode.gain.setValueAtTime(dryCos, now);
      this.reverbWetNode.gain.setValueAtTime(wetSin * 1.2, now);
    }
  }

  // --- DRUM SEQUENCER OPERATIONS ---
  toggleSequencerStep(track: string, stepIndex: number) {
    this.saveDrumHistory();
    const currentMatrix = this.drumSequencerMatrix();
    const updatedTrack = [...currentMatrix[track]];
    updatedTrack[stepIndex] = !updatedTrack[stepIndex];
    this.drumSequencerMatrix.set({
      ...currentMatrix,
      [track]: updatedTrack
    });

    const currentOffsets = this.drumSequencerOffsets();
    const updatedOffsetsTrack = [...currentOffsets[track]];
    updatedOffsetsTrack[stepIndex] = 0.0;
    this.drumSequencerOffsets.set({
      ...currentOffsets,
      [track]: updatedOffsetsTrack
    });
  }

  loadDrumPreset(key: keyof typeof this.drumSequencerPresets) {
    this.saveDrumHistory();
    const p = this.drumSequencerPresets[key];
    if (p) {
      this.drumSequencerMatrix.set({
        kick: [...p.matrix.kick],
        snare: [...p.matrix.snare],
        closedHat: [...p.matrix.closedHat],
        openHat: [...p.matrix.openHat]
      });
      this.drumSequencerOffsets.set({
        kick: Array(16).fill(0),
        snare: Array(16).fill(0),
        closedHat: Array(16).fill(0),
        openHat: Array(16).fill(0)
      });
    }
  }

  clearSequencer() {
    this.loadDrumPreset('empty');
  }

  // Synthesizers for classic drum machine samples
  synthesizeDrumKick(time: number, pitch = 1.0, volume = 1.0) {
    if (!this.audioContext || !this.masterGain) return;
    const osc = this.audioContext.createOscillator();
    const gain = this.audioContext.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(150 * pitch, time);
    osc.frequency.exponentialRampToValueAtTime(0.01, time + 0.12);

    gain.gain.setValueAtTime(0.001, time);
    gain.gain.linearRampToValueAtTime(1.0 * volume, time + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.15);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(time);
    osc.stop(time + 0.18);
  }

  synthesizeDrumSnare(time: number, pitch = 1.0, volume = 1.0) {
    if (!this.audioContext || !this.masterGain) return;
    
    const osc = this.audioContext.createOscillator();
    const gainOsc = this.audioContext.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(180 * pitch, time);
    gainOsc.gain.setValueAtTime(0.35 * volume, time);
    gainOsc.gain.exponentialRampToValueAtTime(0.01, time + 0.1);
    osc.connect(gainOsc);
    gainOsc.connect(this.masterGain);
    osc.start(time);
    osc.stop(time + 0.12);

    const bufferSize = this.audioContext.sampleRate * 0.15;
    const buffer = this.audioContext.createBuffer(1, bufferSize, this.audioContext.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    const noise = this.audioContext.createBufferSource();
    noise.buffer = buffer;

    const filter = this.audioContext.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1200 * pitch, time);

    const gainNoise = this.audioContext.createGain();
    gainNoise.gain.setValueAtTime(0.65 * volume, time);
    gainNoise.gain.exponentialRampToValueAtTime(0.01, time + 0.15);

    noise.connect(filter);
    filter.connect(gainNoise);
    gainNoise.connect(this.masterGain);

    noise.start(time);
    noise.stop(time + 0.18);
  }

  synthesizeDrumClosedHat(time: number, pitch = 1.0, volume = 1.0) {
    if (!this.audioContext || !this.masterGain) return;
    const bufferSize = this.audioContext.sampleRate * 0.04;
    const buffer = this.audioContext.createBuffer(1, bufferSize, this.audioContext.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    const noise = this.audioContext.createBufferSource();
    noise.buffer = buffer;

    const filter = this.audioContext.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(7000 * pitch, time);

    const gain = this.audioContext.createGain();
    gain.gain.setValueAtTime(0.35 * volume, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.04);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);

    noise.start(time);
    noise.stop(time + 0.05);
  }

  synthesizeDrumOpenHat(time: number, pitch = 1.0, volume = 1.0) {
    if (!this.audioContext || !this.masterGain) return;
    const bufferSize = this.audioContext.sampleRate * 0.35;
    const buffer = this.audioContext.createBuffer(1, bufferSize, this.audioContext.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    const noise = this.audioContext.createBufferSource();
    noise.buffer = buffer;

    const filter = this.audioContext.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(6000 * pitch, time);

    const gain = this.audioContext.createGain();
    gain.gain.setValueAtTime(0.28 * volume, time);
    gain.gain.linearRampToValueAtTime(0.1 * volume, time + 0.1);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.35);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);

    noise.start(time);
    noise.stop(time + 0.38);
  }

  // --- ARABIC DARBUKA DRUM BEAT SEQUENCERS ---
  toggleRhythmBeat(rhythmId: string) {
    if (this.activeRhythm() === rhythmId) {
      this.stopRhythmLoop();
    } else {
      this.startRhythmLoop(rhythmId);
    }
  }

  private startRhythmLoop(rhythmId: string) {
    if (!this.enginePower()) {
      this.initEngine();
    }

    this.stopRhythmLoop();
    this.activeRhythm.set(rhythmId);

    if (this.audioContext) {
      this.nextDrumStepTime = this.audioContext.currentTime;
      this.currentDrumStep = 0;
      this.scheduleDrumsPipeline();
    }
  }

  stopRhythmLoop() {
    this.activeRhythm.set('none');
    this.beatIndicator.set(false);
    if (this.drumSchedulerTimer) {
      clearTimeout(this.drumSchedulerTimer);
      this.drumSchedulerTimer = null;
    }
  }

  private scheduleDrumsPipeline() {
    if (!this.audioContext || this.activeRhythm() === 'none') return;

    const isSequencer = this.activeRhythm() === 'stepSequencer';
    const stepsCount = isSequencer ? this.sequencerPatternLength() : 8;
    const subdivision = isSequencer ? 4.0 : 2.0;

    // Schedule drum sounds inside looking ahead timeline boundaries
    while (this.nextDrumStepTime < this.audioContext.currentTime + this.scheduleAheadTimeSec) {
      this.triggerScheduledDrumNote(this.currentDrumStep, this.nextDrumStepTime);

      const stepLengthSec = 60.0 / this.tempoBpm() / subdivision;
      this.nextDrumStepTime += stepLengthSec;

      this.currentDrumStep = (this.currentDrumStep + 1) % stepsCount;
    }

    this.drumSchedulerTimer = setTimeout(() => {
      this.scheduleDrumsPipeline();
    }, this.lookaheadMs);
  }

  private triggerScheduledDrumNote(step: number, time: number) {
    const rhy = this.activeRhythm();
    if (rhy === 'none' || !this.audioContext) return;

    // Pulse activeSequencerStep in perfect hearing sync
    setTimeout(() => {
      this.activeSequencerStep.set(step);
    }, Math.max(0, (time - this.audioContext!.currentTime) * 1000));

    if (rhy === 'stepSequencer') {
      const matrix = this.drumSequencerMatrix();
      const offsets = this.drumSequencerOffsets();
      const stepLengthSec = 60.0 / this.tempoBpm() / 4.0;
      const isQuantized = this.drumQuantize();

      if (matrix['kick'] && matrix['kick'][step] && step < this.sequencerPatternLength()) {
        const offsetSec = isQuantized ? 0 : (offsets['kick'] ? offsets['kick'][step] || 0 : 0) * stepLengthSec;
        this.triggerSequencerSound('kick', time + offsetSec);
      }
      if (matrix['snare'] && matrix['snare'][step] && step < this.sequencerPatternLength()) {
        const offsetSec = isQuantized ? 0 : (offsets['snare'] ? offsets['snare'][step] || 0 : 0) * stepLengthSec;
        this.triggerSequencerSound('snare', time + offsetSec);
      }
      if (matrix['closedHat'] && matrix['closedHat'][step] && step < this.sequencerPatternLength()) {
        const offsetSec = isQuantized ? 0 : (offsets['closedHat'] ? offsets['closedHat'][step] || 0 : 0) * stepLengthSec;
        this.triggerSequencerSound('closedHat', time + offsetSec);
      }
      if (matrix['openHat'] && matrix['openHat'][step] && step < this.sequencerPatternLength()) {
        const offsetSec = isQuantized ? 0 : (offsets['openHat'] ? offsets['openHat'][step] || 0 : 0) * stepLengthSec;
        this.triggerSequencerSound('openHat', time + offsetSec);
      }

      // Flash beat bulbs on quarter notes in sequencer
      if (step % 4 === 0) {
        setTimeout(() => {
          this.beatIndicator.set(true);
          setTimeout(() => this.beatIndicator.set(false), 80);
        }, Math.max(0, (time - this.audioContext!.currentTime) * 1000));
      }
      return;
    }

    let isDum = false; // deep clay darbuka bass (دوم)
    let isTak = false; // metallic ring/slap (تك)
    let isHat = false; // hihat ringlet shake (سقيف)

    // Flash beat bulbs on downbeats
    if (step === 0 || step === 4) {
      setTimeout(() => {
        this.beatIndicator.set(true);
        setTimeout(() => this.beatIndicator.set(false), 80);
      }, Math.max(0, (time - this.audioContext!.currentTime) * 1000));
    }

    if (rhy === 'oriental' || rhy === 'maqsum') {
      // Oriental Maqsum 4/4 cycle: Dum - Tak - - Tak - Dum - Tak -
      if (step === 0 || step === 4) isDum = true;
      else if (step === 2 || step === 6) isTak = true;
      else isHat = true;
    } else if (rhy === 'saidi') {
      // Saidi 4/4 cycle: Dum - Tak - - Dum - Dum - Tak -
      if (step === 0 || step === 4 || step === 5) isDum = true;
      else if (step === 2 || step === 7) isTak = true;
      else isHat = true;
    } else if (rhy === 'khaleeji') {
      // Saudi Khaleeji 2/4 cycle: Dum - - Tak - Dum - - Tak -
      if (step === 0 || step === 1 || step === 4 || step === 5) isDum = true;
      else if (step === 2 || step === 6) isTak = true;
      else isHat = true;
    } else if (rhy === 'dabke') {
      // Dabke cycle
      if (step === 0 || step === 1) isDum = true;
      else if (step === 3 || step === 6) isTak = true;
      else isHat = true;
    } else if (rhy === 'malfuf') {
      // Malfuf 2/4 cycle: Dum - - Tak - - Tak -
      if (step === 0) isDum = true;
      else if (step === 3 || step === 6) isTak = true;
      else isHat = true;
    } else if (rhy === 'wahda') {
      // Wahda simple accent
      if (step === 0) isDum = true;
      else if (step === 4) isTak = true;
      else isHat = true;
    } else if (rhy === 'baladi') {
      // Baladi rhythm: Dum Dum - Tak - Dum - Tak -
      if (step === 0 || step === 1 || step === 5) isDum = true;
      else if (step === 3 || step === 7) isTak = true;
      else isHat = true;
    } else if (rhy === 'karachi') {
      // Karachi swing beat
      if (step === 3) isDum = true;
      else if (step === 0 || step === 6) isTak = true;
      else isHat = true;
    } else if (rhy === 'turkish') {
      // Turkish syncopated design
      if (step === 0 || step === 4) isDum = true;
      else if (step === 2 || step === 3 || step === 6) isTak = true;
      else isHat = true;
    }

    if (isDum) this.synthesizeDarbukaDum(time);
    if (isTak) this.synthesizeDarbukaTak(time);
    if (isHat) this.synthesizeRiqShaker(time);
  }

  synthesizeDarbukaDum(time: number, pitch = 1.0, volume = 1.0) {
    if (!this.audioContext || !this.masterGain) return;
    const osc = this.audioContext.createOscillator();
    const gain = this.audioContext.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(140 * pitch, time);
    osc.frequency.exponentialRampToValueAtTime(45, time + 0.15); // rich thud sweep

    gain.gain.setValueAtTime(0.001, time);
    gain.gain.linearRampToValueAtTime(0.7 * volume, time + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.25);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(time);
    osc.stop(time + 0.28);
  }

  synthesizeDarbukaTak(time: number, pitch = 1.0, volume = 1.0) {
    if (!this.audioContext || !this.masterGain) return;
    const osc = this.audioContext.createOscillator();
    const gain = this.audioContext.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(950 * pitch, time);
    osc.frequency.exponentialRampToValueAtTime(600, time + 0.08);

    // add brief noise snap high frequencies
    const size = this.audioContext.sampleRate * 0.015;
    const noiseBuffer = this.audioContext.createBuffer(1, size, this.audioContext.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < size; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    const noiseNode = this.audioContext.createBufferSource();
    noiseNode.buffer = noiseBuffer;
    
    const filter = this.audioContext.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1200 * pitch, time);
    filter.Q.setValueAtTime(2.0, time);

    gain.gain.setValueAtTime(0.001, time);
    gain.gain.linearRampToValueAtTime(0.5 * volume, time + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.06);

    noiseNode.connect(filter);
    filter.connect(gain);
    osc.connect(gain);

    gain.connect(this.masterGain);
    noiseNode.start(time);
    osc.start(time);
    
    osc.stop(time + 0.08);
  }

  private synthesizeRiqShaker(time: number) {
    if (!this.audioContext || !this.masterGain) return;
    const size = this.audioContext.sampleRate * 0.01;
    const buffer = this.audioContext.createBuffer(1, size, this.audioContext.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < size; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    const source = this.audioContext.createBufferSource();
    source.buffer = buffer;
    
    const filter = this.audioContext.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(8000, time);

    const gainNode = this.audioContext.createGain();
    gainNode.gain.setValueAtTime(0.12, time);
    gainNode.gain.exponentialRampToValueAtTime(0.001, time + 0.009);

    source.connect(filter);
    filter.connect(gainNode);
    gainNode.connect(this.masterGain);

    source.start(time);
    source.stop(time + 0.015);
  }

  // --- COCKPIT REC REVOLUTION ---
  startRecordingTape() {
    if (!this.enginePower()) {
      this.initEngine();
    }
    this.recordedChunks = [];
    this.recordingNotesTape = [];
    this.recordingStartTimestamp = performance.now();
    this.isRecording.set(true);

    if (this.recorderDestination) {
      try {
        this.mediaRecorder = new MediaRecorder(this.recorderDestination.stream, {
          mimeType: 'audio/webm'
        });
        this.mediaRecorder.ondataavailable = (event) => {
          if (event.data && event.data.size > 0) {
            this.recordedChunks.push(event.data);
          }
        };
        this.mediaRecorder.start();
      } catch (e) {
        console.warn('WAV native recording initialization slow down', e);
      }
    }
  }

  stopRecordingTape() {
    if (!this.isRecording()) return;
    this.isRecording.set(false);

    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      try {
        this.mediaRecorder.stop();
      } catch {
        // Safe closure
      }
    }

    setTimeout(() => {
      const notes = [...this.recordingNotesTape];
      if (notes.length === 0) {
        this.midiStatusMessage.set('تنبيه: لا يوجد نغمات مسجلة');
        return;
      }

      const activeInst = this.activeInstrument();
      const randomizedStr = `تسجيل ياماها ${this.recordedSessions().length + 1} (${this.voicesDef[activeInst]?.arabicName || 'عزف'})`;
      const dateEgypt = new Date().toLocaleTimeString('ar-EG', { hour: 'numeric', minute: '2-digit' }) + ' ' + new Date().toLocaleDateString('ar-EG');
      
      const newSession: RecordingSession = {
        id: 'rec_' + Date.now(),
        name: randomizedStr,
        timestamp: dateEgypt,
        notes,
        bpm: this.tempoBpm(),
        scaleName: this.activeScalePreset(),
        instrumentName: activeInst
      };

      const updated = [newSession, ...this.recordedSessions()];
      this.recordedSessions.set(updated);
      
      if (this.isBrowser) {
        localStorage.setItem('yamaha_mnorg_tape', JSON.stringify(updated));
      }
      this.midiStatusMessage.set('تم حفظ المعزوفة في الخزنة');
    }, 150);
  }

  deleteRecordedSession(id: string, event: Event) {
    event.stopPropagation();
    const filtered = this.recordedSessions().filter(s => s.id !== id);
    this.recordedSessions.set(filtered);
    if (this.isBrowser) {
      localStorage.setItem('yamaha_mnorg_tape', JSON.stringify(filtered));
    }
    if (this.activeRecordedSessionId() === id) {
      this.activeRecordedSessionId.set(null);
    }
  }

  playRecordedSession(session: RecordingSession) {
    this.stopPlaybackSequence();
    this.tempoBpm.set(session.bpm);
    this.applyScalePreset(session.scaleName);
    this.activeInstrument.set(session.instrumentName);

    this.isRecording.set(false);
    this.activeRecordedSessionId.set(session.id);

    session.notes.forEach(evt => {
      const timer = setTimeout(() => {
        if (evt.type === 'ON') {
          this.playNoteManual(evt.midi);
        } else {
          this.stopNoteManual(evt.midi);
        }
      }, evt.time);
      this.playbackTimers.push(timer);
    });

    const maxTime = session.notes.length > 0 ? session.notes[session.notes.length - 1].time : 0;
    const endTimer = setTimeout(() => {
      this.stopPlaybackSequence();
    }, maxTime + 1000);
    this.playbackTimers.push(endTimer);
  }

  stopPlaybackSequence() {
    this.playbackTimers.forEach(t => clearTimeout(t));
    this.playbackTimers = [];
    this.activeRecordedSessionId.set(null);
    this.activeNotesMap.set({});
    this.stopAllVoicesOscillators();
  }

  async exportSessionAudioFile(session: RecordingSession, event: Event) {
    event.stopPropagation();
    if (!session.notes || session.notes.length === 0) {
      this.midiStatusMessage.set('تنبيه: لا توجد نغمات في هذه المعزوفة');
      return;
    }

    this.midiStatusMessage.set('جاري تصدير ملف WAV عالي الجودة... ⏳');

    try {
      // 1. Calculate length
      const lastEventTime = session.notes.length > 0 ? session.notes[session.notes.length - 1].time : 0;
      const totalDurationSec = (lastEventTime + 1800) / 1000; // adding 1.8s tail margin for release/reverb
      const sampleRate = 44100;
      
      const offlineCtx = new OfflineAudioContext(2, Math.ceil(sampleRate * totalDurationSec), sampleRate);

      // 2. Set up offline nodes mimics real-time acoustics (EQ, Master volume scale, delay & convolutions)
      const masterGain = offlineCtx.createGain();
      masterGain.gain.setValueAtTime(this.masterVolume(), 0);

      const eqLowNode = offlineCtx.createBiquadFilter();
      eqLowNode.type = 'lowshelf';
      eqLowNode.frequency.setValueAtTime(220, 0);
      eqLowNode.gain.setValueAtTime(this.eqLow(), 0);

      const eqMidNode = offlineCtx.createBiquadFilter();
      eqMidNode.type = 'peaking';
      eqMidNode.frequency.setValueAtTime(1500, 0);
      eqMidNode.Q.setValueAtTime(1.0, 0);
      eqMidNode.gain.setValueAtTime(this.eqMid(), 0);

      const eqHighNode = offlineCtx.createBiquadFilter();
      eqHighNode.type = 'highshelf';
      eqHighNode.frequency.setValueAtTime(6000, 0);
      eqHighNode.gain.setValueAtTime(this.eqHigh(), 0);

      masterGain.connect(eqLowNode);
      eqLowNode.connect(eqMidNode);
      eqMidNode.connect(eqHighNode);

      const compressor = offlineCtx.createDynamicsCompressor();
      compressor.threshold.setValueAtTime(-14, 0);
      compressor.ratio.setValueAtTime(8, 0);
      compressor.attack.setValueAtTime(0.003, 0);
      compressor.release.setValueAtTime(0.15, 0);

      // Reverb routing in offlineCtx
      const reverbNode = offlineCtx.createConvolver();
      reverbNode.buffer = this.createReverbBufferChannelForOffline(offlineCtx);
      const reverbDryNode = offlineCtx.createGain();
      const reverbWetNode = offlineCtx.createGain();
      const wetGainVal = this.reverb() ? this.reverbWet() : 0.0;
      reverbDryNode.gain.setValueAtTime(Math.cos(wetGainVal * 0.5 * Math.PI), 0);
      reverbWetNode.gain.setValueAtTime(Math.sin(wetGainVal * 0.5 * Math.PI) * 1.2, 0);

      eqHighNode.connect(reverbDryNode);
      reverbDryNode.connect(compressor);

      eqHighNode.connect(reverbNode);
      reverbNode.connect(reverbWetNode);
      reverbWetNode.connect(compressor);

      // Delay routing in offlineCtx
      const delayNode = offlineCtx.createDelay(2.0);
      delayNode.delayTime.setValueAtTime(this.delayLevel() * 1.5, 0);
      const delayFeedbackNode = offlineCtx.createGain();
      delayFeedbackNode.gain.setValueAtTime(this.delayFeedback(), 0);

      delayNode.connect(delayFeedbackNode);
      delayFeedbackNode.connect(delayNode);

      eqHighNode.connect(delayNode);
      delayNode.connect(compressor);

      compressor.connect(offlineCtx.destination);

      // 3. Map starting timestamps and match note endings (ON / OFF pairing)
      const noteStartTimes: Record<number, { startTime: number; velocity?: number }[]> = {};
      const sortedNotes = [...session.notes].sort((a, b) => a.time - b.time);

      sortedNotes.forEach(evt => {
        const timeSec = evt.time / 1000;
        if (evt.type === 'ON') {
          if (!noteStartTimes[evt.midi]) {
            noteStartTimes[evt.midi] = [];
          }
          noteStartTimes[evt.midi].push({ startTime: timeSec, velocity: 0.85 });
        } else {
          const starts = noteStartTimes[evt.midi];
          if (starts && starts.length > 0) {
            const startInfo = starts.shift()!;
            const duration = Math.max(0.05, timeSec - startInfo.startTime);
            this.scheduleOfflineNote(
              offlineCtx,
              evt.midi,
              startInfo.startTime,
              duration,
              session.instrumentName,
              masterGain,
              startInfo.velocity || 0.85
            );
          }
        }
      });

      // Handle raw nodes with missing OFF key sequences gracefully (stopped before release)
      Object.keys(noteStartTimes).forEach(midiStr => {
        const midiNum = parseInt(midiStr, 10);
        const starts = noteStartTimes[midiNum];
        if (starts && starts.length > 0) {
          starts.forEach(startInfo => {
            const duration = Math.max(0.2, totalDurationSec - 1.0 - startInfo.startTime);
            if (duration > 0) {
              this.scheduleOfflineNote(
                offlineCtx,
                midiNum,
                startInfo.startTime,
                duration,
                session.instrumentName,
                masterGain,
                startInfo.velocity || 0.85
              );
            }
          });
        }
      });

      // 4. Render the whole scene
      const renderedBuffer = await offlineCtx.startRendering();

      // 5. Convert Web Audio buffer to a high-fidelity 16-bit stereo WAV PCM
      const wavBlob = this.bufferToWav(renderedBuffer);

      // 6. Initiate download
      const url = URL.createObjectURL(wavBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${session.name.replace(/\s+/g, '_')}_yamaha_high_res.wav`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      this.midiStatusMessage.set('تصدير WAV ناجح: تم تسليم الملف!');
    } catch (e) {
      console.error('Failed to export high-quality wav file', e);
      this.midiStatusMessage.set('فشل تصدير WAV عالي الجودة');
    }
  }

  exportDataJson() {
    if (this.recordedSessions().length === 0) {
      this.midiStatusMessage.set('المخزن فارغ');
      return;
    }
    try {
      const json = JSON.stringify(this.recordedSessions(), null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `yamaha_mn_org24_vault_${Date.now()}.json`;
      a.click();
      this.midiStatusMessage.set('تم تصدير البيانات بنجاح 📤');
    } catch {
      this.midiStatusMessage.set('فشل تصدير البيانات');
    }
  }

  importDataJson() {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.json';
    inp.onchange = (e) => {
      const target = e.target as HTMLInputElement;
      const file = target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const data = JSON.parse(ev.target?.result as string);
          if (Array.isArray(data)) {
            this.recordedSessions.set(data);
            if (this.isBrowser) {
              localStorage.setItem('yamaha_mnorg_tape', JSON.stringify(data));
            }
            this.midiStatusMessage.set(`تم استيراد ${data.length} معزوفة 📥`);
          } else {
            this.midiStatusMessage.set('ملف غير صالح');
          }
        } catch {
          this.midiStatusMessage.set('فشل الاستيراد');
        }
      };
      reader.readAsText(file);
    };
    inp.click();
  }

  // --- DRUM SEQUENCE REAL-TIME WAVE VISUALIZER ---
  private drawVisualizerSpectrum() {
    if (!this.isBrowser || !this.analyser || !this.visualizerCanvas) {
      if (this.enginePower()) {
        this.visualizerAnimationFrameId = requestAnimationFrame(() => this.drawVisualizerSpectrum());
      }
      return;
    }

    const canvas = this.visualizerCanvas.nativeElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    
    const bufferLength = this.analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    
    const draw = () => {
      if (!this.enginePower() || !this.analyser) {
        // Draw centered line in amber
        ctx.fillStyle = '#101511';
        ctx.fillRect(0, 0, width, height);
        ctx.strokeStyle = '#c8a84e40';
        ctx.beginPath();
        ctx.moveTo(0, height / 2);
        ctx.lineTo(width, height / 2);
        ctx.stroke();
        return;
      }

      this.visualizerAnimationFrameId = requestAnimationFrame(draw);
      this.analyser.getByteTimeDomainData(dataArray);

      ctx.fillStyle = '#0f1f10'; // pure phosphor background (Yamaha display layout)
      ctx.fillRect(0, 0, width, height);

      // Draw horizontal phosphor grids
      ctx.strokeStyle = '#1e301e';
      ctx.lineWidth = 1;
      for (let i = 0; i < width; i += 20) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i, height);
        ctx.stroke();
      }
      for (let j = 0; j < height; j += 15) {
        ctx.beginPath();
        ctx.moveTo(0, j);
        ctx.lineTo(width, j);
        ctx.stroke();
      }

      // Draw actual signal waves in vibrant vintage phosphor green
      ctx.lineWidth = 32;
      ctx.strokeStyle = '#3fbf3f15'; // wide halo bloom
      ctx.beginPath();
      
      const sliceWidth = width * 1.0 / bufferLength;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        const v = dataArray[i] / 128.0;
        const y = v * height / 2;

        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
        x += sliceWidth;
      }
      ctx.stroke();

      // Sharp central wave line
      ctx.lineWidth = 2.0;
      ctx.strokeStyle = '#3fbf3f'; // bright phosphor green
      ctx.shadowBlur = 10;
      ctx.shadowColor = '#3fbf3f';
      
      ctx.beginPath();
      x = 0;
      for (let i = 0; i < bufferLength; i++) {
        const v = dataArray[i] / 128.0;
        const y = v * height / 2;

        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
        x += sliceWidth;
      }
      ctx.stroke();
      
      ctx.shadowBlur = 0; // reset
    };

    draw();
  }

  // --- REAL-TIME PITCH SPECTRUM ANALYZER FLOW ---
  private drawPitchSpectrum() {
    if (!this.isBrowser || !this.pitchAnalyser || !this.pitchSpectrumCanvas) {
      if (this.enginePower()) {
        this.pitchAnimationFrameId = requestAnimationFrame(() => this.drawPitchSpectrum());
      }
      return;
    }

    const canvas = this.pitchSpectrumCanvas.nativeElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    
    const bufferLength = this.pitchAnalyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    const sampleRate = this.audioContext?.sampleRate || 44100;
    
    const maxFreqDisplay = 8000;
    const binResolution = sampleRate / (bufferLength * 2);
    const maxBinDisplay = Math.min(bufferLength, Math.ceil(maxFreqDisplay / binResolution));

    const draw = () => {
      if (!this.enginePower() || !this.pitchAnalyser) {
        ctx.fillStyle = '#0a0d0b';
        ctx.fillRect(0, 0, width, height);
        ctx.strokeStyle = '#18241b';
        ctx.lineWidth = 1;
        
        ctx.beginPath();
        ctx.moveTo(0, height / 2);
        ctx.lineTo(width, height / 2);
        ctx.stroke();
        return;
      }

      this.pitchAnimationFrameId = requestAnimationFrame(draw);
      this.pitchAnalyser.getByteFrequencyData(dataArray);

      ctx.fillStyle = '#0a0d0b';
      ctx.fillRect(0, 0, width, height);

      ctx.strokeStyle = '#18241b';
      ctx.lineWidth = 1;
      ctx.fillStyle = '#4c7c58';
      ctx.font = '7px monospace';
      
      const gridFrequencies = [100, 200, 500, 1000, 2000, 4000, 6000, 8000];
      gridFrequencies.forEach(freq => {
        const binIndex = freq / binResolution;
        if (binIndex <= maxBinDisplay) {
          const x = (binIndex / maxBinDisplay) * width;
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, height);
          ctx.stroke();
          
          ctx.fillText(freq >= 1000 ? `${(freq/1000).toFixed(0)}kHz` : `${freq}Hz`, x + 2, height - 4);
        }
      });

      ctx.strokeStyle = '#121c15';
      for (let y = height / 4; y < height; y += height / 4) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }

      const gradient = ctx.createLinearGradient(0, height, 0, 0);
      gradient.addColorStop(0, '#10301a00');
      gradient.addColorStop(0.5, '#22c55e25');
      gradient.addColorStop(1, '#22c55e60');

      ctx.fillStyle = gradient;
      ctx.strokeStyle = '#22c55e';
      ctx.lineWidth = 1.5;

      ctx.beginPath();
      ctx.moveTo(0, height);

      for (let i = 0; i < maxBinDisplay; i++) {
        const x = (i / (maxBinDisplay - 1)) * width;
        const val = dataArray[i] / 255.0;
        const scaleVal = Math.pow(val, 1.2);
        const y = height - (scaleVal * (height - 15));
        ctx.lineTo(x, y);
      }
      ctx.lineTo(width, height);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      const peaks: { index: number; value: number }[] = [];
      const peakThreshold = 45;
      
      for (let i = 2; i < maxBinDisplay - 2; i++) {
        const val = dataArray[i];
        if (val > peakThreshold) {
          if (val > dataArray[i-1] && val > dataArray[i-2] && val > dataArray[i+1] && val > dataArray[i+2]) {
            peaks.push({ index: i, value: val });
          }
        }
      }

      peaks.sort((a, b) => b.value - a.value);

      const distinctPeaks: { index: number; value: number; frequency: number }[] = [];
      for (const p of peaks) {
        const freq = p.index * binResolution;
        const isTooClose = distinctPeaks.some(dp => Math.abs(dp.frequency - freq) < 60);
        if (!isTooClose) {
          distinctPeaks.push({ ...p, frequency: freq });
        }
        if (distinctPeaks.length >= 4) break;
      }

      distinctPeaks.forEach((p, idx) => {
        const x = (p.index / (maxBinDisplay - 1)) * width;
        const val = p.value / 255.0;
        const scaleVal = Math.pow(val, 1.2);
        const y = height - (scaleVal * (height - 15));

        ctx.setLineDash([2, 3]);
        ctx.strokeStyle = idx === 0 ? '#fbbf2480' : '#22c55e60';
        ctx.beginPath();
        ctx.moveTo(x, height);
        ctx.lineTo(x, y);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = idx === 0 ? '#fbbf24' : '#22c55e';
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, 2 * Math.PI);
        ctx.fill();

        const noteName = this.getNoteNameFromFrequency(p.frequency);
        const labelStr = `${p.frequency.toFixed(0)}Hz (${noteName})`;
        
        ctx.fillStyle = idx === 0 ? '#fbbf24' : '#a7f3d0';
        ctx.font = 'bold 8px monospace';
        const labelWidth = ctx.measureText(labelStr).width;
        let labelX = x - labelWidth / 2;
        if (labelX < 2) labelX = 2;
        if (labelX + labelWidth > width - 2) labelX = width - labelWidth - 2;
        
        ctx.fillText(labelStr, labelX, Math.max(10, y - 5));
      });

      const mappedPeaks = distinctPeaks.map(p => ({
        frequency: Math.round(p.frequency),
        note: this.getNoteNameFromFrequency(p.frequency),
        amplitude: Math.round((p.value / 255) * 100)
      }));

      if (mappedPeaks.length > 0) {
        const prevPeaks = this.dominantPeaks();
        const hasChanged = prevPeaks.length !== mappedPeaks.length || 
          mappedPeaks.some((p, i) => Math.abs(p.frequency - (prevPeaks[i]?.frequency || 0)) > 10);
        
        if (hasChanged) {
          this.dominantPeaks.set(mappedPeaks);
        }
      } else if (this.dominantPeaks().length > 0) {
        this.dominantPeaks.set([]);
      }
    };

    draw();
  }

  getNoteNameFromFrequency(freq: number): string {
    if (freq < 16) return '--';
    const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const noteNum = Math.round(12 * Math.log2(freq / 440) + 69);
    const noteIndex = (noteNum % 12 + 12) % 12;
    const octave = Math.floor(noteNum / 12) - 1;
    return `${notes[noteIndex]}${octave}`;
  }

  // --- KEYBOARDS USER-INTERFACE EVENTS BINDERS ---
  onKeyMouseDown(key: KeyState, event: MouseEvent) {
    event.preventDefault();
    this.isMouseDownOnKeys = true;
    
    let simulatedVelocity = 0.85;
    if (this.velocitySensitive() && event.currentTarget) {
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
      const clickY = event.clientY - rect.top;
      const normalizedY = Math.max(0, Math.min(1, clickY / rect.height));
      // Lower section of key yields higher/stronger strike velocity mapping (0.35 to 1.0)
      simulatedVelocity = 0.35 + 0.65 * normalizedY;
    }
    
    this.playNoteManual(key.midi, simulatedVelocity);
  }

  onKeyMouseEnter(key: KeyState) {
    if (this.isMouseDownOnKeys) {
      this.playNoteManual(key.midi);
    }
  }

  onKeyMouseLeave(key: KeyState) {
    if (this.isMouseDownOnKeys) {
      this.stopNoteManual(key.midi);
    }
  }

  onKeyMouseUp(key: KeyState) {
    this.isMouseDownOnKeys = false;
    this.stopNoteManual(key.midi);
  }

  onKeyTouchStart(key: KeyState, event: TouchEvent) {
    event.preventDefault();
    
    let simulatedVelocity = 0.85;
    if (this.velocitySensitive() && event.touches && event.touches.length > 0 && event.currentTarget) {
      const touch = event.touches[0];
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
      const touchY = touch.clientY - rect.top;
      const normalizedY = Math.max(0, Math.min(1, touchY / rect.height));
      simulatedVelocity = 0.35 + 0.65 * normalizedY;
    }
    
    this.playNoteManual(key.midi, simulatedVelocity);
  }

  onKeyTouchEnd(key: KeyState, event: TouchEvent) {
    event.preventDefault();
    this.stopNoteManual(key.midi);
  }

  // ==========================================
  // --- GRAPHICAL DRUM SEQUENCE CANVAS ---
  // ==========================================
  @ViewChild('drawingCanvas', { static: false }) drawingCanvas?: ElementRef<HTMLCanvasElement>;
  isDrawingModalOpen = signal<boolean>(false);
  drawingBrush = signal<'pencil' | 'eraser' | 'sine' | 'scatter'>('pencil');
  readonly drawingTracks = ['openHat', 'closedHat', 'snare', 'kick'];

  private renderLoopActive = false;
  private isDrawingOnCanvas = false;
  private drawActionState = true; // true = paint/draw, false = erase
  private lastDrawnCol = -1;
  private lastDrawnRow = -1;

  hoverCol = -1;
  hoverRow = -1;

  openDrawingModal() {
    this.isDrawingModalOpen.set(true);
    this.midiStatusMessage.set('🎨 تم فتح لوحة الرسم الرسومي للإيقاع');
    
    // Defer initialization to allow Angular to render the modal backdrop and canvas element first
    setTimeout(() => {
      this.renderLoopActive = true;
      this.startDrawingRenderLoop();
    }, 150);
  }

  closeDrawingModal() {
    this.isDrawingModalOpen.set(false);
    this.renderLoopActive = false;
    this.isDrawingOnCanvas = false;
  }

  onBackdropClick(event: Event) {
    if (event.target === event.currentTarget) {
      this.closeDrawingModal();
    }
  }

  private startDrawingRenderLoop() {
    const frame = () => {
      if (!this.renderLoopActive) return;
      this.drawOnCanvas();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  private drawRoundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    if (w < 2 * r) r = w / 2;
    if (h < 2 * r) r = h / 2;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  drawOnCanvas() {
    if (!this.drawingCanvas) return;
    const canvas = this.drawingCanvas.nativeElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Responsive Canvas dimensions synchronization
    const rect = canvas.getBoundingClientRect();
    if (canvas.width !== Math.round(rect.width) || canvas.height !== Math.round(rect.height)) {
      canvas.width = Math.round(rect.width);
      canvas.height = Math.round(rect.height);
    }

    const W = canvas.width;
    const H = canvas.height;

    // Clear background
    ctx.fillStyle = '#040604';
    ctx.fillRect(0, 0, W, H);

    const labelWidth = 75;
    const colW = (W - labelWidth) / 16;
    const rowH = H / 4;

    // 1. Draw alternating sequence beat sections
    for (let s = 0; s < 16; s++) {
      const startX = labelWidth + s * colW;
      const beatGroup = Math.floor(s / 4);
      if (beatGroup % 2 === 0) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.012)';
        ctx.fillRect(startX, 0, colW, H);
      }
    }

    // 2. Draw grid background lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
    ctx.lineWidth = 1;
    // Vertical grid column dividers
    for (let s = 1; s < 16; s++) {
      const startX = labelWidth + s * colW;
      ctx.beginPath();
      ctx.moveTo(startX, 0);
      ctx.lineTo(startX, H);
      ctx.stroke();
    }
    // Horizontal row dividers
    for (let r = 1; r < 4; r++) {
      ctx.beginPath();
      ctx.moveTo(labelWidth, r * rowH);
      ctx.lineTo(W, r * rowH);
      ctx.stroke();
    }

    // 3. Render Channel Strip sidebar panels
    ctx.fillStyle = '#020302';
    ctx.fillRect(0, 0, labelWidth, H);
    // Draw boundary line
    ctx.strokeStyle = 'rgba(196, 164, 74, 0.2)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(labelWidth, 0);
    ctx.lineTo(labelWidth, H);
    ctx.stroke();

    for (let r = 0; r < 4; r++) {
      const track = this.drawingTracks[r];
      let nameAr = 'طبل دُم';
      let nameEn = 'BASS KICK';
      if (track === 'snare') {
        nameAr = 'جَرْ تيك';
        nameEn = 'DARB TAK';
      } else if (track === 'closedHat') {
        nameAr = 'صاج حديد';
        nameEn = 'C-HAT';
      } else if (track === 'openHat') {
        nameAr = 'تنّ رنين';
        nameEn = 'O-HAT';
      }

      const textY = r * rowH + rowH / 2;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      // Arabic Label
      ctx.fillStyle = '#ffd485';
      ctx.font = 'bold 11px sans-serif';
      ctx.fillText(nameAr, labelWidth / 2, textY - 6);

      // English subtitle
      ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
      ctx.font = '7px monospace';
      ctx.fillText(nameEn, labelWidth / 2, textY + 8);
    }

    // 4. Render Trigger pads and active sequences
    const stepsData = this.drumSequencerMatrix();
    const offsetsData = this.drumSequencerOffsets();
    const playbackStep = this.activeSequencerStep();
    const isPlaying = this.activeRhythm() === 'stepSequencer';
    const isQuantized = this.drumQuantize();

    for (let r = 0; r < 4; r++) {
      const track = this.drawingTracks[r];
      const stepsList = stepsData[track] || Array(16).fill(false);
      const trackOffsets = offsetsData[track] || Array(16).fill(0);

      // Style configurations per track
      let colorGlow = '#e07818'; // orange (kick)
      if (track === 'snare') {
        colorGlow = '#f43f5e'; // pink/red (snare)
      } else if (track === 'closedHat') {
        colorGlow = '#10b981'; // emerald/green
      } else if (track === 'openHat') {
        colorGlow = '#06b6d4'; // cyan/blue
      }

      for (let s = 0; s < 16; s++) {
        const x_base = labelWidth + s * colW + 3;
        const w_base = colW - 6;

        // Custom micro-timing displacement
        const stepOffsetPercent = isQuantized ? 0.0 : (trackOffsets[s] || 0.0);
        const x = x_base + stepOffsetPercent * w_base;
        const y = r * rowH + 3;
        const w = w_base;
        const h = rowH - 6;

        if (stepsList[s]) {
          // Draw a faint backdrop container at the quantized grid standard boundaries
          if (stepOffsetPercent !== 0) {
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
            ctx.lineWidth = 1;
            this.drawRoundedRect(ctx, x_base, y, w_base, h, 4);
            ctx.stroke();
          }

          ctx.save();
          // Glow effect
          ctx.shadowColor = colorGlow;
          ctx.shadowBlur = 8;
          ctx.fillStyle = colorGlow;
          this.drawRoundedRect(ctx, x, y, w, h, 4);
          ctx.fill();
          ctx.restore();

          // Shiny highlights sheen line
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(x + 2, y + 2);
          ctx.lineTo(x + w - 2, y + 2);
          ctx.stroke();

          // Draw connector guides to visualize unquantized offsets
          if (stepOffsetPercent !== 0) {
            ctx.fillStyle = '#ffd485';
            ctx.beginPath();
            ctx.arc(x_base + w_base / 2, y + h - 5, 2, 0, Math.PI * 2);
            ctx.fill();

            ctx.strokeStyle = 'rgba(196, 164, 74, 0.45)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x_base + w_base / 2, y + h - 5);
            ctx.lineTo(x + w / 2, y + h - 5);
            ctx.stroke();
          }
        } else {
          // Empty Pad
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
          ctx.lineWidth = 1;
          this.drawRoundedRect(ctx, x_base, y, w_base, h, 4);
          ctx.stroke();

          // Faint dot inside center
          ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
          ctx.beginPath();
          ctx.arc(x_base + w_base / 2, y + h / 2, 1.5, 0, Math.PI * 2);
          ctx.fill();
        }

        // Active sweep animation highlight overlay on current step
        if (isPlaying && playbackStep === s) {
          ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
          this.drawRoundedRect(ctx, x_base - 1.5, y - 1.5, w_base + 3, h + 3, 5);
          ctx.fill();
        }

        // Current Cell Hover highlight
        if (this.hoverCol === s && this.hoverRow === r) {
          ctx.strokeStyle = 'rgba(196, 164, 74, 0.45)';
          ctx.lineWidth = 1.5;
          this.drawRoundedRect(ctx, x_base, y, w_base, h, 4);
          ctx.stroke();
        }
      }
    }

    // 5. Draw flowing neon playhead vertical sweep bar
    if (isPlaying) {
      const sweepX = labelWidth + playbackStep * colW;
      ctx.save();
      // Glowing bar
      ctx.fillStyle = 'rgba(52, 211, 153, 0.08)';
      ctx.fillRect(sweepX, 0, colW, H);

      // Neon vertical wire
      ctx.strokeStyle = '#34d399';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(sweepX, 0);
      ctx.lineTo(sweepX, H);
      ctx.stroke();
      ctx.restore();
    }
  }

  // Mouse / Touch Event Actions
  onCanvasMouseDown(event: MouseEvent) {
    if (!this.drawingCanvas) return;
    this.saveDrumHistory();
    this.isDrawingOnCanvas = true;

    const canvas = this.drawingCanvas.nativeElement;
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const logicalX = x * scaleX;
    const logicalY = y * scaleY;

    const labelWidth = 75;
    if (logicalX >= labelWidth && logicalX < canvas.width) {
      const col = Math.floor(((logicalX - labelWidth) / (canvas.width - labelWidth)) * 16);
      const row = Math.floor((logicalY / canvas.height) * 4);

      if (col >= 0 && col < 16 && row >= 0 && row < 4) {
        const track = this.drawingTracks[row];
        const currentMatrix = this.drumSequencerMatrix();
        const currentVal = currentMatrix[track][col];

        if (this.drawingBrush() === 'eraser') {
          this.drawActionState = false;
        } else if (this.drawingBrush() === 'pencil') {
          this.drawActionState = !currentVal;
        } else {
          this.drawActionState = true;
        }

        this.applyBrushAction(col, row, logicalX);
        this.lastDrawnCol = col;
        this.lastDrawnRow = row;
      }
    }
  }

  onCanvasMouseMove(event: MouseEvent) {
    if (!this.drawingCanvas) return;
    const canvas = this.drawingCanvas.nativeElement;
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const logicalX = x * scaleX;
    const logicalY = y * scaleY;

    const labelWidth = 75;
    if (logicalX >= labelWidth && logicalX < canvas.width) {
      const col = Math.floor(((logicalX - labelWidth) / (canvas.width - labelWidth)) * 16);
      const row = Math.floor((logicalY / canvas.height) * 4);

      if (col >= 0 && col < 16 && row >= 0 && row < 4) {
        this.hoverCol = col;
        this.hoverRow = row;

        if (this.isDrawingOnCanvas) {
          if (col !== this.lastDrawnCol || row !== this.lastDrawnRow) {
            this.applyBrushAction(col, row, logicalX);
            this.lastDrawnCol = col;
            this.lastDrawnRow = row;
          }
        }
      } else {
        this.hoverCol = -1;
        this.hoverRow = -1;
      }
    } else {
      this.hoverCol = -1;
      this.hoverRow = -1;
    }
  }

  onCanvasMouseUp() {
    this.isDrawingOnCanvas = false;
    this.lastDrawnCol = -1;
    this.lastDrawnRow = -1;
  }

  onCanvasMouseLeave() {
    this.isDrawingOnCanvas = false;
    this.hoverCol = -1;
    this.hoverRow = -1;
  }

  onCanvasTouchStart(event: TouchEvent) {
    if (!this.drawingCanvas || event.touches.length === 0) return;
    event.preventDefault();
    this.saveDrumHistory();
    this.isDrawingOnCanvas = true;

    const canvas = this.drawingCanvas.nativeElement;
    const rect = canvas.getBoundingClientRect();
    const touch = event.touches[0];
    const x = touch.clientX - rect.left;
    const y = touch.clientY - rect.top;

    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const logicalX = x * scaleX;
    const logicalY = y * scaleY;

    const labelWidth = 75;
    if (logicalX >= labelWidth && logicalX < canvas.width) {
      const col = Math.floor(((logicalX - labelWidth) / (canvas.width - labelWidth)) * 16);
      const row = Math.floor((logicalY / canvas.height) * 4);

      if (col >= 0 && col < 16 && row >= 0 && row < 4) {
        const track = this.drawingTracks[row];
        const currentMatrix = this.drumSequencerMatrix();
        const currentVal = currentMatrix[track][col];

        this.drawActionState = this.drawingBrush() === 'eraser' ? false : !currentVal;

        this.applyBrushAction(col, row, logicalX);
        this.lastDrawnCol = col;
        this.lastDrawnRow = row;
      }
    }
  }

  onCanvasTouchMove(event: TouchEvent) {
    if (!this.drawingCanvas || event.touches.length === 0) return;
    event.preventDefault();

    const canvas = this.drawingCanvas.nativeElement;
    const rect = canvas.getBoundingClientRect();
    const touch = event.touches[0];
    const x = touch.clientX - rect.left;
    const y = touch.clientY - rect.top;

    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const logicalX = x * scaleX;
    const logicalY = y * scaleY;

    const labelWidth = 75;
    if (logicalX >= labelWidth && logicalX < canvas.width) {
      const col = Math.floor(((logicalX - labelWidth) / (canvas.width - labelWidth)) * 16);
      const row = Math.floor((logicalY / canvas.height) * 4);

      if (col >= 0 && col < 16 && row >= 0 && row < 4) {
        this.hoverCol = col;
        this.hoverRow = row;

        if (this.isDrawingOnCanvas) {
          if (col !== this.lastDrawnCol || row !== this.lastDrawnRow) {
            this.applyBrushAction(col, row, logicalX);
            this.lastDrawnCol = col;
            this.lastDrawnRow = row;
          }
        }
      } else {
        this.hoverCol = -1;
        this.hoverRow = -1;
      }
    } else {
      this.hoverCol = -1;
      this.hoverRow = -1;
    }
  }

  onCanvasTouchEnd() {
    this.isDrawingOnCanvas = false;
    this.lastDrawnCol = -1;
    this.lastDrawnRow = -1;
  }

  applyBrushAction(col: number, row: number, logicalX?: number) {
    const track = this.drawingTracks[row];
    const currentMatrix = this.drumSequencerMatrix();
    const updatedTrack = [...currentMatrix[track]];

    if (this.drawingBrush() === 'sine') {
      this.generateSineWavePattern();
      return;
    } else if (this.drawingBrush() === 'scatter') {
      const updated = { ...currentMatrix };
      const updatedOffsets = { ...this.drumSequencerOffsets() };
      for (let r = 0; r < 4; r++) {
        const t = this.drawingTracks[r];
        const list = [...currentMatrix[t]];
        const offsetList = [...updatedOffsets[t]];
        if (Math.abs(r - row) <= 1 && Math.random() > 0.45) {
          list[col] = true;
          offsetList[col] = 0.0;
          this.playTrackSound(t);
        }
        updated[t] = list;
        updatedOffsets[t] = offsetList;
      }
      this.drumSequencerMatrix.set(updated);
      this.drumSequencerOffsets.set(updatedOffsets);
      return;
    }

    // Pencil / Eraser
    const val = this.drawActionState;
    if (updatedTrack[col] !== val) {
      updatedTrack[col] = val;
      this.drumSequencerMatrix.set({
        ...currentMatrix,
        [track]: updatedTrack
      });

      const currentOffsets = this.drumSequencerOffsets();
      const updatedOffsetTrack = [...currentOffsets[track]];

      if (val && !this.drumQuantize() && logicalX !== undefined && this.drawingCanvas) {
        const canvas = this.drawingCanvas.nativeElement;
        const labelWidth = 75;
        const colW = (canvas.width - labelWidth) / 16;
        const startX = labelWidth + col * colW;
        const center = startX + colW / 2;
        let customOffset = (logicalX - center) / colW;
        if (customOffset < -0.42) customOffset = -0.42;
        if (customOffset > 0.42) customOffset = 0.42;
        updatedOffsetTrack[col] = customOffset;
      } else {
        updatedOffsetTrack[col] = 0.0;
      }

      this.drumSequencerOffsets.set({
        ...currentOffsets,
        [track]: updatedOffsetTrack
      });

      if (val) {
        this.playTrackSound(track);
      }
    } else if (val && !this.drumQuantize() && logicalX !== undefined && this.drawingCanvas) {
      // If the cell was already active, update its micro-timing offset on drag/click
      const currentOffsets = this.drumSequencerOffsets();
      const updatedOffsetTrack = [...currentOffsets[track]];
      const canvas = this.drawingCanvas.nativeElement;
      const labelWidth = 75;
      const colW = (canvas.width - labelWidth) / 16;
      const startX = labelWidth + col * colW;
      const center = startX + colW / 2;
      let customOffset = (logicalX - center) / colW;
      if (customOffset < -0.42) customOffset = -0.42;
      if (customOffset > 0.42) customOffset = 0.42;

      if (updatedOffsetTrack[col] !== customOffset) {
        updatedOffsetTrack[col] = customOffset;
        this.drumSequencerOffsets.set({
          ...currentOffsets,
          [track]: updatedOffsetTrack
        });
      }
    }
  }

  playTrackSound(track: string) {
    if (!this.audioContext) {
      this.initEngine();
    }
    const time = this.audioContext ? this.audioContext.currentTime : 0;
    this.triggerSequencerSound(track, time);
  }

  generateSineWavePattern() {
    this.saveDrumHistory();
    const updated: Record<string, boolean[]> = {
      kick: Array(16).fill(false),
      snare: Array(16).fill(false),
      closedHat: Array(16).fill(false),
      openHat: Array(16).fill(false)
    };

    const updatedOffsets: Record<string, number[]> = {
      kick: Array(16).fill(0),
      snare: Array(16).fill(0),
      closedHat: Array(16).fill(0),
      openHat: Array(16).fill(0)
    };

    for (let col = 0; col < 16; col++) {
      const angle = (col / 15) * Math.PI * 2;
      const norm = (Math.sin(angle) + 1) / 2; // 0 to 1
      const row = Math.min(3, Math.floor(norm * 4));
      const trackName = this.drawingTracks[row];
      updated[trackName][col] = true;
      updatedOffsets[trackName][col] = 0.0;
    }

    this.drumSequencerMatrix.set(updated);
    this.drumSequencerOffsets.set(updatedOffsets);
    this.playTrackSound('kick');
    this.midiStatusMessage.set('🌊 تم رسم ورسم موجة جيبية متناغمة للإيقاع');
  }

  generateRandomScatterPattern() {
    this.saveDrumHistory();
    const updated: Record<string, boolean[]> = {
      kick: Array(16).fill(false),
      snare: Array(16).fill(false),
      closedHat: Array(16).fill(false),
      openHat: Array(16).fill(false)
    };

    const updatedOffsets: Record<string, number[]> = {
      kick: Array(16).fill(0),
      snare: Array(16).fill(0),
      closedHat: Array(16).fill(0),
      openHat: Array(16).fill(0)
    };

    for (let col = 0; col < 16; col++) {
      for (const trackName of this.drawingTracks) {
        if (Math.random() < 0.22) {
          updated[trackName][col] = true;
          // Unquantized mode adds slight random swing to scatter notes
          if (!this.drumQuantize()) {
            updatedOffsets[trackName][col] = (Math.random() * 0.4) - 0.2;
          } else {
            updatedOffsets[trackName][col] = 0.0;
          }
        }
      }
    }

    this.drumSequencerMatrix.set(updated);
    this.drumSequencerOffsets.set(updatedOffsets);
    this.playTrackSound('snare');
    this.midiStatusMessage.set('🎲 تم توزيع الإيقاعات هندسياً بصورة عشوائية');
  }

  invertMatrix() {
    this.saveDrumHistory();
    const current = this.drumSequencerMatrix();
    const updated: Record<string, boolean[]> = {
      kick: [], snare: [], closedHat: [], openHat: []
    };

    for (const trackName of this.drawingTracks) {
      updated[trackName] = current[trackName].map(val => !val);
    }

    this.drumSequencerMatrix.set(updated);
    this.playTrackSound('closedHat');
    this.midiStatusMessage.set('🔄 تم عكس خلايا الإيقاعات بالكامل');
  }

  shiftMatrix(direction: 'left' | 'right') {
    this.saveDrumHistory();
    const current = this.drumSequencerMatrix();
    const updated: Record<string, boolean[]> = {
      kick: [], snare: [], closedHat: [], openHat: []
    };

    const currentOffsets = this.drumSequencerOffsets();
    const updatedOffsets: Record<string, number[]> = {
      kick: [], snare: [], closedHat: [], openHat: []
    };

    for (const trackName of this.drawingTracks) {
      const original = [...current[trackName]];
      const origOffsets = [...currentOffsets[trackName]];

      if (direction === 'left') {
        const item = original.shift() ?? false;
        original.push(item);

        const itemOffset = origOffsets.shift() ?? 0.0;
        origOffsets.push(itemOffset);
      } else {
        const item = original.pop() ?? false;
        original.unshift(item);

        const itemOffset = origOffsets.pop() ?? 0.0;
        origOffsets.unshift(itemOffset);
      }
      updated[trackName] = original;
      updatedOffsets[trackName] = origOffsets;
    }

    this.drumSequencerMatrix.set(updated);
    this.drumSequencerOffsets.set(updatedOffsets);
    this.playTrackSound('closedHat');
    this.midiStatusMessage.set(direction === 'left' ? '◀️ تم ترحيل النبض لليسار' : '▶️ تم ترحيل النبض لليمين');
  }

  toggleDrumQuantize() {
    const newVal = !this.drumQuantize();
    this.drumQuantize.set(newVal);
    if (newVal) {
      this.quantizeExistingDrums();
      this.midiStatusMessage.set('⚡ تمت محاذاة كافة نغمات الإيقاع إلى الخط المرجعي للشبكة 1/16');
    } else {
      this.midiStatusMessage.set('🔓 تم تحرير المحاذاة التلقائية! اسحب لرسم إيقاع حر (Micro-timing)');
    }
  }

  quantizeExistingDrums() {
    this.saveDrumHistory();
    this.drumSequencerOffsets.set({
      kick: Array(16).fill(0),
      snare: Array(16).fill(0),
      closedHat: Array(16).fill(0),
      openHat: Array(16).fill(0)
    });
  }

  saveDrumHistory() {
    const currentMatrix = this.drumSequencerMatrix();
    const currentOffsets = this.drumSequencerOffsets();

    const copiedMatrix: Record<string, boolean[]> = {};
    const copiedOffsets: Record<string, number[]> = {};

    for (const k of Object.keys(currentMatrix)) {
      copiedMatrix[k] = [...currentMatrix[k]];
    }
    for (const k of Object.keys(currentOffsets)) {
      copiedOffsets[k] = [...currentOffsets[k]];
    }

    const history = [...this.drumHistory()];

    // Safety duplicate checker to keep stack clean
    if (history.length > 0) {
      const top = history[history.length - 1];
      let identical = true;
      for (const k of Object.keys(copiedMatrix)) {
        if (!top.matrix[k] || top.matrix[k].length !== copiedMatrix[k].length) {
          identical = false;
          break;
        }
        for (let i = 0; i < copiedMatrix[k].length; i++) {
          if (top.matrix[k][i] !== copiedMatrix[k][i]) {
            identical = false;
            break;
          }
        }
        if (!identical) break;
      }
      if (identical) {
        for (const k of Object.keys(copiedOffsets)) {
          if (!top.offsets[k] || top.offsets[k].length !== copiedOffsets[k].length) {
            identical = false;
            break;
          }
          for (let i = 0; i < copiedOffsets[k].length; i++) {
            if (top.offsets[k][i] !== copiedOffsets[k][i]) {
              identical = false;
              break;
            }
          }
          if (!identical) break;
        }
      }
      if (identical) {
        return;
      }
    }

    history.push({ matrix: copiedMatrix, offsets: copiedOffsets });
    if (history.length > 50) {
      history.shift();
    }
    this.drumHistory.set(history);
  }

  undoDrumAction() {
    const history = [...this.drumHistory()];
    if (history.length === 0) return;

    const previousState = history.pop()!;
    this.drumHistory.set(history);

    const copiedMatrix: Record<string, boolean[]> = {};
    const copiedOffsets: Record<string, number[]> = {};

    for (const k of Object.keys(previousState.matrix)) {
      copiedMatrix[k] = [...previousState.matrix[k]];
    }
    for (const k of Object.keys(previousState.offsets)) {
      copiedOffsets[k] = [...previousState.offsets[k]];
    }

    this.drumSequencerMatrix.set(copiedMatrix);
    this.drumSequencerOffsets.set(copiedOffsets);
    this.midiStatusMessage.set('↩️ تم التراجع عن الخطوة السابقة للإيقاع');
    this.playTrackSound('closedHat');
  }

  // --- TRIGGER SEQUENCER ROUTED KITS ---
  triggerSequencerSound(track: string, time: number) {
    const kit = this.selectedSequencerKit();
    if (kit === 'arabic') {
      if (track === 'kick') this.synthesizeDarbukaDum(time);
      else if (track === 'snare') this.synthesizeDarbukaTak(time);
      else if (track === 'closedHat') this.synthesizeRiqShaker(time);
      else if (track === 'openHat') this.synthesizeDarbukaSak(time);
    } else if (kit === 'acoustic') {
      if (track === 'kick') this.synthesizeAcousticKick(time);
      else if (track === 'snare') this.synthesizeAcousticSnare(time);
      else if (track === 'closedHat') this.synthesizeAcousticClosedHat(time);
      else if (track === 'openHat') this.synthesizeAcousticOpenHat(time);
    } else if (kit === 'scifi') {
      if (track === 'kick') this.synthesizeSciFiKick(time);
      else if (track === 'snare') this.synthesizeSciFiSnare(time);
      else if (track === 'closedHat') this.synthesizeSciFiClosedHat(time);
      else if (track === 'openHat') this.synthesizeSciFiOpenHat(time);
    } else { // '808' default
      if (track === 'kick') this.synthesizeDrumKick(time);
      else if (track === 'snare') this.synthesizeDrumSnare(time);
      else if (track === 'closedHat') this.synthesizeDrumClosedHat(time);
      else if (track === 'openHat') this.synthesizeDrumOpenHat(time);
    }
  }

  // --- NEW DRUM SYNTHESIS ENGINES FOR CUSTOM DIGI PADS & SEQUENCERS ---
  synthesizeDarbukaSak(time: number, pitch = 1.0, volume = 1.0) {
    if (!this.audioContext || !this.masterGain) return;
    const osc = this.audioContext.createOscillator();
    const gain = this.audioContext.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(450 * pitch, time);
    osc.frequency.exponentialRampToValueAtTime(150, time + 0.05);

    gain.gain.setValueAtTime(0.001, time);
    gain.gain.linearRampToValueAtTime(0.6 * volume, time + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.08);

    const size = this.audioContext.sampleRate * 0.05;
    const noiseBuffer = this.audioContext.createBuffer(1, size, this.audioContext.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < size; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    const noiseNode = this.audioContext.createBufferSource();
    noiseNode.buffer = noiseBuffer;
    
    const filter = this.audioContext.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(6000, time);
    
    const gainNoise = this.audioContext.createGain();
    gainNoise.gain.setValueAtTime(0.4 * volume, time);
    gainNoise.gain.exponentialRampToValueAtTime(0.001, time + 0.035);

    noiseNode.connect(filter);
    filter.connect(gainNoise);
    gainNoise.connect(this.masterGain);

    osc.connect(gain);
    gain.connect(this.masterGain);

    noiseNode.start(time);
    noiseNode.stop(time + 0.05);
    osc.start(time);
    osc.stop(time + 0.09);
  }

  synthesizeDarbukaKa(time: number, pitch = 1.0, volume = 1.0) {
    if (!this.audioContext || !this.masterGain) return;
    const osc = this.audioContext.createOscillator();
    const gain = this.audioContext.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(800 * pitch, time);
    osc.frequency.exponentialRampToValueAtTime(320, time + 0.04);

    gain.gain.setValueAtTime(0.001, time);
    gain.gain.linearRampToValueAtTime(0.5 * volume, time + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.06);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(time);
    osc.stop(time + 0.07);
  }

  synthesizeDarbukaRoll(time: number, pitch = 1.0, volume = 1.0) {
    this.synthesizeDarbukaTak(time, pitch, volume * 0.8);
    this.synthesizeDarbukaTak(time + 0.04, pitch * 0.9, volume * 0.6);
    this.synthesizeDarbukaTak(time + 0.08, pitch * 1.1, volume * 1.0);
  }

  synthesizeDarbukaSlap(time: number, pitch = 1.0, volume = 1.0) {
    if (!this.audioContext || !this.masterGain) return;
    const osc = this.audioContext.createOscillator();
    const gain = this.audioContext.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(1000 * pitch, time);
    osc.frequency.exponentialRampToValueAtTime(120, time + 0.09);

    gain.gain.setValueAtTime(0.001, time);
    gain.gain.linearRampToValueAtTime(0.8 * volume, time + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.12);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(time);
    osc.stop(time + 0.14);
  }

  synthesizeDarbukaTap(time: number, pitch = 1.0, volume = 1.0) {
    if (!this.audioContext || !this.masterGain) return;
    const osc = this.audioContext.createOscillator();
    const gain = this.audioContext.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(320 * pitch, time);

    gain.gain.setValueAtTime(0.001, time);
    gain.gain.linearRampToValueAtTime(0.4 * volume, time + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.05);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(time);
    osc.stop(time + 0.06);
  }

  synthesizeDrumClap(time: number, pitch = 1.0, volume = 1.0) {
    if (!this.audioContext || !this.masterGain) return;
    const size = this.audioContext.sampleRate * 0.08;
    const buffer = this.audioContext.createBuffer(1, size, this.audioContext.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < size; i++) {
       data[i] = Math.random() * 2 - 1;
    }

    const triggerClapBurst = (delay: number, amp: number) => {
      const source = this.audioContext!.createBufferSource();
      source.buffer = buffer;
      const gainNode = this.audioContext!.createGain();
      gainNode.gain.setValueAtTime(amp * volume, time + delay);
      gainNode.gain.exponentialRampToValueAtTime(0.001, time + delay + 0.035 * pitch);

      const filter = this.audioContext!.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(1100, time + delay);

      source.connect(filter);
      filter.connect(gainNode);
      gainNode.connect(this.masterGain!);
      source.start(time + delay);
      source.stop(time + delay + 0.05);
    };

    triggerClapBurst(0, 0.45);
    triggerClapBurst(0.012, 0.35);
    triggerClapBurst(0.024, 0.65);
  }

  synthesizeDrumCowbell(time: number, pitch = 1.0, volume = 1.0) {
    if (!this.audioContext || !this.masterGain) return;
    const osc1 = this.audioContext.createOscillator();
    const osc2 = this.audioContext.createOscillator();
    
    osc1.type = 'square';
    osc1.frequency.setValueAtTime(800 * pitch, time);
    
    osc2.type = 'square';
    osc2.frequency.setValueAtTime(540 * pitch, time);

    const filter = this.audioContext.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(800, time);

    const gain = this.audioContext.createGain();
    gain.gain.setValueAtTime(0.001, time);
    gain.gain.linearRampToValueAtTime(0.4 * volume, time + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.12 * pitch);

    osc1.connect(filter);
    osc2.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);

    osc1.start(time);
    osc2.start(time);
    osc1.stop(time + 0.14);
    osc2.stop(time + 0.14);
  }

  synthesizeDrumLaserZap(time: number, pitch = 1.0, volume = 1.0) {
    if (!this.audioContext || !this.masterGain) return;
    const osc = this.audioContext.createOscillator();
    const gain = this.audioContext.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(1800 * pitch, time);
    osc.frequency.exponentialRampToValueAtTime(80 * pitch, time + 0.11);

    gain.gain.setValueAtTime(0.001, time);
    gain.gain.linearRampToValueAtTime(0.6 * volume, time + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.13);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(time);
    osc.stop(time + 0.15);
  }

  synthesizeDrumSubBass(time: number, pitch = 1.0, volume = 1.0) {
    if (!this.audioContext || !this.masterGain) return;
    const osc = this.audioContext.createOscillator();
    const gain = this.audioContext.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(55 * pitch, time);
    osc.frequency.exponentialRampToValueAtTime(25, time + 0.4);

    gain.gain.setValueAtTime(0.001, time);
    gain.gain.linearRampToValueAtTime(0.85 * volume, time + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.45);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(time);
    osc.stop(time + 0.48);
  }

  synthesizeAcousticKick(time: number) {
    this.synthesizeDrumKick(time, 0.75, 1.25);
  }

  synthesizeAcousticSnare(time: number) {
    if (!this.audioContext || !this.masterGain) return;
    const osc = this.audioContext.createOscillator();
    const gain = this.audioContext.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(180, time);
    gain.gain.setValueAtTime(0.5, time);
    gain.gain.exponentialRampToValueAtTime(0.01, time + 0.08);

    const size = this.audioContext.sampleRate * 0.12;
    const buffer = this.audioContext.createBuffer(1, size, this.audioContext.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < size; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    const noise = this.audioContext.createBufferSource();
    noise.buffer = buffer;
    const filter = this.audioContext.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(2500, time);

    const noiseGain = this.audioContext.createGain();
    noiseGain.gain.setValueAtTime(0.45, time);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, time + 0.1);

    osc.connect(gain);
    gain.connect(this.masterGain);
    
    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(this.masterGain);

    osc.start(time);
    noise.start(time);
    osc.stop(time + 0.12);
    noise.stop(time + 0.12);
  }

  synthesizeAcousticClosedHat(time: number) {
    this.synthesizeDrumClosedHat(time, 1.25, 0.65);
  }

  synthesizeAcousticOpenHat(time: number) {
    this.synthesizeDrumOpenHat(time, 0.95, 0.75);
  }

  synthesizeSciFiKick(time: number) {
    if (!this.audioContext || !this.masterGain) return;
    const osc = this.audioContext.createOscillator();
    const gain = this.audioContext.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(120, time);
    osc.frequency.exponentialRampToValueAtTime(40, time + 0.15);

    gain.gain.setValueAtTime(0.001, time);
    gain.gain.linearRampToValueAtTime(0.7, time + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.16);

    const filter = this.audioContext.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(320, time);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    osc.start(time);
    osc.stop(time + 0.18);
  }

  synthesizeSciFiSnare(time: number) {
    if (!this.audioContext || !this.masterGain) return;
    const osc = this.audioContext.createOscillator();
    const gain = this.audioContext.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(280, time);
    osc.frequency.linearRampToValueAtTime(140, time + 0.05);

    gain.gain.setValueAtTime(0.45, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.08);

    const filter = this.audioContext.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1200, time);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    osc.start(time);
    osc.stop(time + 0.1);
  }

  synthesizeSciFiClosedHat(time: number) {
    if (!this.audioContext || !this.masterGain) return;
    const osc = this.audioContext.createOscillator();
    const gain = this.audioContext.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(4000, time);
    osc.frequency.exponentialRampToValueAtTime(12000, time + 0.015);

    gain.gain.setValueAtTime(0.2, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.02);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(time);
    osc.stop(time + 0.035);
  }

  synthesizeSciFiOpenHat(time: number) {
    if (!this.audioContext || !this.masterGain) return;
    const osc = this.audioContext.createOscillator();
    const gain = this.audioContext.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(8000, time);
    osc.frequency.linearRampToValueAtTime(2000, time + 0.18);

    const filter = this.audioContext.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(3000, time);

    gain.gain.setValueAtTime(0.18, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.22);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    osc.start(time);
    osc.stop(time + 0.25);
  }

  // --- PLAY DRUM SOUND VOICES ---
  playDrumSound(soundKey: string, time?: number, padId?: number) {
    if (!this.audioContext || !this.masterGain) return;
    const playTime = time ?? this.audioContext.currentTime;

    // Check custom audio buffers
    if (padId && this.padBuffers[padId]) {
      this.playCustomAudioBuffer(this.padBuffers[padId], playTime, padId);
      return;
    }

    // Read pitch & volume from pad list if triggered manually to customize synthesisers
    let pitchVal = 1.0;
    let volumeVal = 1.0;
    if (padId) {
      const padObj = this.drumPadsList().find(p => p.id === padId);
      if (padObj) {
        pitchVal = padObj.pitch;
        volumeVal = padObj.volume;
      }
    }

    switch (soundKey) {
      case 'darbuka_dum':
        this.synthesizeDarbukaDum(playTime);
        break;
      case 'darbuka_tak':
        this.synthesizeDarbukaTak(playTime);
        break;
      case 'darbuka_sak':
        this.synthesizeDarbukaSak(playTime, pitchVal, volumeVal);
        break;
      case 'riq_shaker':
        this.synthesizeRiqShaker(playTime);
        break;
      case 'darbuka_ka':
        this.synthesizeDarbukaKa(playTime, pitchVal, volumeVal);
        break;
      case 'darbuka_roll':
        this.synthesizeDarbukaRoll(playTime, pitchVal, volumeVal);
        break;
      case 'darbuka_slap':
        this.synthesizeDarbukaSlap(playTime, pitchVal, volumeVal);
        break;
      case 'darbuka_tap':
        this.synthesizeDarbukaTap(playTime, pitchVal, volumeVal);
        break;
      case 'kick_classic':
        this.synthesizeDrumKick(playTime);
        break;
      case 'snare_classic':
        this.synthesizeDrumSnare(playTime);
        break;
      case 'closed_hat':
        this.synthesizeDrumClosedHat(playTime);
        break;
      case 'open_hat':
        this.synthesizeDrumOpenHat(playTime);
        break;
      case 'clap':
        this.synthesizeDrumClap(playTime, pitchVal, volumeVal);
        break;
      case 'cowbell':
        this.synthesizeDrumCowbell(playTime, pitchVal, volumeVal);
        break;
      case 'laser_zap':
        this.synthesizeDrumLaserZap(playTime, pitchVal, volumeVal);
        break;
      case 'sub_bass':
        this.synthesizeDrumSubBass(playTime, pitchVal, volumeVal);
        break;
      // Acoustic Kit
      case 'acoustic_kick':
        this.synthesizeAcousticKick(playTime);
        break;
      case 'acoustic_snare':
        this.synthesizeAcousticSnare(playTime);
        break;
      case 'acoustic_closed':
        this.synthesizeAcousticClosedHat(playTime);
        break;
      case 'acoustic_open':
        this.synthesizeAcousticOpenHat(playTime);
        break;
      // Sci-Fi Kit
      case 'scifi_kick':
        this.synthesizeSciFiKick(playTime);
        break;
      case 'scifi_snare':
        this.synthesizeSciFiSnare(playTime);
        break;
      case 'scifi_closed':
        this.synthesizeSciFiClosedHat(playTime);
        break;
      case 'scifi_open':
        this.synthesizeSciFiOpenHat(playTime);
        break;
      default:
        this.synthesizeDrumKick(playTime);
    }
  }

  playCustomAudioBuffer(buffer: AudioBuffer, time: number, padId: number) {
    if (!this.audioContext || !this.masterGain) return;
    const source = this.audioContext.createBufferSource();
    source.buffer = buffer;

    const pads = this.drumPadsList();
    const pad = pads.find(p => p.id === padId);
    const volume = pad ? pad.volume : 1.0;
    const pitch = pad ? pad.pitch : 1.0;

    const gainNode = this.audioContext.createGain();
    gainNode.gain.setValueAtTime(volume, time);
    source.playbackRate.setValueAtTime(pitch, time);

    source.connect(gainNode);
    gainNode.connect(this.masterGain);
    source.start(time);
  }

  // --- INITIALIZE & PRESET PACK LOADER ---
  initDefaultDrumPads() {
    const defaultPads = [
      { id: 1, name: 'Dum / دوم', soundKey: 'darbuka_dum', volume: 0.9, pitch: 1.0, activeFlag: false },
      { id: 2, name: 'Tak / تك', soundKey: 'darbuka_tak', volume: 0.85, pitch: 1.0, activeFlag: false },
      { id: 3, name: 'Sak / صك', soundKey: 'darbuka_sak', volume: 0.8, pitch: 1.0, activeFlag: false },
      { id: 4, name: 'Riq / صاج', soundKey: 'riq_shaker', volume: 0.75, pitch: 1.0, activeFlag: false },
      { id: 5, name: 'Ka / كا', soundKey: 'darbuka_ka', volume: 0.8, pitch: 1.0, activeFlag: false },
      { id: 6, name: 'Roll / دح', soundKey: 'darbuka_roll', volume: 0.8, pitch: 1.0, activeFlag: false },
      { id: 7, name: 'Slap / لطمة', soundKey: 'darbuka_slap', volume: 0.85, pitch: 1.0, activeFlag: false },
      { id: 8, name: 'Tap / نقرة', soundKey: 'darbuka_tap', volume: 0.7, pitch: 1.0, activeFlag: false },
      { id: 9, name: 'Kick / دم', soundKey: 'kick_classic', volume: 0.95, pitch: 1.0, activeFlag: false },
      { id: 10, name: 'Snare / صفق', soundKey: 'snare_classic', volume: 0.85, pitch: 1.0, activeFlag: false },
      { id: 11, name: 'Hat / صاج', soundKey: 'closed_hat', volume: 0.75, pitch: 1.0, activeFlag: false },
      { id: 12, name: 'Open / مفتوح', soundKey: 'open_hat', volume: 0.7, pitch: 1.0, activeFlag: false },
      { id: 13, name: 'Clap / تصفيق', soundKey: 'clap', volume: 0.8, pitch: 1.0, activeFlag: false },
      { id: 14, name: 'Cowbell / جرس', soundKey: 'cowbell', volume: 0.75, pitch: 1.0, activeFlag: false },
      { id: 15, name: 'Laser / شعاع', soundKey: 'laser_zap', volume: 0.8, pitch: 1.0, activeFlag: false },
      { id: 16, name: 'Sub Drop / هبوط', soundKey: 'sub_bass', volume: 0.9, pitch: 1.0, activeFlag: false }
    ];
    this.drumPadsList.set(defaultPads);
  }

  // --- DRUM PAD ACTIONS ---
  triggerPad(padId: number, event?: Event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    if (!this.enginePower()) {
      this.initEngine();
    }
    const pads = this.drumPadsList();
    const pad = pads.find(p => p.id === padId);
    if (!pad) return;

    // Trigger visual flash
    const updated = pads.map(p => {
      if (p.id === padId) {
        return { ...p, activeFlag: true };
      }
      return p;
    });
    this.drumPadsList.set(updated);
    setTimeout(() => {
      const resetPads = this.drumPadsList().map(p => {
        if (p.id === padId) {
          return { ...p, activeFlag: false };
        }
        return p;
      });
      this.drumPadsList.set(resetPads);
    }, 120);

    // Play sound
    this.playDrumSound(pad.soundKey, undefined, padId);
  }

  selectPadForEditing(padId: number) {
    this.selectedDrumPad.set(padId);
  }

  updatePadVolume(padId: number, val: string | number) {
    const num = typeof val === 'string' ? parseFloat(val) : val;
    const updated = this.drumPadsList().map(p => {
      if (p.id === padId) {
        return { ...p, volume: num };
      }
      return p;
    });
    this.drumPadsList.set(updated);
  }

  updatePadPitch(padId: number, val: string | number) {
    const num = typeof val === 'string' ? parseFloat(val) : val;
    const updated = this.drumPadsList().map(p => {
      if (p.id === padId) {
        return { ...p, pitch: num };
      }
      return p;
    });
    this.drumPadsList.set(updated);
  }

  updatePadSoundMapping(padId: number, soundKey: string) {
    const updated = this.drumPadsList().map(p => {
      if (p.id === padId) {
        return { ...p, soundKey, customName: undefined }; // Reset custom uploaded samples if preset changed
      }
      return p;
    });
    this.drumPadsList.set(updated);
  }

  onCustomPadSampleUpload(event: Event, padId: number) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      const file = input.files[0];
      if (!this.audioContext) {
        this.initEngine();
      }
      if (!this.audioContext) return;

      const reader = new FileReader();
      reader.onload = (e) => {
        const arrayBuffer = e.target?.result as ArrayBuffer;
        this.audioContext!.decodeAudioData(arrayBuffer, (decodedBuffer) => {
          this.padBuffers[padId] = decodedBuffer;
          
          const pads = this.drumPadsList();
          const updated = pads.map(p => {
            if (p.id === padId) {
              return {
                ...p,
                soundKey: 'custom_sample_' + padId,
                customName: file.name
              };
            }
            return p;
          });
          this.drumPadsList.set(updated);
          this.midiStatusMessage.set(`🎵 تم تحميل وحفظ العينة الصوتية: "${file.name}"`);
        }, () => {
          this.midiStatusMessage.set('⚠️ خطأ في فك ترميز ملف الصوت. تأكد من جودة WAV/MP3');
        });
      };
      reader.readAsArrayBuffer(file);
    }
  }

  loadPadKitPreset(kitType: string) {
    const pads = [...this.drumPadsList()];
    let updated = [...pads];
    if (kitType === 'arabic') {
      updated = [
        { id: 1, name: 'Dum / دوم', soundKey: 'darbuka_dum', volume: 0.9, pitch: 1.0, activeFlag: false },
        { id: 2, name: 'Tak / تك', soundKey: 'darbuka_tak', volume: 0.85, pitch: 1.0, activeFlag: false },
        { id: 3, name: 'Sak / صك', soundKey: 'darbuka_sak', volume: 0.8, pitch: 1.0, activeFlag: false },
        { id: 4, name: 'Riq / صاج', soundKey: 'riq_shaker', volume: 0.75, pitch: 1.0, activeFlag: false },
        { id: 5, name: 'Ka / كا', soundKey: 'darbuka_ka', volume: 0.8, pitch: 1.0, activeFlag: false },
        { id: 6, name: 'Roll / دح', soundKey: 'darbuka_roll', volume: 0.8, pitch: 1.0, activeFlag: false },
        { id: 7, name: 'Slap / لطمة', soundKey: 'darbuka_slap', volume: 0.85, pitch: 1.0, activeFlag: false },
        { id: 8, name: 'Tap / نقرة', soundKey: 'darbuka_tap', volume: 0.7, pitch: 1.0, activeFlag: false },
        { id: 9, name: 'Kick / دم', soundKey: 'kick_classic', volume: 0.95, pitch: 1.0, activeFlag: false },
        { id: 10, name: 'Snare / صفق', soundKey: 'snare_classic', volume: 0.85, pitch: 1.0, activeFlag: false },
        { id: 11, name: 'Hat / صاج', soundKey: 'closed_hat', volume: 0.75, pitch: 1.0, activeFlag: false },
        { id: 12, name: 'Open / مفتوح', soundKey: 'open_hat', volume: 0.7, pitch: 1.0, activeFlag: false },
        { id: 13, name: 'Clap / تصفيق', soundKey: 'clap', volume: 0.8, pitch: 1.0, activeFlag: false },
        { id: 14, name: 'Cowbell / جرس', soundKey: 'cowbell', volume: 0.75, pitch: 1.0, activeFlag: false },
        { id: 15, name: 'Laser / شعاع', soundKey: 'laser_zap', volume: 0.8, pitch: 1.0, activeFlag: false },
        { id: 16, name: 'Sub Drop / هبوط', soundKey: 'sub_bass', volume: 0.9, pitch: 1.0, activeFlag: false }
      ];
      this.padBuffers = {};
    } else if (kitType === '808') {
      updated = [
        { id: 1, name: '808 Kick', soundKey: 'kick_classic', volume: 0.95, pitch: 0.85, activeFlag: false },
        { id: 2, name: '808 Snare', soundKey: 'snare_classic', volume: 0.85, pitch: 1.0, activeFlag: false },
        { id: 3, name: '808 Clap', soundKey: 'clap', volume: 0.8, pitch: 1.0, activeFlag: false },
        { id: 4, name: 'Cowbell', soundKey: 'cowbell', volume: 0.75, pitch: 1.0, activeFlag: false },
        { id: 5, name: 'Closed Hat', soundKey: 'closed_hat', volume: 0.8, pitch: 1.0, activeFlag: false },
        { id: 6, name: 'Open Hat', soundKey: 'open_hat', volume: 0.7, pitch: 1.0, activeFlag: false },
        { id: 7, name: 'Low Tom', soundKey: 'kick_classic', volume: 0.8, pitch: 1.4, activeFlag: false },
        { id: 8, name: 'Rimshot', soundKey: 'darbuka_ka', volume: 0.85, pitch: 1.2, activeFlag: false },
        { id: 9, name: 'Sine Sub', soundKey: 'sub_bass', volume: 0.9, pitch: 0.9, activeFlag: false },
        { id: 10, name: 'Darbuka Dum', soundKey: 'darbuka_dum', volume: 0.8, pitch: 1.1, activeFlag: false },
        { id: 11, name: 'Darbuka Tak', soundKey: 'darbuka_tak', volume: 0.8, pitch: 1.1, activeFlag: false },
        { id: 12, name: 'Darbuka Sak', soundKey: 'darbuka_sak', volume: 0.75, pitch: 1.1, activeFlag: false },
        { id: 13, name: 'Riq Shaker', soundKey: 'riq_shaker', volume: 0.8, pitch: 1.0, activeFlag: false },
        { id: 14, name: 'Rim Wood', soundKey: 'darbuka_tap', volume: 0.8, pitch: 1.5, activeFlag: false },
        { id: 15, name: 'Laser Zap', soundKey: 'laser_zap', volume: 0.75, pitch: 1.0, activeFlag: false },
        { id: 16, name: 'Sub Drop', soundKey: 'sub_bass', volume: 0.8, pitch: 0.7, activeFlag: false }
      ];
      this.padBuffers = {};
    } else if (kitType === 'acoustic') {
      updated = [
        { id: 1, name: 'Rock Kick', soundKey: 'acoustic_kick', volume: 0.95, pitch: 1.0, activeFlag: false },
        { id: 2, name: 'Rock Snare', soundKey: 'acoustic_snare', volume: 0.9, pitch: 1.0, activeFlag: false },
        { id: 3, name: 'Closed Hat', soundKey: 'acoustic_closed', volume: 0.8, pitch: 1.0, activeFlag: false },
        { id: 4, name: 'Open Hat', soundKey: 'acoustic_open', volume: 0.7, pitch: 1.0, activeFlag: false },
        { id: 5, name: 'Hand Clap', soundKey: 'clap', volume: 0.85, pitch: 0.9, activeFlag: false },
        { id: 6, name: 'Cowbell', soundKey: 'cowbell', volume: 0.7, pitch: 0.85, activeFlag: false },
        { id: 7, name: 'Darbuka Dum', soundKey: 'darbuka_dum', volume: 0.7, pitch: 0.9, activeFlag: false },
        { id: 8, name: 'Darbuka Tak', soundKey: 'darbuka_tak', volume: 0.7, pitch: 0.9, activeFlag: false },
        { id: 9, name: 'Low Wood Block', soundKey: 'darbuka_tap', volume: 0.8, pitch: 0.9, activeFlag: false },
        { id: 10, name: 'High Wood Block', soundKey: 'darbuka_tap', volume: 0.8, pitch: 1.3, activeFlag: false },
        { id: 11, name: 'Def Hand Drum', soundKey: 'darbuka_dum', volume: 0.85, pitch: 0.7, activeFlag: false },
        { id: 12, name: 'Rimshot Click', soundKey: 'darbuka_ka', volume: 0.8, pitch: 1.4, activeFlag: false },
        { id: 13, name: 'Cymbal Shimmer', soundKey: 'acoustic_open', volume: 0.85, pitch: 0.75, activeFlag: false },
        { id: 14, name: 'Fingertip Tap', soundKey: 'darbuka_tap', volume: 0.75, pitch: 1.1, activeFlag: false },
        { id: 15, name: 'Laser Zap', soundKey: 'laser_zap', volume: 0.7, pitch: 1.2, activeFlag: false },
        { id: 16, name: 'Metal Bell', soundKey: 'cowbell', volume: 0.8, pitch: 1.3, activeFlag: false }
      ];
      this.padBuffers = {};
    } else if (kitType === 'scifi') {
      updated = [
        { id: 1, name: 'FM Bass Kick', soundKey: 'scifi_kick', volume: 0.95, pitch: 1.0, activeFlag: false },
        { id: 2, name: 'FM Metal Snare', soundKey: 'scifi_snare', volume: 0.9, pitch: 1.0, activeFlag: false },
        { id: 3, name: 'Resonant Hat', soundKey: 'scifi_closed', volume: 0.8, pitch: 1.0, activeFlag: false },
        { id: 4, name: 'FM Space Ring', soundKey: 'scifi_open', volume: 0.75, pitch: 1.0, activeFlag: false },
        { id: 5, name: 'Vocal Zap', soundKey: 'laser_zap', volume: 0.8, pitch: 0.7, activeFlag: false },
        { id: 6, name: 'Cyber Cowbell', soundKey: 'cowbell', volume: 0.8, pitch: 1.5, activeFlag: false },
        { id: 7, name: '808 Clap', soundKey: 'clap', volume: 0.85, pitch: 1.2, activeFlag: false },
        { id: 8, name: 'Friction Zap', soundKey: 'laser_zap', volume: 0.9, pitch: 1.8, activeFlag: false },
        { id: 9, name: 'Sine Sub Low', soundKey: 'sub_bass', volume: 0.95, pitch: 0.8, activeFlag: false },
        { id: 10, name: 'Arabic Dum Synth', soundKey: 'darbuka_dum', volume: 0.8, pitch: 0.8, activeFlag: false },
        { id: 11, name: 'Arabic Tak Synth', soundKey: 'darbuka_tak', volume: 0.8, pitch: 1.3, activeFlag: false },
        { id: 12, name: 'Retro Ping', soundKey: 'darbuka_ka', volume: 0.8, pitch: 1.8, activeFlag: false },
        { id: 13, name: 'Def Beam', soundKey: 'darbuka_dum', volume: 0.8, pitch: 0.5, activeFlag: false },
        { id: 14, name: 'Modulator Ring', soundKey: 'scifi_snare', volume: 0.8, pitch: 0.4, activeFlag: false },
        { id: 15, name: 'Heavy Laser', soundKey: 'laser_zap', volume: 0.85, pitch: 0.9, activeFlag: false },
        { id: 16, name: 'Retro Sub Drop', soundKey: 'sub_bass', volume: 0.8, pitch: 0.5, activeFlag: false }
      ];
      this.padBuffers = {};
    } else if (kitType === 'custom') {
      updated = pads.map(p => ({
        ...p,
        soundKey: 'kick_classic',
        customName: undefined
      }));
      this.padBuffers = {};
    }
    this.drumPadsList.set(updated);
    this.midiStatusMessage.set(`🥁 تم تفعيل طقم طبلة الـ ${kitType === 'arabic' ? 'Darbuka' : kitType === '808' ? 'TR-808' : kitType === 'acoustic' ? 'Rock' : 'SciFi'}!`);
  }

  // --- SAVE & LOAD SEQUENCES SYSTEM ---
  loadUserSavedSequences() {
    if (this.isBrowser) {
      const saved = localStorage.getItem('shanan_saved_sequences');
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          this.userSavedSequences.set(parsed);
        } catch {
          this.userSavedSequences.set([]);
        }
      } else {
        const initial = [
          {
            id: 'preset_dabke_pro',
            name: 'دبكة احترافية حماسية • Dabke Pro',
            date: '2026-06-16',
            matrix: {
              kick: [true, false, true, false, false, false, false, false, true, false, true, false, false, false, false, false],
              snare: [false, false, false, false, true, false, false, false, false, false, false, false, true, false, true, false],
              closedHat: [true, false, true, false, true, false, true, false, true, false, true, false, true, false, true, false],
              openHat: [false, false, false, true, false, false, false, false, false, false, false, true, false, false, false, true]
            },
            patternLength: 16,
            bpm: 125,
            kit: 'arabic'
          }
        ];
        this.userSavedSequences.set(initial);
        localStorage.setItem('shanan_saved_sequences', JSON.stringify(initial));
      }
    }
  }

  saveCurrentSequence(name: string) {
    if (!name.trim()) {
      this.midiStatusMessage.set('⚠️ الرجاء إدخال اسم لحفظ الإيقاع');
      return;
    }
    const currentList = this.userSavedSequences();
    const newSeq = {
      id: 'seq_' + Date.now(),
      name: name.trim(),
      date: new Date().toISOString().split('T')[0],
      matrix: JSON.parse(JSON.stringify(this.drumSequencerMatrix())),
      patternLength: this.sequencerPatternLength(),
      bpm: this.tempoBpm(),
      kit: this.selectedSequencerKit()
    };
    const updated = [newSeq, ...currentList];
    this.userSavedSequences.set(updated);
    if (this.isBrowser) {
      localStorage.setItem('shanan_saved_sequences', JSON.stringify(updated));
    }
    this.newSequenceName.set('');
    this.midiStatusMessage.set(`💾 تم بنجاح حفظ الإيقاع: "${name.trim()}"`);
  }

  loadUserSequence(seq: { name: string; bpm?: number; patternLength?: number; kit?: string; matrix: Record<string, boolean[]> }) {
    this.saveDrumHistory();
    this.drumSequencerMatrix.set({
      kick: [...seq.matrix['kick']],
      snare: [...seq.matrix['snare']],
      closedHat: [...seq.matrix['closedHat']],
      openHat: [...seq.matrix['openHat']]
    });
    this.sequencerPatternLength.set(seq.patternLength || 16);
    this.tempoBpm.set(seq.bpm || 110);
    this.selectedSequencerKit.set(seq.kit || '808');
    this.midiStatusMessage.set(`📂 تم تحميل الإيقاع بنجاح: "${seq.name}"`);
  }

  deleteUserSequence(id: string, event: Event) {
    event.stopPropagation();
    const updated = this.userSavedSequences().filter(s => s.id !== id);
    this.userSavedSequences.set(updated);
    if (this.isBrowser) {
      localStorage.setItem('shanan_saved_sequences', JSON.stringify(updated));
    }
    this.midiStatusMessage.set('🗑️ تم حذف الإيقاع Saved Sequence');
  }

  exportSequencesFile() {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(this.userSavedSequences(), null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", "shanan_pro_sequences.json");
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    this.midiStatusMessage.set('📥 تم تصدير ملف الإيقاعات المحفوظة (.json)');
  }

  importSequencesFile(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      const file = input.files[0];
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const imported = JSON.parse(e.target?.result as string);
          if (Array.isArray(imported)) {
            const merged = [...imported, ...this.userSavedSequences()];
            const dedupedObj: Record<string, {id: string, name: string, date: string, matrix: Record<string, boolean[]>, patternLength: number, bpm: number, kit: string}> = {};
            merged.forEach(item => { if (item.id) dedupedObj[item.id] = item; });
            const dedupedList = Object.values(dedupedObj);
            this.userSavedSequences.set(dedupedList);
            if (this.isBrowser) {
              localStorage.setItem('shanan_saved_sequences', JSON.stringify(dedupedList));
            }
            this.midiStatusMessage.set('📤 تم استيراد ودمج الإيقاعات بنجاح!');
          } else {
            this.midiStatusMessage.set('⚠️ ملف غير صالح لتنسيق الاستيراد');
          }
        } catch {
          this.midiStatusMessage.set('⚠️ خطأ في معالجة وقراءة ملف الإيقاعات');
        }
      };
      reader.readAsText(file);
    }
  }

  exportCustomKit() {
    const data = {
      pads: this.drumPadsList(),
    };
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(data, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", "custom_drum_kit.json");
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    this.midiStatusMessage.set('📥 تم تصدير طقم الطبول بنجاح (.json)');
  }

  importCustomKit(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      const file = input.files[0];
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const parsed = JSON.parse(e.target?.result as string);
          if (parsed && Array.isArray(parsed.pads)) {
            this.drumPadsList.set(parsed.pads);
            this.midiStatusMessage.set('📤 تم استيراد طقم الطبول بأكمله بنجاح!');
          } else {
            this.midiStatusMessage.set('⚠️ ملف طقم الطبول غير صالح للمعيار المطلوب');
          }
        } catch {
          this.midiStatusMessage.set('⚠️ خطأ في قراءة ملف تركيبة الطبول');
        }
      };
      reader.readAsText(file);
    }
  }
}

