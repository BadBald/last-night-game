// Proximity voice chat over WebRTC mesh, signaling via the game WebSocket.
// Voice is toggle-to-talk: the caller flips setTalking(true/false) from the
// in-game mic button, the T key, or the phone. Gain is adjusted per peer from
// in-world distance (proximity fade).

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
  getSelfId: () => string | null;
  getRemoteIds: () => string[];
  getDistance: (remoteId: string) => number; // world units
}

const MAX_RANGE = 900;
const FULL_RANGE = 150;

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  ],
};

export class VoiceChatManager {
  private callbacks: VoiceChatCallbacks;
  private localStream: MediaStream | null = null;
  private peers = new Map<string, RTCPeerConnection>();
  private transceivers = new Map<string, RTCRtpTransceiver>();
  private pendingIce = new Map<string, RTCIceCandidateInit[]>();
  private remoteAudio = new Map<string, { gain: GainNode; ctx: AudioContext }>();
  private audioCtx: AudioContext | null = null;
  private talking = false;
  private enabled = false;
  private talkingState = new Map<string, boolean>();

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
      this.applyTrackState();
      this.enabled = true;
      // Peers may already exist (created by the offer/answer exchange before
      // mic permission finished). Attach our microphone to every one of them.
      for (const [remoteId, pc] of this.peers) {
        this.attachLocalTrack(remoteId, pc);
      }
      await this.resumeAudio();
      return true;
    } catch (e) {
      console.warn('VoiceChat: mic permission denied', e);
      return false;
    }
  }

  public disable() {
    this.localStream?.getTracks().forEach((t) => t.stop());
    this.localStream = null;
    this.enabled = false;
    this.talking = false;
    for (const pc of this.peers.values()) pc.close();
    this.peers.clear();
    this.transceivers.clear();
    this.pendingIce.clear();
    this.remoteAudio.clear();
    try {
      void this.audioCtx?.close();
    } catch {
      /* ignore */
    }
    this.audioCtx = null;
  }

  public ensurePeer(remoteId: string) {
    if (this.peers.has(remoteId)) return this.peers.get(remoteId)!;
    const selfId = this.callbacks.getSelfId();
    if (!selfId || remoteId === selfId) return null;
    const pc = new RTCPeerConnection(RTC_CONFIG);
    const track = this.localStream?.getAudioTracks()[0] ?? null;
    // Always negotiate an audio m-line, even before the mic is granted. Without
    // this the offer has no audio section and neither side can hear the other.
    const transceiver = track
      ? pc.addTransceiver(track, {
          direction: 'sendrecv',
          streams: this.localStream ? [this.localStream] : [],
        })
      : pc.addTransceiver('audio', { direction: 'sendrecv' });
    this.transceivers.set(remoteId, transceiver);

    pc.ontrack = (ev) => {
      const stream = ev.streams[0] ?? new MediaStream([ev.track]);
      this.attachRemoteAudio(remoteId, stream);
    };
    pc.onicecandidate = (ev) => {
      if (ev.candidate) {
        this.callbacks.sendSignal({
          targetId: remoteId,
          kind: 'ice',
          payload: ev.candidate.toJSON(),
        });
      }
    };
    this.peers.set(remoteId, pc);

    // Initiator: lower id creates offer
    if (selfId < remoteId) {
      pc.createOffer()
        .then((offer) => pc.setLocalDescription(offer))
        .then(() => {
          this.callbacks.sendSignal({
            targetId: remoteId,
            kind: 'offer',
            payload: pc.localDescription,
          });
        })
        .catch((e) => console.warn('VoiceChat offer error', e));
    }
    return pc;
  }

  public removePeer(remoteId: string) {
    const pc = this.peers.get(remoteId);
    if (pc) {
      pc.close();
      this.peers.delete(remoteId);
    }
    this.transceivers.delete(remoteId);
    this.pendingIce.delete(remoteId);
    this.remoteAudio.delete(remoteId);
    this.talkingState.delete(remoteId);
  }

  public handleSignal(data: VoiceSignalData) {
    const { fromId, kind, payload } = data;
    const pc = this.ensurePeer(fromId);
    if (!pc) return;
    if (kind === 'offer') {
      pc.setRemoteDescription(new RTCSessionDescription(payload as RTCSessionDescriptionInit))
        .then(() => this.flushPendingIce(fromId, pc))
        .then(() => pc.createAnswer())
        .then((answer) => pc.setLocalDescription(answer))
        .then(() => {
          this.callbacks.sendSignal({
            targetId: fromId,
            kind: 'answer',
            payload: pc.localDescription,
          });
        })
        .catch((e) => console.warn('VoiceChat answer error', e));
    } else if (kind === 'answer') {
      pc.setRemoteDescription(new RTCSessionDescription(payload as RTCSessionDescriptionInit))
        .then(() => this.flushPendingIce(fromId, pc))
        .catch((e) => console.warn('VoiceChat setRemote answer error', e));
    } else if (kind === 'ice') {
      const candidate = payload as RTCIceCandidateInit;
      if (!pc.remoteDescription) {
        const queue = this.pendingIce.get(fromId) ?? [];
        queue.push(candidate);
        this.pendingIce.set(fromId, queue);
        return;
      }
      pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {
        /* ignore */
      });
    }
  }

  private flushPendingIce(remoteId: string, pc: RTCPeerConnection) {
    const queue = this.pendingIce.get(remoteId);
    if (!queue) return;
    this.pendingIce.delete(remoteId);
    for (const candidate of queue) {
      pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {
        /* ignore */
      });
    }
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
  }

  public getTalkingState(remoteId: string) {
    return this.talkingState.get(remoteId) || false;
  }

  public async resumeAudio() {
    const ctx = this.audioCtx;
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch {
        /* ignore */
      }
    }
  }

  public updateProximity() {
    if (this.audioCtx?.state === 'suspended') {
      void this.resumeAudio();
    }
    for (const [id, entry] of this.remoteAudio) {
      const dist = this.callbacks.getDistance(id);
      const gain = this.computeGain(dist);
      try {
        entry.gain.gain.setTargetAtTime(gain, entry.ctx.currentTime, 0.05);
      } catch {
        entry.gain.gain.value = gain;
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

  private attachLocalTrack(remoteId: string, pc: RTCPeerConnection) {
    const track = this.localStream?.getAudioTracks()[0];
    if (!track) return;
    const transceiver = this.transceivers.get(remoteId);
    if (transceiver) {
      if (transceiver.sender.track !== track) {
        void transceiver.sender.replaceTrack(track).catch(() => {
          /* ignore */
        });
      }
      try {
        transceiver.direction = 'sendrecv';
      } catch {
        /* ignore */
      }
      return;
    }
    if (!pc.getSenders().some((sender) => sender.track === track) && this.localStream) {
      pc.addTrack(track, this.localStream);
    }
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

  private attachRemoteAudio(remoteId: string, stream: MediaStream) {
    if (this.remoteAudio.has(remoteId)) return;
    const ctx = this.ensureAudioContext();
    if (!ctx) return;
    try {
      const source = ctx.createMediaStreamSource(stream);
      const gain = ctx.createGain();
      // Start at the correct proximity gain so the first words are audible.
      gain.gain.value = this.computeGain(this.callbacks.getDistance(remoteId));
      source.connect(gain);
      gain.connect(ctx.destination);
      this.remoteAudio.set(remoteId, { gain, ctx });
      void this.resumeAudio();
    } catch (e) {
      console.warn('VoiceChat attach audio error', e);
    }
  }
}
