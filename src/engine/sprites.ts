import { CONFIG } from '../config';
import { ENEMY_ARCHETYPES } from '../data/enemies';
import { ITEMS } from '../data/items';
import {
  ContainerEntity,
  EnemyEntity,
  GroundDecal,
  ObstacleProp,
  PlayerState,
  StreetLight,
  TileType,
} from '../types';

const TAU = Math.PI * 2;

/**
 * Wall-like tiles get a raised top surface, a front face and directional edge
 * shading. Ground tiles get soft contact shadows where they meet walls.
 */
const WALL_TYPES = new Set<TileType>([
  TileType.WALL_EXTERIOR,
  TileType.WALL_INTERIOR,
  TileType.WALL_BRICK,
  TileType.WALL_HOSPITAL,
  TileType.WALL_PARAPET,
  TileType.WINDOW,
  TileType.WINDOW_BROKEN,
  TileType.DOOR_CLOSED,
  TileType.DOOR_OPEN,
  TileType.BARRICADE,
]);

const isWallTile = (t: TileType) => WALL_TYPES.has(t);

/** Deterministic PRNG so baked art is stable between reloads. */
function rngFrom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash01(x: number, y: number): number {
  let h = (x | 0) * 374761393 + (y | 0) * 668265263;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Rounded rectangle path helper (keeps compatibility with older canvas impls). */
function rr(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const rad = Math.max(0, Math.min(r, Math.min(w, h) * 0.5));
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.lineTo(x + w - rad, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
  ctx.lineTo(x + w, y + h - rad);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
  ctx.lineTo(x + rad, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
  ctx.lineTo(x, y + rad);
  ctx.quadraticCurveTo(x, y, x + rad, y);
  ctx.closePath();
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export class SpriteAtlas {
  private tileCache = new Map<TileType, HTMLCanvasElement[]>();
  private wallFaceCache = new Map<TileType, HTMLCanvasElement>();
  private aoCache: HTMLCanvasElement[] = [];
  private wallEdgeCache: HTMLCanvasElement[] = [];

  constructor() {
    if (typeof document !== 'undefined') {
      this.bakeTiles();
      this.bakeContactShadows();
    }
  }

  public getTileCanvas(type: TileType, variant = 0): HTMLCanvasElement | undefined {
    const set = this.tileCache.get(type);
    if (!set) return undefined;
    return set[variant % set.length];
  }

  /** Stable per-tile variant index, so large floors do not look stamped. */
  public getTileVariant(tx: number, ty: number): number {
    return Math.floor(hash01(tx * 17 + 3, ty * 31 + 7) * 4);
  }

  private createCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    return [c, ctx];
  }

  private bakeContactShadows() {
    const T = CONFIG.TILE_SIZE;

    // Ground AO: mask bits N=1 E=2 S=4 W=8 for adjacent wall-like tiles.
    for (let mask = 0; mask < 16; mask++) {
      const [c, ctx] = this.createCanvas(T, T);
      const bands = 6;
      const depth = 13;
      for (let i = 0; i < bands; i++) {
        const a = 0.34 * Math.pow(1 - i / bands, 1.7);
        const d = depth / bands;
        ctx.fillStyle = `rgba(2, 4, 8, ${a.toFixed(3)})`;
        if (mask & 1) ctx.fillRect(0, i * d, T, d + 0.6);
        if (mask & 4) ctx.fillRect(0, T - (i + 1) * d, T, d + 0.6);
        if (mask & 8) ctx.fillRect(i * d, 0, d + 0.6, T);
        if (mask & 2) ctx.fillRect(T - (i + 1) * d, 0, d + 0.6, T);
      }
      this.aoCache[mask] = c;
    }

    // Raised-wall directional shading: open sides get a crisp lit rim on the
    // north and a deep cut shadow on the east/west flanks.
    for (let mask = 0; mask < 16; mask++) {
      const [c, ctx] = this.createCanvas(T, T);
      if (!(mask & 1)) {
        ctx.fillStyle = 'rgba(226, 232, 240, 0.11)';
        ctx.fillRect(0, 0, T, 2);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.12)';
        ctx.fillRect(0, 2, T, 2);
      }
      if (mask & 8) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.30)';
        ctx.fillRect(0, 0, 4, T);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.16)';
        ctx.fillRect(4, 0, 3, T);
      }
      if (mask & 2) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.24)';
        ctx.fillRect(T - 4, 0, 4, T);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.12)';
        ctx.fillRect(T - 7, 0, 3, T);
      }
      if (mask & 4) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
        ctx.fillRect(0, T - 3, T, 3);
      }
      this.wallEdgeCache[mask] = c;
    }
  }

  private bakeTiles() {
    const T = CONFIG.TILE_SIZE;

    const paint = (
      type: TileType,
      draw: (ctx: CanvasRenderingContext2D, rand: () => number, variant: number) => void,
      variants = 4
    ) => {
      const arr: HTMLCanvasElement[] = [];
      for (let v = 0; v < variants; v++) {
        const [c, ctx] = this.createCanvas(T, T);
        ctx.fillStyle = '#0a0d12';
        ctx.fillRect(0, 0, T, T);
        draw(ctx, rngFrom(0x1f123bb5 ^ (type * 7919) ^ (v * 104729)), v);
        arr.push(c);
      }
      this.tileCache.set(type, arr);
    };

    const speckle = (
      ctx: CanvasRenderingContext2D,
      rand: () => number,
      count: number,
      colors: string[],
      min = 1,
      max = 2
    ) => {
      for (let i = 0; i < count; i++) {
        ctx.fillStyle = colors[Math.floor(rand() * colors.length)];
        const s = min + Math.floor(rand() * (max - min + 1));
        ctx.fillRect(
          Math.floor(rand() * (T - s)),
          Math.floor(rand() * (T - s)),
          s,
          s
        );
      }
    };

    const grime = (ctx: CanvasRenderingContext2D, rand: () => number, alpha = 0.2) => {
      for (let i = 0; i < 3; i++) {
        const gx = rand() * T;
        const gy = rand() * T;
        const gr = 6 + rand() * 14;
        const g = ctx.createRadialGradient(gx, gy, 1, gx, gy, gr);
        g.addColorStop(0, `rgba(3, 5, 8, ${alpha})`);
        g.addColorStop(1, 'rgba(3, 5, 8, 0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(gx, gy, gr, 0, TAU);
        ctx.fill();
      }
    };

    const crack = (
      ctx: CanvasRenderingContext2D,
      rand: () => number,
      startX: number,
      startY: number,
      len: number,
      color = 'rgba(4, 6, 9, 0.85)'
    ) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      let x = startX;
      let y = startY;
      ctx.moveTo(x, y);
      for (let i = 0; i < len; i++) {
        x += (rand() - 0.5) * 12;
        y += 3 + rand() * 7;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    };

    // ── ASPHALT ────────────────────────────────────────────────────────────
    paint(TileType.ASPHALT, (ctx, rand, v) => {
      ctx.fillStyle = v % 2 === 0 ? '#151a21' : '#141920';
      ctx.fillRect(0, 0, T, T);
      speckle(ctx, rand, 120, ['#1d232c', '#101419', '#242b35', '#0b0e13'], 1, 2);
      // Faded tar patch
      if (v === 2) {
        ctx.fillStyle = 'rgba(11, 14, 19, 0.65)';
        rr(ctx, 4 + rand() * 8, 6 + rand() * 10, 16 + rand() * 10, 12 + rand() * 8, 5);
        ctx.fill();
      }
      if (v !== 1) crack(ctx, rand, rand() * T, -2, 5);
      grime(ctx, rand, 0.16);
      // Wet sheen catches the flashlight
      const sheen = ctx.createLinearGradient(0, T, T, 0);
      sheen.addColorStop(0, 'rgba(96, 125, 158, 0.05)');
      sheen.addColorStop(0.5, 'rgba(96, 125, 158, 0.015)');
      sheen.addColorStop(1, 'rgba(96, 125, 158, 0)');
      ctx.fillStyle = sheen;
      ctx.fillRect(0, 0, T, T);
    });

    // ── SIDEWALK ───────────────────────────────────────────────────────────
    paint(TileType.SIDEWALK, (ctx, rand, v) => {
      ctx.fillStyle = '#2a323d';
      ctx.fillRect(0, 0, T, T);
      const half = T / 2;
      for (let sy = 0; sy < 2; sy++) {
        for (let sx = 0; sx < 2; sx++) {
          const tint = 0.02 + rand() * 0.035;
          ctx.fillStyle = `rgba(255, 255, 255, ${tint.toFixed(3)})`;
          ctx.fillRect(sx * half + 1, sy * half + 1, half - 2, half - 2);
        }
      }
      ctx.strokeStyle = '#1a2028';
      ctx.lineWidth = 1;
      ctx.strokeRect(0.5, 0.5, T - 1, T - 1);
      ctx.beginPath();
      ctx.moveTo(half, 0);
      ctx.lineTo(half, T);
      ctx.moveTo(0, half);
      ctx.lineTo(T, half);
      ctx.stroke();
      speckle(ctx, rand, 34, ['#333c48', '#232a33', '#1d232b'], 1, 2);
      if (v === 3) crack(ctx, rand, 4, 2, 3);
      grime(ctx, rand, 0.14);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
      ctx.fillRect(0, 0, T, 1);
    });

    // ── ALLEY ──────────────────────────────────────────────────────────────
    paint(TileType.ALLEY, (ctx, rand, v) => {
      ctx.fillStyle = '#161a20';
      ctx.fillRect(0, 0, T, T);
      speckle(ctx, rand, 90, ['#202630', '#101419', '#252c36', '#0b0e12'], 1, 3);
      if (v !== 0) {
        const px = 6 + rand() * 20;
        const py = 8 + rand() * 18;
        const g = ctx.createRadialGradient(px, py, 2, px, py, 14);
        g.addColorStop(0, 'rgba(48, 66, 84, 0.22)');
        g.addColorStop(1, 'rgba(20, 28, 38, 0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.ellipse(px, py, 15, 8, rand() * 3, 0, TAU);
        ctx.fill();
      }
      // Scattered trash / grit
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.14)';
      ctx.lineWidth = 1;
      for (let i = 0; i < 4; i++) {
        const x = rand() * T;
        const y = rand() * T;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + 2 + rand() * 4, y + (rand() - 0.5) * 3);
        ctx.stroke();
      }
      grime(ctx, rand, 0.24);
    });

    // ── GRASS ──────────────────────────────────────────────────────────────
    paint(TileType.GRASS, (ctx, rand, v) => {
      ctx.fillStyle = v % 2 === 0 ? '#101d14' : '#0f1b13';
      ctx.fillRect(0, 0, T, T);
      // Patchy clumps
      for (let i = 0; i < 7; i++) {
        const gx = rand() * T;
        const gy = rand() * T;
        const gr = 5 + rand() * 10;
        const g = ctx.createRadialGradient(gx, gy, 1, gx, gy, gr);
        g.addColorStop(0, 'rgba(31, 56, 38, 0.5)');
        g.addColorStop(1, 'rgba(16, 29, 20, 0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(gx, gy, gr, 0, TAU);
        ctx.fill();
      }
      // Individual blades
      ctx.lineWidth = 1;
      for (let i = 0; i < 26; i++) {
        const x = rand() * T;
        const y = rand() * T;
        ctx.strokeStyle =
          i % 3 === 0 ? 'rgba(52, 88, 58, 0.55)' : 'rgba(28, 52, 34, 0.65)';
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + (rand() - 0.5) * 3, y - 2 - rand() * 4);
        ctx.stroke();
      }
      speckle(ctx, rand, 10, ['#2a3d2c', '#16251a', '#3a4a34'], 1, 2);
    });

    // ── DIRT PATH ──────────────────────────────────────────────────────────
    paint(TileType.DIRT_PATH, (ctx, rand, v) => {
      ctx.fillStyle = '#241d16';
      ctx.fillRect(0, 0, T, T);
      // Wheel ruts
      ctx.fillStyle = 'rgba(17, 13, 9, 0.42)';
      ctx.fillRect(0, 8 + (v % 2) * 3, T, 5);
      ctx.fillRect(0, 27 + (v % 2) * 3, T, 5);
      speckle(ctx, rand, 70, ['#34281f', '#1b1510', '#403124', '#2b2118'], 1, 2);
      // Pebbles
      ctx.fillStyle = 'rgba(168, 162, 158, 0.30)';
      for (let i = 0; i < 7; i++) {
        ctx.fillRect(rand() * T, rand() * T, 2, 1 + Math.floor(rand() * 2));
      }
      // Dry tufts
      ctx.strokeStyle = 'rgba(94, 96, 62, 0.4)';
      for (let i = 0; i < 3; i++) {
        const x = rand() * T;
        const y = rand() * T;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - 2, y - 4);
        ctx.moveTo(x, y);
        ctx.lineTo(x + 2, y - 5);
        ctx.stroke();
      }
    });

    // ── STADIUM TURF ───────────────────────────────────────────────────────
    paint(TileType.STADIUM_TURF, (ctx, rand, v) => {
      ctx.fillStyle = v % 2 === 0 ? '#15301f' : '#122a1b';
      ctx.fillRect(0, 0, T, T);
      ctx.fillStyle = v % 2 === 0 ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.05)';
      ctx.fillRect(0, 0, T / 2, T);
      speckle(ctx, rand, 50, ['#1d3d2c', '#0f2417', '#24462f'], 1, 2);
      // Mow line
      ctx.fillStyle = 'rgba(226, 232, 240, 0.07)';
      ctx.fillRect(0, 0, T, 1);
      ctx.strokeStyle = 'rgba(163, 230, 53, 0.08)';
      for (let i = 0; i < 12; i++) {
        const x = rand() * T;
        const y = rand() * T;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + 1, y - 2);
        ctx.stroke();
      }
    });

    // ── WOOD FLOOR ─────────────────────────────────────────────────────────
    paint(TileType.WOOD_FLOOR, (ctx, rand, v) => {
      ctx.fillStyle = '#37281d';
      ctx.fillRect(0, 0, T, T);
      const plankH = 10;
      for (let y = 0; y < T; y += plankH) {
        ctx.fillStyle = `rgba(0, 0, 0, ${0.10 + rand() * 0.12})`;
        ctx.fillRect(0, y, T, 1);
        ctx.fillStyle = `rgba(255, 220, 170, ${0.015 + rand() * 0.03})`;
        ctx.fillRect(0, y + 1, T, 1);
        // Grain
        ctx.strokeStyle = 'rgba(30, 20, 13, 0.35)';
        ctx.lineWidth = 1;
        const gy = y + 3 + rand() * 4;
        ctx.beginPath();
        ctx.moveTo(0, gy);
        ctx.bezierCurveTo(T * 0.3, gy + (rand() - 0.5) * 2, T * 0.7, gy + (rand() - 0.5) * 2, T, gy);
        ctx.stroke();
      }
      // Staggered joints
      for (let y = 0; y < T; y += plankH) {
        const jx = (Math.floor(y / plankH) % 2 === 0 ? 12 : 27) + (v % 2) * 4;
        ctx.fillStyle = '#241a12';
        ctx.fillRect(jx, y, 1, plankH);
      }
      speckle(ctx, rand, 12, ['#463326', '#2b1f16'], 1, 2);
      grime(ctx, rand, 0.18);
    });

    // ── TILE FLOOR ─────────────────────────────────────────────────────────
    paint(TileType.TILE_FLOOR, (ctx, rand, v) => {
      ctx.fillStyle = '#232b34';
      ctx.fillRect(0, 0, T, T);
      const half = T / 2;
      for (let sy = 0; sy < 2; sy++) {
        for (let sx = 0; sx < 2; sx++) {
          ctx.fillStyle = `rgba(255, 255, 255, ${(0.012 + rand() * 0.025).toFixed(3)})`;
          ctx.fillRect(sx * half + 1, sy * half + 1, half - 2, half - 2);
        }
      }
      ctx.strokeStyle = '#1b222a';
      ctx.lineWidth = 1;
      ctx.strokeRect(0.5, 0.5, T - 1, T - 1);
      ctx.beginPath();
      ctx.moveTo(half, 0);
      ctx.lineTo(half, T);
      ctx.moveTo(0, half);
      ctx.lineTo(T, half);
      ctx.stroke();
      if (v === 1) crack(ctx, rand, 10, 6, 3);
      speckle(ctx, rand, 14, ['#2c3540', '#1a2027'], 1, 2);
      grime(ctx, rand, 0.16);
    });

    // ── CHECKER FLOOR ──────────────────────────────────────────────────────
    paint(TileType.CHECKER_FLOOR, (ctx, rand, v) => {
      const cell = T / 4;
      for (let y = 0; y < 4; y++) {
        for (let x = 0; x < 4; x++) {
          ctx.fillStyle = (x + y + v) % 2 === 0 ? '#2b333d' : '#1d232b';
          ctx.fillRect(x * cell, y * cell, cell, cell);
        }
      }
      ctx.strokeStyle = 'rgba(8, 11, 15, 0.5)';
      ctx.lineWidth = 1;
      ctx.strokeRect(0.5, 0.5, T - 1, T - 1);
      speckle(ctx, rand, 20, ['rgba(255,255,255,0.05)', 'rgba(0,0,0,0.18)'], 1, 2);
      grime(ctx, rand, 0.22);
    });

    // ── CONCRETE FLOOR ─────────────────────────────────────────────────────
    paint(TileType.CONCRETE_FLOOR, (ctx, rand, v) => {
      ctx.fillStyle = '#20262e';
      ctx.fillRect(0, 0, T, T);
      speckle(ctx, rand, 70, ['#28303a', '#191e25', '#2d3540', '#14181e'], 1, 2);
      // Expansion joint
      ctx.fillStyle = 'rgba(8, 11, 15, 0.55)';
      ctx.fillRect(0, T - 1, T, 1);
      if (v % 2 === 0) ctx.fillRect(0, 0, 1, T);
      const stain = ctx.createRadialGradient(
        rand() * T,
        rand() * T,
        2,
        T * 0.5,
        T * 0.5,
        22
      );
      stain.addColorStop(0, 'rgba(10, 12, 15, 0.18)');
      stain.addColorStop(1, 'rgba(10, 12, 15, 0)');
      ctx.fillStyle = stain;
      ctx.fillRect(0, 0, T, T);
    });

    // ── HOSPITAL FLOOR ─────────────────────────────────────────────────────
    paint(TileType.HOSPITAL_FLOOR, (ctx, rand, v) => {
      ctx.fillStyle = '#2b3a3d';
      ctx.fillRect(0, 0, T, T);
      const half = T / 2;
      for (let sy = 0; sy < 2; sy++) {
        for (let sx = 0; sx < 2; sx++) {
          ctx.fillStyle = `rgba(160, 220, 220, ${(0.02 + rand() * 0.02).toFixed(3)})`;
          ctx.fillRect(sx * half + 1, sy * half + 1, half - 2, half - 2);
        }
      }
      ctx.strokeStyle = '#21302f';
      ctx.lineWidth = 1;
      ctx.strokeRect(0.5, 0.5, T - 1, T - 1);
      ctx.beginPath();
      ctx.moveTo(half, 0);
      ctx.lineTo(half, T);
      ctx.moveTo(0, half);
      ctx.lineTo(T, half);
      ctx.stroke();
      // Antiseptic sheen
      const sheen = ctx.createLinearGradient(0, 0, T, T);
      sheen.addColorStop(0, 'rgba(190, 245, 245, 0.045)');
      sheen.addColorStop(0.5, 'rgba(190, 245, 245, 0)');
      ctx.fillStyle = sheen;
      ctx.fillRect(0, 0, T, T);
      speckle(ctx, rand, 10, ['#33474a', '#243332'], 1, 2);
      grime(ctx, rand, 0.12);
    });

    // ── ROOFTOP DECK ───────────────────────────────────────────────────────
    paint(TileType.ROOFTOP_DECK, (ctx, rand, v) => {
      ctx.fillStyle = '#1b2027';
      ctx.fillRect(0, 0, T, T);
      speckle(ctx, rand, 100, ['#272f3a', '#14181e', '#2e3742', '#0e1116'], 1, 2);
      // Tar seams
      ctx.fillStyle = 'rgba(7, 9, 12, 0.55)';
      ctx.fillRect(0, 18, T, 2);
      if (v % 2 === 0) ctx.fillRect(24, 0, 2, T);
      // Standing water
      if (v !== 3) {
        const px = 8 + rand() * 18;
        const py = 24 + rand() * 10;
        const g = ctx.createRadialGradient(px, py, 1, px, py, 12);
        g.addColorStop(0, 'rgba(86, 116, 146, 0.20)');
        g.addColorStop(1, 'rgba(86, 116, 146, 0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.ellipse(px, py, 12, 6, 0.3, 0, TAU);
        ctx.fill();
      }
    });

    // ── HELIPAD ────────────────────────────────────────────────────────────
    paint(TileType.HELIPAD, (ctx, rand, v) => {
      ctx.fillStyle = '#1f2630';
      ctx.fillRect(0, 0, T, T);
      speckle(ctx, rand, 60, ['#28313d', '#171c23', '#313b48'], 1, 2);
      ctx.strokeStyle = 'rgba(245, 158, 11, 0.10)';
      ctx.lineWidth = 1;
      ctx.strokeRect(0.5, 0.5, T - 1, T - 1);
      // Weathering streaks
      ctx.fillStyle = 'rgba(0, 0, 0, 0.12)';
      for (let i = 0; i < 3; i++) ctx.fillRect(rand() * T, 0, 1, T);
    });

    // ── RAMP ───────────────────────────────────────────────────────────────
    paint(TileType.RAMP, (ctx, rand, v) => {
      ctx.fillStyle = '#222831';
      ctx.fillRect(0, 0, T, T);
      // Hazard edge rails
      ctx.fillStyle = 'rgba(234, 179, 8, 0.22)';
      ctx.fillRect(1, 0, 3, T);
      ctx.fillRect(T - 4, 0, 3, T);
      // Grip bars with lit top edge
      for (let y = 3; y < T; y += 7) {
        ctx.fillStyle = 'rgba(9, 12, 16, 0.75)';
        ctx.fillRect(6, y, T - 12, 3);
        ctx.fillStyle = 'rgba(148, 163, 184, 0.10)';
        ctx.fillRect(6, y, T - 12, 1);
      }
      speckle(ctx, rand, 20, ['#2b323c', '#171c22'], 1, 2);
    });

    // ── STAIRS ─────────────────────────────────────────────────────────────
    paint(TileType.STAIRS, (ctx, rand, v) => {
      ctx.fillStyle = '#29313d';
      ctx.fillRect(0, 0, T, T);
      for (let y = 0; y < T; y += 7) {
        ctx.fillStyle = '#1b212a';
        ctx.fillRect(0, y, T, 4);
        ctx.fillStyle = 'rgba(148, 163, 184, 0.14)';
        ctx.fillRect(0, y, T, 1);
      }
      // Handrail shadow
      ctx.fillStyle = 'rgba(6, 8, 11, 0.45)';
      ctx.fillRect(0, 0, 3, T);
      ctx.fillRect(T - 3, 0, 3, T);
      speckle(ctx, rand, 16, ['#343e4d', '#202730'], 1, 2);
    });

    // ── WALLS ──────────────────────────────────────────────────────────────
    const paintWall = (
      type: TileType,
      top: string,
      face: string,
      opts: { brick?: boolean; panel?: boolean; trim?: string } = {}
    ) => {
      paint(type, (ctx, rand, v) => {
        ctx.fillStyle = top;
        ctx.fillRect(0, 0, T, T);
        speckle(ctx, rand, 30, [
          'rgba(255, 255, 255, 0.035)',
          'rgba(0, 0, 0, 0.10)',
          'rgba(0, 0, 0, 0.05)',
        ], 1, 3);

        if (opts.brick) {
          const rowH = 8;
          for (let y = 0; y < T; y += rowH) {
            ctx.fillStyle = 'rgba(0, 0, 0, 0.26)';
            ctx.fillRect(0, y, T, 1);
            const off = Math.floor(y / rowH) % 2 === 0 ? 0 : 10;
            for (let x = off; x < T; x += 20) {
              ctx.fillRect(x, y, 1, rowH);
            }
          }
        } else if (opts.panel) {
          ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
          ctx.fillRect(0, 19, T, 1);
          ctx.fillRect(19, 0, 1, T);
          ctx.fillStyle = 'rgba(255, 255, 255, 0.045)';
          ctx.fillRect(0, 20, T, 1);
          ctx.fillRect(20, 0, 1, T);
        }

        if (opts.trim) {
          ctx.fillStyle = opts.trim;
          ctx.fillRect(0, T - 6, T, 2);
        }

        // Lit north rim + soft grime at the base
        ctx.fillStyle = 'rgba(226, 232, 240, 0.10)';
        ctx.fillRect(0, 0, T, 2);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
        ctx.fillRect(0, T - 4, T, 4);
        if (v === 2) {
          const gx = rand() * T;
          const g = ctx.createRadialGradient(gx, T - 2, 1, gx, T - 2, 16);
          g.addColorStop(0, 'rgba(0, 0, 0, 0.22)');
          g.addColorStop(1, 'rgba(0, 0, 0, 0)');
          ctx.fillStyle = g;
          ctx.fillRect(0, T - 20, T, 20);
        }
      });

      // Front face strip, only drawn when the tile south of this one is open.
      const FH = 12;
      const [fc, fctx] = this.createCanvas(T, FH);
      fctx.fillStyle = face;
      fctx.fillRect(0, 0, T, FH);
      const frand = rngFrom(0x51ed270b ^ type);
      if (opts.brick) {
        for (let y = 2; y < FH; y += 5) {
          fctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
          fctx.fillRect(0, y, T, 1);
          const off = (y * 3) % 13;
          for (let x = off; x < T; x += 15) {
            fctx.fillRect(x, y, 1, 4);
          }
        }
      } else {
        for (let x = 0; x < T; x += 13) {
          fctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
          fctx.fillRect(x, 2, 1, FH - 4);
        }
      }
      // Vertical water streaks
      for (let i = 0; i < 4; i++) {
        const sx = frand() * T;
        fctx.fillStyle = `rgba(0, 0, 0, ${0.05 + frand() * 0.10})`;
        fctx.fillRect(sx, 0, 1 + Math.floor(frand() * 2), FH);
      }
      fctx.fillStyle = 'rgba(0, 0, 0, 0.42)';
      fctx.fillRect(0, 0, T, 2);
      fctx.fillStyle = 'rgba(255, 255, 255, 0.06)';
      fctx.fillRect(0, 2, T, 1);
      fctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
      fctx.fillRect(0, FH - 3, T, 3);
      this.wallFaceCache.set(type, fc);
    };

    paintWall(TileType.WALL_EXTERIOR, '#3b4554', '#262d38', { panel: true });
    paintWall(TileType.WALL_INTERIOR, '#475261', '#303844', { panel: true });
    paintWall(TileType.WALL_BRICK, '#4b332e', '#33201c', { brick: true });
    paintWall(TileType.WALL_HOSPITAL, '#44585e', '#2c3b3f', { panel: true, trim: '#5d7a80' });
    paintWall(TileType.WALL_PARAPET, '#333c48', '#242b34', { trim: '#4b5666' });

    // Parapet cap highlight
    paint(TileType.WALL_PARAPET, (ctx, rand) => {
      ctx.fillStyle = '#333c48';
      ctx.fillRect(0, 0, T, T);
      ctx.fillStyle = '#4b5666';
      ctx.fillRect(3, 3, T - 6, T - 6);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.10)';
      ctx.fillRect(4, 4, T - 8, 2);
      ctx.strokeStyle = '#14181f';
      ctx.lineWidth = 1;
      ctx.strokeRect(0.5, 0.5, T - 1, T - 1);
      speckle(ctx, rand, 18, ['rgba(0,0,0,0.15)', 'rgba(255,255,255,0.04)'], 1, 2);
    });

    // ── WINDOWS ────────────────────────────────────────────────────────────
    const paintWindow = (type: TileType, broken: boolean) => {
      paint(type, (ctx, rand, v) => {
        ctx.fillStyle = '#3a4453';
        ctx.fillRect(0, 0, T, T);
        speckle(ctx, rand, 20, ['rgba(255,255,255,0.04)', 'rgba(0,0,0,0.12)'], 1, 2);
        // Recessed frame
        ctx.fillStyle = '#161c25';
        ctx.fillRect(5, 10, T - 10, T - 20);
        ctx.fillStyle = '#0c1119';
        ctx.fillRect(7, 12, T - 14, T - 24);
        // Glass
        const glass = ctx.createLinearGradient(7, 12, T - 7, T - 12);
        if (broken) {
          glass.addColorStop(0, '#13202a');
          glass.addColorStop(0.5, '#0a1219');
          glass.addColorStop(1, '#16252f');
        } else {
          glass.addColorStop(0, '#2a4658');
          glass.addColorStop(0.45, '#1a3040');
          glass.addColorStop(1, '#31536a');
        }
        ctx.fillStyle = glass;
        ctx.fillRect(7, 12, T - 14, T - 24);
        if (!broken) {
          // Moonlit reflection slash
          ctx.fillStyle = 'rgba(186, 230, 253, 0.20)';
          ctx.beginPath();
          ctx.moveTo(9, 14);
          ctx.lineTo(17, 12);
          ctx.lineTo(13, T - 13);
          ctx.lineTo(9, T - 13);
          ctx.closePath();
          ctx.fill();
          ctx.fillStyle = 'rgba(186, 230, 253, 0.10)';
          ctx.fillRect(20, 13, 3, T - 26);
        } else {
          // Jagged shards clinging to the frame
          ctx.fillStyle = 'rgba(186, 230, 253, 0.22)';
          for (let i = 0; i < 7; i++) {
            const sx = 7 + rand() * (T - 14);
            const sy = 12 + (i % 2 === 0 ? rand() * 4 : T - 16 - rand() * 4);
            ctx.beginPath();
            ctx.moveTo(sx, sy);
            ctx.lineTo(sx + 2 + rand() * 4, sy + (rand() - 0.5) * 6);
            ctx.lineTo(sx - 1, sy + 2 + rand() * 3);
            ctx.closePath();
            ctx.fill();
          }
          ctx.fillStyle = 'rgba(4, 7, 10, 0.6)';
          ctx.fillRect(12, 20, 9, 4);
        }
        // Frame mullions
        ctx.fillStyle = '#2b3441';
        ctx.fillRect(19, 12, 2, T - 24);
        ctx.fillRect(7, 24, T - 14, 2);
        ctx.strokeStyle = '#0a0e14';
        ctx.lineWidth = 1;
        ctx.strokeRect(6.5, 11.5, T - 13, T - 23);
        // Sill highlight
        ctx.fillStyle = 'rgba(226, 232, 240, 0.10)';
        ctx.fillRect(5, T - 10, T - 10, 1);
      });
      const FH = 12;
      const [fc, fctx] = this.createCanvas(T, FH);
      fctx.fillStyle = '#242b36';
      fctx.fillRect(0, 0, T, FH);
      fctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
      fctx.fillRect(0, 0, T, 3);
      fctx.fillStyle = '#38424f';
      fctx.fillRect(3, 5, T - 6, 2);
      fctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
      fctx.fillRect(0, FH - 3, T, 3);
      this.wallFaceCache.set(type, fc);
    };

    paintWindow(TileType.WINDOW, false);
    paintWindow(TileType.WINDOW_BROKEN, true);

    // ── DOORS (threshold base; leaf drawn dynamically for orientation) ──────
    const paintDoor = (type: TileType, open: boolean) => {
      paint(type, (ctx, rand) => {
        ctx.fillStyle = '#242b35';
        ctx.fillRect(0, 0, T, T);
        speckle(ctx, rand, 26, ['#2b333e', '#1b2129'], 1, 2);
        ctx.fillStyle = 'rgba(245, 158, 11, 0.10)';
        ctx.fillRect(3, 3, T - 6, T - 6);
        ctx.strokeStyle = 'rgba(8, 11, 15, 0.5)';
        ctx.lineWidth = 1;
        ctx.strokeRect(0.5, 0.5, T - 1, T - 1);
        if (open) {
          ctx.fillStyle = 'rgba(3, 5, 8, 0.45)';
          ctx.fillRect(6, 6, T - 12, T - 12);
        }
      });
      const FH = 12;
      const [fc, fctx] = this.createCanvas(T, FH);
      fctx.fillStyle = '#20262f';
      fctx.fillRect(0, 0, T, FH);
      fctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
      fctx.fillRect(0, FH - 4, T, 4);
      this.wallFaceCache.set(type, fc);
    };

    paintDoor(TileType.DOOR_CLOSED, false);
    paintDoor(TileType.DOOR_OPEN, true);

    // ── FENCE / GUARDRAIL ──────────────────────────────────────────────────
    paint(TileType.FENCE, (ctx, rand) => {
      // Transparent-ish base so terrain reads through the mesh
      ctx.fillStyle = 'rgba(9, 13, 18, 0.38)';
      ctx.fillRect(0, 0, T, T);
      // Chain-link diamonds
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.34)';
      ctx.lineWidth = 1;
      for (let i = -T; i < T * 2; i += 7) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i + T, T);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(i, T);
        ctx.lineTo(i + T, 0);
        ctx.stroke();
      }
      // Posts
      ctx.fillStyle = '#334155';
      ctx.fillRect(2, 0, 5, T);
      ctx.fillRect(T - 7, 0, 5, T);
      ctx.fillStyle = '#64748b';
      ctx.fillRect(2, 0, 2, T);
      ctx.fillRect(T - 7, 0, 2, T);
      // Top rail
      ctx.fillStyle = '#475569';
      ctx.fillRect(0, 2, T, 3);
      ctx.fillStyle = 'rgba(226, 232, 240, 0.25)';
      ctx.fillRect(0, 2, T, 1);
      speckle(ctx, rand, 10, ['rgba(0,0,0,0.2)'], 1, 2);
    });

    // ── BARRICADE ──────────────────────────────────────────────────────────
    paint(TileType.BARRICADE, (ctx, rand) => {
      ctx.fillStyle = '#161b22';
      ctx.fillRect(0, 0, T, T);
      // Jersey barrier body
      ctx.fillStyle = '#3f4754';
      rr(ctx, 2, 6, T - 4, T - 12, 3);
      ctx.fill();
      ctx.fillStyle = '#4d5665';
      rr(ctx, 4, 8, T - 8, 7, 2);
      ctx.fill();
      // Hazard chevrons
      ctx.save();
      ctx.beginPath();
      rr(ctx, 2, 6, T - 4, T - 12, 3);
      ctx.clip();
      ctx.fillStyle = 'rgba(217, 119, 6, 0.9)';
      for (let x = -T; x < T * 2; x += 16) {
        ctx.beginPath();
        ctx.moveTo(x, T);
        ctx.lineTo(x + 8, 6);
        ctx.lineTo(x + 16, 6);
        ctx.lineTo(x + 8, T);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
      // Cracks & rebar
      ctx.strokeStyle = 'rgba(10, 12, 16, 0.7)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(9, 12);
      ctx.lineTo(13, 20);
      ctx.lineTo(11, 28);
      ctx.stroke();
      ctx.strokeStyle = '#94a3b8';
      ctx.beginPath();
      ctx.moveTo(T - 8, 8);
      ctx.lineTo(T - 2, 4);
      ctx.stroke();
      speckle(ctx, rand, 14, ['rgba(255,255,255,0.05)', 'rgba(0,0,0,0.2)'], 1, 2);
      ctx.strokeStyle = '#090c10';
      ctx.lineWidth = 1.5;
      rr(ctx, 2, 6, T - 4, T - 12, 3);
      ctx.stroke();
    });
  }

  /**
   * Draws one terrain tile. `wallMask` bits describe adjacent wall-like tiles
   * (N=1 E=2 S=4 W=8) and are used for contact shadows and raised edges.
   */
  public drawTile(
    ctx: CanvasRenderingContext2D,
    type: TileType,
    px: number,
    py: number,
    variant: number,
    wallMask: number
  ) {
    const T = CONFIG.TILE_SIZE;
    const img = this.getTileCanvas(type, variant);
    if (img) ctx.drawImage(img, px, py);

    if (isWallTile(type)) {
      if (!(wallMask & 4)) {
        const face = this.wallFaceCache.get(type);
        if (face) ctx.drawImage(face, px, py + T - 12);
      }
      const edge = this.wallEdgeCache[wallMask & 15];
      if (edge) ctx.drawImage(edge, px, py);
    } else if (wallMask) {
      const ao = this.aoCache[wallMask & 15];
      if (ao) ctx.drawImage(ao, px, py);
    }
  }

  /** Oriented door leaf with a recessed frame and warm light leak. */
  public drawDoor(
    ctx: CanvasRenderingContext2D,
    type: TileType,
    px: number,
    py: number,
    vertical: boolean
  ) {
    const T = CONFIG.TILE_SIZE;
    const open = type === TileType.DOOR_OPEN;
    ctx.save();

    // Threshold slab
    ctx.fillStyle = '#242b35';
    ctx.fillRect(px, py, T, T);
    ctx.fillStyle = 'rgba(245, 158, 11, 0.10)';
    ctx.fillRect(px + 3, py + 3, T - 6, T - 6);
    ctx.strokeStyle = 'rgba(6, 9, 13, 0.65)';
    ctx.lineWidth = 1;
    ctx.strokeRect(px + 0.5, py + 0.5, T - 1, T - 1);

    if (vertical) {
      // Doorway runs north-south
      ctx.fillStyle = '#171d26';
      ctx.fillRect(px + 11, py + 1, 18, T - 2);
      if (open) {
        // Leaf swung inward, hugging the top of the frame
        ctx.fillStyle = '#5c3a23';
        rr(ctx, px + 13, py + 2, 6, T * 0.46, 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(251, 191, 36, 0.55)';
        ctx.fillRect(px + 16, py + T * 0.4, 2, 2);
        // Open gap glow
        const g = ctx.createLinearGradient(px + 18, py, px + 30, py);
        g.addColorStop(0, 'rgba(0, 0, 0, 0.45)');
        g.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = g;
        ctx.fillRect(px + 18, py + 3, 10, T - 6);
      } else {
        const g = ctx.createLinearGradient(px + 13, py, px + 27, py);
        g.addColorStop(0, '#6b442a');
        g.addColorStop(0.5, '#7a4f30');
        g.addColorStop(1, '#58351f');
        ctx.fillStyle = g;
        rr(ctx, px + 13, py + 2, 14, T - 4, 2);
        ctx.fill();
        ctx.strokeStyle = '#3d2515';
        ctx.lineWidth = 1;
        rr(ctx, px + 13.5, py + 2.5, 13, T - 5, 2);
        ctx.stroke();
        ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
        ctx.fillRect(px + 16, py + 9, 8, 1);
        ctx.fillRect(px + 16, py + 22, 8, 1);
        ctx.fillStyle = '#fbbf24';
        ctx.fillRect(px + 18, py + T - 12, 4, 4);
        // Light leak under the door
        ctx.fillStyle = 'rgba(251, 191, 36, 0.16)';
        ctx.fillRect(px + 13, py + T - 4, 14, 2);
      }
    } else {
      ctx.fillStyle = '#171d26';
      ctx.fillRect(px + 1, py + 11, T - 2, 18);
      if (open) {
        ctx.fillStyle = '#5c3a23';
        rr(ctx, px + 2, py + 13, T * 0.46, 6, 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(251, 191, 36, 0.55)';
        ctx.fillRect(px + T * 0.4, py + 16, 2, 2);
        const g = ctx.createLinearGradient(px, py + 18, px, py + 30);
        g.addColorStop(0, 'rgba(0, 0, 0, 0.45)');
        g.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = g;
        ctx.fillRect(px + 3, py + 18, T - 6, 10);
      } else {
        const g = ctx.createLinearGradient(px, py + 13, px, py + 27);
        g.addColorStop(0, '#6b442a');
        g.addColorStop(0.5, '#7a4f30');
        g.addColorStop(1, '#58351f');
        ctx.fillStyle = g;
        rr(ctx, px + 2, py + 13, T - 4, 14, 2);
        ctx.fill();
        ctx.strokeStyle = '#3d2515';
        ctx.lineWidth = 1;
        rr(ctx, px + 2.5, py + 13.5, T - 5, 13, 2);
        ctx.stroke();
        ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
        ctx.fillRect(px + 8, py + 16, 1, 8);
        ctx.fillRect(px + 22, py + 16, 1, 8);
        ctx.fillStyle = '#fbbf24';
        ctx.fillRect(px + T - 11, py + 18, 4, 4);
        ctx.fillStyle = 'rgba(251, 191, 36, 0.16)';
        ctx.fillRect(px + 2, py + T - 4, T - 4, 2);
      }
    }
    ctx.restore();
  }

  // ── GROUND DECALS ────────────────────────────────────────────────────────
  public drawDecal(ctx: CanvasRenderingContext2D, d: GroundDecal) {
    ctx.save();
    ctx.translate(d.x, d.y);
    ctx.rotate(d.angle);
    ctx.scale(d.scale, d.scale);
    const rand = rngFrom(0x2f9a3c17 ^ Math.floor(d.seed * 100000));

    switch (d.kind) {
      case 'blood_pool': {
        // Irregular pooled blood with a darker, wetter core.
        ctx.fillStyle = 'rgba(104, 20, 20, 0.70)';
        ctx.beginPath();
        const lobes = 7;
        for (let i = 0; i <= lobes; i++) {
          const a = (i / lobes) * TAU;
          const r = 13 + rand() * 8;
          const px = Math.cos(a) * r;
          const py = Math.sin(a) * r * 0.72;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = 'rgba(61, 8, 8, 0.85)';
        ctx.beginPath();
        ctx.ellipse(1, 1, 10, 7, 0.2, 0, TAU);
        ctx.fill();
        ctx.fillStyle = 'rgba(196, 60, 52, 0.30)';
        ctx.beginPath();
        ctx.ellipse(-3, -3, 6, 3.5, -0.4, 0, TAU);
        ctx.fill();
        // Spray droplets
        ctx.fillStyle = 'rgba(127, 29, 29, 0.72)';
        for (let i = 0; i < 9; i++) {
          const a = rand() * TAU;
          const r = 17 + rand() * 20;
          const s = 1 + rand() * 2.5;
          ctx.beginPath();
          ctx.arc(Math.cos(a) * r, Math.sin(a) * r * 0.8, s, 0, TAU);
          ctx.fill();
        }
        break;
      }
      case 'blood_drag': {
        // Smear from a body being hauled away
        const g = ctx.createLinearGradient(-30, 0, 30, 0);
        g.addColorStop(0, 'rgba(104, 20, 20, 0.10)');
        g.addColorStop(0.25, 'rgba(104, 20, 20, 0.52)');
        g.addColorStop(0.7, 'rgba(72, 12, 12, 0.66)');
        g.addColorStop(1, 'rgba(72, 12, 12, 0.10)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(-32, -4);
        ctx.quadraticCurveTo(-6, -6, 30, -2);
        ctx.quadraticCurveTo(34, 2, 28, 5);
        ctx.quadraticCurveTo(-4, 4, -32, 4);
        ctx.closePath();
        ctx.fill();
        // Streaks
        ctx.fillStyle = 'rgba(61, 8, 8, 0.55)';
        for (let i = 0; i < 5; i++) {
          const sy = -3 + rand() * 6;
          const sx = -24 + rand() * 40;
          ctx.fillRect(sx, sy, 5 + rand() * 12, 1 + rand());
        }
        break;
      }
      case 'skid_mark': {
        const drawTire = (offset: number) => {
          ctx.strokeStyle = 'rgba(6, 8, 12, 0.72)';
          ctx.lineWidth = 5;
          ctx.beginPath();
          ctx.moveTo(-40, offset - 3);
          ctx.quadraticCurveTo(-4, offset - 9, 38, offset + 2);
          ctx.stroke();
          ctx.strokeStyle = 'rgba(120, 130, 145, 0.10)';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(-38, offset - 5);
          ctx.quadraticCurveTo(-4, offset - 11, 36, offset);
          ctx.stroke();
        };
        drawTire(-10);
        drawTire(10);
        // Rubber speckle
        ctx.fillStyle = 'rgba(6, 8, 12, 0.4)';
        for (let i = 0; i < 14; i++) {
          ctx.fillRect(-36 + rand() * 72, -16 + rand() * 32, 1.5, 1.5);
        }
        break;
      }
      case 'scorch_mark': {
        const g = ctx.createRadialGradient(0, 0, 3, 0, 0, 34);
        g.addColorStop(0, 'rgba(5, 7, 10, 0.9)');
        g.addColorStop(0.45, 'rgba(16, 16, 19, 0.66)');
        g.addColorStop(0.75, 'rgba(30, 26, 24, 0.28)');
        g.addColorStop(1, 'rgba(30, 26, 24, 0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(0, 0, 34, 0, TAU);
        ctx.fill();
        // Charred streaks radiating out
        ctx.strokeStyle = 'rgba(10, 10, 12, 0.35)';
        for (let i = 0; i < 10; i++) {
          const a = rand() * TAU;
          const r0 = 6 + rand() * 8;
          const r1 = 18 + rand() * 18;
          ctx.lineWidth = 1 + rand() * 2;
          ctx.beginPath();
          ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
          ctx.lineTo(Math.cos(a) * r1, Math.sin(a) * r1);
          ctx.stroke();
        }
        break;
      }
      case 'road_sign_f45': {
        // Worn painted highway stencil
        ctx.globalAlpha = 0.72;
        ctx.fillStyle = 'rgba(234, 179, 8, 0.30)';
        rr(ctx, -34, -15, 68, 30, 3);
        ctx.fill();
        ctx.strokeStyle = 'rgba(234, 179, 8, 0.55)';
        ctx.lineWidth = 2;
        rr(ctx, -34, -15, 68, 30, 3);
        ctx.stroke();
        // Chipped paint
        ctx.fillStyle = 'rgba(12, 15, 20, 0.55)';
        for (let i = 0; i < 10; i++) {
          ctx.fillRect(-32 + rand() * 62, -13 + rand() * 26, 2 + rand() * 4, 1 + rand() * 2);
        }
        ctx.fillStyle = 'rgba(253, 230, 138, 0.85)';
        ctx.font = '700 14px "Barlow Condensed", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('F45  ➔', 0, 1);
        ctx.globalAlpha = 1;
        break;
      }
    }
    ctx.restore();
  }

  // ── PROPS ────────────────────────────────────────────────────────────────
  public drawProp(ctx: CanvasRenderingContext2D, p: ObstacleProp, timeSec = 0) {
    ctx.save();
    switch (p.kind) {
      case 'car':
        this.drawCar(ctx, p, 'civilian', timeSec);
        break;
      case 'police_car':
        this.drawCar(ctx, p, 'police', timeSec);
        break;
      case 'ambulance':
        this.drawCar(ctx, p, 'ambulance', timeSec);
        break;
      case 'car_wreck':
        this.drawWreck(ctx, p, timeSec);
        break;
      case 'semi_truck':
        this.drawSemi(ctx, p);
        break;
      case 'tree':
        this.drawTree(ctx, p, timeSec);
        break;
      case 'corpse':
        this.drawCorpse(ctx, p);
        break;
      case 'bed': {
        const { x, y, w, h } = p;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.42)';
        rr(ctx, x + 3, y + 4, w, h, 6);
        ctx.fill();
        // Wooden frame
        const frame = ctx.createLinearGradient(x, y, x, y + h);
        frame.addColorStop(0, '#5a3f2b');
        frame.addColorStop(1, '#3a281b');
        ctx.fillStyle = frame;
        rr(ctx, x, y, w, h, 6);
        ctx.fill();
        ctx.strokeStyle = '#2a1c12';
        ctx.lineWidth = 2;
        rr(ctx, x + 1, y + 1, w - 2, h - 2, 5);
        ctx.stroke();
        // Mattress
        ctx.fillStyle = '#8d949c';
        rr(ctx, x + 5, y + 5, w - 10, h - 10, 5);
        ctx.fill();
        ctx.fillStyle = '#a8b0b8';
        rr(ctx, x + 6, y + 6, w - 12, 12, 4);
        ctx.fill();
        // Pillow
        ctx.fillStyle = '#d7dde3';
        rr(ctx, x + 8, y + 9, 16, h - 18, 4);
        ctx.fill();
        ctx.fillStyle = 'rgba(0,0,0,0.12)';
        rr(ctx, x + 10, y + 13, 12, h - 26, 3);
        ctx.fill();
        // Blanket
        ctx.fillStyle = p.colorSeed > 0.6 ? '#5b3b3b' : p.colorSeed > 0.3 ? '#3c4a55' : '#4a4432';
        rr(ctx, x + w * 0.42, y + 5, w * 0.53, h - 10, 4);
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.22)';
        ctx.lineWidth = 1;
        for (let i = 1; i < 4; i++) {
          ctx.beginPath();
          ctx.moveTo(x + w * 0.42 + (w * 0.53 * i) / 4, y + 7);
          ctx.lineTo(x + w * 0.42 + (w * 0.53 * i) / 4, y + h - 7);
          ctx.stroke();
        }
        // Blood stain
        if (p.colorSeed > 0.72) {
          ctx.fillStyle = 'rgba(110, 22, 22, 0.6)';
          ctx.beginPath();
          ctx.ellipse(x + w * 0.62, y + h * 0.45, 9, 6, 0.3, 0, TAU);
          ctx.fill();
        }
        break;
      }
      case 'table': {
        const { x, y, w, h } = p;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
        rr(ctx, x + 3, y + 4, w, h, 4);
        ctx.fill();
        const g = ctx.createLinearGradient(x, y, x, y + h);
        g.addColorStop(0, '#6b4a31');
        g.addColorStop(0.5, '#563a26');
        g.addColorStop(1, '#3c2819');
        ctx.fillStyle = g;
        rr(ctx, x, y, w, h, 4);
        ctx.fill();
        ctx.strokeStyle = '#2c1d13';
        ctx.lineWidth = 1.5;
        rr(ctx, x + 0.75, y + 0.75, w - 1.5, h - 1.5, 4);
        ctx.stroke();
        // Grain + edge highlight
        ctx.strokeStyle = 'rgba(255, 220, 180, 0.10)';
        for (let i = 0; i < 4; i++) {
          const gy = y + 5 + (i * (h - 10)) / 4;
          ctx.beginPath();
          ctx.moveTo(x + 4, gy);
          ctx.bezierCurveTo(x + w * 0.35, gy - 1, x + w * 0.65, gy + 1, x + w - 4, gy);
          ctx.stroke();
        }
        ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.fillRect(x + 3, y + 2, w - 6, 1);
        // Clutter
        if (p.colorSeed > 0.55) {
          ctx.fillStyle = '#d6d3d1';
          ctx.fillRect(x + w * 0.2, y + h * 0.35, 10, 7);
          ctx.fillStyle = 'rgba(0,0,0,0.18)';
          ctx.fillRect(x + w * 0.2 + 1, y + h * 0.35 + 1, 8, 5);
        }
        if (p.colorSeed > 0.8) {
          ctx.fillStyle = '#3f3f46';
          ctx.beginPath();
          ctx.arc(x + w * 0.7, y + h * 0.55, 4, 0, TAU);
          ctx.fill();
          ctx.fillStyle = '#71717a';
          ctx.beginPath();
          ctx.arc(x + w * 0.7, y + h * 0.55, 2, 0, TAU);
          ctx.fill();
        }
        break;
      }
      case 'counter':
      case 'shelf_block': {
        const { x, y, w, h } = p;
        const shelf = p.kind === 'shelf_block';
        ctx.fillStyle = 'rgba(0, 0, 0, 0.42)';
        rr(ctx, x + 2, y + 4, w, h, 3);
        ctx.fill();
        const g = ctx.createLinearGradient(x, y, x, y + h);
        g.addColorStop(0, shelf ? '#39424f' : '#3e4755');
        g.addColorStop(1, shelf ? '#232a34' : '#28303a');
        ctx.fillStyle = g;
        rr(ctx, x, y, w, h, 3);
        ctx.fill();
        ctx.strokeStyle = '#12171d';
        ctx.lineWidth = 2;
        rr(ctx, x + 1, y + 1, w - 2, h - 2, 2);
        ctx.stroke();
        // Top sheen
        ctx.fillStyle = 'rgba(226, 232, 240, 0.09)';
        ctx.fillRect(x + 3, y + 3, w - 6, 2);
        if (shelf) {
          // Rows of stock
          for (let row = 0; row < 2; row++) {
            const ry = y + 7 + row * ((h - 12) / 2);
            for (let i = 0; i < Math.floor(w / 11); i++) {
              const hue = (i * 47 + row * 23 + Math.floor(p.colorSeed * 90)) % 5;
              ctx.fillStyle = ['#7f1d1d', '#854d0e', '#166534', '#1e3a5f', '#4c1d95'][hue];
              ctx.fillRect(x + 4 + i * 11, ry, 8, Math.max(4, (h - 16) / 2 - 3));
              ctx.fillStyle = 'rgba(255,255,255,0.10)';
              ctx.fillRect(x + 4 + i * 11, ry, 8, 1);
            }
          }
        } else {
          // Cash register / counter clutter
          ctx.fillStyle = '#1e293b';
          rr(ctx, x + w * 0.55, y + 4, Math.min(18, w * 0.3), 10, 2);
          ctx.fill();
          ctx.fillStyle = '#38bdf8';
          ctx.fillRect(x + w * 0.55 + 2, y + 6, 5, 3);
          ctx.fillStyle = 'rgba(148, 163, 184, 0.25)';
          ctx.fillRect(x + 5, y + h - 6, w - 10, 1);
        }
        break;
      }
      case 'hay_bale': {
        const { x, y, w, h } = p;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.38)';
        rr(ctx, x + 3, y + 4, w, h, 5);
        ctx.fill();
        const g = ctx.createLinearGradient(x, y, x, y + h);
        g.addColorStop(0, '#9a6a2c');
        g.addColorStop(0.5, '#83581f');
        g.addColorStop(1, '#5d3d13');
        ctx.fillStyle = g;
        rr(ctx, x, y, w, h, 5);
        ctx.fill();
        // Straw texture
        const rand = rngFrom(0x71ab3 ^ Math.floor(p.colorSeed * 99991));
        ctx.strokeStyle = 'rgba(224, 190, 110, 0.32)';
        ctx.lineWidth = 1;
        for (let i = 0; i < 26; i++) {
          const sx = x + rand() * w;
          const sy = y + rand() * h;
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.lineTo(sx + (rand() - 0.5) * 9, sy + (rand() - 0.5) * 3);
          ctx.stroke();
        }
        // Twine
        ctx.fillStyle = '#a16207';
        ctx.fillRect(x + w * 0.28, y, 3, h);
        ctx.fillRect(x + w * 0.68, y, 3, h);
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.fillRect(x + w * 0.28 + 3, y, 1, h);
        ctx.fillRect(x + w * 0.68 + 3, y, 1, h);
        ctx.strokeStyle = '#4a2f0d';
        ctx.lineWidth = 2;
        rr(ctx, x + 1, y + 1, w - 2, h - 2, 4);
        ctx.stroke();
        break;
      }
      case 'pillar': {
        const { x, y, w, h } = p;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.46)';
        ctx.fillRect(x + 3, y + 4, w, h);
        const g = ctx.createLinearGradient(x, y, x + w, y + h);
        g.addColorStop(0, '#5b6674');
        g.addColorStop(0.5, '#47515f');
        g.addColorStop(1, '#2e353f');
        ctx.fillStyle = g;
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = '#171c23';
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
        ctx.fillStyle = 'rgba(226, 232, 240, 0.10)';
        ctx.fillRect(x + 3, y + 3, w - 6, 2);
        ctx.strokeStyle = 'rgba(0,0,0,0.3)';
        ctx.beginPath();
        ctx.moveTo(x + w * 0.3, y + 4);
        ctx.lineTo(x + w * 0.5, y + h * 0.6);
        ctx.lineTo(x + w * 0.42, y + h - 4);
        ctx.stroke();
        break;
      }
      case 'gurney': {
        const { x, y, w, h } = p;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
        rr(ctx, x + 2, y + 4, w, h, 4);
        ctx.fill();
        // Frame
        ctx.fillStyle = '#4b5563';
        rr(ctx, x, y, w, h, 4);
        ctx.fill();
        ctx.fillStyle = '#94a3b8';
        rr(ctx, x + 2, y + 2, w - 4, h - 4, 3);
        ctx.fill();
        // Mattress
        ctx.fillStyle = '#c7d0d8';
        rr(ctx, x + 5, y + 5, w - 10, h - 10, 3);
        ctx.fill();
        ctx.fillStyle = 'rgba(0,0,0,0.10)';
        ctx.fillRect(x + 5, y + h - 9, w - 10, 3);
        // Straps
        ctx.fillStyle = '#334155';
        ctx.fillRect(x + w * 0.25, y + 2, 3, h - 4);
        ctx.fillRect(x + w * 0.7, y + 2, 3, h - 4);
        // Blood
        ctx.fillStyle = 'rgba(120, 24, 24, 0.7)';
        ctx.beginPath();
        ctx.ellipse(x + w * 0.52, y + h * 0.55, 10, 6, 0.4, 0, TAU);
        ctx.fill();
        ctx.fillStyle = 'rgba(60, 8, 8, 0.6)';
        ctx.beginPath();
        ctx.ellipse(x + w * 0.52, y + h * 0.55, 5, 3, 0.4, 0, TAU);
        ctx.fill();
        break;
      }
      case 'crate': {
        const { x, y, w, h } = p;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
        rr(ctx, x + 3, y + 4, w, h, 3);
        ctx.fill();
        ctx.fillStyle = '#4a3b2c';
        rr(ctx, x, y, w, h, 3);
        ctx.fill();
        // Slats
        const slat = h / 4;
        for (let i = 0; i < 4; i++) {
          ctx.fillStyle = i % 2 === 0 ? 'rgba(255, 220, 170, 0.06)' : 'rgba(0,0,0,0.14)';
          ctx.fillRect(x + 2, y + 2 + i * slat, w - 4, slat - 2);
        }
        ctx.strokeStyle = '#241a12';
        ctx.lineWidth = 2;
        rr(ctx, x + 1, y + 1, w - 2, h - 2, 2);
        ctx.stroke();
        // Corner brackets
        ctx.fillStyle = '#6b7280';
        for (const [cx, cy] of [
          [x + 2, y + 2],
          [x + w - 7, y + 2],
          [x + 2, y + h - 7],
          [x + w - 7, y + h - 7],
        ]) {
          ctx.fillRect(cx, cy, 5, 5);
        }
        // Stencil
        ctx.fillStyle = 'rgba(226, 232, 240, 0.28)';
        ctx.font = '700 8px "Barlow Condensed", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('SUPPLY', x + w / 2, y + h / 2 + 3);
        break;
      }
      case 'dumpster': {
        const { x, y, w, h } = p;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.48)';
        rr(ctx, x + 3, y + 5, w, h, 4);
        ctx.fill();
        const g = ctx.createLinearGradient(x, y, x, y + h);
        g.addColorStop(0, '#22483a');
        g.addColorStop(1, '#122a22');
        ctx.fillStyle = g;
        rr(ctx, x, y, w, h, 4);
        ctx.fill();
        // Lid
        ctx.fillStyle = '#2f5d49';
        rr(ctx, x + 2, y + 2, w - 4, h * 0.42, 3);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.08)';
        ctx.fillRect(x + 4, y + 4, w - 8, 2);
        // Side ribs
        ctx.strokeStyle = 'rgba(0,0,0,0.28)';
        for (let i = 1; i < 4; i++) {
          ctx.beginPath();
          ctx.moveTo(x + (w * i) / 4, y + h * 0.45);
          ctx.lineTo(x + (w * i) / 4, y + h - 4);
          ctx.stroke();
        }
        // Rust
        ctx.fillStyle = 'rgba(120, 53, 15, 0.45)';
        ctx.beginPath();
        ctx.ellipse(x + w * 0.72, y + h * 0.72, 7, 4, 0.4, 0, TAU);
        ctx.fill();
        // Trash bag
        ctx.fillStyle = '#111827';
        ctx.beginPath();
        ctx.ellipse(x + w * 0.28, y + h * 0.55, 7, 5, -0.3, 0, TAU);
        ctx.fill();
        ctx.fillStyle = 'rgba(148, 163, 184, 0.16)';
        ctx.beginPath();
        ctx.ellipse(x + w * 0.26, y + h * 0.53, 3, 2, -0.3, 0, TAU);
        ctx.fill();
        break;
      }
      case 'generator': {
        const { x, y, w, h } = p;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
        rr(ctx, x + 3, y + 4, w, h, 4);
        ctx.fill();
        const g = ctx.createLinearGradient(x, y, x, y + h);
        g.addColorStop(0, p.powered ? '#8a5a16' : '#4c5563');
        g.addColorStop(1, p.powered ? '#5c3a0c' : '#2c333d');
        ctx.fillStyle = g;
        rr(ctx, x, y, w, h, 4);
        ctx.fill();
        ctx.strokeStyle = '#11151b';
        ctx.lineWidth = 2;
        rr(ctx, x + 1, y + 1, w - 2, h - 2, 3);
        ctx.stroke();
        // Vent grille
        ctx.fillStyle = '#151a21';
        ctx.fillRect(x + 6, y + 6, w * 0.4, h - 12);
        ctx.fillStyle = 'rgba(148, 163, 184, 0.20)';
        for (let i = 0; i < 5; i++) {
          ctx.fillRect(x + 7, y + 8 + i * ((h - 16) / 5), w * 0.4 - 2, 1);
        }
        // Control panel
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(x + w * 0.55, y + 5, w * 0.36, h - 10);
        ctx.fillStyle = p.powered ? '#22c55e' : '#ef4444';
        ctx.beginPath();
        ctx.arc(x + w * 0.62, y + 11, 2.5, 0, TAU);
        ctx.fill();
        if (p.powered) {
          ctx.fillStyle = `rgba(34, 197, 94, ${0.25 + 0.2 * Math.sin(timeSec * 5)})`;
          ctx.beginPath();
          ctx.arc(x + w * 0.62, y + 11, 6, 0, TAU);
          ctx.fill();
        }
        // Fuel cap + cable
        ctx.fillStyle = '#0f172a';
        ctx.beginPath();
        ctx.arc(x + w * 0.76, y + h - 10, 3, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = '#0b0e13';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(x + w - 2, y + h * 0.5);
        ctx.quadraticCurveTo(x + w + 8, y + h * 0.7, x + w + 6, y + h + 6);
        ctx.stroke();
        break;
      }
      case 'antiviral_station': {
        const { x, y, w, h } = p;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
        rr(ctx, x + 2, y + 3, w, h, 3);
        ctx.fill();
        ctx.fillStyle = '#cbd5e1';
        rr(ctx, x, y, w, h, 3);
        ctx.fill();
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = 2;
        rr(ctx, x + 1, y + 1, w - 2, h - 2, 2);
        ctx.stroke();
        // Sterile tray
        ctx.fillStyle = '#0f172a';
        rr(ctx, x + 5, y + 5, w - 10, h - 10, 2);
        ctx.fill();
        // Serum vials
        for (let i = 0; i < 3; i++) {
          const vx = x + 10 + i * 11;
          ctx.fillStyle = p.used ? '#475569' : '#22d3ee';
          rr(ctx, vx, y + 9, 7, h - 18, 3);
          ctx.fill();
          ctx.fillStyle = p.used ? '#64748b' : '#a5f3fc';
          ctx.fillRect(vx + 1, y + 10, 2, h - 20);
        }
        // Medical cross
        ctx.fillStyle = '#dc2626';
        ctx.fillRect(x + w - 16, y + h / 2 - 2, 9, 4);
        ctx.fillRect(x + w - 13.5, y + h / 2 - 4.5, 4, 9);
        if (!p.used) {
          const pulse = 0.35 + 0.45 * Math.sin(timeSec * 4.5);
          ctx.strokeStyle = `rgba(34, 211, 238, ${pulse.toFixed(2)})`;
          ctx.lineWidth = 2;
          rr(ctx, x - 4, y - 4, w + 8, h + 8, 4);
          ctx.stroke();
          ctx.fillStyle = `rgba(34, 211, 238, ${(pulse * 0.5).toFixed(2)})`;
          ctx.beginPath();
          ctx.arc(x + w / 2, y + h / 2, 16, 0, TAU);
          ctx.fill();
        }
        break;
      }
      case 'hospital_radio': {
        const { x, y, w, h } = p;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
        rr(ctx, x + 2, y + 3, w, h, 3);
        ctx.fill();
        ctx.fillStyle = '#334155';
        rr(ctx, x, y, w, h, 3);
        ctx.fill();
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = 2;
        rr(ctx, x + 1, y + 1, w - 2, h - 2, 2);
        ctx.stroke();
        ctx.fillStyle = '#1e293b';
        rr(ctx, x + 5, y + 4, w - 10, h - 8, 2);
        ctx.fill();
        // Frequency display
        ctx.fillStyle = p.used ? '#10b981' : '#f59e0b';
        ctx.fillRect(x + 9, y + 8, 24, 7);
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        for (let i = 0; i < 4; i++) ctx.fillRect(x + 11 + i * 5, y + 9, 2, 5);
        // Knobs
        ctx.fillStyle = '#64748b';
        ctx.beginPath();
        ctx.arc(x + 12, y + h - 10, 3, 0, TAU);
        ctx.arc(x + 22, y + h - 10, 3, 0, TAU);
        ctx.fill();
        // Signal LED
        const blink = Math.sin(timeSec * 8) > 0;
        ctx.fillStyle = p.used ? '#22c55e' : blink ? '#ef4444' : '#7f1d1d';
        ctx.beginPath();
        ctx.arc(x + w - 12, y + 10, 3, 0, TAU);
        ctx.fill();
        if (!p.used) {
          ctx.fillStyle = blink ? 'rgba(239,68,68,0.25)' : 'rgba(239,68,68,0.08)';
          ctx.beginPath();
          ctx.arc(x + w - 12, y + 10, 7, 0, TAU);
          ctx.fill();
        }
        // Whip antenna
        ctx.strokeStyle = '#94a3b8';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x + w - 8, y + 4);
        ctx.lineTo(x + w + 5, y - 14);
        ctx.stroke();
        if (!p.used) {
          const pulse = 0.35 + 0.45 * Math.sin(timeSec * 4.2);
          ctx.strokeStyle = `rgba(245, 158, 11, ${pulse.toFixed(2)})`;
          ctx.lineWidth = 2;
          rr(ctx, x - 4, y - 4, w + 8, h + 8, 4);
          ctx.stroke();
        }
        break;
      }
    }
    ctx.restore();
  }

  private drawCar(
    ctx: CanvasRenderingContext2D,
    p: ObstacleProp,
    style: 'civilian' | 'police' | 'ambulance',
    timeSec: number
  ) {
    const { x, y, w, h } = p;
    const cy = y + h / 2;
    const rand = rngFrom(0x3c6ef372 ^ Math.floor(p.colorSeed * 999983));

    ctx.fillStyle = 'rgba(0, 0, 0, 0.52)';
    rr(ctx, x + 4, y + 6, w, h, 13);
    ctx.fill();

    // Wheels
    ctx.fillStyle = '#080b0f';
    for (const wy of [y - 1, y + h - 7]) {
      rr(ctx, x + 13, wy, 21, 8, 3);
      ctx.fill();
      rr(ctx, x + w - 34, wy, 21, 8, 3);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(148, 163, 184, 0.12)';
    for (const wy of [y - 1, y + h - 7]) {
      ctx.fillRect(x + 16, wy + 1, 15, 1);
      ctx.fillRect(x + w - 31, wy + 1, 15, 1);
    }

    const base =
      style === 'police'
        ? p.colorSeed > 0.5
          ? '#1c2b45'
          : '#232f3f'
        : style === 'ambulance'
        ? '#cfd8e0'
        : p.colorSeed > 0.62
        ? '#5b2525'
        : p.colorSeed > 0.34
        ? '#2b3a4d'
        : '#3a3f45';

    const body = ctx.createLinearGradient(0, y, 0, y + h);
    body.addColorStop(0, this.lighten(base, 0.16));
    body.addColorStop(0.45, base);
    body.addColorStop(1, this.lighten(base, -0.28));
    ctx.fillStyle = body;
    rr(ctx, x, y + 2, w, h - 4, 11);
    ctx.fill();
    ctx.strokeStyle = 'rgba(6, 9, 13, 0.75)';
    ctx.lineWidth = 1.5;
    rr(ctx, x + 0.75, y + 2.75, w - 1.5, h - 5.5, 11);
    ctx.stroke();

    // Hood and trunk panel seams
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + w * 0.22, y + 6);
    ctx.lineTo(x + w * 0.22, y + h - 6);
    ctx.moveTo(x + w * 0.78, y + 6);
    ctx.lineTo(x + w * 0.78, y + h - 6);
    ctx.stroke();

    // Cabin glass
    const glass = ctx.createLinearGradient(x + w * 0.3, y, x + w * 0.68, y + h);
    glass.addColorStop(0, '#2a3d4d');
    glass.addColorStop(0.5, '#0e1720');
    glass.addColorStop(1, '#1d2b37');
    ctx.fillStyle = glass;
    rr(ctx, x + w * 0.3, y + 9, w * 0.36, h - 18, 8);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 1;
    rr(ctx, x + w * 0.3, y + 9, w * 0.36, h - 18, 8);
    ctx.stroke();

    // Roof
    ctx.fillStyle = this.lighten(base, -0.12);
    rr(ctx, x + w * 0.36, y + 12, w * 0.23, h - 24, 5);
    ctx.fill();
    ctx.fillStyle = 'rgba(226, 232, 240, 0.10)';
    ctx.fillRect(x + w * 0.37, y + 13, w * 0.21, 1.5);

    // Windshield / rear glass sheen
    ctx.fillStyle = 'rgba(186, 230, 253, 0.16)';
    ctx.beginPath();
    ctx.moveTo(x + w * 0.6, y + 11);
    ctx.lineTo(x + w * 0.64, y + 11);
    ctx.lineTo(x + w * 0.55, y + h - 11);
    ctx.lineTo(x + w * 0.51, y + h - 11);
    ctx.closePath();
    ctx.fill();

    if (style === 'police') {
      // White door panels
      ctx.fillStyle = '#e2e8f0';
      rr(ctx, x + w * 0.2, y + 6, w * 0.1, h - 12, 2);
      ctx.fill();
      rr(ctx, x + w * 0.66, y + 6, w * 0.1, h - 12, 2);
      ctx.fill();
      ctx.fillStyle = '#1e293b';
      ctx.font = '700 9px "Barlow Condensed", sans-serif';
      ctx.textAlign = 'center';
      ctx.save();
      ctx.translate(x + w * 0.25, cy);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText('14', 0, 3);
      ctx.restore();
      // Light bar
      ctx.fillStyle = '#0f172a';
      rr(ctx, x + w * 0.4, y + 14, w * 0.12, h - 28, 2);
      ctx.fill();
      const pulse = 0.45 + 0.55 * Math.abs(Math.sin(timeSec * 5.5 + p.colorSeed * 6));
      ctx.fillStyle = `rgba(239, 68, 68, ${pulse.toFixed(2)})`;
      ctx.fillRect(x + w * 0.41, y + 15, w * 0.05, h - 30);
      ctx.fillStyle = `rgba(59, 130, 246, ${(1 - pulse).toFixed(2)})`;
      ctx.fillRect(x + w * 0.465, y + 15, w * 0.05, h - 30);
    } else if (style === 'ambulance') {
      // Red emergency stripe and cross
      ctx.fillStyle = '#b91c1c';
      ctx.fillRect(x + w * 0.18, cy - 3, w * 0.64, 6);
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(x + w * 0.44, cy - 10, 4, 20);
      ctx.fillRect(x + w * 0.38, cy - 4, 16, 8);
      // Light bar
      ctx.fillStyle = '#0f172a';
      rr(ctx, x + w * 0.4, y + 14, w * 0.12, h - 28, 2);
      ctx.fill();
      const pulse = 0.5 + 0.5 * Math.sin(timeSec * 6);
      ctx.fillStyle = `rgba(239, 68, 68, ${(0.4 + pulse * 0.5).toFixed(2)})`;
      ctx.fillRect(x + w * 0.41, y + 15, w * 0.05, h - 30);
    }

    // Headlights (front is +X)
    ctx.fillStyle = '#fef3c7';
    rr(ctx, x + w - 7, y + 11, 4, 11, 2);
    ctx.fill();
    rr(ctx, x + w - 7, y + h - 22, 4, 11, 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(254, 243, 199, 0.16)';
    ctx.beginPath();
    ctx.moveTo(x + w - 4, y + 12);
    ctx.lineTo(x + w + 12, y + 8);
    ctx.lineTo(x + w + 12, y + h - 8);
    ctx.lineTo(x + w - 4, y + h - 12);
    ctx.closePath();
    ctx.fill();
    // Taillights
    ctx.fillStyle = '#7f1d1d';
    rr(ctx, x - 1, y + 11, 3, 9, 1);
    ctx.fill();
    rr(ctx, x - 1, y + h - 20, 3, 9, 1);
    ctx.fill();

    // Bumpers
    ctx.fillStyle = '#11161d';
    rr(ctx, x + w - 3, y + 7, 3, h - 14, 1.5);
    ctx.fill();
    rr(ctx, x, y + 7, 3, h - 14, 1.5);
    ctx.fill();

    // Rust, grime, scratches
    ctx.fillStyle = 'rgba(120, 53, 15, 0.30)';
    for (let i = 0; i < 4; i++) {
      const rx = x + 10 + rand() * (w - 20);
      const ry = y + 6 + rand() * (h - 12);
      ctx.beginPath();
      ctx.ellipse(rx, ry, 2 + rand() * 4, 1 + rand() * 2, rand() * 3, 0, TAU);
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(226, 232, 240, 0.12)';
    ctx.beginPath();
    ctx.moveTo(x + 18, y + h - 8);
    ctx.lineTo(x + 34, y + h - 10);
    ctx.stroke();
  }

  private drawWreck(ctx: CanvasRenderingContext2D, p: ObstacleProp, timeSec: number) {
    const { x, y, w, h } = p;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const rand = rngFrom(0x6a09e667 ^ Math.floor(p.colorSeed * 999979));
    ctx.translate(cx, cy);
    ctx.rotate((p.colorSeed - 0.5) * 0.24);

    // Long shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    rr(ctx, -w / 2 + 5, -h / 2 + 7, w, h, 12);
    ctx.fill();

    // Missing wheel / flattened tire
    ctx.fillStyle = '#080b0f';
    rr(ctx, -w / 2 + 12, -h / 2 - 2, 20, 6, 3);
    ctx.fill();
    rr(ctx, -w / 2 + 12, h / 2 - 4, 20, 6, 3);
    ctx.fill();

    const shell = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
    shell.addColorStop(0, p.colorSeed > 0.6 ? '#3d2626' : '#2a3038');
    shell.addColorStop(1, '#14171b');
    ctx.fillStyle = shell;
    rr(ctx, -w / 2, -h / 2 + 2, w, h - 4, 10);
    ctx.fill();

    // Crumpled front end
    ctx.fillStyle = '#0e1114';
    rr(ctx, w / 2 - 30, -h / 2 + 4, 28, h - 8, 6);
    ctx.fill();
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.18)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(w / 2 - 26, -h / 2 + 8);
    ctx.lineTo(w / 2 - 8, -h / 2 + 16);
    ctx.lineTo(w / 2 - 20, 0);
    ctx.lineTo(w / 2 - 6, h / 2 - 12);
    ctx.stroke();

    // Shattered windshield
    ctx.fillStyle = '#080c12';
    rr(ctx, -w / 2 + 14, -h / 2 + 8, 20, h - 16, 4);
    ctx.fill();
    ctx.fillStyle = 'rgba(186, 230, 253, 0.30)';
    for (let i = 0; i < 12; i++) {
      const gx = -w / 2 + 14 + rand() * 20;
      const gy = -h / 2 + 8 + rand() * (h - 16);
      ctx.beginPath();
      ctx.moveTo(gx, gy);
      ctx.lineTo(gx + 1 + rand() * 4, gy + (rand() - 0.5) * 5);
      ctx.lineTo(gx - 1, gy + 1 + rand() * 3);
      ctx.closePath();
      ctx.fill();
    }

    // Roof caved in
    ctx.fillStyle = 'rgba(0, 0, 0, 0.42)';
    rr(ctx, -w * 0.12, -h / 2 + 14, w * 0.26, h - 28, 5);
    ctx.fill();

    // Blown-open door
    ctx.fillStyle = '#1d242e';
    rr(ctx, -6, h / 2 - 4, 22, 10, 3);
    ctx.fill();
    ctx.fillStyle = 'rgba(120, 24, 24, 0.8)';
    rr(ctx, -2, h / 2 - 5, 12, 5, 2);
    ctx.fill();

    // Rust and soot
    ctx.fillStyle = 'rgba(92, 44, 18, 0.45)';
    for (let i = 0; i < 6; i++) {
      const rx = -w / 2 + 8 + rand() * (w - 16);
      const ry = -h / 2 + 6 + rand() * (h - 12);
      ctx.beginPath();
      ctx.ellipse(rx, ry, 2 + rand() * 5, 1 + rand() * 3, rand() * 3, 0, TAU);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.beginPath();
    ctx.ellipse(w * 0.2, 0, 22, 14, 0, 0, TAU);
    ctx.fill();

    // Smoldering ember in the engine bay
    const ember = 0.35 + 0.35 * Math.sin(timeSec * 6 + p.colorSeed * 20);
    ctx.fillStyle = `rgba(234, 88, 12, ${ember.toFixed(2)})`;
    ctx.beginPath();
    ctx.arc(w / 2 - 16, 0, 3.5, 0, TAU);
    ctx.fill();
    ctx.fillStyle = `rgba(251, 191, 36, ${(ember * 0.6).toFixed(2)})`;
    ctx.beginPath();
    ctx.arc(w / 2 - 16, 0, 1.5, 0, TAU);
    ctx.fill();
  }

  private drawSemi(ctx: CanvasRenderingContext2D, p: ObstacleProp) {
    const { x, y, w, h } = p;
    const cy = y + h / 2;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    rr(ctx, x + 5, y + 7, w, h, 8);
    ctx.fill();

    // Wheels
    ctx.fillStyle = '#080b0f';
    for (const wy of [y - 2, y + h - 5]) {
      for (const wx of [x + 10, x + 34, x + w - 52, x + w - 28]) {
        rr(ctx, wx, wy, 15, 7, 2);
        ctx.fill();
      }
    }

    // Trailer
    const trailerW = w * 0.68;
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, '#d6dde5');
    g.addColorStop(0.5, '#b4bec9');
    g.addColorStop(1, '#7c8794');
    ctx.fillStyle = g;
    rr(ctx, x, y + 2, trailerW, h - 4, 4);
    ctx.fill();
    ctx.strokeStyle = '#3b4450';
    ctx.lineWidth = 1.5;
    rr(ctx, x + 0.75, y + 2.75, trailerW - 1.5, h - 5.5, 4);
    ctx.stroke();
    // Corrugation
    ctx.strokeStyle = 'rgba(60, 72, 86, 0.25)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 9; i++) {
      const lx = x + (trailerW * i) / 9;
      ctx.beginPath();
      ctx.moveTo(lx, y + 5);
      ctx.lineTo(lx, y + h - 5);
      ctx.stroke();
    }
    // Company stripe
    ctx.fillStyle = '#b91c1c';
    ctx.fillRect(x + 2, cy - 3, trailerW - 4, 6);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(x + 2, cy - 3, trailerW - 4, 1);

    // Cab
    const cabX = x + trailerW + 4;
    const cabW = w - trailerW - 4;
    const cab = ctx.createLinearGradient(0, y, 0, y + h);
    cab.addColorStop(0, '#2a4d7a');
    cab.addColorStop(1, '#14263d');
    ctx.fillStyle = cab;
    rr(ctx, cabX, y + 4, cabW, h - 8, 5);
    ctx.fill();
    ctx.strokeStyle = '#0b1320';
    ctx.lineWidth = 1.5;
    rr(ctx, cabX + 0.75, y + 4.75, cabW - 1.5, h - 9.5, 5);
    ctx.stroke();
    // Windshield
    ctx.fillStyle = '#0b1219';
    rr(ctx, cabX + cabW * 0.46, y + 8, cabW * 0.42, h - 16, 4);
    ctx.fill();
    ctx.fillStyle = 'rgba(186, 230, 253, 0.18)';
    ctx.beginPath();
    ctx.moveTo(cabX + cabW * 0.62, y + 9);
    ctx.lineTo(cabX + cabW * 0.7, y + 9);
    ctx.lineTo(cabX + cabW * 0.62, y + h - 9);
    ctx.lineTo(cabX + cabW * 0.55, y + h - 9);
    ctx.closePath();
    ctx.fill();
    // Exhaust stacks
    ctx.fillStyle = '#94a3b8';
    ctx.fillRect(cabX + 1, y + 6, 3, 7);
    ctx.fillRect(cabX + 1, y + h - 13, 3, 7);
    // Headlights
    ctx.fillStyle = '#fef3c7';
    ctx.fillRect(x + w - 4, y + 10, 3, 9);
    ctx.fillRect(x + w - 4, y + h - 19, 3, 9);
    ctx.fillStyle = 'rgba(254, 243, 199, 0.14)';
    ctx.beginPath();
    ctx.moveTo(x + w - 2, y + 11);
    ctx.lineTo(x + w + 14, y + 7);
    ctx.lineTo(x + w + 14, y + h - 7);
    ctx.lineTo(x + w - 2, y + h - 11);
    ctx.closePath();
    ctx.fill();
  }

  private drawTree(ctx: CanvasRenderingContext2D, p: ObstacleProp, timeSec: number) {
    const cx = p.x + p.w / 2;
    const cy = p.y + p.h / 2;
    const sway = Math.sin(timeSec * 0.9 + p.colorSeed * 12) * 1.6;
    const r = Math.max(p.w, p.h) * 0.56;
    const rand = rngFrom(0x510e527f ^ Math.floor(p.colorSeed * 999961));

    // Cast shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.42)';
    ctx.beginPath();
    ctx.ellipse(cx + 5, cy + 7, r * 0.95, r * 0.72, 0.2, 0, TAU);
    ctx.fill();

    // Trunk
    ctx.fillStyle = '#2b2118';
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.22, 0, TAU);
    ctx.fill();

    // Canopy clusters
    const layers = [
      { ox: 0, oy: 0, s: 1, col: '#12261a' },
      { ox: -r * 0.26, oy: -r * 0.18, s: 0.66, col: '#18331f' },
      { ox: r * 0.28, oy: -r * 0.1, s: 0.6, col: '#0f2417' },
      { ox: r * 0.06, oy: r * 0.3, s: 0.58, col: '#142c1b' },
    ];
    for (const l of layers) {
      ctx.fillStyle = l.col;
      ctx.beginPath();
      ctx.arc(cx + l.ox + sway, cy + l.oy, r * l.s, 0, TAU);
      ctx.fill();
    }
    // Dappled leaf highlights
    for (let i = 0; i < 16; i++) {
      const a = rand() * TAU;
      const rr2 = rand() * r * 0.8;
      ctx.fillStyle =
        i % 3 === 0 ? 'rgba(74, 122, 74, 0.30)' : 'rgba(38, 74, 46, 0.34)';
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * rr2 + sway, cy + Math.sin(a) * rr2, 1.5 + rand() * 3, 0, TAU);
      ctx.fill();
    }
    // Moonlit rim on the upper-left
    ctx.strokeStyle = 'rgba(148, 197, 158, 0.16)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx + sway, cy, r * 0.98, Math.PI * 0.85, Math.PI * 1.55);
    ctx.stroke();
  }

  private drawCorpse(ctx: CanvasRenderingContext2D, p: ObstacleProp) {
    const cx = p.x + p.w / 2;
    const cy = p.y + p.h / 2;
    const rand = rngFrom(0x1f83d9ab ^ Math.floor(p.colorSeed * 999953));
    ctx.translate(cx, cy);
    ctx.rotate(p.colorSeed * TAU);

    // Blood pool
    ctx.fillStyle = 'rgba(96, 18, 18, 0.62)';
    ctx.beginPath();
    ctx.ellipse(2, 3, 17, 12, 0.2, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(56, 8, 8, 0.6)';
    ctx.beginPath();
    ctx.ellipse(1, 3, 9, 6, 0.2, 0, TAU);
    ctx.fill();

    // Limbs
    ctx.fillStyle = '#1c2530';
    ctx.save();
    ctx.rotate(0.5 + rand() * 0.5);
    rr(ctx, -18, -4, 12, 4, 2);
    ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.rotate(-0.7 - rand() * 0.4);
    rr(ctx, -17, 2, 11, 4, 2);
    ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.rotate(1.2);
    rr(ctx, 5, -8, 10, 4, 2);
    ctx.fill();
    ctx.restore();

    // Torso / jacket
    const jacket =
      p.colorSeed > 0.72 ? '#0f5c54' : p.colorSeed > 0.45 ? '#334155' : '#4c1d1d';
    ctx.fillStyle = jacket;
    rr(ctx, -10, -7, 20, 14, 5);
    ctx.fill();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
    rr(ctx, -10, 1, 20, 5, 3);
    ctx.fill();
    // Collar / hood
    ctx.fillStyle = this.lighten(jacket, -0.2);
    rr(ctx, 5, -6, 8, 12, 4);
    ctx.fill();

    // Head
    ctx.fillStyle = '#9aa4ad';
    ctx.beginPath();
    ctx.arc(13, 0, 5.5, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
    ctx.beginPath();
    ctx.arc(15, 1, 3.5, 0, TAU);
    ctx.fill();

    // Exposed wound detail
    if (p.colorSeed > 0.5) {
      ctx.fillStyle = 'rgba(150, 34, 34, 0.85)';
      ctx.beginPath();
      ctx.ellipse(-2, -1, 4, 2.5, 0.5, 0, TAU);
      ctx.fill();
    }
  }

  /** Quick sRGB-ish lighten/darken for flat canvas palettes. */
  private lighten(hex: string, amount: number): string {
    const h = hex.replace('#', '');
    const n = parseInt(
      h.length === 3
        ? h
            .split('')
            .map((c) => c + c)
            .join('')
        : h,
      16
    );
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    const f = (v: number) =>
      Math.max(0, Math.min(255, Math.round(amount >= 0 ? v + (255 - v) * amount : v * (1 + amount))));
    return `rgb(${f(r)}, ${f(g)}, ${f(b)})`;
  }

  // ── SEARCHABLE CONTAINERS ────────────────────────────────────────────────
  public drawContainer(ctx: CanvasRenderingContext2D, c: ContainerEntity, timeSec: number) {
    const x = c.x - 14;
    const y = c.y - 14;
    const S = 28;
    ctx.save();

    let fill = '#475569';
    let accent = '#94a3b8';
    let dark = '#1e293b';
    if (c.type === 'fridge') {
      fill = '#cbd5e1';
      accent = '#64748b';
      dark = '#94a3b8';
    } else if (c.type === 'medical_cabinet' || c.type === 'pharmacy_shelf') {
      fill = '#e2e8f0';
      accent = '#dc2626';
      dark = '#94a3b8';
    } else if (c.type === 'police_locker') {
      fill = '#1e3a5f';
      accent = '#60a5fa';
      dark = '#0f1f33';
    } else if (c.type === 'toolbox') {
      fill = '#991b1b';
      accent = '#fca5a5';
      dark = '#5c0f0f';
    } else if (c.type === 'survivor_pack') {
      fill = '#78350f';
      accent = '#f59e0b';
      dark = '#451a03';
    } else if (c.type === 'supermarket_shelf') {
      fill = '#374151';
      accent = '#fbbf24';
      dark = '#1f2937';
    } else if (c.type === 'car_trunk') {
      fill = '#2b3441';
      accent = '#94a3b8';
      dark = '#111820';
    } else if (c.type === 'cabinet' || c.type === 'dresser' || c.type === 'desk') {
      fill = '#5c4033';
      accent = '#a8a29e';
      dark = '#3a281e';
    }

    if (c.searched) ctx.globalAlpha = 0.55;

    // Ground shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    rr(ctx, x + 2, y + 4, S, S, 4);
    ctx.fill();

    // Carcass
    const body = ctx.createLinearGradient(x, y, x, y + S);
    body.addColorStop(0, this.lighten(fill, 0.12));
    body.addColorStop(1, this.lighten(fill, -0.22));
    ctx.fillStyle = body;
    rr(ctx, x, y, S, S, 3);
    ctx.fill();
    ctx.strokeStyle = '#0b0f15';
    ctx.lineWidth = 2;
    rr(ctx, x + 1, y + 1, S - 2, S - 2, 2);
    ctx.stroke();

    if (c.type === 'fridge') {
      ctx.fillStyle = '#94a3b8';
      ctx.fillRect(x + 3, y + 12, S - 6, 2);
      ctx.fillStyle = '#64748b';
      ctx.fillRect(x + S - 7, y + 5, 3, 7);
      ctx.fillRect(x + S - 7, y + 16, 3, 7);
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillRect(x + 5, y + 3, 2, S - 6);
    } else if (c.type === 'medical_cabinet' || c.type === 'pharmacy_shelf') {
      ctx.fillStyle = accent;
      ctx.fillRect(c.x - 2, c.y - 7, 4, 14);
      ctx.fillRect(c.x - 7, c.y - 2, 14, 4);
      ctx.fillStyle = 'rgba(0,0,0,0.14)';
      ctx.fillRect(x + 4, y + 4, 5, S - 8);
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillRect(x + 4, y + 4, 2, S - 8);
    } else if (c.type === 'police_locker') {
      ctx.fillStyle = dark;
      ctx.fillRect(x + 3, y + 3, S - 6, S - 6);
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.arc(c.x, y + 9, 3, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#cbd5e1';
      ctx.fillRect(x + 6, y + 15, S - 12, 1);
      ctx.fillRect(x + 6, y + 18, S - 12, 1);
    } else if (c.type === 'toolbox') {
      ctx.fillStyle = dark;
      ctx.fillRect(x + 3, y + 9, S - 6, S - 12);
      ctx.fillStyle = '#cbd5e1';
      ctx.fillRect(c.x - 6, y + 3, 12, 4);
      ctx.fillStyle = accent;
      ctx.fillRect(x + 5, y + 12, S - 10, 2);
    } else if (c.type === 'survivor_pack') {
      ctx.fillStyle = dark;
      rr(ctx, x + 4, y + 4, S - 8, S - 8, 4);
      ctx.fill();
      ctx.fillStyle = accent;
      ctx.fillRect(c.x - 2, y + 8, 4, 8);
      ctx.fillStyle = '#fef3c7';
      ctx.fillRect(x + 6, y + 19, S - 12, 1);
    } else if (c.type === 'supermarket_shelf') {
      for (let i = 0; i < 3; i++) {
        ctx.fillStyle = ['#b91c1c', '#a16207', '#166534'][i];
        ctx.fillRect(x + 4, y + 5 + i * 7, S - 8, 5);
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        ctx.fillRect(x + 4, y + 5 + i * 7, S - 8, 1);
      }
    } else if (c.type === 'car_trunk') {
      ctx.fillStyle = dark;
      rr(ctx, x + 3, y + 3, S - 6, S - 6, 3);
      ctx.fill();
      ctx.fillStyle = accent;
      ctx.fillRect(x + 5, y + S - 7, S - 10, 2);
      ctx.fillStyle = '#0b0f15';
      ctx.fillRect(c.x - 5, y + 3, 10, 4);
    } else {
      // Generic drawers
      ctx.fillStyle = dark;
      ctx.fillRect(x + 3, y + 3, S - 6, S - 6);
      ctx.fillStyle = accent;
      ctx.fillRect(x + 6, y + 8, S - 12, 2);
      ctx.fillRect(x + 6, y + 17, S - 12, 2);
      ctx.fillStyle = '#e2e8f0';
      ctx.fillRect(c.x - 2, y + 13, 4, 2);
      ctx.fillRect(c.x - 2, y + 22, 4, 2);
    }

    // Search pulse
    if (!c.searched) {
      const pulse = 0.3 + 0.35 * Math.sin(timeSec * 3.2 + c.tx);
      ctx.strokeStyle = `rgba(245, 158, 11, ${pulse.toFixed(2)})`;
      ctx.lineWidth = 1.5;
      rr(ctx, x - 3, y - 3, S + 6, S + 6, 5);
      ctx.stroke();
      // Tiny glint
      const gl = 0.5 + 0.5 * Math.sin(timeSec * 4.5 + c.ty);
      ctx.fillStyle = `rgba(254, 243, 199, ${(gl * 0.7).toFixed(2)})`;
      ctx.fillRect(x + S - 5, y + 2, 2, 2);
    }
    ctx.restore();
  }

  // ── GROUND ITEMS ─────────────────────────────────────────────────────────
  public drawGroundItem(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    itemId: string,
    timeSec: number,
    bob = 0
  ) {
    const pulse = 0.5 + 0.5 * Math.sin(timeSec * 3.1 + x * 0.07);
    ctx.save();

    // Shadow on the ground (does not bob)
    ctx.fillStyle = 'rgba(0, 0, 0, 0.42)';
    ctx.beginPath();
    ctx.ellipse(x, y + 7, 9, 4, 0, 0, TAU);
    ctx.fill();

    // Soft pickup halo
    const halo = ctx.createRadialGradient(x, y, 1, x, y, 16);
    halo.addColorStop(0, `rgba(251, 191, 36, ${(0.24 + pulse * 0.14).toFixed(2)})`);
    halo.addColorStop(1, 'rgba(251, 191, 36, 0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(x, y, 16, 0, TAU);
    ctx.fill();

    ctx.translate(x, y + bob);
    const tilt = (hash01(Math.floor(x), Math.floor(y)) - 0.5) * 0.4;
    ctx.rotate(tilt);
    this.drawItemIcon(ctx, itemId, 0, 0, 1);
    ctx.rotate(-tilt);

    // Twinkle
    const tw = Math.max(0, Math.sin(timeSec * 2.6 + x * 0.11));
    if (tw > 0.55) {
      ctx.strokeStyle = `rgba(254, 243, 199, ${((tw - 0.55) * 1.4).toFixed(2)})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-8, -8);
      ctx.lineTo(-5, -8);
      ctx.moveTo(-6.5, -9.5);
      ctx.lineTo(-6.5, -6.5);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Compact, readable inventory silhouettes used both on the ground and in-world. */
  private drawItemIcon(
    ctx: CanvasRenderingContext2D,
    itemId: string,
    cx: number,
    cy: number,
    scale: number
  ) {
    const def = ITEMS[itemId];
    const icon = def?.iconId ?? itemId;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    const metal = '#cbd5e1';
    const metalDark = '#64748b';
    const wood = '#8b5a2b';

    switch (icon) {
      case 'knife':
        ctx.fillStyle = '#0f172a';
        rr(ctx, -9, -1.5, 6, 3, 1);
        ctx.fill();
        ctx.fillStyle = metal;
        ctx.beginPath();
        ctx.moveTo(-3, -1.8);
        ctx.lineTo(7, -0.4);
        ctx.lineTo(8, 1.4);
        ctx.lineTo(-3, 1.8);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.fillRect(-2, -1, 8, 0.8);
        break;
      case 'bat':
        ctx.fillStyle = wood;
        ctx.beginPath();
        ctx.moveTo(-9, -1.4);
        ctx.lineTo(4, -2.8);
        ctx.lineTo(8, -2.2);
        ctx.lineTo(8, 2.2);
        ctx.lineTo(4, 2.8);
        ctx.lineTo(-9, 1.4);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.fillRect(-9, -0.4, 5, 1);
        ctx.strokeStyle = '#3f2a16';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(-6, -1);
        ctx.lineTo(2, -2);
        ctx.stroke();
        break;
      case 'crowbar':
        ctx.strokeStyle = '#b91c1c';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(-8, 2);
        ctx.lineTo(6, -1);
        ctx.stroke();
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(-7, 1);
        ctx.lineTo(5, -1.6);
        ctx.stroke();
        ctx.strokeStyle = '#b91c1c';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(6, -2.5, 2.4, 0.4, Math.PI * 1.6);
        ctx.stroke();
        break;
      case 'pipe_wrench':
        ctx.strokeStyle = metalDark;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(-8, 2.5);
        ctx.lineTo(5, -1);
        ctx.stroke();
        ctx.fillStyle = metal;
        rr(ctx, 4, -4, 5, 6, 1.5);
        ctx.fill();
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(6, -3, 2, 4);
        break;
      case 'pistol':
        ctx.fillStyle = '#1e293b';
        rr(ctx, -7, -3, 14, 4, 1.5);
        ctx.fill();
        ctx.fillStyle = '#334155';
        rr(ctx, -5, -2, 10, 2, 1);
        ctx.fill();
        ctx.fillStyle = '#0f172a';
        rr(ctx, -4, 0, 4, 7, 1.5);
        ctx.fill();
        ctx.fillStyle = '#94a3b8';
        ctx.fillRect(5, -2.4, 3, 1.4);
        break;
      case 'revolver':
        ctx.fillStyle = '#334155';
        rr(ctx, -7, -2.5, 13, 3.5, 1.5);
        ctx.fill();
        ctx.fillStyle = '#64748b';
        ctx.beginPath();
        ctx.arc(-1, -0.5, 3, 0, TAU);
        ctx.fill();
        ctx.fillStyle = '#0f172a';
        rr(ctx, -5, 0.5, 4, 6.5, 1.5);
        ctx.fill();
        ctx.fillStyle = '#94a3b8';
        ctx.fillRect(5, -1.6, 3, 1.2);
        break;
      case 'shotgun':
        ctx.fillStyle = '#3f2a16';
        rr(ctx, -10, -1.5, 7, 4, 1.5);
        ctx.fill();
        ctx.fillStyle = '#1e293b';
        rr(ctx, -4, -2, 12, 3, 1);
        ctx.fill();
        ctx.fillStyle = metalDark;
        ctx.fillRect(-1, -3, 9, 2);
        ctx.fillStyle = '#0f172a';
        rr(ctx, -6, 1.5, 4, 4, 1);
        ctx.fill();
        break;
      case 'ammo_9mm':
      case 'ammo_38':
      case 'ammo_12g': {
        const col =
          icon === 'ammo_9mm' ? '#a16207' : icon === 'ammo_38' ? '#1e3a5f' : '#7f1d1d';
        ctx.fillStyle = col;
        rr(ctx, -7, -5, 14, 10, 1.5);
        ctx.fill();
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = 1;
        rr(ctx, -7, -5, 14, 10, 1.5);
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.18)';
        ctx.fillRect(-6, -4, 12, 2);
        ctx.fillStyle = '#e2e8f0';
        ctx.font = '700 6px "Barlow Condensed", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(icon === 'ammo_9mm' ? '9' : icon === 'ammo_38' ? '.38' : '12', 0, 2);
        break;
      }
      case 'medkit':
        ctx.fillStyle = '#e2e8f0';
        rr(ctx, -7, -5, 14, 10, 2);
        ctx.fill();
        ctx.strokeStyle = '#94a3b8';
        ctx.lineWidth = 1;
        rr(ctx, -7, -5, 14, 10, 2);
        ctx.stroke();
        ctx.fillStyle = '#dc2626';
        ctx.fillRect(-1.5, -3, 3, 6);
        ctx.fillRect(-4, -1, 8, 2);
        ctx.fillStyle = '#64748b';
        ctx.fillRect(-2, -6, 4, 2);
        break;
      case 'bandage':
        ctx.fillStyle = '#e7e5e4';
        ctx.beginPath();
        ctx.arc(0, 0, 6, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = '#a8a29e';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(0, 0, 4, 0, TAU);
        ctx.stroke();
        ctx.fillStyle = '#dc2626';
        ctx.fillRect(-1, -2, 2, 4);
        ctx.fillRect(-2, -1, 4, 2);
        break;
      case 'antiseptic':
      case 'antiviral': {
        const liquid = icon === 'antiviral' ? '#22d3ee' : '#f59e0b';
        ctx.fillStyle = '#cbd5e1';
        rr(ctx, -4, -5, 8, 11, 2);
        ctx.fill();
        ctx.fillStyle = liquid;
        ctx.fillRect(-3, -2, 6, 7);
        ctx.fillStyle = '#94a3b8';
        ctx.fillRect(-2, -7, 4, 2);
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.fillRect(-2, -1, 1.5, 5);
        break;
      }
      case 'painkillers':
        ctx.fillStyle = '#f8fafc';
        rr(ctx, -5, -4, 10, 9, 2);
        ctx.fill();
        ctx.fillStyle = '#dc2626';
        ctx.fillRect(-3, -1, 6, 2);
        ctx.fillRect(-1, -3, 2, 6);
        ctx.fillStyle = '#94a3b8';
        ctx.fillRect(-3, -6, 6, 2);
        break;
      case 'canned_beans':
        ctx.fillStyle = '#a8a29e';
        rr(ctx, -5, -5, 10, 10, 2);
        ctx.fill();
        ctx.fillStyle = '#b91c1c';
        ctx.fillRect(-4, -2, 8, 5);
        ctx.fillStyle = '#fef3c7';
        ctx.fillRect(-2, 0, 4, 1.5);
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.fillRect(-4, -4, 1.5, 8);
        break;
      case 'water_bottle':
        ctx.fillStyle = 'rgba(186, 230, 253, 0.9)';
        rr(ctx, -3.5, -5, 7, 11, 2.5);
        ctx.fill();
        ctx.fillStyle = 'rgba(56, 189, 248, 0.55)';
        ctx.fillRect(-2.5, -1, 5, 6);
        ctx.fillStyle = '#0ea5e9';
        ctx.fillRect(-2, -7, 4, 2);
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.fillRect(-2, -3, 1.2, 5);
        break;
      case 'ration_bar':
      case 'snacks':
        ctx.fillStyle = icon === 'snacks' ? '#b45309' : '#78716c';
        rr(ctx, -6, -4, 12, 8, 1.5);
        ctx.fill();
        ctx.fillStyle = icon === 'snacks' ? '#fbbf24' : '#d6d3d1';
        ctx.fillRect(-5, -2.5, 10, 5);
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.fillRect(-5, -0.5, 10, 1);
        break;
      case 'powerbank':
        ctx.fillStyle = '#1e293b';
        rr(ctx, -5, -6, 10, 12, 2);
        ctx.fill();
        ctx.fillStyle = '#22c55e';
        ctx.fillRect(-3, -3, 6, 2);
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(-1, -5, 2, 1.5);
        ctx.fillStyle = 'rgba(255,255,255,0.18)';
        ctx.fillRect(-4, -4, 1, 8);
        break;
      case 'flare':
        ctx.fillStyle = '#b91c1c';
        rr(ctx, -2, -7, 4, 12, 1.5);
        ctx.fill();
        ctx.fillStyle = '#f8fafc';
        ctx.fillRect(-2, -2, 4, 2);
        ctx.fillStyle = '#f97316';
        ctx.beginPath();
        ctx.arc(0, -7, 2, 0, TAU);
        ctx.fill();
        break;
      case 'noisemaker':
        ctx.fillStyle = '#475569';
        rr(ctx, -4, -5, 8, 10, 2);
        ctx.fill();
        ctx.fillStyle = '#f59e0b';
        ctx.fillRect(-4, -2, 8, 3);
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(-2, -6, 4, 2);
        break;
      case 'fuel_canister':
        ctx.fillStyle = '#b91c1c';
        rr(ctx, -6, -5, 12, 11, 2);
        ctx.fill();
        ctx.fillStyle = '#7f1d1d';
        ctx.fillRect(-4, -1, 8, 2);
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(-2, -7, 4, 2);
        ctx.fillStyle = '#fef3c7';
        ctx.fillRect(3, -4, 2, 3);
        break;
      case 'kevlar_vest':
        ctx.fillStyle = '#1e3a5f';
        ctx.beginPath();
        ctx.moveTo(-6, -5);
        ctx.lineTo(-2, -6);
        ctx.lineTo(0, -3);
        ctx.lineTo(2, -6);
        ctx.lineTo(6, -5);
        ctx.lineTo(7, 2);
        ctx.lineTo(4, 6);
        ctx.lineTo(-4, 6);
        ctx.lineTo(-7, 2);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = '#60a5fa';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(-4, -1, 8, 1);
        break;
      default: {
        ctx.fillStyle = '#475569';
        rr(ctx, -6, -5, 12, 10, 2);
        ctx.fill();
        ctx.fillStyle = '#fbbf24';
        ctx.fillRect(-4, -1, 8, 2);
      }
    }
    ctx.restore();
  }

  // ── PLAYER ───────────────────────────────────────────────────────────────
  public drawPlayer(
    ctx: CanvasRenderingContext2D,
    p: Pick<
      PlayerState,
      | 'x'
      | 'y'
      | 'vx'
      | 'vy'
      | 'angle'
      | 'isCrouching'
      | 'animState'
      | 'animTime'
      | 'hurtFlash'
      | 'armorEquipped'
      | 'flashlightOn'
      | 'flashlightBattery'
      | 'meleeSwingTimer'
    >,
    jacketColor = '#3f523a'
  ) {
    ctx.save();
    ctx.translate(p.x, p.y);

    const flash = p.hurtFlash > 0;
    const skin = flash ? '#ffc9c9' : '#d9b08c';
    const skinShade = flash ? '#f87171' : '#b3835f';
    const jacket = flash ? '#ef4444' : jacketColor;
    const jacketDark = flash ? '#991b1b' : this.lighten(jacketColor, -0.4);
    const jacketLight = flash ? '#fca5a5' : this.lighten(jacketColor, 0.16);
    const pants = flash ? '#7f1d1d' : '#2a303a';
    const boot = flash ? '#5c0f0f' : '#11161d';

    if (p.animState === 'dead') {
      // Sprawled body in a spreading pool
      ctx.fillStyle = 'rgba(110, 20, 20, 0.68)';
      ctx.beginPath();
      ctx.ellipse(2, 3, 20, 13, 0.3, 0, TAU);
      ctx.fill();
      ctx.fillStyle = 'rgba(60, 8, 8, 0.6)';
      ctx.beginPath();
      ctx.ellipse(1, 3, 11, 7, 0.3, 0, TAU);
      ctx.fill();
      ctx.rotate(p.angle + 0.4);
      // Legs
      ctx.fillStyle = pants;
      rr(ctx, -20, -7, 14, 5, 2.5);
      ctx.fill();
      rr(ctx, -19, 2, 13, 5, 2.5);
      ctx.fill();
      // Torso
      ctx.fillStyle = jacket;
      rr(ctx, -8, -8, 19, 16, 5);
      ctx.fill();
      ctx.fillStyle = jacketDark;
      rr(ctx, -8, 1, 19, 6, 4);
      ctx.fill();
      // Arm
      ctx.fillStyle = jacket;
      rr(ctx, -2, -13, 13, 5, 2.5);
      ctx.fill();
      ctx.fillStyle = skin;
      rr(ctx, 9, -13, 4, 5, 2);
      ctx.fill();
      // Head
      ctx.fillStyle = '#241d19';
      ctx.beginPath();
      ctx.arc(13, 0, 7, 0, TAU);
      ctx.fill();
      ctx.fillStyle = skin;
      ctx.beginPath();
      ctx.arc(15, -0.5, 5.2, 0, TAU);
      ctx.fill();
      ctx.restore();
      return;
    }

    // Contact shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.48)';
    ctx.beginPath();
    ctx.ellipse(1, 4, p.isCrouching ? 12 : 14, p.isCrouching ? 7 : 8.5, 0, 0, TAU);
    ctx.fill();

    ctx.rotate(p.angle);

    const moving =
      p.animState === 'walk' ||
      p.animState === 'sprint' ||
      (p.animState === 'crouch' && Math.hypot(p.vx, p.vy) > 5) ||
      p.animState === 'reload';
    const rate = p.animState === 'sprint' ? 13.5 : p.isCrouching ? 6.2 : 9.2;
    const phase = p.animTime * rate;
    const stride = moving ? Math.sin(phase) : 0;
    const bob = moving ? Math.abs(Math.sin(phase)) * 1.0 : 0;
    const crouchScale = p.isCrouching ? 0.9 : 1;

    ctx.scale(crouchScale, crouchScale);
    ctx.translate(0, -bob * 0.28);

    // ── Legs ──
    const legSwing = stride * 3.6;
    ctx.fillStyle = pants;
    rr(ctx, -9 + legSwing, -8, 12, 5.2, 2.4);
    ctx.fill();
    rr(ctx, -9 - legSwing, 2.8, 12, 5.2, 2.4);
    ctx.fill();
    ctx.fillStyle = boot;
    rr(ctx, 2.5 + legSwing, -8, 5, 5.2, 1.8);
    ctx.fill();
    rr(ctx, 2.5 - legSwing, 2.8, 5, 5.2, 1.8);
    ctx.fill();

    // ── Backpack ──
    ctx.fillStyle = '#2a3324';
    rr(ctx, -12, -6.5, 8, 13, 3.2);
    ctx.fill();
    ctx.fillStyle = '#3a4631';
    rr(ctx, -11, -5, 4.5, 10, 2.2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-9, -5);
    ctx.lineTo(-9, 5);
    ctx.stroke();
    // Bedroll
    ctx.fillStyle = '#4a3a2a';
    rr(ctx, -13, -8.5, 4, 17, 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(-12.5, -8, 1, 16);

    // ── Torso ──
    const torso = ctx.createLinearGradient(0, -10, 0, 10);
    torso.addColorStop(0, jacketLight);
    torso.addColorStop(0.5, jacket);
    torso.addColorStop(1, jacketDark);
    ctx.fillStyle = torso;
    rr(ctx, -7.5, -9, 15.5, 18, 5);
    ctx.fill();
    ctx.strokeStyle = jacketDark;
    ctx.lineWidth = 1.2;
    rr(ctx, -7.5, -9, 15.5, 18, 5);
    ctx.stroke();

    // Shoulders
    ctx.fillStyle = jacketLight;
    rr(ctx, -5.5, -10.5, 8.5, 3.4, 1.6);
    ctx.fill();
    rr(ctx, -5.5, 7.1, 8.5, 3.4, 1.6);
    ctx.fill();

    // Harness strap
    ctx.strokeStyle = 'rgba(20, 26, 33, 0.85)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-3, -8.5);
    ctx.lineTo(5.5, 3.5);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.25)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(-3.4, -8.2);
    ctx.lineTo(5.1, 3.8);
    ctx.stroke();

    // Jacket seam + zipper
    ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
    ctx.fillRect(4.5, -7, 1, 14);
    ctx.fillStyle = 'rgba(226, 232, 240, 0.14)';
    ctx.fillRect(-6.5, -7.5, 1, 15);

    // Armor vest
    if (p.armorEquipped) {
      ctx.fillStyle = '#1e3a5f';
      rr(ctx, -4.5, -7.5, 11.5, 15, 3);
      ctx.fill();
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 1;
      rr(ctx, -4.5, -7.5, 11.5, 15, 3);
      ctx.stroke();
      ctx.fillStyle = '#2c5282';
      rr(ctx, -3.5, -6.5, 9.5, 5, 2);
      ctx.fill();
      rr(ctx, -3.5, 1.5, 9.5, 5, 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(226, 232, 240, 0.16)';
      ctx.fillRect(-4, -7, 1, 14);
      // Mag pouch
      ctx.fillStyle = '#152b45';
      rr(ctx, -1, 8, 7, 3.5, 1);
      ctx.fill();
    }

    // ── Arms ──
    const armSwing = moving ? Math.sin(phase + Math.PI) * 2.4 : 0;
    const meleeActive = p.meleeSwingTimer > 0;
    const meleeProg = meleeActive ? 1 - p.meleeSwingTimer / 0.22 : 0;

    // Far arm (phone / flashlight)
    ctx.save();
    ctx.translate(2.5, -7.4);
    ctx.rotate(-0.16 - armSwing * 0.05);
    ctx.fillStyle = jacket;
    rr(ctx, 0, -2.6, 10.5, 5.2, 2.4);
    ctx.fill();
    ctx.strokeStyle = jacketDark;
    ctx.lineWidth = 0.8;
    rr(ctx, 0, -2.6, 10.5, 5.2, 2.4);
    ctx.stroke();
    // Hand
    ctx.fillStyle = skin;
    rr(ctx, 9.5, -2.1, 3.6, 4.2, 1.6);
    ctx.fill();
    // Phone / torch body
    ctx.fillStyle = '#0f172a';
    rr(ctx, 12, -2.3, 4.5, 2.4, 0.8);
    ctx.fill();
    ctx.fillStyle = p.flashlightOn && p.flashlightBattery > 0 ? '#fef08a' : '#38bdf8';
    ctx.fillRect(15.6, -1.9, 1.5, 1.6);
    if (p.flashlightOn && p.flashlightBattery > 0) {
      const gl = 0.35 + 0.25 * Math.sin(p.animTime * 9);
      ctx.fillStyle = `rgba(254, 240, 138, ${gl.toFixed(2)})`;
      ctx.beginPath();
      ctx.arc(17, -1.1, 3.2, 0, TAU);
      ctx.fill();
    }
    ctx.restore();

    // Near arm (weapon hand)
    ctx.save();
    ctx.translate(2.5, 7.4);
    let armRot = 0.16 + armSwing * 0.05;
    if (meleeActive) {
      armRot = -0.85 + meleeProg * 1.7;
    } else if (p.animState === 'shoot') {
      armRot = 0.02;
    }
    ctx.rotate(armRot);
    ctx.fillStyle = jacket;
    rr(ctx, 0, -2.6, 11, 5.2, 2.4);
    ctx.fill();
    ctx.strokeStyle = jacketDark;
    ctx.lineWidth = 0.8;
    rr(ctx, 0, -2.6, 11, 5.2, 2.4);
    ctx.stroke();
    ctx.fillStyle = skin;
    rr(ctx, 10, -2.1, 3.6, 4.2, 1.6);
    ctx.fill();
    ctx.restore();

    // ── Head ──
    // Neck
    ctx.fillStyle = skinShade;
    rr(ctx, 2, -3.4, 5, 6.8, 2.2);
    ctx.fill();
    // Hair / hood back
    ctx.fillStyle = '#231c18';
    ctx.beginPath();
    ctx.arc(5.4, 0, 7.3, 0, TAU);
    ctx.fill();
    // Face
    ctx.fillStyle = skinShade;
    ctx.beginPath();
    ctx.arc(6.6, 0.4, 5.9, 0, TAU);
    ctx.fill();
    ctx.fillStyle = skin;
    ctx.beginPath();
    ctx.arc(7.5, -0.4, 5.2, 0, TAU);
    ctx.fill();
    // Hair fringe
    ctx.fillStyle = '#2b221c';
    ctx.beginPath();
    ctx.arc(5.1, -0.6, 6.2, Math.PI * 0.55, Math.PI * 1.62);
    ctx.lineTo(5.4, 0);
    ctx.closePath();
    ctx.fill();
    // Ear
    ctx.fillStyle = skinShade;
    ctx.beginPath();
    ctx.arc(4.6, 4.5, 2.1, 0, TAU);
    ctx.fill();
    // Brow / eye socket shadow
    ctx.fillStyle = 'rgba(40, 24, 18, 0.28)';
    ctx.beginPath();
    ctx.ellipse(9.2, -2, 2.6, 1.2, -0.25, 0, TAU);
    ctx.fill();
    // Nose
    ctx.fillStyle = skinShade;
    ctx.beginPath();
    ctx.moveTo(11.6, -0.6);
    ctx.lineTo(13.2, 0.2);
    ctx.lineTo(11.5, 1.1);
    ctx.closePath();
    ctx.fill();

    if (flash) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.20)';
      ctx.beginPath();
      ctx.arc(1, 0, 15, 0, TAU);
      ctx.fill();
    }

    ctx.restore();
  }

  public drawEquippedWeaponOnPlayer(
    ctx: CanvasRenderingContext2D,
    p: Pick<
      PlayerState,
      'x' | 'y' | 'angle' | 'animState' | 'meleeSwingTimer' | 'meleeSwingAngle'
    >,
    itemId: string | null
  ) {
    if (!itemId || p.animState === 'dead') return;
    const def = ITEMS[itemId];
    if (!def) return;

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.angle);

    if (def.category === 'weapon_ranged') {
      const recoil = p.animState === 'shoot' ? -2.4 : 0;
      const isShotgun = itemId === 'shotgun';
      const len = isShotgun ? 26 : itemId === 'revolver' ? 17 : 15;

      // Forearm grip shadow
      ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
      rr(ctx, 8 + recoil, 7.6, len, 2, 1);
      ctx.fill();

      if (isShotgun) {
        ctx.fillStyle = '#4a2f18';
        rr(ctx, 6 + recoil, 5.2, 12, 4, 1.5);
        ctx.fill();
        ctx.fillStyle = '#1e293b';
        rr(ctx, 12 + recoil, 5.4, len, 3.2, 1.2);
        ctx.fill();
        ctx.fillStyle = '#64748b';
        ctx.fillRect(16 + recoil, 4.9, len - 4, 1.8);
        ctx.fillStyle = '#94a3b8';
        ctx.fillRect(14 + recoil, 8.3, 8, 1.6);
        ctx.fillStyle = '#0f172a';
        rr(ctx, 10 + recoil, 8.6, 4, 2, 0.6);
        ctx.fill();
      } else {
        ctx.fillStyle = itemId === 'revolver' ? '#334155' : '#1e293b';
        rr(ctx, 9 + recoil, 5.2, len, 3.6, 1.2);
        ctx.fill();
        ctx.fillStyle = '#94a3b8';
        ctx.fillRect(13 + recoil, 5.7, len - 3, 1.5);
        ctx.fillStyle = '#0f172a';
        rr(ctx, 8 + recoil, 7.6, 4, 3.6, 1);
        ctx.fill();
        if (itemId === 'revolver') {
          ctx.fillStyle = '#64748b';
          ctx.beginPath();
          ctx.arc(13 + recoil, 7, 2.4, 0, TAU);
          ctx.fill();
        }
      }

      if (p.animState === 'shoot') {
        // Muzzle flash
        const mx = 12 + recoil + len;
        const my = 6.9;
        ctx.fillStyle = 'rgba(254, 240, 138, 0.92)';
        ctx.beginPath();
        ctx.moveTo(mx, my - 4.5);
        ctx.lineTo(mx + 8, my);
        ctx.lineTo(mx, my + 4.5);
        ctx.lineTo(mx + 2, my);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = 'rgba(251, 146, 60, 0.7)';
        ctx.beginPath();
        ctx.arc(mx + 2, my, 5, 0, TAU);
        ctx.fill();
      }
    } else if (def.category === 'weapon_melee') {
      const prog = p.meleeSwingTimer > 0 ? 1 - p.meleeSwingTimer / 0.22 : 0;
      const swingRot = p.meleeSwingTimer > 0 ? -0.9 + prog * 1.8 : 0.25;
      const isKnife = itemId === 'knife';
      const bladeLen = isKnife ? 15 : 23;

      ctx.save();
      ctx.translate(4, 7.4);
      ctx.rotate(swingRot);
      // Grip
      ctx.fillStyle = '#1f2937';
      rr(ctx, 5, -1.7, 6, 3.4, 1.2);
      ctx.fill();
      // Blade / shaft
      if (itemId === 'crowbar') {
        ctx.strokeStyle = '#b91c1c';
        ctx.lineWidth = 3.2;
        ctx.beginPath();
        ctx.moveTo(10, 0);
        ctx.lineTo(10 + bladeLen, -2);
        ctx.stroke();
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(11, -0.6);
        ctx.lineTo(9 + bladeLen, -2.2);
        ctx.stroke();
        ctx.strokeStyle = '#b91c1c';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(10 + bladeLen, -3.2, 2.4, 0.4, Math.PI * 1.7);
        ctx.stroke();
      } else if (itemId === 'bat') {
        ctx.fillStyle = '#a16a33';
        ctx.beginPath();
        ctx.moveTo(10, -1.4);
        ctx.lineTo(10 + bladeLen - 4, -2.8);
        ctx.lineTo(10 + bladeLen, -2);
        ctx.lineTo(10 + bladeLen, 2);
        ctx.lineTo(10 + bladeLen - 4, 2.8);
        ctx.lineTo(10, 1.4);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.18)';
        ctx.fillRect(12, -1, bladeLen - 5, 1);
      } else if (itemId === 'pipe_wrench') {
        ctx.strokeStyle = '#64748b';
        ctx.lineWidth = 3.4;
        ctx.beginPath();
        ctx.moveTo(10, 0);
        ctx.lineTo(8 + bladeLen, -1.5);
        ctx.stroke();
        ctx.fillStyle = '#cbd5e1';
        rr(ctx, 7 + bladeLen, -3.5, 5, 5, 1.5);
        ctx.fill();
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(9 + bladeLen, -2.5, 2, 3);
      } else {
        // Knife / machete
        ctx.fillStyle = '#cbd5e1';
        ctx.beginPath();
        ctx.moveTo(10, -1.6);
        ctx.lineTo(10 + bladeLen, -1);
        ctx.lineTo(11 + bladeLen, 0.6);
        ctx.lineTo(10, 1.6);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.65)';
        ctx.fillRect(11, -1.1, bladeLen - 2, 0.8);
        ctx.fillStyle = '#94a3b8';
        ctx.fillRect(9.5, -2.2, 1.6, 4.4);
      }
      ctx.restore();

      // Swing arc
      if (p.meleeSwingTimer > 0 && def.weaponStats?.arcAngle) {
        const arc = def.weaponStats.arcAngle;
        const g = ctx.createRadialGradient(0, 0, 8, 0, 0, def.weaponStats.range * 0.9);
        g.addColorStop(0, 'rgba(248, 250, 252, 0.02)');
        g.addColorStop(0.7, 'rgba(248, 250, 252, 0.16)');
        g.addColorStop(1, 'rgba(248, 250, 252, 0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, def.weaponStats.range * 0.9, p.meleeSwingAngle - arc * 0.5, p.meleeSwingAngle + arc * 0.5);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = 'rgba(248, 250, 252, 0.22)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(0, 0, def.weaponStats.range * 0.9, p.meleeSwingAngle - arc * 0.5, p.meleeSwingAngle + arc * 0.5);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  // ── ENEMIES ──────────────────────────────────────────────────────────────
  public drawEnemy(ctx: CanvasRenderingContext2D, e: EnemyEntity) {
    ctx.save();
    ctx.translate(e.x, e.y);

    if (e.state === 'DEAD') {
      this.drawEnemyDeath(ctx, e);
      ctx.restore();
      return;
    }

    const flash = e.hurtFlash > 0;

    if (e.enemyClass === 'crawler') {
      this.drawCrawler(ctx, e, flash);
    } else if (e.enemyClass === 'still') {
      this.drawStill(ctx, e, flash);
    } else if (e.enemyClass === 'bloom') {
      this.drawBloom(ctx, e, flash);
    } else {
      this.drawMimic(ctx, e, flash);
    }

    ctx.restore();
  }

  private drawCrawler(ctx: CanvasRenderingContext2D, e: EnemyEntity, flash: boolean) {
    const body = flash ? '#fca5a5' : '#3f4a57';
    const dark = flash ? '#b91c1c' : '#222a34';
    const pale = flash ? '#fecaca' : '#8e9aa8';
    const lunge = e.state === 'ATTACK' ? 3.5 : 0;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.46)';
    ctx.beginPath();
    ctx.ellipse(1, 4, e.radius + 6, e.radius * 0.72, 0, 0, TAU);
    ctx.fill();

    ctx.rotate(e.angle);
    const skitter = Math.sin(e.animTime * 17);

    // Splayed limbs
    ctx.lineCap = 'round';
    for (const side of [-1, 1]) {
      for (let i = 0; i < 2; i++) {
        const hipX = -7 + i * 9;
        const swing = skitter * (i === 0 ? 2.4 : -2.4);
        const kneeX = hipX + 4 + swing;
        const kneeY = side * (8 + i * 1.5);
        const footX = kneeX + 6 + swing * 0.6;
        const footY = side * (13 + Math.abs(swing) * 0.4);
        ctx.strokeStyle = dark;
        ctx.lineWidth = 2.6;
        ctx.beginPath();
        ctx.moveTo(hipX, side * 5);
        ctx.lineTo(kneeX, kneeY);
        ctx.lineTo(footX, footY);
        ctx.stroke();
        ctx.strokeStyle = pale;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(kneeX, kneeY);
        ctx.lineTo(footX, footY);
        ctx.stroke();
        // Claw
        ctx.fillStyle = pale;
        ctx.beginPath();
        ctx.moveTo(footX + 2, footY - 1.4);
        ctx.lineTo(footX + 5, footY);
        ctx.lineTo(footX + 2, footY + 1.4);
        ctx.closePath();
        ctx.fill();
      }
    }

    // Elongated torso
    const g = ctx.createLinearGradient(0, -8, 0, 8);
    g.addColorStop(0, flash ? '#fecaca' : '#4a5664');
    g.addColorStop(0.55, body);
    g.addColorStop(1, flash ? '#991b1b' : '#1c232c');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(-1, 0, 13, 8, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(8, 11, 15, 0.55)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Carapace segments
    ctx.strokeStyle = 'rgba(8, 11, 15, 0.45)';
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.arc(-6 + i * 5, 0, 7 - i * 0.8, -1.1, 1.1);
      ctx.stroke();
    }
    // Exposed spine
    ctx.strokeStyle = pale;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-10, 0);
    ctx.lineTo(5, 0);
    ctx.stroke();
    ctx.fillStyle = flash ? '#fecaca' : '#c7d2dd';
    for (let i = 0; i < 5; i++) {
      ctx.beginPath();
      ctx.arc(-9 + i * 3.6, 0, 1.2, 0, TAU);
      ctx.fill();
    }

    // Head
    ctx.fillStyle = flash ? '#fecaca' : '#55616f';
    ctx.beginPath();
    ctx.ellipse(10 + lunge, 0, 7.5, 6.2, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(8, 11, 15, 0.5)';
    ctx.stroke();

    // Mandibles
    const jaw = e.state === 'ATTACK' ? 3.5 : 1.2;
    ctx.strokeStyle = pale;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(13 + lunge, -4);
    ctx.quadraticCurveTo(18 + lunge, -5 - jaw, 20 + lunge, -1);
    ctx.moveTo(13 + lunge, 4);
    ctx.quadraticCurveTo(18 + lunge, 5 + jaw, 20 + lunge, 1);
    ctx.stroke();

    // Eyes
    const eyePulse = 0.6 + 0.4 * Math.sin(e.animTime * 6);
    for (const side of [-1, 1]) {
      ctx.fillStyle = `rgba(239, 68, 68, ${(0.25 + eyePulse * 0.35).toFixed(2)})`;
      ctx.beginPath();
      ctx.arc(12.5 + lunge, side * 2.7, 3.2, 0, TAU);
      ctx.fill();
      ctx.fillStyle = flash ? '#fee2e2' : '#ff5a5a';
      ctx.beginPath();
      ctx.arc(12.8 + lunge, side * 2.7, 1.5, 0, TAU);
      ctx.fill();
    }
    // Drool
    if (e.state === 'ATTACK' || e.state === 'CHASE') {
      ctx.fillStyle = 'rgba(190, 40, 40, 0.5)';
      ctx.fillRect(17 + lunge, -0.6, 4, 1.2);
    }
  }

  private drawStill(ctx: CanvasRenderingContext2D, e: EnemyEntity, flash: boolean) {
    // The corpse-disguise state is the whole point of this enemy.
    if (e.state === 'IDLE' && e.hurtFlash <= 0) {
      const twitch = Math.sin(e.animTime * 9) > 0.965 ? 1.6 : 0;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
      ctx.beginPath();
      ctx.ellipse(2, 5, 16, 9, 0.2, 0, TAU);
      ctx.fill();
      ctx.fillStyle = 'rgba(100, 20, 20, 0.5)';
      ctx.beginPath();
      ctx.ellipse(2, 4, 15, 10, 0.3, 0, TAU);
      ctx.fill();
      ctx.rotate(e.angle + 0.6);
      // Slumped coat
      ctx.fillStyle = '#3b4652';
      ctx.beginPath();
      ctx.ellipse(-1, 0, 13, 8, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#2b343e';
      ctx.beginPath();
      ctx.ellipse(-4, 1, 9, 6, 0, 0, TAU);
      ctx.fill();
      // Limp arm
      ctx.strokeStyle = '#46525f';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(-2, 5);
      ctx.lineTo(-10, 9);
      ctx.stroke();
      // Tilted head
      ctx.fillStyle = '#8a949f';
      ctx.beginPath();
      ctx.arc(10 + twitch, 2, 5.2, 0, TAU);
      ctx.fill();
      ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
      ctx.beginPath();
      ctx.arc(11.5 + twitch, 2.5, 3.4, 0, TAU);
      ctx.fill();
      return;
    }

    const lunge = e.state === 'ATTACK' ? 5 : 0;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.46)';
    ctx.beginPath();
    ctx.ellipse(1, 4, e.radius + 6, e.radius * 0.75, 0, 0, TAU);
    ctx.fill();

    ctx.rotate(e.angle);
    const lurch = Math.sin(e.animTime * 13) * 1.6;

    // Long legs
    ctx.strokeStyle = flash ? '#b91c1c' : '#28323d';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(-6, side * 4);
      ctx.lineTo(-13 - lurch * side, side * 7);
      ctx.lineTo(-18, side * 5);
      ctx.stroke();
    }

    // Tattered coat body
    const g = ctx.createLinearGradient(0, -8, 0, 8);
    g.addColorStop(0, flash ? '#fca5a5' : '#46525f');
    g.addColorStop(1, flash ? '#991b1b' : '#232b35');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(-1, 0, 10, 7.5, 0, 0, TAU);
    ctx.fill();
    // Ragged coat hem
    ctx.fillStyle = flash ? '#7f1d1d' : '#1c242d';
    for (let i = 0; i < 5; i++) {
      const a = -1.2 + i * 0.6;
      ctx.beginPath();
      ctx.moveTo(-6 + Math.cos(a) * 8, Math.sin(a) * 6);
      ctx.lineTo(-14 + Math.cos(a) * 6, Math.sin(a) * 7);
      ctx.lineTo(-8 + Math.cos(a) * 7, Math.sin(a) * 4);
      ctx.closePath();
      ctx.fill();
    }

    // Too-long arms reaching
    ctx.strokeStyle = flash ? '#ef4444' : '#3b4652';
    ctx.lineWidth = 3.6;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(2, side * 5.5);
      ctx.lineTo(11 + lunge, side * 10);
      ctx.lineTo(20 + lunge, side * (3 + lurch * 0.3));
      ctx.stroke();
      // Hand / claws
      const hx = 20 + lunge;
      const hy = side * (3 + lurch * 0.3);
      ctx.fillStyle = flash ? '#fecaca' : '#9aa5b1';
      ctx.beginPath();
      ctx.arc(hx, hy, 2.4, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = flash ? '#fecaca' : '#c7d2dd';
      ctx.lineWidth = 1.2;
      for (let f = -1; f <= 1; f++) {
        ctx.beginPath();
        ctx.moveTo(hx, hy);
        ctx.lineTo(hx + 5, hy + f * 2.4);
        ctx.stroke();
      }
      ctx.strokeStyle = flash ? '#ef4444' : '#3b4652';
      ctx.lineWidth = 3.6;
    }

    // Pale head
    ctx.fillStyle = flash ? '#fecaca' : '#8e99a5';
    ctx.beginPath();
    ctx.ellipse(9 + lunge * 0.4, 0, 6.8, 5.6, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.16)';
    ctx.beginPath();
    ctx.ellipse(7, 1.5, 4.6, 4, 0, 0, TAU);
    ctx.fill();
    // Hollow sockets
    for (const side of [-1, 1]) {
      ctx.fillStyle = '#0a0d11';
      ctx.beginPath();
      ctx.ellipse(12, side * 2.4, 2, 1.5, 0, 0, TAU);
      ctx.fill();
    }
    // Slit mouth
    ctx.fillStyle = '#1a0d0d';
    ctx.fillRect(12.5, -1.2, 3.2, 1.6);
  }

  private drawBloom(ctx: CanvasRenderingContext2D, e: EnemyEntity, flash: boolean) {
    const pulse = 1 + Math.sin(e.animTime * 3.2) * 0.075;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.48)';
    ctx.beginPath();
    ctx.ellipse(2, 5, e.radius + 8, e.radius * 0.8, 0, 0, TAU);
    ctx.fill();

    ctx.rotate(e.angle);
    ctx.scale(pulse, pulse);

    // Root tendrils
    ctx.strokeStyle = flash ? '#bef264' : '#2f4318';
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * TAU + e.animTime * 0.12;
      const r0 = 8;
      const r1 = e.radius + 8 + Math.sin(e.animTime * 2 + i) * 3;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
      ctx.quadraticCurveTo(
        Math.cos(a + 0.3) * (r1 * 0.7),
        Math.sin(a + 0.3) * (r1 * 0.7),
        Math.cos(a) * r1,
        Math.sin(a) * r1
      );
      ctx.stroke();
    }

    // Fleshy body
    const g = ctx.createRadialGradient(-4, -5, 2, 0, 0, e.radius + 4);
    g.addColorStop(0, flash ? '#fef08a' : '#5b6b2a');
    g.addColorStop(0.55, flash ? '#bef264' : '#3a4a1c');
    g.addColorStop(1, flash ? '#84cc16' : '#202c10');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(0, 0, e.radius + 2, e.radius - 1, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(12, 20, 8, 0.5)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Fungal caps
    const caps = [
      { x: -5, y: -7, r: 6 },
      { x: 5, y: -6, r: 5 },
      { x: 6, y: 5, r: 4.5 },
      { x: -6, y: 5, r: 4 },
      { x: 0, y: 1, r: 7 },
    ];
    for (const c of caps) {
      ctx.fillStyle = flash ? '#ecfccb' : '#7f9a3a';
      ctx.beginPath();
      ctx.arc(c.x, c.y, c.r, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = 'rgba(20, 30, 10, 0.55)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = flash ? '#ffffff' : '#c4d97a';
      ctx.beginPath();
      ctx.arc(c.x - c.r * 0.28, c.y - c.r * 0.3, c.r * 0.42, 0, TAU);
      ctx.fill();
      // Pores
      ctx.fillStyle = 'rgba(30, 40, 14, 0.5)';
      ctx.beginPath();
      ctx.arc(c.x + c.r * 0.25, c.y + c.r * 0.2, 1.2, 0, TAU);
      ctx.fill();
    }

    // Glowing sacs
    const glow = 0.55 + 0.4 * Math.sin(e.animTime * 4.4);
    for (const [gx, gy, gr] of [
      [-3, -2, 4.5],
      [4, 2, 3.5],
      [-1, 6, 2.6],
    ]) {
      ctx.fillStyle = `rgba(251, 146, 60, ${(0.18 + glow * 0.22).toFixed(2)})`;
      ctx.beginPath();
      ctx.arc(gx, gy, gr * 2.1, 0, TAU);
      ctx.fill();
      ctx.fillStyle = flash ? '#fff7ed' : '#fbbf24';
      ctx.beginPath();
      ctx.arc(gx, gy, gr, 0, TAU);
      ctx.fill();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
      ctx.beginPath();
      ctx.arc(gx - 1, gy - 1, gr * 0.35, 0, TAU);
      ctx.fill();
    }

    // Drifting spores
    ctx.fillStyle = flash ? 'rgba(236, 252, 203, 0.8)' : 'rgba(190, 242, 100, 0.55)';
    for (let i = 0; i < 9; i++) {
      const a = e.animTime * 0.7 + i * 1.9;
      const r = e.radius + 6 + Math.sin(e.animTime * 1.6 + i) * 6;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * r, Math.sin(a) * r * 0.8, 1.4, 0, TAU);
      ctx.fill();
    }
  }

  private drawMimic(ctx: CanvasRenderingContext2D, e: EnemyEntity, flash: boolean) {
    const sway = Math.sin(e.animTime * 9);
    const lunge = e.state === 'ATTACK' ? 5 : 0;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.beginPath();
    ctx.ellipse(1, 4, e.radius + 6, e.radius * 0.75, 0, 0, TAU);
    ctx.fill();

    ctx.rotate(e.angle);

    // Long legs
    ctx.strokeStyle = flash ? '#7f1d1d' : '#1c2229';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(-5, side * 4);
      ctx.lineTo(-12, side * (6 + sway * 0.8));
      ctx.lineTo(-17, side * 4);
      ctx.stroke();
    }

    // Narrow torso in stolen clothes
    const g = ctx.createLinearGradient(0, -7, 0, 7);
    g.addColorStop(0, flash ? '#fca5a5' : '#3a4757');
    g.addColorStop(1, flash ? '#991b1b' : '#161c24');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(-1, 0, 9.5, 6.8, 0, 0, TAU);
    ctx.fill();
    // Torn jacket collar
    ctx.fillStyle = flash ? '#7f1d1d' : '#24303c';
    ctx.beginPath();
    ctx.moveTo(4, -6);
    ctx.lineTo(9, -8);
    ctx.lineTo(7, -3);
    ctx.lineTo(10, 0);
    ctx.lineTo(6, 3);
    ctx.lineTo(9, 8);
    ctx.lineTo(3, 6);
    ctx.closePath();
    ctx.fill();

    // Over-long arms
    ctx.strokeStyle = flash ? '#ef4444' : '#2c3946';
    ctx.lineWidth = 3.4;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(1, side * 5.5);
      ctx.lineTo(11 + lunge, side * (9 + sway * 0.6));
      ctx.lineTo(22 + lunge, side * (2 + sway * 0.9));
      ctx.stroke();
      const hx = 22 + lunge;
      const hy = side * (2 + sway * 0.9);
      ctx.fillStyle = flash ? '#fecaca' : '#b9c2cc';
      ctx.beginPath();
      ctx.ellipse(hx, hy, 2.6, 2.1, 0, 0, TAU);
      ctx.fill();
      // Fingers
      ctx.strokeStyle = flash ? '#fecaca' : '#d6dde5';
      ctx.lineWidth = 1;
      for (let f = -1; f <= 1; f++) {
        ctx.beginPath();
        ctx.moveTo(hx, hy);
        ctx.lineTo(hx + 6, hy + f * 2.2);
        ctx.stroke();
      }
      ctx.strokeStyle = flash ? '#ef4444' : '#2c3946';
      ctx.lineWidth = 3.4;
    }

    // Elongated mask-like head
    ctx.fillStyle = flash ? '#fecaca' : '#a8b2bd';
    ctx.beginPath();
    ctx.ellipse(9.5 + lunge * 0.5, 0, 7.6, 5.4, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(20, 26, 33, 0.22)';
    ctx.beginPath();
    ctx.ellipse(7.5, 1.2, 5, 4, 0, 0, TAU);
    ctx.fill();
    // Black eyes
    for (const side of [-1, 1]) {
      ctx.fillStyle = '#080b0f';
      ctx.beginPath();
      ctx.ellipse(11.5 + lunge * 0.5, side * 2.1, 2.1, 1.7, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = 'rgba(239, 68, 68, 0.5)';
      ctx.beginPath();
      ctx.arc(12 + lunge * 0.5, side * 2.1, 0.7, 0, TAU);
      ctx.fill();
    }
    // Stitched grin
    ctx.strokeStyle = '#2a1111';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(11 + lunge * 0.5, 0, 3.4, -0.9, 0.9);
    ctx.stroke();
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath();
      ctx.moveTo(13.5 + lunge * 0.5, i * 1.2);
      ctx.lineTo(15 + lunge * 0.5, i * 1.2);
      ctx.stroke();
    }
  }

  private drawEnemyDeath(ctx: CanvasRenderingContext2D, e: EnemyEntity) {
    const isBloom = e.enemyClass === 'bloom';
    const pool = isBloom ? 'rgba(101, 163, 13, 0.52)' : 'rgba(110, 20, 20, 0.62)';
    const dark = isBloom ? '#2f3f16' : '#2a323c';
    const rand = rngFrom(0x27d4eb2f ^ e.id.length * 977);

    ctx.fillStyle = pool;
    ctx.beginPath();
    ctx.ellipse(1, 3, e.radius + 10, e.radius * 0.82, 0.2, 0, TAU);
    ctx.fill();
    ctx.fillStyle = isBloom ? 'rgba(63, 98, 18, 0.55)' : 'rgba(61, 8, 8, 0.6)';
    ctx.beginPath();
    ctx.ellipse(0, 3, e.radius * 0.7, e.radius * 0.5, 0.2, 0, TAU);
    ctx.fill();

    ctx.rotate(e.angle + 0.5);
    ctx.fillStyle = dark;
    if (isBloom) {
      ctx.beginPath();
      ctx.ellipse(0, 0, e.radius, e.radius * 0.6, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = 'rgba(132, 204, 22, 0.35)';
      for (let i = 0; i < 5; i++) {
        const a = rand() * TAU;
        ctx.beginPath();
        ctx.arc(Math.cos(a) * e.radius * 0.6, Math.sin(a) * e.radius * 0.4, 2 + rand() * 3, 0, TAU);
        ctx.fill();
      }
    } else {
      ctx.beginPath();
      ctx.ellipse(-2, 0, e.radius * 0.95, e.radius * 0.52, 0, 0, TAU);
      ctx.fill();
      // Limbs
      ctx.strokeStyle = dark;
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      for (let i = 0; i < 3; i++) {
        const a = -0.8 + i * 0.8;
        ctx.beginPath();
        ctx.moveTo(-2, 0);
        ctx.lineTo(-2 + Math.cos(a) * e.radius * 1.4, Math.sin(a) * e.radius * 1.1);
        ctx.stroke();
      }
      // Head
      ctx.fillStyle = isBloom ? dark : '#6d7884';
      ctx.beginPath();
      ctx.arc(e.radius * 0.7, 0, 4.5, 0, TAU);
      ctx.fill();
    }
  }

  /** Ground-space attack windup wedge; drawn before the darkness pass. */
  public drawEnemyTelegraph(ctx: CanvasRenderingContext2D, e: EnemyEntity) {
    if (e.state !== 'ATTACK' || e.windupTimer <= 0) return;
    const arch = ENEMY_ARCHETYPES[e.enemyClass];
    const total = Math.max(0.001, arch.attackWindup);
    const prog = Math.max(0, Math.min(1, 1 - e.windupTimer / total));
    const reach = arch.attackRange + e.radius;
    const half = 0.52;

    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.rotate(e.angle);

    const g = ctx.createRadialGradient(0, 0, e.radius * 0.3, 0, 0, reach);
    g.addColorStop(0, `rgba(239, 68, 68, ${(0.03 + prog * 0.07).toFixed(3)})`);
    g.addColorStop(1, `rgba(239, 68, 68, ${(0.12 + prog * 0.24).toFixed(3)})`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, reach, -half, half);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = `rgba(248, 113, 113, ${(0.25 + prog * 0.55).toFixed(2)})`;
    ctx.lineWidth = 1.5 + prog * 1.5;
    ctx.beginPath();
    ctx.arc(0, 0, reach, -half, half);
    ctx.stroke();

    // Closing brackets
    ctx.lineWidth = 2;
    for (const side of [-1, 1]) {
      const a = side * half;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * reach * 0.55, Math.sin(a) * reach * 0.55);
      ctx.lineTo(Math.cos(a) * reach, Math.sin(a) * reach);
      ctx.stroke();
    }

    // Charging core ring
    ctx.strokeStyle = `rgba(254, 202, 202, ${(0.2 + prog * 0.5).toFixed(2)})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, 0, e.radius + 3 + prog * 7, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }

  /** Screen-legible status pass, drawn after the darkness composite. */
  public drawEnemyOverlay(ctx: CanvasRenderingContext2D, e: EnemyEntity, timeSec: number) {
    if (e.state === 'DEAD') return;

    const topY = e.y - e.radius - 17;
    const hurt = e.health < e.maxHealth - 0.01;
    const alerted =
      e.state === 'ALERT' || e.state === 'CHASE' || e.state === 'ATTACK' || e.state === 'SEARCH';

    if (hurt || alerted) {
      const bw = 30;
      const ratio = Math.max(0, Math.min(1, e.health / Math.max(1, e.maxHealth)));
      ctx.fillStyle = 'rgba(6, 9, 13, 0.86)';
      rr(ctx, e.x - bw / 2 - 1, topY - 1, bw + 2, 6, 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(148, 163, 184, 0.22)';
      ctx.fillRect(e.x - bw / 2, topY, bw, 4);
      ctx.fillStyle =
        e.enemyClass === 'bloom'
          ? '#84cc16'
          : e.enemyClass === 'mimic'
          ? '#f97316'
          : '#dc2626';
      ctx.fillRect(e.x - bw / 2, topY, bw * ratio, 4);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
      ctx.fillRect(e.x - bw / 2, topY, bw * ratio, 1);
      // Segment ticks
      ctx.fillStyle = 'rgba(6, 9, 13, 0.55)';
      for (let i = 1; i < 4; i++) ctx.fillRect(e.x - bw / 2 + (bw * i) / 4, topY, 1, 4);
    }

    let glyph = '';
    let color = 'rgba(148, 163, 184, 1)';
    if (e.state === 'SUSPICIOUS') {
      glyph = '?';
      color = 'rgba(251, 191, 36, 1)';
    } else if (e.state === 'ALERT') {
      glyph = '!';
      color = 'rgba(249, 115, 22, 1)';
    } else if (e.state === 'CHASE' || e.state === 'ATTACK') {
      glyph = '!';
      color = 'rgba(239, 68, 68, 1)';
    } else if (e.state === 'SEARCH') {
      glyph = '·';
      color = 'rgba(148, 163, 184, 0.9)';
    }

    if (glyph) {
      const pulse = 0.7 + 0.3 * Math.sin(timeSec * 6);
      const gy = topY - 11;
      ctx.save();
      ctx.translate(e.x, gy);
      ctx.globalAlpha = pulse;
      ctx.fillStyle = 'rgba(6, 9, 13, 0.86)';
      ctx.beginPath();
      ctx.moveTo(0, -7);
      ctx.lineTo(6, 0);
      ctx.lineTo(0, 7);
      ctx.lineTo(-6, 0);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.font = '700 9px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(glyph, 0, 0.5);
      ctx.restore();
    }
  }

  // ── STREET LIGHTS ────────────────────────────────────────────────────────
  public drawStreetLight(
    ctx: CanvasRenderingContext2D,
    sl: StreetLight,
    timeSec: number,
    powered: boolean
  ) {
    const lit = sl.emergencyOnly || powered;
    const flicker =
      Math.sin(timeSec * 9 + sl.flickerSeed) > 0.93 ? 0.45 : 1;

    ctx.save();
    ctx.translate(sl.x, sl.y);

    // Pool of light on the ground
    if (lit) {
      const rad = sl.radius * 0.6;
      const g = ctx.createRadialGradient(0, 0, 2, 0, 0, rad);
      const col = sl.emergencyOnly ? '220, 38, 38' : '251, 191, 36';
      g.addColorStop(0, `rgba(${col}, ${(0.16 * flicker).toFixed(3)})`);
      g.addColorStop(0.55, `rgba(${col}, ${(0.07 * flicker).toFixed(3)})`);
      g.addColorStop(1, `rgba(${col}, 0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, rad, 0, TAU);
      ctx.fill();
    }

    // Base plate
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.beginPath();
    ctx.ellipse(3, 5, 9, 6, 0.3, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#2b323b';
    ctx.beginPath();
    ctx.arc(0, 0, 7, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = '#11161d';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    // Bolts
    ctx.fillStyle = '#475569';
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU + 0.4;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * 4.5, Math.sin(a) * 4.5, 1, 0, TAU);
      ctx.fill();
    }
    // Pole
    ctx.fillStyle = '#39424e';
    ctx.beginPath();
    ctx.arc(-1, -1, 3.4, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(226, 232, 240, 0.18)';
    ctx.beginPath();
    ctx.arc(-2, -2, 1.4, 0, TAU);
    ctx.fill();

    // Lamp arm + head
    ctx.strokeStyle = '#39424e';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(11, -8);
    ctx.stroke();
    ctx.fillStyle = '#242b34';
    rr(ctx, 8, -13, 9, 6, 2.4);
    ctx.fill();
    ctx.strokeStyle = '#0f1318';
    ctx.lineWidth = 1;
    rr(ctx, 8, -13, 9, 6, 2.4);
    ctx.stroke();
    // Lens
    ctx.fillStyle = lit
      ? sl.emergencyOnly
        ? `rgba(248, 113, 113, ${(0.75 + 0.25 * flicker).toFixed(2)})`
        : `rgba(254, 240, 138, ${(0.75 + 0.25 * flicker).toFixed(2)})`
      : '#1f2937';
    rr(ctx, 9.5, -11.6, 6, 3, 1.2);
    ctx.fill();
    if (lit) {
      const halo = ctx.createRadialGradient(12.5, -10, 1, 12.5, -10, 16);
      const col = sl.emergencyOnly ? '248, 113, 113' : '254, 240, 138';
      halo.addColorStop(0, `rgba(${col}, ${(0.28 * flicker).toFixed(2)})`);
      halo.addColorStop(1, `rgba(${col}, 0)`);
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(12.5, -10, 16, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  // ── ROOF CANOPY ──────────────────────────────────────────────────────────
  public drawRoof(
    ctx: CanvasRenderingContext2D,
    room: { district: string; name: string; tx: number; ty: number; tw: number; th: number },
    rx: number,
    ry: number,
    rw: number,
    rh: number,
    alpha: number
  ) {
    if (alpha <= 0.02) return;
    const village = room.district === 'village';
    const rand = rngFrom(0x68e31da4 ^ Math.floor(rx * 13 + ry * 31));
    ctx.save();
    ctx.globalAlpha = alpha;

    // Roof deck
    const base = village ? '#241d17' : '#151b24';
    const g = ctx.createLinearGradient(rx, ry, rx + rw, ry + rh);
    g.addColorStop(0, this.lighten(base, 0.10));
    g.addColorStop(0.55, base);
    g.addColorStop(1, this.lighten(base, -0.18));
    ctx.fillStyle = g;
    ctx.fillRect(rx + 4, ry + 4, rw - 8, rh - 8);

    // Shingle / panel courses
    const rowH = village ? 12 : 18;
    ctx.strokeStyle = village ? 'rgba(0,0,0,0.22)' : 'rgba(0,0,0,0.28)';
    ctx.lineWidth = 1;
    for (let y = ry + 8; y < ry + rh - 8; y += rowH) {
      ctx.beginPath();
      ctx.moveTo(rx + 6, y);
      ctx.lineTo(rx + rw - 6, y);
      ctx.stroke();
    }
    if (village) {
      // Staggered shingle joints
      for (let y = ry + 8, row = 0; y < ry + rh - 8; y += rowH, row++) {
        for (let x = rx + 8 + (row % 2) * 9; x < rx + rw - 8; x += 18) {
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x, y + rowH);
          ctx.stroke();
        }
      }
    } else {
      // Tar seams and gravel speckle
      for (let i = 0; i < 40; i++) {
        ctx.fillStyle = rand() > 0.5 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.14)';
        ctx.fillRect(rx + 8 + rand() * (rw - 16), ry + 8 + rand() * (rh - 16), 1.5, 1.5);
      }
    }

    // Parapet / fascia
    ctx.strokeStyle = village ? '#3a2b20' : '#2a3442';
    ctx.lineWidth = 4;
    ctx.strokeRect(rx + 4, ry + 4, rw - 8, rh - 8);
    ctx.strokeStyle = village ? 'rgba(255, 214, 165, 0.10)' : 'rgba(148, 197, 253, 0.10)';
    ctx.lineWidth = 1;
    ctx.strokeRect(rx + 6.5, ry + 6.5, rw - 13, rh - 13);

    // Rooftop clutter
    const unitCount = Math.min(4, Math.floor((rw * rh) / 18000));
    for (let i = 0; i < unitCount; i++) {
      const ux = rx + 22 + rand() * Math.max(8, rw - 60);
      const uy = ry + 22 + rand() * Math.max(8, rh - 60);
      const uw = 16 + rand() * 14;
      const uh = 12 + rand() * 10;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
      ctx.fillRect(ux + 2, uy + 3, uw, uh);
      ctx.fillStyle = village ? '#3a3129' : '#2f3a47';
      rr(ctx, ux, uy, uw, uh, 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.45)';
      ctx.lineWidth = 1;
      rr(ctx, ux, uy, uw, uh, 2);
      ctx.stroke();
      // Vent grille
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      for (let v = 0; v < 3; v++) {
        ctx.fillRect(ux + 3, uy + 3 + v * 3, uw - 6, 1);
      }
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(ux + 1, uy + 1, uw - 2, 1);
    }

    // Skylight
    if (rw > 120 && rh > 100 && rand() > 0.5) {
      const sx = rx + rw * 0.55;
      const sy = ry + rh * 0.3;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
      ctx.fillRect(sx + 2, sy + 3, 26, 18);
      ctx.fillStyle = '#0d1720';
      ctx.fillRect(sx, sy, 26, 18);
      ctx.strokeStyle = 'rgba(125, 211, 252, 0.30)';
      ctx.lineWidth = 1;
      ctx.strokeRect(sx + 0.5, sy + 0.5, 25, 17);
      ctx.fillStyle = 'rgba(125, 211, 252, 0.08)';
      ctx.fillRect(sx + 2, sy + 2, 22, 14);
    }

    // Nameplate
    const plateW = Math.min(rw - 28, 180);
    const plateH = 20;
    const px = rx + rw * 0.5 - plateW * 0.5;
    const py = ry + rh * 0.5 - plateH * 0.5;
    ctx.fillStyle = 'rgba(5, 8, 12, 0.55)';
    rr(ctx, px, py, plateW, plateH, 3);
    ctx.fill();
    ctx.strokeStyle = village ? 'rgba(214, 178, 130, 0.28)' : 'rgba(148, 163, 184, 0.24)';
    ctx.lineWidth = 1;
    rr(ctx, px, py, plateW, plateH, 3);
    ctx.stroke();
    ctx.fillStyle = village ? 'rgba(231, 205, 170, 0.72)' : 'rgba(203, 213, 225, 0.72)';
    ctx.font = '600 11px "Barlow Condensed", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(room.name.toUpperCase(), rx + rw * 0.5, py + plateH * 0.5 + 0.5);

    ctx.restore();
  }

  // ── RESCUE HELICOPTER ────────────────────────────────────────────────────
  public drawHelicopter(
    ctx: CanvasRenderingContext2D,
    hx: number,
    hy: number,
    rotorAngle: number,
    timeSec: number
  ) {
    ctx.save();
    ctx.translate(hx, hy);
    ctx.rotate(-0.35);

    // Ground shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.42)';
    ctx.beginPath();
    ctx.ellipse(16, 22, 72, 28, 0, 0, TAU);
    ctx.fill();

    // Tail boom
    const tail = ctx.createLinearGradient(-100, 0, -30, 0);
    tail.addColorStop(0, '#26313d');
    tail.addColorStop(1, '#3b4a5a');
    ctx.fillStyle = tail;
    ctx.beginPath();
    ctx.moveTo(-96, -5);
    ctx.lineTo(-34, -9);
    ctx.lineTo(-34, 9);
    ctx.lineTo(-96, 5);
    ctx.closePath();
    ctx.fill();
    // Tail fin
    ctx.fillStyle = '#2f3c4a';
    ctx.beginPath();
    ctx.moveTo(-98, -2);
    ctx.lineTo(-112, -14);
    ctx.lineTo(-104, 2);
    ctx.closePath();
    ctx.fill();
    // Tail rotor blur
    ctx.strokeStyle = 'rgba(226, 232, 240, 0.35)';
    ctx.lineWidth = 1.5;
    const tr = Math.abs(Math.sin(timeSec * 34)) * 9 + 3;
    ctx.beginPath();
    ctx.moveTo(-108, -tr);
    ctx.lineTo(-108, tr);
    ctx.stroke();
    // Tail stripe
    ctx.fillStyle = '#f59e0b';
    ctx.beginPath();
    ctx.moveTo(-84, -6);
    ctx.lineTo(-70, -7);
    ctx.lineTo(-70, 7);
    ctx.lineTo(-84, 6);
    ctx.closePath();
    ctx.fill();

    // Fuselage
    const body = ctx.createLinearGradient(0, -24, 0, 24);
    body.addColorStop(0, '#5b6b7c');
    body.addColorStop(0.45, '#3e4c5c');
    body.addColorStop(1, '#202a35');
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.ellipse(-2, 0, 48, 22, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = '#141b23';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Nose
    ctx.fillStyle = '#4a5a6b';
    ctx.beginPath();
    ctx.ellipse(30, 0, 22, 16, 0, -Math.PI / 2, Math.PI / 2);
    ctx.fill();

    // Cockpit glass
    const glass = ctx.createLinearGradient(20, -14, 46, 14);
    glass.addColorStop(0, '#2b4a5e');
    glass.addColorStop(0.5, '#0e1a24');
    glass.addColorStop(1, '#31536a');
    ctx.fillStyle = glass;
    ctx.beginPath();
    ctx.ellipse(28, 0, 17, 13, 0, -Math.PI / 2, Math.PI / 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(125, 211, 252, 0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(28, 0, 17, 13, 0, -Math.PI / 2, Math.PI / 2);
    ctx.stroke();
    // Glass highlight
    ctx.fillStyle = 'rgba(186, 230, 253, 0.22)';
    ctx.beginPath();
    ctx.ellipse(31, -3, 8, 4, -0.5, 0, TAU);
    ctx.fill();

    // Livery stripe
    ctx.fillStyle = '#f59e0b';
    ctx.fillRect(-30, -3, 34, 6);
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(-30, -3, 34, 1);

    // Skids
    ctx.strokeStyle = '#1a222c';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-14, 24);
    ctx.lineTo(30, 24);
    ctx.moveTo(-14, -24);
    ctx.lineTo(30, -24);
    ctx.stroke();
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 16);
    ctx.lineTo(0, 24);
    ctx.moveTo(0, -16);
    ctx.lineTo(0, -24);
    ctx.stroke();

    // Navigation lights
    const blink = Math.sin(timeSec * 12) > 0;
    ctx.fillStyle = blink ? '#ef4444' : '#5c0f0f';
    ctx.beginPath();
    ctx.arc(-96, 0, 3.5, 0, TAU);
    ctx.fill();
    if (blink) {
      ctx.fillStyle = 'rgba(239, 68, 68, 0.22)';
      ctx.beginPath();
      ctx.arc(-96, 0, 9, 0, TAU);
      ctx.fill();
    }
    ctx.fillStyle = blink ? '#22c55e' : '#0f3d22';
    ctx.beginPath();
    ctx.arc(42, 0, 2.5, 0, TAU);
    ctx.fill();

    // Rotor disc
    ctx.fillStyle = 'rgba(226, 232, 240, 0.055)';
    ctx.beginPath();
    ctx.arc(0, 0, 88, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(226, 232, 240, 0.10)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, 88, 0, TAU);
    ctx.stroke();

    // Spinning blades (motion-blurred pair)
    ctx.rotate(rotorAngle);
    ctx.fillStyle = 'rgba(15, 23, 42, 0.72)';
    ctx.fillRect(-88, -3.2, 176, 6.4);
    ctx.fillRect(-3.2, -88, 6.4, 176);
    ctx.fillStyle = 'rgba(148, 163, 184, 0.22)';
    ctx.fillRect(-88, -1, 176, 1);
    ctx.fillRect(-1, -88, 1, 176);
    // Hub
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.arc(0, 0, 6, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#475569';
    ctx.beginPath();
    ctx.arc(0, 0, 3, 0, TAU);
    ctx.fill();

    ctx.restore();
  }
}
