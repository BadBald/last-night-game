// Proximity voice chat, relayed through the authoritative game WebSocket.
//
// Why a relay instead of a WebRTC mesh: mobile carriers are frequently behind
// symmetric NAT/CGNAT, where STUN-only peer connections never connect and the
// free public TURN relays we could reach are either dead or require an account.
// The game server is already reachable from every player (that is how they are
// playing), so routing microphone audio through it is the one transport that
// always works on phones and PCs alike. It also avoids a 20-peer mesh.
//
// Audio path:
//   mic -> AudioContext -> ScriptProcessor -> downsample to 16 kHz mono PCM16
//        -> binary frame over the game WebSocket -> server fans out to nearby
//        survivors -> AudioBufferSource -> proximity GainNode -> speakers
//
// Voice is toggle-to-talk: setTalking(true/false) comes from the in-game mic
// button, the T key, or the phone. Nothing is transmitted while not talking.
// Proximity gain is applied per remote sender, so nearby voices are loud and
// distant ones fade out.

export interface VoiceSignalData {
  fromId: string;
  targetId: string;
  kind: 'offer' | 'answer' | 'ice';
  payload: unknown;
}

export interface VoiceChatCallbacks {
  sendSignal: (data: {
    targetId: string;
    kind: 'offer' | 'answer' | 'ice';
    payload: unknown;
  }) => void;
  sendState: (talking: boolean) => void;
  sendAudio: (frame: ArrayBuffer) => void;
  getSelfId: () => string | null;
  getRemoteIds: () => string[];
  getDistance: (remoteId: string) => number; // world units
}

const TARGET_SAMPLE_RATE = 16000;
const JITTER_BUFFER_SECONDS = 0.09;
const MAX_RANGE = 1800;
const FULL_RANGE = 250;

interface PlaybackState {
  gain: GainNode;
  nextTime: number;
  lastPacketAt: number;
}

export class VoiceChatManager {
  private callbacks: VoiceChatCallbacks;
  private localStream: MediaStream | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private silentGain: GainNode | null = null;
  private audioCtx: AudioContext | null = null;
  private talking = false;
  private enabled = false;
  private talkingState = new Map<string, boolean>();
  private playback = new Map<string, PlaybackState>();

  constructor(callbacks: VoiceChatCallbacks) {
    this.callbacks = callbacks;
  }

  public isEnabled() {
    return this.enabled;
  }

  public async enable() {
    this.ensureAudioContext();
    if (this.enabled) {
      await this.resumeAudio();
      return true;
    }
    try {
      if (!navigator.mediaDevices?.getUserMedia) return false;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
      this.localStream = stream;
      this.attachCaptureGraph();
      this.enabled = true;
      this.applyTrackState();
      await this.resumeAudio();
      return true;
    } catch (e) {
      console.warn('VoiceChat: mic permission denied', e);
      return false;
    }
  }

  public disable() {
    try {
      if (this.processor) {
        this.processor.onaudioprocess = null;
        this.processor.disconnect();
      }
    } catch {
      /* ignore */
    }
    try {
      this.sourceNode?.disconnect();
    } catch {
      /* ignore */
    }
    try {
      this.silentGain?.disconnect();
    } catch {
      /* ignore */
    }
    this.processor = null;
    this.sourceNode = null;
    this.silentGain = null;
    this.localStream?.getTracks().forEach((t) => t.stop());
    this.localStream = null;
    this.enabled = false;
    this.talking = false;
    this.talkingState.clear();
    for (const state of this.playback.values()) {
      try {
        state.gain.disconnect();
      } catch {
        /* ignore */
      }
    }
    this.playback.clear();
    try {
      void this.audioCtx?.close();
    } catch {
      /* ignore */
    }
    this.audioCtx = null;
  }

  /** Kept for API compatibility; the relay does not need per-peer setup. */
  public ensurePeer(_remoteId: string) {
    return null;
  }

  /** Kept for API compatibility; WebRTC signaling is no longer used. */
  public handleSignal(_data: VoiceSignalData) {
    /* no-op: voice is relayed over the game WebSocket */
  }

  public removePeer(remoteId: string) {
    const state = this.playback.get(remoteId);
    if (state) {
      try {
        state.gain.disconnect();
      } catch {
        /* ignore */
      }
      this.playback.delete(remoteId);
    }
    this.talkingState.delete(remoteId);
  }

  public setTalking(talking: boolean) {
    this.talking = talking;
    this.applyTrackState();
    if (talking) {
      this.ensureAudioContext();
      void this.resumeAudio();
    }
    this.callbacks.sendState(talking);
  }

  public isTalkingNow() {
    return this.talking;
  }

  public setPeerTalking(remoteId: string, talking: boolean) {
    this.talkingState.set(remoteId, talking);
    if (!talking) {
      const state = this.playback.get(remoteId);
      if (state) state.nextTime = 0;
    }
  }

  public getTalkingState(remoteId: string) {
    return this.talkingState.get(remoteId) || false;
  }

  /**
   * Must be called from a real user gesture. Browsers (especially mobile)
   * keep AudioContexts suspended until then.
   */
  public async resumeAudio() {
    const ctx = this.audioCtx;
    if (ctx?.state === 'suspended') {
      try {
        await ctx.resume();
      } catch {
        /* ignore */
      }
    }
  }

  /** Called for every relayed PCM frame from another survivor. */
  public handleAudio(fromId: string, pcm: Int16Array) {
    if (pcm.length < 16) return;
    const ctx = this.audioCtx ?? this.ensureAudioContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      void this.resumeAudio();
    }
    const now = ctx.currentTime;

    let state = this.playback.get(fromId);
    if (!state) {
      const gain = ctx.createGain();
      gain.gain.value = this.computeGain(this.callbacks.getDistance(fromId));
      gain.connect(ctx.destination);
      state = { gain, nextTime: now + JITTER_BUFFER_SECONDS, lastPacketAt: now };
      this.playback.set(fromId, state);
    }
    state.lastPacketAt = now;

    const samples = int16ToFloat32(pcm);
    const buffer = ctx.createBuffer(1, samples.length, TARGET_SAMPLE_RATE);
    buffer.getChannelData(0).set(samples);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(state.gain);

    const targetGain = this.computeGain(this.callbacks.getDistance(fromId));
    try {
      state.gain.gain.setTargetAtTime(targetGain, now, 0.06);
    } catch {
      state.gain.gain.value = targetGain;
    }

    // If we under-ran (packet loss / tab stall) or drifted too far behind,
    // restart the jitter buffer instead of playing late audio.
    let startAt = state.nextTime;
    if (startAt < now + 0.01 || startAt > now + 0.6) {
      startAt = now + JITTER_BUFFER_SECONDS;
    }
    try {
      source.start(startAt);
    } catch {
      return;
    }
    state.nextTime = startAt + buffer.duration;
  }

  public updateProximity() {
    const ctx = this.audioCtx;
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      void this.resumeAudio();
    }
    const now = ctx.currentTime;
    for (const [id, state] of this.playback) {
      const targetGain = this.computeGain(this.callbacks.getDistance(id));
      try {
        state.gain.gain.setTargetAtTime(targetGain, now, 0.08);
      } catch {
        state.gain.gain.value = targetGain;
      }
      // Drop playback nodes for peers who stopped transmitting long ago.
      if (now - state.lastPacketAt > 6) {
        try {
          state.gain.disconnect();
        } catch {
          /* ignore */
        }
        this.playback.delete(id);
      }
    }
  }

  private computeGain(dist: number): number {
    if (dist >= MAX_RANGE) return 0;
    if (dist <= FULL_RANGE) return 1;
    const t = (MAX_RANGE - dist) / (MAX_RANGE - FULL_RANGE);
    return Math.max(0, Math.min(1, t));
  }

  private applyTrackState() {
    this.localStream
      ?.getAudioTracks()
      .forEach((track) => (track.enabled = this.talking));
  }

  private attachCaptureGraph() {
    const ctx = this.audioCtx;
    if (!ctx || !this.localStream) return;
    try {
      this.sourceNode = ctx.createMediaStreamSource(this.localStream);
    } catch (e) {
      console.warn('VoiceChat: could not open mic graph', e);
      return;
    }
    const processor = ctx.createScriptProcessor(2048, 1, 1);
    this.processor = processor;
    const silent = ctx.createGain();
    silent.gain.value = 0;
    this.silentGain = silent;

    processor.onaudioprocess = (ev) => {
      if (!this.enabled || !this.talking) return;
      const input = ev.inputBuffer.getChannelData(0);
      if (!input || input.length === 0) return;
      const down = downsampleBuffer(input, ctx.sampleRate, TARGET_SAMPLE_RATE);
      if (down.length === 0) return;
      const pcm = floatToInt16(down);
      const frame = new Uint8Array(1 + pcm.byteLength);
      frame[0] = 1; // relay frame version
      frame.set(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength), 1);
      this.callbacks.sendAudio(frame.buffer);
    };

    // The processor must be connected to the destination to be pulled, but the
    // zero-gain node keeps the local mic from being played back to the player.
    this.sourceNode.connect(processor);
    processor.connect(silent);
    silent.connect(ctx.destination);
  }

  private ensureAudioContext(): AudioContext | null {
    if (!this.audioCtx) {
      try {
        const Ctor =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext;
        if (!Ctor) return null;
        this.audioCtx = new Ctor();
      } catch {
        return null;
      }
    }
    if (this.audioCtx.state === 'suspended') {
      void this.audioCtx.resume().catch(() => {
        /* ignore */
      });
    }
    return this.audioCtx;
  }
}

function downsampleBuffer(
  input: Float32Array,
  inRate: number,
  outRate: number
): Float32Array {
  if (inRate === outRate) return input.slice();
  const ratio = inRate / outRate;
  const outLength = Math.max(1, Math.floor(input.length / ratio));
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j];
    out[i] = sum / Math.max(1, end - start);
  }
  return out;
}

function floatToInt16(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

function int16ToFloat32(input: Int16Array): Float32Array {
  const out = new Float32Array(input.length);
  for (let i = 0; i < input.length; i++) {
    out[i] = input[i] / 0x8000;
  }
  return out;
}
