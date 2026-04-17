const SAMPLE_URL = `${import.meta.env.BASE_URL}audio/piano-c3.ogg`;
const SAMPLE_ROOT_MIDI = 60;
const PREVIEW_ATTACK_SEC = 0.006;
const PREVIEW_RELEASE_SEC = 0.12;
const PREVIEW_MAX_NOTE_SEC = 2.8;
const PREVIEW_STAGGER_SEC = 0.01;
const PREVIEW_LOOP_START_SEC = 0.72;
const PREVIEW_LOOP_END_OFFSET_SEC = 0.28;
const PREVIEW_CLEANUP_DELAY_MS = Math.ceil((PREVIEW_RELEASE_SEC + 0.04) * 1000);

let audioContext: AudioContext | null = null;
let sampleBufferPromise: Promise<AudioBuffer> | null = null;
let activeNodes: AudioNode[] = [];
let activeSources: AudioBufferSourceNode[] = [];
let activeMasterGain: GainNode | null = null;

function getAudioContextCtor(): typeof AudioContext | null {
  if (typeof window === "undefined") {
    return null;
  }

  const extendedWindow = window as Window &
    typeof globalThis & {
      webkitAudioContext?: typeof AudioContext;
    };

  return extendedWindow.AudioContext ?? extendedWindow.webkitAudioContext ?? null;
}

async function ensureAudioContext(): Promise<AudioContext> {
  const AudioContextCtor = getAudioContextCtor();
  if (!AudioContextCtor) {
    throw new Error("Web Audio API is not available.");
  }

  if (!audioContext) {
    audioContext = new AudioContextCtor();
  }

  if (audioContext.state === "suspended") {
    await audioContext.resume();
  }

  return audioContext;
}

async function loadSampleBuffer(context: AudioContext): Promise<AudioBuffer> {
  if (!sampleBufferPromise) {
    sampleBufferPromise = fetch(SAMPLE_URL)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Failed to load preview sample: ${response.status}`);
        }

        return response.arrayBuffer();
      })
      .then((buffer) => context.decodeAudioData(buffer.slice(0)));
  }

  return sampleBufferPromise;
}

function scheduleSampleVoice(
  context: AudioContext,
  sampleBuffer: AudioBuffer,
  midiNote: number,
  startTime: number,
  destination: AudioNode,
  voiceLevel: number,
  voiceIndex: number,
  sustained: boolean,
): { nodes: AudioNode[]; source: AudioBufferSourceNode; endTime: number } {
  const playbackRate = 2 ** ((midiNote - SAMPLE_ROOT_MIDI) / 12);
  const source = context.createBufferSource();
  const gainNode = context.createGain();
  const toneFilter = context.createBiquadFilter();
  const bodyFilter = context.createBiquadFilter();
  const stereoPanner = context.createStereoPanner();
  const noteDuration = Math.min(PREVIEW_MAX_NOTE_SEC, sampleBuffer.duration / playbackRate);
  const fadeStart = Math.max(startTime + noteDuration - PREVIEW_RELEASE_SEC, startTime + 0.22);
  const endTime = startTime + noteDuration;

  source.buffer = sampleBuffer;
  source.playbackRate.setValueAtTime(playbackRate, startTime);
  if (sustained) {
    const loopStart = Math.min(PREVIEW_LOOP_START_SEC, Math.max(0.18, sampleBuffer.duration * 0.2));
    const loopEnd = Math.max(loopStart + 0.22, sampleBuffer.duration - PREVIEW_LOOP_END_OFFSET_SEC);
    source.loop = true;
    source.loopStart = Math.min(loopStart, Math.max(0.01, sampleBuffer.duration - 0.4));
    source.loopEnd = Math.min(loopEnd, Math.max(source.loopStart + 0.2, sampleBuffer.duration - 0.02));
  }

  toneFilter.type = "lowpass";
  toneFilter.frequency.setValueAtTime(
    Math.min(6200, Math.max(1800, 2800 * playbackRate ** 0.45)),
    startTime,
  );
  toneFilter.Q.value = 0.45;

  bodyFilter.type = "peaking";
  bodyFilter.frequency.setValueAtTime(
    Math.min(1100, Math.max(180, 260 * playbackRate ** 0.4)),
    startTime,
  );
  bodyFilter.Q.value = 0.8;
  bodyFilter.gain.setValueAtTime(3.5, startTime);

  stereoPanner.pan.setValueAtTime(Math.max(-0.35, Math.min(0.35, (voiceIndex - 1.5) * 0.14)), startTime);

  gainNode.gain.setValueAtTime(0.0001, startTime);
  gainNode.gain.exponentialRampToValueAtTime(voiceLevel, startTime + PREVIEW_ATTACK_SEC);
  if (sustained) {
    gainNode.gain.setValueAtTime(voiceLevel * 0.92, startTime + PREVIEW_ATTACK_SEC + 0.04);
  } else {
    gainNode.gain.setValueAtTime(voiceLevel, fadeStart);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, endTime);
  }

  source.connect(toneFilter);
  toneFilter.connect(bodyFilter);
  bodyFilter.connect(gainNode);
  gainNode.connect(stereoPanner);
  stereoPanner.connect(destination);

  source.start(startTime);
  if (!sustained) {
    source.stop(endTime + 0.02);
  }

  return {
    nodes: [gainNode, toneFilter, bodyFilter, stereoPanner],
    source,
    endTime,
  };
}

async function startPreviewPlayback(
  midiNotes: number[],
  volume: number,
  sustained: boolean,
): Promise<number> {
  if (midiNotes.length === 0) {
    return 0;
  }

  const context = await ensureAudioContext();
  const sampleBuffer = await loadSampleBuffer(context);
  stopChordPreview();

  const masterGain = context.createGain();
  const masterFilter = context.createBiquadFilter();
  const compressor = context.createDynamicsCompressor();
  const now = context.currentTime + 0.02;

  masterGain.gain.setValueAtTime(Math.max(0.0001, Math.min(1, volume)), now);
  masterFilter.type = "lowpass";
  masterFilter.frequency.setValueAtTime(7200, now);
  masterFilter.Q.value = 0.2;
  compressor.threshold.value = -18;
  compressor.knee.value = 20;
  compressor.ratio.value = 2.2;
  compressor.attack.value = 0.003;
  compressor.release.value = 0.18;

  masterGain.connect(masterFilter);
  masterFilter.connect(compressor);
  compressor.connect(context.destination);

  activeNodes = [masterGain, masterFilter, compressor];
  activeSources = [];
  activeMasterGain = masterGain;

  const sortedNotes = [...midiNotes].sort((left, right) => left - right);
  const voiceLevel = Math.min(0.36, 0.88 / Math.max(sortedNotes.length, 3));
  let latestEndTime = now;

  sortedNotes.forEach((midiNote, index) => {
    const scheduled = scheduleSampleVoice(
      context,
      sampleBuffer,
      midiNote,
      now + index * PREVIEW_STAGGER_SEC,
      masterGain,
      voiceLevel,
      index,
      sustained,
    );

    activeNodes.push(...scheduled.nodes);
    activeSources.push(scheduled.source);
    latestEndTime = Math.max(latestEndTime, scheduled.endTime);
  });

  return Math.ceil((latestEndTime - now) * 1000);
}

export async function playChordPreview(midiNotes: number[], volume = 0.72): Promise<number> {
  return startPreviewPlayback(midiNotes, volume, false);
}

export async function startHeldChordPreview(midiNotes: number[], volume = 0.72): Promise<void> {
  await startPreviewPlayback(midiNotes, volume, true);
}

export function stopChordPreview(): void {
  if (activeMasterGain && audioContext) {
    const now = audioContext.currentTime;
    activeMasterGain.gain.cancelScheduledValues(now);
    activeMasterGain.gain.setValueAtTime(Math.max(activeMasterGain.gain.value, 0.0001), now);
    activeMasterGain.gain.exponentialRampToValueAtTime(0.0001, now + PREVIEW_RELEASE_SEC);
  }

  const sourcesToStop = [...activeSources];
  const nodesToDisconnect = [...activeNodes];
  activeSources = [];
  activeNodes = [];
  activeMasterGain = null;

  window.setTimeout(() => {
    sourcesToStop.forEach((source) => {
      try {
        source.stop();
      } catch {
        // Ignore sources that have already been stopped naturally.
      }
    });

    nodesToDisconnect.forEach((node) => {
      try {
        node.disconnect();
      } catch {
        // Ignore nodes that are already disconnected.
      }
    });
  }, PREVIEW_CLEANUP_DELAY_MS);
}
