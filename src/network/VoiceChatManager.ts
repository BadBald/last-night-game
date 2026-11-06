// Proximity voice chat over a WebRTC mesh, signaling via the game WebSocket.
// Voice is toggle-to-talk: the caller flips setTalking(true/false) from the
// in-game mic button, the T key, or the phone. Proximity fade is applied to the
// playback volume of each remote peer.
//
// Notes on reliability:
// - Every peer always negotiates a sendable audio m-line. Before the mic is
//   granted we attach a silent placeholder track, then swap in the real mic
//   with replaceTrack(). That avoids needing a renegotiation (which is what
//   used to leave mobile players silent).
// - A TURN relay is configured because mobile carriers are frequently behind
//   symmetric NAT/CGNAT, where STUN-only peer connections never connect.
// - Remote audio is played through <audio> elements (not a Web Audio graph) so
//   it routes correctly on iOS/Android, where Web Audio output can stay silent
//   until a gesture and is often suspended in the background.

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
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] },
    {
      urls: [
        'turn:openrelay.metered.ca:80',
        'turn:openrelay.metered.ca:80?transport=tcp',
        'turn:openrelay.metered.ca:443',
        'turn:openrelay.metered.ca:443?transport=tcp',
      ],
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
  ],
  iceCandidatePoolSize: 4,
};

export class VoiceChatManager {
  private callbacks: VoiceChatCallbacks;
  private localStream: MediaStream | null = null;
  private peers = new Map<string, RTCPeerConnection>();
  private transceivers = new Map<string, RTCRtpTransceiver>();
  private pendingIce = new Map<string, RTCIceCandidateInit[]>();
  private remoteAudio = new Map<string, HTMLAudioElement>();
  private audioCtx: AudioContext | null = null;
  private placeholderStream: MediaStream | null = null;
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
      // mic permission finished). Swap the silent placeholder for the real
      // microphone on every one of them.
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
    this.clearRemoteAudio();
    try {
      void this.audioCtx?.close();
    } catch {
      /* ignore */
    }
    this.audioCtx = null;
    this.placeholderStream = null;
  }

  public ensurePeer(remoteId: string) {
    if (this.peers.has(remoteId)) return this.peers.get(remoteId)!;
    const selfId = this.callbacks.getSelfId();
    if (!selfId || remoteId === selfId) return null;
    const pc = new RTCPeerConnection(RTC_CONFIG);
    const track = this.localStream?.getAudioTracks()[0] ?? this.ensurePlaceholderTrack();
    // Always negotiate an audio m-line that is able to send. A silent
    // placeholder track keeps the m-line sendrecv until the real mic arrives,
    // so replaceTrack() alone is enough to start transmitting.
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
    pc.oniceconnectionstatechange = () => {
      console.info('[Voice] ICE', remoteId.slice(0, 6), pc.iceConnectionState);
      if (pc.iceConnectionState === 'failed') {
        try {
          pc.restartIce();
        } catch {
          /* ignore */
        }
      }
    };
    pc.onconnectionstatechange = () => {
      console.info('[Voice] PC', remoteId.slice(0, 6), pc.connectionState);
      if (pc.connectionState === 'failed') {
        try {
          pc.restartIce();
        } catch {
          /* ignore */
        }
      }
    };
    this.peers.set(remoteId, pc);

    // Initiator: lower id creates the offer (avoids offer glare). Using
    // onnegotiationneeded also lets us recover after a failed ICE connection.
    if (selfId < remoteId) {
      pc.onnegotiationneeded = () => {
        if (pc.signalingState !== 'stable') return;
        pc.setLocalDescription()
          .then(() => {
            this.callbacks.sendSignal({
              targetId: remoteId,
              kind: 'offer',
              payload: pc.localDescription,
            });
          })
          .catch((e) => console.warn('VoiceChat offer error', e));
      };
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
    this.talkingState.delete(remoteId);
    this.removeRemoteAudio(remoteId);
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

  /**
   * Must be called from a real user gesture. Browsers (especially mobile)
   * block audio playback and keep AudioContexts suspended until then.
   */
  public async resumeAudio() {
    if (this.audioCtx?.state === 'suspended') {
      try {
        await this.audioCtx.resume();
      } catch {
        /* ignore */
      }
    }
    for (const audio of this.remoteAudio.values()) {
      try {
        await audio.play();
      } catch {
        /* blocked until the next gesture; retried on every gesture */
      }
    }
  }

  public updateProximity() {
    if (this.audioCtx?.state === 'suspended') {
      void this.resumeAudio();
    }
    for (const [id, audio] of this.remoteAudio) {
      const dist = this.callbacks.getDistance(id);
      const gain = this.computeGain(dist);
      if (audio.paused) {
        void audio.play().catch(() => {
          /* retried on the next gesture */
        });
      }
      try {
        audio.volume = gain;
      } catch {
        /* iOS may ignore volume; audio still plays */
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

  /**
   * Silent audio track used to keep the negotiated m-line sendrecv before the
   * player grants microphone access.
   */
  private ensurePlaceholderTrack(): MediaStreamTrack | null {
    if (!this.placeholderStream) {
      const ctx = this.ensureAudioContext();
      if (!ctx) return null;
      try {
        const dest = ctx.createMediaStreamDestination();
        this.placeholderStream = dest.stream;
      } catch {
        return null;
      }
    }
    return this.placeholderStream.getAudioTracks()[0] ?? null;
  }

  private attachRemoteAudio(remoteId: string, stream: MediaStream) {
    let audio = this.remoteAudio.get(remoteId);
    if (!audio) {
      audio = document.createElement('audio');
      audio.autoplay = true;
      audio.setAttribute('playsinline', 'true');
      audio.setAttribute('webkit-playsinline', 'true');
      audio.style.display = 'none';
      document.body.appendChild(audio);
      this.remoteAudio.set(remoteId, audio);
    }
    if (audio.srcObject !== stream) audio.srcObject = stream;
    audio.volume = this.computeGain(this.callbacks.getDistance(remoteId));
    const playAttempt = audio.play();
    if (playAttempt) {
      playAttempt.catch(() => {
        /* retried on the next user gesture via resumeAudio() */
      });
    }
  }

  private removeRemoteAudio(remoteId: string) {
    const audio = this.remoteAudio.get(remoteId);
    if (!audio) return;
    this.remoteAudio.delete(remoteId);
    try {
      audio.pause();
      audio.srcObject = null;
      audio.remove();
    } catch {
      /* ignore */
    }
  }

  private clearRemoteAudio() {
    for (const id of [...this.remoteAudio.keys()]) this.removeRemoteAudio(id);
  }
}
