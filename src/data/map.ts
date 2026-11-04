import { CONFIG } from '../config';
import { ENEMY_ARCHETYPES } from './enemies';
import { createItemInstance, generateContainerLoot } from '../systems/loot';
import {
  BuildingRoom,
  ContainerEntity,
  ContainerType,
  DistrictId,
  EnemyClass,
  EnemyEntity,
  ExtractionSiteDef,
  ExtractionSiteId,
  GroundDecal,
  GroundItem,
  MapDistrictMarker,
  ObstacleProp,
  SporeZone,
  StreetLight,
  TileType,
} from '../types';

export interface WorldMapData {
  width: number;
  height: number;
  tiles: Uint8Array;
  districts: DistrictId[];
  rooms: BuildingRoom[];
  containers: ContainerEntity[];
  props: ObstacleProp[];
  decals: GroundDecal[];
  streetLights: StreetLight[];
  sporeZones: SporeZone[];
  groundItems: GroundItem[];
  enemies: EnemyEntity[];
  playerStart: { x: number; y: number };
  f45EntryPos: { x: number; y: number };
  cityGatePos: { x: number; y: number };
  hospitalInjectionPos: { x: number; y: number };
  hospitalRadioPos: { x: number; y: number };
  activeExtractionSite: ExtractionSiteDef;
  allExtractionSites: ExtractionSiteDef[];
  mapMarkers: MapDistrictMarker[];
}

export function isSolidTile(t: TileType): boolean {
  return (
    t === TileType.WALL_EXTERIOR ||
    t === TileType.WALL_INTERIOR ||
    t === TileType.WALL_BRICK ||
    t === TileType.WALL_HOSPITAL ||
    t === TileType.WALL_PARAPET ||
    t === TileType.FENCE ||
    t === TileType.WINDOW ||
    t === TileType.DOOR_CLOSED ||
    t === TileType.BARRICADE
  );
}

export function tileBlocksSight(t: TileType): boolean {
  return (
    t === TileType.WALL_EXTERIOR ||
    t === TileType.WALL_INTERIOR ||
    t === TileType.WALL_BRICK ||
    t === TileType.WALL_HOSPITAL ||
    t === TileType.DOOR_CLOSED
  );
}

export function tileBlocksBullets(t: TileType): boolean {
  return (
    t === TileType.WALL_EXTERIOR ||
    t === TileType.WALL_INTERIOR ||
    t === TileType.WALL_BRICK ||
    t === TileType.WALL_HOSPITAL ||
    t === TileType.WALL_PARAPET ||
    t === TileType.DOOR_CLOSED ||
    t === TileType.BARRICADE ||
    t === TileType.WINDOW
  );
}

export interface WorldBuildOptions {
  seed?: number;
  forcedExtractionSiteId?: ExtractionSiteId;
  spawnPos?: { x: number; y: number };
}

function createMulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildCityWorld(options?: WorldBuildOptions): WorldMapData {
  const rng = options?.seed !== undefined ? createMulberry32(options.seed) : Math.random;
  const W = CONFIG.MAP_WIDTH; // 216
  const H = CONFIG.MAP_HEIGHT; // 92
  const T = CONFIG.TILE_SIZE; // 40
  const OX = 92; // City X-offset after Countryside Village (0..37) + Highway F45 (38..94) + City Gate (95)

  const tiles = new Uint8Array(W * H);
  const districts: DistrictId[] = new Array(W * H).fill('streets');
  const rooms: BuildingRoom[] = [];
  const containers: ContainerEntity[] = [];
  const props: ObstacleProp[] = [];
  const decals: GroundDecal[] = [];
  const streetLights: StreetLight[] = [];
  const sporeZones: SporeZone[] = [];
  const groundItems: GroundItem[] = [];
  const enemies: EnemyEntity[] = [];

  let idSeq = 1;
  const nextId = (prefix: string) => `${prefix}_${idSeq++}`;

  const setTile = (tx: number, ty: number, type: TileType) => {
    if (tx >= 0 && tx < W && ty >= 0 && ty < H) {
      tiles[ty * W + tx] = type;
    }
  };

  const getTile = (tx: number, ty: number): TileType => {
    if (tx < 0 || tx >= W || ty < 0 || ty >= H) return TileType.WALL_EXTERIOR;
    return tiles[ty * W + tx] as TileType;
  };

  const fillTiles = (x0: number, y0: number, w: number, h: number, type: TileType) => {
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) {
        setTile(x, y, type);
      }
    }
  };

  const fillDistrict = (x0: number, y0: number, w: number, h: number, d: DistrictId) => {
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) {
        if (x >= 0 && x < W && y >= 0 && y < H) {
          districts[y * W + x] = d;
        }
      }
    }
  };

  const addDecal = (
    kind: GroundDecal['kind'],
    tx: number,
    ty: number,
    angle = 0,
    scale = 1
  ) => {
    decals.push({
      kind,
      x: tx * T,
      y: ty * T,
      angle,
      scale,
      seed: rng(),
    });
  };

  const buildShell = (
    name: string,
    district: DistrictId,
    x0: number,
    y0: number,
    w: number,
    h: number,
    wallType: TileType,
    floorType: TileType,
    hasRoof = true,
    hasInteriorLight = true
  ) => {
    fillTiles(x0, y0, w, h, floorType);
    for (let x = x0; x < x0 + w; x++) {
      setTile(x, y0, wallType);
      setTile(x, y0 + h - 1, wallType);
    }
    for (let y = y0; y < y0 + h; y++) {
      setTile(x0, y, wallType);
      setTile(x0 + w - 1, y, wallType);
    }
    rooms.push({
      id: nextId('room'),
      name,
      district,
      tx: x0,
      ty: y0,
      tw: w,
      th: h,
      hasRoof,
      hasInteriorLight,
      flickerSeed: rng() * 100,
    });
  };

  const addContainer = (
    type: ContainerType,
    label: string,
    tx: number,
    ty: number,
    district: DistrictId,
    searchDuration = 1.8,
    guaranteedItems?: { itemId: string; qty: number }[]
  ) => {
    const items = generateContainerLoot(district, type, 6, rng);
    if (guaranteedItems) {
      guaranteedItems.forEach((g, idx) => {
        if (idx < items.length) {
          items[idx] = createItemInstance(g.itemId, g.qty, undefined, rng);
        }
      });
    }
    containers.push({
      id: nextId('cnt'),
      type,
      label,
      tx,
      ty,
      x: tx * T + T / 2,
      y: ty * T + T / 2,
      district,
      searchDuration,
      searched: false,
      items,
    });
  };

  const addProp = (
    kind: ObstacleProp['kind'],
    tx: number,
    ty: number,
    tw: number,
    th: number,
    solid = true,
    blocksBullets = true,
    blocksSight = false
  ): ObstacleProp => {
    const p: ObstacleProp = {
      id: nextId('prop'),
      kind,
      x: tx * T + 3,
      y: ty * T + 3,
      w: tw * T - 6,
      h: th * T - 6,
      solid,
      blocksBullets,
      blocksSight,
      colorSeed: rng(),
    };
    props.push(p);
    return p;
  };

  const addInternalWallH = (x0: number, y: number, len: number, doorOffset?: number) => {
    for (let i = 0; i < len; i++) {
      setTile(x0 + i, y, i === doorOffset ? TileType.DOOR_CLOSED : TileType.WALL_INTERIOR);
    }
  };

  const addInternalWallV = (x: number, y0: number, len: number, doorOffset?: number) => {
    for (let i = 0; i < len; i++) {
      setTile(x, y0 + i, i === doorOffset ? TileType.DOOR_CLOSED : TileType.WALL_INTERIOR);
    }
  };

  // =========================================================================
  // ZONE A: OAKHAVEN COUNTRYSIDE VILLAGE (West: tx 1..37, ty 1..90)
  // =========================================================================
  fillTiles(0, 0, 38, H, TileType.GRASS);
  fillDistrict(1, 1, 37, H - 2, 'village');

  // Dirt roads inside Oakhaven Village leading straight east to Highway F45
  fillTiles(6, 54, 32, 5, TileType.DIRT_PATH); // Main E-W village lane -> Road F45
  fillTiles(20, 24, 3, 52, TileType.DIRT_PATH); // N-S village farm lane

  // Eastern Village Quarantine Fence forcing exit ONLY onto Highway F45 (ty 52..60)
  for (let y = 1; y < H - 1; y++) {
    if (y < 52 || y > 60) {
      setTile(37, y, TileType.FENCE);
    }
  }
  // Wooden homestead fences framing the village pastures
  for (let x = 5; x <= 35; x++) {
    if (x < 19 || x > 23) {
      setTile(x, 21, TileType.FENCE);
      setTile(x, 77, TileType.FENCE);
    }
  }

  // Rural woodland trees surrounding the village
  for (let tx = 2; tx <= 35; tx += 4) {
    addProp('tree', tx, 6 + (tx % 3) * 3, 1, 1);
    addProp('tree', tx + 1, 14 + ((tx * 2) % 3) * 2, 1, 1);
    addProp('tree', tx, 80 + (tx % 3) * 2, 1, 1);
    addProp('tree', tx + 1, 86 - (tx % 2) * 2, 1, 1);
  }
  for (let ty = 24; ty <= 72; ty += 6) {
    addProp('tree', 2, ty, 1, 1);
    addProp('tree', 4, ty + 2, 1, 1);
  }

  // Rural porch & lane lanterns
  streetLights.push(
    { x: 19 * T + T / 2, y: 53 * T + T / 2, radius: 165, flickerSeed: 11.4 },
    { x: 35 * T + T / 2, y: 53 * T + T / 2, radius: 175, flickerSeed: 28.9 },
    { x: 21 * T + T / 2, y: 36 * T + T / 2, radius: 150, flickerSeed: 44.2 }
  );

  // 1. Miller Farmhouse (Player Starting Cabin: tx 6..16, ty 41..51)
  buildShell(
    'Miller Farmhouse',
    'village',
    6,
    41,
    11,
    11,
    TileType.WALL_BRICK,
    TileType.WOOD_FLOOR
  );
  addInternalWallV(11, 41, 11, 5);
  setTile(11, 45, TileType.DOOR_OPEN);
  setTile(11, 46, TileType.DOOR_OPEN);
  setTile(9, 51, TileType.DOOR_CLOSED);
  setTile(10, 51, TileType.DOOR_CLOSED);
  fillTiles(8, 52, 4, 2, TileType.DIRT_PATH);
  setTile(16, 46, TileType.DOOR_CLOSED);
  setTile(16, 47, TileType.DOOR_CLOSED);
  fillTiles(17, 45, 3, 4, TileType.DIRT_PATH);
  setTile(7, 51, TileType.WINDOW);
  setTile(14, 51, TileType.WINDOW);
  setTile(6, 46, TileType.WINDOW);
  addProp('bed', 7, 42, 2, 2);
  addProp('table', 13, 49, 2, 1);
  addContainer('dresser', 'Farmhouse Dresser', 7, 49, 'village', 1.4, [
    { itemId: 'bandage', qty: 2 },
    { itemId: 'powerbank', qty: 1 },
  ]);
  addContainer('fridge', 'Country Icebox', 14, 42, 'village', 1.5, [
    { itemId: 'canned_beans', qty: 1 },
    { itemId: 'water_bottle', qty: 1 },
  ]);
  groundItems.push({
    id: nextId('gnd'),
    x: 13.5 * T,
    y: 44.5 * T,
    item: createItemInstance('flare', 1),
  });

  // 2. Oakhaven Red Barn (tx 7..18, ty 24..35)
  buildShell(
    'Oakhaven Barn',
    'village',
    7,
    24,
    12,
    12,
    TileType.WALL_EXTERIOR,
    TileType.WOOD_FLOOR
  );
  setTile(18, 29, TileType.DOOR_OPEN);
  setTile(18, 30, TileType.DOOR_OPEN);
  fillTiles(19, 28, 1, 4, TileType.DIRT_PATH);
  addProp('hay_bale', 9, 26, 2, 2);
  addProp('hay_bale', 9, 31, 2, 2);
  addProp('hay_bale', 14, 26, 2, 1);
  addContainer('toolbox', 'Barn Workbench', 15, 33, 'village', 1.8, [
    { itemId: 'pipe_wrench', qty: 1 },
    { itemId: 'powerbank', qty: 1 },
  ]);
  addContainer('storage_crate', 'Feed Loft Crate', 8, 29, 'village', 1.7);

  // 3. Creekside Country Store (tx 24..35, ty 26..36)
  buildShell(
    'Creekside Country Store',
    'village',
    24,
    26,
    12,
    11,
    TileType.WALL_BRICK,
    TileType.WOOD_FLOOR
  );
  setTile(24, 31, TileType.DOOR_CLOSED);
  fillTiles(23, 30, 1, 3, TileType.DIRT_PATH);
  setTile(29, 36, TileType.DOOR_CLOSED);
  setTile(27, 36, TileType.WINDOW);
  setTile(32, 36, TileType.WINDOW);
  addProp('shelf_block', 27, 29, 5, 1);
  addProp('counter', 27, 33, 5, 1);
  addContainer('supermarket_shelf', 'General Store Shelf', 33, 28, 'village', 1.7, [
    { itemId: 'snacks', qty: 2 },
    { itemId: 'water_bottle', qty: 1 },
  ]);
  addContainer('cabinet', 'Storekeeper Counter', 33, 34, 'village', 1.6, [
    { itemId: 'ammo_38', qty: 6 },
  ]);

  // 4. Hawthorne Cottage (tx 7..17, ty 62..72)
  buildShell(
    'Hawthorne Cottage',
    'village',
    7,
    62,
    11,
    11,
    TileType.WALL_EXTERIOR,
    TileType.WOOD_FLOOR
  );
  setTile(12, 62, TileType.DOOR_CLOSED);
  fillTiles(11, 59, 3, 3, TileType.DIRT_PATH);
  setTile(17, 67, TileType.DOOR_CLOSED);
  fillTiles(18, 66, 2, 3, TileType.DIRT_PATH);
  setTile(9, 62, TileType.WINDOW);
  addProp('bed', 8, 69, 2, 2);
  addDecal('blood_pool', 13.5, 67.5, 0.4, 1.1);
  addProp('corpse', 13, 67, 1, 1, false, false, false);
  addContainer('cabinet', 'Cottage Pantry', 8, 64, 'village', 1.5);
  addContainer('dresser', 'Oak Nightstand', 15, 70, 'village', 1.6);

  // 5. St. Agnes Country Chapel (tx 24..35, ty 62..73)
  buildShell(
    'St. Agnes Chapel',
    'village',
    24,
    62,
    12,
    12,
    TileType.WALL_BRICK,
    TileType.TILE_FLOOR
  );
  setTile(29, 62, TileType.DOOR_OPEN);
  fillTiles(28, 59, 3, 3, TileType.DIRT_PATH);
  setTile(24, 67, TileType.DOOR_CLOSED);
  fillTiles(23, 66, 1, 3, TileType.DIRT_PATH);
  addProp('table', 26, 65, 3, 1);
  addProp('table', 31, 65, 3, 1);
  addProp('table', 26, 69, 3, 1);
  addProp('table', 31, 69, 3, 1);
  addContainer('survivor_pack', 'Evacuee Chapel Pack', 30, 71, 'village', 1.8, [
    { itemId: 'painkillers', qty: 1 },
    { itemId: 'flare', qty: 1 },
  ]);

  // Village Outskirt Carnage near F45 Entrance
  addDecal('skid_mark', 35.5, 56.0, 0.12, 1.0);
  addDecal('blood_pool', 35.2, 57.4, 1.1, 1.2);
  addProp('corpse', 35, 57, 1, 1, false, false, false);

  // =========================================================================
  // ZONE B: HIGHWAY F45 — STRAIGHT CARNAGE CORRIDOR TO CITY (tx 38..94)
  // =========================================================================
  fillTiles(38, 0, 57, H, TileType.GRASS);
  fillDistrict(38, 1, 57, H - 2, 'road_f45');

  // Unbroken North & South Guardrails locking player onto straight Highway F45!
  for (let x = 38; x <= 94; x++) {
    setTile(x, 51, TileType.FENCE);
    setTile(x, 52, TileType.DIRT_PATH); // North gravel shoulder
    for (let y = 53; y <= 59; y++) {
      setTile(x, y, TileType.ASPHALT); // Straight 7-tile Highway F45
    }
    setTile(x, 60, TileType.DIRT_PATH); // South gravel shoulder
    setTile(x, 61, TileType.FENCE);
  }

  // Dense dark forest flanking both sides of Highway F45
  for (let tx = 39; tx <= 93; tx += 3) {
    addProp('tree', tx, 46 + (tx % 3), 1, 1);
    addProp('tree', tx + 1, 41 + ((tx * 2) % 4), 1, 1);
    addProp('tree', tx, 63 + (tx % 3), 1, 1);
    addProp('tree', tx + 1, 68 + ((tx * 2) % 4), 1, 1);
  }

  // Highway F45 Stenciled Road Signs ("[ F45 -> ]")
  for (const signX of [40, 53, 66, 79, 91]) {
    addDecal('road_sign_f45', signX, 56.5, 0, 1);
  }

  // Highway Sodium Vapor Lamps
  for (let tx = 42; tx <= 92; tx += 12) {
    streetLights.push({
      x: tx * T + T / 2,
      y: 52 * T + T / 2,
      radius: 185,
      flickerSeed: tx * 3.7,
    });
  }

  // Highway F45 Multi-Vehicle Pileups, Skid Marks, Scorch Soot, Blood Pools & Dead Bodies
  // Carefully staggered across north (52..53), center (55..56), and south (58..59) lanes so walkable gaps >= 3 tiles always remain!

  // Crash 1 (tx 41..44, North lane)
  addDecal('skid_mark', 40.2, 54.0, -0.18, 1.1);
  addDecal('scorch_mark', 42.2, 53.8, 0, 1.1);
  addProp('car_wreck', 41, 52, 3, 2);
  addContainer('car_trunk', 'Wrecked Sedan Trunk', 44, 53, 'road_f45', 1.8, [
    { itemId: 'bandage', qty: 2 },
  ]);
  addDecal('blood_pool', 42.5, 54.8, 0.3, 1.25);
  addDecal('blood_drag', 43.4, 55.2, 0.5, 1.0);
  addProp('corpse', 43, 55, 1, 1, false, false, false);
  addProp('corpse', 40, 54, 1, 1, false, false, false);

  // Crash 2 (tx 46..49, South lane)
  addDecal('skid_mark', 45.0, 58.5, 0.22, 1.2);
  addProp('car_wreck', 46, 58, 3, 2);
  addDecal('blood_pool', 47.5, 57.3, 1.7, 1.3);
  addDecal('blood_pool', 49.6, 59.4, 0.8, 1.0);
  addProp('corpse', 47, 57, 1, 1, false, false, false);
  addProp('corpse', 49, 59, 1, 1, false, false, false);

  // Crash 3 (tx 51..54, Center Highway Patrol Blockade)
  addDecal('skid_mark', 50.2, 55.6, -0.1, 1.1);
  addProp('police_car', 51, 55, 3, 2);
  addContainer('car_trunk', 'State Trooper Trunk', 54, 55, 'road_f45', 2.0, [
    { itemId: 'ammo_9mm', qty: 8 },
    { itemId: 'flare', qty: 2 },
  ]);
  addDecal('blood_pool', 52.3, 57.6, 2.1, 1.35);
  addDecal('blood_drag', 53.5, 53.6, -0.35, 1.1);
  addProp('corpse', 52, 57, 1, 1, false, false, false);
  addProp('corpse', 54, 53, 1, 1, false, false, false);

  // Crash 4 (tx 56..59, North shoulder) + Crash 5 (tx 58..62, South jackknifed Semi-Truck)
  addDecal('scorch_mark', 57.4, 53.2, 0, 1.2);
  addProp('car_wreck', 56, 52, 3, 2);
  addDecal('skid_mark', 56.8, 58.6, 0.14, 1.4);
  addProp('semi_truck', 58, 58, 4, 2);
  addContainer('storage_crate', 'Spilled Convoy Crate', 62, 59, 'road_f45', 2.0, [
    { itemId: 'ration_bar', qty: 2 },
    { itemId: 'powerbank', qty: 1 },
  ]);
  addDecal('blood_pool', 58.2, 56.8, 0.9, 1.4);
  addDecal('blood_pool', 60.8, 57.2, 2.4, 1.2);
  addProp('corpse', 58, 56, 1, 1, false, false, false);
  addProp('corpse', 60, 57, 1, 1, false, false, false);
  addProp('corpse', 56, 54, 1, 1, false, false, false);

  // Crash 6 (tx 64..67, North-Center lane)
  addDecal('skid_mark', 63.2, 54.2, -0.25, 1.15);
  addDecal('scorch_mark', 65.5, 54.0, 0, 1.15);
  addProp('car_wreck', 64, 53, 3, 2);
  addDecal('blood_drag', 66.2, 55.6, 0.4, 1.2);
  addDecal('blood_pool', 67.5, 56.2, 1.2, 1.3);
  addProp('corpse', 67, 56, 1, 1, false, false, false);
  addProp('corpse', 65, 58, 1, 1, false, false, false);

  // Crash 7 (tx 69..72, South-Center lane)
  addProp('car', 69, 57, 3, 2);
  addContainer('car_trunk', 'Evacuee SUV Trunk', 72, 57, 'road_f45', 1.9, [
    { itemId: 'water_bottle', qty: 2 },
    { itemId: 'snacks', qty: 2 },
  ]);
  addDecal('blood_pool', 70.4, 56.2, 0.6, 1.2);
  addProp('corpse', 70, 56, 1, 1, false, false, false);

  // Crash 8 (tx 74..77, North CDC Quarantine Ambulance + Triage Gurney + Spore Leak)
  addDecal('skid_mark', 73.0, 53.5, -0.15, 1.2);
  addProp('ambulance', 74, 52, 3, 2);
  addProp('gurney', 75, 54, 2, 1);
  addContainer('car_trunk', 'F45 Ambulance Trauma Bay', 77, 53, 'road_f45', 2.0, [
    { itemId: 'painkillers', qty: 2 },
    { itemId: 'antiseptic', qty: 1 },
    { itemId: 'bandage', qty: 2 },
  ]);
  addDecal('blood_pool', 74.8, 55.6, 1.9, 1.45);
  addDecal('blood_pool', 77.2, 55.2, 0.4, 1.2);
  addDecal('blood_drag', 76.0, 56.5, 0.7, 1.1);
  addProp('corpse', 74, 55, 1, 1, false, false, false);
  addProp('corpse', 77, 55, 1, 1, false, false, false);
  addProp('corpse', 76, 58, 1, 1, false, false, false);
  sporeZones.push({
    id: nextId('spore'),
    x: 75.5 * T,
    y: 52.8 * T,
    radius: 48,
    intensity: 0.48,
    permanent: true,
    remainingTime: 9999,
    activeAfterHour: 0,
  });

  // Crash 9 (tx 80..83, South lane pileup)
  addDecal('scorch_mark', 81.5, 59.0, 0, 1.3);
  addProp('car_wreck', 80, 58, 3, 2);
  addDecal('blood_pool', 81.2, 57.1, 2.5, 1.35);
  addDecal('blood_drag', 82.8, 56.5, -0.4, 1.15);
  addProp('corpse', 81, 57, 1, 1, false, false, false);
  addProp('corpse', 83, 56, 1, 1, false, false, false);

  // Crash 10 (tx 85..88, North Police Barricade) & Crash 11 (tx 89..92, South Pickup)
  addDecal('skid_mark', 84.2, 54.0, 0.2, 1.1);
  addProp('police_car', 85, 52, 3, 2);
  setTile(86, 55, TileType.BARRICADE);
  addDecal('blood_pool', 86.5, 56.8, 1.1, 1.4);
  addProp('corpse', 86, 56, 1, 1, false, false, false);
  addProp('corpse', 88, 53, 1, 1, false, false, false);

  addDecal('scorch_mark', 90.5, 59.0, 0, 1.2);
  addProp('car_wreck', 89, 58, 3, 2);
  addContainer('toolbox', 'Wrecked Pickup Bed', 92, 59, 'road_f45', 1.9, [
    { itemId: 'pistol', qty: 1 },
    { itemId: 'ammo_9mm', qty: 8 },
  ]);
  addDecal('blood_pool', 90.2, 57.1, 0.5, 1.3);
  addDecal('blood_pool', 93.4, 55.6, 1.8, 1.25);
  addProp('corpse', 90, 57, 1, 1, false, false, false);
  addProp('corpse', 93, 55, 1, 1, false, false, false);

  // =========================================================================
  // ZONE C: QUARANTINE CITY (East: tx 95..215, ty 0..91, offset OX = 92)
  // =========================================================================
  fillTiles(95, 0, W - 95, H, TileType.ALLEY);

  // District regions inside Quarantine City
  fillDistrict(96, 60, 27, 31, 'residential');
  fillDistrict(96, 32, 27, 21, 'supermarket');
  fillDistrict(96, 1, 27, 24, 'hospital');
  fillDistrict(OX + 38, 60, 31, 31, 'commercial');
  fillDistrict(OX + 38, 32, 31, 21, 'pharmacy');
  fillDistrict(OX + 38, 1, 25, 24, 'parking');
  fillDistrict(OX + 64, 1, 29, 24, 'stadium');
  fillDistrict(OX + 98, 1, 25, 24, 'rooftop');
  fillDistrict(OX + 76, 32, 26, 21, 'police');
  fillDistrict(OX + 102, 32, 21, 21, 'industrial');
  fillDistrict(OX + 76, 60, 47, 31, 'military_base');

  // City Main Roads & Sidewalks
  const paintCityHStreet = (yStart: number) => {
    fillTiles(96, yStart, W - 97, 1, TileType.SIDEWALK);
    fillTiles(96, yStart + 1, W - 97, 5, TileType.ASPHALT);
    fillTiles(96, yStart + 6, W - 97, 1, TileType.SIDEWALK);
  };
  const paintCityVStreet = (xStart: number, y0 = 1, h = H - 2) => {
    fillTiles(xStart, y0, 1, h, TileType.SIDEWALK);
    fillTiles(xStart + 1, y0, 5, h, TileType.ASPHALT);
    fillTiles(xStart + 6, y0, 1, h, TileType.SIDEWALK);
  };

  paintCityHStreet(25); // North Ave (ty 25..31)
  paintCityHStreet(53); // Central Blvd (ty 53..59) — direct continuation of Highway F45!
  paintCityVStreet(OX + 31); // West St (tx 123..129)
  paintCityVStreet(OX + 69, 25, H - 26); // Mid-East Ave (tx 161..167)
  // Narrow North Connector St between Stadium and Meridian Tower (tx 185..189)
  fillTiles(OX + 93, 1, 1, 25, TileType.SIDEWALK);
  fillTiles(OX + 94, 1, 3, 25, TileType.ASPHALT);
  fillTiles(OX + 97, 1, 1, 25, TileType.SIDEWALK);

  // Clean asphalt intersections
  fillTiles(OX + 32, 26, 5, 5, TileType.ASPHALT);
  fillTiles(OX + 70, 26, 5, 5, TileType.ASPHALT);
  fillTiles(OX + 94, 26, 3, 5, TileType.ASPHALT);
  fillTiles(OX + 32, 54, 5, 5, TileType.ASPHALT);
  fillTiles(OX + 70, 54, 5, 5, TileType.ASPHALT);

  // Quarantine City Western Perimeter Wall (tx = 95) — ONLY open at Highway F45 Gate (ty 53..59)!
  for (let y = 0; y < H; y++) {
    if (y < 53 || y > 59) {
      setTile(95, y, TileType.WALL_EXTERIOR);
    } else if (y === 53 || y === 59) {
      setTile(95, y, TileType.SIDEWALK);
    } else {
      setTile(95, y, TileType.ASPHALT);
    }
  }
  streetLights.push({
    x: 96 * T + T / 2,
    y: 53 * T + T / 2,
    radius: 185,
    flickerSeed: 63.1,
    emergencyOnly: true,
  });

  // City Streetlights
  for (let tx = 100; tx < W - 6; tx += 12) {
    if ((tx >= OX + 31 && tx <= OX + 37) || (tx >= OX + 69 && tx <= OX + 75)) continue;
    streetLights.push({
      x: tx * T + T / 2,
      y: 25 * T + T / 2,
      radius: 175,
      flickerSeed: Math.random() * 100,
    });
    streetLights.push({
      x: tx * T + T / 2,
      y: 59 * T + T / 2,
      radius: 175,
      flickerSeed: Math.random() * 100,
    });
  }
  for (let ty = 8; ty < H - 6; ty += 12) {
    if ((ty >= 25 && ty <= 31) || (ty >= 53 && ty <= 59)) continue;
    streetLights.push({
      x: (OX + 31) * T + T / 2,
      y: ty * T + T / 2,
      radius: 170,
      flickerSeed: Math.random() * 100,
    });
    if (ty > 31) {
      streetLights.push({
        x: (OX + 75) * T + T / 2,
        y: ty * T + T / 2,
        radius: 170,
        flickerSeed: Math.random() * 100,
      });
    }
  }

  // ---------------------------------------------------------
  // 1. OAKWOOD SUBURBS (SW City: tx 96..122, ty 60..89)
  // ---------------------------------------------------------
  fillTiles(96, 60, 27, 30, TileType.GRASS);
  fillTiles(96, 73, 27, 2, TileType.SIDEWALK);
  fillTiles(109, 60, 2, 30, TileType.SIDEWALK);

  buildShell('104 Oakwood House', 'residential', 97, 76, 11, 11, TileType.WALL_EXTERIOR, TileType.WOOD_FLOOR);
  addInternalWallV(102, 76, 11, 5);
  setTile(104, 76, TileType.DOOR_CLOSED);
  setTile(99, 76, TileType.WINDOW);
  setTile(107, 81, TileType.WINDOW);
  addProp('bed', 98, 83, 2, 2);
  addProp('table', 104, 81, 2, 2);
  addContainer('dresser', 'Bedroom Dresser', 98, 77, 'residential', 1.5);
  addContainer('fridge', 'Suburb Fridge', 106, 85, 'residential', 1.6);

  buildShell('212 Oakwood Residence', 'residential', 111, 76, 11, 11, TileType.WALL_EXTERIOR, TileType.WOOD_FLOOR);
  addInternalWallH(111, 81, 11, 4);
  setTile(114, 76, TileType.DOOR_CLOSED);
  setTile(121, 79, TileType.DOOR_CLOSED);
  addProp('bed', 118, 83, 2, 2);
  addContainer('fridge', 'Family Fridge', 112, 77, 'residential', 1.7);
  addContainer('dresser', 'Master Wardrobe', 119, 82, 'residential', 1.8);

  buildShell('105 Oakwood Cottage', 'residential', 97, 61, 11, 10, TileType.WALL_BRICK, TileType.WOOD_FLOOR);
  setTile(100, 70, TileType.DOOR_CLOSED);
  setTile(104, 61, TileType.DOOR_CLOSED);
  addProp('bed', 98, 63, 2, 2);
  addContainer('cabinet', 'Pantry Cupboard', 105, 68, 'residential', 1.6);

  buildShell('Oakwood Corner Duplex', 'residential', 111, 61, 11, 10, TileType.WALL_BRICK, TileType.TILE_FLOOR);
  setTile(113, 70, TileType.DOOR_CLOSED);
  setTile(119, 61, TileType.DOOR_CLOSED);
  addContainer('fridge', 'Duplex Fridge', 119, 68, 'residential', 1.7);
  addContainer('toolbox', 'Porch Toolbox', 117, 62, 'residential', 1.9);

  // ---------------------------------------------------------
  // 2. COMMERCIAL DISTRICT (tx 130..160, ty 60..89)
  // ---------------------------------------------------------
  fillTiles(OX + 38, 60, 31, 30, TileType.ALLEY);
  buildShell('Redline Diner', 'commercial', OX + 39, 61, 13, 10, TileType.WALL_BRICK, TileType.CHECKER_FLOOR);
  setTile(OX + 43, 61, TileType.DOOR_CLOSED);
  setTile(OX + 39, 66, TileType.DOOR_CLOSED);
  setTile(OX + 51, 65, TileType.DOOR_CLOSED);
  setTile(OX + 46, 61, TileType.WINDOW);
  addProp('counter', OX + 41, 65, 6, 1);
  addContainer('fridge', 'Commercial Walk-In', OX + 49, 68, 'commercial', 2.0);
  addContainer('cabinet', 'Cashier Counter', OX + 41, 68, 'commercial', 1.6);

  buildShell('Mercer Hardware', 'commercial', OX + 39, 75, 13, 11, TileType.WALL_EXTERIOR, TileType.CONCRETE_FLOOR);
  setTile(OX + 39, 79, TileType.DOOR_CLOSED);
  setTile(OX + 45, 75, TileType.DOOR_CLOSED);
  addProp('shelf_block', OX + 42, 78, 4, 1);
  addProp('shelf_block', OX + 42, 81, 4, 1);
  addContainer('toolbox', 'Hardware Rack', OX + 49, 77, 'commercial', 2.0);
  addContainer('storage_crate', 'Electronics Stock', OX + 49, 83, 'commercial', 2.1);

  buildShell('Mercer Financial Suite', 'commercial', OX + 55, 61, 13, 11, TileType.WALL_EXTERIOR, TileType.TILE_FLOOR);
  addInternalWallV(OX + 61, 61, 11, 5);
  setTile(OX + 58, 61, TileType.DOOR_CLOSED);
  setTile(OX + 67, 66, TileType.DOOR_CLOSED);
  addProp('table', OX + 57, 65, 2, 2);
  addContainer('desk', 'Executive Desk', OX + 64, 63, 'commercial', 1.7);
  addContainer('cabinet', 'Breakroom Cabinet', OX + 65, 69, 'commercial', 1.6);

  buildShell('Night Owl Bodega', 'commercial', OX + 55, 76, 13, 10, TileType.WALL_BRICK, TileType.TILE_FLOOR);
  setTile(OX + 67, 80, TileType.DOOR_CLOSED);
  setTile(OX + 60, 76, TileType.DOOR_CLOSED);
  addProp('shelf_block', OX + 58, 79, 5, 1);
  addContainer('supermarket_shelf', 'Bodega Snack Rack', OX + 57, 83, 'commercial', 1.7);
  addContainer('fridge', 'Beverage Cooler', OX + 65, 83, 'commercial', 1.7);

  // ---------------------------------------------------------
  // 3. SUPERMARKET (West-Central City: tx 96..122, ty 32..52)
  // ---------------------------------------------------------
  fillTiles(96, 32, 27, 21, TileType.CONCRETE_FLOOR);
  buildShell('Mercer Fresh Mart', 'supermarket', 97, 34, 24, 17, TileType.WALL_EXTERIOR, TileType.CHECKER_FLOOR);
  addInternalWallV(104, 34, 17, 4);
  addInternalWallH(97, 43, 8, 3);
  setTile(120, 41, TileType.DOOR_OPEN);
  setTile(120, 42, TileType.DOOR_CLOSED);
  setTile(112, 50, TileType.DOOR_CLOSED);
  setTile(97, 38, TileType.DOOR_CLOSED);
  setTile(120, 37, TileType.WINDOW);
  setTile(120, 46, TileType.WINDOW);
  addProp('shelf_block', 107, 37, 8, 1);
  addProp('shelf_block', 107, 41, 8, 1);
  addProp('shelf_block', 107, 45, 8, 1);
  addProp('counter', 117, 38, 1, 3);
  addProp('counter', 117, 44, 1, 3);
  addContainer('supermarket_shelf', 'Canned Goods Aisle', 108, 36, 'supermarket', 1.9);
  addContainer('supermarket_shelf', 'Dry Rations Shelf', 113, 40, 'supermarket', 1.9);
  addContainer('supermarket_shelf', 'Bottled Water Pallet', 109, 44, 'supermarket', 1.8);
  addContainer('supermarket_shelf', 'Checkout Rack', 118, 48, 'supermarket', 1.4);
  addContainer('fridge', 'Butcher Cold Locker', 99, 36, 'supermarket', 2.1);

  // ---------------------------------------------------------
  // 4. PHARMACY & PLAZA (Center City: tx 130..160, ty 32..52)
  // ---------------------------------------------------------
  fillTiles(OX + 38, 32, 31, 21, TileType.SIDEWALK);
  buildShell('Vale Apothecary', 'pharmacy', OX + 39, 36, 17, 15, TileType.WALL_EXTERIOR, TileType.TILE_FLOOR);
  addInternalWallH(OX + 39, 41, 17, 12);
  setTile(OX + 46, 50, TileType.DOOR_CLOSED);
  setTile(OX + 39, 45, TileType.DOOR_CLOSED);
  setTile(OX + 44, 36, TileType.DOOR_CLOSED);
  setTile(OX + 42, 50, TileType.WINDOW);
  addProp('counter', OX + 48, 43, 6, 1);
  addProp('shelf_block', OX + 41, 44, 4, 1);
  addProp('shelf_block', OX + 41, 47, 4, 1);
  addContainer('pharmacy_shelf', 'First-Aid Aisle', OX + 42, 43, 'pharmacy', 1.8);
  addContainer('pharmacy_shelf', 'Analgesics Display', OX + 43, 48, 'pharmacy', 1.8);
  addContainer('medical_cabinet', 'Dispensary Vault', OX + 53, 38, 'pharmacy', 2.4, [
    { itemId: 'antiseptic', qty: 1 },
    { itemId: 'bandage', qty: 2 },
  ]);

  addProp('ambulance', OX + 59, 45, 3, 2);
  addProp('crate', OX + 64, 37, 2, 2);
  addProp('corpse', OX + 61, 41, 1, 1, false, false, false);
  addContainer('survivor_pack', 'CDC Field Trunk', OX + 63, 40, 'pharmacy', 2.3);

  // ---------------------------------------------------------
  // 5. ST. JUDE MEMORIAL HOSPITAL (NW City: tx 96..122, ty 2..24)
  //    Contains:
  //    - Bio-Containment Antiviral Station (NE Room: tx 116, ty 7)
  //    - Hospital Emergency Radio Room (NW Room: tx 102, ty 6)
  // ---------------------------------------------------------
  fillTiles(96, 2, 27, 23, TileType.CONCRETE_FLOOR);
  buildShell(
    'St. Jude Memorial Hospital',
    'hospital',
    97,
    3,
    25,
    19,
    TileType.WALL_HOSPITAL,
    TileType.HOSPITAL_FLOOR
  );
  // Horizontal ward corridor wall at ty=13 with wide double doors into both North Rooms
  addInternalWallH(97, 13, 25, 17);
  setTile(103, 13, TileType.DOOR_CLOSED);
  setTile(104, 13, TileType.DOOR_CLOSED);
  setTile(114, 13, TileType.DOOR_OPEN);
  setTile(115, 13, TileType.DOOR_OPEN);
  // Vertical wall separating NW Radio Room (98..108) and NE Antiviral Bio-Room (110..120)
  addInternalWallV(109, 3, 11, 5);
  setTile(109, 8, TileType.DOOR_CLOSED);
  setTile(109, 9, TileType.DOOR_CLOSED);
  // South ward partition
  addInternalWallV(105, 13, 9, 4);
  setTile(105, 18, TileType.DOOR_OPEN);

  // Hospital Main Entrances
  setTile(110, 21, TileType.DOOR_OPEN);
  setTile(111, 21, TileType.DOOR_OPEN);
  setTile(121, 17, TileType.DOOR_CLOSED);
  setTile(101, 21, TileType.WINDOW);
  setTile(117, 21, TileType.WINDOW);

  // Emergency Hospital Backup Lighting (stays lit even after 1:00 AM blackout!)
  streetLights.push(
    { x: 110 * T, y: 17 * T, radius: 155, flickerSeed: 13.7, emergencyOnly: true },
    { x: 116 * T, y: 8 * T, radius: 155, flickerSeed: 41.2, emergencyOnly: true },
    { x: 103 * T, y: 8 * T, radius: 155, flickerSeed: 52.8, emergencyOnly: true }
  );

  // NE Room: Bio-Containment & Antiviral Injection Station!
  addProp('antiviral_station', 116, 6, 2, 1, true, true, false);
  const hospitalInjectionPos = { x: 117 * T, y: 6.5 * T };
  addContainer('medical_cabinet', 'ICU Bio-Cabinet', 119, 5, 'hospital', 2.4, [
    { itemId: 'antiviral', qty: 1 },
    { itemId: 'medkit', qty: 1 },
  ]);
  addContainer('medical_cabinet', 'Surgical Supply', 111, 5, 'hospital', 2.2);

  // NW Room: Hospital Emergency Radio & Dispatch Room!
  addProp('hospital_radio', 102, 6, 2, 1, true, true, false);
  const hospitalRadioPos = { x: 103 * T, y: 6.5 * T };
  addContainer('desk', 'Hospital Dispatch Desk', 99, 5, 'hospital', 1.6, [
    { itemId: 'powerbank', qty: 2 },
    { itemId: 'flare', qty: 1 },
  ]);

  // Hospital ER Lobby props & trauma lockers
  addProp('gurney', 99, 16, 2, 1);
  addProp('gurney', 99, 19, 2, 1);
  addProp('counter', 112, 16, 5, 1);
  addProp('ambulance', 117, 22, 3, 2);
  addDecal('blood_pool', 109.5, 18.2, 0.7, 1.3);
  addProp('corpse', 108, 18, 1, 1, false, false, false);
  addContainer('medical_cabinet', 'ER Trauma Locker', 119, 15, 'hospital', 2.2, [
    { itemId: 'medkit', qty: 1 },
  ]);
  addContainer('pharmacy_shelf', 'Ward Nurse Cart', 99, 14, 'hospital', 1.8);

  // ---------------------------------------------------------
  // 6. POLICE STATION & 7. INDUSTRIAL YARD (East-Central: tx 168..214, ty 32..52)
  // ---------------------------------------------------------
  fillTiles(OX + 76, 32, 26, 21, TileType.ASPHALT);
  buildShell('Precinct 14 Station', 'police', OX + 78, 34, 22, 15, TileType.WALL_BRICK, TileType.TILE_FLOOR);
  addInternalWallH(OX + 78, 41, 22, 11);
  addInternalWallV(OX + 88, 34, 8, 4);
  setTile(OX + 78, 45, TileType.DOOR_CLOSED);
  setTile(OX + 89, 48, TileType.DOOR_CLOSED);
  setTile(OX + 90, 48, TileType.DOOR_CLOSED);
  setTile(OX + 83, 48, TileType.WINDOW);
  setTile(OX + 95, 48, TileType.WINDOW);

  streetLights.push({
    x: (OX + 89) * T,
    y: 44 * T,
    radius: 145,
    flickerSeed: 77.3,
    emergencyOnly: true,
  });

  addProp('counter', OX + 81, 44, 5, 1);
  addProp('police_car', OX + 80, 50, 3, 2);
  addProp('police_car', OX + 93, 50, 3, 2);
  addContainer('police_locker', 'Armory Rack A', OX + 80, 36, 'police', 2.6, [
    { itemId: 'pistol', qty: 1 },
    { itemId: 'ammo_9mm', qty: 12 },
  ]);
  addContainer('police_locker', 'Riot Locker B', OX + 84, 36, 'police', 2.8, [
    { itemId: 'shotgun', qty: 1 },
    { itemId: 'ammo_12g', qty: 6 },
  ]);
  addContainer('police_locker', 'Patrol Gear Locker', OX + 86, 39, 'police', 2.3);
  addContainer('car_trunk', 'Cruiser #14 Trunk', OX + 83, 50, 'police', 2.1);

  fillTiles(OX + 102, 32, 21, 21, TileType.CONCRETE_FLOOR);
  buildShell('Southgate Foundry', 'industrial', OX + 104, 34, 17, 14, TileType.WALL_EXTERIOR, TileType.CONCRETE_FLOOR);
  setTile(OX + 104, 41, TileType.DOOR_OPEN);
  setTile(OX + 112, 47, TileType.DOOR_CLOSED);
  addProp('crate', OX + 107, 37, 2, 2);
  addProp('crate', OX + 115, 42, 2, 2);
  addContainer('toolbox', 'Machinist Chest', OX + 106, 45, 'industrial', 2.0, [
    { itemId: 'crowbar', qty: 1 },
    { itemId: 'powerbank', qty: 2 },
  ]);
  addContainer('storage_crate', 'Industrial Fuel Crate', OX + 117, 36, 'industrial', 2.2, [
    { itemId: 'fuel_canister', qty: 1 },
  ]);

  // ---------------------------------------------------------
  // EXTRACTION LANDMARK 1: CIVIC PARKING LOT (North-Central City)
  // ---------------------------------------------------------
  buildShell(
    'Civic Parking Plaza',
    'parking',
    OX + 39,
    3,
    23,
    21,
    TileType.WALL_EXTERIOR,
    TileType.CONCRETE_FLOOR,
    false,
    false
  );
  fillTiles(OX + 48, 22, 5, 4, TileType.RAMP);
  setTile(OX + 39, 13, TileType.DOOR_OPEN);
  setTile(OX + 61, 13, TileType.DOOR_OPEN);

  streetLights.push({
    x: (OX + 50) * T,
    y: 13 * T,
    radius: 155,
    flickerSeed: 55.1,
    emergencyOnly: true,
  });

  addProp('car', OX + 41, 4, 3, 2);
  addContainer('car_trunk', 'Sedan Trunk', OX + 44, 4, 'parking', 2.0);
  addProp('car', OX + 55, 4, 3, 2);
  addContainer('car_trunk', 'SUV Cargo Bay', OX + 58, 4, 'parking', 2.1, [
    { itemId: 'fuel_canister', qty: 1 },
  ]);
  addProp('car', OX + 41, 20, 3, 2);
  addProp('police_car', OX + 55, 20, 3, 2);
  addContainer('car_trunk', 'Patrol Cruiser Trunk', OX + 58, 20, 'parking', 2.2);

  // ---------------------------------------------------------
  // EXTRACTION LANDMARK 2: CIVIC MEMORIAL STADIUM (North-East City)
  // ---------------------------------------------------------
  buildShell(
    'Civic Memorial Stadium',
    'stadium',
    OX + 65,
    3,
    27,
    21,
    TileType.WALL_EXTERIOR,
    TileType.CONCRETE_FLOOR,
    false,
    false
  );
  fillTiles(OX + 68, 5, 21, 17, TileType.STADIUM_TURF);
  fillTiles(OX + 76, 23, 5, 2, TileType.SIDEWALK);
  setTile(OX + 65, 13, TileType.DOOR_OPEN);
  setTile(OX + 91, 13, TileType.DOOR_OPEN);

  streetLights.push({
    x: (OX + 78) * T,
    y: 13 * T,
    radius: 175,
    flickerSeed: 29.4,
    emergencyOnly: true,
  });

  addProp('crate', OX + 66, 6, 2, 2);
  addProp('crate', OX + 89, 6, 2, 2);
  addProp('gurney', OX + 70, 19, 2, 1);
  addContainer('survivor_pack', 'Stadium Triage Duffel', OX + 67, 19, 'stadium', 2.0, [
    { itemId: 'medkit', qty: 1 },
    { itemId: 'water_bottle', qty: 2 },
  ]);
  addContainer('storage_crate', 'Evacuation Relief Crate', OX + 89, 19, 'stadium', 2.1, [
    { itemId: 'flare', qty: 2 },
    { itemId: 'ration_bar', qty: 2 },
  ]);

  // ---------------------------------------------------------
  // EXTRACTION LANDMARK 3: MERIDIAN TOWER ROOFTOP (Far NE City)
  // ---------------------------------------------------------
  fillTiles(OX + 98, 2, 24, 23, TileType.SIDEWALK);
  buildShell('Meridian Tower Lobby', 'rooftop', OX + 98, 14, 9, 10, TileType.WALL_EXTERIOR, TileType.TILE_FLOOR);
  setTile(OX + 98, 18, TileType.DOOR_OPEN);
  setTile(OX + 102, 23, TileType.DOOR_CLOSED);
  addContainer('desk', 'Tower Security Desk', OX + 104, 20, 'rooftop', 1.7);

  buildShell('Meridian Fire Stairwell', 'rooftop', OX + 100, 7, 7, 8, TileType.WALL_EXTERIOR, TileType.STAIRS);
  setTile(OX + 102, 14, TileType.STAIRS);
  setTile(OX + 103, 14, TileType.STAIRS);
  setTile(OX + 104, 14, TileType.STAIRS);

  buildShell(
    'Meridian Rooftop Deck',
    'rooftop',
    OX + 106,
    3,
    16,
    19,
    TileType.WALL_PARAPET,
    TileType.ROOFTOP_DECK,
    false,
    false
  );
  setTile(OX + 106, 9, TileType.DOOR_CLOSED);
  setTile(OX + 106, 10, TileType.DOOR_OPEN);
  addContainer('survivor_pack', 'Rooftop Evac Cache', OX + 108, 19, 'rooftop', 2.0, [
    { itemId: 'flare', qty: 2 },
    { itemId: 'bandage', qty: 2 },
  ]);

  // ---------------------------------------------------------
  // EXTRACTION LANDMARK 4: FORT VANGUARD MILITARY BASE (SE City)
  // ---------------------------------------------------------
  fillTiles(OX + 76, 60, 46, 30, TileType.CONCRETE_FLOOR);
  for (let x = OX + 77; x <= OX + 121; x++) {
    if (x < OX + 96 || x > OX + 100) setTile(x, 60, TileType.FENCE);
  }
  for (let y = 60; y <= 89; y++) {
    if (y < 71 || y > 74) setTile(OX + 77, y, TileType.FENCE);
  }
  setTile(OX + 79, 70, TileType.BARRICADE);
  setTile(OX + 79, 75, TileType.BARRICADE);
  setTile(OX + 95, 62, TileType.BARRICADE);
  setTile(OX + 101, 62, TileType.BARRICADE);

  streetLights.push({
    x: (OX + 98) * T,
    y: 64 * T,
    radius: 165,
    flickerSeed: 88.2,
    emergencyOnly: true,
  });

  buildShell('Vanguard Command Barracks', 'military_base', OX + 80, 63, 13, 9, TileType.WALL_EXTERIOR, TileType.CONCRETE_FLOOR);
  setTile(OX + 86, 71, TileType.DOOR_OPEN);
  setTile(OX + 92, 67, TileType.DOOR_CLOSED);
  addProp('table', OX + 82, 65, 3, 1);
  addContainer('police_locker', 'Base Armory Locker', OX + 82, 64, 'military_base', 2.5, [
    { itemId: 'ammo_9mm', qty: 12 },
    { itemId: 'ration_bar', qty: 2 },
  ]);
  addContainer('police_locker', 'Tactical Supply Rack', OX + 90, 64, 'military_base', 2.5);

  buildShell('Vanguard Field Infirmary', 'military_base', OX + 80, 77, 13, 10, TileType.WALL_EXTERIOR, TileType.TILE_FLOOR);
  setTile(OX + 86, 77, TileType.DOOR_CLOSED);
  setTile(OX + 92, 81, TileType.DOOR_OPEN);
  addProp('gurney', OX + 82, 80, 2, 1);
  addContainer('medical_cabinet', 'Military Trauma Chest', OX + 82, 84, 'military_base', 2.3, [
    { itemId: 'medkit', qty: 1 },
    { itemId: 'bandage', qty: 2 },
  ]);
  addContainer('storage_crate', 'Quartermaster Crate', OX + 90, 84, 'military_base', 2.1, [
    { itemId: 'fuel_canister', qty: 1 },
  ]);

  // =========================================================================
  // CANDIDATE 6:00 AM HELICOPTER EXTRACTION SITES (Revealed via Hospital Radio)
  // =========================================================================
  const allExtractionSites: ExtractionSiteDef[] = [
    {
      id: 'military_base',
      name: 'Fort Vanguard Military Base',
      shortName: 'Military Base',
      sectorLabel: 'Southeast City Sector',
      routeHint: 'Head south from St. Jude Hospital and travel east down Central Blvd into the fortified Military Airfield.',
      zoneBounds: { x: (OX + 103) * T, y: 69 * T, w: 10 * T, h: 10 * T },
      generatorPos: { x: (OX + 100) * T, y: 66 * T },
    },
    {
      id: 'stadium',
      name: 'Civic Memorial Stadium',
      shortName: 'Civic Stadium',
      sectorLabel: 'North-East City Sector',
      routeHint: 'Follow North Ave straight east from St. Jude Hospital and enter the Civic Stadium turnstiles onto the pitch.',
      zoneBounds: { x: (OX + 73) * T, y: 8 * T, w: 10 * T, h: 10 * T },
      generatorPos: { x: (OX + 70) * T, y: 6 * T },
    },
    {
      id: 'parking',
      name: 'Civic Parking Lot',
      shortName: 'Civic Parking',
      sectorLabel: 'North-Central City Sector',
      routeHint: 'Head east from St. Jude Hospital along North Ave and climb the south vehicle ramp onto the Parking Lot deck.',
      zoneBounds: { x: (OX + 45) * T, y: 8 * T, w: 10 * T, h: 10 * T },
      generatorPos: { x: (OX + 42) * T, y: 7 * T },
    },
    {
      id: 'rooftop',
      name: 'Meridian Tower Helipad (Rooftop Sector C)',
      shortName: 'Rooftop Sector C',
      sectorLabel: 'Rooftop Sector C · Northeast City',
      routeHint: 'Follow North Ave all the way east past the Stadium, enter Meridian Tower Lobby, and climb the stairwell to Rooftop Sector C.',
      zoneBounds: { x: (OX + 110) * T, y: 7 * T, w: 10 * T, h: 10 * T },
      generatorPos: { x: (OX + 108) * T, y: 5 * T },
    },
  ];

  const forcedSite = options?.forcedExtractionSiteId
    ? allExtractionSites.find((s) => s.id === options.forcedExtractionSiteId)
    : undefined;
  const activeExtractionSite =
    forcedSite ||
    allExtractionSites.find((s) => s.id === 'rooftop') ||
    allExtractionSites[0];

  const zb = activeExtractionSite.zoneBounds;
  fillTiles(
    Math.floor(zb.x / T),
    Math.floor(zb.y / T),
    Math.floor(zb.w / T),
    Math.floor(zb.h / T),
    TileType.HELIPAD
  );

  const genTx = Math.floor(activeExtractionSite.generatorPos.x / T) - 1;
  const genTy = Math.floor(activeExtractionSite.generatorPos.y / T) - 1;
  addProp('generator', genTx, genTy, 2, 2, true, true, false);

  // Randomized inner-city street barricades (strictly inside multi-route city avenues)
  const candidateBarricades: { x: number; y: number; horizontal: boolean }[] = [
    { x: OX + 70, y: 68, horizontal: true },
    { x: OX + 70, y: 42, horizontal: true },
    { x: OX + 52, y: 54, horizontal: false },
    { x: OX + 88, y: 54, horizontal: false },
    { x: OX + 52, y: 26, horizontal: false },
  ];
  const poolCopy = [...candidateBarricades];
  for (let i = poolCopy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [poolCopy[i], poolCopy[j]] = [poolCopy[j], poolCopy[i]];
  }
  const shuffled = poolCopy.slice(0, 2);
  for (const b of shuffled) {
    if (b.horizontal) {
      for (let dx = 0; dx < 5; dx++) setTile(b.x + dx, b.y, TileType.BARRICADE);
    } else {
      for (let dy = 0; dy < 5; dy++) setTile(b.x, b.y + dy, TileType.BARRICADE);
    }
  }

  // City Spore Zones (strictly outdoors so Hospital Bio-Ward & Radio Room remain safe sterile refuges!)
  sporeZones.push(
    {
      id: nextId('spore'),
      x: 96.4 * T,
      y: 11 * T,
      radius: 46,
      intensity: 0.65,
      permanent: true,
      remainingTime: 9999,
      activeAfterHour: 1,
    },
    {
      id: nextId('spore'),
      x: (OX + 53) * T,
      y: 72 * T,
      radius: 95,
      intensity: 0.9,
      permanent: true,
      remainingTime: 9999,
      activeAfterHour: 3,
    },
    {
      id: nextId('spore'),
      x: (OX + 96) * T,
      y: 56 * T,
      radius: 90,
      intensity: 0.85,
      permanent: true,
      remainingTime: 9999,
      activeAfterHour: 2,
    }
  );

  // Outer World Boundary Walls
  for (let x = 0; x < W; x++) {
    setTile(x, 0, TileType.WALL_EXTERIOR);
    setTile(x, H - 1, TileType.WALL_EXTERIOR);
  }
  for (let y = 0; y < H; y++) {
    setTile(0, y, TileType.WALL_EXTERIOR);
    setTile(W - 1, y, TileType.WALL_EXTERIOR);
  }

  // =========================================================================
  // SPAWN THE HOLLOW ACROSS VILLAGE, HIGHWAY F45 & QUARANTINE CITY
  // =========================================================================
  const spawnEnemy = (
    enemyClass: EnemyClass,
    tx: number,
    ty: number,
    patrolTiles?: [number, number][]
  ) => {
    if (isSolidTile(getTile(tx, ty))) return;
    const arch = ENEMY_ARCHETYPES[enemyClass];
    const sx = tx * T + T / 2;
    const sy = ty * T + T / 2;
    const waypoints =
      patrolTiles && patrolTiles.length > 0
        ? patrolTiles.map(([px, py]) => ({ x: px * T + T / 2, y: py * T + T / 2 }))
        : [{ x: sx, y: sy }];

    enemies.push({
      id: nextId('hlw'),
      enemyClass,
      x: sx,
      y: sy,
      vx: 0,
      vy: 0,
      angle: Math.random() * Math.PI * 2,
      radius: arch.radius,
      health: arch.maxHealth,
      maxHealth: arch.maxHealth,
      state: enemyClass === 'still' ? 'IDLE' : waypoints.length > 1 ? 'PATROL' : 'IDLE',
      stateTimer: 2 + Math.random() * 4,
      attackCooldown: 0,
      windupTimer: 0,
      hasDealtAttackHit: false,
      spawnPos: { x: sx, y: sy },
      patrolWaypoints: waypoints,
      waypointIndex: 0,
      lastKnownTarget: null,
      alertLevel: 0,
      hurtFlash: 0,
      animTime: Math.random() * 10,
      specialTimer: 1.5 + Math.random() * 4.5,
    });
  };

  // Oakhaven Countryside Village Infected
  spawnEnemy('crawler', 21, 39, [[21, 32], [21, 52]]);
  spawnEnemy('crawler', 31, 56, [[24, 56], [35, 56]]);
  spawnEnemy('still', 14, 66);

  // Highway F45 Carnage Gauntlet Infected (Stills disguised among real corpses + Crawlers + Ambulance Bloom + Gate Mimic!)
  spawnEnemy('crawler', 45, 56, [[42, 56], [50, 56]]);
  spawnEnemy('still', 49, 54);
  spawnEnemy('crawler', 55, 57, [[52, 53], [60, 55]]);
  spawnEnemy('still', 61, 56);
  spawnEnemy('crawler', 67, 57, [[63, 56], [71, 55]]);
  spawnEnemy('still', 73, 58);
  spawnEnemy('bloom', 76, 56, [[74, 56], [79, 56]]);
  spawnEnemy('crawler', 82, 55, [[79, 55], [87, 57]]);
  spawnEnemy('still', 84, 57);
  spawnEnemy('mimic', 91, 55, [[88, 54], [94, 57]]);

  // City West & Supermarket
  spawnEnemy('crawler', OX + 34, 78, [[OX + 34, 78], [OX + 34, 62]]);
  spawnEnemy('crawler', 115, 40, [[115, 36], [115, 47], [106, 47]]);
  spawnEnemy('still', 100, 40);

  // St. Jude Memorial Hospital (keep north Antiviral & Radio rooms free of Blooms)
  spawnEnemy('crawler', 109, 17, [[106, 16], [118, 18]]);
  spawnEnemy('crawler', 116, 18, [[112, 17], [119, 19]]);
  spawnEnemy('still', 101, 17);
  spawnEnemy('crawler', 125, 19, [[125, 12], [125, 28]]);

  // Commercial, Pharmacy, Police & Industrial
  spawnEnemy('crawler', OX + 53, 64, [[OX + 53, 62], [OX + 53, 84]]);
  spawnEnemy('mimic', OX + 63, 73, [[OX + 53, 73], [OX + 66, 73]]);
  spawnEnemy('crawler', OX + 60, 38, [[OX + 57, 35], [OX + 66, 48]]);
  spawnEnemy('bloom', OX + 65, 46, [[OX + 65, 46], [OX + 58, 48]]);
  spawnEnemy('crawler', OX + 84, 46, [[OX + 80, 46], [OX + 98, 46]]);
  spawnEnemy('mimic', OX + 72, 44, [[OX + 72, 34], [OX + 72, 52]]);
  spawnEnemy('crawler', OX + 110, 40, [[OX + 106, 39], [OX + 118, 44]]);

  // Extraction Landmarks Guards
  spawnEnemy('crawler', OX + 50, 13, [[OX + 44, 13], [OX + 57, 13]]);
  spawnEnemy('still', OX + 43, 10);
  spawnEnemy('crawler', OX + 76, 14, [[OX + 70, 10], [OX + 85, 16]]);
  spawnEnemy('bloom', OX + 72, 9, [[OX + 70, 8], [OX + 76, 10]]);
  spawnEnemy('crawler', OX + 114, 12, [[OX + 109, 8], [OX + 118, 16]]);
  spawnEnemy('crawler', OX + 98, 72, [[OX + 94, 66], [OX + 112, 78]]);
  spawnEnemy('crawler', OX + 108, 75, [[OX + 102, 68], [OX + 115, 81]]);
  spawnEnemy('mimic', OX + 114, 70, [[OX + 104, 65], [OX + 116, 82]]);

  // Tactical Map District & Landmark Markers (normalized 0..1 across 216x92)
  const mapMarkers: MapDistrictMarker[] = [
    { id: 'village', label: 'Oakhaven Village', nx: 18 / W, ny: 50 / H, isTargetLZ: false },
    { id: 'road_f45', label: 'Road F45', nx: 66 / W, ny: 56 / H, isTargetLZ: false },
    { id: 'hospital', label: 'St. Jude Hospital', nx: 109 / W, ny: 12 / H, isTargetLZ: false },
    { id: 'supermarket', label: 'Supermarket', nx: 109 / W, ny: 42 / H, isTargetLZ: false },
    { id: 'residential', label: 'Suburbs', nx: 109 / W, ny: 75 / H, isTargetLZ: false },
    { id: 'pharmacy', label: 'Pharmacy', nx: (OX + 50) / W, ny: 43 / H, isTargetLZ: false },
    { id: 'commercial', label: 'Commercial', nx: (OX + 53) / W, ny: 75 / H, isTargetLZ: false },
    { id: 'police', label: 'Police', nx: (OX + 89) / W, ny: 42 / H, isTargetLZ: false },
    { id: 'industrial', label: 'Industrial', nx: (OX + 112) / W, ny: 42 / H, isTargetLZ: false },
    {
      id: 'parking',
      label: 'Parking Lot',
      nx: (OX + 50) / W,
      ny: 13 / H,
      isTargetLZ: activeExtractionSite.id === 'parking',
      isLZCandidate: true,
    },
    {
      id: 'stadium',
      label: 'Stadium',
      nx: (OX + 78) / W,
      ny: 13 / H,
      isTargetLZ: activeExtractionSite.id === 'stadium',
      isLZCandidate: true,
    },
    {
      id: 'rooftop',
      label: 'Rooftop Sector C',
      nx: (OX + 115) / W,
      ny: 12 / H,
      isTargetLZ: activeExtractionSite.id === 'rooftop',
      isLZCandidate: true,
    },
    {
      id: 'military_base',
      label: 'Military Base',
      nx: (OX + 108) / W,
      ny: 74 / H,
      isTargetLZ: activeExtractionSite.id === 'military_base',
      isLZCandidate: true,
    },
  ];

  return {
    width: W,
    height: H,
    tiles,
    districts,
    rooms,
    containers,
    props,
    decals,
    streetLights,
    sporeZones,
    groundItems,
    enemies,
    playerStart: options?.spawnPos
      ? { x: options.spawnPos.x, y: options.spawnPos.y }
      : {
          x: 9 * T + T / 2,
          y: 46 * T + T / 2,
        },
    f45EntryPos: {
      x: 39 * T + T / 2,
      y: 56 * T + T / 2,
    },
    cityGatePos: {
      x: 96 * T + T / 2,
      y: 56 * T + T / 2,
    },
    hospitalInjectionPos,
    hospitalRadioPos,
    activeExtractionSite,
    allExtractionSites,
    mapMarkers,
  };
}
