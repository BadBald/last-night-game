import {
  RadioSfxCueKind,
  RadioVoiceFilterProfile,
} from '../data/radioBroadcasts';
import { GameSettings } from '../types';

export type SurfaceMaterial = 'asphalt' | 'wood' | 'tile' | 'grass' | 'metal';
export type DoorSoundAction = 'open' | 'close' | 'bash';
export type EnemyVocalCue = 'spot' | 'ambient' | 'chase' | 'attack' | 'hurt' | 'death';
export type WeaponHitKind = 'blade' | 'blunt_wood' | 'blunt_metal' | 'bullet' | 'unarmed';

function makeRadioDriveCurve(amount: number): Float32Array<ArrayBuffer> {
  const samples = 512;
  const buf = new ArrayBuffer(samples * 4);
  const curve = new Float32Array(buf);
  const k = Math.max(1, amount);
  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / samples - 1;
    curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
  }
  return curve;
}

function makeMonsterDistortionCurve(amount: number): Float32Array<ArrayBuffer> {
  const samples = 512;
  const buf = new ArrayBuffer(samples * 4);
  const curve = new Float32Array(buf);
  const k = Math.max(1, amount);
  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / samples - 1;
    // Asymmetric harmonic grit for organic monster vocal cords
    curve[i] =
      x >= 0
        ? Math.tanh(x * k)
        : Math.tanh(x * k * 1.35) * 0.92;
  }
  return curve;
}

export class SoundEngine {
  private ctx: AudioContext | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private whiteNoiseBuffer: AudioBuffer | null = null;
  private monsterDriveCurve: Float32Array<ArrayBuffer> = makeMonsterDistortionCurve(6.8);
  private rainGain: GainNode | null = null;
  private rainFilter: BiquadFilterNode | null = null;
  private rotorGain: GainNode | null = null;
  private rotorOsc: OscillatorNode | null = null;
  private rotorLfo: OscillatorNode | null = null;
  private radioCarrierGain: GainNode | null = null;
  private radioCarrierFilter: BiquadFilterNode | null = null;
  private activeVoiceGain: GainNode | null = null;
  private activeVoiceBoost = 1.0;
  private musicAudio: HTMLAudioElement | null = null;
  private hollowBuffers: Record<string, AudioBuffer | null> = {};
  private hollowBufferLoading: Record<string, boolean> = {};
  private hollowLastPlay: Record<string, number> = {};
  private hollowActive: AudioBufferSourceNode[] = [];

  private masterVal = 0.8;
  private musicVal = 0.7;
  private radioVal = 0.95;
  private musicMixScale = 1.0;
  private broadcastDuckScale = 1.0;
  private horrorDuckScale = 1.0;
  private horrorDuckTimer: number | null = null;
  private sfxVal = 0.85;
  private ambientVal = 0.65;
  private muted = false;
  private isHeavyRain = false;
  private rotorIntensity = 0; // 0..1
  private radioCarrierActive = false;
  private radioInterference = 0.15;
  private stepParity = false;
  private lastHorrorStingTime = -20;
  private lastHurtVocalTime = -5;
  private lastHeartbeatTime = -5;
  private lastWallImpactTime = -5;

  public initMainMusic() {
    if (typeof window === 'undefined' || this.musicAudio) return;
    const audio = new Audio('/assets/aistudio/lastnight.wav');
    audio.loop = true;
    audio.preload = 'auto';
    this.musicAudio = audio;
    this.syncMusicElement();
    // Attempt immediate playback (succeeds when autoplay is allowed; otherwise ensureUnlocked() starts it on first gesture)
    if (!this.muted && this.masterVal * this.musicVal > 0.001) {
      audio.play().catch(() => {});
    }
  }

  public setMusicMixScale(scale: number) {
    this.musicMixScale = Math.max(0, Math.min(1, scale));
    this.syncMusicElement();
  }

  private syncMusicElement() {
    if (!this.musicAudio) return;
    const targetVol = this.muted
      ? 0
      : Math.max(
          0,
          Math.min(
            1,
            this.masterVal *
              this.musicVal *
              this.musicMixScale *
              this.broadcastDuckScale *
              this.horrorDuckScale
          )
        );
    this.musicAudio.volume = targetVol;
    this.musicAudio.muted = this.muted;
    if (!this.muted && targetVol > 0.001 && this.musicAudio.paused) {
      this.musicAudio.play().catch(() => {});
    }
  }

  public applySettings(settings: GameSettings) {
    this.masterVal = settings.masterVolume;
    this.musicVal = settings.musicVolume ?? 0.7;
    this.radioVal = settings.radioVolume ?? 0.95;
    this.sfxVal = settings.sfxVolume;
    this.ambientVal = settings.ambientVolume;
    this.muted = settings.muted;
    this.syncContinuousNodes();
    this.syncMusicElement();
  }

  public ensureUnlocked() {
    if (typeof window === 'undefined') return;
    this.initMainMusic();
    if (this.musicAudio && !this.muted && this.musicAudio.paused) {
      this.musicAudio.play().catch(() => {});
    }
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      this.ctx = new AudioCtx();
      this.createNoiseBuffer();
      this.setupRainAmbience();
      this.setupHelicopterRotor();
      this.setupRadioCarrier();
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    this.syncContinuousNodes();
    this.syncMusicElement();
  }

  private createNoiseBuffer() {
    if (!this.ctx) return;
    const sampleRate = this.ctx.sampleRate;
    const length = sampleRate * 2;

    const pinkBuf = this.ctx.createBuffer(1, length, sampleRate);
    const pinkData = pinkBuf.getChannelData(0);
    const whiteBuf = this.ctx.createBuffer(1, length, sampleRate);
    const whiteData = whiteBuf.getChannelData(0);

    let lastOut = 0.0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      whiteData[i] = white;
      // Pink-ish warm urban rain & organic body texture
      lastOut = (lastOut + 0.06 * white) / 1.06;
      pinkData[i] = lastOut * 2.8;
    }
    this.noiseBuffer = pinkBuf;
    this.whiteNoiseBuffer = whiteBuf;
  }

  private setupRainAmbience() {
    if (!this.ctx || !this.noiseBuffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 850;
    filter.Q.value = 0.65;

    const gain = this.ctx.createGain();
    gain.gain.value = 0;

    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.ctx.destination);
    src.start();

    this.rainFilter = filter;
    this.rainGain = gain;
  }

  private setupHelicopterRotor() {
    if (!this.ctx || !this.noiseBuffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;

    const lowpass = this.ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = 175;

    const chopGain = this.ctx.createGain();
    chopGain.gain.value = 0.5;

    const lfo = this.ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 11.5; // Rotor blade thump rate
    const lfoDepth = this.ctx.createGain();
    lfoDepth.gain.value = 0.48;
    lfo.connect(lfoDepth);
    lfoDepth.connect(chopGain.gain);

    const masterRotor = this.ctx.createGain();
    masterRotor.gain.value = 0;

    src.connect(lowpass);
    lowpass.connect(chopGain);
    chopGain.connect(masterRotor);
    masterRotor.connect(this.ctx.destination);

    src.start();
    lfo.start();
    this.rotorOsc = src as unknown as OscillatorNode;
    this.rotorLfo = lfo;
    this.rotorGain = masterRotor;
  }

  private setupRadioCarrier() {
    if (!this.ctx || !this.noiseBuffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1950;
    filter.Q.value = 1.75;

    const gain = this.ctx.createGain();
    gain.gain.value = 0;

    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.ctx.destination);
    src.start();

    this.radioCarrierFilter = filter;
    this.radioCarrierGain = gain;
  }

  public setRadioBroadcastCarrier(active: boolean, interference = 0.18) {
    this.radioCarrierActive = active;
    this.radioInterference = Math.max(0, Math.min(1, interference));
    this.broadcastDuckScale = active ? 0.24 : 1.0;
    this.syncContinuousNodes();
    this.syncMusicElement();
  }

  public getEffectiveRadioVolume(): number {
    return this.muted ? 0 : Math.max(0, Math.min(1, this.masterVal * this.radioVal));
  }

  public setWeatherAndRotor(heavyRain: boolean, rotorLevel: number, active: boolean) {
    this.isHeavyRain = heavyRain;
    this.rotorIntensity = active ? Math.max(0, Math.min(1, rotorLevel)) : 0;
    this.syncContinuousNodes();
    if (!active && this.rainGain && this.ctx) {
      this.rainGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.15);
    }
  }

  private syncContinuousNodes() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const effAmb = this.muted ? 0 : this.masterVal * this.ambientVal;
    const effSfx = this.muted ? 0 : this.masterVal * this.sfxVal;
    const effRadio = this.getEffectiveRadioVolume();

    if (this.rainGain && this.rainFilter) {
      const rainDuck = this.radioCarrierActive ? 0.55 : 1.0;
      const targetRain = effAmb * (this.isHeavyRain ? 0.24 : 0.09) * rainDuck;
      this.rainGain.gain.setTargetAtTime(targetRain, now, 0.25);
      this.rainFilter.frequency.setTargetAtTime(this.isHeavyRain ? 1250 : 780, now, 0.4);
    }
    if (this.rotorGain && this.rotorLfo) {
      const rotorDuck = this.radioCarrierActive ? 0.5 : 1.0;
      this.rotorGain.gain.setTargetAtTime(effSfx * this.rotorIntensity * 0.42 * rotorDuck, now, 0.2);
      void this.rotorOsc;
    }
    if (this.radioCarrierGain && this.radioCarrierFilter) {
      const targetCarrier = this.radioCarrierActive
        ? effRadio * (0.022 + this.radioInterference * 0.055)
        : 0;
      this.radioCarrierGain.gain.setTargetAtTime(targetCarrier, now, 0.08);
      this.radioCarrierFilter.frequency.setTargetAtTime(
        1800 + this.radioInterference * 550,
        now,
        0.15
      );
    }
    if (this.activeVoiceGain) {
      this.activeVoiceGain.gain.setTargetAtTime(
        effRadio * this.activeVoiceBoost,
        now,
        0.04
      );
    }
  }

  private getPositionalNodes(
    listenerX: number,
    listenerY: number,
    sourceX: number,
    sourceY: number,
    maxAudibleDist = 900,
    falloffExponent = 1.35
  ): { out: AudioNode; gainScale: number; dist: number } | null {
    if (!this.ctx || this.muted) return null;
    const dx = sourceX - listenerX;
    const dy = sourceY - listenerY;
    const dist = Math.hypot(dx, dy);
    if (dist > maxAudibleDist) return null;

    const falloff = Math.pow(Math.max(0, 1 - dist / maxAudibleDist), falloffExponent);
    const gainScale = falloff * this.masterVal * this.sfxVal;
    if (gainScale <= 0.004) return null;

    if (this.ctx.createStereoPanner) {
      const panner = this.ctx.createStereoPanner();
      panner.pan.value = Math.max(-0.92, Math.min(0.92, dx / 420));
      panner.connect(this.ctx.destination);
      return { out: panner, gainScale, dist };
    }
    return { out: this.ctx.destination, gainScale, dist };
  }

  public playFootstep(
    sprint: boolean,
    crouch: boolean,
    surface: SurfaceMaterial = 'asphalt'
  ) {
    if (!this.ctx || !this.noiseBuffer || this.muted) return;
    const vol =
      this.masterVal * this.sfxVal * (crouch ? 0.16 : sprint ? 0.42 : 0.28);
    if (vol <= 0.002) return;

    this.stepParity = !this.stepParity;
    const parity = this.stepParity ? 1.04 : 0.96;
    const pitch = parity * (0.95 + Math.random() * 0.1);

    const ctx = this.ctx;
    const now = ctx.currentTime;
    const dur = crouch ? 0.09 : sprint ? 0.072 : 0.082;

    // 1. Warm, crisp pink-noise boot step crunch (lowpass sweep — rich body & unmistakable presence)
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    const cutoffStart =
      surface === 'tile'
        ? 1680
        : surface === 'metal'
        ? 1520
        : surface === 'wood'
        ? 920
        : surface === 'grass'
        ? 820
        : sprint
        ? 1380
        : 1120;
    filter.frequency.setValueAtTime(cutoffStart * pitch, now);
    filter.frequency.exponentialRampToValueAtTime(185, now + dur);

    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + dur + 0.01);

    src.connect(filter);
    filter.connect(g);
    g.connect(ctx.destination);
    src.start(now, Math.random() * 1.2, dur + 0.02);

    // 2. Solid low-end boot heel thud (punchy physical weight audible on all speakers)
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    const thudStart =
      (surface === 'wood' ? 128 : surface === 'metal' ? 135 : surface === 'grass' ? 98 : 118) *
      pitch;
    osc.frequency.setValueAtTime(thudStart, now);
    osc.frequency.exponentialRampToValueAtTime(36, now + 0.068);

    const oG = ctx.createGain();
    oG.gain.setValueAtTime(vol * (surface === 'grass' ? 0.42 : 0.65), now);
    oG.gain.exponentialRampToValueAtTime(0.001, now + 0.072);
    osc.connect(oG);
    oG.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.076);
  }

  public playEnemyStep(
    kind: 'crawler' | 'still' | 'bloom' | 'mimic',
    chasing: boolean,
    lx: number,
    ly: number,
    sx: number,
    sy: number
  ) {
    // Suppressed: creatures now use recorded Hollow samples.
    return;
  }

  public playEnemyRoar(
    kind: 'crawler' | 'still' | 'bloom' | 'mimic',
    lx: number,
    ly: number,
    sx: number,
    sy: number
  ) {
    // All creatures use recorded Hollow samples instead of procedural roar.
    this.playEnemyVocal(kind, lx, ly, sx, sy, 'chase');
    return;
  }

  public playGunshot(kind: 'pistol' | 'revolver' | 'shotgun') {
    if (!this.ctx || !this.noiseBuffer || !this.whiteNoiseBuffer || this.muted) return;
    const vol = this.masterVal * this.sfxVal;
    if (vol <= 0.002) return;

    const ctx = this.ctx;
    const now = ctx.currentTime;
    const pitch = 0.96 + Math.random() * 0.08;

    // 1. Supersonic muzzle crack transient (crisp 8ms white-noise snap)
    const crack = ctx.createBufferSource();
    crack.buffer = this.whiteNoiseBuffer;
    const cHp = ctx.createBiquadFilter();
    cHp.type = 'highpass';
    cHp.frequency.value = kind === 'shotgun' ? 1900 : 2600;
    const cG = ctx.createGain();
    cG.gain.setValueAtTime(vol * (kind === 'shotgun' ? 0.85 : 0.72), now);
    cG.gain.exponentialRampToValueAtTime(0.0008, now + 0.014);
    crack.connect(cHp);
    cHp.connect(cG);
    cG.connect(ctx.destination);
    crack.start(now, Math.random(), 0.02);

    // 2. Saturated explosive chamber blast + warm gunpowder body
    const blastDur = kind === 'shotgun' ? 0.42 : kind === 'revolver' ? 0.3 : 0.24;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;

    const drive = ctx.createWaveShaper();
    drive.curve = this.monsterDriveCurve;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(
      (kind === 'shotgun' ? 3100 : kind === 'revolver' ? 3500 : 3800) * pitch,
      now
    );
    filter.frequency.exponentialRampToValueAtTime(155, now + blastDur);

    const g = ctx.createGain();
    const peak = kind === 'shotgun' ? 0.66 : kind === 'revolver' ? 0.54 : 0.45;
    g.gain.setValueAtTime(vol * peak, now);
    g.gain.exponentialRampToValueAtTime(0.0008, now + blastDur + 0.02);

    src.connect(drive);
    drive.connect(filter);
    filter.connect(g);
    g.connect(ctx.destination);
    src.start(now, Math.random() * 0.4, blastDur + 0.04);

    // 3. Sub-bass chest concussion (pure sine < 95Hz — physical punch, zero laser sweep!)
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(kind === 'shotgun' ? 84 : kind === 'revolver' ? 92 : 96, now);
    sub.frequency.exponentialRampToValueAtTime(25, now + (kind === 'shotgun' ? 0.16 : 0.11));
    const subG = ctx.createGain();
    subG.gain.setValueAtTime(vol * (kind === 'shotgun' ? 0.78 : 0.56), now);
    subG.gain.exponentialRampToValueAtTime(0.0008, now + (kind === 'shotgun' ? 0.17 : 0.12));
    sub.connect(subG);
    subG.connect(ctx.destination);
    sub.start(now);
    sub.stop(now + 0.18);

    // 4. Urban street-canyon slapback echo reflections (spacious night atmosphere)
    for (const [delaySec, cutoff, echoMult, panVal] of [
      [0.072, 1250, 0.22, -0.35],
      [0.155, 780, 0.13, 0.38],
    ]) {
      const eSrc = ctx.createBufferSource();
      eSrc.buffer = this.noiseBuffer;
      const eLp = ctx.createBiquadFilter();
      eLp.type = 'bandpass';
      eLp.frequency.setValueAtTime(cutoff, now + delaySec);
      eLp.frequency.exponentialRampToValueAtTime(240, now + delaySec + 0.24);
      eLp.Q.value = 0.85;
      const eG = ctx.createGain();
      eG.gain.setValueAtTime(vol * peak * echoMult, now + delaySec);
      eG.gain.exponentialRampToValueAtTime(0.0008, now + delaySec + 0.26);
      eSrc.connect(eLp);
      eLp.connect(eG);
      if (ctx.createStereoPanner) {
        const pan = ctx.createStereoPanner();
        pan.pan.value = panVal;
        eG.connect(pan);
        pan.connect(ctx.destination);
      } else {
        eG.connect(ctx.destination);
      }
      eSrc.start(now + delaySec, 0.15, 0.28);
    }

    // 5. Authentic firearm mechanical action & casing physics
    if (kind === 'pistol') {
      // Fast steel slide blowback clack (+28ms) + spinning 9mm brass casing bounces on pavement
      const slide = ctx.createBufferSource();
      slide.buffer = this.whiteNoiseBuffer;
      const sBp = ctx.createBiquadFilter();
      sBp.type = 'bandpass';
      sBp.frequency.value = 3400;
      sBp.Q.value = 3.8;
      const sG = ctx.createGain();
      sG.gain.setValueAtTime(vol * 0.26, now + 0.028);
      sG.gain.exponentialRampToValueAtTime(0.0008, now + 0.048);
      slide.connect(sBp);
      sBp.connect(sG);
      sG.connect(ctx.destination);
      slide.start(now + 0.028, Math.random(), 0.025);

      for (const [off, f1, amp] of [
        [0.165, 5150, 0.075],
        [0.235, 5480, 0.045],
      ]) {
        const brass = ctx.createOscillator();
        brass.type = 'sine';
        brass.frequency.setValueAtTime(f1 * pitch, now + off);
        brass.frequency.exponentialRampToValueAtTime(f1 * 0.88, now + off + 0.028);
        const bG = ctx.createGain();
        bG.gain.setValueAtTime(vol * amp, now + off);
        bG.gain.exponentialRampToValueAtTime(0.0006, now + off + 0.032);
        brass.connect(bG);
        bG.connect(ctx.destination);
        brass.start(now + off);
        brass.stop(now + off + 0.036);
      }
    } else if (kind === 'shotgun') {
      // Plastic/brass 12g hull hitting ground (+220ms)
      const hull = ctx.createBufferSource();
      hull.buffer = this.whiteNoiseBuffer;
      const hBp = ctx.createBiquadFilter();
      hBp.type = 'bandpass';
      hBp.frequency.value = 2350;
      hBp.Q.value = 3.2;
      const hG = ctx.createGain();
      hG.gain.setValueAtTime(vol * 0.16, now + 0.22);
      hG.gain.exponentialRampToValueAtTime(0.0006, now + 0.255);
      hull.connect(hBp);
      hBp.connect(hG);
      hG.connect(ctx.destination);
      hull.start(now + 0.22, Math.random(), 0.04);
    }
  }

  public playPositionalGunshot(
    kind: 'pistol' | 'revolver' | 'shotgun',
    listenerX: number,
    listenerY: number,
    sourceX: number,
    sourceY: number
  ) {
    if (!this.ctx || !this.noiseBuffer || !this.whiteNoiseBuffer || this.muted) return;
    const pos = this.getPositionalNodes(listenerX, listenerY, sourceX, sourceY, 1450, 1.15);
    if (!pos) return;

    const ctx = this.ctx;
    const now = this.ctx.currentTime;
    const distRatio = Math.min(1, pos.dist / 1450);

    // Distance-filtered gunshot crack + rolling urban echo
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    const startCut = (kind === 'shotgun' ? 2400 : 2900) * (1 - distRatio * 0.45);
    filter.frequency.setValueAtTime(startCut, now);
    filter.frequency.exponentialRampToValueAtTime(150, now + 0.34);

    const g = ctx.createGain();
    const peak = kind === 'shotgun' ? 0.65 : kind === 'revolver' ? 0.52 : 0.44;
    g.gain.setValueAtTime(pos.gainScale * peak, now);
    g.gain.exponentialRampToValueAtTime(0.0008, now + 0.36);

    src.connect(filter);
    filter.connect(g);
    g.connect(pos.out);
    src.start(now, Math.random() * 0.3, 0.38);

    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(86, now);
    sub.frequency.exponentialRampToValueAtTime(28, now + 0.11);
    const sG = ctx.createGain();
    sG.gain.setValueAtTime(pos.gainScale * 0.45, now);
    sG.gain.exponentialRampToValueAtTime(0.0008, now + 0.12);
    sub.connect(sG);
    sG.connect(pos.out);
    sub.start(now);
    sub.stop(now + 0.13);
  }

  public playDryClick() {
    if (!this.ctx || !this.whiteNoiseBuffer || this.muted) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const vol = this.masterVal * this.sfxVal * 0.32;
    if (vol <= 0.002) return;

    // Crisp metallic firing-pin / striker snap on empty chamber (zero 8-bit square wave!)
    const pin = ctx.createBufferSource();
    pin.buffer = this.whiteNoiseBuffer;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 4300;
    const pG = ctx.createGain();
    pG.gain.setValueAtTime(vol * 0.95, now);
    pG.gain.exponentialRampToValueAtTime(0.0008, now + 0.008);
    pin.connect(hp);
    hp.connect(pG);
    pG.connect(ctx.destination);
    pin.start(now, Math.random(), 0.012);

    // Steel receiver cavity click + subtle sear reset tick
    for (const [off, hz, amp] of [
      [0, 2280, 0.85],
      [0.024, 3150, 0.38],
    ]) {
      const body = ctx.createBufferSource();
      body.buffer = this.whiteNoiseBuffer;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = hz;
      bp.Q.value = 4.6;
      const bG = ctx.createGain();
      bG.gain.setValueAtTime(vol * amp, now + off);
      bG.gain.exponentialRampToValueAtTime(0.0008, now + off + 0.014);
      body.connect(bp);
      bp.connect(bG);
      bG.connect(ctx.destination);
      body.start(now + off, Math.random(), 0.018);
    }
  }

  public playFlashlightClick(turnOn: boolean) {
    if (!this.ctx || !this.whiteNoiseBuffer || this.muted) return;
    const vol = this.masterVal * this.sfxVal * 0.34;
    if (vol <= 0.002) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    // Tactile heavy-duty mechanical push-button switch (crisp micro-switch snaps, zero musical pitch!)
    const clicks: [number, number, number, number][] = turnOn
      ? [
          // [offsetSec, bodyBpHz, snapHpHz, gainMult]
          [0, 1950, 4400, 0.72],
          [0.027, 2650, 5600, 1.0],
        ]
      : [
          [0, 2450, 5100, 0.95],
          [0.025, 1650, 3500, 0.75],
        ];

    for (const [offset, bodyHz, snapHz, mult] of clicks) {
      const t0 = now + offset;

      // 1. Crisp metal leaf-spring micro-click (5ms impulse)
      const nSrc = ctx.createBufferSource();
      nSrc.buffer = this.whiteNoiseBuffer;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = snapHz;
      const nG = ctx.createGain();
      nG.gain.setValueAtTime(vol * mult * 0.9, t0);
      nG.gain.exponentialRampToValueAtTime(0.0008, t0 + 0.0075);
      nSrc.connect(hp);
      hp.connect(nG);
      nG.connect(ctx.destination);
      nSrc.start(t0, Math.random() * 1.2, 0.01);

      // 2. Flashlight aluminum/polymer housing detent resonance (11ms)
      const bSrc = ctx.createBufferSource();
      bSrc.buffer = this.whiteNoiseBuffer;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = bodyHz;
      bp.Q.value = 3.2;
      const bG = ctx.createGain();
      bG.gain.setValueAtTime(vol * mult * 0.85, t0);
      bG.gain.exponentialRampToValueAtTime(0.0008, t0 + 0.013);
      bSrc.connect(bp);
      bp.connect(bG);
      bG.connect(ctx.destination);
      bSrc.start(t0, Math.random() * 1.2, 0.016);
    }

    // Subtle thumb-press body thud
    const thumb = ctx.createOscillator();
    thumb.type = 'sine';
    thumb.frequency.setValueAtTime(165, now);
    thumb.frequency.exponentialRampToValueAtTime(52, now + 0.016);
    const tG = ctx.createGain();
    tG.gain.setValueAtTime(vol * 0.35, now);
    tG.gain.exponentialRampToValueAtTime(0.0008, now + 0.018);
    thumb.connect(tG);
    tG.connect(ctx.destination);
    thumb.start(now);
    thumb.stop(now + 0.022);
  }

  public playBackpackZip(opening: boolean) {
    if (!this.ctx || !this.whiteNoiseBuffer || !this.noiseBuffer || this.muted) return;
    const vol = this.masterVal * this.sfxVal * 0.32;
    if (vol <= 0.002) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const dur = 0.24;

    // 1. Continuous Cordura nylon fabric slide friction bed
    const bed = ctx.createBufferSource();
    bed.buffer = this.whiteNoiseBuffer;
    const bedBp = ctx.createBiquadFilter();
    bedBp.type = 'bandpass';
    bedBp.frequency.setValueAtTime(opening ? 1550 : 3450, now);
    bedBp.frequency.exponentialRampToValueAtTime(opening ? 3550 : 1450, now + dur);
    bedBp.Q.value = 1.8;
    const bedG = ctx.createGain();
    bedG.gain.setValueAtTime(0.001, now);
    bedG.gain.linearRampToValueAtTime(vol * 0.42, now + 0.025);
    bedG.gain.setValueAtTime(vol * 0.38, now + dur * 0.78);
    bedG.gain.exponentialRampToValueAtTime(0.0008, now + dur + 0.02);
    bed.connect(bedBp);
    bedBp.connect(bedG);
    bedG.connect(ctx.destination);
    bed.start(now, Math.random() * 0.8, dur + 0.03);

    // 2. Discrete individual metal/nylon zipper-teeth micro-clicks (16 teeth!)
    const teethCount = 16;
    for (let i = 0; i < teethCount; i++) {
      const u = i / (teethCount - 1);
      // Slight natural hand-pull curve (faster in middle, settling at end)
      const curvedU = u * u * (3 - 2 * u);
      const t0 = now + curvedU * dur;
      const toothFreq = opening
        ? 1850 + u * 2350
        : 4100 - u * 2350;

      const tSrc = ctx.createBufferSource();
      tSrc.buffer = this.whiteNoiseBuffer;
      const tBp = ctx.createBiquadFilter();
      tBp.type = 'bandpass';
      tBp.frequency.value = toothFreq * (0.97 + Math.random() * 0.06);
      tBp.Q.value = 5.2;

      const env = Math.sin(Math.PI * Math.max(0.12, Math.min(0.95, u)));
      const tG = ctx.createGain();
      tG.gain.setValueAtTime(vol * 0.82 * env, t0);
      tG.gain.exponentialRampToValueAtTime(0.0008, t0 + 0.009);

      tSrc.connect(tBp);
      tBp.connect(tG);
      tG.connect(ctx.destination);
      tSrc.start(t0, (i * 0.07) % 1.5, 0.012);
    }

    // 3. Final taut canvas cinch + metal pull-tab clink when zipping CLOSED
    if (!opening) {
      const cinchT = now + dur;
      const tab = ctx.createOscillator();
      tab.type = 'sine';
      tab.frequency.setValueAtTime(3850, cinchT);
      tab.frequency.exponentialRampToValueAtTime(2450, cinchT + 0.035);
      const tabG = ctx.createGain();
      tabG.gain.setValueAtTime(vol * 0.24, cinchT);
      tabG.gain.exponentialRampToValueAtTime(0.0008, cinchT + 0.04);
      tab.connect(tabG);
      tabG.connect(ctx.destination);
      tab.start(cinchT);
      tab.stop(cinchT + 0.045);

      const thud = ctx.createOscillator();
      thud.type = 'sine';
      thud.frequency.setValueAtTime(115, cinchT);
      thud.frequency.exponentialRampToValueAtTime(46, cinchT + 0.05);
      const thG = ctx.createGain();
      thG.gain.setValueAtTime(vol * 0.36, cinchT);
      thG.gain.exponentialRampToValueAtTime(0.0008, cinchT + 0.055);
      thud.connect(thG);
      thG.connect(ctx.destination);
      thud.start(cinchT);
      thud.stop(cinchT + 0.06);
    }
  }

  public playEquipWeapon(weaponOrActionId: string) {
    if (!this.ctx || !this.noiseBuffer || this.muted) return;
    const vol = this.masterVal * this.sfxVal * 0.28;
    if (vol <= 0.002) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    if (weaponOrActionId === 'holster') {
      // Soft leather/cloth stow brush + low thump
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(1100, now);
      lp.frequency.exponentialRampToValueAtTime(320, now + 0.12);
      const g = ctx.createGain();
      g.gain.setValueAtTime(vol * 0.65, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.13);
      src.connect(lp);
      lp.connect(g);
      g.connect(ctx.destination);
      src.start(now, 0.2, 0.14);
      return;
    }

    if (weaponOrActionId === 'knife' || weaponOrActionId === 'axe') {
      // Crisp metallic blade sheath scrape + steel shimmer ring
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(weaponOrActionId === 'axe' ? 1500 : 2200, now);
      bp.frequency.exponentialRampToValueAtTime(
        weaponOrActionId === 'axe' ? 3600 : 5100,
        now + 0.15
      );
      bp.Q.value = 5.5;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.001, now);
      g.gain.linearRampToValueAtTime(vol * 0.85, now + 0.035);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.17);
      src.connect(bp);
      bp.connect(g);
      g.connect(ctx.destination);
      src.start(now, 0.15, 0.18);

      const ring = ctx.createOscillator();
      ring.type = 'sine';
      ring.frequency.setValueAtTime(weaponOrActionId === 'axe' ? 1980 : 3180, now + 0.03);
      ring.frequency.exponentialRampToValueAtTime(
        weaponOrActionId === 'axe' ? 2280 : 3560,
        now + 0.21
      );
      const rG = ctx.createGain();
      rG.gain.setValueAtTime(vol * 0.22, now + 0.03);
      rG.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
      ring.connect(rG);
      rG.connect(ctx.destination);
      ring.start(now + 0.03);
      ring.stop(now + 0.23);
      return;
    }

    if (weaponOrActionId === 'shotgun') {
      // Tactical sling shoulder lift + realistic steel pump-action rail slide & lock (chhk-CHHK!)
      for (const [offset, f1, f2, snapHz] of [
        [0, 1350, 2350, 3200],
        [0.115, 2450, 1550, 3900],
      ]) {
        const rail = ctx.createBufferSource();
        rail.buffer = this.whiteNoiseBuffer ?? this.noiseBuffer;
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.setValueAtTime(f1, now + offset);
        bp.frequency.linearRampToValueAtTime(f2, now + offset + 0.08);
        bp.Q.value = 3.2;
        const g = ctx.createGain();
        g.gain.setValueAtTime(vol * 0.85, now + offset);
        g.gain.exponentialRampToValueAtTime(0.0008, now + offset + 0.09);
        rail.connect(bp);
        bp.connect(g);
        g.connect(ctx.destination);
        rail.start(now + offset, Math.random(), 0.095);

        // Crisp steel bolt lock detent
        const lock = ctx.createBufferSource();
        lock.buffer = this.whiteNoiseBuffer ?? this.noiseBuffer;
        const lBp = ctx.createBiquadFilter();
        lBp.type = 'bandpass';
        lBp.frequency.value = snapHz;
        lBp.Q.value = 5.0;
        const lG = ctx.createGain();
        lG.gain.setValueAtTime(vol * 0.9, now + offset + 0.068);
        lG.gain.exponentialRampToValueAtTime(0.0008, now + offset + 0.084);
        lock.connect(lBp);
        lBp.connect(lG);
        lG.connect(ctx.destination);
        lock.start(now + offset + 0.068, Math.random(), 0.02);
      }

      const heft = ctx.createOscillator();
      heft.type = 'sine';
      heft.frequency.setValueAtTime(84, now);
      heft.frequency.exponentialRampToValueAtTime(32, now + 0.08);
      const hG = ctx.createGain();
      hG.gain.setValueAtTime(vol * 0.45, now);
      hG.gain.exponentialRampToValueAtTime(0.0008, now + 0.085);
      heft.connect(hG);
      heft.connect(ctx.destination);
      heft.start(now);
      heft.stop(now + 0.09);
      return;
    }

    if (weaponOrActionId === 'pistol' || weaponOrActionId === 'revolver') {
      // Kydex/leather holster draw friction + real crisp metallic slide/cylinder clicks
      const brush = ctx.createBufferSource();
      brush.buffer = this.whiteNoiseBuffer ?? this.noiseBuffer;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(1450, now);
      bp.frequency.linearRampToValueAtTime(2650, now + 0.085);
      bp.Q.value = 1.6;
      const bG = ctx.createGain();
      bG.gain.setValueAtTime(vol * 0.52, now);
      bG.gain.exponentialRampToValueAtTime(0.0008, now + 0.095);
      brush.connect(bp);
      bp.connect(bG);
      bG.connect(ctx.destination);
      brush.start(now, Math.random(), 0.1);

      const clicks =
        weaponOrActionId === 'revolver'
          ? [
              [0.032, 2650, 0.65],
              [0.068, 3150, 0.72],
              [0.108, 3680, 0.9],
            ]
          : [
              [0.042, 2450, 0.78],
              [0.105, 3480, 0.95],
            ];
      for (const [offset, freq, mult] of clicks) {
        const cSrc = ctx.createBufferSource();
        cSrc.buffer = this.whiteNoiseBuffer ?? this.noiseBuffer;
        const cBp = ctx.createBiquadFilter();
        cBp.type = 'bandpass';
        cBp.frequency.value = freq;
        cBp.Q.value = 5.4;
        const g = ctx.createGain();
        g.gain.setValueAtTime(vol * mult, now + offset);
        g.gain.exponentialRampToValueAtTime(0.0008, now + offset + 0.016);
        cSrc.connect(cBp);
        cBp.connect(g);
        g.connect(ctx.destination);
        cSrc.start(now + offset, Math.random(), 0.02);
      }
      return;
    }

    // Blunt melee weapons (bat, pipe_wrench, crowbar): leather palm grip + heavy air heft + damped steel/alloy ring
    const gripCloth = ctx.createBufferSource();
    gripCloth.buffer = this.whiteNoiseBuffer ?? this.noiseBuffer;
    const gBp = ctx.createBiquadFilter();
    gBp.type = 'bandpass';
    gBp.frequency.setValueAtTime(1250, now);
    gBp.frequency.exponentialRampToValueAtTime(480, now + 0.11);
    gBp.Q.value = 1.3;
    const gcG = ctx.createGain();
    gcG.gain.setValueAtTime(vol * 0.68, now);
    gcG.gain.exponentialRampToValueAtTime(0.0008, now + 0.12);
    gripCloth.connect(gBp);
    gBp.connect(gcG);
    gcG.connect(ctx.destination);
    gripCloth.start(now, Math.random(), 0.13);

    const heft = ctx.createOscillator();
    heft.type = 'sine';
    heft.frequency.setValueAtTime(86, now);
    heft.frequency.exponentialRampToValueAtTime(32, now + 0.09);
    const gG = ctx.createGain();
    gG.gain.setValueAtTime(vol * 0.65, now);
    gG.gain.exponentialRampToValueAtTime(0.0008, now + 0.1);
    heft.connect(gG);
    gG.connect(ctx.destination);
    heft.start(now);
    heft.stop(now + 0.11);

    if (
      weaponOrActionId === 'pipe' ||
      weaponOrActionId === 'pipe_wrench' ||
      weaponOrActionId === 'crowbar' ||
      weaponOrActionId === 'bat'
    ) {
      const baseRing =
        weaponOrActionId === 'crowbar' ? 860 : weaponOrActionId === 'bat' ? 1320 : 1080;
      const metal = ctx.createOscillator();
      metal.type = 'sine';
      metal.frequency.setValueAtTime(baseRing, now + 0.015);
      metal.frequency.exponentialRampToValueAtTime(baseRing * 0.9, now + 0.11);
      const mG = ctx.createGain();
      mG.gain.setValueAtTime(vol * 0.22, now + 0.015);
      mG.gain.exponentialRampToValueAtTime(0.0008, now + 0.12);
      metal.connect(mG);
      mG.connect(ctx.destination);
      metal.start(now + 0.015);
      metal.stop(now + 0.13);
    }
  }

  public playItemUse(itemId: string) {
    if (!this.ctx || !this.noiseBuffer || this.muted) return;
    const wBuf = this.whiteNoiseBuffer ?? this.noiseBuffer;
    const vol = this.masterVal * this.sfxVal * 0.32;
    if (vol <= 0.002) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    if (itemId === 'kevlar_vest' || itemId === 'vest') {
      // Heavy ballistic Cordura shrug + realistic Velcro hook-and-loop rip + dual polymer side-buckles
      const cloth = ctx.createBufferSource();
      cloth.buffer = this.noiseBuffer;
      const cLp = ctx.createBiquadFilter();
      cLp.type = 'lowpass';
      cLp.frequency.setValueAtTime(950, now);
      cLp.frequency.exponentialRampToValueAtTime(260, now + 0.22);
      const cG = ctx.createGain();
      cG.gain.setValueAtTime(vol * 0.75, now);
      cG.gain.exponentialRampToValueAtTime(0.0008, now + 0.24);
      cloth.connect(cLp);
      cLp.connect(cG);
      cG.connect(ctx.destination);
      cloth.start(now, 0.1, 0.25);

      // Velcro strap rip (rapid micro-teeth burst)
      for (let i = 0; i < 9; i++) {
        const t0 = now + 0.04 + i * 0.013;
        const vSrc = ctx.createBufferSource();
        vSrc.buffer = wBuf;
        const vBp = ctx.createBiquadFilter();
        vBp.type = 'bandpass';
        vBp.frequency.value = 2600 + i * 140;
        vBp.Q.value = 3.6;
        const vG = ctx.createGain();
        vG.gain.setValueAtTime(vol * 0.58, t0);
        vG.gain.exponentialRampToValueAtTime(0.0008, t0 + 0.011);
        vSrc.connect(vBp);
        vBp.connect(vG);
        vG.connect(ctx.destination);
        vSrc.start(t0, (i * 0.11) % 1.2, 0.014);
      }

      // Crisp tactical polymer buckle snap-lock
      for (const [off, hz] of [
        [0.19, 2350],
        [0.225, 3150],
      ]) {
        const bSrc = ctx.createBufferSource();
        bSrc.buffer = wBuf;
        const bBp = ctx.createBiquadFilter();
        bBp.type = 'bandpass';
        bBp.frequency.value = hz;
        bBp.Q.value = 4.8;
        const bG = ctx.createGain();
        bG.gain.setValueAtTime(vol * 0.9, now + off);
        bG.gain.exponentialRampToValueAtTime(0.0008, now + off + 0.015);
        bSrc.connect(bBp);
        bBp.connect(bG);
        bG.connect(ctx.destination);
        bSrc.start(now + off, Math.random(), 0.02);
      }
      return;
    }

    if (itemId === 'antiviral') {
      // Crisp spring-loaded auto-injector mechanical click-thump + pressurized pneumatic serum hiss
      const click = ctx.createBufferSource();
      click.buffer = wBuf;
      const cHp = ctx.createBiquadFilter();
      cHp.type = 'highpass';
      cHp.frequency.value = 3800;
      const cG = ctx.createGain();
      cG.gain.setValueAtTime(vol * 0.95, now);
      cG.gain.exponentialRampToValueAtTime(0.0008, now + 0.012);
      click.connect(cHp);
      cHp.connect(cG);
      cG.connect(ctx.destination);
      click.start(now, Math.random(), 0.016);

      const spring = ctx.createOscillator();
      spring.type = 'sine';
      spring.frequency.setValueAtTime(145, now);
      spring.frequency.exponentialRampToValueAtTime(42, now + 0.055);
      const spG = ctx.createGain();
      spG.gain.setValueAtTime(vol * 0.72, now);
      spG.gain.exponentialRampToValueAtTime(0.0008, now + 0.06);
      spring.connect(spG);
      spG.connect(ctx.destination);
      spring.start(now);
      spring.stop(now + 0.065);

      const hiss = ctx.createBufferSource();
      hiss.buffer = wBuf;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(4600, now + 0.028);
      bp.frequency.exponentialRampToValueAtTime(2100, now + 0.3);
      bp.Q.value = 1.6;
      const hG = ctx.createGain();
      hG.gain.setValueAtTime(0.001, now + 0.028);
      hG.gain.linearRampToValueAtTime(vol * 0.68, now + 0.05);
      hG.gain.exponentialRampToValueAtTime(0.0008, now + 0.32);
      hiss.connect(bp);
      bp.connect(hG);
      hG.connect(ctx.destination);
      hiss.start(now + 0.028, Math.random(), 0.31);
      return;
    }

    if (itemId === 'antiseptic') {
      // Bottle squeeze + pressurized liquid chlorhexidine wound spray/wash
      for (const [off, f1, f2, dur] of [
        [0, 2900, 4200, 0.11],
        [0.14, 3200, 2200, 0.16],
      ]) {
        const spray = ctx.createBufferSource();
        spray.buffer = wBuf;
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.setValueAtTime(f1, now + off);
        bp.frequency.exponentialRampToValueAtTime(f2, now + off + dur);
        bp.Q.value = 1.5;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.001, now + off);
        g.gain.linearRampToValueAtTime(vol * 0.65, now + off + 0.018);
        g.gain.exponentialRampToValueAtTime(0.0008, now + off + dur);
        spray.connect(bp);
        bp.connect(g);
        g.connect(ctx.destination);
        spray.start(now + off, Math.random(), dur + 0.02);
      }
      return;
    }

    if (itemId === 'bandage' || itemId === 'medkit') {
      // Trauma kit latch (for medkit) + taut sterile gauze wrap + crisp surgical tape rip
      const baseOff = itemId === 'medkit' ? 0.06 : 0;
      if (itemId === 'medkit') {
        const clasp = ctx.createBufferSource();
        clasp.buffer = wBuf;
        const clBp = ctx.createBiquadFilter();
        clBp.type = 'bandpass';
        clBp.frequency.value = 2650;
        clBp.Q.value = 4.2;
        const clG = ctx.createGain();
        clG.gain.setValueAtTime(vol * 0.85, now);
        clG.gain.exponentialRampToValueAtTime(0.0008, now + 0.022);
        clasp.connect(clBp);
        clBp.connect(clG);
        clG.connect(ctx.destination);
        clasp.start(now, Math.random(), 0.03);
      }

      // Gauze cloth wrap pass
      const wrap = ctx.createBufferSource();
      wrap.buffer = this.noiseBuffer;
      const wBp = ctx.createBiquadFilter();
      wBp.type = 'bandpass';
      wBp.frequency.setValueAtTime(1250, now + baseOff);
      wBp.frequency.linearRampToValueAtTime(2150, now + baseOff + 0.16);
      wBp.Q.value = 1.4;
      const wG = ctx.createGain();
      wG.gain.setValueAtTime(vol * 0.72, now + baseOff);
      wG.gain.exponentialRampToValueAtTime(0.0008, now + baseOff + 0.18);
      wrap.connect(wBp);
      wBp.connect(wG);
      wG.connect(ctx.destination);
      wrap.start(now + baseOff, 0.3, 0.2);

      // Crisp medical tape tear
      const tape = ctx.createBufferSource();
      tape.buffer = wBuf;
      const tHp = ctx.createBiquadFilter();
      tHp.type = 'highpass';
      tHp.frequency.value = 3400;
      const tG = ctx.createGain();
      tG.gain.setValueAtTime(vol * 0.62, now + baseOff + 0.16);
      tG.gain.exponentialRampToValueAtTime(0.0008, now + baseOff + 0.23);
      tape.connect(tHp);
      tHp.connect(tG);
      tG.connect(ctx.destination);
      tape.start(now + baseOff + 0.16, Math.random(), 0.08);
      return;
    }

    if (itemId === 'painkillers') {
      // Foil blister-pack pop + pill rattle + dry swallow
      const foil = ctx.createBufferSource();
      foil.buffer = wBuf;
      const fBp = ctx.createBiquadFilter();
      fBp.type = 'bandpass';
      fBp.frequency.value = 3850;
      fBp.Q.value = 3.2;
      const fG = ctx.createGain();
      fG.gain.setValueAtTime(vol * 0.85, now);
      fG.gain.exponentialRampToValueAtTime(0.0008, now + 0.024);
      foil.connect(fBp);
      fBp.connect(fG);
      fG.connect(ctx.destination);
      foil.start(now, Math.random(), 0.03);

      for (const [off, hz] of [
        [0.04, 2950],
        [0.072, 3350],
      ]) {
        const pill = ctx.createBufferSource();
        pill.buffer = wBuf;
        const pBp = ctx.createBiquadFilter();
        pBp.type = 'bandpass';
        pBp.frequency.value = hz;
        pBp.Q.value = 5.5;
        const pG = ctx.createGain();
        pG.gain.setValueAtTime(vol * 0.45, now + off);
        pG.gain.exponentialRampToValueAtTime(0.0008, now + off + 0.014);
        pill.connect(pBp);
        pBp.connect(pG);
        pG.connect(ctx.destination);
        pill.start(now + off, Math.random(), 0.02);
      }

      const gulp = ctx.createOscillator();
      gulp.type = 'sine';
      gulp.frequency.setValueAtTime(140, now + 0.13);
      gulp.frequency.exponentialRampToValueAtTime(58, now + 0.2);
      const gG = ctx.createGain();
      gG.gain.setValueAtTime(vol * 0.48, now + 0.13);
      gG.gain.exponentialRampToValueAtTime(0.0008, now + 0.21);
      gulp.connect(gG);
      gG.connect(ctx.destination);
      gulp.start(now + 0.13);
      gulp.stop(now + 0.22);
      return;
    }

    if (itemId === 'water_bottle' || itemId === 'energy_drink') {
      // Plastic cap seal crack + organic liquid pour & two-gulp hydration foley
      const cap = ctx.createBufferSource();
      cap.buffer = wBuf;
      const cBp = ctx.createBiquadFilter();
      cBp.type = 'bandpass';
      cBp.frequency.value = 3200;
      cBp.Q.value = 3.8;
      const cG = ctx.createGain();
      cG.gain.setValueAtTime(vol * 0.72, now);
      cG.gain.exponentialRampToValueAtTime(0.0008, now + 0.022);
      cap.connect(cBp);
      cBp.connect(cG);
      cG.connect(ctx.destination);
      cap.start(now, Math.random(), 0.03);

      for (const [offset, fStart, fEnd] of [
        [0.055, 620, 340],
        [0.195, 580, 310],
      ]) {
        const liq = ctx.createBufferSource();
        liq.buffer = this.noiseBuffer;
        const lBp = ctx.createBiquadFilter();
        lBp.type = 'bandpass';
        lBp.frequency.setValueAtTime(fStart, now + offset);
        lBp.frequency.exponentialRampToValueAtTime(fEnd, now + offset + 0.095);
        lBp.Q.value = 2.6;
        const lG = ctx.createGain();
        lG.gain.setValueAtTime(0.001, now + offset);
        lG.gain.linearRampToValueAtTime(vol * 0.78, now + offset + 0.02);
        lG.gain.exponentialRampToValueAtTime(0.0008, now + offset + 0.105);
        liq.connect(lBp);
        lBp.connect(lG);
        lG.connect(ctx.destination);
        liq.start(now + offset, Math.random() * 0.8, 0.12);

        const throat = ctx.createOscillator();
        throat.type = 'sine';
        throat.frequency.setValueAtTime(118, now + offset + 0.015);
        throat.frequency.exponentialRampToValueAtTime(52, now + offset + 0.085);
        const tG = ctx.createGain();
        tG.gain.setValueAtTime(vol * 0.38, now + offset + 0.015);
        tG.gain.exponentialRampToValueAtTime(0.0008, now + offset + 0.09);
        throat.connect(tG);
        tG.connect(ctx.destination);
        throat.start(now + offset + 0.015);
        throat.stop(now + offset + 0.095);
      }
      return;
    }

    if (itemId === 'canned_beans') {
      // Metal pull-tab ring pop + serrated tin lid peel + hearty bite
      const tab = ctx.createBufferSource();
      tab.buffer = wBuf;
      const tBp = ctx.createBiquadFilter();
      tBp.type = 'bandpass';
      tBp.frequency.value = 2950;
      tBp.Q.value = 4.5;
      const tG = ctx.createGain();
      tG.gain.setValueAtTime(vol * 0.85, now);
      tG.gain.exponentialRampToValueAtTime(0.0008, now + 0.02);
      tab.connect(tBp);
      tBp.connect(tG);
      tG.connect(ctx.destination);
      tab.start(now, Math.random(), 0.025);

      const peel = ctx.createBufferSource();
      peel.buffer = wBuf;
      const pBp = ctx.createBiquadFilter();
      pBp.type = 'bandpass';
      pBp.frequency.setValueAtTime(1650, now + 0.03);
      pBp.frequency.linearRampToValueAtTime(2850, now + 0.15);
      pBp.Q.value = 2.8;
      const pG = ctx.createGain();
      pG.gain.setValueAtTime(vol * 0.62, now + 0.03);
      pG.gain.exponentialRampToValueAtTime(0.0008, now + 0.16);
      peel.connect(pBp);
      pBp.connect(pG);
      pG.connect(ctx.destination);
      peel.start(now + 0.03, Math.random(), 0.14);

      const chew = ctx.createBufferSource();
      chew.buffer = this.noiseBuffer;
      const chLp = ctx.createBiquadFilter();
      chLp.type = 'lowpass';
      chLp.frequency.value = 920;
      const chG = ctx.createGain();
      chG.gain.setValueAtTime(vol * 0.65, now + 0.19);
      chG.gain.exponentialRampToValueAtTime(0.0008, now + 0.29);
      chew.connect(chLp);
      chLp.connect(chG);
      chG.connect(ctx.destination);
      chew.start(now + 0.19, 0.2, 0.12);
      return;
    }

    if (itemId === 'ration_bar' || itemId === 'snacks') {
      // Foil/cellophane wrapper crinkle + crisp dry crunch bites
      for (const [off, hz, q, amp] of [
        [0, 3900, 2.2, 0.68],
        [0.045, 4600, 2.6, 0.55],
        [0.115, 1650, 1.4, 0.78],
        [0.215, 1420, 1.4, 0.64],
      ]) {
        const cr = ctx.createBufferSource();
        cr.buffer = wBuf;
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = hz;
        bp.Q.value = q;
        const g = ctx.createGain();
        g.gain.setValueAtTime(vol * amp, now + off);
        g.gain.exponentialRampToValueAtTime(0.0008, now + off + 0.048);
        cr.connect(bp);
        bp.connect(g);
        g.connect(ctx.destination);
        cr.start(now + off, Math.random(), 0.055);
      }
      return;
    }

    if (itemId === 'powerbank') {
      // Crisp USB-C connector click-lock + subtle lithium charge hum swell
      for (const [off, hz, amp] of [
        [0, 2450, 0.75],
        [0.022, 3650, 0.95],
      ]) {
        const usb = ctx.createBufferSource();
        usb.buffer = wBuf;
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = hz;
        bp.Q.value = 4.8;
        const g = ctx.createGain();
        g.gain.setValueAtTime(vol * amp, now + off);
        g.gain.exponentialRampToValueAtTime(0.0008, now + off + 0.014);
        usb.connect(bp);
        bp.connect(g);
        g.connect(ctx.destination);
        usb.start(now + off, Math.random(), 0.018);
      }

      const hum = ctx.createOscillator();
      hum.type = 'sine';
      hum.frequency.setValueAtTime(1480, now + 0.035);
      hum.frequency.exponentialRampToValueAtTime(2220, now + 0.22);
      const hG = ctx.createGain();
      hG.gain.setValueAtTime(0.0008, now + 0.035);
      hG.gain.linearRampToValueAtTime(vol * 0.14, now + 0.075);
      hG.gain.exponentialRampToValueAtTime(0.0008, now + 0.24);
      hum.connect(hG);
      hG.connect(ctx.destination);
      hum.start(now + 0.035);
      hum.stop(now + 0.25);
      return;
    }

    if (itemId === 'flare') {
      // Rough striker cap scratch -> fierce magnesium flare ignition hiss
      const scratch = ctx.createBufferSource();
      scratch.buffer = wBuf;
      const scBp = ctx.createBiquadFilter();
      scBp.type = 'bandpass';
      scBp.frequency.setValueAtTime(2400, now);
      scBp.frequency.linearRampToValueAtTime(4200, now + 0.055);
      scBp.Q.value = 2.4;
      const scG = ctx.createGain();
      scG.gain.setValueAtTime(vol * 0.9, now);
      scG.gain.exponentialRampToValueAtTime(0.0008, now + 0.065);
      scratch.connect(scBp);
      scBp.connect(scG);
      scG.connect(ctx.destination);
      scratch.start(now, Math.random(), 0.075);

      const hiss = ctx.createBufferSource();
      hiss.buffer = wBuf;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(3400, now + 0.05);
      bp.frequency.exponentialRampToValueAtTime(1650, now + 0.44);
      bp.Q.value = 1.2;
      const g = ctx.createGain();
      g.gain.setValueAtTime(vol * 0.92, now + 0.05);
      g.gain.exponentialRampToValueAtTime(0.0008, now + 0.46);
      hiss.connect(bp);
      bp.connect(g);
      g.connect(ctx.destination);
      hiss.start(now + 0.05, Math.random(), 0.43);
      return;
    }

    if (itemId === 'noisemaker') {
      // Rigged tin pull-pin ting + overhand throw air whoosh
      const pin = ctx.createOscillator();
      pin.type = 'sine';
      pin.frequency.setValueAtTime(3650, now);
      pin.frequency.exponentialRampToValueAtTime(2850, now + 0.05);
      const pG = ctx.createGain();
      pG.gain.setValueAtTime(vol * 0.28, now);
      pG.gain.exponentialRampToValueAtTime(0.0008, now + 0.055);
      pin.connect(pG);
      pG.connect(ctx.destination);
      pin.start(now);
      pin.stop(now + 0.06);

      const toss = ctx.createBufferSource();
      toss.buffer = this.noiseBuffer;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(920, now + 0.03);
      bp.frequency.exponentialRampToValueAtTime(280, now + 0.19);
      const tG = ctx.createGain();
      tG.gain.setValueAtTime(vol * 0.68, now + 0.03);
      tG.gain.exponentialRampToValueAtTime(0.0008, now + 0.2);
      toss.connect(bp);
      bp.connect(tG);
      tG.connect(ctx.destination);
      toss.start(now + 0.03, 0.2, 0.18);
      return;
    }

    this.playPickup(itemId);
  }

  public playContainerRummage(containerType: string) {
    this.playSearchRummageStep(containerType, 0);
  }

  public playSearchRummageStep(containerType: string, stepIndex = 0) {
    if (!this.ctx || !this.whiteNoiseBuffer || !this.noiseBuffer || this.muted) return;
    const vol = this.masterVal * this.sfxVal * 0.36;
    if (vol <= 0.002) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    const isMetal =
      containerType === 'police_locker' ||
      containerType === 'car_trunk' ||
      containerType === 'toolbox';
    const isMedical =
      containerType === 'medical_cabinet' || containerType === 'pharmacy_shelf';

    const parity = stepIndex % 2 === 0 ? 1.0 : 0.88;

    // 1. Tactile hand-rummaging / shifting supplies rustle
    const src = ctx.createBufferSource();
    src.buffer = this.whiteNoiseBuffer;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    const fStart = isMetal ? 1650 : isMedical ? 2150 : 1150;
    const fEnd = isMetal ? 2550 : isMedical ? 1450 : 1950;
    bp.frequency.setValueAtTime(fStart * parity, now);
    bp.frequency.linearRampToValueAtTime(fEnd * parity, now + 0.19);
    bp.Q.value = 1.45;

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, now);
    g.gain.linearRampToValueAtTime(vol * 0.72, now + 0.028);
    g.gain.exponentialRampToValueAtTime(0.0008, now + 0.22);
    src.connect(bp);
    bp.connect(g);
    g.connect(ctx.destination);
    src.start(now, Math.random() * 1.2, 0.24);

    // 2. Container material knock / drawer slide / bottle or metal clink
    if (isMetal) {
      for (const [off, hz] of [
        [0.01, 860 * parity],
        [0.11, 1340 * parity],
      ]) {
        const clank = ctx.createOscillator();
        clank.type = 'triangle';
        clank.frequency.setValueAtTime(hz, now + off);
        clank.frequency.exponentialRampToValueAtTime(hz * 0.58, now + off + 0.055);
        const cG = ctx.createGain();
        cG.gain.setValueAtTime(vol * 0.46, now + off);
        cG.gain.exponentialRampToValueAtTime(0.0008, now + off + 0.06);
        clank.connect(cG);
        cG.connect(ctx.destination);
        clank.start(now + off);
        clank.stop(now + off + 0.065);
      }
    } else if (isMedical) {
      // Pill bottle / glass vial clink
      const vial = ctx.createOscillator();
      vial.type = 'sine';
      vial.frequency.setValueAtTime((2850 + Math.random() * 550) * parity, now + 0.05);
      vial.frequency.exponentialRampToValueAtTime(2150, now + 0.1);
      const vG = ctx.createGain();
      vG.gain.setValueAtTime(vol * 0.28, now + 0.05);
      vG.gain.exponentialRampToValueAtTime(0.0008, now + 0.105);
      vial.connect(vG);
      vG.connect(ctx.destination);
      vial.start(now + 0.05);
      vial.stop(now + 0.11);
    } else {
      // Wooden crate / drawer knock + item shift thud
      const knock = ctx.createOscillator();
      knock.type = 'sine';
      knock.frequency.setValueAtTime(135 * parity, now + 0.02);
      knock.frequency.exponentialRampToValueAtTime(48, now + 0.085);
      const kG = ctx.createGain();
      kG.gain.setValueAtTime(vol * 0.58, now + 0.02);
      kG.gain.exponentialRampToValueAtTime(0.0008, now + 0.09);
      knock.connect(kG);
      kG.connect(ctx.destination);
      knock.start(now + 0.02);
      knock.stop(now + 0.095);
    }
  }

  public playContainerOpen(containerType: string) {
    if (!this.ctx || !this.whiteNoiseBuffer || this.muted) return;
    const vol = this.masterVal * this.sfxVal * 0.34;
    if (vol <= 0.002) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    const isMetal =
      containerType === 'police_locker' ||
      containerType === 'car_trunk' ||
      containerType === 'toolbox';

    // Crisp latch pop + lid lift
    const snap = ctx.createBufferSource();
    snap.buffer = this.whiteNoiseBuffer;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = isMetal ? 2450 : 1450;
    bp.Q.value = 2.4;
    const sG = ctx.createGain();
    sG.gain.setValueAtTime(vol * 0.85, now);
    sG.gain.exponentialRampToValueAtTime(0.0008, now + 0.045);
    snap.connect(bp);
    bp.connect(sG);
    sG.connect(ctx.destination);
    snap.start(now, 0.3, 0.05);

    const thud = ctx.createOscillator();
    thud.type = 'sine';
    thud.frequency.setValueAtTime(isMetal ? 220 : 145, now + 0.02);
    thud.frequency.exponentialRampToValueAtTime(52, now + 0.09);
    const tG = ctx.createGain();
    tG.gain.setValueAtTime(vol * 0.55, now + 0.02);
    tG.gain.exponentialRampToValueAtTime(0.0008, now + 0.095);
    thud.connect(tG);
    tG.connect(ctx.destination);
    thud.start(now + 0.02);
    thud.stop(now + 0.1);
  }

  public playMenuHover() {
    if (!this.ctx || !this.whiteNoiseBuffer || this.muted) return;
    const vol = this.masterVal * this.sfxVal * 0.18;
    if (vol <= 0.002) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    // Subtle AAA dark tactical micro-detent tick (zero retro arcade blip)
    const tick = ctx.createBufferSource();
    tick.buffer = this.whiteNoiseBuffer;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2350;
    bp.Q.value = 4.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, now);
    g.gain.exponentialRampToValueAtTime(0.0006, now + 0.011);
    tick.connect(bp);
    bp.connect(g);
    g.connect(ctx.destination);
    tick.start(now, Math.random(), 0.015);

    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(125, now);
    sub.frequency.exponentialRampToValueAtTime(48, now + 0.018);
    const sG = ctx.createGain();
    sG.gain.setValueAtTime(vol * 0.45, now);
    sG.gain.exponentialRampToValueAtTime(0.0006, now + 0.02);
    sub.connect(sG);
    sG.connect(ctx.destination);
    sub.start(now);
    sub.stop(now + 0.024);
  }

  public playReload(
    weaponId: string = 'pistol',
    stage: 'start' | 'finish' = 'start'
  ) {
    if (!this.ctx || !this.noiseBuffer || this.muted) return;
    const wBuf = this.whiteNoiseBuffer ?? this.noiseBuffer;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const vol = this.masterVal * this.sfxVal * 0.34;
    if (vol <= 0.002) return;

    const triggerMetalClick = (offset: number, freq: number, amp: number, q = 4.8) => {
      const cSrc = ctx.createBufferSource();
      cSrc.buffer = wBuf;
      const cBp = ctx.createBiquadFilter();
      cBp.type = 'bandpass';
      cBp.frequency.value = freq;
      cBp.Q.value = q;
      const cG = ctx.createGain();
      cG.gain.setValueAtTime(vol * amp, now + offset);
      cG.gain.exponentialRampToValueAtTime(0.0008, now + offset + 0.018);
      cSrc.connect(cBp);
      cBp.connect(cG);
      cG.connect(ctx.destination);
      cSrc.start(now + offset, Math.random(), 0.024);
    };

    if (weaponId === 'shotgun') {
      if (stage === 'start') {
        // Tactile 12g buckshot shells pushed past steel loading gate into tube
        for (const off of [0.02, 0.26, 0.52]) {
          triggerMetalClick(off, 1950, 0.72, 3.6);
          triggerMetalClick(off + 0.055, 2950, 0.88, 4.8);
          const thud = ctx.createOscillator();
          thud.type = 'sine';
          thud.frequency.setValueAtTime(115, now + off + 0.05);
          thud.frequency.exponentialRampToValueAtTime(46, now + off + 0.095);
          const tG = ctx.createGain();
          tG.gain.setValueAtTime(vol * 0.42, now + off + 0.05);
          tG.gain.exponentialRampToValueAtTime(0.0008, now + off + 0.1);
          thud.connect(tG);
          tG.connect(ctx.destination);
          thud.start(now + off + 0.05);
          thud.stop(now + off + 0.105);
        }
      } else {
        // Authoritative pump-action forend rack chambering buckshot
        this.playEquipWeapon('shotgun');
      }
      return;
    }

    if (weaponId === 'revolver') {
      if (stage === 'start') {
        // Cylinder thumb-latch release + swing-out + spent .38 brass casings clinking onto street
        triggerMetalClick(0, 2450, 0.85);
        triggerMetalClick(0.065, 1780, 0.68);
        for (const [off, f1] of [
          [0.18, 4850],
          [0.23, 5220],
          [0.29, 4620],
        ]) {
          const brass = ctx.createOscillator();
          brass.type = 'sine';
          brass.frequency.setValueAtTime(f1, now + off);
          brass.frequency.exponentialRampToValueAtTime(f1 * 0.86, now + off + 0.032);
          const bG = ctx.createGain();
          bG.gain.setValueAtTime(vol * 0.18, now + off);
          bG.gain.exponentialRampToValueAtTime(0.0006, now + off + 0.036);
          brass.connect(bG);
          bG.connect(ctx.destination);
          brass.start(now + off);
          brass.stop(now + off + 0.04);
        }
      } else {
        // Heavy steel cylinder snap-shut + crisp hammer index click
        const shut = ctx.createOscillator();
        shut.type = 'sine';
        shut.frequency.setValueAtTime(150, now);
        shut.frequency.exponentialRampToValueAtTime(48, now + 0.055);
        const sG = ctx.createGain();
        sG.gain.setValueAtTime(vol * 0.68, now);
        sG.gain.exponentialRampToValueAtTime(0.0008, now + 0.06);
        shut.connect(sG);
        sG.connect(ctx.destination);
        shut.start(now);
        shut.stop(now + 0.065);
        triggerMetalClick(0.005, 2650, 0.95);
        triggerMetalClick(0.095, 3550, 0.78);
      }
      return;
    }

    // 9mm Service Pistol
    if (stage === 'start') {
      // Mag-release click + steel magazine slide friction + fresh magazine lock
      triggerMetalClick(0, 2750, 0.82);
      const slide = ctx.createBufferSource();
      slide.buffer = wBuf;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(2200, now + 0.02);
      bp.frequency.linearRampToValueAtTime(1350, now + 0.14);
      bp.Q.value = 2.4;
      const sG = ctx.createGain();
      sG.gain.setValueAtTime(vol * 0.58, now + 0.02);
      sG.gain.exponentialRampToValueAtTime(0.0008, now + 0.15);
      slide.connect(bp);
      bp.connect(sG);
      sG.connect(ctx.destination);
      slide.start(now + 0.02, Math.random(), 0.14);

      // Fresh magazine slap-in at +240ms
      const magIn = ctx.createOscillator();
      magIn.type = 'sine';
      magIn.frequency.setValueAtTime(132, now + 0.24);
      magIn.frequency.exponentialRampToValueAtTime(46, now + 0.295);
      const mG = ctx.createGain();
      mG.gain.setValueAtTime(vol * 0.65, now + 0.24);
      mG.gain.exponentialRampToValueAtTime(0.0008, now + 0.3);
      magIn.connect(mG);
      mG.connect(ctx.destination);
      magIn.start(now + 0.24);
      magIn.stop(now + 0.31);
      triggerMetalClick(0.245, 3150, 0.92);
    } else {
      // Crisp steel slide release & chamber lock (chhk-CLACK!)
      const rack = ctx.createBufferSource();
      rack.buffer = wBuf;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(1850, now);
      bp.frequency.linearRampToValueAtTime(3100, now + 0.075);
      bp.Q.value = 3.1;
      const rG = ctx.createGain();
      rG.gain.setValueAtTime(vol * 0.78, now);
      rG.gain.exponentialRampToValueAtTime(0.0008, now + 0.085);
      rack.connect(bp);
      bp.connect(rG);
      rG.connect(ctx.destination);
      rack.start(now, Math.random(), 0.09);

      triggerMetalClick(0.072, 3650, 1.0, 5.2);
    }
  }

  public playMeleeSwing(heavy: boolean, weaponId?: string | null) {
    if (!this.ctx || !this.noiseBuffer || this.muted) return;
    const wBuf = this.whiteNoiseBuffer ?? this.noiseBuffer;
    const isBlade = weaponId === 'knife' || weaponId === 'axe';
    const vol = this.masterVal * this.sfxVal * (heavy ? 0.36 : 0.28);
    if (vol <= 0.002) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    if (isBlade) {
      // Swift razor-sharp air cut whoosh
      const src = ctx.createBufferSource();
      src.buffer = wBuf;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(1850, now);
      filter.frequency.exponentialRampToValueAtTime(620, now + 0.13);
      filter.Q.value = 1.65;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.001, now);
      g.gain.linearRampToValueAtTime(vol * 0.9, now + 0.022);
      g.gain.exponentialRampToValueAtTime(0.0008, now + 0.14);
      src.connect(filter);
      filter.connect(g);
      g.connect(ctx.destination);
      src.start(now, Math.random(), 0.15);
      return;
    }

    // Weighty blunt weapon / fist air-displacement whoosh + shoulder jacket rustle
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(heavy ? 480 : 760, now);
    filter.frequency.exponentialRampToValueAtTime(heavy ? 135 : 210, now + (heavy ? 0.21 : 0.15));
    filter.Q.value = 1.25;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, now);
    g.gain.linearRampToValueAtTime(vol * 1.05, now + 0.032);
    g.gain.exponentialRampToValueAtTime(0.0008, now + (heavy ? 0.22 : 0.16));
    src.connect(filter);
    filter.connect(g);
    g.connect(ctx.destination);
    src.start(now, Math.random() * 0.5, 0.24);

    if (heavy) {
      const sub = ctx.createOscillator();
      sub.type = 'sine';
      sub.frequency.setValueAtTime(76, now + 0.015);
      sub.frequency.exponentialRampToValueAtTime(30, now + 0.14);
      const sG = ctx.createGain();
      sG.gain.setValueAtTime(vol * 0.48, now + 0.015);
      sG.gain.exponentialRampToValueAtTime(0.0008, now + 0.15);
      sub.connect(sG);
      sG.connect(ctx.destination);
      sub.start(now + 0.015);
      sub.stop(now + 0.16);
    }
  }

  public playWeaponHit(hitKind: WeaponHitKind) {
    if (!this.ctx || !this.whiteNoiseBuffer || !this.noiseBuffer || this.muted) return;
    const vol = this.masterVal * this.sfxVal * 0.42;
    if (vol <= 0.002) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const pitch = 0.94 + Math.random() * 0.12;

    // 1. Clean Sub-Bass Physical Body Weight (pure sine < 95Hz — zero 8-bit sawtooth buzz!)
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    const subStart =
      hitKind === 'blade'
        ? 78
        : hitKind === 'bullet'
        ? 96
        : hitKind === 'unarmed'
        ? 84
        : 92;
    sub.frequency.setValueAtTime(subStart * pitch, now);
    sub.frequency.exponentialRampToValueAtTime(28, now + 0.068);
    const subG = ctx.createGain();
    subG.gain.setValueAtTime(vol * (hitKind === 'blade' ? 0.58 : 0.92), now);
    subG.gain.exponentialRampToValueAtTime(0.0008, now + 0.075);
    sub.connect(subG);
    subG.connect(ctx.destination);
    sub.start(now);
    sub.stop(now + 0.08);

    if (hitKind === 'blade') {
      // Razor-sharp steel flesh slice + visceral wet laceration rip
      const slice = ctx.createBufferSource();
      slice.buffer = this.whiteNoiseBuffer;
      const sBp = ctx.createBiquadFilter();
      sBp.type = 'bandpass';
      sBp.frequency.setValueAtTime(2950 * pitch, now);
      sBp.frequency.exponentialRampToValueAtTime(5100 * pitch, now + 0.065);
      sBp.Q.value = 3.1;
      const sG = ctx.createGain();
      sG.gain.setValueAtTime(vol * 0.88, now);
      sG.gain.exponentialRampToValueAtTime(0.0008, now + 0.075);
      slice.connect(sBp);
      sBp.connect(sG);
      sG.connect(ctx.destination);
      slice.start(now, Math.random() * 1.2, 0.085);

      // Subtle steel edge glint
      const glint = ctx.createOscillator();
      glint.type = 'sine';
      glint.frequency.setValueAtTime(3280 * pitch, now);
      glint.frequency.exponentialRampToValueAtTime(2420 * pitch, now + 0.055);
      const glG = ctx.createGain();
      glG.gain.setValueAtTime(vol * 0.16, now);
      glG.gain.exponentialRampToValueAtTime(0.0008, now + 0.06);
      glint.connect(glG);
      glG.connect(ctx.destination);
      glint.start(now);
      glint.stop(now + 0.065);

      // Wet flesh laceration transient
      const wet = ctx.createBufferSource();
      wet.buffer = this.noiseBuffer;
      const wBp = ctx.createBiquadFilter();
      wBp.type = 'bandpass';
      wBp.frequency.setValueAtTime(1650 * pitch, now + 0.01);
      wBp.frequency.exponentialRampToValueAtTime(640, now + 0.095);
      wBp.Q.value = 1.6;
      const wG = ctx.createGain();
      wG.gain.setValueAtTime(vol * 0.72, now + 0.01);
      wG.gain.exponentialRampToValueAtTime(0.0008, now + 0.1);
      wet.connect(wBp);
      wBp.connect(wG);
      wG.connect(ctx.destination);
      wet.start(now + 0.01, Math.random(), 0.11);
      return;
    }

    if (hitKind === 'blunt_metal') {
      // Crushing bone-crack transient + damped steel/alloy pipe/bat ring + meaty impact
      const crack = ctx.createBufferSource();
      crack.buffer = this.whiteNoiseBuffer;
      const cBp = ctx.createBiquadFilter();
      cBp.type = 'bandpass';
      cBp.frequency.setValueAtTime(1480 * pitch, now);
      cBp.frequency.exponentialRampToValueAtTime(480, now + 0.075);
      cBp.Q.value = 1.45;
      const cG = ctx.createGain();
      cG.gain.setValueAtTime(vol * 0.98, now);
      cG.gain.exponentialRampToValueAtTime(0.0008, now + 0.085);
      crack.connect(cBp);
      cBp.connect(cG);
      cG.connect(ctx.destination);
      crack.start(now, Math.random() * 1.2, 0.095);

      // Damped metallic bar/bat overtone ping (short & tight, not a bell)
      for (const [freq, mult] of [
        [780, 0.22],
        [1240, 0.14],
      ]) {
        const ring = ctx.createOscillator();
        ring.type = 'sine';
        ring.frequency.setValueAtTime(freq * pitch, now);
        ring.frequency.exponentialRampToValueAtTime(freq * 0.88 * pitch, now + 0.075);
        const rG = ctx.createGain();
        rG.gain.setValueAtTime(vol * mult, now);
        rG.gain.exponentialRampToValueAtTime(0.0008, now + 0.08);
        ring.connect(rG);
        rG.connect(ctx.destination);
        ring.start(now);
        ring.stop(now + 0.085);
      }
      return;
    }

    if (hitKind === 'bullet') {
      // High-velocity ballistic flesh thwack
      const snap = ctx.createBufferSource();
      snap.buffer = this.whiteNoiseBuffer;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 2300;
      const sG = ctx.createGain();
      sG.gain.setValueAtTime(vol * 0.82, now);
      sG.gain.exponentialRampToValueAtTime(0.0008, now + 0.028);
      snap.connect(hp);
      hp.connect(sG);
      sG.connect(ctx.destination);
      snap.start(now, Math.random(), 0.035);

      const thwack = ctx.createBufferSource();
      thwack.buffer = this.noiseBuffer;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(1250 * pitch, now);
      bp.frequency.exponentialRampToValueAtTime(440, now + 0.075);
      bp.Q.value = 1.3;
      const tG = ctx.createGain();
      tG.gain.setValueAtTime(vol * 0.78, now);
      tG.gain.exponentialRampToValueAtTime(0.0008, now + 0.085);
      thwack.connect(bp);
      bp.connect(tG);
      tG.connect(ctx.destination);
      thwack.start(now, Math.random(), 0.09);
      return;
    }

    // 'blunt_wood' or 'unarmed': heavy physical knuckle / hardwood thwack
    const thwack = ctx.createBufferSource();
    thwack.buffer = this.whiteNoiseBuffer;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime((hitKind === 'blunt_wood' ? 1180 : 820) * pitch, now);
    bp.frequency.exponentialRampToValueAtTime(340, now + 0.07);
    bp.Q.value = 1.35;
    const tG = ctx.createGain();
    tG.gain.setValueAtTime(vol * 0.86, now);
    tG.gain.exponentialRampToValueAtTime(0.0008, now + 0.078);
    thwack.connect(bp);
    bp.connect(tG);
    tG.connect(ctx.destination);
    thwack.start(now, Math.random(), 0.085);
  }

  public playPlayerHurt() {
    if (!this.ctx || !this.whiteNoiseBuffer || !this.noiseBuffer || this.muted) return;
    const vol = this.masterVal * this.sfxVal * 0.62;
    if (vol <= 0.002) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    // Heavy chest-blow sub impact + fabric/flesh rip transient
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(118, now);
    sub.frequency.exponentialRampToValueAtTime(22, now + 0.18);
    const subG = ctx.createGain();
    subG.gain.setValueAtTime(vol * 1.05, now);
    subG.gain.exponentialRampToValueAtTime(0.0008, now + 0.2);
    sub.connect(subG);
    subG.connect(ctx.destination);
    sub.start(now);
    sub.stop(now + 0.22);

    // Sharp fleshy transient crack (AAA impact)
    const crack = ctx.createBufferSource();
    crack.buffer = this.whiteNoiseBuffer;
    const cHp = ctx.createBiquadFilter();
    cHp.type = 'highpass';
    cHp.frequency.value = 1800;
    const cG = ctx.createGain();
    cG.gain.setValueAtTime(vol * 0.95, now);
    cG.gain.exponentialRampToValueAtTime(0.0008, now + 0.04);
    crack.connect(cHp);
    cHp.connect(cG);
    cG.connect(ctx.destination);
    crack.start(now, Math.random(), 0.05);

    const rip = ctx.createBufferSource();
    rip.buffer = this.whiteNoiseBuffer;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(1950, now);
    bp.frequency.exponentialRampToValueAtTime(520, now + 0.11);
    bp.Q.value = 1.4;
    const rG = ctx.createGain();
    rG.gain.setValueAtTime(vol * 0.88, now);
    rG.gain.exponentialRampToValueAtTime(0.0008, now + 0.12);
    rip.connect(bp);
    bp.connect(rG);
    rG.connect(ctx.destination);
    rip.start(now, Math.random(), 0.13);
  }

  public playImpact(flesh: boolean) {
    this.playWeaponHit(flesh ? 'blunt_wood' : 'unarmed');
  }

  public playDoor(
    lx: number,
    ly: number,
    sx: number,
    sy: number,
    action: DoorSoundAction = 'open'
  ) {
    const maxDist = action === 'bash' ? 880 : 680;
    const pos = this.getPositionalNodes(lx, ly, sx, sy, maxDist);
    if (!pos || !this.ctx || !this.noiseBuffer) return;
    const wBuf = this.whiteNoiseBuffer ?? this.noiseBuffer;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    const triggerMetalLatch = (offset: number, hz: number, gainMult: number, q = 5.4) => {
      const src = ctx.createBufferSource();
      src.buffer = wBuf;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = hz;
      bp.Q.value = q;
      const g = ctx.createGain();
      g.gain.setValueAtTime(pos.gainScale * gainMult, now + offset);
      g.gain.exponentialRampToValueAtTime(0.0008, now + offset + 0.022);
      src.connect(bp);
      bp.connect(g);
      g.connect(pos.out);
      src.start(now + offset, Math.random(), 0.028);
    };

    if (action === 'bash') {
      // Terrifying Hollow door-breach: sub-bass shockwave + heavy timber slam + splintering wood + latch clatter
      const sub = ctx.createOscillator();
      sub.type = 'sine';
      sub.frequency.setValueAtTime(92, now);
      sub.frequency.exponentialRampToValueAtTime(24, now + 0.24);
      const subG = ctx.createGain();
      subG.gain.setValueAtTime(pos.gainScale * 0.85, now);
      subG.gain.exponentialRampToValueAtTime(0.0008, now + 0.26);
      sub.connect(subG);
      subG.connect(pos.out);
      sub.start(now);
      sub.stop(now + 0.27);

      const timber = ctx.createBufferSource();
      timber.buffer = this.noiseBuffer;
      const tBp = ctx.createBiquadFilter();
      tBp.type = 'bandpass';
      tBp.frequency.setValueAtTime(420, now);
      tBp.frequency.exponentialRampToValueAtTime(145, now + 0.22);
      tBp.Q.value = 1.4;
      const tG = ctx.createGain();
      tG.gain.setValueAtTime(pos.gainScale * 0.72, now);
      tG.gain.exponentialRampToValueAtTime(0.0008, now + 0.24);
      timber.connect(tBp);
      tBp.connect(tG);
      tG.connect(pos.out);
      timber.start(now, Math.random() * 0.5, 0.25);

      const splinter = ctx.createBufferSource();
      splinter.buffer = wBuf;
      const sBp = ctx.createBiquadFilter();
      sBp.type = 'bandpass';
      sBp.frequency.setValueAtTime(2250, now + 0.008);
      sBp.frequency.exponentialRampToValueAtTime(760, now + 0.22);
      sBp.Q.value = 1.65;
      const sG = ctx.createGain();
      sG.gain.setValueAtTime(pos.gainScale * 0.68, now + 0.008);
      sG.gain.exponentialRampToValueAtTime(0.0008, now + 0.24);
      splinter.connect(sBp);
      sBp.connect(sG);
      sG.connect(pos.out);
      splinter.start(now + 0.008, Math.random(), 0.25);

      triggerMetalLatch(0.015, 3350, 0.55, 6.0);
      triggerMetalLatch(0.058, 2680, 0.42, 4.8);
      triggerMetalLatch(0.115, 1950, 0.34, 4.2);
      return;
    }

    if (action === 'close') {
      // Heavy door air-displacement sweep -> solid hardwood frame thud -> crisp deadbolt striker click
      const air = ctx.createBufferSource();
      air.buffer = this.noiseBuffer;
      const aLp = ctx.createBiquadFilter();
      aLp.type = 'lowpass';
      aLp.frequency.setValueAtTime(340, now);
      aLp.frequency.exponentialRampToValueAtTime(140, now + 0.14);
      const aG = ctx.createGain();
      aG.gain.setValueAtTime(0.001, now);
      aG.gain.linearRampToValueAtTime(pos.gainScale * 0.24, now + 0.045);
      aG.gain.exponentialRampToValueAtTime(0.0008, now + 0.15);
      air.connect(aLp);
      aLp.connect(aG);
      aG.connect(pos.out);
      air.start(now, Math.random() * 0.4, 0.16);

      // Solid wooden jamb impact at +125ms
      const thudSub = ctx.createOscillator();
      thudSub.type = 'sine';
      thudSub.frequency.setValueAtTime(86, now + 0.125);
      thudSub.frequency.exponentialRampToValueAtTime(29, now + 0.24);
      const tsG = ctx.createGain();
      tsG.gain.setValueAtTime(pos.gainScale * 0.56, now + 0.125);
      tsG.gain.exponentialRampToValueAtTime(0.0008, now + 0.25);
      thudSub.connect(tsG);
      tsG.connect(pos.out);
      thudSub.start(now + 0.125);
      thudSub.stop(now + 0.26);

      const woodKnock = ctx.createBufferSource();
      woodKnock.buffer = this.noiseBuffer;
      const wBp = ctx.createBiquadFilter();
      wBp.type = 'bandpass';
      wBp.frequency.setValueAtTime(490, now + 0.125);
      wBp.frequency.exponentialRampToValueAtTime(185, now + 0.21);
      wBp.Q.value = 1.9;
      const wG = ctx.createGain();
      wG.gain.setValueAtTime(pos.gainScale * 0.44, now + 0.125);
      wG.gain.exponentialRampToValueAtTime(0.0008, now + 0.22);
      woodKnock.connect(wBp);
      wBp.connect(wG);
      wG.connect(pos.out);
      woodKnock.start(now + 0.125, Math.random() * 0.5, 0.11);

      // Crisp steel latch bolt engaging strike plate
      triggerMetalLatch(0.132, 3150, 0.48, 5.6);
      triggerMetalLatch(0.154, 2420, 0.3, 5.0);
      return;
    }

    // 'open': Mechanical brass handle depress + latch release + multi-formant wooden hinge creak + air swing
    triggerMetalLatch(0, 2750, 0.46, 5.4);
    triggerMetalLatch(0.028, 3420, 0.36, 5.8);

    const lockBody = ctx.createOscillator();
    lockBody.type = 'sine';
    lockBody.frequency.setValueAtTime(145, now);
    lockBody.frequency.exponentialRampToValueAtTime(58, now + 0.038);
    const lbG = ctx.createGain();
    lbG.gain.setValueAtTime(pos.gainScale * 0.24, now);
    lbG.gain.exponentialRampToValueAtTime(0.0008, now + 0.042);
    lockBody.connect(lbG);
    lbG.connect(pos.out);
    lockBody.start(now);
    lockBody.stop(now + 0.046);

    const creak = ctx.createOscillator();
    creak.type = 'sawtooth';
    const basePitch = 178 + Math.random() * 32;
    creak.frequency.setValueAtTime(basePitch, now + 0.038);
    creak.frequency.linearRampToValueAtTime(basePitch * 1.44, now + 0.21);
    creak.frequency.linearRampToValueAtTime(basePitch * 1.14, now + 0.36);

    const stickLfo = ctx.createOscillator();
    stickLfo.type = 'sine';
    stickLfo.frequency.value = 22;
    const stickGain = ctx.createGain();
    stickGain.gain.value = 13;
    stickLfo.connect(stickGain);
    stickGain.connect(creak.frequency);

    const f1 = ctx.createBiquadFilter();
    f1.type = 'bandpass';
    f1.frequency.value = 720;
    f1.Q.value = 4.2;

    const f2 = ctx.createBiquadFilter();
    f2.type = 'bandpass';
    f2.frequency.value = 1480;
    f2.Q.value = 4.6;

    const cG = ctx.createGain();
    cG.gain.setValueAtTime(0.001, now + 0.038);
    cG.gain.linearRampToValueAtTime(pos.gainScale * 0.2, now + 0.095);
    cG.gain.exponentialRampToValueAtTime(0.0008, now + 0.37);

    creak.connect(f1);
    creak.connect(f2);
    f1.connect(cG);
    f2.connect(cG);
    cG.connect(pos.out);
    creak.start(now + 0.038);
    stickLfo.start(now + 0.038);
    creak.stop(now + 0.38);
    stickLfo.stop(now + 0.38);

    const air = ctx.createBufferSource();
    air.buffer = this.noiseBuffer;
    const aLp = ctx.createBiquadFilter();
    aLp.type = 'lowpass';
    aLp.frequency.value = 285;
    const aG = ctx.createGain();
    aG.gain.setValueAtTime(pos.gainScale * 0.18, now + 0.042);
    aG.gain.exponentialRampToValueAtTime(0.0008, now + 0.28);
    air.connect(aLp);
    aLp.connect(aG);
    aG.connect(pos.out);
    air.start(now + 0.042, Math.random() * 0.4, 0.25);
  }

  public playGlassBreak(lx: number, ly: number, sx: number, sy: number) {
    const pos = this.getPositionalNodes(lx, ly, sx, sy, 850);
    if (!pos || !this.ctx || !this.noiseBuffer) return;
    const wBuf = this.whiteNoiseBuffer ?? this.noiseBuffer;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    // 1. Heavy window-frame blow punch (gives weight to smashing glass)
    const punch = ctx.createOscillator();
    punch.type = 'sine';
    punch.frequency.setValueAtTime(94, now);
    punch.frequency.exponentialRampToValueAtTime(31, now + 0.085);
    const pG = ctx.createGain();
    pG.gain.setValueAtTime(pos.gainScale * 0.62, now);
    pG.gain.exponentialRampToValueAtTime(0.0008, now + 0.095);
    punch.connect(pG);
    pG.connect(pos.out);
    punch.start(now);
    punch.stop(now + 0.1);

    // 2. Explosive tempered-glass pane shatter burst
    const shatter = ctx.createBufferSource();
    shatter.buffer = wBuf;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2750;
    const peak = ctx.createBiquadFilter();
    peak.type = 'peaking';
    peak.frequency.value = 5100;
    peak.Q.value = 1.6;
    peak.gain.value = 5.5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(pos.gainScale * 0.68, now);
    g.gain.exponentialRampToValueAtTime(0.0008, now + 0.24);
    shatter.connect(hp);
    hp.connect(peak);
    peak.connect(g);
    g.connect(pos.out);
    shatter.start(now, Math.random(), 0.26);

    // 3. Cascading crystalline glass shards clinking onto concrete
    const shardTimings = [0.028, 0.055, 0.088, 0.125, 0.162, 0.205, 0.248, 0.295, 0.345];
    shardTimings.forEach((baseOff, idx) => {
      const t0 = now + baseOff + Math.random() * 0.018;
      const amp = pos.gainScale * (0.28 - idx * 0.022);
      if (amp <= 0.004) return;

      // Crisp glass-edge concrete tick
      const tick = ctx.createBufferSource();
      tick.buffer = wBuf;
      const tBp = ctx.createBiquadFilter();
      tBp.type = 'bandpass';
      tBp.frequency.value = 4600 + Math.random() * 2600;
      tBp.Q.value = 5.5;
      const tG = ctx.createGain();
      tG.gain.setValueAtTime(amp, t0);
      tG.gain.exponentialRampToValueAtTime(0.0008, t0 + 0.018);
      tick.connect(tBp);
      tBp.connect(tG);
      tG.connect(pos.out);
      tick.start(t0, Math.random(), 0.022);

      // Ultra-short crystalline shard glint (inharmonic high frequencies)
      const glint = ctx.createOscillator();
      glint.type = 'sine';
      const hz = 4900 + ((idx * 797) % 2800) + Math.random() * 320;
      glint.frequency.setValueAtTime(hz, t0);
      glint.frequency.exponentialRampToValueAtTime(hz * 0.92, t0 + 0.028);
      const glG = ctx.createGain();
      glG.gain.setValueAtTime(amp * 0.34, t0);
      glG.gain.exponentialRampToValueAtTime(0.0008, t0 + 0.032);
      glint.connect(glG);
      glG.connect(pos.out);
      glint.start(t0);
      glint.stop(t0 + 0.036);
    });
  }

  public playDreadHeartbeat(intensity: number) {
    if (!this.ctx || this.muted) return;
    const clamped = Math.max(0, Math.min(1, intensity));
    if (clamped <= 0.05) return;

    const ctx = this.ctx;
    const now = ctx.currentTime;
    const interval = 0.92 - clamped * 0.42; // 65 BPM -> 120 BPM panic pulse
    if (now - this.lastHeartbeatTime < interval) return;
    this.lastHeartbeatTime = now;

    const vol = this.masterVal * this.sfxVal * (0.16 + clamped * 0.24);
    if (vol <= 0.002) return;

    // Two-pulse physiological "LUB-dub" sub-thump
    for (const [offset, fStart, mult] of [
      [0, 62, 1.0],
      [0.18, 52, 0.68],
    ]) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(fStart, now + offset);
      osc.frequency.exponentialRampToValueAtTime(26, now + offset + 0.11);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.001, now + offset);
      g.gain.linearRampToValueAtTime(vol * mult, now + offset + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0008, now + offset + 0.12);
      osc.connect(g);
      g.connect(ctx.destination);
      osc.start(now + offset);
      osc.stop(now + offset + 0.13);
    }
  }

  public playHorrorSpotSting(lx: number, ly: number, sx: number, sy: number) {
    // Suppressed: creatures now use recorded Hollow samples.
    return;
  }

  public preloadHollowSamples() {
    for (const name of [
      'Hollow idle arround.mp3',
      'Hollow  far.mp3',
      'Hollow  Bites.mp3',
      'Hollow attacks.mp3',
    ]) {
      void this.loadHollowBuffer(name);
    }
  }

  private hollowSampleForCue(cue: string): string {
    if (cue === 'attack') return 'Hollow attacks.mp3';
    if (cue === 'hurt' || cue === 'death') return 'Hollow  Bites.mp3';
    if (cue === 'chase' || cue === 'spot') return 'Hollow  far.mp3';
    return 'Hollow idle arround.mp3';
  }

  private async loadHollowBuffer(name: string) {
    if (this.hollowBuffers[name]) return this.hollowBuffers[name];
    if (this.hollowBufferLoading[name]) return null;
    this.hollowBufferLoading[name] = true;
    try {
      this.ensureUnlocked();
      if (!this.ctx) return null;
      const resp = await fetch('/assets/hollow%20audio/' + encodeURIComponent(name).replace(/%20/g, '%20'));
      if (!resp.ok) { this.hollowBufferLoading[name]=false; return null; }
      const ab = await resp.arrayBuffer();
      const buf = await this.ctx.decodeAudioData(ab.slice(0));
      this.hollowBuffers[name] = buf;
      this.hollowBufferLoading[name] = false;
      return buf;
    } catch {
      this.hollowBufferLoading[name] = false;
      return null;
    }
  }

  public playEnemyVocal(
    kind: 'crawler' | 'still' | 'bloom' | 'mimic',
    lx: number,
    ly: number,
    sx: number,
    sy: number,
    cue: 'spot' | 'ambient' | 'chase' | 'attack' | 'hurt' | 'death' = 'spot'
  ) {
    // Use recorded Hollow samples for all creatures (replaces procedural vocals).
    this.ensureUnlocked();
    if (!this.ctx || this.muted) return;
    // Cooldowns to avoid spam / cutting
    const now = this.ctx.currentTime;
    const cueKey = cue;
    const cooldown =
      cue === 'attack' ? 0.35 :
      cue === 'hurt' ? 0.28 :
      cue === 'death' ? 0.5 :
      cue === 'chase' ? 1.6 :
      cue === 'spot' ? 1.2 :
      2.4;
    const last = this.hollowLastPlay[cueKey] || -10;
    if (now - last < cooldown) return;
    this.hollowLastPlay[cueKey] = now;

    const sampleName = this.hollowSampleForCue(cue);
    const pos = this.getPositionalNodes(lx, ly, sx, sy, cue === 'ambient' ? 760 : 920, 1.1);
    if (!pos) return;

    const playBuffer = (buf: AudioBuffer) => {
      if (!this.ctx) return;
      const ctx = this.ctx;
      const t0 = ctx.currentTime;
      if (this.hollowActive.length > 6) return; // mix cap

      const src = ctx.createBufferSource();
      src.buffer = buf;
      // Slight pitch variance for organic feel
      src.playbackRate.value = 0.96 + Math.random() * 0.08;

      const g = ctx.createGain();
      // Attack ramp (no hard cut-in), sustain, release fade
      const attack = cue === 'attack' ? 0.012 : 0.06;
      const dur = Math.min(buf.duration, cue === 'ambient' ? 4.0 : buf.duration);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(pos.gainScale * 0.85, t0 + attack);
      if (cue !== 'ambient') {
        g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
      }

      // Monster vocal tract coloration (bandpass)
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = cue === 'attack' ? 620 : cue === 'hurt' ? 780 : 420;
      bp.Q.value = 1.6;

      src.connect(bp);
      bp.connect(g);
      g.connect(pos.out);

      src.start(t0);
      if (cue !== 'ambient') {
        src.stop(t0 + dur + 0.05);
      }
      this.hollowActive.push(src);
      src.onended = () => {
        try { src.disconnect(); bp.disconnect(); g.disconnect(); } catch {}
        this.hollowActive = this.hollowActive.filter((x) => x !== src);
      };
    };

    const cached = this.hollowBuffers[sampleName];
    if (cached) {
      playBuffer(cached);
    } else {
      this.loadHollowBuffer(sampleName).then((buf) => {
        if (buf) playBuffer(buf);
      });
    }
  }

  public playEnemyVocalProcedural(
    kind: 'crawler' | 'still' | 'bloom' | 'mimic',
    lx: number,
    ly: number,
    sx: number,
    sy: number,
    cue: EnemyVocalCue = 'spot'
  ) {
    const maxDist = cue === 'spot' ? 920 : cue === 'ambient' ? 760 : 820;
    const pos = this.getPositionalNodes(lx, ly, sx, sy, maxDist, 1.05);
    if (!pos || !this.ctx || !this.whiteNoiseBuffer || !this.noiseBuffer) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    if (cue === 'hurt') {
      if (now - this.lastHurtVocalTime < 0.26) return;
      this.lastHurtVocalTime = now;
    }

    // Helper: create a waveshaped monster vocal tract bus with dual throat/mouth formants
    const createVocalTract = (
      f1Start: number,
      f1End: number,
      f2Start: number,
      f2End: number,
      dur: number,
      peakGain: number,
      attack = 0.015
    ) => {
      const preDrive = ctx.createGain();
      preDrive.gain.value = 1.9;

      const shaper = ctx.createWaveShaper();
      shaper.curve = this.monsterDriveCurve;
      shaper.oversample = '2x';

      const f1 = ctx.createBiquadFilter();
      f1.type = 'bandpass';
      f1.frequency.setValueAtTime(f1Start, now);
      f1.frequency.exponentialRampToValueAtTime(Math.max(60, f1End), now + dur);
      f1.Q.value = 2.4;

      const f2 = ctx.createBiquadFilter();
      f2.type = 'bandpass';
      f2.frequency.setValueAtTime(f2Start, now);
      f2.frequency.exponentialRampToValueAtTime(Math.max(120, f2End), now + dur);
      f2.Q.value = 2.8;

      const outGain = ctx.createGain();
      outGain.gain.setValueAtTime(0.001, now);
      outGain.gain.linearRampToValueAtTime(pos.gainScale * peakGain, now + attack);
      outGain.gain.exponentialRampToValueAtTime(0.0008, now + dur);

      preDrive.connect(shaper);
      shaper.connect(f1);
      shaper.connect(f2);
      f1.connect(outGain);
      f2.connect(outGain);
      outGain.connect(pos.out);

      return preDrive;
    };

    // === DEATH VOCALS (Wet collapsing death-rattle groan) ===
    if (cue === 'death') {
      const dur = kind === 'bloom' ? 0.68 : 0.48;
      const tract = createVocalTract(420, 145, 1380, 420, dur, 0.72, 0.01);

      for (const [type, mult] of [
        ['sawtooth', 1.0],
        ['square', 0.505],
      ] as const) {
        const osc = ctx.createOscillator();
        osc.type = type;
        const startHz = kind === 'still' ? 460 : kind === 'bloom' ? 128 : 245;
        osc.frequency.setValueAtTime(startHz * mult, now);
        osc.frequency.exponentialRampToValueAtTime(34 * mult, now + dur);
        osc.connect(tract);
        osc.start(now);
        osc.stop(now + dur + 0.02);
      }

      const wet = ctx.createBufferSource();
      wet.buffer = this.whiteNoiseBuffer;
      wet.connect(tract);
      wet.start(now, Math.random(), dur);
      return;
    }

    // === HURT VOCALS (Delayed 38ms so weapon impact lands cleanly first, then gritty pained snarl!) ===
    if (cue === 'hurt') {
      const t0 = now + 0.038;
      const dur = 0.24;
      const pre = ctx.createGain();
      pre.gain.value = 1.8;
      const shaper = ctx.createWaveShaper();
      shaper.curve = this.monsterDriveCurve;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(kind === 'still' ? 1450 : 780, t0);
      bp.frequency.exponentialRampToValueAtTime(360, t0 + dur);
      bp.Q.value = 1.9;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.001, t0);
      g.gain.linearRampToValueAtTime(pos.gainScale * 0.58, t0 + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);

      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      const baseHz = kind === 'still' ? 580 : kind === 'bloom' ? 115 : 235;
      osc.frequency.setValueAtTime(baseHz * (0.94 + Math.random() * 0.12), t0);
      osc.frequency.exponentialRampToValueAtTime(baseHz * 0.52, t0 + dur);

      const rasp = ctx.createBufferSource();
      rasp.buffer = this.whiteNoiseBuffer;
      const rG = ctx.createGain();
      rG.gain.value = 0.55;
      rasp.connect(rG);
      rG.connect(pre);

      osc.connect(pre);
      pre.connect(shaper);
      shaper.connect(bp);
      bp.connect(g);
      g.connect(pos.out);

      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
      rasp.start(t0, Math.random(), dur);
      return;
    }

    // === THE STILL (Spine-click stalking & blood-curdling banshee shriek!) ===
    if (kind === 'still') {
      if (cue === 'ambient') {
        // Hair-raising dry cervical bone/joint clicks + hollow choked wheeze in the dark
        for (const [off, hz] of [
          [0, 1750],
          [0.085, 2450],
          [0.24, 1380],
        ]) {
          const click = ctx.createBufferSource();
          click.buffer = this.whiteNoiseBuffer;
          const bp = ctx.createBiquadFilter();
          bp.type = 'bandpass';
          bp.frequency.value = hz * (0.92 + Math.random() * 0.16);
          bp.Q.value = 6.5;
          const cG = ctx.createGain();
          cG.gain.setValueAtTime(pos.gainScale * 0.65, now + off);
          cG.gain.exponentialRampToValueAtTime(0.0008, now + off + 0.024);
          click.connect(bp);
          bp.connect(cG);
          cG.connect(pos.out);
          click.start(now + off, Math.random(), 0.03);
        }

        const wheeze = ctx.createBufferSource();
        wheeze.buffer = this.whiteNoiseBuffer;
        const wBp = ctx.createBiquadFilter();
        wBp.type = 'bandpass';
        wBp.frequency.setValueAtTime(1180, now + 0.1);
        wBp.frequency.exponentialRampToValueAtTime(640, now + 0.55);
        wBp.Q.value = 4.2;
        const wG = ctx.createGain();
        wG.gain.setValueAtTime(0.001, now + 0.1);
        wG.gain.linearRampToValueAtTime(pos.gainScale * 0.34, now + 0.2);
        wG.gain.exponentialRampToValueAtTime(0.0008, now + 0.58);
        wheeze.connect(wBp);
        wBp.connect(wG);
        wG.connect(pos.out);
        wheeze.start(now + 0.1, Math.random(), 0.5);
        return;
      }

      // Spot / Chase / Attack: Wet neck snap -> ear-splitting distorted banshee scream!
      const dur = cue === 'spot' ? 0.78 : 0.44;
      const snap = ctx.createBufferSource();
      snap.buffer = this.whiteNoiseBuffer;
      const sBp = ctx.createBiquadFilter();
      sBp.type = 'bandpass';
      sBp.frequency.value = 2250;
      sBp.Q.value = 3.5;
      const sG = ctx.createGain();
      sG.gain.setValueAtTime(pos.gainScale * 0.9, now);
      sG.gain.exponentialRampToValueAtTime(0.0008, now + 0.038);
      snap.connect(sBp);
      sBp.connect(sG);
      sG.connect(pos.out);
      snap.start(now, 0.2, 0.045);

      const tract = createVocalTract(920, 640, 2450, 1580, dur, 0.88, 0.018);
      for (const [f1, fPeak, fEnd] of [
        [780, 1560, 520],
        [835, 1690, 558],
        [390, 780, 260],
      ]) {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(f1, now);
        osc.frequency.linearRampToValueAtTime(fPeak, now + dur * 0.22);
        osc.frequency.exponentialRampToValueAtTime(fEnd, now + dur);

        const tearLfo = ctx.createOscillator();
        tearLfo.frequency.value = 46;
        const tearG = ctx.createGain();
        tearG.gain.value = 38;
        tearLfo.connect(tearG);
        tearG.connect(osc.frequency);

        osc.connect(tract);
        osc.start(now);
        tearLfo.start(now);
        osc.stop(now + dur + 0.02);
        tearLfo.stop(now + dur + 0.02);
      }

      const screamAir = ctx.createBufferSource();
      screamAir.buffer = this.whiteNoiseBuffer;
      screamAir.connect(tract);
      screamAir.start(now, Math.random(), dur);
      return;
    }

    // === MIMIC (Uncanny fake human cry in the dark -> violent vocal-cord rip into beast roar!) ===
    if (kind === 'mimic') {
      if (cue === 'ambient') {
        // Chilling distorted human "he-elp..." sobbing cry in the darkness
        for (const [offset, fStart, fEnd, len] of [
          [0, 540, 665, 0.26],
          [0.29, 495, 315, 0.44],
        ]) {
          const osc = ctx.createOscillator();
          osc.type = 'sawtooth';
          osc.frequency.setValueAtTime(fStart, now + offset);
          osc.frequency.linearRampToValueAtTime(fEnd, now + offset + len);

          const vib = ctx.createOscillator();
          vib.frequency.value = 13;
          const vibG = ctx.createGain();
          vibG.gain.value = 19;
          vib.connect(vibG);
          vibG.connect(osc.frequency);

          const f1 = ctx.createBiquadFilter();
          f1.type = 'bandpass';
          f1.frequency.value = 720;
          f1.Q.value = 3.4;

          const f2 = ctx.createBiquadFilter();
          f2.type = 'bandpass';
          f2.frequency.value = 1480;
          f2.Q.value = 3.8;

          const g = ctx.createGain();
          g.gain.setValueAtTime(0.001, now + offset);
          g.gain.linearRampToValueAtTime(pos.gainScale * 0.68, now + offset + 0.045);
          g.gain.exponentialRampToValueAtTime(0.0008, now + offset + len);

          osc.connect(f1);
          osc.connect(f2);
          f1.connect(g);
          f2.connect(g);
          g.connect(pos.out);
          osc.start(now + offset);
          vib.start(now + offset);
          osc.stop(now + offset + len + 0.02);
          vib.stop(now + offset + len + 0.02);
        }
        return;
      }

      // Spot / Chase / Attack: Human pitch violently rips downward 2 octaves into monstrous roar!
      const dur = cue === 'spot' ? 0.74 : 0.46;
      const tract = createVocalTract(1150, 290, 2350, 880, dur, 0.86, 0.015);
      for (const [f1, fMid, fEnd] of [
        [760, 145, 78],
        [380, 98, 52],
      ]) {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(f1, now);
        osc.frequency.exponentialRampToValueAtTime(fMid, now + 0.14);
        osc.frequency.exponentialRampToValueAtTime(fEnd, now + dur);

        const fry = ctx.createOscillator();
        fry.frequency.value = 34;
        const fryG = ctx.createGain();
        fryG.gain.value = 24;
        fry.connect(fryG);
        fryG.connect(osc.frequency);

        osc.connect(tract);
        osc.start(now);
        fry.start(now);
        osc.stop(now + dur + 0.02);
        fry.stop(now + dur + 0.02);
      }

      const roarNoise = ctx.createBufferSource();
      roarNoise.buffer = this.whiteNoiseBuffer;
      roarNoise.connect(tract);
      roarNoise.start(now, Math.random(), dur);
      return;
    }

    // === BLOOM (Deep wet drowning lung-gurgles & sub-bass spore-chest groan) ===
    if (kind === 'bloom') {
      const dur = cue === 'spot' ? 0.82 : 0.62;
      const tract = createVocalTract(290, 140, 860, 420, dur, cue === 'spot' ? 0.85 : 0.62, 0.04);

      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(cue === 'spot' ? 118 : 88, now);
      osc.frequency.exponentialRampToValueAtTime(42, now + dur);

      const gurgle = ctx.createOscillator();
      gurgle.frequency.value = 16;
      const gDepth = ctx.createGain();
      gDepth.gain.value = 26;
      gurgle.connect(gDepth);
      gDepth.connect(osc.frequency);

      const wet = ctx.createBufferSource();
      wet.buffer = this.noiseBuffer;

      osc.connect(tract);
      wet.connect(tract);
      osc.start(now);
      gurgle.start(now);
      wet.start(now, Math.random(), dur);
      osc.stop(now + dur + 0.02);
      gurgle.stop(now + dur + 0.02);
      return;
    }

    // === CRAWLER (Choking predatory breaths in dark + rabid feral shriek-snarls when hunting!) ===
    if (cue === 'ambient') {
      // Creepy two-part wet choked rasp + throat click from the shadows
      const rasp = ctx.createBufferSource();
      rasp.buffer = this.whiteNoiseBuffer;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(980, now);
      bp.frequency.linearRampToValueAtTime(1680, now + 0.22);
      bp.frequency.exponentialRampToValueAtTime(620, now + 0.52);
      bp.Q.value = 2.6;

      const throat = ctx.createOscillator();
      throat.type = 'sawtooth';
      throat.frequency.setValueAtTime(145, now);
      throat.frequency.exponentialRampToValueAtTime(74, now + 0.48);
      const tLp = ctx.createBiquadFilter();
      tLp.type = 'lowpass';
      tLp.frequency.value = 420;

      const rattle = ctx.createOscillator();
      rattle.frequency.value = 27;
      const rG = ctx.createGain();
      rG.gain.value = 24;
      rattle.connect(rG);
      rG.connect(throat.frequency);

      const outG = ctx.createGain();
      outG.gain.setValueAtTime(0.001, now);
      outG.gain.linearRampToValueAtTime(pos.gainScale * 0.56, now + 0.06);
      outG.gain.exponentialRampToValueAtTime(0.0008, now + 0.54);

      rasp.connect(bp);
      bp.connect(outG);
      throat.connect(tLp);
      tLp.connect(outG);
      outG.connect(pos.out);

      rasp.start(now, Math.random(), 0.55);
      throat.start(now);
      rattle.start(now);
      throat.stop(now + 0.55);
      rattle.stop(now + 0.55);
      return;
    }

    // Crawler Spot / Chase / Attack: Feral rabid shriek-snarl + snapping jaw click!
    const dur = cue === 'spot' ? 0.62 : cue === 'chase' ? 0.36 : 0.32;
    const peak = cue === 'spot' ? 0.84 : 0.68;
    const tract = createVocalTract(
      cue === 'spot' ? 680 : 480,
      220,
      cue === 'spot' ? 1950 : 1450,
      680,
      dur,
      peak,
      0.012
    );

    for (const [type, fStart, fPeak, fEnd] of [
      ['sawtooth', cue === 'spot' ? 340 : 240, cue === 'spot' ? 620 : 350, 108],
      ['square', cue === 'spot' ? 172 : 122, cue === 'spot' ? 312 : 178, 56],
    ] as const) {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.setValueAtTime(fStart, now);
      osc.frequency.linearRampToValueAtTime(fPeak, now + dur * 0.22);
      osc.frequency.exponentialRampToValueAtTime(fEnd, now + dur);

      const rattle = ctx.createOscillator();
      rattle.frequency.value = 33;
      const rDepth = ctx.createGain();
      rDepth.gain.value = 28;
      rattle.connect(rDepth);
      rDepth.connect(osc.frequency);

      osc.connect(tract);
      osc.start(now);
      rattle.start(now);
      osc.stop(now + dur + 0.02);
      rattle.stop(now + dur + 0.02);
    }

    const hiss = ctx.createBufferSource();
    hiss.buffer = this.whiteNoiseBuffer;
    hiss.connect(tract);
    hiss.start(now, Math.random(), dur);

    // Snapping teeth click on attack lunge
    if (cue === 'attack' || cue === 'chase') {
      const jaw = ctx.createBufferSource();
      jaw.buffer = this.whiteNoiseBuffer;
      const jBp = ctx.createBiquadFilter();
      jBp.type = 'bandpass';
      jBp.frequency.value = 2750;
      jBp.Q.value = 4.0;
      const jG = ctx.createGain();
      jG.gain.setValueAtTime(pos.gainScale * 0.72, now + 0.04);
      jG.gain.exponentialRampToValueAtTime(0.0008, now + 0.068);
      jaw.connect(jBp);
      jBp.connect(jG);
      jG.connect(pos.out);
      jaw.start(now + 0.04, Math.random(), 0.035);
    }
  }

  public playRadioStatic(urgent: boolean) {
    if (!this.ctx || !this.noiseBuffer || this.muted) return;
    const wBuf = this.whiteNoiseBuffer ?? this.noiseBuffer;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const vol = this.masterVal * this.sfxVal * 0.24;
    if (vol <= 0.002) return;

    // Crisp mechanical PTT button click
    const ptt = ctx.createBufferSource();
    ptt.buffer = wBuf;
    const pttBp = ctx.createBiquadFilter();
    pttBp.type = 'bandpass';
    pttBp.frequency.value = 3150;
    pttBp.Q.value = 5.2;
    const pttG = ctx.createGain();
    pttG.gain.setValueAtTime(vol * 0.52, now);
    pttG.gain.exponentialRampToValueAtTime(0.0008, now + 0.016);
    ptt.connect(pttBp);
    pttBp.connect(pttG);
    pttG.connect(ctx.destination);
    ptt.start(now, Math.random(), 0.02);

    // Authentic VHF transceiver speaker squelch burst
    const spkBus = ctx.createBiquadFilter();
    spkBus.type = 'bandpass';
    spkBus.frequency.value = 1880;
    spkBus.Q.value = 1.9;
    const spkDrive = ctx.createWaveShaper();
    spkDrive.curve = makeRadioDriveCurve(1.6);
    spkBus.connect(spkDrive);
    spkDrive.connect(ctx.destination);

    const src = ctx.createBufferSource();
    src.buffer = wBuf;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol * 0.65, now + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0008, now + 0.24);
    src.connect(g);
    g.connect(spkBus);
    src.start(now + 0.01, Math.random(), 0.25);

    if (urgent) {
      // Tactical Motorola/APX two-tone MDC data chirp through radio speaker
      for (const [off, hz, dur] of [
        [0.032, 1200, 0.034],
        [0.072, 1560, 0.046],
      ]) {
        const pip = ctx.createOscillator();
        pip.type = 'sine';
        pip.frequency.setValueAtTime(hz, now + off);
        const pg = ctx.createGain();
        pg.gain.setValueAtTime(vol * 0.58, now + off);
        pg.gain.exponentialRampToValueAtTime(0.0008, now + off + dur);
        pip.connect(pg);
        pg.connect(spkBus);
        pip.start(now + off);
        pip.stop(now + off + dur + 0.01);
      }
    }
  }

  public playPowerDown() {
    if (!this.ctx || !this.noiseBuffer || this.muted) return;
    const wBuf = this.whiteNoiseBuffer ?? this.noiseBuffer;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const vol = this.masterVal * this.sfxVal * 0.44;
    if (vol <= 0.002) return;

    // 1. High-voltage substation transformer arc sputter
    for (const [off, hz] of [
      [0, 2650],
      [0.045, 3400],
      [0.092, 2150],
    ]) {
      const arc = ctx.createBufferSource();
      arc.buffer = wBuf;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = hz;
      bp.Q.value = 3.6;
      const aG = ctx.createGain();
      aG.gain.setValueAtTime(vol * 0.52, now + off);
      aG.gain.exponentialRampToValueAtTime(0.0008, now + off + 0.038);
      arc.connect(bp);
      bp.connect(aG);
      aG.connect(ctx.destination);
      arc.start(now + off, Math.random(), 0.042);
    }

    // 2. Massive industrial grid breaker relay KA-CHUNK!
    const relaySub = ctx.createOscillator();
    relaySub.type = 'sine';
    relaySub.frequency.setValueAtTime(104, now + 0.08);
    relaySub.frequency.exponentialRampToValueAtTime(24, now + 0.34);
    const rsG = ctx.createGain();
    rsG.gain.setValueAtTime(vol * 0.95, now + 0.08);
    rsG.gain.exponentialRampToValueAtTime(0.0008, now + 0.36);
    relaySub.connect(rsG);
    rsG.connect(ctx.destination);
    relaySub.start(now + 0.08);
    relaySub.stop(now + 0.38);

    // 3. Citywide turbine & sodium-streetlamp ballast spin-down groan (filtered — zero raw sawtooth!)
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(520, now + 0.06);
    lp.frequency.exponentialRampToValueAtTime(48, now + 1.45);
    lp.Q.value = 2.2;
    lp.connect(ctx.destination);

    for (const [type, startHz, endHz, mult] of [
      ['sawtooth', 120, 23, 0.34],
      ['sine', 60, 18, 0.62],
    ] as const) {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.setValueAtTime(startHz, now + 0.06);
      osc.frequency.exponentialRampToValueAtTime(endHz, now + 1.48);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.001, now + 0.06);
      g.gain.linearRampToValueAtTime(vol * mult, now + 0.14);
      g.gain.exponentialRampToValueAtTime(0.0008, now + 1.52);
      osc.connect(g);
      g.connect(lp);
      osc.start(now + 0.06);
      osc.stop(now + 1.56);
    }
  }

  public playSiren() {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const vol = this.masterVal * this.ambientVal * 0.24;
    if (vol <= 0.002) return;

    // Haunting distant Civil Defense dual-rotor mechanical air-raid horn across the city fog
    const fogFilter = ctx.createBiquadFilter();
    fogFilter.type = 'bandpass';
    fogFilter.frequency.setValueAtTime(640, now);
    fogFilter.frequency.linearRampToValueAtTime(920, now + 1.45);
    fogFilter.frequency.linearRampToValueAtTime(580, now + 3.4);
    fogFilter.Q.value = 1.65;

    const hornDrive = ctx.createWaveShaper();
    hornDrive.curve = makeRadioDriveCurve(1.4);

    const masterG = ctx.createGain();
    masterG.gain.setValueAtTime(0.001, now);
    masterG.gain.linearRampToValueAtTime(vol, now + 0.85);
    masterG.gain.setValueAtTime(vol * 0.92, now + 1.85);
    masterG.gain.exponentialRampToValueAtTime(0.0008, now + 3.6);

    hornDrive.connect(fogFilter);
    fogFilter.connect(masterG);
    masterG.connect(ctx.destination);

    // Distant urban canyon echo reflection (+260ms)
    const delay = ctx.createDelay(0.5);
    delay.delayTime.value = 0.26;
    const echoLp = ctx.createBiquadFilter();
    echoLp.type = 'lowpass';
    echoLp.frequency.value = 540;
    const echoG = ctx.createGain();
    echoG.gain.value = 0.38;
    masterG.connect(delay);
    delay.connect(echoLp);
    echoLp.connect(echoG);
    echoG.connect(ctx.destination);

    // Dual-port 10/12 rotor ratio (minor third mechanical wail — authentic Thunderbolt/Federal siren)
    for (const [ratio, amp] of [
      [1.0, 0.56],
      [1.2, 0.44],
    ]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(285 * ratio, now);
      osc.frequency.exponentialRampToValueAtTime(535 * ratio, now + 1.45);
      osc.frequency.exponentialRampToValueAtTime(265 * ratio, now + 3.55);
      const oG = ctx.createGain();
      oG.gain.value = amp;
      osc.connect(oG);
      oG.connect(hornDrive);
      osc.start(now);
      osc.stop(now + 3.65);
    }
  }

  public playPickup(itemId = '') {
    if (!this.ctx || !this.noiseBuffer || this.muted) return;
    const wBuf = this.whiteNoiseBuffer ?? this.noiseBuffer;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const vol = this.masterVal * this.sfxVal * 0.3;
    if (vol <= 0.002) return;
    const pitch = 0.95 + Math.random() * 0.1;

    // 1. Tactile hand-grab cloth/canvas pack stow rustle (ZERO 90s arcade coin sine notes!)
    const grab = ctx.createBufferSource();
    grab.buffer = this.noiseBuffer;
    const gBp = ctx.createBiquadFilter();
    gBp.type = 'bandpass';
    gBp.frequency.setValueAtTime(1180 * pitch, now);
    gBp.frequency.exponentialRampToValueAtTime(620, now + 0.085);
    gBp.Q.value = 1.45;
    const gGain = ctx.createGain();
    gGain.gain.setValueAtTime(vol * 0.72, now);
    gGain.gain.exponentialRampToValueAtTime(0.0008, now + 0.095);
    grab.connect(gBp);
    gBp.connect(gGain);
    gGain.connect(ctx.destination);
    grab.start(now, Math.random() * 0.8, 0.1);

    // 2. Compact physical pack-pocket thud
    const stow = ctx.createOscillator();
    stow.type = 'sine';
    stow.frequency.setValueAtTime(98 * pitch, now + 0.018);
    stow.frequency.exponentialRampToValueAtTime(38, now + 0.072);
    const sG = ctx.createGain();
    sG.gain.setValueAtTime(vol * 0.56, now + 0.018);
    sG.gain.exponentialRampToValueAtTime(0.0008, now + 0.078);
    stow.connect(sG);
    sG.connect(ctx.destination);
    stow.start(now + 0.018);
    stow.stop(now + 0.084);

    // 3. Subtle material-accurate foley signature
    const isAmmo = itemId.startsWith('ammo_');
    const isWeaponOrTool =
      itemId === 'pistol' ||
      itemId === 'revolver' ||
      itemId === 'shotgun' ||
      itemId === 'crowbar' ||
      itemId === 'pipe_wrench' ||
      itemId === 'bat' ||
      itemId === 'knife' ||
      itemId === 'axe';

    const accent = ctx.createBufferSource();
    accent.buffer = wBuf;
    const aBp = ctx.createBiquadFilter();
    aBp.type = 'bandpass';
    aBp.frequency.value = (isAmmo ? 4150 : isWeaponOrTool ? 2550 : 2150) * pitch;
    aBp.Q.value = isAmmo ? 5.6 : isWeaponOrTool ? 4.4 : 2.8;
    const aG = ctx.createGain();
    aG.gain.setValueAtTime(vol * (isAmmo ? 0.58 : 0.44), now + 0.026);
    aG.gain.exponentialRampToValueAtTime(0.0008, now + 0.056);
    accent.connect(aBp);
    aBp.connect(aG);
    aG.connect(ctx.destination);
    accent.start(now + 0.026, Math.random(), 0.036);

    if (isAmmo) {
      // Second tiny brass cartridge clink
      const clink = ctx.createOscillator();
      clink.type = 'sine';
      clink.frequency.setValueAtTime(3450 * pitch, now + 0.044);
      clink.frequency.exponentialRampToValueAtTime(2980 * pitch, now + 0.068);
      const cG = ctx.createGain();
      cG.gain.setValueAtTime(vol * 0.16, now + 0.044);
      cG.gain.exponentialRampToValueAtTime(0.0008, now + 0.072);
      clink.connect(cG);
      cG.connect(ctx.destination);
      clink.start(now + 0.044);
      clink.stop(now + 0.076);
    }
  }

  public playItemDrop(itemId = '') {
    if (!this.ctx || !this.noiseBuffer || this.muted) return;
    const wBuf = this.whiteNoiseBuffer ?? this.noiseBuffer;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const vol = this.masterVal * this.sfxVal * 0.28;
    if (vol <= 0.002) return;

    // 1. Cloth release rustle
    const rel = ctx.createBufferSource();
    rel.buffer = this.noiseBuffer;
    const rBp = ctx.createBiquadFilter();
    rBp.type = 'bandpass';
    rBp.frequency.setValueAtTime(1350, now);
    rBp.frequency.exponentialRampToValueAtTime(680, now + 0.065);
    const rG = ctx.createGain();
    rG.gain.setValueAtTime(vol * 0.5, now);
    rG.gain.exponentialRampToValueAtTime(0.0008, now + 0.07);
    rel.connect(rBp);
    rBp.connect(rG);
    rG.connect(ctx.destination);
    rel.start(now, Math.random(), 0.075);

    // 2. Physical ground impact thud at +75ms
    const hitT = now + 0.075;
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(84, hitT);
    sub.frequency.exponentialRampToValueAtTime(29, hitT + 0.075);
    const sG = ctx.createGain();
    sG.gain.setValueAtTime(vol * 0.72, hitT);
    sG.gain.exponentialRampToValueAtTime(0.0008, hitT + 0.082);
    sub.connect(sG);
    sG.connect(ctx.destination);
    sub.start(hitT);
    sub.stop(hitT + 0.088);

    const grit = ctx.createBufferSource();
    grit.buffer = wBuf;
    const gBp = ctx.createBiquadFilter();
    gBp.type = 'bandpass';
    const isMetallic =
      itemId.startsWith('ammo_') ||
      itemId === 'pistol' ||
      itemId === 'revolver' ||
      itemId === 'shotgun' ||
      itemId === 'crowbar' ||
      itemId === 'pipe_wrench' ||
      itemId === 'knife' ||
      itemId === 'axe' ||
      itemId === 'canned_beans';
    gBp.frequency.value = isMetallic ? 2950 : 1280;
    gBp.Q.value = isMetallic ? 4.2 : 1.8;
    const gG = ctx.createGain();
    gG.gain.setValueAtTime(vol * 0.58, hitT);
    gG.gain.exponentialRampToValueAtTime(0.0008, hitT + 0.055);
    grit.connect(gBp);
    gBp.connect(gG);
    gG.connect(ctx.destination);
    grit.start(hitT, Math.random(), 0.06);
  }

  public playGearShift() {
    if (!this.ctx || !this.noiseBuffer || this.muted) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const vol = this.masterVal * this.sfxVal * 0.2;
    if (vol <= 0.002) return;

    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(1080, now);
    bp.frequency.exponentialRampToValueAtTime(640, now + 0.065);
    bp.Q.value = 1.6;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol * 0.72, now);
    g.gain.exponentialRampToValueAtTime(0.0008, now + 0.072);
    src.connect(bp);
    bp.connect(g);
    g.connect(ctx.destination);
    src.start(now, Math.random() * 0.8, 0.078);
  }

  public playPhoneToggle(opening: boolean) {
    if (!this.ctx || !this.noiseBuffer || this.muted) return;
    const wBuf = this.whiteNoiseBuffer ?? this.noiseBuffer;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const vol = this.masterVal * this.sfxVal * 0.22;
    if (vol <= 0.002) return;

    // Crisp smartphone side-button tactile micro-click + subtle pocket cloth slide
    const click = ctx.createBufferSource();
    click.buffer = wBuf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = opening ? 3650 : 2850;
    bp.Q.value = 6.2;
    const cG = ctx.createGain();
    cG.gain.setValueAtTime(vol * 0.68, now);
    cG.gain.exponentialRampToValueAtTime(0.0008, now + 0.015);
    click.connect(bp);
    bp.connect(cG);
    cG.connect(ctx.destination);
    click.start(now, Math.random(), 0.02);

    const body = ctx.createOscillator();
    body.type = 'sine';
    body.frequency.setValueAtTime(opening ? 135 : 108, now);
    body.frequency.exponentialRampToValueAtTime(46, now + 0.036);
    const bG = ctx.createGain();
    bG.gain.setValueAtTime(vol * 0.42, now);
    bG.gain.exponentialRampToValueAtTime(0.0008, now + 0.04);
    body.connect(bG);
    bG.connect(ctx.destination);
    body.start(now);
    body.stop(now + 0.044);
  }

  public playMenuSelect() {
    if (!this.ctx || !this.noiseBuffer || this.muted) return;
    const wBuf = this.whiteNoiseBuffer ?? this.noiseBuffer;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const vol = this.masterVal * this.sfxVal * 0.24;
    if (vol <= 0.002) return;

    // Weighty AAA dark-thriller mechanical detent + low chassis thump
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(96, now);
    sub.frequency.exponentialRampToValueAtTime(34, now + 0.055);
    const sG = ctx.createGain();
    sG.gain.setValueAtTime(vol * 0.72, now);
    sG.gain.exponentialRampToValueAtTime(0.0008, now + 0.062);
    sub.connect(sG);
    sG.connect(ctx.destination);
    sub.start(now);
    sub.stop(now + 0.068);

    const snap = ctx.createBufferSource();
    snap.buffer = wBuf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2750;
    bp.Q.value = 5.4;
    const nG = ctx.createGain();
    nG.gain.setValueAtTime(vol * 0.62, now);
    nG.gain.exponentialRampToValueAtTime(0.0008, now + 0.018);
    snap.connect(bp);
    bp.connect(nG);
    nG.connect(ctx.destination);
    snap.start(now, Math.random(), 0.022);
  }

  public playWeaponBreak() {
    if (!this.ctx || !this.noiseBuffer || this.muted) return;
    const wBuf = this.whiteNoiseBuffer ?? this.noiseBuffer;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const vol = this.masterVal * this.sfxVal * 0.46;
    if (vol <= 0.002) return;

    // Violent structural metal/hardwood snap + clattering broken pieces on pavement
    const crack = ctx.createBufferSource();
    crack.buffer = wBuf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(2650, now);
    bp.frequency.exponentialRampToValueAtTime(720, now + 0.14);
    bp.Q.value = 2.1;
    const cG = ctx.createGain();
    cG.gain.setValueAtTime(vol, now);
    cG.gain.exponentialRampToValueAtTime(0.0008, now + 0.16);
    crack.connect(bp);
    bp.connect(cG);
    cG.connect(ctx.destination);
    crack.start(now, Math.random(), 0.17);

    for (const [off, hz, amp] of [
      [0.01, 1420, 0.34],
      [0.11, 2380, 0.24],
      [0.2, 1960, 0.16],
    ]) {
      const piece = ctx.createOscillator();
      piece.type = 'sine';
      piece.frequency.setValueAtTime(hz, now + off);
      piece.frequency.exponentialRampToValueAtTime(hz * 0.84, now + off + 0.065);
      const pG = ctx.createGain();
      pG.gain.setValueAtTime(vol * amp, now + off);
      pG.gain.exponentialRampToValueAtTime(0.0008, now + off + 0.072);
      piece.connect(pG);
      pG.connect(ctx.destination);
      piece.start(now + off);
      piece.stop(now + off + 0.078);
    }
  }

  public playBulletWallImpact(lx: number, ly: number, sx: number, sy: number) {
    const pos = this.getPositionalNodes(lx, ly, sx, sy, 760);
    if (!pos || !this.ctx || !this.noiseBuffer) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    if (now - this.lastWallImpactTime < 0.028) return;
    this.lastWallImpactTime = now;

    const wBuf = this.whiteNoiseBuffer ?? this.noiseBuffer;
    const pitch = 0.92 + Math.random() * 0.16;

    // Concrete masonry spall crack + gravel dust burst
    const spall = ctx.createBufferSource();
    spall.buffer = wBuf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(2450 * pitch, now);
    bp.frequency.exponentialRampToValueAtTime(680, now + 0.065);
    bp.Q.value = 1.8;
    const sG = ctx.createGain();
    sG.gain.setValueAtTime(pos.gainScale * 0.46, now);
    sG.gain.exponentialRampToValueAtTime(0.0008, now + 0.075);
    spall.connect(bp);
    bp.connect(sG);
    sG.connect(pos.out);
    spall.start(now, Math.random(), 0.085);

    const thud = ctx.createOscillator();
    thud.type = 'sine';
    thud.frequency.setValueAtTime(115 * pitch, now);
    thud.frequency.exponentialRampToValueAtTime(38, now + 0.048);
    const tG = ctx.createGain();
    tG.gain.setValueAtTime(pos.gainScale * 0.38, now);
    tG.gain.exponentialRampToValueAtTime(0.0008, now + 0.055);
    thud.connect(tG);
    tG.connect(pos.out);
    thud.start(now);
    thud.stop(now + 0.06);

    // Subtle 22% chance of an angled concrete ricochet zing
    if (Math.random() < 0.22) {
      const ric = ctx.createOscillator();
      ric.type = 'sine';
      const rStart = 2850 + Math.random() * 900;
      ric.frequency.setValueAtTime(rStart, now + 0.008);
      ric.frequency.exponentialRampToValueAtTime(920, now + 0.13);
      const rG = ctx.createGain();
      rG.gain.setValueAtTime(pos.gainScale * 0.14, now + 0.008);
      rG.gain.exponentialRampToValueAtTime(0.0008, now + 0.14);
      ric.connect(rG);
      rG.connect(pos.out);
      ric.start(now + 0.008);
      ric.stop(now + 0.145);
    }
  }

  public playAlarmDecoyPulse(lx: number, ly: number, sx: number, sy: number) {
    const pos = this.getPositionalNodes(lx, ly, sx, sy, 860);
    if (!pos || !this.ctx) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    // Improvised rigged tin piezo alarm buzzer double-chirp rattle
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2850;
    bp.Q.value = 3.6;
    bp.connect(pos.out);

    for (const [off, dur] of [
      [0, 0.085],
      [0.115, 0.095],
    ]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(2740, now + off);
      const mod = ctx.createOscillator();
      mod.frequency.value = 58;
      const mG = ctx.createGain();
      mG.gain.value = 185;
      mod.connect(mG);
      mG.connect(osc.frequency);

      const g = ctx.createGain();
      g.gain.setValueAtTime(pos.gainScale * 0.34, now + off);
      g.gain.exponentialRampToValueAtTime(0.0008, now + off + dur);
      osc.connect(g);
      g.connect(bp);
      osc.start(now + off);
      mod.start(now + off);
      osc.stop(now + off + dur + 0.01);
      mod.stop(now + off + dur + 0.01);
    }
  }

  public playGeneratorIgnite() {
    if (!this.ctx || !this.noiseBuffer || this.muted) return;
    const wBuf = this.whiteNoiseBuffer ?? this.noiseBuffer;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const vol = this.masterVal * this.sfxVal * 0.44;
    if (vol <= 0.002) return;

    // 1. Pull-cord starter rip (0.0s - 0.18s)
    const cord = ctx.createBufferSource();
    cord.buffer = wBuf;
    const cBp = ctx.createBiquadFilter();
    cBp.type = 'bandpass';
    cBp.frequency.setValueAtTime(1450, now);
    cBp.frequency.exponentialRampToValueAtTime(3200, now + 0.16);
    cBp.Q.value = 2.6;
    const cG = ctx.createGain();
    cG.gain.setValueAtTime(vol * 0.65, now);
    cG.gain.exponentialRampToValueAtTime(0.0008, now + 0.18);
    cord.connect(cBp);
    cBp.connect(cG);
    cG.connect(ctx.destination);
    cord.start(now, Math.random(), 0.19);

    // 2. Three accelerating diesel compression chugs -> engine catches & roars
    for (const [off, hz] of [
      [0.18, 52],
      [0.29, 64],
      [0.38, 78],
    ]) {
      const chug = ctx.createOscillator();
      chug.type = 'sawtooth';
      chug.frequency.setValueAtTime(hz, now + off);
      chug.frequency.exponentialRampToValueAtTime(34, now + off + 0.08);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 260;
      const g = ctx.createGain();
      g.gain.setValueAtTime(vol * 0.68, now + off);
      g.gain.exponentialRampToValueAtTime(0.0008, now + off + 0.085);
      chug.connect(lp);
      lp.connect(g);
      g.connect(ctx.destination);
      chug.start(now + off);
      chug.stop(now + off + 0.09);
    }

    // 3. Heavy halogen floodlight relay contactor KA-CHUNK! at +0.48s + warm transformer hum
    const relayT = now + 0.48;
    const clack = ctx.createBufferSource();
    clack.buffer = wBuf;
    const rBp = ctx.createBiquadFilter();
    rBp.type = 'bandpass';
    rBp.frequency.value = 2850;
    rBp.Q.value = 4.2;
    const rG = ctx.createGain();
    rG.gain.setValueAtTime(vol * 0.85, relayT);
    rG.gain.exponentialRampToValueAtTime(0.0008, relayT + 0.038);
    clack.connect(rBp);
    rBp.connect(rG);
    rG.connect(ctx.destination);
    clack.start(relayT, Math.random(), 0.045);

    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(112, relayT);
    sub.frequency.exponentialRampToValueAtTime(36, relayT + 0.18);
    const sG = ctx.createGain();
    sG.gain.setValueAtTime(vol * 0.88, relayT);
    sG.gain.exponentialRampToValueAtTime(0.0008, relayT + 0.2);
    sub.connect(sG);
    sG.connect(ctx.destination);
    sub.start(relayT);
    sub.stop(relayT + 0.22);

    const hum = ctx.createOscillator();
    hum.type = 'sawtooth';
    hum.frequency.setValueAtTime(60, relayT + 0.02);
    hum.frequency.linearRampToValueAtTime(92, relayT + 0.45);
    const hLp = ctx.createBiquadFilter();
    hLp.type = 'lowpass';
    hLp.frequency.value = 220;
    const hG = ctx.createGain();
    hG.gain.setValueAtTime(0.001, relayT + 0.02);
    hG.gain.linearRampToValueAtTime(vol * 0.34, relayT + 0.12);
    hG.gain.exponentialRampToValueAtTime(0.0008, relayT + 0.68);
    hum.connect(hLp);
    hLp.connect(hG);
    hG.connect(ctx.destination);
    hum.start(relayT + 0.02);
    hum.stop(relayT + 0.7);
  }

  public playHourlyBell(hourIndex: number) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const vol = this.masterVal * this.sfxVal * 0.32;
    if (vol <= 0.002) return;

    // Deep cinematic survival-horror hourly dread toll (low D1 sub-impact + dark bronze partials)
    const rootHz = hourIndex >= 5 ? 73.42 : 65.41;
    for (const [ratio, mult, dur] of [
      [0.5, 0.88, 1.55],
      [1.0, 0.52, 1.35],
      [1.498, 0.22, 1.05],
      [2.38, 0.11, 0.78],
    ]) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(rootHz * ratio, now);
      osc.frequency.exponentialRampToValueAtTime(rootHz * ratio * 0.985, now + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.001, now);
      g.gain.linearRampToValueAtTime(vol * mult, now + 0.018);
      g.gain.exponentialRampToValueAtTime(0.0008, now + dur);
      osc.connect(g);
      g.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + dur + 0.03);
    }
  }

  public playDeathSting() {
    if (!this.ctx || !this.noiseBuffer || this.muted) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const vol = this.masterVal * this.sfxVal * 0.5;
    if (vol <= 0.002) return;

    // Deep visceral collapse sub-drop + dark minor-second bowed dread fade
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(82, now);
    sub.frequency.exponentialRampToValueAtTime(21, now + 1.15);
    const sG = ctx.createGain();
    sG.gain.setValueAtTime(vol * 0.95, now);
    sG.gain.exponentialRampToValueAtTime(0.0008, now + 1.25);
    sub.connect(sG);
    sG.connect(ctx.destination);
    sub.start(now);
    sub.stop(now + 1.3);

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(680, now);
    lp.frequency.exponentialRampToValueAtTime(140, now + 1.35);
    lp.connect(ctx.destination);

    for (const hz of [130.81, 138.59]) {
      const bow = ctx.createOscillator();
      bow.type = 'sawtooth';
      bow.frequency.setValueAtTime(hz, now + 0.04);
      bow.frequency.exponentialRampToValueAtTime(hz * 0.86, now + 1.35);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.001, now + 0.04);
      g.gain.linearRampToValueAtTime(vol * 0.24, now + 0.18);
      g.gain.exponentialRampToValueAtTime(0.0008, now + 1.38);
      bow.connect(g);
      g.connect(lp);
      bow.start(now + 0.04);
      bow.stop(now + 1.42);
    }
  }

  public playExtractionVictory() {
    if (!this.ctx || !this.noiseBuffer || this.muted) return;
    const wBuf = this.whiteNoiseBuffer ?? this.noiseBuffer;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const vol = this.masterVal * this.sfxVal * 0.45;
    if (vol <= 0.002) return;

    // Heavy helicopter cabin door slide-lock CLACK-THUD + soaring turbine climb swell
    const slide = ctx.createBufferSource();
    slide.buffer = wBuf;
    const sBp = ctx.createBiquadFilter();
    sBp.type = 'bandpass';
    sBp.frequency.setValueAtTime(1150, now);
    sBp.frequency.linearRampToValueAtTime(2200, now + 0.18);
    const slG = ctx.createGain();
    slG.gain.setValueAtTime(vol * 0.55, now);
    slG.gain.exponentialRampToValueAtTime(0.0008, now + 0.2);
    slide.connect(sBp);
    sBp.connect(slG);
    slG.connect(ctx.destination);
    slide.start(now, Math.random(), 0.21);

    const slam = ctx.createOscillator();
    slam.type = 'sine';
    slam.frequency.setValueAtTime(98, now + 0.18);
    slam.frequency.exponentialRampToValueAtTime(32, now + 0.36);
    const smG = ctx.createGain();
    smG.gain.setValueAtTime(vol * 0.88, now + 0.18);
    smG.gain.exponentialRampToValueAtTime(0.0008, now + 0.38);
    slam.connect(smG);
    smG.connect(ctx.destination);
    slam.start(now + 0.18);
    slam.stop(now + 0.4);

    // Warm dawn relief chord & turbine lift
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(480, now + 0.2);
    lp.frequency.exponentialRampToValueAtTime(1250, now + 1.1);
    lp.connect(ctx.destination);

    for (const [hz, mult] of [
      [146.83, 0.32],
      [220.0, 0.26],
      [293.66, 0.2],
    ]) {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(hz, now + 0.2);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.001, now + 0.2);
      g.gain.linearRampToValueAtTime(vol * mult, now + 0.48);
      g.gain.exponentialRampToValueAtTime(0.0008, now + 1.55);
      osc.connect(g);
      g.connect(lp);
      osc.start(now + 0.2);
      osc.stop(now + 1.6);
    }
  }

  public async decodeWavData(arrayBuffer: ArrayBuffer): Promise<AudioBuffer | null> {
    this.ensureUnlocked();
    if (!this.ctx) return null;
    try {
      return await this.ctx.decodeAudioData(arrayBuffer.slice(0));
    } catch {
      return null;
    }
  }

  public playRadioVoiceBuffer(
    buffer: AudioBuffer,
    profile: RadioVoiceFilterProfile,
    onEnded: () => void
  ): { stop: () => void; sampleLevel: () => number } {
    this.ensureUnlocked();
    if (!this.ctx) {
      setTimeout(onEnded, Math.max(100, buffer.duration * 1000));
      return { stop: () => {}, sampleLevel: () => 0 };
    }

    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buffer;

    const isUnknown = profile === 'unknown_whisper';
    const isField =
      profile === 'field_walkie' || profile === 'field_whisper' || isUnknown;
    const isWhisper = profile === 'field_whisper' || isUnknown;
    const isWeakAnchor = profile === 'studio_anchor_weak';
    const isDesperate =
      profile === 'studio_anchor_desperate' ||
      profile === 'studio_anchor_tense' ||
      isWeakAnchor;

    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = isUnknown ? 430 : isField ? 490 : isWeakAnchor ? 380 : 250;

    const presence = ctx.createBiquadFilter();
    presence.type = 'peaking';
    presence.frequency.value = isUnknown ? 1480 : isField ? 1720 : 2050;
    presence.Q.value = isUnknown ? 2.1 : isField ? 1.85 : 1.25;
    presence.gain.value = isUnknown ? 5.2 : isField ? 6.5 : 4.8;

    const shaper = ctx.createWaveShaper();
    shaper.curve = makeRadioDriveCurve(
      isUnknown ? 1.9 : isField ? 2.4 : isWeakAnchor ? 2.1 : isDesperate ? 1.35 : 0.85
    );
    shaper.oversample = '2x';

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = isUnknown
      ? 2350
      : isField
      ? isWhisper
        ? 2950
        : 2600
      : isWeakAnchor
      ? 2850
      : isDesperate
      ? 3550
      : 4250;

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = isWhisper ? -30 : -22;
    comp.knee.value = 12;
    comp.ratio.value = isWhisper ? 8 : 5;
    comp.attack.value = 0.004;
    comp.release.value = 0.14;

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 64;
    const timeData = new Uint8Array(analyser.fftSize);

    const boost = isUnknown
      ? 1.18
      : isWhisper
      ? 1.55
      : isWeakAnchor
      ? 1.05
      : isField
      ? 1.22
      : 1.15;
    this.activeVoiceBoost = boost;
    const outGain = ctx.createGain();
    outGain.gain.value = this.getEffectiveRadioVolume() * boost;
    this.activeVoiceGain = outGain;

    src.connect(hp);
    hp.connect(presence);
    presence.connect(shaper);
    shaper.connect(lp);
    lp.connect(comp);
    comp.connect(analyser);
    analyser.connect(outGain);
    outGain.connect(ctx.destination);

    let finished = false;
    const cleanup = () => {
      if (finished) return;
      finished = true;
      if (this.activeVoiceGain === outGain) {
        this.activeVoiceGain = null;
      }
      onEnded();
    };

    src.onended = cleanup;
    src.start();

    return {
      stop: () => {
        if (finished) return;
        finished = true;
        if (this.activeVoiceGain === outGain) {
          this.activeVoiceGain = null;
        }
        try {
          src.onended = null;
          src.stop();
        } catch {
          // ignore
        }
      },
      sampleLevel: () => {
        if (finished || this.muted) return 0;
        analyser.getByteTimeDomainData(timeData);
        let sumSq = 0;
        for (let i = 0; i < timeData.length; i++) {
          const norm = (timeData[i] - 128) / 128;
          sumSq += norm * norm;
        }
        const rms = Math.sqrt(sumSq / timeData.length);
        return Math.min(1, rms * 3.8);
      },
    };
  }

  public playRadioSfxCue(kind: RadioSfxCueKind, durationMs: number) {
    this.ensureUnlocked();
    if (!this.ctx || !this.noiseBuffer || this.muted) return;
    const vol = this.getEffectiveRadioVolume();
    if (vol <= 0.002) return;

    const ctx = this.ctx;
    const now = ctx.currentTime;
    const durSec = Math.max(0.15, durationMs / 1000);

    if (kind === 'breaking_news_intro' || kind === 'breaking_news_distorted') {
      const distorted = kind === 'breaking_news_distorted';
      // 1. Urgent Breaking News Bulletin Pulse ("ba-da-da-da, DUM-DUM!")
      const notes = [880, 659.25, 880, 659.25, 1046.5, 880];
      notes.forEach((freq, idx) => {
        const t0 = now + idx * 0.095;
        const osc = ctx.createOscillator();
        osc.type = idx >= 4 ? 'sawtooth' : 'triangle';
        osc.frequency.setValueAtTime(
          distorted ? freq * (0.97 + Math.random() * 0.05) : freq,
          t0
        );
        const flt = ctx.createBiquadFilter();
        flt.type = 'bandpass';
        flt.frequency.value = 1650;
        flt.Q.value = 1.2;
        const g = ctx.createGain();
        g.gain.setValueAtTime(vol * (idx >= 4 ? 0.24 : 0.18), t0);
        g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.085);
        osc.connect(flt);
        flt.connect(g);
        g.connect(ctx.destination);
        osc.start(t0);
        osc.stop(t0 + 0.09);
      });

      // Deep newsroom urgency bed swell
      const bass = ctx.createOscillator();
      bass.type = 'sawtooth';
      bass.frequency.setValueAtTime(110, now);
      bass.frequency.linearRampToValueAtTime(146.83, now + 0.65);
      const bLp = ctx.createBiquadFilter();
      bLp.type = 'lowpass';
      bLp.frequency.value = 340;
      const bG = ctx.createGain();
      bG.gain.setValueAtTime(0.001, now);
      bG.gain.linearRampToValueAtTime(vol * 0.26, now + 0.12);
      bG.gain.exponentialRampToValueAtTime(0.001, now + 0.72);
      bass.connect(bLp);
      bLp.connect(bG);
      bG.connect(ctx.destination);
      bass.start(now);
      bass.stop(now + 0.75);

      // 2. Official Civil Protection EAS Dual-Tone Header (853 Hz + 960 Hz)
      const easStart = now + 0.72;
      const easDur = 0.72;
      for (const easFreq of [853, 960]) {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(easFreq, easStart);
        if (distorted) {
          const lfo = ctx.createOscillator();
          lfo.frequency.value = 7.5;
          const lfoG = ctx.createGain();
          lfoG.gain.value = 18;
          lfo.connect(lfoG);
          lfoG.connect(osc.frequency);
          lfo.start(easStart);
          lfo.stop(easStart + easDur);
        }
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = 1200;
        bp.Q.value = 1.1;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.001, easStart);
        g.gain.linearRampToValueAtTime(vol * 0.14, easStart + 0.03);
        g.gain.setValueAtTime(vol * 0.14, easStart + easDur - 0.05);
        g.gain.exponentialRampToValueAtTime(0.001, easStart + easDur);
        osc.connect(bp);
        bp.connect(g);
        g.connect(ctx.destination);
        osc.start(easStart);
        osc.stop(easStart + easDur + 0.02);
      }

      // 3. VHF Squelch Open Burst
      const sqStart = now + 1.48;
      const nSrc = ctx.createBufferSource();
      nSrc.buffer = this.noiseBuffer;
      const nBp = ctx.createBiquadFilter();
      nBp.type = 'bandpass';
      nBp.frequency.value = 1950;
      nBp.Q.value = 2.1;
      const nG = ctx.createGain();
      nG.gain.setValueAtTime(vol * (distorted ? 0.36 : 0.22), sqStart);
      nG.gain.exponentialRampToValueAtTime(0.001, sqStart + 0.22);
      nSrc.connect(nBp);
      nBp.connect(nG);
      nG.connect(ctx.destination);
      nSrc.start(sqStart, 0, 0.24);
      return;
    }

    if (kind === 'static_burst' || kind === 'long_static' || kind === 'heavy_static') {
      const isHeavy = kind === 'heavy_static';
      const nSrc = ctx.createBufferSource();
      nSrc.buffer = this.noiseBuffer;
      nSrc.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(isHeavy ? 920 : 1150, now);
      bp.frequency.linearRampToValueAtTime(isHeavy ? 3100 : 2450, now + durSec * 0.45);
      bp.frequency.linearRampToValueAtTime(isHeavy ? 840 : 1350, now + durSec);
      bp.Q.value = isHeavy ? 1.15 : 1.6;

      const g = ctx.createGain();
      g.gain.setValueAtTime(vol * (isHeavy ? 0.48 : 0.34), now);
      g.gain.setValueAtTime(
        vol * (isHeavy ? 0.52 : kind === 'long_static' ? 0.38 : 0.3),
        now + durSec * 0.72
      );
      g.gain.exponentialRampToValueAtTime(0.001, now + durSec);

      nSrc.connect(bp);
      bp.connect(g);
      g.connect(ctx.destination);
      nSrc.start(now);
      nSrc.stop(now + durSec + 0.02);

      if (kind === 'long_static' || isHeavy) {
        // Eerie shortwave heterodyne carrier whistle
        const het = ctx.createOscillator();
        het.type = isHeavy ? 'sawtooth' : 'sine';
        het.frequency.setValueAtTime(isHeavy ? 1820 : 1540, now + 0.08);
        het.frequency.exponentialRampToValueAtTime(isHeavy ? 310 : 590, now + durSec * 0.62);
        het.frequency.linearRampToValueAtTime(isHeavy ? 690 : 1180, now + durSec * 0.95);
        const hFlt = ctx.createBiquadFilter();
        hFlt.type = 'bandpass';
        hFlt.frequency.value = 1200;
        const hG = ctx.createGain();
        hG.gain.setValueAtTime(0.001, now);
        hG.gain.linearRampToValueAtTime(vol * (isHeavy ? 0.11 : 0.085), now + 0.3);
        hG.gain.exponentialRampToValueAtTime(0.001, now + durSec);
        het.connect(hFlt);
        hFlt.connect(hG);
        hG.connect(ctx.destination);
        het.start(now);
        het.stop(now + durSec + 0.02);
      }
      return;
    }

    if (kind === 'tense_pause') {
      const hum = ctx.createOscillator();
      hum.type = 'sine';
      hum.frequency.value = 120;
      const hG = ctx.createGain();
      hG.gain.setValueAtTime(vol * 0.04, now);
      hG.gain.exponentialRampToValueAtTime(0.001, now + durSec);
      hum.connect(hG);
      hG.connect(ctx.destination);
      hum.start(now);
      hum.stop(now + durSec);
      return;
    }

    if (kind === 'transmission_lost') {
      // Static burst + 3 lost-carrier warning pips
      const nSrc = ctx.createBufferSource();
      nSrc.buffer = this.noiseBuffer;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1850;
      const nG = ctx.createGain();
      nG.gain.setValueAtTime(vol * 0.35, now);
      nG.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
      nSrc.connect(bp);
      bp.connect(nG);
      nG.connect(ctx.destination);
      nSrc.start(now, 0, 0.48);

      for (const [offset, freq, len] of [
        [0.32, 960, 0.14],
        [0.54, 960, 0.14],
        [0.76, 520, 0.58],
      ]) {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + offset);
        const g = ctx.createGain();
        g.gain.setValueAtTime(vol * 0.2, now + offset);
        g.gain.exponentialRampToValueAtTime(0.001, now + offset + len);
        osc.connect(g);
        g.connect(ctx.destination);
        osc.start(now + offset);
        osc.stop(now + offset + len + 0.02);
      }
      return;
    }

    if (kind === 'transmission_cuts') {
      // Violent microphone impact thud + sharp squelch snap
      const thud = ctx.createOscillator();
      thud.type = 'triangle';
      thud.frequency.setValueAtTime(165, now);
      thud.frequency.exponentialRampToValueAtTime(32, now + 0.18);
      const tG = ctx.createGain();
      tG.gain.setValueAtTime(vol * 0.48, now);
      tG.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
      thud.connect(tG);
      tG.connect(ctx.destination);
      thud.start(now);
      thud.stop(now + 0.22);

      const nSrc = ctx.createBufferSource();
      nSrc.buffer = this.noiseBuffer;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 1600;
      const nG = ctx.createGain();
      nG.gain.setValueAtTime(vol * 0.42, now + 0.04);
      nG.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
      nSrc.connect(hp);
      hp.connect(nG);
      nG.connect(ctx.destination);
      nSrc.start(now + 0.04, 0, 0.26);
      return;
    }

    if (kind === 'squelch_out') {
      for (const [offset, freq] of [
        [0, 1180],
        [0.09, 880],
      ]) {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + offset);
        const g = ctx.createGain();
        g.gain.setValueAtTime(vol * 0.16, now + offset);
        g.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.075);
        osc.connect(g);
        g.connect(ctx.destination);
        osc.start(now + offset);
        osc.stop(now + offset + 0.08);
      }
      const nSrc = ctx.createBufferSource();
      nSrc.buffer = this.noiseBuffer;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1900;
      const nG = ctx.createGain();
      nG.gain.setValueAtTime(vol * 0.22, now + 0.18);
      nG.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
      nSrc.connect(bp);
      bp.connect(nG);
      nG.connect(ctx.destination);
      nSrc.start(now + 0.18, 0, 0.24);
    }
  }

  public destroy() {
    if (this.horrorDuckTimer !== null) {
      window.clearTimeout(this.horrorDuckTimer);
      this.horrorDuckTimer = null;
    }
    if (this.musicAudio) {
      this.musicAudio.pause();
      this.musicAudio.src = '';
      this.musicAudio = null;
    }
    if (this.ctx) {
      this.ctx.close().catch(() => {});
      this.ctx = null;
    }
  }
}

