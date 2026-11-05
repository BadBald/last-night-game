export type GameScreenState =
  | 'TITLE'
  | 'PLAYING'
  | 'PAUSED'
  | 'DEATH'
  | 'VICTORY'
  | 'MISSED_EXTRACTION';

export type OverlayPanel =
  | 'NONE'
  | 'INVENTORY'
  | 'LOOT'
  | 'PHONE'
  | 'SETTINGS'
  | 'CREDITS'
  | 'CONTINUE_DOSSIER'
  | 'ONLINE_LOBBY'
  | 'CHAT';

export type DistrictId =
  | 'village'
  | 'road_f45'
  | 'residential'
  | 'commercial'
  | 'supermarket'
  | 'pharmacy'
  | 'hospital'
  | 'police'
  | 'industrial'
  | 'parking'
  | 'stadium'
  | 'military_base'
  | 'rooftop'
  | 'streets';

export type ExtractionSiteId = 'military_base' | 'stadium' | 'parking' | 'rooftop';

export type CampaignStage =
  | 'ESCAPE_VILLAGE'
  | 'CROSS_F45'
  | 'HOSPITAL_INJECTION'
  | 'HOSPITAL_RADIO'
  | 'SURVIVE_TO_HELIPAD';

export interface ExtractionSiteDef {
  id: ExtractionSiteId;
  name: string;
  shortName: string;
  sectorLabel: string;
  routeHint: string;
  zoneBounds: { x: number; y: number; w: number; h: number };
  generatorPos: { x: number; y: number };
}

export enum TileType {
  ASPHALT = 0,
  SIDEWALK = 1,
  ALLEY = 2,
  GRASS = 3,
  WOOD_FLOOR = 4,
  TILE_FLOOR = 5,
  CHECKER_FLOOR = 6,
  CONCRETE_FLOOR = 7,
  HOSPITAL_FLOOR = 8,
  ROOFTOP_DECK = 9,
  HELIPAD = 10,
  RAMP = 11,
  STAIRS = 12,
  STADIUM_TURF = 13,
  DIRT_PATH = 14,
  WALL_EXTERIOR = 20,
  WALL_INTERIOR = 21,
  WALL_BRICK = 22,
  WALL_HOSPITAL = 23,
  WALL_PARAPET = 24,
  FENCE = 25,
  WINDOW = 26,
  WINDOW_BROKEN = 27,
  DOOR_CLOSED = 28,
  DOOR_OPEN = 29,
  BARRICADE = 30,
}

export type ItemCategory =
  | 'weapon_melee'
  | 'weapon_ranged'
  | 'ammo'
  | 'medical'
  | 'food'
  | 'utility';

export interface WeaponStats {
  damage: number;
  cooldown: number;
  range: number;
  spread: number;
  pellets?: number;
  noiseRadius: number;
  staminaCost?: number;
  arcAngle?: number;
  knockback: number;
  ammoItemId?: string;
  magSize?: number;
  reloadTime?: number;
  projectileSpeed?: number;
}

export interface ItemEffects {
  heal?: number;
  hunger?: number;
  stamina?: number;
  contaminationDelta?: number;
  cureBleeding?: boolean;
  cureInfection?: boolean;
  clearSpores?: boolean;
  batteryCharge?: number;
  armorBonus?: number;
  throwableType?: 'flare' | 'noisemaker';
}

export interface ItemDef {
  id: string;
  name: string;
  description: string;
  category: ItemCategory;
  iconId: string;
  stackLimit: number;
  weight: number;
  maxDurability?: number;
  weaponStats?: WeaponStats;
  effects?: ItemEffects;
  interactionLabel: string;
}

export interface InventoryItemInstance {
  uid: string;
  itemId: string;
  quantity: number;
  durability?: number;
  loadedAmmo?: number;
}

export type ContainerType =
  | 'cabinet'
  | 'fridge'
  | 'dresser'
  | 'desk'
  | 'supermarket_shelf'
  | 'pharmacy_shelf'
  | 'medical_cabinet'
  | 'police_locker'
  | 'car_trunk'
  | 'toolbox'
  | 'storage_crate'
  | 'survivor_pack';

export interface ContainerEntity {
  id: string;
  type: ContainerType;
  label: string;
  tx: number;
  ty: number;
  x: number;
  y: number;
  district: DistrictId;
  searchDuration: number;
  searched: boolean;
  items: (InventoryItemInstance | null)[];
}

export interface GroundItem {
  id: string;
  x: number;
  y: number;
  item: InventoryItemInstance;
}

export interface GroundDecal {
  kind: 'blood_pool' | 'blood_drag' | 'skid_mark' | 'scorch_mark' | 'road_sign_f45';
  x: number;
  y: number;
  angle: number;
  scale: number;
  seed: number;
}

export interface ObstacleProp {
  id: string;
  kind:
    | 'bed'
    | 'table'
    | 'counter'
    | 'shelf_block'
    | 'car'
    | 'car_wreck'
    | 'semi_truck'
    | 'police_car'
    | 'ambulance'
    | 'pillar'
    | 'gurney'
    | 'crate'
    | 'hay_bale'
    | 'dumpster'
    | 'generator'
    | 'antiviral_station'
    | 'hospital_radio'
    | 'corpse'
    | 'tree';
  x: number;
  y: number;
  w: number;
  h: number;
  solid: boolean;
  blocksBullets: boolean;
  blocksSight: boolean;
  colorSeed: number;
  powered?: boolean;
  used?: boolean;
}

export interface BuildingRoom {
  id: string;
  name: string;
  district: DistrictId;
  tx: number;
  ty: number;
  tw: number;
  th: number;
  hasRoof: boolean;
  hasInteriorLight: boolean;
  flickerSeed: number;
}

export interface StreetLight {
  x: number;
  y: number;
  radius: number;
  flickerSeed: number;
  emergencyOnly?: boolean;
}

export interface SporeZone {
  id: string;
  x: number;
  y: number;
  radius: number;
  intensity: number;
  permanent: boolean;
  remainingTime: number;
  activeAfterHour: number;
}

export interface ActiveFlare {
  id: string;
  x: number;
  y: number;
  remaining: number;
  type: 'flare' | 'noisemaker';
  pulseTimer: number;
}

export type EnemyClass = 'crawler' | 'still' | 'bloom' | 'mimic';

export type EnemyAIState =
  | 'IDLE'
  | 'PATROL'
  | 'SUSPICIOUS'
  | 'ALERT'
  | 'CHASE'
  | 'ATTACK'
  | 'SEARCH'
  | 'RETURN'
  | 'DEAD';

export interface EnemyEntity {
  id: string;
  enemyClass: EnemyClass;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  radius: number;
  health: number;
  maxHealth: number;
  state: EnemyAIState;
  stateTimer: number;
  attackCooldown: number;
  windupTimer: number;
  hasDealtAttackHit: boolean;
  spawnPos: { x: number; y: number };
  patrolWaypoints: { x: number; y: number }[];
  waypointIndex: number;
  lastKnownTarget: { x: number; y: number } | null;
  alertLevel: number;
  hurtFlash: number;
  animTime: number;
  specialTimer: number;
  deathBurstDone?: boolean;
}

export interface Projectile {
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  damage: number;
  knockback: number;
  remainingRange: number;
  color: string;
  isRemoteVisual?: boolean;
}

export interface Particle {
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  alpha: number;
  life: number;
  maxLife: number;
  color: string;
  drag: number;
}

export interface NoiseEvent {
  id: string;
  x: number;
  y: number;
  radius: number;
  intensity: number;
  age: number;
  duration: number;
  label: string;
  isMimicLure?: boolean;
}

export interface RadioMessage {
  id: string;
  timeFormatted: string;
  sender: string;
  text: string;
  urgent: boolean;
  broadcastId?: string;
  headline?: string;
  toneSummary?: string;
  transcript?: {
    type: 'speaker' | 'cue';
    speaker?: string;
    cue?: string;
    lines?: string[];
  }[];
}

export interface ActiveRadioBroadcastState {
  broadcastId: string;
  broadcastNumber: number;
  timeLabel: string;
  headline: string;
  speaker: string;
  captionText: string;
  isCue: boolean;
  audioLevel: number;
  loadingVoice: boolean;
}

export interface PlayerConditions {
  bleeding: boolean;
  infected: boolean;
  exhausted: boolean;
  sporeExposure: boolean;
}

export type PlayerActionAnim =
  | 'idle'
  | 'walk'
  | 'sprint'
  | 'crouch'
  | 'melee'
  | 'shoot'
  | 'reload'
  | 'hurt'
  | 'dead';

export interface PlayerState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  radius: number;
  health: number;
  maxHealth: number;
  hunger: number;
  maxHunger: number;
  stamina: number;
  maxStamina: number;
  contamination: number;
  maxContamination: number;
  conditions: PlayerConditions;
  bleedTimer: number;
  infectionTimer: number;
  flashlightOn: boolean;
  flashlightBattery: number;
  isSprinting: boolean;
  isCrouching: boolean;
  equippedSlot: number | null;
  isReloading: boolean;
  reloadTimer: number;
  reloadDuration: number;
  attackCooldown: number;
  meleeSwingTimer: number;
  meleeSwingAngle: number;
  hurtFlash: number;
  animState: PlayerActionAnim;
  animTime: number;
  stepDistanceAccum: number;
  armorEquipped: boolean;
}

export interface RemoteSurvivorState {
  id: string;
  callsign: string;
  color: string;
  spawnIndex: number;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  vx: number;
  vy: number;
  angle: number;
  targetAngle: number;
  health: number;
  maxHealth: number;
  armorEquipped: boolean;
  equippedItemId: string | null;
  flashlightOn: boolean;
  isCrouching: boolean;
  isSprinting: boolean;
  animState: PlayerActionAnim;
  animTime: number;
  meleeSwingTimer: number;
  hurtFlash: number;
  alive: boolean;
  extracted: boolean;
  pvpKills: number;
  inExtractionZone: boolean;
}

export interface LobbyPlayerSummary {
  id: string;
  callsign: string;
  color: string;
  ready: boolean;
  alive: boolean;
  pvpKills: number;
}

export interface PublicRoomSummary {
  roomId: string;
  code: string;
  phase: 'LOBBY' | 'COUNTDOWN' | 'IN_PROGRESS' | 'ENDED';
  playerCount: number;
  maxPlayers: number;
  elapsedSeconds: number;
}

export interface KillFeedEntry {
  id: string;
  victimCallsign: string;
  killerCallsign: string;
  weaponName: string;
  timestamp: number;
}

export interface ChatMessage {
  id: string;
  fromId: string;
  fromCallsign: string;
  text: string;
  timestamp: number;
  isSelf?: boolean;
}

export interface OnlineSessionSnapshot {
  isOnlineMode: boolean;
  wsConnected: boolean;
  selfId: string | null;
  callsign: string;
  roomId: string | null;
  roomCode: string | null;
  phase: 'IDLE' | 'LOBBY' | 'COUNTDOWN' | 'IN_PROGRESS' | 'ENDED';
  countdownSeconds: number;
  playerCount: number;
  maxPlayers: number;
  minAutoStartPlayers: number;
  aliveCount: number;
  totalParticipants: number;
  selfReady: boolean;
  errorMessage: string | null;
  roster: LobbyPlayerSummary[];
  publicLobbies: PublicRoomSummary[];
  killFeed: KillFeedEntry[];
  chatMessages: ChatMessage[];
  unreadChatCount: number;
}

export interface ExtractionState {
  site: ExtractionSiteDef;
  coordinatesKnown: boolean;
  zoneActive: boolean;
  rotorAudible: boolean;
  searchlightActive: boolean;
  heliPosition: { x: number; y: number };
  heliTarget: { x: number; y: number };
  heliVisible: boolean;
  rotorAngle: number;
  searchlightPos: { x: number; y: number };
  playerInZone: boolean;
  generatorPowered: boolean;
  zoneBounds: { x: number; y: number; w: number; h: number };
  survivorsInLZ?: number;
  contested?: boolean;
}

export interface RunStats {
  survivedSeconds: number;
  finalTimeFormatted: string;
  causeOfDeath: string;
  extractionSiteName: string;
  enemiesKilled: number;
  pvpKills?: number;
  placement?: number;
  totalParticipants?: number;
  winnerCallsign?: string | null;
  isOnlineMatch?: boolean;
  containersSearched: number;
  shotsFired: number;
  shotsHit: number;
  itemsUsed: number;
  damageTaken: number;
  distanceTraveledMeters: number;
  extracted: boolean;
}

export interface PersistentRecords {
  totalRuns: number;
  extractions: number;
  longestSurvivalSeconds: number;
  totalHollowSlain: number;
  totalContainersLooted: number;
  lastRun: RunStats | null;
}

export type GamepadBrand = 'xbox' | 'playstation' | 'nintendo';

export interface GameSettings {
  masterVolume: number;
  musicVolume: number;
  radioVolume: number;
  sfxVolume: number;
  ambientVolume: number;
  muted: boolean;
  screenShake: boolean;
  controllerVibration: boolean;
  mobileControlsMode: 'auto' | 'on' | 'off';
  showAcousticRings: boolean;
}

export interface InteractionPrompt {
  label: string;
  sublabel?: string;
  progress?: number;
  kind: 'container' | 'door' | 'window' | 'pickup' | 'generator' | 'antiviral' | 'radio';
}

export interface MapDistrictMarker {
  id: string;
  label: string;
  nx: number; // 0..1 normalized world X
  ny: number; // 0..1 normalized world Y
  isTargetLZ: boolean;
  isLZCandidate?: boolean;
}

export interface UISnapshot {
  screen: GameScreenState;
  panel: OverlayPanel;
  clockFormatted: string;
  countdownFormatted: string;
  currentHourIndex: number;
  districtName: string;
  weatherLabel: string;
  powerGridOnline: boolean;
  health: number;
  maxHealth: number;
  hunger: number;
  stamina: number;
  contamination: number;
  conditions: PlayerConditions;
  flashlightOn: boolean;
  flashlightBattery: number;
  isCrouching: boolean;
  isSprinting: boolean;
  isReloading: boolean;
  reloadProgress: number;
  backpack: (InventoryItemInstance | null)[];
  equippedSlot: number | null;
  totalWeight: number;
  maxWeight: number;
  armorEquipped: boolean;
  activeContainer: ContainerEntity | null;
  interactionPrompt: InteractionPrompt | null;
  radioMessages: RadioMessage[];
  unreadRadioCount: number;
  activeRadioBroadcast: ActiveRadioBroadcastState | null;
  airedBroadcastIds: string[];
  latestToast: { id: string; title: string; text: string; urgent: boolean } | null;
  objective: {
    stage: CampaignStage;
    stepNumber: number;
    totalSteps: number;
    title: string;
    hint: string;
    targetLabel: string;
    directionAngle: number;
    compassCardinal: string;
    distanceMeters: number;
    targetNormPos: { x: number; y: number };
    injectionTaken: boolean;
    radioDiscovered: boolean;
  };
  extraction: {
    siteId: ExtractionSiteId;
    siteName: string;
    shortName: string;
    sectorLabel: string;
    routeHint: string;
    coordinatesKnown: boolean;
    zoneActive: boolean;
    playerInZone: boolean;
    directionAngle: number;
    compassCardinal: string;
    distanceMeters: number;
    generatorPowered: boolean;
    playerNormPos: { x: number; y: number };
    lzNormPos: { x: number; y: number };
    mapMarkers: MapDistrictMarker[];
    survivorsInLZ: number;
    contested: boolean;
  };
  online: OnlineSessionSnapshot;
  runStats: RunStats;
  records: PersistentRecords;
  settings: GameSettings;
  isTouchDevice: boolean;
  isGamepadConnected: boolean;
  isGamepadActive: boolean;
  gamepadName: string;
  gamepadBrand: GamepadBrand;
}
