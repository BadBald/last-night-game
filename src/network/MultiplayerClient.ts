import {
  ExtractionSiteId,
  GroundItem,
  InventoryItemInstance,
  LobbyPlayerSummary,
  PlayerActionAnim,
  PublicRoomSummary,
  ChatMessage,
} from '../types';

export interface NetPlayerPayload {
  id: string;
  callsign: string;
  color: string;
  spawnIndex: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  health: number;
  maxHealth: number;
  armorEquipped: boolean;
  equippedItemId: string | null;
  flashlightOn: boolean;
  isCrouching: boolean;
  isSprinting: boolean;
  animState: PlayerActionAnim;
  meleeSwingTimer: number;
  alive: boolean;
  extracted: boolean;
  pvpKills: number;
  inExtractionZone: boolean;
}

export interface RoomLobbyPayload {
  roomId: string;
  code: string;
  isPublic: boolean;
  phase: 'LOBBY' | 'COUNTDOWN' | 'IN_PROGRESS' | 'ENDED';
  countdownSeconds: number;
  playerCount: number;
  maxPlayers: number;
  minAutoStartPlayers: number;
  aliveCount: number;
  totalParticipants: number;
  matchSeed: number;
  extractionSiteId: ExtractionSiteId;
  elapsedSeconds: number;
  winnerId: string | null;
  winnerCallsign: string | null;
  roster: LobbyPlayerSummary[];
}

export interface InitialWorldSyncPayload {
  openedDoors: string[];
  brokenWindows: string[];
  deadEnemyIds: string[];
  updatedContainers: {
    containerId: string;
    searched: boolean;
    items: (InventoryItemInstance | null)[];
  }[];
  spawnedGroundItems: GroundItem[];
  takenGroundItemIds: string[];
  generatorPowered: boolean;
}

export interface MultiplayerClientHandlers {
  onConnectionChange: (connected: boolean, selfId: string | null) => void;
  onLobbiesList: (lobbies: PublicRoomSummary[]) => void;
  onRoomJoined: (
    selfId: string,
    spawnPos: { x: number; y: number },
    lobby: RoomLobbyPayload
  ) => void;
  onRoomUpdated: (lobby: RoomLobbyPayload) => void;
  onRoomLeft: (lobbies: PublicRoomSummary[]) => void;
  onMatchmakingError: (message: string) => void;
  onMatchStarted: (
    lobby: RoomLobbyPayload,
    worldSync: InitialWorldSyncPayload,
    players: NetPlayerPayload[]
  ) => void;
  onPlayerJoinedMidMatch: (player: NetPlayerPayload, lobby: RoomLobbyPayload) => void;
  onPlayerLeftMidMatch: (
    playerId: string,
    callsign: string,
    aliveRemaining: number
  ) => void;
  onWorldTick: (data: {
    elapsedSeconds: number;
    aliveCount: number;
    totalParticipants: number;
    survivorsInLZ: number;
    extractionContested: boolean;
    players: NetPlayerPayload[];
  }) => void;
  onRemoteAttack: (data: {
    attackerId: string;
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
  }) => void;
  onLocalPlayerDamaged: (data: {
    attackerId: string;
    attackerCallsign: string;
    damage: number;
    newHealth: number;
    bleedChance: number;
    weaponName: string;
  }) => void;
  onCombatHitFx: (data: { targetId: string; x: number; y: number }) => void;
  onPlayerEliminated: (data: {
    victimId: string;
    victimCallsign: string;
    killerId: string | null;
    killerCallsign: string;
    weaponName: string;
    cause: string;
    x: number;
    y: number;
    aliveRemaining: number;
    placement: number;
  }) => void;
  onMatchEnded: (data: {
    winnerId: string | null;
    winnerCallsign: string | null;
    siteName: string;
    reasonForOthers: string;
    totalParticipants: number;
    placements: {
      id: string;
      callsign: string;
      placement: number;
      pvpKills: number;
      extracted: boolean;
    }[];
  }) => void;
  onWorldDoorToggled: (tx: number, ty: number, open: boolean) => void;
  onWorldWindowBroken: (tx: number, ty: number) => void;
  onWorldEnemyKilled: (enemyId: string) => void;
  onWorldContainerUpdated: (
    containerId: string,
    searched: boolean,
    items: (InventoryItemInstance | null)[]
  ) => void;
  onWorldGroundItemsDropped: (items: GroundItem[]) => void;
  onWorldGroundItemTaken: (groundItemId: string) => void;
  onWorldGeneratorPowered: () => void;
  onChatMessage: (msg: ChatMessage) => void;
  onVoiceSignal: (data: {
    fromId: string;
    targetId: string;
    kind: 'offer' | 'answer' | 'ice';
    payload: unknown;
  }) => void;
  onVoiceState: (data: { playerId: string; callsign: string; talking: boolean }) => void;
  onVoiceAudio: (fromId: string, pcm: Int16Array) => void;
}

export class MultiplayerClient {
  private ws: WebSocket | null = null;
  private handlers: MultiplayerClientHandlers;
  private reconnectTimer: number | null = null;
  private destroyed = false;
  public selfId: string | null = null;
  public isConnected = false;
  private pendingMessages: string[] = [];

  constructor(handlers: MultiplayerClientHandlers) {
    this.handlers = handlers;
  }

  public ensureConnected() {
    if (this.destroyed) return;
    if (
      this.ws &&
      (this.ws.readyState === WebSocket.OPEN ||
        this.ws.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    if (typeof window === 'undefined') return;
    // In production the static client may be hosted separately from the
    // authoritative WebSocket game server. Point VITE_WS_URL at that server
    // (for example wss://last-night-server.onrender.com/ws). When unset, the
    // client connects to the same origin, which is correct for local dev and
    // for any host that serves both the client and the WebSocket server.
    // A temporary tunnel (or a moved server) can be pointed at without a
    // rebuild: open the game with ?ws=wss://host/ws once and it is remembered.
    // Use ?ws=reset to fall back to the build-time VITE_WS_URL.
    let runtimeUrl: string | null = null;
    try {
      const param = new URLSearchParams(window.location.search).get('ws');
      if (param === 'reset') {
        window.localStorage.removeItem('ln_ws_url');
      } else if (param) {
        window.localStorage.setItem('ln_ws_url', param);
      }
      runtimeUrl = window.localStorage.getItem('ln_ws_url');
    } catch {
      // localStorage can be unavailable in private/embedded contexts.
    }
    const configuredUrl = (runtimeUrl || import.meta.env.VITE_WS_URL)?.trim();
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    let wsUrl = configuredUrl || `${protocol}//${window.location.host}/ws`;
    if (configuredUrl) {
      if (wsUrl.startsWith('https://')) wsUrl = `wss://${wsUrl.slice(8)}`;
      else if (wsUrl.startsWith('http://')) wsUrl = `ws://${wsUrl.slice(7)}`;
      if (!/\/ws\/?$/.test(wsUrl)) wsUrl = `${wsUrl.replace(/\/$/, '')}/ws`;
    }

    try {
      const socket = new WebSocket(wsUrl);
      socket.binaryType = 'arraybuffer';
      this.ws = socket;

      socket.onopen = () => {
        if (this.destroyed) {
          socket.close();
          return;
        }
        this.isConnected = true;
        while (this.pendingMessages.length > 0) {
          const msg = this.pendingMessages.shift();
          if (msg && socket.readyState === WebSocket.OPEN) {
            socket.send(msg);
          }
        }
        this.handlers.onConnectionChange(true, this.selfId);
      };

      socket.onmessage = (ev) => {
        if (this.destroyed) return;
        if (ev.data instanceof ArrayBuffer) {
          this.handleBinaryMessage(ev.data);
          return;
        }
        let data: Record<string, unknown>;
        try {
          data = JSON.parse(String(ev.data)) as Record<string, unknown>;
        } catch {
          return;
        }
        this.handleServerMessage(data);
      };

      socket.onclose = () => {
        this.isConnected = false;
        this.handlers.onConnectionChange(false, this.selfId);
        if (!this.destroyed && this.reconnectTimer === null) {
          this.reconnectTimer = window.setTimeout(() => {
            this.reconnectTimer = null;
            this.ensureConnected();
          }, 1800);
        }
      };

      socket.onerror = () => {
        // Handled cleanly in onclose reconnect
      };
    } catch {
      this.isConnected = false;
    }
  }

  public destroy() {
    this.destroyed = true;
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /** Send a raw binary frame (used for relayed microphone audio). */
  public sendBinary(data: ArrayBuffer) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(data);
    }
  }

  public send(payload: Record<string, unknown>, bufferIfConnecting = false) {
    const encoded = JSON.stringify(payload);
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(encoded);
    } else if (bufferIfConnecting) {
      this.ensureConnected();
      if (this.pendingMessages.length < 24) {
        this.pendingMessages.push(encoded);
      }
    }
  }

  private handleBinaryMessage(buffer: ArrayBuffer) {
    const bytes = new Uint8Array(buffer);
    // Relay frame: [version:1][idLength:1][senderId: idLength][PCM16 LE ...]
    if (bytes.length < 3 || bytes[0] !== 1) return;
    const idLength = bytes[1];
    const pcmOffset = 2 + idLength;
    if (idLength === 0 || bytes.length <= pcmOffset) return;
    let fromId = '';
    for (let i = 0; i < idLength; i++) {
      fromId += String.fromCharCode(bytes[2 + i]);
    }
    const pcmBytes = bytes.length - pcmOffset;
    const sampleCount = Math.floor(pcmBytes / 2);
    if (sampleCount === 0) return;
    const pcm = new Int16Array(sampleCount);
    for (let i = 0; i < sampleCount; i++) {
      const lo = bytes[pcmOffset + i * 2];
      const hi = bytes[pcmOffset + i * 2 + 1];
      pcm[i] = (hi << 8) | lo;
    }
    this.handlers.onVoiceAudio(fromId, pcm);
  }

  private handleServerMessage(msg: Record<string, unknown>) {
    const type = msg.type;
    if (typeof type !== 'string') return;

    switch (type) {
      case 'welcome': {
        this.selfId = typeof msg.clientId === 'string' ? msg.clientId : null;
        this.handlers.onConnectionChange(true, this.selfId);
        if (Array.isArray(msg.lobbies)) {
          this.handlers.onLobbiesList(msg.lobbies as PublicRoomSummary[]);
        }
        break;
      }
      case 'lobbies:list': {
        if (Array.isArray(msg.lobbies)) {
          this.handlers.onLobbiesList(msg.lobbies as PublicRoomSummary[]);
        }
        break;
      }
      case 'room:joined': {
        const sid = typeof msg.selfId === 'string' ? msg.selfId : this.selfId || '';
        this.selfId = sid;
        this.handlers.onRoomJoined(
          sid,
          msg.spawnPos as { x: number; y: number },
          msg.lobby as RoomLobbyPayload
        );
        break;
      }
      case 'room:updated': {
        this.handlers.onRoomUpdated(msg.lobby as RoomLobbyPayload);
        break;
      }
      case 'room:left': {
        this.handlers.onRoomLeft((msg.lobbies as PublicRoomSummary[]) || []);
        break;
      }
      case 'matchmaking:error': {
        this.handlers.onMatchmakingError(
          typeof msg.message === 'string' ? msg.message : 'Matchmaking error.'
        );
        break;
      }
      case 'match:started': {
        this.handlers.onMatchStarted(
          msg.lobby as RoomLobbyPayload,
          msg.worldSync as InitialWorldSyncPayload,
          (msg.players as NetPlayerPayload[]) || []
        );
        break;
      }
      case 'player:joined': {
        this.handlers.onPlayerJoinedMidMatch(
          msg.player as NetPlayerPayload,
          msg.lobby as RoomLobbyPayload
        );
        break;
      }
      case 'player:left': {
        this.handlers.onPlayerLeftMidMatch(
          String(msg.playerId || ''),
          String(msg.callsign || 'Survivor'),
          Number(msg.aliveRemaining || 0)
        );
        break;
      }
      case 'world:tick': {
        this.handlers.onWorldTick(
          msg as unknown as Parameters<MultiplayerClientHandlers['onWorldTick']>[0]
        );
        break;
      }
      case 'combat:remote_attack': {
        this.handlers.onRemoteAttack(
          msg as unknown as Parameters<MultiplayerClientHandlers['onRemoteAttack']>[0]
        );
        break;
      }
      case 'player:damaged': {
        this.handlers.onLocalPlayerDamaged(
          msg as unknown as Parameters<
            MultiplayerClientHandlers['onLocalPlayerDamaged']
          >[0]
        );
        break;
      }
      case 'combat:hit_fx': {
        this.handlers.onCombatHitFx(
          msg as unknown as Parameters<MultiplayerClientHandlers['onCombatHitFx']>[0]
        );
        break;
      }
      case 'player:eliminated': {
        this.handlers.onPlayerEliminated(
          msg as unknown as Parameters<
            MultiplayerClientHandlers['onPlayerEliminated']
          >[0]
        );
        break;
      }
      case 'match:ended': {
        this.handlers.onMatchEnded(
          msg as unknown as Parameters<MultiplayerClientHandlers['onMatchEnded']>[0]
        );
        break;
      }
      case 'world:door_toggled': {
        this.handlers.onWorldDoorToggled(
          Number(msg.tx),
          Number(msg.ty),
          Boolean(msg.open)
        );
        break;
      }
      case 'world:window_broken': {
        this.handlers.onWorldWindowBroken(Number(msg.tx), Number(msg.ty));
        break;
      }
      case 'world:enemy_killed': {
        this.handlers.onWorldEnemyKilled(String(msg.enemyId || ''));
        break;
      }
      case 'world:container_updated': {
        this.handlers.onWorldContainerUpdated(
          String(msg.containerId || ''),
          Boolean(msg.searched),
          (msg.items as (InventoryItemInstance | null)[]) || []
        );
        break;
      }
      case 'world:ground_items_dropped': {
        this.handlers.onWorldGroundItemsDropped((msg.items as GroundItem[]) || []);
        break;
      }
      case 'world:ground_item_taken': {
        this.handlers.onWorldGroundItemTaken(String(msg.groundItemId || ''));
        break;
      }
      case 'world:generator_powered': {
        this.handlers.onWorldGeneratorPowered();
        break;
      }
      case 'chat:message': {
        this.handlers.onChatMessage(msg as unknown as ChatMessage);
        break;
      }
      case 'voice:signal': {
        this.handlers.onVoiceSignal(
          msg as unknown as Parameters<MultiplayerClientHandlers['onVoiceSignal']>[0]
        );
        break;
      }
      case 'voice:state': {
        this.handlers.onVoiceState(
          msg as unknown as Parameters<MultiplayerClientHandlers['onVoiceState']>[0]
        );
        break;
      }
      default:
        break;
    }
  }
}
