import {
  RADIO_BROADCASTS,
  RadioBroadcastDef,
  RadioBroadcastId,
  RadioSpeechSegmentDef,
} from '../data/radioBroadcasts';
import { ActiveRadioBroadcastState } from '../types';
import { SoundEngine } from './audio';

export class RadioBroadcastPlayer {
  private sound: SoundEngine;
  private onStateChange: (state: ActiveRadioBroadcastState | null) => void;
  private decodedCache = new Map<string, AudioBuffer>();
  private inFlightFetches = new Map<string, Promise<AudioBuffer | null>>();

  private runId = 0;
  private activeState: ActiveRadioBroadcastState | null = null;
  private stopActiveVoice: (() => void) | null = null;
  private sampleActiveLevel: (() => number) | null = null;
  private meterTimerId: number | null = null;

  constructor(
    sound: SoundEngine,
    onStateChange: (state: ActiveRadioBroadcastState | null) => void
  ) {
    this.sound = sound;
    this.onStateChange = onStateChange;
    this.kickoffPrewarm();
  }

  private kickoffPrewarm() {
    if (typeof window === 'undefined') return;
    fetch('/api/radio/prewarm', { method: 'POST' }).catch(() => {});
    // Pre-fetch the 11:00 PM opening broadcast segment first so start-of-game playback is immediate
    const firstBroadcast = RADIO_BROADCASTS[0];
    if (firstBroadcast) {
      for (const step of firstBroadcast.steps) {
        if (step.kind === 'speech') {
          void this.fetchAndDecodeSegment(step.segmentId);
        }
      }
    }
  }

  public getState(): ActiveRadioBroadcastState | null {
    return this.activeState;
  }

  private updateState(next: ActiveRadioBroadcastState | null) {
    this.activeState = next;
    this.onStateChange(next ? { ...next } : null);
  }

  private async fetchAndDecodeSegment(segmentId: string): Promise<AudioBuffer | null> {
    const cached = this.decodedCache.get(segmentId);
    if (cached) return cached;

    const existing = this.inFlightFetches.get(segmentId);
    if (existing) return existing;

    const promise = (async () => {
      try {
        const res = await fetch(`/assets/radio/${encodeURIComponent(segmentId)}.wav`);
        if (!res.ok) return null;
        const arrBuf = await res.arrayBuffer();
        if (arrBuf.byteLength < 100) return null;
        const decoded = await this.sound.decodeWavData(arrBuf);
        if (decoded) {
          this.decodedCache.set(segmentId, decoded);
        }
        return decoded;
      } catch {
        return null;
      } finally {
        this.inFlightFetches.delete(segmentId);
      }
    })();

    this.inFlightFetches.set(segmentId, promise);
    return promise;
  }

  public preloadBroadcast(broadcastId: RadioBroadcastId) {
    const def = RADIO_BROADCASTS.find((b) => b.id === broadcastId);
    if (!def) return;
    for (const step of def.steps) {
      if (step.kind === 'speech') {
        void this.fetchAndDecodeSegment(step.segmentId);
      }
    }
  }

  public stop() {
    this.runId += 1;
    if (this.meterTimerId !== null) {
      window.clearInterval(this.meterTimerId);
      this.meterTimerId = null;
    }
    if (this.stopActiveVoice) {
      const fn = this.stopActiveVoice;
      this.stopActiveVoice = null;
      fn();
    }
    this.sampleActiveLevel = null;
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // ignore
      }
    }
    this.sound.setRadioBroadcastCarrier(false, 0);
    if (this.activeState !== null) {
      this.updateState(null);
    }
  }

  public destroy() {
    this.stop();
    this.decodedCache.clear();
  }

  public async playBroadcast(broadcastId: RadioBroadcastId): Promise<void> {
    const def = RADIO_BROADCASTS.find((b) => b.id === broadcastId);
    if (!def) return;

    this.stop();
    const myRunId = ++this.runId;
    this.sound.ensureUnlocked();

    // Pre-fetch all speech segments in this broadcast concurrently right as the stinger starts
    for (const step of def.steps) {
      if (step.kind === 'speech') {
        void this.fetchAndDecodeSegment(step.segmentId);
      }
    }

    const interferenceByBroadcast: Record<RadioBroadcastId, number> = {
      broadcast_1100pm: 0.12,
      broadcast_1145pm: 0.24,
      broadcast_1230am: 0.34,
      broadcast_0130am: 0.45,
      broadcast_0230am: 0.55,
      broadcast_0300am: 0.7,
      broadcast_0500am: 0.26,
    };
    const baseInterference = interferenceByBroadcast[def.id] ?? 0.25;
    this.sound.setRadioBroadcastCarrier(true, baseInterference);

    this.meterTimerId = window.setInterval(() => {
      if (this.runId !== myRunId || !this.activeState) return;
      let nextLevel = 0.08;
      if (this.sampleActiveLevel) {
        nextLevel = Math.max(0.06, this.sampleActiveLevel());
      } else if (this.activeState.isCue) {
        nextLevel = 0.25 + Math.random() * 0.55;
      }
      if (Math.abs(nextLevel - this.activeState.audioLevel) > 0.03) {
        this.activeState.audioLevel = nextLevel;
        this.onStateChange({ ...this.activeState });
      }
    }, 85);

    try {
      for (const step of def.steps) {
        if (this.runId !== myRunId) return;

        if (step.kind === 'sfx') {
          this.sampleActiveLevel = null;
          const cueText =
            step.cueLabel ||
            (step.sfxKind === 'breaking_news_intro' ||
            step.sfxKind === 'breaking_news_distorted'
              ? 'Incoming Emergency Broadcast...'
              : '...');

          if (step.sfxKind !== 'squelch_out') {
            this.updateState({
              broadcastId: def.id,
              broadcastNumber: def.number,
              timeLabel: def.timeLabel,
              headline: def.headline,
              speaker: step.cueLabel ? 'SIGNAL INTERFERENCE' : '162.55 MHz EMERGENCY BAND',
              captionText: cueText,
              isCue: true,
              audioLevel: 0.45,
              loadingVoice: false,
            });
          }

          this.sound.playRadioSfxCue(step.sfxKind, step.durationMs);
          await this.sleepCancelable(step.durationMs, myRunId);
        } else {
          await this.playSpeechStep(def, step, myRunId);
        }
      }
    } finally {
      if (this.runId === myRunId) {
        if (this.meterTimerId !== null) {
          window.clearInterval(this.meterTimerId);
          this.meterTimerId = null;
        }
        this.stopActiveVoice = null;
        this.sampleActiveLevel = null;
        this.sound.setRadioBroadcastCarrier(false, 0);
        this.updateState(null);
      }
    }
  }

  private async playSpeechStep(
    def: RadioBroadcastDef,
    step: RadioSpeechSegmentDef,
    myRunId: number
  ): Promise<void> {
    if (this.runId !== myRunId) return;

    const cachedImmediate = this.decodedCache.get(step.segmentId);
    if (!cachedImmediate) {
      this.updateState({
        broadcastId: def.id,
        broadcastNumber: def.number,
        timeLabel: def.timeLabel,
        headline: def.headline,
        speaker: step.speaker,
        captionText: step.lines[0] || '',
        isCue: false,
        audioLevel: 0.14,
        loadingVoice: true,
      });
    }

    const audioBuffer = cachedImmediate || (await this.fetchAndDecodeSegment(step.segmentId));
    if (this.runId !== myRunId) return;

    if (audioBuffer) {
      await this.playDecodedVoiceWithCaptions(def, step, audioBuffer, myRunId);
    } else {
      await this.playFallbackSpeechWithCaptions(def, step, myRunId);
    }
  }

  private async playDecodedVoiceWithCaptions(
    def: RadioBroadcastDef,
    step: RadioSpeechSegmentDef,
    buffer: AudioBuffer,
    myRunId: number
  ): Promise<void> {
    const totalDurationMs = Math.max(800, buffer.duration * 1000);
    const captionTimers = this.scheduleProgressiveCaptions(def, step, totalDurationMs, myRunId);

    await new Promise<void>((resolve) => {
      const handle = this.sound.playRadioVoiceBuffer(
        buffer,
        step.filterProfile,
        () => {
          resolve();
        }
      );
      this.stopActiveVoice = () => {
        handle.stop();
        resolve();
      };
      this.sampleActiveLevel = handle.sampleLevel;
    });

    for (const t of captionTimers) {
      window.clearTimeout(t);
    }
    this.stopActiveVoice = null;
    this.sampleActiveLevel = null;

    if (this.runId === myRunId) {
      await this.sleepCancelable(220, myRunId);
    }
  }

  private async playFallbackSpeechWithCaptions(
    def: RadioBroadcastDef,
    step: RadioSpeechSegmentDef,
    myRunId: number
  ): Promise<void> {
    const fullText = step.lines.join(' ');
    const estDurationMs = Math.max(2400, fullText.length * 64);
    const captionTimers = this.scheduleProgressiveCaptions(def, step, estDurationMs, myRunId);

    const canUseWebSpeech =
      typeof window !== 'undefined' &&
      'speechSynthesis' in window &&
      this.sound.getEffectiveRadioVolume() > 0.01;

    if (canUseWebSpeech) {
      await new Promise<void>((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          resolve();
        };

        try {
          window.speechSynthesis.cancel();
          const utter = new SpeechSynthesisUtterance(fullText);
          utter.rate = step.fallbackRate ?? 0.98;
          utter.pitch = step.fallbackPitch ?? 0.94;
          utter.volume = Math.min(
            1,
            this.sound.getEffectiveRadioVolume() *
              (step.filterProfile === 'unknown_whisper'
                ? 0.52
                : step.filterProfile === 'field_whisper'
                ? 0.68
                : 1.0)
          );
          const voices = window.speechSynthesis.getVoices();
          // Prefer the most natural/cinematic installed voices. Ranked list
          // (best first); fall back to any English Google/Natural/Daniel voice.
          const preferredNames = [
            'Google UK English Male',
            'Google US English',
            'Google UK English Female',
            'Microsoft David Desktop',
            'Microsoft Mark',
            'Microsoft David',
            'Microsoft Zira Desktop',
            'Microsoft Zira',
            'Daniel',
            'Samantha',
            'Karen',
            'Moira',
            'Tessa',
            'Alex',
            'Fred',
            'Tom',
            'Oliver',
          ];
          let preferred: SpeechSynthesisVoice | undefined;
          for (const name of preferredNames) {
            preferred = voices.find(
              (v) => v.lang.startsWith('en') && v.name === name
            );
            if (preferred) break;
          }
          if (!preferred) {
            preferred = voices.find(
              (v) =>
                v.lang.startsWith('en') &&
                (v.name.includes('Google') ||
                  v.name.includes('Natural') ||
                  v.name.includes('Neural') ||
                  v.name.includes('Daniel') ||
                  v.name.includes('Samantha'))
            );
          }
          // Avoid obviously robotic/compact voices if a better one exists.
          if (!preferred) {
            preferred = voices.find(
              (v) =>
                v.lang.startsWith('en') &&
                !/compact|espeak|festival/i.test(v.name)
            );
          }
          if (preferred) utter.voice = preferred;
          utter.onend = finish;
          utter.onerror = finish;

          const safetyTimeout = window.setTimeout(finish, estDurationMs + 2500);
          this.stopActiveVoice = () => {
            window.clearTimeout(safetyTimeout);
            try {
              window.speechSynthesis.cancel();
            } catch {
              // ignore
            }
            finish();
          };
          this.sampleActiveLevel = () => 0.28 + Math.random() * 0.45;
          window.speechSynthesis.speak(utter);
        } catch {
          finish();
        }
      });
    } else {
      this.sampleActiveLevel = () => 0.22 + Math.random() * 0.35;
      await this.sleepCancelable(estDurationMs, myRunId);
    }

    for (const t of captionTimers) {
      window.clearTimeout(t);
    }
    this.stopActiveVoice = null;
    this.sampleActiveLevel = null;
  }

  private scheduleProgressiveCaptions(
    def: RadioBroadcastDef,
    step: RadioSpeechSegmentDef,
    totalDurationMs: number,
    myRunId: number
  ): number[] {
    const timers: number[] = [];
    const lines = step.lines.length > 0 ? step.lines : [''];
    const totalChars = Math.max(
      1,
      lines.reduce((acc, l) => acc + Math.max(8, l.length), 0)
    );

    let elapsedChars = 0;
    lines.forEach((line, idx) => {
      const delayMs =
        idx === 0 ? 0 : Math.floor((elapsedChars / totalChars) * totalDurationMs * 0.94);
      elapsedChars += Math.max(8, line.length);

      const tid = window.setTimeout(() => {
        if (this.runId !== myRunId) return;
        this.updateState({
          broadcastId: def.id,
          broadcastNumber: def.number,
          timeLabel: def.timeLabel,
          headline: def.headline,
          speaker: step.speaker,
          captionText: line,
          isCue: false,
          audioLevel: this.activeState?.audioLevel ?? 0.35,
          loadingVoice: false,
        });
      }, delayMs);
      timers.push(tid);
    });

    return timers;
  }

  private sleepCancelable(ms: number, myRunId: number): Promise<void> {
    return new Promise((resolve) => {
      const tid = window.setTimeout(() => {
        resolve();
      }, ms);
      const checkId = window.setInterval(() => {
        if (this.runId !== myRunId) {
          window.clearTimeout(tid);
          window.clearInterval(checkId);
          resolve();
        }
      }, 60);
      window.setTimeout(() => window.clearInterval(checkId), ms + 80);
    });
  }
}
