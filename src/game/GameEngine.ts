import { CONFIG, DISTRICT_LABELS } from '../config';
import {
  buildHospitalRadioBroadcast,
  buildHourlyMilestones,
  DYNAMIC_EVENT_POOL,
  HourlyMilestone,
} from '../data/events';
import {
  formatBroadcastSummaryText,
  RADIO_BROADCASTS,
  RadioBroadcastDef,
  RadioBroadcastId,
} from '../data/radioBroadcasts';
import { ITEMS } from '../data/items';
import { buildCityWorld, isSolidTile, WorldBuildOptions, WorldMapData } from '../data/map';
import { SoundEngine, SurfaceMaterial } from '../engine/audio';
import { Camera } from '../engine/camera';
import { hasLineOfSight, resolveCircleWorldCollision } from '../engine/collision';
import { InputManager } from '../engine/input';
import { RadioBroadcastPlayer } from '../engine/radioPlayer';
import { WorldRenderer } from '../engine/renderer';
import {
  InitialWorldSyncPayload,
  MultiplayerClient,
  NetPlayerPayload,
  RoomLobbyPayload,
} from '../network/MultiplayerClient';
import { VoiceChatManager } from '../network/VoiceChatManager';
import { formatCountdown, formatGameClock, getHourIndex } from '../systems/clock';
import {
  performPlayerAttack,
  spawnRemoteVisualProjectiles,
  startWeaponReload,
  updateProjectiles,
  updateReloadTimer,
} from '../systems/combat';
import { updateEnemiesAI } from '../systems/enemy-ai';
import {
  createInitialExtractionState,
  updateExtractionSequence,
} from '../systems/extraction';
import {
  addItemToBackpack,
  calculateBackpackWeight,
  consumeItemQuantity,
  countItemInBackpack,
  swapSlots,
} from '../systems/inventory';
import { createItemInstance } from '../systems/loot';
import {
  loadRecords,
  loadSettings,
  recordCompletedRun,
  saveSettings,
} from '../systems/storage';
import {
  applyBackpackItemEffect,
  updateSurvivalAttributes,
} from '../systems/survival';
import {
  ActiveFlare,
  ActiveRadioBroadcastState,
  CampaignStage,
  ContainerEntity,
  ExtractionState,
  GameScreenState,
  GameSettings,
  GroundItem,
  InteractionPrompt,
  InventoryItemInstance,
  KillFeedEntry,
  ChatMessage,
  LobbyPlayerSummary,
  NoiseEvent,
  ObstacleProp,
  OnlineSessionSnapshot,
  OverlayPanel,
  Particle,
  PersistentRecords,
  PlayerState,
  Projectile,
  PublicRoomSummary,
  RadioMessage,
  RemoteSurvivorState,
  RunStats,
  TileType,
  UISnapshot,
} from '../types';

const CALLSIGN_STORAGE_KEY = 'last_night_callsign_v1';
const INGAME_MUSIC_MIX_SCALE = 0.68;

function loadSavedCallsign(): string {
  try {
    const saved = localStorage.getItem(CALLSIGN_STORAGE_KEY);
    if (saved && saved.trim().length >= 2) return saved.trim().slice(0, 16);
  } catch {
    // ignore storage errors
  }
  const suffix = Math.floor(100 + Math.random() * 900);
  return `ECHO-${suffix}`;
}

function angleToCardinal(rad: number): string {
  const deg = ((rad * 180) / Math.PI + 360) % 360;
  if (deg >= 337.5 || deg < 22.5) return 'E';
  if (deg < 67.5) return 'SE';
  if (deg < 112.5) return 'S';
  if (deg < 157.5) return 'SW';
  if (deg < 202.5) return 'W';
  if (deg < 247.5) return 'NW';
  if (deg < 292.5) return 'N';
  return 'NE';
}

export class GameEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  public input = new InputManager();
  private cam = new Camera();
  private renderer = new WorldRenderer();
  private sound = new SoundEngine();
  private radioPlayer: RadioBroadcastPlayer;
  private mp: MultiplayerClient;

  private rafId = 0;
  private lastTimestamp = 0;
  private uiSyncTimer = 0;
  private netSyncTimer = 0;
  private onUISnapshot: (snap: UISnapshot) => void;

  private screen: GameScreenState = 'TITLE';
  private panel: OverlayPanel = 'NONE';
  private settings: GameSettings;
  private records: PersistentRecords;

  private world: WorldMapData;
  private milestones: HourlyMilestone[] = [];
  private player!: PlayerState;
  private backpack: (InventoryItemInstance | null)[] = Array(CONFIG.BACKPACK_SLOTS).fill(null);
  private projectiles: Projectile[] = [];
  private particles: Particle[] = [];
  private noises: NoiseEvent[] = [];
  private flares: ActiveFlare[] = [];
  private extraction!: ExtractionState;

  // Online Matchmaking & Authoritative PvPvE State
  private isOnlineMatch = false;
  private wsConnected = false;
  private selfId: string | null = null;
  private callsign = loadSavedCallsign();
  private roomId: string | null = null;
  private roomCode: string | null = null;
  private onlinePhase: OnlineSessionSnapshot['phase'] = 'IDLE';
  private lobbyCountdownSeconds = 50;
  private lobbyPlayerCount = 0;
  private lobbyMaxPlayers = 20;
  private lobbyMinAutoStart = 2;
  private localPlayerColor = '#3f523a';
  private onlineAliveCount = 0;
  private onlineTotalParticipants = 0;
  private selfReady = false;
  private onlineErrorMessage: string | null = null;
  private onlineConnectTimer: number | null = null;
  private lobbyRoster: LobbyPlayerSummary[] = [];
  private publicLobbies: PublicRoomSummary[] = [];
  private killFeed: KillFeedEntry[] = [];
  private chatMessages: ChatMessage[] = [];
  private unreadChatCount = 0;
  public isTalking = false;
  private remoteSurvivors = new Map<string, RemoteSurvivorState>();
  private voiceChat: VoiceChatManager | null = null;
  private pendingSpawnPos: { x: number; y: number } | null = null;
  private serverElapsedSeconds = 0;
  private survivorsInLZ = 0;
  private extractionContested = false;
  private localPvpKills = 0;
  private localPlacement: number | undefined = undefined;
  private matchWinnerCallsign: string | null = null;
  private deathLootDropped = false;

  private campaignStage: CampaignStage = 'ESCAPE_VILLAGE';
  private injectionTaken = false;
  private radioDiscovered = false;

  private elapsedSeconds = 0;
  private currentHourIndex = 0;
  private triggeredHours = new Set<number>();
  private powerGridOnline = true;
  private activeWeatherEventTimer = 0;
  private isHeavyRain = false;
  private nextRandomEventTimer = 75;
  private hitstopTimer = 0;
  private deathDelayTimer = 0;

  private searchingContainer: ContainerEntity | null = null;
  private searchProgressSec = 0;
  private searchRummageTimer = 0;
  private searchRummageStep = 0;
  private activeContainer: ContainerEntity | null = null;

  private radioMessages: RadioMessage[] = [];
  private unreadRadioCount = 0;
  private triggeredBroadcastIds = new Set<RadioBroadcastId>();
  private preloadedBroadcastIds = new Set<RadioBroadcastId>();
  private activeRadioBroadcast: ActiveRadioBroadcastState | null = null;
  private latestToast: { id: string; title: string; text: string; urgent: boolean } | null = null;
  private toastTimer = 0;

  private runStats!: RunStats;

  constructor(canvas: HTMLCanvasElement, onUISnapshot: (snap: UISnapshot) => void) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.onUISnapshot = onUISnapshot;

    this.settings = loadSettings();
    this.records = loadRecords();
    this.sound.initMainMusic();
    this.sound.setMusicMixScale(1.0);
    this.sound.applySettings(this.settings);
    this.radioPlayer = new RadioBroadcastPlayer(this.sound, (nextRadioState) => {
      this.activeRadioBroadcast = nextRadioState;
      this.emitSnapshot();
    });

    this.mp = new MultiplayerClient({
      onConnectionChange: (connected, selfId) => {
        this.wsConnected = connected;
        if (selfId) this.selfId = selfId;
        if (connected && this.onlineConnectTimer !== null) {
          window.clearTimeout(this.onlineConnectTimer);
          this.onlineConnectTimer = null;
        }
        if (connected && this.onlineErrorMessage) {
          this.onlineErrorMessage = null;
        }
        this.emitSnapshot();
      },
      onLobbiesList: (lobbies) => {
        this.publicLobbies = lobbies;
        this.emitSnapshot();
      },
      onRoomJoined: (selfId, spawnPos, lobby) => {
        this.selfId = selfId;
        this.pendingSpawnPos = spawnPos;
        this.onlineErrorMessage = null;
        this.applyRoomLobbyPayload(lobby);
        this.emitSnapshot();
      },
      onRoomUpdated: (lobby) => {
        this.applyRoomLobbyPayload(lobby);
        this.emitSnapshot();
      },
      onRoomLeft: (lobbies) => {
        this.resetOnlineSessionState();
        this.publicLobbies = lobbies;
        this.emitSnapshot();
      },
      onMatchmakingError: (message) => {
        this.onlineErrorMessage = message;
        this.emitSnapshot();
      },
      onMatchStarted: (lobby, worldSync, players) => {
        this.startAuthoritativeOnlineMatch(lobby, worldSync, players);
      },
      onPlayerJoinedMidMatch: (netPlayer, lobby) => {
        this.applyRoomLobbyPayload(lobby);
        this.upsertRemoteSurvivor(netPlayer, true);
        if (this.voiceChat) this.voiceChat.ensurePeer(netPlayer.id);
        this.pushToast(
          'Survivor Entered Sector',
          `${netPlayer.callsign} arrived in Oakhaven (${lobby.aliveCount} alive).`,
          false
        );
        this.emitSnapshot();
      },
      onPlayerLeftMidMatch: (playerId, callsign, aliveRemaining) => {
        this.remoteSurvivors.delete(playerId);
        if (this.voiceChat) this.voiceChat.removePeer(playerId);
        this.onlineAliveCount = aliveRemaining;
        this.pushToast(
          'Signal Lost',
          `${callsign} disconnected (${aliveRemaining} survivors remaining).`,
          false
        );
        this.emitSnapshot();
      },
      onWorldTick: (data) => {
        if (!this.isOnlineMatch) return;
        this.serverElapsedSeconds = data.elapsedSeconds;
        this.onlineAliveCount = data.aliveCount;
        this.onlineTotalParticipants = data.totalParticipants;
        this.survivorsInLZ = data.survivorsInLZ;
        this.extractionContested = data.extractionContested;
        if (this.extraction) {
          this.extraction.survivorsInLZ = data.survivorsInLZ;
          this.extraction.contested = data.extractionContested;
        }
        const seenIds = new Set<string>();
        for (const np of data.players) {
          if (np.id === this.selfId) {
            this.localPvpKills = np.pvpKills;
            this.runStats.pvpKills = np.pvpKills;
            if (np.color) this.localPlayerColor = np.color;
            continue;
          }
          seenIds.add(np.id);
          this.upsertRemoteSurvivor(np, false);
        }
        for (const existingId of this.remoteSurvivors.keys()) {
          if (!seenIds.has(existingId)) {
            this.remoteSurvivors.delete(existingId);
            if (this.voiceChat) this.voiceChat.removePeer(existingId);
          }
        }
      },
      onRemoteAttack: (data) => {
        if (!this.isOnlineMatch || this.screen !== 'PLAYING') return;
        // Remote weapon noise alerts local Hollow AI and shows acoustic ring!
        this.emitNoise(data.x, data.y, data.noiseRadius, 0.9, data.label);
        if (data.kind === 'projectile') {
          const gunKind =
            data.weaponId === 'shotgun'
              ? 'shotgun'
              : data.weaponId === 'revolver'
              ? 'revolver'
              : 'pistol';
          this.sound.playPositionalGunshot(
            gunKind,
            this.player.x,
            this.player.y,
            data.x,
            data.y
          );
          this.spawnParticles(data.x, data.y, data.weaponId === 'shotgun' ? 8 : 4, '#fde047', 140, 0.11);
          spawnRemoteVisualProjectiles(
            this.projectiles,
            data.x,
            data.y,
            data.angle,
            data.pellets,
            data.spread,
            data.speed,
            data.range
          );
        } else {
          const rs = this.remoteSurvivors.get(data.attackerId);
          if (rs) {
            rs.meleeSwingTimer = 0.22;
            rs.animState = 'melee';
          }
        }
      },
      onLocalPlayerDamaged: (data) => {
        if (!this.isOnlineMatch || this.player.animState === 'dead') return;
        this.player.health = Math.max(0, data.newHealth);
        this.player.hurtFlash = 0.26;
        this.runStats.damageTaken += data.damage;
        this.sound.playPlayerHurt();
        this.cam.addShake(7.0, this.settings.screenShake);
        this.input.vibrate(230, 0.75, 0.95, this.settings.controllerVibration);
        this.spawnParticles(this.player.x, this.player.y, 12, '#dc2626', 135, 0.42);
        if (Math.random() < data.bleedChance && !this.player.conditions.bleeding) {
          this.player.conditions.bleeding = true;
          this.player.bleedTimer = CONFIG.BLEEDING_DURATION_SEC;
        }
        if (this.player.health <= 0) {
          this.killPlayer(`Eliminated by ${data.attackerCallsign} (${data.weaponName})`, true);
        } else {
          this.pushToast(
            `Hit by ${data.attackerCallsign}!`,
            `Took ${data.damage} DMG from ${data.weaponName}!`,
            true
          );
        }
        this.emitSnapshot();
      },
      onCombatHitFx: (data) => {
        if (!this.isOnlineMatch) return;
        if (data.targetId !== this.selfId) {
          const rs = this.remoteSurvivors.get(data.targetId);
          if (rs) rs.hurtFlash = 0.2;
          this.spawnParticles(data.x, data.y, 8, '#dc2626', 110, 0.32);
        }
      },
      onPlayerEliminated: (data) => {
        if (!this.isOnlineMatch) return;
        this.onlineAliveCount = data.aliveRemaining;
        const entry: KillFeedEntry = {
          id: `kf_${Date.now()}_${Math.random()}`,
          victimCallsign: data.victimCallsign,
          killerCallsign: data.killerCallsign,
          weaponName: data.weaponName,
          timestamp: Date.now(),
        };
        this.killFeed = [entry, ...this.killFeed].slice(0, 5);

        if (data.victimId === this.selfId) {
          this.localPlacement = data.placement;
          this.runStats.placement = data.placement;
          if (this.player.animState !== 'dead') {
            this.killPlayer(data.cause, true);
          }
        } else {
          const rs = this.remoteSurvivors.get(data.victimId);
          if (rs) {
            rs.alive = false;
            rs.health = 0;
            rs.animState = 'dead';
          }
          if (data.killerId === this.selfId) {
            this.localPvpKills += 1;
            this.runStats.pvpKills = this.localPvpKills;
            this.pushToast(
              `Eliminated ${data.victimCallsign}!`,
              `${data.aliveRemaining} survivors left · Only 1 helicopter seat!`,
              true
            );
          } else {
            this.pushToast(
              `${data.victimCallsign} Eliminated`,
              `${data.cause} · ${data.aliveRemaining} alive`,
              false
            );
          }
        }
        this.emitSnapshot();
      },
      onMatchEnded: (data) => {
        if (!this.isOnlineMatch) return;
        this.onlinePhase = 'ENDED';
        this.matchWinnerCallsign = data.winnerCallsign;
        this.runStats.winnerCallsign = data.winnerCallsign;
        this.runStats.totalParticipants = data.totalParticipants;

        const myPlacementRow = data.placements.find((p) => p.id === this.selfId);
        if (myPlacementRow) {
          this.localPlacement = myPlacementRow.placement;
          this.runStats.placement = myPlacementRow.placement;
          this.runStats.pvpKills = myPlacementRow.pvpKills;
        }

        if (data.winnerId && data.winnerId === this.selfId) {
          this.finalizeRun(
            true,
            'VICTORY',
            `SOLE SURVIVOR EXTRACTED — You claimed the ONLY seat aboard Flight Echo-7 at ${data.siteName} (1st of ${data.totalParticipants})!`
          );
        } else if (this.screen === 'PLAYING' || this.screen === 'PAUSED') {
          if (this.player.animState === 'dead') {
            this.finalizeRun(
              false,
              'DEATH',
              this.runStats.causeOfDeath || data.reasonForOthers
            );
          } else {
            this.finalizeRun(false, 'MISSED_EXTRACTION', data.reasonForOthers);
          }
        } else {
          this.emitSnapshot();
        }
      },
      onWorldDoorToggled: (tx, ty, open) => {
        if (!this.isOnlineMatch) return;
        this.applyDoorTileDirect(tx, ty, open);
        const T = CONFIG.TILE_SIZE;
        this.sound.playDoor(
          this.player.x,
          this.player.y,
          tx * T + T / 2,
          ty * T + T / 2,
          open ? 'open' : 'close'
        );
      },
      onWorldWindowBroken: (tx, ty) => {
        if (!this.isOnlineMatch) return;
        if (tx >= 0 && tx < this.world.width && ty >= 0 && ty < this.world.height) {
          this.world.tiles[ty * this.world.width + tx] = TileType.WINDOW_BROKEN;
          const T = CONFIG.TILE_SIZE;
          this.sound.playGlassBreak(
            this.player.x,
            this.player.y,
            tx * T + T / 2,
            ty * T + T / 2
          );
        }
      },
      onWorldEnemyKilled: (enemyId) => {
        if (!this.isOnlineMatch) return;
        const e = this.world.enemies.find((en) => en.id === enemyId);
        if (e && e.state !== 'DEAD') {
          e.health = 0;
          e.state = 'DEAD';
        }
      },
      onWorldContainerUpdated: (containerId, searched, items) => {
        if (!this.isOnlineMatch) return;
        const c = this.world.containers.find((cn) => cn.id === containerId);
        if (c) {
          c.searched = searched;
          c.items = items.map((it) => (it ? { ...it } : null));
          if (this.activeContainer && this.activeContainer.id === containerId) {
            this.activeContainer = c;
            this.emitSnapshot();
          }
        }
      },
      onWorldGroundItemsDropped: (items) => {
        if (!this.isOnlineMatch) return;
        for (const gi of items) {
          if (!this.world.groundItems.some((existing) => existing.id === gi.id)) {
            this.world.groundItems.push(gi);
          }
        }
      },
      onWorldGroundItemTaken: (groundItemId) => {
        if (!this.isOnlineMatch) return;
        const idx = this.world.groundItems.findIndex((g) => g.id === groundItemId);
        if (idx >= 0) {
          this.world.groundItems.splice(idx, 1);
        }
      },
      onWorldGeneratorPowered: () => {
        if (!this.isOnlineMatch) return;
        this.extraction.generatorPowered = true;
        for (const pr of this.world.props) {
          if (pr.kind === 'generator') pr.powered = true;
        }
      },
      onChatMessage: (msg) => {
        if (!this.isOnlineMatch) return;
        this.chatMessages = [...this.chatMessages, msg].slice(-50);
        if (msg.fromId !== this.selfId) {
          this.unreadChatCount += 1;
          try {
            if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
              navigator.vibrate([120, 60, 120]);
            }
          } catch {
            // ignore
          }
          this.pushToast('Message', `${msg.fromCallsign}: ${msg.text}`, false);
        }
        this.emitSnapshot();
      },
      onVoiceSignal: (data) => {
        if (!this.isOnlineMatch) return;
        if (this.voiceChat) {
          this.voiceChat.handleSignal(data);
        }
      },
      onVoiceState: (data) => {
        if (!this.isOnlineMatch) return;
        if (this.voiceChat) {
          this.voiceChat.setPeerTalking(data.playerId, data.talking);
        }
      },
    });

    this.world = buildCityWorld();
    this.initFreshRunState();
    this.screen = 'TITLE';

    this.input.onGamepadStatusChange = (
      connected,
      _active,
      name,
      _brand,
      connectionChanged
    ) => {
      this.sound.ensureUnlocked();
      if (connectionChanged) {
        if (connected) {
          if (this.screen === 'PLAYING') {
            this.pushToast(
              `${name} Connected`,
              'Left Stick Move · Right Stick Aim · RT Attack · LB/RB Weapons',
              false
            );
          }
          this.input.vibrate(70, 0.35, 0.45, this.settings.controllerVibration);
        } else if (this.screen === 'PLAYING' && !this.isOnlineMatch) {
          if (this.panel !== 'NONE') {
            this.panel = 'NONE';
            this.activeContainer = null;
          }
          this.screen = 'PAUSED';
          this.sound.setMusicMixScale(0.45);
          this.sound.setWeatherAndRotor(this.isHeavyRain, 0, false);
          this.pushToast(
            'Controller Disconnected',
            'Night paused automatically while controller is offline.',
            true
          );
        }
      }
      this.emitSnapshot();
    };

    this.input.attach(canvas);
    window.addEventListener('resize', this.handleResize);
    window.addEventListener('orientationchange', this.handleResize);
    document.addEventListener('fullscreenchange', this.handleResize);
    window.visualViewport?.addEventListener('resize', this.handleResize);
    window.addEventListener('pointerdown', this.handleAudioUnlockGesture, { passive: true });
    window.addEventListener('keydown', this.handleAudioUnlockGesture, { passive: true });
    window.addEventListener('touchstart', this.handleAudioUnlockGesture, { passive: true });
    this.handleResize();
    this.emitSnapshot();
  }

  private applyRoomLobbyPayload(lobby: RoomLobbyPayload) {
    this.roomId = lobby.roomId;
    this.roomCode = lobby.code;
    this.onlinePhase = lobby.phase;
    this.lobbyCountdownSeconds = lobby.countdownSeconds;
    this.lobbyPlayerCount = lobby.playerCount;
    this.lobbyMaxPlayers = lobby.maxPlayers;
    this.lobbyMinAutoStart = lobby.minAutoStartPlayers;
    this.onlineAliveCount = lobby.aliveCount;
    this.onlineTotalParticipants = lobby.totalParticipants;
    this.lobbyRoster = lobby.roster;
    const me = lobby.roster.find((r) => r.id === this.selfId);
    if (me) {
      this.selfReady = me.ready;
      if (me.color) this.localPlayerColor = me.color;
    }
  }

  private resetOnlineSessionState() {
    this.isOnlineMatch = false;
    this.roomId = null;
    this.roomCode = null;
    this.onlinePhase = 'IDLE';
    this.lobbyCountdownSeconds = 50;
    this.lobbyPlayerCount = 0;
    this.localPlayerColor = '#3f523a';
    this.onlineAliveCount = 0;
    this.onlineTotalParticipants = 0;
    this.selfReady = false;
    this.onlineErrorMessage = null;
    if (this.onlineConnectTimer !== null) {
      window.clearTimeout(this.onlineConnectTimer);
      this.onlineConnectTimer = null;
    }
    this.lobbyRoster = [];
    this.killFeed = [];
    this.remoteSurvivors.clear();
    if (this.voiceChat) {
      this.voiceChat.disable();
      this.voiceChat = null;
    }
    this.isTalking = false;
    this.chatMessages = [];
    this.unreadChatCount = 0;
    this.pendingSpawnPos = null;
    this.survivorsInLZ = 0;
    this.extractionContested = false;
    this.localPvpKills = 0;
    this.localPlacement = undefined;
    this.matchWinnerCallsign = null;
    this.deathLootDropped = false;
  }

  private upsertRemoteSurvivor(np: NetPlayerPayload, snapImmediately: boolean) {
    if (np.id === this.selfId) return;
    const existing = this.remoteSurvivors.get(np.id);
    if (!existing) {
      this.remoteSurvivors.set(np.id, {
        id: np.id,
        callsign: np.callsign,
        color: np.color,
        spawnIndex: np.spawnIndex,
        x: np.x,
        y: np.y,
        targetX: np.x,
        targetY: np.y,
        vx: np.vx,
        vy: np.vy,
        angle: np.angle,
        targetAngle: np.angle,
        health: np.health,
        maxHealth: np.maxHealth,
        armorEquipped: np.armorEquipped,
        equippedItemId: np.equippedItemId,
        flashlightOn: np.flashlightOn,
        isCrouching: np.isCrouching,
        isSprinting: np.isSprinting,
        animState: np.animState,
        animTime: Math.random() * 5,
        meleeSwingTimer: np.meleeSwingTimer,
        hurtFlash: 0,
        alive: np.alive,
        extracted: np.extracted,
        pvpKills: np.pvpKills,
        inExtractionZone: np.inExtractionZone,
      });
    } else {
      existing.callsign = np.callsign;
      existing.color = np.color;
      existing.targetX = np.x;
      existing.targetY = np.y;
      if (snapImmediately || Math.hypot(np.x - existing.x, np.y - existing.y) > 220) {
        existing.x = np.x;
        existing.y = np.y;
      }
      existing.vx = np.vx;
      existing.vy = np.vy;
      existing.targetAngle = np.angle;
      existing.health = np.health;
      existing.maxHealth = np.maxHealth;
      existing.armorEquipped = np.armorEquipped;
      existing.equippedItemId = np.equippedItemId;
      existing.flashlightOn = np.flashlightOn;
      existing.isCrouching = np.isCrouching;
      existing.isSprinting = np.isSprinting;
      existing.animState = np.animState;
      if (np.meleeSwingTimer > existing.meleeSwingTimer) {
        existing.meleeSwingTimer = np.meleeSwingTimer;
      }
      existing.alive = np.alive;
      existing.extracted = np.extracted;
      existing.pvpKills = np.pvpKills;
      existing.inExtractionZone = np.inExtractionZone;
    }
  }

  private startAuthoritativeOnlineMatch(
    lobby: RoomLobbyPayload,
    worldSync: InitialWorldSyncPayload,
    players: NetPlayerPayload[]
  ) {
    this.sound.ensureUnlocked();
    this.applyRoomLobbyPayload(lobby);
    this.isOnlineMatch = true;
    this.remoteSurvivors.clear();
    this.chatMessages = [];
    this.unreadChatCount = 0;
    this.killFeed = [];
    this.localPvpKills = 0;
    this.localPlacement = undefined;
    this.matchWinnerCallsign = null;
    this.deathLootDropped = false;

    const myPayload = players.find((p) => p.id === this.selfId);
    const spawnPos = myPayload
      ? { x: myPayload.x, y: myPayload.y }
      : this.pendingSpawnPos || undefined;

    this.initFreshRunState({
      seed: lobby.matchSeed,
      forcedExtractionSiteId: lobby.extractionSiteId,
      spawnPos,
    });

    this.elapsedSeconds = lobby.elapsedSeconds;
    this.serverElapsedSeconds = lobby.elapsedSeconds;
    this.runStats.isOnlineMatch = true;
    this.runStats.totalParticipants = lobby.totalParticipants;
    this.runStats.pvpKills = 0;

    // Replay authoritative room world deltas (for hot-joiners / reconnects)
    for (const key of worldSync.openedDoors) {
      const [txStr, tyStr] = key.split(',');
      this.applyDoorTileDirect(Number(txStr), Number(tyStr), true);
    }
    for (const key of worldSync.brokenWindows) {
      const [txStr, tyStr] = key.split(',');
      const tx = Number(txStr);
      const ty = Number(tyStr);
      if (tx >= 0 && tx < this.world.width && ty >= 0 && ty < this.world.height) {
        this.world.tiles[ty * this.world.width + tx] = TileType.WINDOW_BROKEN;
      }
    }
    for (const enemyId of worldSync.deadEnemyIds) {
      const en = this.world.enemies.find((e) => e.id === enemyId);
      if (en) {
        en.health = 0;
        en.state = 'DEAD';
      }
    }
    for (const cu of worldSync.updatedContainers) {
      const cnt = this.world.containers.find((c) => c.id === cu.containerId);
      if (cnt) {
        cnt.searched = cu.searched;
        cnt.items = cu.items.map((it) => (it ? { ...it } : null));
      }
    }
    for (const takenId of worldSync.takenGroundItemIds) {
      const idx = this.world.groundItems.findIndex((g) => g.id === takenId);
      if (idx >= 0) this.world.groundItems.splice(idx, 1);
    }
    for (const sgi of worldSync.spawnedGroundItems) {
      if (!this.world.groundItems.some((g) => g.id === sgi.id)) {
        this.world.groundItems.push(sgi);
      }
    }
    if (worldSync.generatorPowered) {
      this.extraction.generatorPowered = true;
      for (const pr of this.world.props) {
        if (pr.kind === 'generator') pr.powered = true;
      }
    }

    // Voice chat setup (push-to-talk, proximity gain)
    this.voiceChat = new VoiceChatManager({
      sendSignal: (data) => {
        this.mp.send({ type: 'voice:signal', targetId: data.targetId, kind: data.kind, payload: data.payload });
      },
      sendState: (talking) => {
        this.mp.send({ type: 'voice:state', talking });
      },
      getSelfId: () => this.selfId,
      getRemoteIds: () => [...this.remoteSurvivors.keys()],
      getDistance: (remoteId) => {
        const rs = this.remoteSurvivors.get(remoteId);
        if (!rs) return 99999;
        return Math.hypot(rs.x - this.player.x, rs.y - this.player.y);
      },
    });
    void this.voiceChat.enable();

    for (const np of players) {
      if (np.id !== this.selfId) {
        this.upsertRemoteSurvivor(np, true);
        this.voiceChat.ensurePeer(np.id);
      }
    }

    this.screen = 'PLAYING';
    this.panel = 'NONE';
    this.triggerHourlyMilestone(getHourIndex(this.elapsedSeconds));
    this.checkScheduledRadioBroadcasts(true);
    this.pushToast(
      'ONLINE PvPvE — NIGHT SECTOR',
      `${lobby.aliveCount} Survivors deployed · Survive rivals & The Hollow · ONLY 1 SEAT on Echo-7!`,
      true
    );
    this.sound.setMusicMixScale(INGAME_MUSIC_MIX_SCALE);
    this.sound.setWeatherAndRotor(false, 0, true);
    this.canvas.focus({ preventScroll: true });
    this.emitSnapshot();
  }

  // === Public Online Matchmaking Controls ===
  public openOnlineMatchmaking() {
    this.sound.ensureUnlocked();
    this.onlineErrorMessage = null;
    this.panel = 'ONLINE_LOBBY';
    if (!this.roomId) {
      this.quickJoinOnline();
    } else {
      this.mp.ensureConnected();
    }
    this.emitSnapshot();
  }

  public setOnlineCallsign(name: string) {
    const cleaned = name.replace(/[^\w\-\s]/g, '').slice(0, 16);
    this.callsign = cleaned;
    try {
      if (cleaned.trim().length >= 2) {
        localStorage.setItem(CALLSIGN_STORAGE_KEY, cleaned.trim());
      }
    } catch {
      // ignore
    }
    if (this.roomId && (this.onlinePhase === 'LOBBY' || this.onlinePhase === 'COUNTDOWN')) {
      this.mp.send({
        type: 'matchmaking:set_callsign',
        callsign: cleaned.trim() || 'SURVIVOR',
      });
    }
    this.emitSnapshot();
  }

  public quickJoinOnline() {
    this.sound.ensureUnlocked();
    this.onlineErrorMessage = null;
    this.mp.ensureConnected();
    this.mp.send(
      {
        type: 'matchmaking:quick_join',
        callsign: this.callsign.trim() || 'SURVIVOR',
      },
      true
    );

    // Surface a real error instead of hanging on "Connecting..." when the
    // WebSocket game server is not reachable (for example a static-only host).
    if (this.onlineConnectTimer !== null) {
      window.clearTimeout(this.onlineConnectTimer);
    }
    this.onlineConnectTimer = window.setTimeout(() => {
      this.onlineConnectTimer = null;
      if (!this.wsConnected && !this.roomId) {
        this.onlineErrorMessage =
          'Online service unreachable. Start the game server (npm run dev) or point VITE_WS_URL at a hosted server, then try again.';
        this.emitSnapshot();
      }
    }, 6000);
  }

  public createOnlineRoom(maxPlayers = 20) {
    this.sound.ensureUnlocked();
    this.onlineErrorMessage = null;
    this.mp.ensureConnected();
    this.mp.send(
      {
        type: 'matchmaking:create_room',
        callsign: this.callsign.trim() || 'SURVIVOR',
        maxPlayers,
        isPublic: true,
      },
      true
    );
  }

  public joinOnlineRoomByCode(code: string) {
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) return;
    this.sound.ensureUnlocked();
    this.onlineErrorMessage = null;
    this.mp.ensureConnected();
    this.mp.send(
      {
        type: 'matchmaking:join_code',
        code: trimmed,
        callsign: this.callsign.trim() || 'SURVIVOR',
      },
      true
    );
  }

  public toggleOnlineReady() {
    if (!this.roomId) return;
    this.sound.ensureUnlocked();
    this.selfReady = !this.selfReady;
    this.mp.send({
      type: 'matchmaking:set_ready',
      ready: this.selfReady,
      callsign: this.callsign.trim() || 'SURVIVOR',
    });
    this.emitSnapshot();
  }

  public forceLaunchOnlineRoom() {
    if (!this.roomId) return;
    this.sound.ensureUnlocked();
    this.mp.send({ type: 'matchmaking:force_launch' });
  }

  public leaveOnlineRoom() {
    this.sound.ensureUnlocked();
    if (this.roomId) {
      this.mp.send({ type: 'matchmaking:leave' });
    }
    this.resetOnlineSessionState();
    this.emitSnapshot();
  }

  public refreshOnlineLobbies() {
    this.mp.ensureConnected();
    this.mp.send({ type: 'lobbies:list' }, true);
  }

  private handleAudioUnlockGesture = () => {
    this.sound.ensureUnlocked();
  };

  public startLoop() {
    this.lastTimestamp = performance.now();
    const tick = (now: number) => {
      const rawDt = (now - this.lastTimestamp) / 1000;
      this.lastTimestamp = now;
      const dt = Math.min(Math.max(rawDt, 0.001), 0.05);

      this.update(dt);
      this.render();
      this.input.endFrame();

      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  public destroy() {
    cancelAnimationFrame(this.rafId);
    if (this.onlineConnectTimer !== null) {
      window.clearTimeout(this.onlineConnectTimer);
      this.onlineConnectTimer = null;
    }
    window.removeEventListener('resize', this.handleResize);
    window.removeEventListener('orientationchange', this.handleResize);
    document.removeEventListener('fullscreenchange', this.handleResize);
    window.visualViewport?.addEventListener('resize', this.handleResize);
    window.removeEventListener('pointerdown', this.handleAudioUnlockGesture);
    window.removeEventListener('keydown', this.handleAudioUnlockGesture);
    window.removeEventListener('touchstart', this.handleAudioUnlockGesture);
    this.input.detach();
    this.mp.destroy();
    this.radioPlayer.destroy();
    this.sound.setWeatherAndRotor(false, 0, false);
    this.sound.destroy();
  }

  private handleResize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(window.visualViewport?.width ?? window.innerWidth);
    const h = Math.round(window.visualViewport?.height ?? window.innerHeight);
    const minDim = Math.min(w, h);
    const isCompactLandscape = w > h && h <= 560;
    const zoom = isCompactLandscape
      ? 0.72
      : minDim < 480
      ? 0.78
      : minDim < 768
      ? 0.86
      : 1.0;

    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, 0, 0);
    this.cam.setViewport(w / zoom, h / zoom, zoom);
  };

  private initFreshRunState(worldOptions?: WorldBuildOptions) {
    this.world = buildCityWorld(worldOptions);
    this.milestones = buildHourlyMilestones(this.world.activeExtractionSite);
    this.campaignStage = 'ESCAPE_VILLAGE';
    this.injectionTaken = false;
    this.radioDiscovered = false;

    this.elapsedSeconds = 0;
    this.currentHourIndex = 0;
    this.triggeredHours.clear();
    this.powerGridOnline = true;
    this.isHeavyRain = false;
    this.activeWeatherEventTimer = 0;
    this.nextRandomEventTimer = 65 + Math.random() * 45;
    this.hitstopTimer = 0;
    this.deathDelayTimer = 0;
    this.searchingContainer = null;
    this.searchProgressSec = 0;
    this.searchRummageTimer = 0;
    this.searchRummageStep = 0;
    this.activeContainer = null;
    this.projectiles = [];
    this.particles = [];
    this.noises = [];
    this.flares = [];
    this.radioMessages = [];
    this.unreadRadioCount = 0;
    this.triggeredBroadcastIds.clear();
    this.preloadedBroadcastIds.clear();
    this.latestToast = null;
    this.toastTimer = 0;
    this.input.gamepadCrouchToggled = false;
    this.input.gamepadSprintToggled = false;

    this.player = {
      x: this.world.playerStart.x,
      y: this.world.playerStart.y,
      vx: 0,
      vy: 0,
      angle: Math.PI / 2,
      radius: CONFIG.PLAYER_RADIUS,
      health: 100,
      maxHealth: 100,
      hunger: 100,
      maxHunger: 100,
      stamina: 100,
      maxStamina: 100,
      contamination: 38,
      maxContamination: 100,
      conditions: {
        bleeding: false,
        infected: false,
        exhausted: false,
        sporeExposure: false,
      },
      bleedTimer: 0,
      infectionTimer: 0,
      flashlightOn: true,
      flashlightBattery: 88,
      isSprinting: false,
      isCrouching: false,
      equippedSlot: 0,
      isReloading: false,
      reloadTimer: 0,
      reloadDuration: 1.5,
      attackCooldown: 0,
      meleeSwingTimer: 0,
      meleeSwingAngle: 0,
      hurtFlash: 0,
      animState: 'idle',
      animTime: 0,
      stepDistanceAccum: 0,
      armorEquipped: false,
    };

    this.backpack = Array(CONFIG.BACKPACK_SLOTS).fill(null);
    this.backpack[0] = createItemInstance('knife', 1);
    this.backpack[1] = createItemInstance('bandage', 1);
    this.backpack[2] = createItemInstance('water_bottle', 1);
    this.backpack[3] = createItemInstance('powerbank', 1);

    this.extraction = createInitialExtractionState(this.world.activeExtractionSite);
    this.cam.snapTo(this.player.x, this.player.y);

    this.runStats = {
      survivedSeconds: 0,
      finalTimeFormatted: '11:00 PM',
      causeOfDeath: '',
      extractionSiteName: this.world.activeExtractionSite.name,
      enemiesKilled: 0,
      pvpKills: 0,
      isOnlineMatch: false,
      containersSearched: 0,
      shotsFired: 0,
      shotsHit: 0,
      itemsUsed: 0,
      damageTaken: 0,
      distanceTraveledMeters: 0,
      extracted: false,
    };
  }

  public startNewGame() {
    if (this.roomId) {
      this.mp.send({ type: 'matchmaking:leave' });
    }
    this.radioPlayer.stop();
    this.resetOnlineSessionState();
    this.sound.ensureUnlocked();
    this.sound.playMenuSelect();
    this.initFreshRunState();
    this.screen = 'PLAYING';
    this.panel = 'NONE';
    this.triggerHourlyMilestone(0);
    this.checkScheduledRadioBroadcasts(true);
    this.sound.setMusicMixScale(INGAME_MUSIC_MIX_SCALE);
    this.sound.setWeatherAndRotor(false, 0, true);
    this.canvas.focus({ preventScroll: true });
    this.emitSnapshot();
  }

  public returnToTitle() {
    if (this.roomId) {
      this.mp.send({ type: 'matchmaking:leave' });
    }
    this.radioPlayer.stop();
    this.resetOnlineSessionState();
    this.sound.ensureUnlocked();
    this.sound.playMenuSelect();
    this.initFreshRunState();
    this.screen = 'TITLE';
    this.panel = 'NONE';
    this.sound.setMusicMixScale(1.0);
    this.sound.setWeatherAndRotor(false, 0, false);
    this.emitSnapshot();
  }

  public replayRadioBeep() {
    this.sound.ensureUnlocked();
    this.sound.playRadioStatic(false);
  }

  public playRadioBroadcast(broadcastId: string) {
    const found = RADIO_BROADCASTS.find((b) => b.id === broadcastId);
    if (!found) return;
    this.sound.ensureUnlocked();
    void this.radioPlayer.playBroadcast(found.id);
  }

  public stopRadioBroadcast() {
    this.radioPlayer.stop();
  }

  public playMenuTick() {
    this.sound.ensureUnlocked();
    this.sound.playMenuHover();
  }

  public clearUnreadRadio() {
    if (this.unreadRadioCount > 0) {
      this.unreadRadioCount = 0;
      this.emitSnapshot();
    }
  }

  public toggleFlashlight() {
    if (this.screen !== 'PLAYING' || this.player.animState === 'dead') return;
    this.sound.ensureUnlocked();
    if (this.player.flashlightBattery > 0) {
      this.player.flashlightOn = !this.player.flashlightOn;
      this.sound.playFlashlightClick(this.player.flashlightOn);
    } else {
      this.player.flashlightOn = false;
      this.sound.playDryClick();
      this.pushToast(
        'Phone Battery Dead',
        'Charge your phone with a Power Bank to use the flashlight.',
        true
      );
    }
    this.emitSnapshot();
  }

  public usePowerBank() {
    if (this.screen !== 'PLAYING' || this.player.animState === 'dead') return;
    this.sound.ensureUnlocked();
    if (this.player.flashlightBattery >= 100) {
      this.pushToast('Phone Charged', 'Phone battery is already at 100%.', false);
      this.emitSnapshot();
      return;
    }
    const taken = consumeItemQuantity(this.backpack, 'powerbank', 1);
    if (taken > 0) {
      this.player.flashlightBattery = Math.min(100, this.player.flashlightBattery + 60);
      this.runStats.itemsUsed += 1;
      this.sound.playItemUse('powerbank');
      this.pushToast('Power Bank Connected', 'Recharged phone battery (+60%).', false);
    } else {
      this.pushToast('No Power Bank', 'Scavenge a Power Bank to recharge your phone.', true);
    }
    this.emitSnapshot();
  }

  public triggerInteract() {
    if (this.screen !== 'PLAYING' || this.panel !== 'NONE') return;
    this.sound.ensureUnlocked();
    this.executeContextualInteract();
    this.canvas.focus({ preventScroll: true });
  }

  public setPanel(next: OverlayPanel) {
    this.sound.ensureUnlocked();
    const prev = this.panel;
    this.panel = this.panel === next ? 'NONE' : next;
    const wasPack = prev === 'INVENTORY' || prev === 'LOOT';
    const isPack = this.panel === 'INVENTORY' || this.panel === 'LOOT';
    if (!wasPack && isPack) {
      this.sound.playBackpackZip(true);
    } else if (wasPack && !isPack) {
      this.sound.playBackpackZip(false);
    }
    if (prev !== 'PHONE' && this.panel === 'PHONE') {
      this.sound.playPhoneToggle(true);
    } else if (prev === 'PHONE' && this.panel !== 'PHONE') {
      this.sound.playPhoneToggle(false);
    }
    if (this.panel !== 'LOOT') {
      this.activeContainer = null;
    }
    if (this.panel === 'PHONE') {
      if (this.radioDiscovered && this.unreadRadioCount > 0) {
        this.sound.playRadioStatic(false);
      }
    }
    if (this.panel === 'CHAT') {
      this.unreadChatCount = 0;
    }
    if (this.panel === 'NONE' && this.screen === 'PLAYING') {
      this.canvas.focus({ preventScroll: true });
    }
    this.emitSnapshot();
  }

  public sendChatMessage(text: string) {
    if (!this.isOnlineMatch || !this.mp.isConnected) return;
    const t = text.trim().slice(0, 200);
    if (!t) return;
    // optimistic local echo
    const msg: ChatMessage = {
      id: `${this.selfId || 'self'}-${Date.now()}`,
      fromId: this.selfId || '',
      fromCallsign: this.callsign || 'You',
      text: t,
      timestamp: Date.now(),
      isSelf: true,
    };
    this.chatMessages = [...this.chatMessages, msg].slice(-50);
    this.emitSnapshot();
    this.mp.send({
      type: 'chat:message',
      text: t,
      x: Math.round(this.player.x),
      y: Math.round(this.player.y),
    });
  }

  public enableVoice() {
    if (!this.voiceChat) return;
    void this.voiceChat.enable();
  }

  public togglePause() {
    this.sound.ensureUnlocked();
    if (this.screen === 'PLAYING') {
      if (this.panel !== 'NONE') {
        const wasPack = this.panel === 'INVENTORY' || this.panel === 'LOOT';
        const wasPhone = this.panel === 'PHONE';
        this.panel = 'NONE';
        this.activeContainer = null;
        if (wasPack) {
          this.sound.playBackpackZip(false);
        } else if (wasPhone) {
          this.sound.playPhoneToggle(false);
        }
        this.canvas.focus({ preventScroll: true });
      } else {
        this.sound.playMenuSelect();
        this.screen = 'PAUSED';
        this.sound.setMusicMixScale(0.45);
        if (!this.isOnlineMatch) {
          this.sound.setWeatherAndRotor(this.isHeavyRain, 0, false);
        }
      }
      this.emitSnapshot();
    } else if (this.screen === 'PAUSED') {
      if (this.panel !== 'NONE') {
        this.sound.playMenuSelect();
        this.panel = 'NONE';
        this.emitSnapshot();
        return;
      }
      this.sound.playMenuSelect();
      this.screen = 'PLAYING';
      this.panel = 'NONE';
      this.sound.setMusicMixScale(INGAME_MUSIC_MIX_SCALE);
      this.sound.setWeatherAndRotor(this.isHeavyRain, 0, true);
      this.canvas.focus({ preventScroll: true });
      this.emitSnapshot();
    }
  }

  public updateSettings(partial: Partial<GameSettings>) {
    this.sound.ensureUnlocked();
    this.settings = { ...this.settings, ...partial };
    saveSettings(this.settings);
    this.sound.applySettings(this.settings);
    if (this.screen === 'PLAYING') {
      this.sound.setWeatherAndRotor(this.isHeavyRain, 0, true);
    }
    this.emitSnapshot();
  }

  public toggleMute() {
    this.updateSettings({ muted: !this.settings.muted });
  }

  public cycleEquippedWeapon(dir: -1 | 1) {
    if (this.screen !== 'PLAYING' || this.player.animState === 'dead') return;
    this.sound.ensureUnlocked();
    const weaponSlots: number[] = [];
    for (let i = 0; i < this.backpack.length; i++) {
      const it = this.backpack[i];
      if (!it) continue;
      const def = ITEMS[it.itemId];
      if (def && (def.category === 'weapon_melee' || def.category === 'weapon_ranged')) {
        weaponSlots.push(i);
      }
    }
    if (weaponSlots.length === 0) return;

    let nextSlot: number;
    if (this.player.equippedSlot === null) {
      nextSlot = dir > 0 ? weaponSlots[0] : weaponSlots[weaponSlots.length - 1];
    } else {
      const curPos = weaponSlots.indexOf(this.player.equippedSlot);
      if (curPos === -1) {
        nextSlot = dir > 0 ? weaponSlots[0] : weaponSlots[weaponSlots.length - 1];
      } else {
        nextSlot =
          weaponSlots[(curPos + dir + weaponSlots.length) % weaponSlots.length];
      }
    }

    if (this.player.equippedSlot !== nextSlot) {
      this.player.equippedSlot = nextSlot;
      this.player.isReloading = false;
      const nextInst = this.backpack[nextSlot];
      this.sound.playEquipWeapon(nextInst?.itemId ?? 'pistol');
      this.input.vibrate(35, 0.25, 0.15, this.settings.controllerVibration);
      this.emitSnapshot();
    }
  }

  public useOrEquipBackpackSlot(slotIdx: number) {
    this.sound.ensureUnlocked();
    const targetInst = this.backpack[slotIdx];
    const targetDef = targetInst ? ITEMS[targetInst.itemId] : null;
    const prevEquipped = this.player.equippedSlot;

    const useDirectionalAim =
      this.input.isGamepadActive || this.input.isTouchDetected || !this.input.hasMouseMoved;
    const mw = useDirectionalAim
      ? {
          x: this.player.x + Math.cos(this.player.angle) * 145,
          y: this.player.y + Math.sin(this.player.angle) * 145,
        }
      : this.cam.screenToWorld(this.input.mouseScreenX, this.input.mouseScreenY);
    const res = applyBackpackItemEffect(
      this.player,
      this.backpack,
      slotIdx,
      mw.x,
      mw.y,
      this.flares
    );

    if (
      targetDef &&
      (targetDef.category === 'weapon_melee' || targetDef.category === 'weapon_ranged')
    ) {
      if (this.player.equippedSlot === slotIdx && prevEquipped !== slotIdx) {
        this.sound.playEquipWeapon(targetDef.id);
        this.input.vibrate(35, 0.25, 0.15, this.settings.controllerVibration);
      } else if (this.player.equippedSlot === null && prevEquipped === slotIdx) {
        this.sound.playEquipWeapon('holster');
        this.input.vibrate(25, 0.15, 0.1, this.settings.controllerVibration);
      }
    } else if (res.used) {
      this.runStats.itemsUsed += 1;
      this.sound.playItemUse(targetDef?.id ?? '');
      this.input.vibrate(50, 0.3, 0.25, this.settings.controllerVibration);
    }

    if (res.antiviralInjected && !this.injectionTaken) {
      this.injectionTaken = true;
      if (!this.radioDiscovered) {
        this.campaignStage = 'HOSPITAL_RADIO';
        this.pushToast(
          'Contamination Purged!',
          'Now tune the Emergency Radio in St. Jude Hospital’s NW Dispatch Room to learn the 6:00 AM Helicopter LZ!',
          true
        );
      }
    } else if (res.feedback) {
      this.pushToast('Inventory', res.feedback, false);
    }
    this.emitSnapshot();
  }

  private broadcastContainerSync(c: ContainerEntity) {
    if (!this.isOnlineMatch) return;
    this.mp.send({
      type: 'world:container_updated',
      containerId: c.id,
      searched: c.searched,
      items: c.items,
    });
  }

  public dropBackpackSlot(slotIdx: number) {
    const inst = this.backpack[slotIdx];
    if (!inst) return;
    this.sound.ensureUnlocked();
    this.sound.playItemDrop(inst.itemId);
    const gi: GroundItem = {
      id: `gnd_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      x: this.player.x + Math.cos(this.player.angle) * 20,
      y: this.player.y + Math.sin(this.player.angle) * 20,
      item: inst,
    };
    this.world.groundItems.push(gi);
    if (this.isOnlineMatch) {
      this.mp.send({ type: 'world:ground_items_dropped', items: [gi] });
    }
    this.backpack[slotIdx] = null;
    if (this.player.equippedSlot === slotIdx) {
      this.player.equippedSlot = null;
      this.player.isReloading = false;
    }
    this.emitSnapshot();
  }

  public transferOrSwapSlots(
    fromSource: 'backpack' | 'container',
    fromIdx: number,
    toSource: 'backpack' | 'container',
    toIdx: number
  ) {
    this.sound.ensureUnlocked();
    if (fromSource === 'backpack' && toSource === 'backpack') {
      swapSlots(this.backpack, fromIdx, this.backpack, toIdx);
      if (this.player.equippedSlot === fromIdx) this.player.equippedSlot = toIdx;
      else if (this.player.equippedSlot === toIdx) this.player.equippedSlot = fromIdx;
      this.sound.playGearShift();
    } else if (
      this.activeContainer &&
      fromSource === 'container' &&
      toSource === 'backpack'
    ) {
      const cSlot = this.activeContainer.items[fromIdx];
      if (!cSlot) return;
      const bSlot = this.backpack[toIdx];
      if (!bSlot) {
        const curW = calculateBackpackWeight(this.backpack, this.player.armorEquipped);
        const itemW = (ITEMS[cSlot.itemId]?.weight ?? 0) * cSlot.quantity;
        if (curW + itemW > CONFIG.MAX_CARRY_WEIGHT_KG + 0.001) {
          this.pushToast('Overweight', 'Too heavy to fit in backpack.', true);
          return;
        }
        this.backpack[toIdx] = cSlot;
        this.activeContainer.items[fromIdx] = null;
        this.sound.playPickup(cSlot.itemId);
      } else {
        swapSlots(this.activeContainer.items, fromIdx, this.backpack, toIdx);
        this.sound.playPickup(cSlot.itemId);
      }
      this.broadcastContainerSync(this.activeContainer);
    } else if (
      this.activeContainer &&
      fromSource === 'backpack' &&
      toSource === 'container'
    ) {
      swapSlots(this.backpack, fromIdx, this.activeContainer.items, toIdx);
      if (this.player.equippedSlot === fromIdx && !this.backpack[fromIdx]) {
        this.player.equippedSlot = null;
      }
      this.sound.playGearShift();
      this.broadcastContainerSync(this.activeContainer);
    } else if (
      this.activeContainer &&
      fromSource === 'container' &&
      toSource === 'container'
    ) {
      swapSlots(this.activeContainer.items, fromIdx, this.activeContainer.items, toIdx);
      this.sound.playGearShift();
      this.broadcastContainerSync(this.activeContainer);
    }
    this.emitSnapshot();
  }

  public quickTransferFromContainer(cIdx: number) {
    if (!this.activeContainer) return;
    const item = this.activeContainer.items[cIdx];
    if (!item) return;
    const res = addItemToBackpack(this.backpack, this.player.armorEquipped, item);
    if (res.added > 0) {
      this.sound.playPickup(item.itemId);
      if (res.remaining <= 0) {
        this.activeContainer.items[cIdx] = null;
      } else {
        item.quantity = res.remaining;
      }
      this.broadcastContainerSync(this.activeContainer);
    } else if (res.reason === 'weight') {
      this.pushToast('Weight Limit', 'Drop heavy gear before taking more.', true);
    } else {
      this.pushToast('Backpack Full', 'No free slots remaining.', true);
    }
    this.emitSnapshot();
  }

  public takeAllFromActiveContainer() {
    if (!this.activeContainer) return;
    this.sound.ensureUnlocked();
    let movedAny = false;
    let blockedReason: 'full' | 'weight' | null = null;
    for (let i = 0; i < this.activeContainer.items.length; i++) {
      const it = this.activeContainer.items[i];
      if (!it) continue;
      const res = addItemToBackpack(this.backpack, this.player.armorEquipped, it);
      if (res.added > 0) movedAny = true;
      if (res.remaining <= 0) {
        this.activeContainer.items[i] = null;
      } else {
        it.quantity = res.remaining;
        if (res.reason) blockedReason = res.reason;
      }
    }

    // Play realistic Cordura backpack zipper closing + metal pull-tab cinch
    this.sound.playBackpackZip(false);

    if (movedAny) {
      this.broadcastContainerSync(this.activeContainer);
    } else if (blockedReason === 'weight') {
      this.pushToast('Weight Limit', 'Drop heavy gear before taking more.', true);
    } else if (blockedReason === 'full') {
      this.pushToast('Backpack Full', 'No free slots remaining.', true);
    }

    // Auto-close loot panel cleanly when all items are packed away (without double-playing zipper)
    if (this.activeContainer.items.every((it) => it === null)) {
      this.panel = 'NONE';
      this.activeContainer = null;
      if (this.screen === 'PLAYING') {
        this.canvas.focus({ preventScroll: true });
      }
    }
    this.emitSnapshot();
  }

  private getActiveObjectiveInfo(): {
    stage: CampaignStage;
    stepNumber: number;
    title: string;
    hint: string;
    targetLabel: string;
    targetPos: { x: number; y: number };
  } {
    switch (this.campaignStage) {
      case 'ESCAPE_VILLAGE':
        return {
          stage: 'ESCAPE_VILLAGE',
          stepNumber: 1,
          title: 'Escape Village to Road F45',
          hint: 'Leave Oakhaven Countryside Village east through the highway gate onto straight Road F45.',
          targetLabel: 'Road F45 Entrance',
          targetPos: this.world.f45EntryPos,
        };
      case 'CROSS_F45':
        return {
          stage: 'CROSS_F45',
          stepNumber: 2,
          title: 'Cross Highway F45 to City',
          hint: 'Follow straight Road F45 east through the car pileups and dead bodies into Quarantine City.',
          targetLabel: 'Quarantine City Gate',
          targetPos: this.world.cityGatePos,
        };
      case 'HOSPITAL_INJECTION':
        return {
          stage: 'HOSPITAL_INJECTION',
          stepNumber: 3,
          title: 'Hospital Antiviral Injection',
          hint: 'Reach St. Jude Hospital (NW City) and administer the Antiviral Injection to bring your contamination down.',
          targetLabel: 'St. Jude Bio-Ward',
          targetPos: this.world.hospitalInjectionPos,
        };
      case 'HOSPITAL_RADIO':
        return {
          stage: 'HOSPITAL_RADIO',
          stepNumber: 4,
          title: 'Tune Hospital Room Radio',
          hint: 'Enter the adjacent Dispatch Room in St. Jude Hospital and tune the Emergency Radio to learn the 6:00 AM Helicopter LZ.',
          targetLabel: 'Hospital Radio Room',
          targetPos: this.world.hospitalRadioPos,
        };
      case 'SURVIVE_TO_HELIPAD':
      default:
        return {
          stage: 'SURVIVE_TO_HELIPAD',
          stepNumber: 5,
          title: `6:00 AM LZ: ${this.extraction.site.name}`,
          hint: this.isOnlineMatch
            ? `${this.extraction.site.routeHint} ONLY ONE SEAT aboard Echo-7—clear rivals from [H] to extract!`
            : `${this.extraction.site.routeHint} Stay alive and hold inside the [H] landing zone at 06:00 AM!`,
          targetLabel: this.extraction.site.shortName,
          targetPos: this.extraction.heliTarget,
        };
    }
  }

  private updateCampaignProgression() {
    const T = CONFIG.TILE_SIZE;
    if (this.campaignStage === 'ESCAPE_VILLAGE' && this.player.x >= 38.2 * T) {
      this.campaignStage = 'CROSS_F45';
      this.pushToast(
        'Highway F45 Entered',
        'Follow straight Road F45 east past the crashed cars and corpses—watch for Stills and rival survivors!',
        false
      );
    }
    if (
      (this.campaignStage === 'ESCAPE_VILLAGE' || this.campaignStage === 'CROSS_F45') &&
      this.player.x >= 95.5 * T
    ) {
      this.campaignStage = this.injectionTaken ? 'HOSPITAL_RADIO' : 'HOSPITAL_INJECTION';
      this.pushToast(
        'Quarantine City Reached',
        this.injectionTaken
          ? 'Head north to St. Jude Hospital and tune the Emergency Radio in the Dispatch Room!'
          : 'Head north up West Street to St. Jude Hospital and take the Antiviral Injection to drop your contamination!',
        true
      );
    }
  }

  private updateRemoteSurvivorsInterpolation(dt: number) {
    const lerpFactor = Math.min(1, dt * 13);
    for (const rs of this.remoteSurvivors.values()) {
      rs.x += (rs.targetX - rs.x) * lerpFactor;
      rs.y += (rs.targetY - rs.y) * lerpFactor;
      let aDiff = rs.targetAngle - rs.angle;
      while (aDiff > Math.PI) aDiff -= Math.PI * 2;
      while (aDiff < -Math.PI) aDiff += Math.PI * 2;
      rs.angle += aDiff * Math.min(1, dt * 15);
      rs.animTime += dt;
      if (rs.meleeSwingTimer > 0) rs.meleeSwingTimer = Math.max(0, rs.meleeSwingTimer - dt);
      if (rs.hurtFlash > 0) rs.hurtFlash = Math.max(0, rs.hurtFlash - dt);
    }
  }

  private emitLocalPlayerNetUpdate(dt: number) {
    if (!this.isOnlineMatch || this.onlinePhase !== 'IN_PROGRESS') return;
    this.netSyncTimer += dt;
    if (this.netSyncTimer < 0.05) return;
    this.netSyncTimer = 0;

    const eqInst =
      this.player.equippedSlot !== null ? this.backpack[this.player.equippedSlot] : null;
    this.mp.send({
      type: 'player:update',
      x: Math.round(this.player.x * 10) / 10,
      y: Math.round(this.player.y * 10) / 10,
      vx: Math.round(this.player.vx),
      vy: Math.round(this.player.vy),
      angle: Math.round(this.player.angle * 1000) / 1000,
      health: Math.ceil(this.player.health),
      armorEquipped: this.player.armorEquipped,
      equippedItemId: eqInst?.itemId ?? null,
      flashlightOn: this.player.flashlightOn && this.player.flashlightBattery > 0,
      isCrouching: this.player.isCrouching,
      isSprinting: this.player.isSprinting,
      animState: this.player.animState,
      meleeSwingTimer: Math.round(this.player.meleeSwingTimer * 100) / 100,
    });
  }

  private update(dt: number) {
    this.input.pollGamepad(dt);

    if (this.screen === 'TITLE') {
      this.elapsedSeconds = (this.elapsedSeconds + dt) % 3600;
      this.cam.updateTitlePan(dt);
      if (this.panel !== 'NONE' && this.input.consumeJustPressed('Escape')) {
        if (this.panel === 'ONLINE_LOBBY' && this.roomId) {
          this.leaveOnlineRoom();
        }
        this.setPanel('NONE');
      }
      return;
    }

    if (this.input.consumeJustPressed('KeyM')) {
      this.toggleMute();
    }

    if (
      this.input.consumeJustPressed('Escape') ||
      (this.screen === 'PLAYING' &&
        this.panel === 'NONE' &&
        this.input.consumeGamepadButton('start')) ||
      (this.screen === 'PAUSED' &&
        this.panel === 'NONE' &&
        this.input.consumeGamepadButton('start'))
    ) {
      this.togglePause();
      if (!this.isOnlineMatch) return;
    }

    // In Solo mode, PAUSED freezes simulation; in Online PvPvE, world keeps ticking in real time!
    if (this.screen !== 'PLAYING' && !(this.isOnlineMatch && this.screen === 'PAUSED')) {
      return;
    }

    if (this.hitstopTimer > 0 && !this.isOnlineMatch) {
      this.hitstopTimer -= dt;
      return;
    } else if (this.hitstopTimer > 0) {
      this.hitstopTimer = Math.max(0, this.hitstopTimer - dt);
    }

    this.updateRemoteSurvivorsInterpolation(dt);
    if (this.isOnlineMatch && this.voiceChat) {
      this.voiceChat.updateProximity();
    }

    if (this.player.animState === 'dead') {
      this.deathDelayTimer -= dt;
      this.updateParticlesAndNoises(dt);
      if (this.deathDelayTimer <= 0) {
        this.finalizeRun(false, 'DEATH', this.runStats.causeOfDeath || 'Killed by The Hollow');
      }
      return;
    }

    if (this.screen === 'PLAYING') {
      if (
        this.input.consumeJustPressed('Tab') ||
        this.input.consumeJustPressed('KeyI') ||
        (this.panel === 'NONE' && this.input.consumeGamepadButton('north'))
      ) {
        this.setPanel(this.panel === 'INVENTORY' || this.panel === 'LOOT' ? 'NONE' : 'INVENTORY');
      }
      if (
        this.input.consumeJustPressed('KeyQ') ||
        this.input.consumeJustPressed('KeyP') ||
        (this.panel === 'NONE' && this.input.consumeGamepadButton('select'))
      ) {
        this.setPanel('PHONE');
      }
      if (
        this.input.consumeJustPressed('KeyF') ||
        (this.panel === 'NONE' && this.input.consumeGamepadButton('r3'))
      ) {
        this.toggleFlashlight();
      }
      if (this.isOnlineMatch && this.input.consumeJustPressed('KeyC')) {
        this.setPanel(this.panel === 'CHAT' ? 'NONE' : 'CHAT');
      }
      // Push-to-talk (T)
      if (this.isOnlineMatch && this.voiceChat) {
        const wantTalk = this.input.isHeld('KeyT');
        if (wantTalk !== this.isTalking) {
          this.isTalking = wantTalk;
          this.voiceChat.setTalking(wantTalk);
        }
      }
    }

    // In Solo Mode only, pause clock & world while reading Phone / Settings / Credits
    if (
      !this.isOnlineMatch &&
      (this.panel === 'PHONE' || this.panel === 'SETTINGS' || this.panel === 'CREDITS')
    ) {
      return;
    }

    // 2. Authoritative Game Clock
    if (this.isOnlineMatch) {
      this.elapsedSeconds += dt * 1.6;
      const clockDiff = this.serverElapsedSeconds - this.elapsedSeconds;
      if (Math.abs(clockDiff) > 2.5) {
        this.elapsedSeconds = this.serverElapsedSeconds;
      } else {
        this.elapsedSeconds += clockDiff * Math.min(1, dt * 4);
      }
    } else {
      this.elapsedSeconds += dt;
    }

    this.runStats.survivedSeconds = Math.min(CONFIG.RUN_DURATION_SECONDS, this.elapsedSeconds);
    this.runStats.finalTimeFormatted = formatGameClock(this.elapsedSeconds);

    const newHourIdx = getHourIndex(this.elapsedSeconds);
    this.currentHourIndex = newHourIdx;
    if (newHourIdx <= 6 && !this.triggeredHours.has(newHourIdx)) {
      this.triggerHourlyMilestone(newHourIdx);
    }
    this.checkScheduledRadioBroadcasts(false);

    // 3. Dynamic Random Events
    this.updateDynamicEvents(dt);

    if (this.screen === 'PLAYING') {
      if (this.panel === 'NONE') {
        if (
          this.input.consumeJustPressed('KeyR') ||
          this.input.consumeGamepadButton('west')
        ) {
          startWeaponReload(this.player, this.backpack, this.sound);
        }
        if (this.input.consumeGamepadButton('east')) {
          this.input.gamepadCrouchToggled = !this.input.gamepadCrouchToggled;
          if (this.input.gamepadCrouchToggled) {
            this.input.gamepadSprintToggled = false;
          }
        }
        if (this.input.consumeGamepadButton('lb')) {
          this.cycleEquippedWeapon(-1);
        }
        if (this.input.consumeGamepadButton('rb')) {
          this.cycleEquippedWeapon(1);
        }

        for (const [keyCode, dpadBtn, slotIndex] of [
          ['Digit1', 'dpad_up', 0],
          ['Digit2', 'dpad_right', 1],
          ['Digit3', 'dpad_down', 2],
          ['Digit4', 'dpad_left', 3],
        ] as const) {
          if (
            this.input.consumeJustPressed(keyCode) ||
            this.input.consumeGamepadButton(dpadBtn)
          ) {
            const candidate = this.backpack[slotIndex];
            if (candidate) {
              this.useOrEquipBackpackSlot(slotIndex);
            }
          }
        }
      }

      // 4. Player Movement & Campaign Milestone Check
      this.updatePlayerMovementAndActions(dt);
      this.updateCampaignProgression();

      // 5. World Interactions
      this.updateWorldInteractions(dt);
    }

    // 6. Combat (PvE + PvP)
    updateReloadTimer(dt, this.player, this.backpack, this.sound);
    const eqInst =
      this.player.equippedSlot !== null ? this.backpack[this.player.equippedSlot] : null;
    const eqName = eqInst ? ITEMS[eqInst.itemId]?.name || 'Firearm' : 'Firearm';
    const remoteList = [...this.remoteSurvivors.values()];

    updateProjectiles(
      dt,
      this.projectiles,
      this.world,
      this.player,
      this.sound,
      this.combatCallbacks,
      remoteList,
      eqName
    );

    // 7. Flares & Decoys
    this.updateFlares(dt);

    // 8. Hollow AI
    updateEnemiesAI(
      dt,
      this.world,
      this.player,
      this.noises,
      this.currentHourIndex,
      this.powerGridOnline,
      this.isHeavyRain,
      this.extraction.zoneActive,
      this.sound,
      {
        onPlayerDamaged: (amt, bleedChance, infectChance, attackerName) => {
          this.applyDamageToPlayer(amt, bleedChance, infectChance, `Mauled by a ${attackerName}`);
        },
        emitNoise: (x, y, rad, intensity, label, isMimicLure) => {
          this.emitNoise(x, y, rad, intensity, label, isMimicLure);
        },
        spawnSporeBurst: (x, y, rad, dur) => {
          this.world.sporeZones.push({
            id: `sp_${Date.now()}_${Math.random()}`,
            x,
            y,
            radius: rad,
            intensity: 1.0,
            permanent: false,
            remainingTime: dur,
            activeAfterHour: 0,
          });
        },
        spawnParticles: (x, y, count, color, speed, life) => {
          this.spawnParticles(x, y, count, color, speed, life);
        },
        onEnemySpotted: (dist) => {
          if (dist < 440) {
            this.cam.addShake(
              Math.max(2.2, (1 - dist / 440) * 5.2),
              this.settings.screenShake
            );
            this.input.vibrate(150, 0.55, 0.8, this.settings.controllerVibration);
          }
        },
      }
    );

    // 9. Survival Attributes
    const weightKg = calculateBackpackWeight(this.backpack, this.player.armorEquipped);
    const surv = updateSurvivalAttributes(
      dt,
      this.player,
      this.world,
      this.world.enemies,
      this.currentHourIndex,
      weightKg > CONFIG.ENCUMBERED_THRESHOLD_KG,
      this.injectionTaken
    );
    if (surv.diedCause) {
      this.killPlayer(surv.diedCause);
      return;
    }

    // 10. Extraction Sequence & 6:00 AM Check
    const extStatus = updateExtractionSequence(
      dt,
      this.elapsedSeconds,
      this.player,
      this.extraction,
      (title, text, radioOnly) => {
        if (!radioOnly || this.radioDiscovered) {
          if (this.radioDiscovered) {
            this.pushRadio('FLIGHT ECHO-7', text, true);
          }
          this.pushToast(title, text, true);
        }
      }
    );
    this.extraction.survivorsInLZ = this.survivorsInLZ;
    this.extraction.contested = this.extractionContested;

    this.sound.setWeatherAndRotor(this.isHeavyRain, extStatus.rotorAudioLevel, true);

    // Solo extraction concludes locally; Online PvPvE single-seat extraction is arbitrated by server!
    if (!this.isOnlineMatch && extStatus.extractionMomentReached && this.player.health > 0) {
      if (this.extraction.playerInZone) {
        this.finalizeRun(
          true,
          'VICTORY',
          `Survived Oakhaven, Highway F45, and Quarantine City—extracted aboard Echo-7 from ${this.extraction.site.name} at 06:00 AM!`
        );
      } else {
        this.finalizeRun(
          false,
          'MISSED_EXTRACTION',
          `Failed to reach ${this.extraction.site.name} before Echo-7 departed at 06:00 AM`
        );
      }
      return;
    }

    // 11. Emit Local Transform to Server (20 Hz)
    this.emitLocalPlayerNetUpdate(dt);

    // 12. Particles & Camera
    this.updateParticlesAndNoises(dt);
    this.cam.updateFollow(dt, this.player.x, this.player.y, this.player.angle, 32);

    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) {
        this.latestToast = null;
      }
    }

    this.uiSyncTimer += dt;
    if (this.uiSyncTimer >= 0.065) {
      this.uiSyncTimer = 0;
      this.emitSnapshot();
    }
  }

  private updatePlayerMovementAndActions(dt: number) {
    const p = this.player;
    if (p.attackCooldown > 0) p.attackCooldown = Math.max(0, p.attackCooldown - dt);
    if (p.meleeSwingTimer > 0) p.meleeSwingTimer = Math.max(0, p.meleeSwingTimer - dt);
    if (p.hurtFlash > 0) p.hurtFlash = Math.max(0, p.hurtFlash - dt);

    const mv = this.panel === 'NONE' ? this.input.getMoveVector() : { x: 0, y: 0 };

    if (this.panel === 'NONE' && this.input.gamepadAimActive) {
      p.angle = Math.atan2(this.input.gamepadAimY, this.input.gamepadAimX);
    } else if (this.panel === 'NONE' && this.input.mobileAimActive) {
      p.angle = Math.atan2(this.input.mobileAimY, this.input.mobileAimX);
    } else if (
      this.input.hasMouseMoved &&
      !this.input.isTouchDetected &&
      !this.input.isGamepadActive
    ) {
      const mw = this.cam.screenToWorld(this.input.mouseScreenX, this.input.mouseScreenY);
      p.angle = Math.atan2(mw.y - p.y, mw.x - p.x);
    } else if (this.input.isTouchDetected || this.input.isGamepadActive) {
      const firingNow =
        this.panel === 'NONE' &&
        (this.input.mobileFireJustPressed ||
          this.input.mobileFireHeld ||
          this.input.gamepadFireJustPressed ||
          this.input.gamepadFireHeld);
      let lockedTargetAngle: number | null = null;
      if (firingNow) {
        const eqInst = p.equippedSlot !== null ? this.backpack[p.equippedSlot] : null;
        const eqDef = eqInst ? ITEMS[eqInst.itemId] : null;
        const maxLockDist =
          eqDef?.category === 'weapon_ranged'
            ? Math.min(310, (eqDef.weaponStats?.range ?? 260) + 40)
            : 125;
        let bestDist = maxLockDist;
        for (const e of this.world.enemies) {
          if (e.state === 'DEAD') continue;
          const d = Math.hypot(e.x - p.x, e.y - p.y);
          if (d < bestDist && hasLineOfSight(this.world, p.x, p.y, e.x, e.y)) {
            bestDist = d;
            lockedTargetAngle = Math.atan2(e.y - p.y, e.x - p.x);
          }
        }
        for (const rs of this.remoteSurvivors.values()) {
          if (!rs.alive) continue;
          const d = Math.hypot(rs.x - p.x, rs.y - p.y);
          if (d < bestDist && hasLineOfSight(this.world, p.x, p.y, rs.x, rs.y)) {
            bestDist = d;
            lockedTargetAngle = Math.atan2(rs.y - p.y, rs.x - p.x);
          }
        }
      }
      if (lockedTargetAngle !== null) {
        p.angle = lockedTargetAngle;
      } else if (Math.hypot(mv.x, mv.y) > 0.14) {
        const targetAng = Math.atan2(mv.y, mv.x);
        let diff = targetAng - p.angle;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        p.angle += diff * Math.min(1, dt * 11);
      }
    }

    const crouchHeld =
      this.panel === 'NONE' &&
      (this.input.isHeld('ControlLeft') ||
        this.input.isHeld('ControlRight') ||
        this.input.isHeld('KeyC') ||
        this.input.mobileCrouchToggled ||
        this.input.gamepadCrouchToggled);
    const sprintHeld =
      this.panel === 'NONE' &&
      (this.input.isHeld('ShiftLeft') ||
        this.input.isHeld('ShiftRight') ||
        this.input.mobileSprintToggled ||
        this.input.gamepadSprintHeld ||
        this.input.gamepadSprintToggled) &&
      !crouchHeld &&
      !p.conditions.exhausted &&
      p.stamina > 4;

    p.isCrouching = crouchHeld;
    p.isSprinting = sprintHeld;

    const curWeight = calculateBackpackWeight(this.backpack, p.armorEquipped);
    const encumberedFactor = curWeight > CONFIG.ENCUMBERED_THRESHOLD_KG ? 0.84 : 1.0;

    let baseSpeed: number = CONFIG.SPEED_WALK;
    if (p.isCrouching) baseSpeed = CONFIG.SPEED_CROUCH;
    else if (p.isSprinting) baseSpeed = CONFIG.SPEED_SPRINT;
    baseSpeed *= encumberedFactor;

    if (mv.x !== 0 || mv.y !== 0) {
      this.autoOpenDoorsInPath(p.x, p.y, mv.x, mv.y, p.radius);
    }

    const desiredStep = baseSpeed * dt;
    const nextX = p.x + mv.x * desiredStep;
    const nextY = p.y + mv.y * desiredStep;
    let resolved = resolveCircleWorldCollision(this.world, nextX, nextY, p.radius);

    if ((mv.x !== 0 || mv.y !== 0) && resolved.collided) {
      resolved = this.applyDoorwaySlideAssist(p.x, p.y, mv.x, mv.y, desiredStep, p.radius, resolved);
    }

    const actualDx = resolved.x - p.x;
    const actualDy = resolved.y - p.y;
    const stepPixels = Math.hypot(actualDx, actualDy);

    p.vx = actualDx / dt;
    p.vy = actualDy / dt;
    p.x = resolved.x;
    p.y = resolved.y;
    this.runStats.distanceTraveledMeters += stepPixels / CONFIG.TILE_SIZE;

    p.animTime += dt;
    const currentSpeed = stepPixels / dt;
    const isMoving = currentSpeed > 10;

    if (p.meleeSwingTimer > 0) {
      p.animState = 'melee';
    } else if (p.isReloading) {
      p.animState = 'reload';
    } else if (isMoving) {
      p.animState = p.isCrouching ? 'crouch' : p.isSprinting ? 'sprint' : 'walk';
    } else {
      p.animState = p.isCrouching ? 'crouch' : 'idle';
    }

    if (isMoving) {
      p.stepDistanceAccum += stepPixels;
      const stepStridePx = p.isSprinting ? 48 : p.isCrouching ? 56 : 52;
      if (p.stepDistanceAccum >= stepStridePx) {
        p.stepDistanceAccum = 0;
        this.sound.playFootstep(
          p.isSprinting,
          p.isCrouching,
          this.getSurfaceMaterialAt(p.x, p.y)
        );
        const rad = p.isCrouching
          ? CONFIG.NOISE_CROUCH_STEP
          : p.isSprinting
          ? CONFIG.NOISE_SPRINT_STEP
          : CONFIG.NOISE_WALK_STEP;
        const inten = p.isCrouching ? 0.18 : p.isSprinting ? 0.68 : 0.36;
        this.emitNoise(p.x, p.y, rad, inten, 'Footsteps');
      }
    }

    if (this.panel === 'NONE') {
      const fireTriggered =
        this.input.mouseJustPressed ||
        this.input.mobileFireJustPressed ||
        this.input.gamepadFireJustPressed ||
        (this.input.mouseDown && p.attackCooldown <= 0) ||
        (this.input.mobileFireHeld && p.attackCooldown <= 0) ||
        (this.input.gamepadFireHeld && p.attackCooldown <= 0);

      if (fireTriggered) {
        this.sound.ensureUnlocked();
        performPlayerAttack(
          this.player,
          this.backpack,
          this.world,
          this.projectiles,
          this.sound,
          this.combatCallbacks,
          [...this.remoteSurvivors.values()]
        );
      }
    }
  }

  private getSurfaceMaterialAt(wx: number, wy: number): SurfaceMaterial {
    const tx = Math.max(0, Math.min(this.world.width - 1, Math.floor(wx / CONFIG.TILE_SIZE)));
    const ty = Math.max(0, Math.min(this.world.height - 1, Math.floor(wy / CONFIG.TILE_SIZE)));
    const tile = this.world.tiles[ty * this.world.width + tx] as TileType;
    switch (tile) {
      case TileType.WOOD_FLOOR:
        return 'wood';
      case TileType.TILE_FLOOR:
      case TileType.CHECKER_FLOOR:
      case TileType.HOSPITAL_FLOOR:
        return 'tile';
      case TileType.GRASS:
      case TileType.STADIUM_TURF:
      case TileType.DIRT_PATH:
        return 'grass';
      case TileType.RAMP:
      case TileType.STAIRS:
      case TileType.HELIPAD:
      case TileType.ROOFTOP_DECK:
        return 'metal';
      default:
        return 'asphalt';
    }
  }

  private applyDoorTileDirect(tx: number, ty: number, open: boolean) {
    const W = this.world.width;
    const H = this.world.height;
    if (tx < 0 || tx >= W || ty < 0 || ty >= H) return;
    const targetFrom = open ? TileType.DOOR_CLOSED : TileType.DOOR_OPEN;
    const targetTo = open ? TileType.DOOR_OPEN : TileType.DOOR_CLOSED;
    if (this.world.tiles[ty * W + tx] !== targetFrom) return;
    this.world.tiles[ty * W + tx] = targetTo;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = tx + dx;
      const ny = ty + dy;
      if (nx >= 0 && nx < W && ny >= 0 && ny < H) {
        if (this.world.tiles[ny * W + nx] === targetFrom) {
          this.world.tiles[ny * W + nx] = targetTo;
        }
      }
    }
  }

  private openDoorTileAndPair(tx: number, ty: number) {
    const W = this.world.width;
    const H = this.world.height;
    const T = CONFIG.TILE_SIZE;
    if (tx < 0 || tx >= W || ty < 0 || ty >= H) return;
    if (this.world.tiles[ty * W + tx] !== TileType.DOOR_CLOSED) return;

    this.applyDoorTileDirect(tx, ty, true);
    if (this.isOnlineMatch) {
      this.mp.send({ type: 'world:door_toggled', tx, ty, open: true });
    }
    const cx = tx * T + T / 2;
    const cy = ty * T + T / 2;
    this.sound.playDoor(this.player.x, this.player.y, cx, cy, 'open');
    this.emitNoise(cx, cy, CONFIG.NOISE_DOOR, 0.45, 'Door opened');
  }

  private autoOpenDoorsInPath(px: number, py: number, mvx: number, mvy: number, radius: number) {
    const T = CONFIG.TILE_SIZE;
    const probeX = px + mvx * (radius + 14);
    const probeY = py + mvy * (radius + 14);
    const minTx = Math.max(0, Math.floor((Math.min(px, probeX) - radius - 6) / T));
    const maxTx = Math.min(this.world.width - 1, Math.floor((Math.max(px, probeX) + radius + 6) / T));
    const minTy = Math.max(0, Math.floor((Math.min(py, probeY) - radius - 6) / T));
    const maxTy = Math.min(this.world.height - 1, Math.floor((Math.max(py, probeY) + radius + 6) / T));

    for (let ty = minTy; ty <= maxTy; ty++) {
      for (let tx = minTx; tx <= maxTx; tx++) {
        if (this.world.tiles[ty * this.world.width + tx] === TileType.DOOR_CLOSED) {
          const rx = tx * T;
          const ry = ty * T;
          const closestX = Math.max(rx, Math.min(probeX, rx + T));
          const closestY = Math.max(ry, Math.min(probeY, ry + T));
          const dist = Math.hypot(probeX - closestX, probeY - closestY);
          const toDoorX = rx + T * 0.5 - px;
          const toDoorY = ry + T * 0.5 - py;
          const toLen = Math.hypot(toDoorX, toDoorY) || 1;
          const dot = (toDoorX / toLen) * mvx + (toDoorY / toLen) * mvy;
          if (dist <= radius + 4 && dot > 0.2) {
            this.openDoorTileAndPair(tx, ty);
          }
        }
      }
    }
  }

  private applyDoorwaySlideAssist(
    px: number,
    py: number,
    mvx: number,
    mvy: number,
    step: number,
    radius: number,
    currentResolved: { x: number; y: number; collided: boolean }
  ): { x: number; y: number; collided: boolean } {
    const T = CONFIG.TILE_SIZE;
    const W = this.world.width;
    const H = this.world.height;
    const ptx = Math.floor(px / T);
    const pty = Math.floor(py / T);

    let nudgeX = 0;
    let nudgeY = 0;

    if (Math.abs(mvy) > 0.25) {
      const aheadTy = pty + (mvy > 0 ? 1 : -1);
      if (aheadTy >= 0 && aheadTy < H) {
        let bestCenterX: number | null = null;
        let bestAbsDx = 38;
        for (let dx = -1; dx <= 1; dx++) {
          const tx = ptx + dx;
          if (tx < 0 || tx >= W) continue;
          const t = this.world.tiles[aheadTy * W + tx] as TileType;
          if (!isSolidTile(t)) {
            const cx = tx * T + T * 0.5;
            const absDx = Math.abs(cx - px);
            if (absDx < bestAbsDx) {
              bestAbsDx = absDx;
              bestCenterX = cx;
            }
          }
        }
        if (bestCenterX !== null && bestAbsDx > 1.5) {
          const dir = Math.sign(bestCenterX - px);
          nudgeX = dir * Math.min(bestAbsDx, step * 1.15);
        }
      }
    }

    if (Math.abs(mvx) > 0.25) {
      const aheadTx = ptx + (mvx > 0 ? 1 : -1);
      if (aheadTx >= 0 && aheadTx < W) {
        let bestCenterY: number | null = null;
        let bestAbsDy = 38;
        for (let dy = -1; dy <= 1; dy++) {
          const ty = pty + dy;
          if (ty < 0 || ty >= H) continue;
          const t = this.world.tiles[ty * W + aheadTx] as TileType;
          if (!isSolidTile(t)) {
            const cy = ty * T + T * 0.5;
            const absDy = Math.abs(cy - py);
            if (absDy < bestAbsDy) {
              bestAbsDy = absDy;
              bestCenterY = cy;
            }
          }
        }
        if (bestCenterY !== null && bestAbsDy > 1.5) {
          const dir = Math.sign(bestCenterY - py);
          nudgeY = dir * Math.min(bestAbsDy, step * 1.15);
        }
      }
    }

    if (nudgeX !== 0 || nudgeY !== 0) {
      const assisted = resolveCircleWorldCollision(
        this.world,
        px + mvx * step + nudgeX,
        py + mvy * step + nudgeY,
        radius
      );
      const origProgress = (currentResolved.x - px) * mvx + (currentResolved.y - py) * mvy;
      const newProgress = (assisted.x - px) * mvx + (assisted.y - py) * mvy;
      if (newProgress >= origProgress - 0.1) {
        return assisted;
      }
    }

    return currentResolved;
  }

  private findNearbySpecialProp(kind: ObstacleProp['kind'], maxDist = 70): ObstacleProp | null {
    for (const pr of this.world.props) {
      if (pr.kind !== kind) continue;
      const cx = pr.x + pr.w * 0.5;
      const cy = pr.y + pr.h * 0.5;
      if (Math.hypot(cx - this.player.x, cy - this.player.y) <= maxDist) {
        return pr;
      }
    }
    return null;
  }

  private updateWorldInteractions(dt: number) {
    if (this.searchingContainer) {
      const d = Math.hypot(
        this.player.x - this.searchingContainer.x,
        this.player.y - this.searchingContainer.y
      );
      if (d > 62) {
        this.searchingContainer = null;
        this.searchProgressSec = 0;
        this.searchRummageTimer = 0;
      } else {
        const hasCrowbar = countItemInBackpack(this.backpack, 'crowbar') > 0;
        const speedMult = hasCrowbar ? 1.4 : 1.0;
        this.searchProgressSec += dt * speedMult;
        this.searchRummageTimer -= dt * speedMult;
        if (
          this.searchRummageTimer <= 0 &&
          this.searchProgressSec < this.searchingContainer.searchDuration - 0.08
        ) {
          this.searchRummageTimer = 0.33;
          this.sound.playSearchRummageStep(
            this.searchingContainer.type,
            this.searchRummageStep++
          );
        }
        if (this.searchProgressSec >= this.searchingContainer.searchDuration) {
          const openedType = this.searchingContainer.type;
          this.searchingContainer.searched = true;
          this.runStats.containersSearched += 1;
          this.broadcastContainerSync(this.searchingContainer);
          this.activeContainer = this.searchingContainer;
          this.searchingContainer = null;
          this.searchProgressSec = 0;
          this.searchRummageTimer = 0;
          this.sound.playContainerOpen(openedType);
          this.sound.playBackpackZip(true);
          this.panel = 'LOOT';
          this.emitSnapshot();
        }
      }
    }

    if (this.panel === 'LOOT' && this.activeContainer) {
      const d = Math.hypot(
        this.player.x - this.activeContainer.x,
        this.player.y - this.activeContainer.y
      );
      if (d > 68) {
        this.panel = 'NONE';
        this.activeContainer = null;
        this.sound.playBackpackZip(false);
      }
    }

    if (
      this.panel === 'NONE' &&
      (this.input.consumeJustPressed('KeyE') || this.input.consumeGamepadButton('south'))
    ) {
      this.sound.ensureUnlocked();
      this.executeContextualInteract();
    }
  }

  private executeContextualInteract() {
    const p = this.player;
    const T = CONFIG.TILE_SIZE;

    // 1. St. Jude Hospital Antiviral Injection Station (per-survivor dose in PvPvE!)
    const antiviralProp = this.findNearbySpecialProp('antiviral_station', 72);
    if (antiviralProp && !this.injectionTaken) {
      if (!this.isOnlineMatch) antiviralProp.used = true;
      this.injectionTaken = true;
      p.contamination = Math.max(0, p.contamination - 75);
      p.conditions.bleeding = false;
      p.bleedTimer = 0;
      p.conditions.infected = false;
      p.infectionTimer = 0;
      p.conditions.sporeExposure = false;
      p.health = Math.min(p.maxHealth, p.health + 28);
      this.sound.playItemUse('antiviral');
      this.input.vibrate(140, 0.55, 0.7, this.settings.controllerVibration);
      this.spawnParticles(p.x, p.y, 18, '#22d3ee', 105, 0.45);
      if (this.isOnlineMatch) {
        this.mp.send({
          type: 'combat:attack',
          kind: 'melee',
          weaponId: null,
          x: p.x,
          y: p.y,
          angle: p.angle,
          noiseRadius: 210,
          label: 'Bio-Ward Dispenser',
        });
      }
      if (!this.radioDiscovered) {
        this.campaignStage = 'HOSPITAL_RADIO';
        this.pushToast(
          'Antiviral Injection Administered!',
          'Contamination purged! Now enter the Hospital Dispatch Room right next door (west) and tune the Emergency Radio!',
          true
        );
      } else {
        this.pushToast('Antiviral Serum Injected', 'Contamination purged.', false);
      }
      this.emitSnapshot();
      return;
    }

    // 2. St. Jude Hospital Emergency Radio Console!
    const radioProp = this.findNearbySpecialProp('hospital_radio', 72);
    if (radioProp) {
      if (!this.injectionTaken) {
        this.pushToast(
          'Contamination Rising!',
          'Administer the Antiviral Injection in the east Bio-Ward room right next door first!',
          true
        );
        return;
      }
      if (!this.radioDiscovered) {
        if (!this.isOnlineMatch) radioProp.used = true;
        this.radioDiscovered = true;
        this.extraction.coordinatesKnown = true;
        this.campaignStage = 'SURVIVE_TO_HELIPAD';
        const broadcast = buildHospitalRadioBroadcast(this.extraction.site);
        this.pushRadio('HOSPITAL EMERGENCY RADIO', broadcast, true);
        this.pushToast(
          `6:00 AM Helicopter: ${this.extraction.site.shortName}`,
          this.isOnlineMatch
            ? `${broadcast} WARNING: Only ONE seat aboard Echo-7!`
            : broadcast,
          true
        );
        this.emitSnapshot();
        return;
      } else {
        this.setPanel('PHONE');
        return;
      }
    }

    // 3. Ground item pickup
    let nearestGroundIdx = -1;
    let nearestGroundDist = 46;
    for (let i = 0; i < this.world.groundItems.length; i++) {
      const gi = this.world.groundItems[i];
      const d = Math.hypot(gi.x - p.x, gi.y - p.y);
      if (d < nearestGroundDist) {
        nearestGroundDist = d;
        nearestGroundIdx = i;
      }
    }
    if (nearestGroundIdx >= 0) {
      const gi = this.world.groundItems[nearestGroundIdx];
      const res = addItemToBackpack(this.backpack, p.armorEquipped, gi.item);
      const def = ITEMS[gi.item.itemId];
      if (res.remaining <= 0) {
        this.world.groundItems.splice(nearestGroundIdx, 1);
        if (this.isOnlineMatch) {
          this.mp.send({ type: 'world:ground_item_taken', groundItemId: gi.id });
        }
        this.sound.playPickup(gi.item.itemId);
        this.pushToast('Picked Up', `${def?.name ?? gi.item.itemId}`, false);
      } else {
        gi.item.quantity = res.remaining;
        if (res.added > 0) {
          this.sound.playPickup(gi.item.itemId);
        }
        this.pushToast(
          res.reason === 'weight' ? 'Too Heavy' : 'Backpack Full',
          'Clear space or weight in your 12-slot pack.',
          true
        );
      }
      this.emitSnapshot();
      return;
    }

    // 4. Active Landing Zone Auxiliary Floodlight Generator
    const genPos = this.world.activeExtractionSite.generatorPos;
    const genDist = Math.hypot(p.x - genPos.x, p.y - genPos.y);
    if (genDist < 68 && !this.extraction.generatorPowered) {
      if (countItemInBackpack(this.backpack, 'fuel_canister') > 0) {
        consumeItemQuantity(this.backpack, 'fuel_canister', 1);
        this.extraction.generatorPowered = true;
        for (const pr of this.world.props) {
          if (pr.kind === 'generator') pr.powered = true;
        }
        if (this.isOnlineMatch) {
          this.mp.send({ type: 'world:generator_powered' });
        }
        this.sound.playGeneratorIgnite();
        this.emitNoise(p.x, p.y, 360, 0.75, 'Landing zone generator ignited');
        this.pushToast(
          'LZ Floodlights Online',
          `${this.extraction.site.shortName} landing floodlights powered up!`,
          false
        );
        this.emitSnapshot();
        return;
      } else {
        this.pushToast(
          'Generator Dry',
          'Requires a Fuel Canister from Industrial Yard, Parking, or Military Base.',
          false
        );
        return;
      }
    }

    // 5. Nearby Container
    let nearestCont: ContainerEntity | null = null;
    let nearestContDist = 56;
    for (const c of this.world.containers) {
      const d = Math.hypot(c.x - p.x, c.y - p.y);
      if (d < nearestContDist) {
        nearestContDist = d;
        nearestCont = c;
      }
    }
    if (nearestCont) {
      if (nearestCont.searched) {
        this.activeContainer = nearestCont;
        const opening = this.panel !== 'LOOT';
        this.panel = opening ? 'LOOT' : 'NONE';
        if (opening) {
          this.sound.playContainerOpen(nearestCont.type);
        } else {
          this.activeContainer = null;
        }
        this.sound.playBackpackZip(opening);
      } else {
        this.sound.playSearchRummageStep(nearestCont.type, 0);
        this.searchingContainer = nearestCont;
        this.searchProgressSec = 0;
        this.searchRummageTimer = 0.33;
        this.searchRummageStep = 1;
        this.emitNoise(
          nearestCont.x,
          nearestCont.y,
          CONFIG.NOISE_SEARCH,
          0.42,
          `Searching ${nearestCont.label}`
        );
      }
      this.emitSnapshot();
      return;
    }

    // 6. Nearby Door or Window
    const ptx = Math.floor(p.x / T);
    const pty = Math.floor(p.y / T);
    let bestDoor: { tx: number; ty: number; dist: number; tile: TileType } | null = null;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const tx = ptx + dx;
        const ty = pty + dy;
        if (tx < 0 || tx >= this.world.width || ty < 0 || ty >= this.world.height) continue;
        const t = this.world.tiles[ty * this.world.width + tx] as TileType;
        if (t === TileType.DOOR_CLOSED || t === TileType.DOOR_OPEN || t === TileType.WINDOW) {
          const cx = tx * T + T / 2;
          const cy = ty * T + T / 2;
          const d = Math.hypot(cx - p.x, cy - p.y);
          if (d < 68 && (!bestDoor || d < bestDoor.dist)) {
            bestDoor = { tx, ty, dist: d, tile: t };
          }
        }
      }
    }

    if (bestDoor) {
      const cx = bestDoor.tx * T + T / 2;
      const cy = bestDoor.ty * T + T / 2;
      if (bestDoor.tile === TileType.DOOR_CLOSED) {
        this.openDoorTileAndPair(bestDoor.tx, bestDoor.ty);
      } else if (bestDoor.tile === TileType.DOOR_OPEN) {
        if (Math.hypot(cx - p.x, cy - p.y) > p.radius + 10) {
          this.applyDoorTileDirect(bestDoor.tx, bestDoor.ty, false);
          if (this.isOnlineMatch) {
            this.mp.send({
              type: 'world:door_toggled',
              tx: bestDoor.tx,
              ty: bestDoor.ty,
              open: false,
            });
          }
          this.sound.playDoor(p.x, p.y, cx, cy, 'close');
          this.emitNoise(cx, cy, CONFIG.NOISE_DOOR, 0.45, 'Door shut');
        }
      } else if (bestDoor.tile === TileType.WINDOW) {
        this.world.tiles[bestDoor.ty * this.world.width + bestDoor.tx] = TileType.WINDOW_BROKEN;
        if (this.isOnlineMatch) {
          this.mp.send({
            type: 'world:window_broken',
            tx: bestDoor.tx,
            ty: bestDoor.ty,
          });
        }
        this.sound.playGlassBreak(p.x, p.y, cx, cy);
        this.emitNoise(cx, cy, CONFIG.NOISE_WINDOW_BREAK, 0.9, 'Window smashed');
        this.spawnParticles(cx, cy, 14, '#bae6fd', 135, 0.35);
      }
    }
  }

  private computeInteractionPrompt(): InteractionPrompt | null {
    const p = this.player;
    const T = CONFIG.TILE_SIZE;

    if (this.searchingContainer) {
      return {
        label: `Searching ${this.searchingContainer.label}...`,
        sublabel: 'Move to cancel',
        progress: Math.min(1, this.searchProgressSec / this.searchingContainer.searchDuration),
        kind: 'container',
      };
    }

    const antiviralProp = this.findNearbySpecialProp('antiviral_station', 72);
    if (antiviralProp && !this.injectionTaken) {
      return {
        label: '[E] Inject St. Jude Antiviral Serum',
        sublabel: 'Purges Hollow contamination & stabilizes vitals',
        kind: 'antiviral',
      };
    }

    const radioProp = this.findNearbySpecialProp('hospital_radio', 72);
    if (radioProp) {
      if (!this.injectionTaken) {
        return {
          label: 'Hospital Emergency Radio',
          sublabel: 'Take Antiviral Injection in east room first!',
          kind: 'radio',
        };
      }
      if (!this.radioDiscovered) {
        return {
          label: '[E] Tune Hospital Emergency Radio',
          sublabel: 'Receive 6:00 AM Helicopter Rescue Coordinates',
          kind: 'radio',
        };
      }
      return {
        label: '[E] Open Phone Radio & Map',
        sublabel: `6:00 AM LZ: ${this.extraction.site.shortName}`,
        kind: 'radio',
      };
    }

    for (const gi of this.world.groundItems) {
      if (Math.hypot(gi.x - p.x, gi.y - p.y) < 46) {
        const def = ITEMS[gi.item.itemId];
        return {
          label: `[E] Pick up ${def?.name ?? gi.item.itemId} (${gi.item.quantity})`,
          kind: 'pickup',
        };
      }
    }

    const genPos = this.world.activeExtractionSite.generatorPos;
    if (!this.extraction.generatorPowered && Math.hypot(p.x - genPos.x, p.y - genPos.y) < 68) {
      const hasFuel = countItemInBackpack(this.backpack, 'fuel_canister') > 0;
      return {
        label: hasFuel
          ? '[E] Fuel Landing Zone Floodlights'
          : 'LZ Floodlight Generator (Needs Fuel Canister)',
        kind: 'generator',
      };
    }

    for (const c of this.world.containers) {
      if (Math.hypot(c.x - p.x, c.y - p.y) < 56) {
        return {
          label: c.searched ? `[E] Open ${c.label}` : `[E] Search ${c.label}`,
          sublabel: c.searched ? 'Searched' : `${c.searchDuration.toFixed(1)}s · Makes light noise`,
          kind: 'container',
        };
      }
    }

    const ptx = Math.floor(p.x / T);
    const pty = Math.floor(p.y / T);
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const tx = ptx + dx;
        const ty = pty + dy;
        if (tx < 0 || tx >= this.world.width || ty < 0 || ty >= this.world.height) continue;
        const t = this.world.tiles[ty * this.world.width + tx] as TileType;
        const d = Math.hypot(tx * T + T / 2 - p.x, ty * T + T / 2 - p.y);
        if (d < 68) {
          if (t === TileType.DOOR_CLOSED) return { label: '[E] Open Door', kind: 'door' };
          if (t === TileType.DOOR_OPEN && d > p.radius + 10) {
            return { label: '[E] Close Door', kind: 'door' };
          }
          if (t === TileType.WINDOW) {
            return {
              label: '[E] Smash Window',
              sublabel: 'Loud noise!',
              kind: 'window',
            };
          }
        }
      }
    }

    return null;
  }

  private checkScheduledRadioBroadcasts(isInitialSync: boolean) {
    const H = CONFIG.SECONDS_PER_GAME_HOUR;
    let latestToPlay: RadioBroadcastDef | null = null;

    for (const b of RADIO_BROADCASTS) {
      const triggerSec = b.triggerGameHours * H;
      // Pre-warm upcoming broadcast 45 seconds before its scheduled time
      if (
        !this.preloadedBroadcastIds.has(b.id) &&
        this.elapsedSeconds >= Math.max(0, triggerSec - 45)
      ) {
        this.preloadedBroadcastIds.add(b.id);
        this.radioPlayer.preloadBroadcast(b.id);
      }

      if (!this.triggeredBroadcastIds.has(b.id) && this.elapsedSeconds >= triggerSec) {
        this.triggeredBroadcastIds.add(b.id);
        this.logBreakingNewsBroadcast(b);
        latestToPlay = b;

        // 5:00 AM Final Evacuation Broadcast reveals Rooftop Sector C citywide
        if (b.id === 'broadcast_0500am') {
          this.radioDiscovered = true;
          this.extraction.coordinatesKnown = true;
          this.campaignStage = 'SURVIVE_TO_HELIPAD';
        }
      }
    }

    if (latestToPlay) {
      void this.radioPlayer.playBroadcast(latestToPlay.id);
    } else if (isInitialSync && this.elapsedSeconds < 5 && !this.triggeredBroadcastIds.has('broadcast_1100pm')) {
      const first = RADIO_BROADCASTS[0];
      this.triggeredBroadcastIds.add(first.id);
      this.logBreakingNewsBroadcast(first);
      void this.radioPlayer.playBroadcast(first.id);
    }
  }

  private logBreakingNewsBroadcast(b: RadioBroadcastDef) {
    const msg: RadioMessage = {
      id: `rad_bn_${b.id}_${Date.now()}`,
      timeFormatted: b.timeLabel,
      sender: 'EMERGENCY DISPATCH · 162.55 MHz',
      text: formatBroadcastSummaryText(b),
      urgent: b.urgent,
      broadcastId: b.id,
      headline: b.headline,
      toneSummary: b.toneSummary,
      transcript: b.transcript.map((blk) => ({
        type: blk.type,
        speaker: blk.speaker,
        cue: blk.cue,
        lines: blk.lines ? [...blk.lines] : undefined,
      })),
    };
    this.radioMessages.unshift(msg);
    if (this.panel !== 'PHONE') {
      this.unreadRadioCount += 1;
    }
  }

  private triggerHourlyMilestone(hourIdx: number) {
    this.triggeredHours.add(hourIdx);
    const ms = this.milestones.find((m) => m.hourIndex === hourIdx);
    if (!ms) return;

    // 11:00 PM (hour 0), 3:00 AM (hour 4), and 5:00 AM (hour 6) feature full Breaking News Radio voice broadcasts
    if (hourIdx !== 0 && hourIdx !== 4 && hourIdx !== 6) {
      if (this.radioDiscovered) {
        this.pushRadio(ms.sender, ms.radioMessage, ms.urgent);
        this.pushToast(`${ms.timeLabel} — ${ms.sender}`, ms.radioMessage, ms.urgent);
      } else {
        this.pushToast(`${ms.timeLabel}`, ms.worldAlert, ms.urgent);
      }
    } else if (hourIdx === 0) {
      this.pushToast(`${ms.timeLabel}`, ms.worldAlert, ms.urgent);
    }

    if (hourIdx === 2) {
      this.powerGridOnline = false;
      this.sound.playPowerDown();
    } else if (hourIdx >= 1) {
      this.sound.playHourlyBell(hourIdx);
    }
  }

  private updateDynamicEvents(dt: number) {
    if (this.activeWeatherEventTimer > 0) {
      this.activeWeatherEventTimer -= dt;
      if (this.activeWeatherEventTimer <= 0) {
        this.isHeavyRain = false;
      }
    }

    this.nextRandomEventTimer -= dt;
    if (this.nextRandomEventTimer <= 0) {
      this.nextRandomEventTimer = 85 + Math.random() * 55;
      const eligible = DYNAMIC_EVENT_POOL.filter(
        (ev) =>
          this.currentHourIndex >= ev.minHourIndex &&
          this.currentHourIndex <= ev.maxHourIndex
      );
      if (eligible.length === 0) return;

      const totalW = eligible.reduce((s, e) => s + e.weight, 0);
      let roll = Math.random() * totalW;
      let chosen = eligible[0];
      for (const ev of eligible) {
        roll -= ev.weight;
        if (roll <= 0) {
          chosen = ev;
          break;
        }
      }

      if (chosen.kind === 'heavy_rain') {
        this.isHeavyRain = true;
        this.activeWeatherEventTimer = chosen.durationSeconds;
      } else if (chosen.kind === 'emergency_siren') {
        this.sound.playSiren();
        const cx = 146 * CONFIG.TILE_SIZE;
        const cy = 44 * CONFIG.TILE_SIZE;
        this.emitNoise(cx, cy, CONFIG.NOISE_ALARM, 1.0, 'Emergency Siren');
      } else if (chosen.kind === 'distant_screams') {
        const angle = Math.random() * Math.PI * 2;
        const sx = this.player.x + Math.cos(angle) * 420;
        const sy = this.player.y + Math.sin(angle) * 420;
        this.sound.playEnemyVocal('mimic', this.player.x, this.player.y, sx, sy, 'ambient');
        this.emitNoise(sx, sy, 360, 0.75, 'Distant scream');
      } else if (chosen.kind === 'spore_outbreak') {
        const angle = Math.random() * Math.PI * 2;
        const maxW = (this.world.width - 4) * CONFIG.TILE_SIZE;
        const maxH = (this.world.height - 4) * CONFIG.TILE_SIZE;
        const sx = Math.max(200, Math.min(maxW, this.player.x + Math.cos(angle) * 380));
        const sy = Math.max(200, Math.min(maxH, this.player.y + Math.sin(angle) * 380));
        const stx = Math.floor(sx / CONFIG.TILE_SIZE);
        const sty = Math.floor(sy / CONFIG.TILE_SIZE);
        const stTile = this.world.tiles[sty * this.world.width + stx] as TileType;
        if (
          stTile === TileType.ASPHALT ||
          stTile === TileType.GRASS ||
          stTile === TileType.ALLEY ||
          stTile === TileType.DIRT_PATH
        ) {
          this.world.sporeZones.push({
            id: `sp_evt_${Date.now()}`,
            x: sx,
            y: sy,
            radius: 72,
            intensity: 0.65,
            permanent: false,
            remainingTime: chosen.durationSeconds,
            activeAfterHour: 0,
          });
        }
      } else if (chosen.kind === 'survivor_signal') {
        if (this.radioDiscovered) {
          this.pushRadio(
            'TRANSPONDER PING',
            `Supply cache detected along route toward ${this.extraction.site.shortName}.`,
            false
          );
        }
      } else if (chosen.kind === 'radio_interference') {
        if (this.radioDiscovered) {
          this.sound.playRadioStatic(false);
        }
      }

      this.pushToast(chosen.title, chosen.description, false);
    }
  }

  private updateFlares(dt: number) {
    for (let i = this.flares.length - 1; i >= 0; i--) {
      const fl = this.flares[i];
      fl.remaining -= dt;
      fl.pulseTimer -= dt;
      if (fl.pulseTimer <= 0) {
        fl.pulseTimer = fl.type === 'noisemaker' ? 1.1 : 3.5;
        if (fl.type === 'noisemaker') {
          this.sound.playAlarmDecoyPulse(this.player.x, this.player.y, fl.x, fl.y);
          this.emitNoise(fl.x, fl.y, 460, 0.92, 'Alarm Decoy');
        } else {
          this.spawnParticles(fl.x, fl.y, 3, '#f87171', 35, 0.4);
        }
      }
      if (fl.remaining <= 0) {
        this.flares.splice(i, 1);
      }
    }
  }

  private applyDamageToPlayer(
    rawAmount: number,
    bleedChance: number,
    infectChance: number,
    deathMessage: string
  ) {
    if (this.player.animState === 'dead') return;
    const armorMult = this.player.armorEquipped ? 0.7 : 1.0;
    const dmg = Math.max(1, Math.round(rawAmount * armorMult));

    this.player.health = Math.max(0, this.player.health - dmg);
    this.player.hurtFlash = 0.24;
    this.runStats.damageTaken += dmg;

    this.sound.playPlayerHurt();
    this.cam.addShake(6.5, this.settings.screenShake);
    this.input.vibrate(230, 0.75, 0.95, this.settings.controllerVibration);
    this.spawnParticles(this.player.x, this.player.y, 12, '#dc2626', 130, 0.42);

    if (Math.random() < bleedChance && !this.player.conditions.bleeding) {
      this.player.conditions.bleeding = true;
      this.player.bleedTimer = CONFIG.BLEEDING_DURATION_SEC;
      this.pushToast('Bleeding!', 'Use a Bandage, Painkillers, or Medkit (or wait 18s to clot).', true);
    }
    if (Math.random() < infectChance && !this.player.conditions.infected) {
      this.player.conditions.infected = true;
      this.player.infectionTimer = CONFIG.INFECTION_DURATION_SEC;
      this.pushToast('Infected Wound!', 'Treat with Antiseptic or Antiviral.', true);
    }

    if (this.player.health <= 0) {
      this.killPlayer(deathMessage, false);
    }
    this.emitSnapshot();
  }

  private dropAllBackpackLootOnDeath() {
    if (!this.isOnlineMatch || this.deathLootDropped) return;
    this.deathLootDropped = true;
    const dropped: GroundItem[] = [];
    for (let i = 0; i < this.backpack.length; i++) {
      const it = this.backpack[i];
      if (!it) continue;
      const angle = (i / this.backpack.length) * Math.PI * 2;
      const dist = 14 + (i % 3) * 10;
      const gi: GroundItem = {
        id: `gnd_rip_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 6)}`,
        x: this.player.x + Math.cos(angle) * dist,
        y: this.player.y + Math.sin(angle) * dist,
        item: it,
      };
      this.world.groundItems.push(gi);
      dropped.push(gi);
      this.backpack[i] = null;
    }
    if (dropped.length > 0) {
      this.mp.send({ type: 'world:ground_items_dropped', items: dropped });
    }
  }

  private killPlayer(cause: string, fromPvPServer = false) {
    if (this.player.animState === 'dead') return;
    this.player.health = 0;
    this.player.animState = 'dead';
    this.panel = 'NONE';
    this.activeContainer = null;
    this.searchingContainer = null;
    this.runStats.causeOfDeath = cause;
    this.deathDelayTimer = 1.35;
    this.sound.playDeathSting();

    if (this.isOnlineMatch) {
      this.dropAllBackpackLootOnDeath();
      if (!fromPvPServer) {
        this.mp.send({ type: 'player:died_pve', cause });
      }
    }
    this.emitSnapshot();
  }

  private finalizeRun(
    extracted: boolean,
    targetScreen: 'DEATH' | 'VICTORY' | 'MISSED_EXTRACTION',
    reason: string
  ) {
    this.runStats.extracted = extracted;
    this.runStats.causeOfDeath = reason;
    this.runStats.survivedSeconds = Math.min(CONFIG.RUN_DURATION_SECONDS, this.elapsedSeconds);
    this.runStats.finalTimeFormatted = formatGameClock(this.elapsedSeconds);
    this.runStats.isOnlineMatch = this.isOnlineMatch;
    this.runStats.pvpKills = this.localPvpKills;
    if (this.localPlacement !== undefined) {
      this.runStats.placement = this.localPlacement;
    }
    if (this.onlineTotalParticipants > 0) {
      this.runStats.totalParticipants = this.onlineTotalParticipants;
    }
    this.runStats.winnerCallsign = this.matchWinnerCallsign;

    this.records = recordCompletedRun(this.runStats);
    this.screen = targetScreen;
    this.panel = 'NONE';
    this.radioPlayer.stop();
    this.sound.setWeatherAndRotor(false, 0, false);
    if (extracted) {
      this.sound.playExtractionVictory();
    } else if (targetScreen === 'MISSED_EXTRACTION') {
      this.sound.playDeathSting();
    }
    this.emitSnapshot();
  }

  private combatCallbacks = {
    emitNoise: (x: number, y: number, radius: number, intensity: number, label: string) => {
      this.emitNoise(x, y, radius, intensity, label);
    },
    spawnParticles: (
      x: number,
      y: number,
      count: number,
      color: string,
      speed: number,
      life = 0.3
    ) => {
      this.spawnParticles(x, y, count, color, speed, life);
    },
    triggerShake: (amount: number) => {
      this.cam.addShake(amount, this.settings.screenShake);
    },
    triggerHitstop: (duration: number) => {
      this.hitstopTimer = Math.max(this.hitstopTimer, duration);
    },
    onEnemyKilled: (enemy: { id: string }) => {
      this.runStats.enemiesKilled += 1;
      if (this.isOnlineMatch) {
        this.mp.send({ type: 'world:enemy_killed', enemyId: enemy.id });
      }
    },
    onShotFired: () => {
      this.runStats.shotsFired += 1;
    },
    onShotHit: () => {
      this.runStats.shotsHit += 1;
      this.input.vibrate(70, 0.55, 0.45, this.settings.controllerVibration);
    },
    showToast: (title: string, text: string, urgent = false) => {
      this.pushToast(title, text, urgent);
    },
    onLocalAttack: (data: {
      kind: 'melee' | 'projectile';
      weaponId: string | null;
      x: number;
      y: number;
      angle: number;
      pellets: number;
      spread: number;
      speed: number;
      range: number;
      noiseRadius: number;
      label: string;
    }) => {
      if (data.kind === 'projectile') {
        if (data.weaponId === 'shotgun') {
          this.input.vibrate(145, 0.75, 0.95, this.settings.controllerVibration);
        } else if (data.weaponId === 'revolver') {
          this.input.vibrate(105, 0.55, 0.75, this.settings.controllerVibration);
        } else {
          this.input.vibrate(75, 0.45, 0.55, this.settings.controllerVibration);
        }
      } else {
        this.input.vibrate(55, 0.3, 0.25, this.settings.controllerVibration);
      }
      if (this.isOnlineMatch && this.onlinePhase === 'IN_PROGRESS') {
        this.mp.send({ type: 'combat:attack', ...data });
      }
    },
    onWindowBroken: (tx: number, ty: number) => {
      if (this.isOnlineMatch) {
        this.mp.send({ type: 'world:window_broken', tx, ty });
      }
    },
    onPvpHit: (
      target: RemoteSurvivorState,
      rawDamage: number,
      weaponName: string,
      bleedChance: number,
      hitId: string
    ) => {
      if (this.isOnlineMatch && this.onlinePhase === 'IN_PROGRESS') {
        this.mp.send({
          type: 'combat:pvp_hit',
          targetId: target.id,
          rawDamage,
          weaponName,
          bleedChance,
          hitId,
        });
      }
    },
  };

  private emitNoise(
    x: number,
    y: number,
    radius: number,
    intensity: number,
    label: string,
    isMimicLure = false
  ) {
    this.noises.push({
      id: `ns_${Date.now()}_${Math.random()}`,
      x,
      y,
      radius,
      intensity,
      age: 0,
      duration: 0.75,
      label,
      isMimicLure,
    });
  }

  private spawnParticles(
    x: number,
    y: number,
    count: number,
    color: string,
    speed: number,
    life = 0.32
  ) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const spd = (0.3 + Math.random() * 0.7) * speed;
      let reused = false;
      for (const pt of this.particles) {
        if (!pt.active) {
          pt.active = true;
          pt.x = x;
          pt.y = y;
          pt.vx = Math.cos(a) * spd;
          pt.vy = Math.sin(a) * spd;
          pt.size = 2 + Math.random() * 2.5;
          pt.alpha = 1;
          pt.life = life;
          pt.maxLife = life;
          pt.color = color;
          pt.drag = 4.5;
          reused = true;
          break;
        }
      }
      if (!reused && this.particles.length < 320) {
        this.particles.push({
          active: true,
          x,
          y,
          vx: Math.cos(a) * spd,
          vy: Math.sin(a) * spd,
          size: 2 + Math.random() * 2.5,
          alpha: 1,
          life: life,
          maxLife: life,
          color: color,
          drag: 4.5,
        });
      }
    }
  }

  private updateParticlesAndNoises(dt: number) {
    for (const pt of this.particles) {
      if (!pt.active) continue;
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      pt.vx *= Math.exp(-pt.drag * dt);
      pt.vy *= Math.exp(-pt.drag * dt);
      pt.life -= dt;
      if (pt.life <= 0) pt.active = false;
    }

    for (let i = this.noises.length - 1; i >= 0; i--) {
      this.noises[i].age += dt;
      if (this.noises[i].age >= this.noises[i].duration) {
        this.noises.splice(i, 1);
      }
    }

    for (let i = this.world.sporeZones.length - 1; i >= 0; i--) {
      const sz = this.world.sporeZones[i];
      if (!sz.permanent) {
        sz.remainingTime -= dt;
        if (sz.remainingTime <= 0) {
          this.world.sporeZones.splice(i, 1);
        }
      }
    }
  }

  private pushRadio(sender: string, text: string, urgent: boolean) {
    const msg: RadioMessage = {
      id: `rad_${Date.now()}_${Math.random()}`,
      timeFormatted: formatGameClock(this.elapsedSeconds),
      sender,
      text,
      urgent,
    };
    this.radioMessages.unshift(msg);
    if (this.panel !== 'PHONE') {
      this.unreadRadioCount += 1;
    }
    this.sound.playRadioStatic(urgent);
  }

  private pushToast(title: string, text: string, urgent: boolean) {
    this.latestToast = {
      id: `tst_${Date.now()}_${Math.random()}`,
      title,
      text,
      urgent,
    };
    this.toastTimer = urgent ? 8.0 : 4.5;
  }

  private render() {
    const equippedInst =
      this.player.equippedSlot !== null ? this.backpack[this.player.equippedSlot] : null;
    const obj = this.getActiveObjectiveInfo();

    this.renderer.render(this.ctx, {
      world: this.world,
      cam: this.cam,
      player: this.player,
      equippedItemId: equippedInst?.itemId ?? null,
      remoteSurvivors: [...this.remoteSurvivors.values()],
      projectiles: this.projectiles,
      particles: this.particles,
      noises: this.noises,
      flares: this.flares,
      extraction: this.extraction,
      objectiveTarget: {
        x: obj.targetPos.x,
        y: obj.targetPos.y,
        stage: obj.stage,
      },
      elapsedSeconds: this.elapsedSeconds,
      currentHourIndex: this.currentHourIndex,
      powerGridOnline: this.powerGridOnline,
      isHeavyRain: this.isHeavyRain,
      showAcousticRings: this.settings.showAcousticRings,
      isTitleMode: this.screen === 'TITLE',
      isGamepadActive: this.input.isGamepadActive,
      gamepadAimMagnitude: this.input.gamepadAimMagnitude,
      localPlayerColor: this.localPlayerColor,
    });
  }

  public emitSnapshot() {
    const worldPxW = this.world.width * CONFIG.TILE_SIZE;
    const worldPxH = this.world.height * CONFIG.TILE_SIZE;
    const tx = Math.max(
      0,
      Math.min(this.world.width - 1, Math.floor(this.player.x / CONFIG.TILE_SIZE))
    );
    const ty = Math.max(
      0,
      Math.min(this.world.height - 1, Math.floor(this.player.y / CONFIG.TILE_SIZE))
    );
    const dId = this.world.districts[ty * this.world.width + tx] || 'streets';

    const obj = this.getActiveObjectiveInfo();
    const objDx = obj.targetPos.x - this.player.x;
    const objDy = obj.targetPos.y - this.player.y;
    const objAngle = Math.atan2(objDy, objDx);
    const objDistMeters = Math.round(Math.hypot(objDx, objDy) / CONFIG.TILE_SIZE);

    const extDx = this.extraction.heliTarget.x - this.player.x;
    const extDy = this.extraction.heliTarget.y - this.player.y;
    const extAngle = Math.atan2(extDy, extDx);
    const extDistMeters = Math.round(Math.hypot(extDx, extDy) / CONFIG.TILE_SIZE);

    const snap: UISnapshot = {
      screen: this.screen,
      panel: this.panel,
      clockFormatted: formatGameClock(this.elapsedSeconds),
      countdownFormatted: formatCountdown(this.elapsedSeconds),
      currentHourIndex: this.currentHourIndex,
      districtName: DISTRICT_LABELS[dId] || 'Quarantine Zone',
      weatherLabel: this.isHeavyRain ? 'Heavy Downpour' : 'Light Drizzle',
      powerGridOnline: this.powerGridOnline,
      health: Math.ceil(this.player.health),
      maxHealth: this.player.maxHealth,
      hunger: Math.ceil(this.player.hunger),
      stamina: Math.ceil(this.player.stamina),
      contamination: Math.floor(this.player.contamination),
      conditions: { ...this.player.conditions },
      flashlightOn: this.player.flashlightOn,
      flashlightBattery: Math.ceil(this.player.flashlightBattery),
      isCrouching: this.player.isCrouching,
      isSprinting: this.player.isSprinting,
      isReloading: this.player.isReloading,
      reloadProgress: this.player.isReloading
        ? 1 - this.player.reloadTimer / Math.max(0.1, this.player.reloadDuration)
        : 0,
      backpack: this.backpack.map((s) => (s ? { ...s } : null)),
      equippedSlot: this.player.equippedSlot,
      totalWeight: calculateBackpackWeight(this.backpack, this.player.armorEquipped),
      maxWeight: CONFIG.MAX_CARRY_WEIGHT_KG,
      armorEquipped: this.player.armorEquipped,
      activeContainer: this.activeContainer
        ? {
            ...this.activeContainer,
            items: this.activeContainer.items.map((s) => (s ? { ...s } : null)),
          }
        : null,
      interactionPrompt: this.computeInteractionPrompt(),
      radioMessages: [...this.radioMessages],
      unreadRadioCount: this.unreadRadioCount,
      activeRadioBroadcast: this.activeRadioBroadcast
        ? { ...this.activeRadioBroadcast }
        : null,
      airedBroadcastIds: [...this.triggeredBroadcastIds],
      latestToast: this.latestToast ? { ...this.latestToast } : null,
      objective: {
        stage: obj.stage,
        stepNumber: obj.stepNumber,
        totalSteps: 5,
        title: obj.title,
        hint: obj.hint,
        targetLabel: obj.targetLabel,
        directionAngle: objAngle,
        compassCardinal: angleToCardinal(objAngle),
        distanceMeters: objDistMeters,
        targetNormPos: {
          x: obj.targetPos.x / worldPxW,
          y: obj.targetPos.y / worldPxH,
        },
        injectionTaken: this.injectionTaken,
        radioDiscovered: this.radioDiscovered,
      },
      extraction: {
        siteId: this.extraction.site.id,
        siteName: this.extraction.site.name,
        shortName: this.extraction.site.shortName,
        sectorLabel: this.extraction.site.sectorLabel,
        routeHint: this.extraction.site.routeHint,
        coordinatesKnown: this.extraction.coordinatesKnown,
        zoneActive: this.extraction.zoneActive,
        playerInZone: this.extraction.playerInZone,
        directionAngle: extAngle,
        compassCardinal: angleToCardinal(extAngle),
        distanceMeters: extDistMeters,
        generatorPowered: this.extraction.generatorPowered,
        playerNormPos: {
          x: this.player.x / worldPxW,
          y: this.player.y / worldPxH,
        },
        lzNormPos: {
          x: this.extraction.heliTarget.x / worldPxW,
          y: this.extraction.heliTarget.y / worldPxH,
        },
        mapMarkers: this.world.mapMarkers,
        survivorsInLZ: this.survivorsInLZ,
        contested: this.extractionContested,
      },
      online: {
        isOnlineMode: this.isOnlineMatch,
        wsConnected: this.wsConnected,
        selfId: this.selfId,
        callsign: this.callsign,
        roomId: this.roomId,
        roomCode: this.roomCode,
        phase: this.onlinePhase,
        countdownSeconds: this.lobbyCountdownSeconds,
        playerCount: this.lobbyPlayerCount,
        maxPlayers: this.lobbyMaxPlayers,
        minAutoStartPlayers: this.lobbyMinAutoStart,
        aliveCount: this.onlineAliveCount,
        totalParticipants: this.onlineTotalParticipants,
        selfReady: this.selfReady,
        errorMessage: this.onlineErrorMessage,
        roster: [...this.lobbyRoster],
        publicLobbies: [...this.publicLobbies],
        killFeed: [...this.killFeed],
        chatMessages: [...this.chatMessages],
        unreadChatCount: this.unreadChatCount,
      },
      runStats: { ...this.runStats },
      records: { ...this.records },
      settings: { ...this.settings },
      isTouchDevice: this.input.isTouchDetected,
      isGamepadConnected: this.input.isGamepadConnected,
      isGamepadActive: this.input.isGamepadActive,
      gamepadName: this.input.gamepadName,
      gamepadBrand: this.input.gamepadBrand,
    };

    this.onUISnapshot(snap);
  }
}
