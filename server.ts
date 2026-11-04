import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import { createServer } from 'http';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocket, WebSocketServer } from 'ws';
import { ALL_SPEECH_SEGMENTS, RadioSpeechSegmentDef } from './src/data/radioBroadcasts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const MIN_AUTO_START_PLAYERS = 2;
const DEFAULT_MAX_PLAYERS = 20;
const MIN_ALLOWED_MAX_PLAYERS = 2;
const MAX_ALLOWED_MAX_PLAYERS = 20;
const MAX_QUEUE_WAIT_SECONDS = 50; // Maximum matchmaking wait time is 50 seconds
const RUN_DURATION_SECONDS = 1800; // 11:00 PM -> 6:00 AM (7 game hours)
const ONLINE_CLOCK_SPEED_MULT = 1.6; // ~18.75 real-time minutes for full 7-hour PvPvE night
const HOT_JOIN_WINDOW_SECONDS = 0; // Matches lock roster once launched

type ExtractionSiteId = 'military_base' | 'stadium' | 'parking' | 'rooftop';
type RoomPhase = 'LOBBY' | 'COUNTDOWN' | 'IN_PROGRESS' | 'ENDED';

const EXTRACTION_SITES: {
  id: ExtractionSiteId;
  name: string;
  center: { x: number; y: number };
  bounds: { x: number; y: number; w: number; h: number };
}[] = [
  {
    id: 'military_base',
    name: 'Fort Vanguard Military Base',
    bounds: { x: 200 * 40 - 140, y: 74 * 40 - 140, w: 280, h: 280 },
    center: { x: 200 * 40, y: 74 * 40 },
  },
  {
    id: 'stadium',
    name: 'Civic Memorial Stadium',
    bounds: { x: 170 * 40 - 140, y: 13 * 40 - 140, w: 280, h: 280 },
    center: { x: 170 * 40, y: 13 * 40 },
  },
  {
    id: 'parking',
    name: 'Civic Parking Lot',
    bounds: { x: 142 * 40 - 140, y: 13 * 40 - 140, w: 280, h: 280 },
    center: { x: 142 * 40, y: 13 * 40 },
  },
  {
    id: 'rooftop',
    name: 'Meridian Tower Helipad (Rooftop Sector C)',
    bounds: { x: 207 * 40 - 140, y: 12 * 40 - 140, w: 280, h: 280 },
    center: { x: 207 * 40, y: 12 * 40 },
  },
];

// ============================================================================
// Bundled (file-based) Breaking News Radio — no Gemini/TTS required
// ============================================================================
const TTS_CACHE_DIR = path.join(os.tmpdir(), 'last_night_radio_tts_v2');
const BUNDLED_PUBLIC_RADIO_DIR = path.join(__dirname, 'public', 'assets', 'radio');
const BUNDLED_DIST_RADIO_DIR = path.join(__dirname, 'dist', 'assets', 'radio');
const ttsMemoryCache = new Map<string, Buffer>();
const ttsInFlight = new Map<string, Promise<Buffer>>();
let prewarmStarted = false;

function ensureWavBuffer(raw: Buffer, sampleRate = 24000): Buffer {
  if (
    raw.length >= 12 &&
    raw.subarray(0, 4).toString('ascii') === 'RIFF' &&
    raw.subarray(8, 12).toString('ascii') === 'WAVE'
  ) {
    return raw;
  }
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + raw.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(raw.length, 40);
  return Buffer.concat([header, raw]);
}

async function getOrSynthesizeRadioSegment(
  seg: RadioSpeechSegmentDef
): Promise<Buffer> {
  const cached = ttsMemoryCache.get(seg.segmentId);
  if (cached) return cached;

  const candidatePaths = [
    path.join(BUNDLED_PUBLIC_RADIO_DIR, `${seg.segmentId}.wav`),
    path.join(BUNDLED_DIST_RADIO_DIR, `${seg.segmentId}.wav`),
    path.join(TTS_CACHE_DIR, `${seg.segmentId}.wav`),
  ];
  for (const candidate of candidatePaths) {
    try {
      if (fs.existsSync(candidate)) {
        const buf = fs.readFileSync(candidate);
        if (buf.length > 100) {
          ttsMemoryCache.set(seg.segmentId, buf);
          return buf;
        }
      }
    } catch {
      // Ignore read issues and try next path
    }
  }

  const existingPromise = ttsInFlight.get(seg.segmentId);
  if (existingPromise) return existingPromise;

  // No bundled file and no synthesis backend: fail fast so the client
  // falls back to its local speech synthesis.
  const synthPromise = Promise.reject(
    new Error(`Radio segment audio not found: ${seg.segmentId}`)
  );
  ttsInFlight.set(seg.segmentId, synthPromise);
  try {
    return await synthPromise;
  } finally {
    ttsInFlight.delete(seg.segmentId);
  }
}

function triggerBackgroundRadioPrewarm() {
  if (prewarmStarted) return;
  prewarmStarted = true;
  (async () => {
    for (const seg of ALL_SPEECH_SEGMENTS.values()) {
      try {
        await getOrSynthesizeRadioSegment(seg);
        await new Promise((r) => setTimeout(r, 250));
      } catch {
        // Individual failures are retried on demand
      }
    }
  })();
}

// 20 distinct, verified-clear Oakhaven Countryside Village spawn coordinates (in tiles -> world px)
const VILLAGE_SPAWN_TILES: [number, number][] = [
  [9, 46],
  [14, 46],
  [10, 53],
  [18, 47],
  [13, 30],
  [20, 30],
  [21, 25],
  [29, 31],
  [22, 46],
  [29, 39],
  [12, 66],
  [12, 60],
  [20, 67],
  [29, 67],
  [29, 60],
  [21, 73],
  [8, 56],
  [16, 56],
  [25, 56],
  [6, 38],
];

const SURVIVOR_JACKET_COLORS = [
  '#ea6e24',
  '#38bdf8',
  '#a3e635',
  '#f43f5e',
  '#c084fc',
  '#fbbf24',
  '#2dd4bf',
  '#fb7185',
  '#60a5fa',
  '#4ade80',
  '#f97316',
  '#22d3ee',
  '#e879f9',
  '#facc15',
  '#34d399',
  '#f87171',
  '#818cf8',
  '#a8a29e',
  '#fdba74',
  '#67e8f9',
];

interface InventoryItemNet {
  uid: string;
  itemId: string;
  quantity: number;
  durability?: number;
  loadedAmmo?: number;
}

interface GroundItemNet {
  id: string;
  x: number;
  y: number;
  item: InventoryItemNet;
}

interface ServerPlayer {
  id: string;
  ws: WebSocket;
  callsign: string;
  color: string;
  ready: boolean;
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
  animState: string;
  meleeSwingTimer: number;
  alive: boolean;
  extracted: boolean;
  pvpKills: number;
  inExtractionZone: boolean;
  lzHoldSeconds: number;
  placement: number | null;
  lastUpdateAt: number;
}

interface MatchRoom {
  id: string;
  code: string;
  isPublic: boolean;
  maxPlayers: number;
  phase: RoomPhase;
  countdownSeconds: number;
  matchSeed: number;
  extractionSiteId: ExtractionSiteId;
  elapsedSeconds: number;
  totalParticipants: number;
  winnerId: string | null;
  winnerCallsign: string | null;
  players: Map<string, ServerPlayer>;
  usedSpawnIndices: Set<number>;
  processedHitIds: Set<string>;
  // Shared world deltas for late-join / reconnect idempotency
  openedDoors: Set<string>;
  brokenWindows: Set<string>;
  deadEnemyIds: Set<string>;
  updatedContainers: Map<string, { searched: boolean; items: (InventoryItemNet | null)[] }>;
  spawnedGroundItems: Map<string, GroundItemNet>;
  takenGroundItemIds: Set<string>;
  generatorPowered: boolean;
  createdAt: number;
}

const rooms = new Map<string, MatchRoom>();
const clientToRoom = new Map<string, string>();
const socketsById = new Map<string, WebSocket>();

function randomRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 5; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function sanitizeCallsign(raw: unknown, fallbackNum: number): string {
  if (typeof raw !== 'string') return `SURVIVOR-${fallbackNum}`;
  const cleaned = raw.trim().replace(/[^\w\-\s]/g, '').slice(0, 16);
  return cleaned.length >= 2 ? cleaned : `SURVIVOR-${fallbackNum}`;
}

function sendJson(ws: WebSocket, payload: unknown) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function broadcastRoom(room: MatchRoom, payload: unknown, excludeId?: string) {
  const encoded = JSON.stringify(payload);
  for (const [pid, p] of room.players.entries()) {
    if (excludeId && pid === excludeId) continue;
    if (p.ws.readyState === WebSocket.OPEN) {
      p.ws.send(encoded);
    }
  }
}

function createRoom(isPublic = true, requestedMax = DEFAULT_MAX_PLAYERS): MatchRoom {
  const clampedMax = Math.max(
    MIN_ALLOWED_MAX_PLAYERS,
    Math.min(MAX_ALLOWED_MAX_PLAYERS, Math.round(requestedMax || DEFAULT_MAX_PLAYERS))
  );
  let code = randomRoomCode();
  while ([...rooms.values()].some((r) => r.code === code)) {
    code = randomRoomCode();
  }
  const site =
    EXTRACTION_SITES.find((s) => s.id === 'rooftop') || EXTRACTION_SITES[0];
  const room: MatchRoom = {
    id: `rm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    code,
    isPublic,
    maxPlayers: clampedMax,
    phase: 'LOBBY',
    countdownSeconds: MAX_QUEUE_WAIT_SECONDS,
    matchSeed: Math.floor(Math.random() * 0x7fffffff),
    extractionSiteId: site.id,
    elapsedSeconds: 0,
    totalParticipants: 0,
    winnerId: null,
    winnerCallsign: null,
    players: new Map(),
    usedSpawnIndices: new Set(),
    processedHitIds: new Set(),
    openedDoors: new Set(),
    brokenWindows: new Set(),
    deadEnemyIds: new Set(),
    updatedContainers: new Map(),
    spawnedGroundItems: new Map(),
    takenGroundItemIds: new Set(),
    generatorPowered: false,
    createdAt: Date.now(),
  };
  rooms.set(room.id, room);
  return room;
}

function allocateSpawnIndex(room: MatchRoom): number {
  for (let i = 0; i < VILLAGE_SPAWN_TILES.length; i++) {
    if (!room.usedSpawnIndices.has(i)) {
      room.usedSpawnIndices.add(i);
      return i;
    }
  }
  return room.players.size % VILLAGE_SPAWN_TILES.length;
}

function serializeRoomLobby(room: MatchRoom) {
  const roster = [...room.players.values()].map((p) => ({
    id: p.id,
    callsign: p.callsign,
    color: p.color,
    ready: p.ready,
    alive: p.alive,
    pvpKills: p.pvpKills,
  }));
  const aliveCount = [...room.players.values()].filter((p) => p.alive).length;
  return {
    roomId: room.id,
    code: room.code,
    isPublic: room.isPublic,
    phase: room.phase,
    countdownSeconds: Math.ceil(room.countdownSeconds),
    playerCount: room.players.size,
    maxPlayers: room.maxPlayers,
    minAutoStartPlayers: MIN_AUTO_START_PLAYERS,
    aliveCount,
    totalParticipants: Math.max(room.totalParticipants, room.players.size),
    matchSeed: room.matchSeed,
    extractionSiteId: room.extractionSiteId,
    elapsedSeconds: room.elapsedSeconds,
    winnerId: room.winnerId,
    winnerCallsign: room.winnerCallsign,
    roster,
  };
}

function getPublicRoomSummaries() {
  const list = [];
  for (const r of rooms.values()) {
    if (!r.isPublic) continue;
    if (r.phase === 'ENDED') continue;
    if (r.phase === 'IN_PROGRESS' && r.elapsedSeconds > HOT_JOIN_WINDOW_SECONDS) continue;
    if (r.players.size >= r.maxPlayers) continue;
    list.push({
      roomId: r.id,
      code: r.code,
      phase: r.phase,
      playerCount: r.players.size,
      maxPlayers: r.maxPlayers,
      elapsedSeconds: Math.floor(r.elapsedSeconds),
    });
  }
  return list;
}

function buildInitialWorldSync(room: MatchRoom) {
  return {
    openedDoors: [...room.openedDoors],
    brokenWindows: [...room.brokenWindows],
    deadEnemyIds: [...room.deadEnemyIds],
    updatedContainers: [...room.updatedContainers.entries()].map(([id, data]) => ({
      containerId: id,
      searched: data.searched,
      items: data.items,
    })),
    spawnedGroundItems: [...room.spawnedGroundItems.values()],
    takenGroundItemIds: [...room.takenGroundItemIds],
    generatorPowered: room.generatorPowered,
  };
}

function evaluateLobbyCountdown(room: MatchRoom) {
  if (room.phase !== 'LOBBY' && room.phase !== 'COUNTDOWN') return;
  const count = room.players.size;
  if (count === 0) {
    room.phase = 'LOBBY';
    room.countdownSeconds = MAX_QUEUE_WAIT_SECONDS;
    return;
  }

  if (count >= room.maxPlayers) {
    room.phase = 'COUNTDOWN';
    if (room.countdownSeconds > 3) {
      room.countdownSeconds = 3;
    }
  } else if (count >= MIN_AUTO_START_PLAYERS) {
    room.phase = 'COUNTDOWN';
  } else {
    // A lone survivor never starts a match. Hold the full 50s countdown until
    // a second survivor joins, then begin the visible countdown from 50s.
    room.phase = 'LOBBY';
    room.countdownSeconds = MAX_QUEUE_WAIT_SECONDS;
  }
}

function launchMatchRoom(room: MatchRoom) {
  if (room.phase === 'IN_PROGRESS' || room.phase === 'ENDED') return;
  room.phase = 'IN_PROGRESS';
  room.elapsedSeconds = 0;
  room.totalParticipants = room.players.size;

  for (const p of room.players.values()) {
    const [tx, ty] = VILLAGE_SPAWN_TILES[p.spawnIndex % VILLAGE_SPAWN_TILES.length];
    p.x = tx * 40 + 20;
    p.y = ty * 40 + 20;
    p.vx = 0;
    p.vy = 0;
    p.health = 100;
    p.maxHealth = 100;
    p.alive = true;
    p.extracted = false;
    p.pvpKills = 0;
    p.inExtractionZone = false;
    p.lzHoldSeconds = 0;
    p.placement = null;
  }

  broadcastRoom(room, {
    type: 'match:started',
    lobby: serializeRoomLobby(room),
    worldSync: buildInitialWorldSync(room),
    players: [...room.players.values()].map(serializePlayerNet),
  });
}

function serializePlayerNet(p: ServerPlayer) {
  return {
    id: p.id,
    callsign: p.callsign,
    color: p.color,
    spawnIndex: p.spawnIndex,
    x: p.x,
    y: p.y,
    vx: p.vx,
    vy: p.vy,
    angle: p.angle,
    health: p.health,
    maxHealth: p.maxHealth,
    armorEquipped: p.armorEquipped,
    equippedItemId: p.equippedItemId,
    flashlightOn: p.flashlightOn,
    isCrouching: p.isCrouching,
    isSprinting: p.isSprinting,
    animState: p.animState,
    meleeSwingTimer: p.meleeSwingTimer,
    alive: p.alive,
    extracted: p.extracted,
    pvpKills: p.pvpKills,
    inExtractionZone: p.inExtractionZone,
  };
}

function removeClientFromCurrentRoom(clientId: string) {
  const roomId = clientToRoom.get(clientId);
  if (!roomId) return;
  clientToRoom.delete(clientId);

  const room = rooms.get(roomId);
  if (!room) return;
  const player = room.players.get(clientId);
  if (!player) return;

  room.players.delete(clientId);

  if (room.players.size === 0) {
    rooms.delete(room.id);
    return;
  }

  if (room.phase === 'LOBBY' || room.phase === 'COUNTDOWN') {
    room.usedSpawnIndices.delete(player.spawnIndex);
    evaluateLobbyCountdown(room);
    broadcastRoom(room, {
      type: 'room:updated',
      lobby: serializeRoomLobby(room),
    });
  } else if (room.phase === 'IN_PROGRESS') {
    const aliveRemaining = [...room.players.values()].filter((p) => p.alive).length;
    broadcastRoom(room, {
      type: 'player:left',
      playerId: clientId,
      callsign: player.callsign,
      aliveRemaining,
    });
  }
}

function joinClientToRoom(
  clientId: string,
  ws: WebSocket,
  room: MatchRoom,
  callsignRaw: unknown
) {
  removeClientFromCurrentRoom(clientId);

  const spawnIndex = allocateSpawnIndex(room);
  const [tx, ty] = VILLAGE_SPAWN_TILES[spawnIndex % VILLAGE_SPAWN_TILES.length];
  const color = SURVIVOR_JACKET_COLORS[spawnIndex % SURVIVOR_JACKET_COLORS.length];
  const callsign = sanitizeCallsign(callsignRaw, spawnIndex + 1);

  const player: ServerPlayer = {
    id: clientId,
    ws,
    callsign,
    color,
    ready: false,
    spawnIndex,
    x: tx * 40 + 20,
    y: ty * 40 + 20,
    vx: 0,
    vy: 0,
    angle: Math.PI / 2,
    health: 100,
    maxHealth: 100,
    armorEquipped: false,
    equippedItemId: 'knife',
    flashlightOn: true,
    isCrouching: false,
    isSprinting: false,
    animState: 'idle',
    meleeSwingTimer: 0,
    alive: true,
    extracted: false,
    pvpKills: 0,
    inExtractionZone: false,
    lzHoldSeconds: 0,
    placement: null,
    lastUpdateAt: Date.now(),
  };

  room.players.set(clientId, player);
  clientToRoom.set(clientId, room.id);

  if (room.phase === 'IN_PROGRESS') {
    room.totalParticipants = Math.max(room.totalParticipants + 1, room.players.size);
    // Hot-drop immediately into the live Oakhaven Countryside match!
    sendJson(ws, {
      type: 'room:joined',
      selfId: clientId,
      spawnPos: { x: player.x, y: player.y },
      lobby: serializeRoomLobby(room),
    });
    sendJson(ws, {
      type: 'match:started',
      lobby: serializeRoomLobby(room),
      worldSync: buildInitialWorldSync(room),
      players: [...room.players.values()].map(serializePlayerNet),
    });
    broadcastRoom(
      room,
      {
        type: 'player:joined',
        player: serializePlayerNet(player),
        lobby: serializeRoomLobby(room),
      },
      clientId
    );
  } else {
    evaluateLobbyCountdown(room);
    sendJson(ws, {
      type: 'room:joined',
      selfId: clientId,
      spawnPos: { x: player.x, y: player.y },
      lobby: serializeRoomLobby(room),
    });
    broadcastRoom(
      room,
      {
        type: 'room:updated',
        lobby: serializeRoomLobby(room),
      },
      clientId
    );
  }
}

function concludeMatchWithExtraction(
  room: MatchRoom,
  winner: ServerPlayer | null,
  reasonForOthers: string
) {
  if (room.phase === 'ENDED') return;
  room.phase = 'ENDED';
  room.winnerId = winner ? winner.id : null;
  room.winnerCallsign = winner ? winner.callsign : null;

  if (winner) {
    winner.extracted = true;
    winner.placement = 1;
  }

  let nextRank = winner ? 2 : 1;
  for (const p of room.players.values()) {
    if (winner && p.id === winner.id) continue;
    if (p.alive && p.placement === null) {
      p.placement = nextRank++;
    }
  }

  const siteInfo =
    EXTRACTION_SITES.find((s) => s.id === room.extractionSiteId) || EXTRACTION_SITES[0];

  broadcastRoom(room, {
    type: 'match:ended',
    winnerId: room.winnerId,
    winnerCallsign: room.winnerCallsign,
    siteName: siteInfo.name,
    reasonForOthers,
    totalParticipants: Math.max(room.totalParticipants, room.players.size),
    placements: [...room.players.values()].map((p) => ({
      id: p.id,
      callsign: p.callsign,
      placement: p.placement ?? room.totalParticipants,
      pvpKills: p.pvpKills,
      extracted: p.extracted,
    })),
  });
}

async function startServer() {
  const app = express();
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', activeRooms: rooms.size });
  });

  app.get('/api/lobbies', (_req, res) => {
    res.json({ lobbies: getPublicRoomSummaries() });
  });

  app.post('/api/radio/prewarm', (_req, res) => {
    triggerBackgroundRadioPrewarm();
    res.json({ status: 'warming' });
  });

  app.get('/api/radio/segment/:segmentId', async (req, res) => {
    const seg = ALL_SPEECH_SEGMENTS.get(req.params.segmentId);
    if (!seg) {
      res.status(404).json({ error: `Unknown radio segment: ${req.params.segmentId}` });
      return;
    }
    try {
      const wavBuf = await getOrSynthesizeRadioSegment(seg);
      res.setHeader('Content-Type', 'audio/wav');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.send(wavBuf);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Radio TTS synthesis failed.';
      const status =
        message.includes('429') || message.includes('RESOURCE_EXHAUSTED')
          ? 429
          : message.includes('403') || message.includes('PERMISSION_DENIED')
          ? 403
          : 502;
      res.status(status).json({ error: message });
    }
  });

  const httpServer = createServer(app);
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (req, socket, head) => {
    const reqUrl = req.url || '/';
    const pathname = reqUrl.split('?')[0];
    if (pathname === '/ws') {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    }
    // Non-`/ws` WebSocket upgrades (such as Vite client HMR) are left untouched
    // for Vite's own server upgrade listener so sockets never close prematurely.
  });

  wss.on('connection', (ws) => {
    const clientId = `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    socketsById.set(clientId, ws);

    sendJson(ws, {
      type: 'welcome',
      clientId,
      lobbies: getPublicRoomSummaries(),
    });

    ws.on('message', (rawBuf) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(String(rawBuf)) as Record<string, unknown>;
      } catch {
        return;
      }

      const type = msg.type;
      if (typeof type !== 'string') return;

      if (type === 'lobbies:list') {
        sendJson(ws, {
          type: 'lobbies:list',
          lobbies: getPublicRoomSummaries(),
        });
        return;
      }

      if (type === 'matchmaking:quick_join') {
        // System-managed matchmaking: place player into the fullest active 2–20 survivor queue
        let targetRoom: MatchRoom | null = null;
        for (const r of rooms.values()) {
          if (
            r.isPublic &&
            (r.phase === 'LOBBY' || r.phase === 'COUNTDOWN') &&
            r.players.size < r.maxPlayers
          ) {
            if (!targetRoom || r.players.size > targetRoom.players.size) {
              targetRoom = r;
            }
          }
        }
        if (!targetRoom) {
          targetRoom = createRoom(true, DEFAULT_MAX_PLAYERS);
        }
        joinClientToRoom(clientId, ws, targetRoom, msg.callsign);
        return;
      }

      if (type === 'matchmaking:create_room') {
        const maxPlayers =
          typeof msg.maxPlayers === 'number' ? msg.maxPlayers : DEFAULT_MAX_PLAYERS;
        const isPublic = msg.isPublic !== false;
        const newRoom = createRoom(isPublic, maxPlayers);
        joinClientToRoom(clientId, ws, newRoom, msg.callsign);
        return;
      }

      if (type === 'matchmaking:join_code') {
        const code = typeof msg.code === 'string' ? msg.code.trim().toUpperCase() : '';
        const found = [...rooms.values()].find((r) => r.code === code);
        if (!found) {
          sendJson(ws, {
            type: 'matchmaking:error',
            message: `Sector room "${code}" was not found.`,
          });
          return;
        }
        if (found.players.size >= found.maxPlayers) {
          sendJson(ws, {
            type: 'matchmaking:error',
            message: `Sector ${found.code} is full (${found.maxPlayers}/${found.maxPlayers} survivors).`,
          });
          return;
        }
        if (found.phase === 'ENDED' || (found.phase === 'IN_PROGRESS' && found.elapsedSeconds > HOT_JOIN_WINDOW_SECONDS)) {
          sendJson(ws, {
            type: 'matchmaking:error',
            message: `Sector ${found.code} lockdown is already underway.`,
          });
          return;
        }
        joinClientToRoom(clientId, ws, found, msg.callsign);
        return;
      }

      if (type === 'matchmaking:leave') {
        removeClientFromCurrentRoom(clientId);
        sendJson(ws, {
          type: 'room:left',
          lobbies: getPublicRoomSummaries(),
        });
        return;
      }

      const roomId = clientToRoom.get(clientId);
      if (!roomId) return;
      const room = rooms.get(roomId);
      if (!room) return;
      const player = room.players.get(clientId);
      if (!player) return;

      if (type === 'matchmaking:set_ready' || type === 'matchmaking:set_callsign') {
        if (typeof msg.ready === 'boolean') {
          player.ready = msg.ready;
        }
        if (typeof msg.callsign === 'string') {
          player.callsign = sanitizeCallsign(msg.callsign, player.spawnIndex + 1);
        }
        evaluateLobbyCountdown(room);
        broadcastRoom(room, {
          type: 'room:updated',
          lobby: serializeRoomLobby(room),
        });
        return;
      }

      if (type === 'matchmaking:force_launch') {
        // Allows connected real players to start the sector immediately (late-joiners can still fill up to 20 during opening window!)
        if (room.phase === 'LOBBY' || room.phase === 'COUNTDOWN') {
          launchMatchRoom(room);
        }
        return;
      }

      if (room.phase !== 'IN_PROGRESS') return;

      if (type === 'player:update') {
        if (!player.alive) return;
        if (typeof msg.x === 'number') player.x = msg.x;
        if (typeof msg.y === 'number') player.y = msg.y;
        if (typeof msg.vx === 'number') player.vx = msg.vx;
        if (typeof msg.vy === 'number') player.vy = msg.vy;
        if (typeof msg.angle === 'number') player.angle = msg.angle;
        if (typeof msg.health === 'number') {
          // Only allow client to report lower health from local Hollow/environmental PvE damage (never self-heal past maxHealth)
          player.health = Math.max(0, Math.min(player.maxHealth, msg.health));
        }
        player.armorEquipped = Boolean(msg.armorEquipped);
        player.equippedItemId =
          typeof msg.equippedItemId === 'string' ? msg.equippedItemId : null;
        player.flashlightOn = Boolean(msg.flashlightOn);
        player.isCrouching = Boolean(msg.isCrouching);
        player.isSprinting = Boolean(msg.isSprinting);
        if (typeof msg.animState === 'string') player.animState = msg.animState;
        if (typeof msg.meleeSwingTimer === 'number') {
          player.meleeSwingTimer = msg.meleeSwingTimer;
        }
        player.lastUpdateAt = Date.now();
        return;
      }

      if (type === 'combat:attack') {
        if (!player.alive) return;
        broadcastRoom(
          room,
          {
            type: 'combat:remote_attack',
            attackerId: player.id,
            kind: msg.kind === 'projectile' ? 'projectile' : 'melee',
            weaponId: typeof msg.weaponId === 'string' ? msg.weaponId : null,
            x: typeof msg.x === 'number' ? msg.x : player.x,
            y: typeof msg.y === 'number' ? msg.y : player.y,
            angle: typeof msg.angle === 'number' ? msg.angle : player.angle,
            pellets: typeof msg.pellets === 'number' ? Math.min(8, msg.pellets) : 1,
            spread: typeof msg.spread === 'number' ? msg.spread : 0.05,
            speed: typeof msg.speed === 'number' ? msg.speed : 860,
            range: typeof msg.range === 'number' ? msg.range : 320,
            noiseRadius: typeof msg.noiseRadius === 'number' ? msg.noiseRadius : 220,
            label: typeof msg.label === 'string' ? msg.label : 'Weapon attack',
          },
          player.id
        );
        return;
      }

      if (type === 'combat:pvp_hit') {
        if (!player.alive) return;
        const targetId = typeof msg.targetId === 'string' ? msg.targetId : '';
        const hitId = typeof msg.hitId === 'string' ? msg.hitId : '';
        if (!targetId || targetId === player.id) return;
        if (hitId) {
          if (room.processedHitIds.has(hitId)) return;
          room.processedHitIds.add(hitId);
          if (room.processedHitIds.size > 4000) {
            const first = room.processedHitIds.values().next().value;
            if (first) room.processedHitIds.delete(first);
          }
        }

        const target = room.players.get(targetId);
        if (!target || !target.alive) return;

        // Plausibility range validation (max shotgun/rifle range + network tolerance)
        const dist = Math.hypot(target.x - player.x, target.y - player.y);
        if (dist > 680) return;

        const rawDamage =
          typeof msg.rawDamage === 'number'
            ? Math.max(2, Math.min(85, msg.rawDamage))
            : 18;
        const armorMult = target.armorEquipped ? 0.7 : 1.0;
        const finalDamage = Math.max(1, Math.round(rawDamage * armorMult));
        const weaponName =
          typeof msg.weaponName === 'string' ? msg.weaponName : 'Weapon';
        const bleedChance =
          typeof msg.bleedChance === 'number' ? Math.min(0.65, msg.bleedChance) : 0.22;

        target.health = Math.max(0, target.health - finalDamage);

        sendJson(target.ws, {
          type: 'player:damaged',
          attackerId: player.id,
          attackerCallsign: player.callsign,
          damage: finalDamage,
          newHealth: target.health,
          bleedChance,
          weaponName,
        });

        broadcastRoom(room, {
          type: 'combat:hit_fx',
          targetId: target.id,
          x: target.x,
          y: target.y,
        });

        if (target.health <= 0 && target.alive) {
          const aliveOthers = [...room.players.values()].filter(
            (p) => p.alive && p.id !== target.id
          ).length;
          target.alive = false;
          target.animState = 'dead';
          target.inExtractionZone = false;
          target.placement = aliveOthers + 1;
          player.pvpKills += 1;

          broadcastRoom(room, {
            type: 'player:eliminated',
            victimId: target.id,
            victimCallsign: target.callsign,
            killerId: player.id,
            killerCallsign: player.callsign,
            weaponName,
            cause: `Eliminated by ${player.callsign} (${weaponName})`,
            x: target.x,
            y: target.y,
            aliveRemaining: aliveOthers,
            placement: target.placement,
          });
        }
        return;
      }

      if (type === 'player:died_pve') {
        if (!player.alive) return;
        const aliveOthers = [...room.players.values()].filter(
          (p) => p.alive && p.id !== player.id
        ).length;
        player.alive = false;
        player.health = 0;
        player.animState = 'dead';
        player.inExtractionZone = false;
        player.placement = aliveOthers + 1;
        const cause =
          typeof msg.cause === 'string' ? msg.cause : 'Killed by The Hollow';

        broadcastRoom(room, {
          type: 'player:eliminated',
          victimId: player.id,
          victimCallsign: player.callsign,
          killerId: null,
          killerCallsign: 'THE HOLLOW',
          weaponName: 'Hollow',
          cause,
          x: player.x,
          y: player.y,
          aliveRemaining: aliveOthers,
          placement: player.placement,
        });
        return;
      }

      // World delta synchronization (idempotent)
      if (type === 'world:door_toggled') {
        const tx = Number(msg.tx);
        const ty = Number(msg.ty);
        const open = Boolean(msg.open);
        if (Number.isFinite(tx) && Number.isFinite(ty)) {
          const key = `${tx},${ty}`;
          if (open) room.openedDoors.add(key);
          else room.openedDoors.delete(key);
          broadcastRoom(
            room,
            { type: 'world:door_toggled', tx, ty, open },
            player.id
          );
        }
        return;
      }

      if (type === 'world:window_broken') {
        const tx = Number(msg.tx);
        const ty = Number(msg.ty);
        if (Number.isFinite(tx) && Number.isFinite(ty)) {
          const key = `${tx},${ty}`;
          if (!room.brokenWindows.has(key)) {
            room.brokenWindows.add(key);
            broadcastRoom(
              room,
              { type: 'world:window_broken', tx, ty },
              player.id
            );
          }
        }
        return;
      }

      if (type === 'world:enemy_killed') {
        const enemyId = typeof msg.enemyId === 'string' ? msg.enemyId : '';
        if (enemyId && !room.deadEnemyIds.has(enemyId)) {
          room.deadEnemyIds.add(enemyId);
          broadcastRoom(
            room,
            { type: 'world:enemy_killed', enemyId },
            player.id
          );
        }
        return;
      }

      if (type === 'world:container_updated') {
        const containerId =
          typeof msg.containerId === 'string' ? msg.containerId : '';
        if (containerId && Array.isArray(msg.items)) {
          const searched = Boolean(msg.searched);
          const items = msg.items as (InventoryItemNet | null)[];
          room.updatedContainers.set(containerId, { searched, items });
          broadcastRoom(
            room,
            { type: 'world:container_updated', containerId, searched, items },
            player.id
          );
        }
        return;
      }

      if (type === 'world:ground_items_dropped') {
        if (Array.isArray(msg.items)) {
          const spawned: GroundItemNet[] = [];
          for (const raw of msg.items) {
            if (
              raw &&
              typeof raw.id === 'string' &&
              typeof raw.x === 'number' &&
              typeof raw.y === 'number' &&
              raw.item
            ) {
              if (!room.spawnedGroundItems.has(raw.id)) {
                room.spawnedGroundItems.set(raw.id, raw as GroundItemNet);
                spawned.push(raw as GroundItemNet);
              }
            }
          }
          if (spawned.length > 0) {
            broadcastRoom(
              room,
              { type: 'world:ground_items_dropped', items: spawned },
              player.id
            );
          }
        }
        return;
      }

      if (type === 'world:ground_item_taken') {
        const groundItemId =
          typeof msg.groundItemId === 'string' ? msg.groundItemId : '';
        if (groundItemId && !room.takenGroundItemIds.has(groundItemId)) {
          room.takenGroundItemIds.add(groundItemId);
          room.spawnedGroundItems.delete(groundItemId);
          broadcastRoom(
            room,
            { type: 'world:ground_item_taken', groundItemId },
            player.id
          );
        }
        return;
      }

      if (type === 'world:generator_powered') {
        if (!room.generatorPowered) {
          room.generatorPowered = true;
          broadcastRoom(room, { type: 'world:generator_powered' }, player.id);
        }
        return;
      }
    });

    ws.on('close', () => {
      socketsById.delete(clientId);
      removeClientFromCurrentRoom(clientId);
    });
  });

  // Authoritative 20 Hz Server Simulation & State Sync Loop (50ms tick)
  const TICK_DT = 0.05;
  let lobbyBroadcastAccum = 0;
  let lastTickMs = Date.now();

  setInterval(() => {
    const nowMs = Date.now();
    // Real elapsed time keeps the 50s matchmaking countdown accurate even if
    // the simulation tick runs slower than 20 Hz under load.
    const realDt = Math.min(0.25, Math.max(0, (nowMs - lastTickMs) / 1000));
    lastTickMs = nowMs;
    lobbyBroadcastAccum += realDt;

    for (const room of rooms.values()) {
      if (room.phase === 'LOBBY' || room.phase === 'COUNTDOWN') {
        if (room.players.size > 0) {
          // Only run the 50s match countdown once the minimum is met.
          if (room.players.size >= MIN_AUTO_START_PLAYERS) {
            room.countdownSeconds = Math.max(0, room.countdownSeconds - realDt);
          }
          evaluateLobbyCountdown(room);

          if (
            room.players.size >= MIN_AUTO_START_PLAYERS &&
            room.countdownSeconds <= 0
          ) {
            launchMatchRoom(room);
            continue;
          }

          if (lobbyBroadcastAccum >= 0.5) {
            broadcastRoom(room, {
              type: 'room:updated',
              lobby: serializeRoomLobby(room),
            });
          }
        }
        continue;
      }

      if (room.phase !== 'IN_PROGRESS') continue;

      room.elapsedSeconds = Math.min(
        RUN_DURATION_SECONDS,
        room.elapsedSeconds + TICK_DT * ONLINE_CLOCK_SPEED_MULT
      );

      const site =
        EXTRACTION_SITES.find((s) => s.id === room.extractionSiteId) ||
        EXTRACTION_SITES[0];
      const zb = site.bounds;

      const alivePlayers: ServerPlayer[] = [];
      const inLzPlayers: ServerPlayer[] = [];

      for (const p of room.players.values()) {
        if (!p.alive) {
          p.inExtractionZone = false;
          p.lzHoldSeconds = 0;
          continue;
        }
        alivePlayers.push(p);
        const inside =
          p.x >= zb.x &&
          p.x <= zb.x + zb.w &&
          p.y >= zb.y &&
          p.y <= zb.y + zb.h;
        p.inExtractionZone = inside;
        if (inside) {
          inLzPlayers.push(p);
        } else {
          p.lzHoldSeconds = 0;
        }
      }

      // Single-Seat Echo-7 Extraction Arbitration!
      // Echo-7 arrives overhead at ~5:53 AM (6.88 * H = 1769s) and departs at 6:00 AM (1800s).
      const heliOverheadThreshold = (6.88 / 7) * RUN_DURATION_SECONDS;
      const extractionContested = inLzPlayers.length > 1;

      if (room.elapsedSeconds >= heliOverheadThreshold) {
        if (inLzPlayers.length === 1) {
          // Sole uncontested survivor inside [H] boards Echo-7 after holding 4.5s!
          inLzPlayers[0].lzHoldSeconds += TICK_DT;
          if (inLzPlayers[0].lzHoldSeconds >= 4.5) {
            concludeMatchWithExtraction(
              room,
              inLzPlayers[0],
              `Echo-7 lifted off from ${site.name} with ${inLzPlayers[0].callsign} in the ONLY extraction seat!`
            );
            continue;
          }
        } else {
          for (const p of inLzPlayers) {
            p.lzHoldSeconds = 0;
          }
        }
      }

      // Final 6:00 AM Touchdown Buzzer: ONLY ONE survivor can board Echo-7!
      if (room.elapsedSeconds >= RUN_DURATION_SECONDS) {
        if (inLzPlayers.length >= 1) {
          // Tie-breaker if rivals are still fighting inside [H] at 06:00 AM sharp:
          // Survivor closest to the helicopter winch center claims the single harness!
          let bestWinner = inLzPlayers[0];
          let bestDist = Math.hypot(
            bestWinner.x - site.center.x,
            bestWinner.y - site.center.y
          );
          for (let i = 1; i < inLzPlayers.length; i++) {
            const cand = inLzPlayers[i];
            const d = Math.hypot(cand.x - site.center.x, cand.y - site.center.y);
            if (d < bestDist) {
              bestDist = d;
              bestWinner = cand;
            }
          }
          concludeMatchWithExtraction(
            room,
            bestWinner,
            `06:00 AM — ${bestWinner.callsign} seized the ONLY seat aboard Flight Echo-7 at ${site.name}!`
          );
        } else {
          concludeMatchWithExtraction(
            room,
            null,
            `06:00 AM — Flight Echo-7 departed ${site.name} with nobody aboard.`
          );
        }
        continue;
      }

      // If everyone in a multi-player match has died before 6:00 AM, end the room cleanly
      if (room.totalParticipants >= 1 && alivePlayers.length === 0) {
        room.phase = 'ENDED';
        continue;
      }

      // Broadcast 20 Hz delta snapshot of player transforms & LZ status
      broadcastRoom(room, {
        type: 'world:tick',
        elapsedSeconds: room.elapsedSeconds,
        aliveCount: alivePlayers.length,
        totalParticipants: Math.max(room.totalParticipants, room.players.size),
        survivorsInLZ: inLzPlayers.length,
        extractionContested,
        players: [...room.players.values()].map(serializePlayerNet),
      });
    }

    if (lobbyBroadcastAccum >= 0.5) {
      lobbyBroadcastAccum = 0;
    }
  }, 50);

  if (process.env.NODE_ENV !== 'production') {
    process.env.DISABLE_HMR ??= 'true';
    const disableHmr = process.env.DISABLE_HMR === 'true';
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        allowedHosts: true,
        ws: {
          server: httpServer,
        },
        hmr: disableHmr ? false : { server: httpServer },
        watch: disableHmr ? null : {},
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`LAST NIGHT PvPvE Server listening on http://0.0.0.0:${PORT}`);
    setTimeout(() => {
      triggerBackgroundRadioPrewarm();
    }, 600);
  });
}

startServer();
