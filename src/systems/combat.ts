import { CONFIG } from '../config';
import { ITEMS } from '../data/items';
import { WorldMapData } from '../data/map';
import { SoundEngine, WeaponHitKind } from '../engine/audio';
import {
  hasLineOfSight,
  pointHitsBulletBlocker,
  resolveCircleWorldCollision,
} from '../engine/collision';
import {
  EnemyEntity,
  InventoryItemInstance,
  PlayerState,
  Projectile,
  RemoteSurvivorState,
  TileType,
} from '../types';
import { consumeItemQuantity, countItemInBackpack } from './inventory';

export interface CombatCallbacks {
  emitNoise: (x: number, y: number, radius: number, intensity: number, label: string) => void;
  spawnParticles: (
    x: number,
    y: number,
    count: number,
    color: string,
    speed: number,
    life?: number
  ) => void;
  triggerShake: (amount: number) => void;
  triggerHitstop: (duration: number) => void;
  onEnemyKilled: (enemy: EnemyEntity) => void;
  onShotFired: () => void;
  onShotHit: () => void;
  showToast: (title: string, text: string, urgent?: boolean) => void;
  onLocalAttack?: (data: {
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
  onWindowBroken?: (tx: number, ty: number) => void;
  onPvpHit?: (
    target: RemoteSurvivorState,
    rawDamage: number,
    weaponName: string,
    bleedChance: number,
    hitId: string
  ) => void;
}

let hitSeqCounter = 1;
function nextHitId(): string {
  hitSeqCounter += 1;
  return `hit_${Date.now().toString(36)}_${hitSeqCounter}_${Math.random().toString(36).slice(2, 6)}`;
}

function getMeleeHitKind(weaponId: string | null): WeaponHitKind {
  if (!weaponId) return 'unarmed';
  if (weaponId === 'knife' || weaponId === 'axe') return 'blade';
  if (weaponId === 'pipe_wrench' || weaponId === 'pipe' || weaponId === 'crowbar' || weaponId === 'bat') {
    return 'blunt_metal';
  }
  return 'blunt_wood';
}

export function startWeaponReload(
  player: PlayerState,
  backpack: (InventoryItemInstance | null)[],
  sound: SoundEngine
): boolean {
  if (player.isReloading || player.equippedSlot === null) return false;
  const inst = backpack[player.equippedSlot];
  if (!inst) return false;
  const def = ITEMS[inst.itemId];
  if (!def || def.category !== 'weapon_ranged' || !def.weaponStats?.ammoItemId || !def.weaponStats.magSize) {
    return false;
  }

  const currentLoaded = inst.loadedAmmo ?? 0;
  if (currentLoaded >= def.weaponStats.magSize) return false;

  const available = countItemInBackpack(backpack, def.weaponStats.ammoItemId);
  if (available <= 0) return false;

  player.isReloading = true;
  player.reloadDuration = def.weaponStats.reloadTime ?? 1.6;
  player.reloadTimer = player.reloadDuration;
  player.animState = 'reload';
  sound.playReload(inst.itemId, 'start');
  return true;
}

export function updateReloadTimer(
  dt: number,
  player: PlayerState,
  backpack: (InventoryItemInstance | null)[],
  sound: SoundEngine
) {
  if (!player.isReloading) return;
  if (player.equippedSlot === null) {
    player.isReloading = false;
    return;
  }
  const inst = backpack[player.equippedSlot];
  if (!inst) {
    player.isReloading = false;
    return;
  }
  const def = ITEMS[inst.itemId];
  if (!def?.weaponStats?.ammoItemId || !def.weaponStats.magSize) {
    player.isReloading = false;
    return;
  }

  player.reloadTimer -= dt;
  if (player.reloadTimer <= 0) {
    player.isReloading = false;
    const needed = def.weaponStats.magSize - (inst.loadedAmmo ?? 0);
    if (needed > 0) {
      const loaded = consumeItemQuantity(backpack, def.weaponStats.ammoItemId, needed);
      inst.loadedAmmo = (inst.loadedAmmo ?? 0) + loaded;
      sound.playReload(inst.itemId, 'finish');
    }
  }
}

export function performPlayerAttack(
  player: PlayerState,
  backpack: (InventoryItemInstance | null)[],
  world: WorldMapData,
  projectiles: Projectile[],
  sound: SoundEngine,
  cb: CombatCallbacks,
  remoteSurvivors: RemoteSurvivorState[] = []
) {
  if (player.attackCooldown > 0 || player.isReloading || player.animState === 'dead') {
    return;
  }

  const inst = player.equippedSlot !== null ? backpack[player.equippedSlot] : null;
  const def = inst ? ITEMS[inst.itemId] : null;

  // Unarmed desperate shove/strike if no weapon equipped
  if (!inst || !def || !def.weaponStats) {
    if (player.stamina < 8) return;
    player.stamina = Math.max(0, player.stamina - 8);
    player.attackCooldown = 0.45;
    player.meleeSwingTimer = 0.18;
    player.meleeSwingAngle = player.angle;
    player.animState = 'melee';
    sound.playMeleeSwing(false, null);
    cb.emitNoise(player.x, player.y, 90, 0.35, 'Unarmed strike');
    cb.onLocalAttack?.({
      kind: 'melee',
      weaponId: null,
      x: player.x,
      y: player.y,
      angle: player.angle,
      pellets: 1,
      spread: 0,
      speed: 0,
      range: 40,
      noiseRadius: 90,
      label: 'Unarmed strike',
    });
    executeMeleeArc(player, world, 10, 40, 1.0, 110, 'Fists', 'unarmed', sound, cb, remoteSurvivors);
    return;
  }

  const ws = def.weaponStats;

  // === MELEE WEAPON ===
  if (def.category === 'weapon_melee') {
    const stamCost = ws.staminaCost ?? 10;
    if (player.stamina < stamCost * 0.4) return;
    player.stamina = Math.max(0, player.stamina - stamCost);
    player.attackCooldown = ws.cooldown;
    player.meleeSwingTimer = 0.22;
    player.meleeSwingAngle = player.angle;
    player.animState = 'melee';

    sound.playMeleeSwing(ws.damage >= 28, def.id);
    cb.emitNoise(player.x, player.y, ws.noiseRadius, 0.55, `${def.name} swing`);
    cb.onLocalAttack?.({
      kind: 'melee',
      weaponId: def.id,
      x: player.x,
      y: player.y,
      angle: player.angle,
      pellets: 1,
      spread: 0,
      speed: 0,
      range: ws.range,
      noiseRadius: ws.noiseRadius,
      label: `${def.name} swing`,
    });

    const hitSomething = executeMeleeArc(
      player,
      world,
      ws.damage,
      ws.range,
      ws.arcAngle ?? 1.2,
      ws.knockback,
      def.name,
      getMeleeHitKind(def.id),
      sound,
      cb,
      remoteSurvivors
    );

    if (hitSomething && inst.durability !== undefined) {
      inst.durability -= 1;
      if (inst.durability <= 0) {
        if (player.equippedSlot !== null) {
          backpack[player.equippedSlot] = null;
          player.equippedSlot = null;
        }
        sound.playWeaponBreak();
        cb.showToast('Weapon Broken', `${def.name} shattered on impact!`, true);
      }
    }
    return;
  }

  // === RANGED WEAPON ===
  if (def.category === 'weapon_ranged') {
    const loaded = inst.loadedAmmo ?? 0;
    if (loaded <= 0) {
      sound.playDryClick();
      player.attackCooldown = 0.25;
      startWeaponReload(player, backpack, sound);
      return;
    }

    inst.loadedAmmo = loaded - 1;
    player.attackCooldown = ws.cooldown;
    player.animState = 'shoot';
    cb.onShotFired();

    const gunKind =
      def.id === 'shotgun' ? 'shotgun' : def.id === 'revolver' ? 'revolver' : 'pistol';
    sound.playGunshot(gunKind);
    cb.triggerShake(def.id === 'shotgun' ? 8.5 : def.id === 'revolver' ? 5.0 : 3.5);
    cb.emitNoise(player.x, player.y, ws.noiseRadius, 1.0, `${def.name} gunshot`);

    const muzzleX = player.x + Math.cos(player.angle) * 20;
    const muzzleY = player.y + Math.sin(player.angle) * 20;
    cb.spawnParticles(muzzleX, muzzleY, def.id === 'shotgun' ? 10 : 5, '#fde047', 160, 0.12);

    const pellets = ws.pellets ?? 1;
    const movePenalty = Math.hypot(player.vx, player.vy) > 40 ? 1.35 : player.isCrouching ? 0.65 : 1.0;
    const speed = ws.projectileSpeed ?? 860;
    const effectiveSpread = ws.spread * movePenalty;

    cb.onLocalAttack?.({
      kind: 'projectile',
      weaponId: def.id,
      x: muzzleX,
      y: muzzleY,
      angle: player.angle,
      pellets,
      spread: effectiveSpread,
      speed,
      range: ws.range,
      noiseRadius: ws.noiseRadius,
      label: `${def.name} gunshot`,
    });

    for (let p = 0; p < pellets; p++) {
      const spreadOffset = (Math.random() * 2 - 1) * effectiveSpread;
      const shotAngle = player.angle + spreadOffset;
      spawnPooledProjectile(
        projectiles,
        muzzleX,
        muzzleY,
        Math.cos(shotAngle) * speed,
        Math.sin(shotAngle) * speed,
        ws.damage,
        ws.knockback,
        ws.range,
        '#fef08a',
        false
      );
    }
  }
}

export function spawnRemoteVisualProjectiles(
  projectiles: Projectile[],
  x: number,
  y: number,
  angle: number,
  pellets: number,
  spread: number,
  speed: number,
  range: number
) {
  for (let i = 0; i < pellets; i++) {
    const offset = (Math.random() * 2 - 1) * spread;
    const a = angle + offset;
    spawnPooledProjectile(
      projectiles,
      x,
      y,
      Math.cos(a) * speed,
      Math.sin(a) * speed,
      0,
      0,
      range,
      '#fdba74',
      true
    );
  }
}

function executeMeleeArc(
  player: PlayerState,
  world: WorldMapData,
  damage: number,
  range: number,
  arcAngle: number,
  knockback: number,
  weaponName: string,
  hitKind: WeaponHitKind,
  sound: SoundEngine,
  cb: CombatCallbacks,
  remoteSurvivors: RemoteSurvivorState[]
): boolean {
  let hitAny = false;
  const T = CONFIG.TILE_SIZE;

  const checkX = player.x + Math.cos(player.angle) * (range * 0.72);
  const checkY = player.y + Math.sin(player.angle) * (range * 0.72);
  const wtx = Math.floor(checkX / T);
  const wty = Math.floor(checkY / T);
  if (wtx >= 0 && wtx < world.width && wty >= 0 && wty < world.height) {
    if (world.tiles[wty * world.width + wtx] === TileType.WINDOW) {
      world.tiles[wty * world.width + wtx] = TileType.WINDOW_BROKEN;
      cb.onWindowBroken?.(wtx, wty);
      sound.playGlassBreak(player.x, player.y, wtx * T + T / 2, wty * T + T / 2);
      cb.emitNoise(
        wtx * T + T / 2,
        wty * T + T / 2,
        CONFIG.NOISE_WINDOW_BREAK,
        0.9,
        'Shattered window'
      );
      cb.spawnParticles(wtx * T + T / 2, wty * T + T / 2, 14, '#bae6fd', 130, 0.35);
      hitAny = true;
    }
  }

  for (const e of world.enemies) {
    if (e.state === 'DEAD') continue;
    const dx = e.x - player.x;
    const dy = e.y - player.y;
    const dist = Math.hypot(dx, dy);
    if (dist > range + e.radius) continue;

    let diff = Math.atan2(dy, dx) - player.angle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;

    if (Math.abs(diff) <= arcAngle * 0.55) {
      if (!hasLineOfSight(world, player.x, player.y, e.x, e.y)) continue;
      hitAny = true;
      damageEnemy(e, damage, dx, dy, knockback, world, sound, cb, player.x, player.y, hitKind);
      cb.triggerHitstop(damage >= 30 ? 0.055 : 0.03);
      cb.triggerShake(damage >= 30 ? 4.5 : 2.5);
    }
  }

  // PvP Melee Hit Detection against rival online survivors
  for (const rs of remoteSurvivors) {
    if (!rs.alive) continue;
    const dx = rs.x - player.x;
    const dy = rs.y - player.y;
    const dist = Math.hypot(dx, dy);
    if (dist > range + 12) continue;

    let diff = Math.atan2(dy, dx) - player.angle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;

    if (Math.abs(diff) <= arcAngle * 0.58) {
      if (!hasLineOfSight(world, player.x, player.y, rs.x, rs.y)) continue;
      hitAny = true;
      rs.hurtFlash = 0.2;
      sound.playWeaponHit(hitKind);
      cb.spawnParticles(rs.x, rs.y, 10, '#dc2626', 120, 0.36);
      cb.triggerHitstop(damage >= 30 ? 0.055 : 0.03);
      cb.triggerShake(damage >= 30 ? 4.5 : 2.5);
      cb.onPvpHit?.(
        rs,
        Math.round(damage * 0.85),
        weaponName,
        weaponName === 'Kitchen Knife' ? 0.35 : 0.18,
        nextHitId()
      );
    }
  }

  return hitAny;
}

function spawnPooledProjectile(
  pool: Projectile[],
  x: number,
  y: number,
  vx: number,
  vy: number,
  damage: number,
  knockback: number,
  range: number,
  color = '#fef08a',
  isRemoteVisual = false
) {
  for (const pr of pool) {
    if (!pr.active) {
      pr.active = true;
      pr.x = x;
      pr.y = y;
      pr.vx = vx;
      pr.vy = vy;
      pr.damage = damage;
      pr.knockback = knockback;
      pr.remainingRange = range;
      pr.color = color;
      pr.isRemoteVisual = isRemoteVisual;
      return;
    }
  }
  pool.push({
    active: true,
    x,
    y,
    vx,
    vy,
    damage,
    knockback,
    remainingRange: range,
    color,
    isRemoteVisual,
  });
}

export function updateProjectiles(
  dt: number,
  projectiles: Projectile[],
  world: WorldMapData,
  player: PlayerState,
  sound: SoundEngine,
  cb: CombatCallbacks,
  remoteSurvivors: RemoteSurvivorState[] = [],
  equippedWeaponName = 'Firearm'
) {
  const T = CONFIG.TILE_SIZE;

  for (const pr of projectiles) {
    if (!pr.active) continue;

    const totalSpeed = Math.hypot(pr.vx, pr.vy);
    const stepDist = totalSpeed * dt;
    const subSteps = Math.max(1, Math.ceil(stepDist / 8));
    const subDt = dt / subSteps;

    for (let s = 0; s < subSteps; s++) {
      pr.x += pr.vx * subDt;
      pr.y += pr.vy * subDt;
      pr.remainingRange -= totalSpeed * subDt;

      if (pr.remainingRange <= 0) {
        pr.active = false;
        break;
      }

      const wallHit = pointHitsBulletBlocker(world, pr.x, pr.y);
      if (wallHit.hit) {
        if (wallHit.hitWindowTx !== undefined && wallHit.hitWindowTy !== undefined) {
          world.tiles[wallHit.hitWindowTy * world.width + wallHit.hitWindowTx] =
            TileType.WINDOW_BROKEN;
          if (!pr.isRemoteVisual) {
            cb.onWindowBroken?.(wallHit.hitWindowTx, wallHit.hitWindowTy);
          }
          const wx = wallHit.hitWindowTx * T + T / 2;
          const wy = wallHit.hitWindowTy * T + T / 2;
          sound.playGlassBreak(player.x, player.y, wx, wy);
          cb.emitNoise(wx, wy, CONFIG.NOISE_WINDOW_BREAK, 0.9, 'Shot glass window');
          cb.spawnParticles(wx, wy, 14, '#bae6fd', 140, 0.35);
        } else {
          sound.playBulletWallImpact(player.x, player.y, pr.x, pr.y);
          cb.spawnParticles(pr.x, pr.y, 5, '#cbd5e1', 95, 0.18);
        }
        pr.active = false;
        break;
      }

      if (pr.isRemoteVisual) {
        // Remote visual tracer terminates cleanly on hitting local player or Hollow
        const pdx = player.x - pr.x;
        const pdy = player.y - pr.y;
        if (player.animState !== 'dead' && pdx * pdx + pdy * pdy <= 14 * 14) {
          pr.active = false;
          break;
        }
        let stoppedOnEnemy = false;
        for (const e of world.enemies) {
          if (e.state === 'DEAD') continue;
          const dx = e.x - pr.x;
          const dy = e.y - pr.y;
          if (dx * dx + dy * dy <= (e.radius + 3) * (e.radius + 3)) {
            cb.spawnParticles(e.x, e.y, 5, '#dc2626', 90, 0.25);
            pr.active = false;
            stoppedOnEnemy = true;
            break;
          }
        }
        if (stoppedOnEnemy) break;
        continue;
      }

      // Check Enemy Hitboxes (PvE)
      let hitEntity = false;
      for (const e of world.enemies) {
        if (e.state === 'DEAD') continue;
        const dx = e.x - pr.x;
        const dy = e.y - pr.y;
        if (dx * dx + dy * dy <= (e.radius + 3) * (e.radius + 3)) {
          cb.onShotHit();
          damageEnemy(
            e,
            pr.damage,
            pr.vx,
            pr.vy,
            pr.knockback,
            world,
            sound,
            cb,
            player.x,
            player.y,
            'bullet'
          );
          pr.active = false;
          hitEntity = true;
          break;
        }
      }
      if (hitEntity) break;

      // Check Rival Online Survivor Hitboxes (PvP)
      for (const rs of remoteSurvivors) {
        if (!rs.alive) continue;
        const dx = rs.x - pr.x;
        const dy = rs.y - pr.y;
        if (dx * dx + dy * dy <= 14 * 14) {
          cb.onShotHit();
          rs.hurtFlash = 0.18;
          sound.playWeaponHit('bullet');
          cb.spawnParticles(rs.x, rs.y, 9, '#dc2626', 120, 0.34);
          cb.onPvpHit?.(
            rs,
            Math.max(4, Math.round(pr.damage * 0.78)),
            equippedWeaponName,
            0.25,
            nextHitId()
          );
          pr.active = false;
          hitEntity = true;
          break;
        }
      }
      if (hitEntity) break;
    }
  }
}

export function damageEnemy(
  e: EnemyEntity,
  damage: number,
  dirX: number,
  dirY: number,
  knockback: number,
  world: WorldMapData,
  sound: SoundEngine,
  cb: CombatCallbacks,
  listenerX = e.x,
  listenerY = e.y,
  hitKind: WeaponHitKind = 'blunt_metal'
) {
  e.health -= damage;
  e.hurtFlash = 0.14;
  sound.playWeaponHit(hitKind);

  const mag = Math.hypot(dirX, dirY) || 1;
  const kx = e.x + (dirX / mag) * (knockback * 0.09);
  const ky = e.y + (dirY / mag) * (knockback * 0.09);
  const resolved = resolveCircleWorldCollision(world, kx, ky, e.radius);
  e.x = resolved.x;
  e.y = resolved.y;

  cb.spawnParticles(
    e.x,
    e.y,
    8,
    e.enemyClass === 'bloom' ? '#84cc16' : '#dc2626',
    115,
    0.34
  );

  if (e.health > 0) {
    sound.playEnemyVocal(e.enemyClass, listenerX, listenerY, e.x, e.y, 'hurt');
    if (e.state !== 'CHASE' && e.state !== 'ATTACK') {
      e.state = 'CHASE';
      e.stateTimer = 8;
    }
  } else {
    e.health = 0;
    e.state = 'DEAD';
    sound.playEnemyVocal(e.enemyClass, listenerX, listenerY, e.x, e.y, 'death');
    cb.onEnemyKilled(e);
  }
}
