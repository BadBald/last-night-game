// Proximity voice chat over WebRTC mesh, signaling via the game WebSocket.
// Push-to-talk: caller invokes setTalking(true/false). Gain is adjusted per
// peer based on in-world distance (proximity fade).

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

export class VoiceChatManager {
  private callbacks: VoiceChatCallbacks;
  private localStream: MediaStream | null = null;
  private peers = new Map<string, RTCPeerConnection>();
  private remoteAudio = new Map<string, { audio: HTMLAudioElement; gain: GainNode; ctx: AudioContext }>();
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
    if (this.enabled) return true;
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      // mute by default (push to talk)
      this.localStream.getAudioTracks().forEach((t) => (t.enabled = false));
      this.enabled = true;
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
    for (const a of this.remoteAudio.values()) {
      try { a.audio.pause(); } catch { /* ignore */ }
    }
    this.remoteAudio.clear();
  }

  public ensurePeer(remoteId: string) {
    if (this.peers.has(remoteId)) return this.peers.get(remoteId)!;
    const selfId = this.callbacks.getSelfId();
    if (!selfId || remoteId === selfId) return null;
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    });
    if (this.localStream) {
      for (const track of this.localStream.getTracks()) {
        pc.addTrack(track, this.localStream);
      }
    }
    pc.ontrack = (ev) => {
      const stream = ev.streams[0];
      if (!stream) return;
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
    const a = this.remoteAudio.get(remoteId);
    if (a) {
      try { a.audio.pause(); } catch { /* ignore */ }
      this.remoteAudio.delete(remoteId);
    }
    this.talkingState.delete(remoteId);
  }

  public handleSignal(data: VoiceSignalData) {
    const { fromId, kind, payload } = data;
    const pc = this.ensurePeer(fromId);
    if (!pc) return;
    if (kind === 'offer') {
      pc.setRemoteDescription(new RTCSessionDescription(payload as RTCSessionDescriptionInit))
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
      pc.setRemoteDescription(new RTCSessionDescription(payload as RTCSessionDescriptionInit)).catch((e) =>
        console.warn('VoiceChat setRemote answer error', e)
      );
    } else if (kind === 'ice') {
      pc.addIceCandidate(new RTCIceCandidate(payload as RTCIceCandidateInit)).catch(() => {
        /* ignore */
      });
    }
  }

  public setTalking(talking: boolean) {
    this.talking = talking;
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach((t) => (t.enabled = talking));
    }
    this.callbacks.sendState(talking);
  }

  public isTalkingNow() {
    return this.talking;
  }

  public setPeerTalking(remoteId: string, talking: boolean) {
    this.talkingState.set(remoteId, talking);
  }

  public updateProximity() {
    for (const [id, entry] of this.remoteAudio) {
      const dist = this.callbacks.getDistance(id);
      const gain = this.computeGain(dist);
      try {
        entry.gain.gain.setTargetAtTime(gain, entry.ctx.currentTime, 0.05);
      } catch {
        entry.gain.gain.value = gain;
      }
      // mute audio element as fallback
      entry.audio.volume = Math.max(0, Math.min(1, gain));
    }
  }

  private computeGain(dist: number): number {
    if (dist >= MAX_RANGE) return 0;
    if (dist <= FULL_RANGE) return 1;
    const t = (MAX_RANGE - dist) / (MAX_RANGE - FULL_RANGE);
    return Math.max(0, Math.min(1, t));
  }

  private attachRemoteAudio(remoteId: string, stream: MediaStream) {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const source = ctx.createMediaStreamSource(stream);
      const gain = ctx.createGain();
      gain.gain.value = 0; // start muted until proximity update
      source.connect(gain);
      gain.connect(ctx.destination);
      const audio = new Audio();
      audio.srcObject = stream;
      audio.autoplay = true;
      // keep element for fallback volume
      this.remoteAudio.set(remoteId, { audio, gain, ctx });
    } catch (e) {
      console.warn('VoiceChat attach audio error', e);
    }
  }

  public getTalkingState(remoteId: string): boolean {
    return this.talkingState.get(remoteId) || false;
  }
}