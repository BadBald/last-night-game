import { CONFIG } from '../config';
import {
  isSolidTile,
  tileBlocksBullets,
  tileBlocksSight,
  WorldMapData,
} from '../data/map';
import { ObstacleProp, TileType } from '../types';

export function getTileAtPixel(world: WorldMapData, px: number, py: number): TileType {
  const tx = Math.floor(px / CONFIG.TILE_SIZE);
  const ty = Math.floor(py / CONFIG.TILE_SIZE);
  if (tx < 0 || tx >= world.width || ty < 0 || ty >= world.height) {
    return TileType.WALL_EXTERIOR;
  }
  return world.tiles[ty * world.width + tx] as TileType;
}

function circleIntersectsRect(
  cx: number,
  cy: number,
  cr: number,
  rx: number,
  ry: number,
  rw: number,
  rh: number
): boolean {
  const closestX = Math.max(rx, Math.min(cx, rx + rw));
  const closestY = Math.max(ry, Math.min(cy, ry + rh));
  const dx = cx - closestX;
  const dy = cy - closestY;
  return dx * dx + dy * dy < cr * cr;
}

export function resolveCircleWorldCollision(
  world: WorldMapData,
  x: number,
  y: number,
  radius: number
): { x: number; y: number; collided: boolean } {
  let nx = x;
  let ny = y;
  let collided = false;
  const T = CONFIG.TILE_SIZE;

  // Check surrounding 3x3 or 5x5 tile neighborhood
  const minTx = Math.max(0, Math.floor((nx - radius - 4) / T));
  const maxTx = Math.min(world.width - 1, Math.floor((nx + radius + 4) / T));
  const minTy = Math.max(0, Math.floor((ny - radius - 4) / T));
  const maxTy = Math.min(world.height - 1, Math.floor((ny + radius + 4) / T));

  const pushOutFromRect = (rx: number, ry: number, rw: number, rh: number) => {
    const closestX = Math.max(rx, Math.min(nx, rx + rw));
    const closestY = Math.max(ry, Math.min(ny, ry + rh));
    const dx = nx - closestX;
    const dy = ny - closestY;
    const distSq = dx * dx + dy * dy;
    if (distSq < radius * radius) {
      collided = true;
      const dist = Math.sqrt(distSq);
      if (dist > 0.0001) {
        const overlap = radius - dist;
        nx += (dx / dist) * overlap;
        ny += (dy / dist) * overlap;
      } else {
        // Center is inside rect: push out along shallowest axis
        const leftPen = nx - rx;
        const rightPen = rx + rw - nx;
        const topPen = ny - ry;
        const bottomPen = ry + rh - ny;
        const minPen = Math.min(leftPen, rightPen, topPen, bottomPen);
        if (minPen === leftPen) nx = rx - radius;
        else if (minPen === rightPen) nx = rx + rw + radius;
        else if (minPen === topPen) ny = ry - radius;
        else ny = ry + rh + radius;
      }
    }
  };

  for (let ty = minTy; ty <= maxTy; ty++) {
    for (let tx = minTx; tx <= maxTx; tx++) {
      const t = world.tiles[ty * world.width + tx] as TileType;
      if (isSolidTile(t)) {
        pushOutFromRect(tx * T, ty * T, T, T);
      }
    }
  }

  // Also resolve against solid props near entity
  for (let i = 0; i < world.props.length; i++) {
    const p = world.props[i];
    if (!p.solid) continue;
    if (
      nx + radius < p.x ||
      nx - radius > p.x + p.w ||
      ny + radius < p.y ||
      ny - radius > p.y + p.h
    ) {
      continue;
    }
    pushOutFromRect(p.x, p.y, p.w, p.h);
  }

  // Clamp strictly inside world bounds
  nx = Math.max(T + radius, Math.min(world.width * T - T - radius, nx));
  ny = Math.max(T + radius, Math.min(world.height * T - T - radius, ny));

  return { x: nx, y: ny, collided };
}

/**
 * Checks clean line-of-sight between (x1, y1) and (x2, y2).
 * Solid walls, closed doors, and tall sight-blocking props occlude sight.
 */
export function hasLineOfSight(
  world: WorldMapData,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): boolean {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dist = Math.hypot(dx, dy);
  if (dist < 4) return true;

  const stepSize = 12;
  const steps = Math.ceil(dist / stepSize);
  const sx = dx / steps;
  const sy = dy / steps;
  const T = CONFIG.TILE_SIZE;

  let cx = x1;
  let cy = y1;
  for (let i = 1; i < steps; i++) {
    cx += sx;
    cy += sy;
    const tx = Math.floor(cx / T);
    const ty = Math.floor(cy / T);
    if (tx < 0 || tx >= world.width || ty < 0 || ty >= world.height) return false;
    const t = world.tiles[ty * world.width + tx] as TileType;
    if (tileBlocksSight(t)) return false;

    for (let j = 0; j < world.props.length; j++) {
      const p: ObstacleProp = world.props[j];
      if (!p.blocksSight) continue;
      if (cx >= p.x && cx <= p.x + p.w && cy >= p.y && cy <= p.y + p.h) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Casts a single visibility ray from (ox, oy) at angle up to maxDist, returning hit distance.
 */
export function castVisibilityRay(
  world: WorldMapData,
  ox: number,
  oy: number,
  angle: number,
  maxDist: number
): number {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const step = 10;
  const T = CONFIG.TILE_SIZE;
  let d = 8;

  while (d < maxDist) {
    const px = ox + cos * d;
    const py = oy + sin * d;
    const tx = Math.floor(px / T);
    const ty = Math.floor(py / T);
    if (tx < 0 || tx >= world.width || ty < 0 || ty >= world.height) {
      return d;
    }
    const t = world.tiles[ty * world.width + tx] as TileType;
    if (tileBlocksSight(t)) {
      // Binary refine last 10px for crisp wall edges
      let lo = d - step;
      let hi = d;
      for (let k = 0; k < 4; k++) {
        const mid = (lo + hi) * 0.5;
        const mx = Math.floor((ox + cos * mid) / T);
        const my = Math.floor((oy + sin * mid) / T);
        if (
          mx < 0 ||
          mx >= world.width ||
          my < 0 ||
          my >= world.height ||
          tileBlocksSight(world.tiles[my * world.width + mx] as TileType)
        ) {
          hi = mid;
        } else {
          lo = mid;
        }
      }
      return hi;
    }
    d += step;
  }
  return maxDist;
}

export function pointHitsBulletBlocker(
  world: WorldMapData,
  px: number,
  py: number
): { hit: boolean; hitWindowTx?: number; hitWindowTy?: number } {
  const T = CONFIG.TILE_SIZE;
  const tx = Math.floor(px / T);
  const ty = Math.floor(py / T);
  if (tx < 0 || tx >= world.width || ty < 0 || ty >= world.height) {
    return { hit: true };
  }
  const t = world.tiles[ty * world.width + tx] as TileType;
  if (t === TileType.WINDOW) {
    return { hit: true, hitWindowTx: tx, hitWindowTy: ty };
  }
  if (tileBlocksBullets(t)) {
    return { hit: true };
  }
  for (let i = 0; i < world.props.length; i++) {
    const p = world.props[i];
    if (!p.blocksBullets) continue;
    if (circleIntersectsRect(px, py, 2, p.x, p.y, p.w, p.h)) {
      return { hit: true };
    }
  }
  return { hit: false };
}
