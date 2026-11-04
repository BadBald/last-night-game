import { CONFIG } from '../config';
import { ITEMS } from '../data/items';
import { WorldMapData } from '../data/map';
import { hasLineOfSight } from '../engine/collision';
import {
  ActiveFlare,
  EnemyEntity,
  InventoryItemInstance,
  PlayerState,
} from '../types';

export function updateSurvivalAttributes(
  dt: number,
  player: PlayerState,
  world: WorldMapData,
  enemies: EnemyEntity[],
  currentHourIndex: number,
  isEncumbered: boolean,
  injectionTaken: boolean
): { diedCause: string | null } {
  if (player.health <= 0) {
    return { diedCause: 'Succumbed to injuries' };
  }

  // 1. Hunger steady drain
  player.hunger = Math.max(0, player.hunger - CONFIG.HUNGER_DRAIN_PER_SEC * dt);
  if (player.hunger <= 0) {
    player.health -= CONFIG.STARVATION_DPS * dt;
    if (player.health <= 0) return { diedCause: 'Collapsed from severe starvation' };
  }

  // 2. Stamina sprint drain & recovery
  const speed = Math.hypot(player.vx, player.vy);
  if (player.isSprinting && speed > 20) {
    const mult = isEncumbered ? 1.35 : 1.0;
    player.stamina = Math.max(
      0,
      player.stamina - CONFIG.STAMINA_SPRINT_DRAIN_PER_SEC * mult * dt
    );
    if (player.stamina <= 0) {
      player.isSprinting = false;
      player.conditions.exhausted = true;
    }
  } else {
    let recRate =
      speed < 10
        ? CONFIG.STAMINA_RECOVERY_IDLE_PER_SEC
        : CONFIG.STAMINA_RECOVERY_WALK_PER_SEC;
    if (player.hunger < 25) recRate *= 0.55;
    if (player.contamination > 65) recRate *= 0.7;
    if (isEncumbered) recRate *= 0.72;
    player.stamina = Math.min(player.maxStamina, player.stamina + recRate * dt);
    if (player.stamina > 30) {
      player.conditions.exhausted = false;
    }
  }

  // 3. Flashlight battery drain
  if (player.flashlightOn) {
    player.flashlightBattery = Math.max(
      0,
      player.flashlightBattery - CONFIG.FLASHLIGHT_DRAIN_PER_SEC * dt
    );
    if (player.flashlightBattery <= 0) {
      player.flashlightOn = false;
    }
  }

  // 3b. Untreated initial village spore exposure slowly rises up to 68% (never triggers HP loss alone!)
  if (!injectionTaken && player.contamination < 68) {
    player.contamination = Math.min(
      68,
      player.contamination + CONFIG.UNTREATED_CONTAM_CREEP_PER_SEC * dt
    );
  }

  // 4. Spore zone & Bloom aura exposure -> Contamination (blocked by solid walls!)
  let inSporeField = false;
  for (const sz of world.sporeZones) {
    if (sz.activeAfterHour > currentHourIndex) continue;
    const d = Math.hypot(player.x - sz.x, player.y - sz.y);
    if (d < sz.radius && (d < 28 || hasLineOfSight(world, player.x, player.y, sz.x, sz.y))) {
      inSporeField = true;
      const ratio = 1 - d / sz.radius;
      player.contamination = Math.min(
        player.maxContamination,
        player.contamination + (1.2 + ratio * 2.0) * sz.intensity * dt
      );
    }
  }
  for (const e of enemies) {
    if (e.enemyClass === 'bloom' && e.state !== 'DEAD') {
      const d = Math.hypot(player.x - e.x, player.y - e.y);
      if (d < 92 && (d < 28 || hasLineOfSight(world, player.x, player.y, e.x, e.y))) {
        inSporeField = true;
        player.contamination = Math.min(
          player.maxContamination,
          player.contamination + 1.85 * dt
        );
      }
    }
  }
  player.conditions.sporeExposure = inSporeField;

  // Post-Antiviral immune clearance when outside spore clouds and not infected
  if (injectionTaken && !inSporeField && !player.conditions.infected && player.contamination > 0) {
    player.contamination = Math.max(0, player.contamination - 0.35 * dt);
  }

  // 5. Bleeding (clots naturally after BLEEDING_DURATION_SEC or immediately with Bandage/Painkillers/Medkit)
  if (player.conditions.bleeding) {
    player.bleedTimer -= dt;
    if (player.bleedTimer <= 0) {
      player.bleedTimer = 0;
      player.conditions.bleeding = false;
    } else {
      player.health -= CONFIG.BLEEDING_DPS * dt;
      if (player.health <= 0) return { diedCause: 'Bled out from untreated lacerations' };
    }
  }

  // Bounded wound infection timer
  if (player.conditions.infected) {
    player.infectionTimer -= dt;
    if (player.infectionTimer <= 0) {
      player.infectionTimer = 0;
      player.conditions.infected = false;
    } else {
      player.contamination = Math.min(
        player.maxContamination,
        player.contamination + CONFIG.INFECTION_CONTAM_PER_SEC * dt
      );
    }
  }

  // 6. Critical Contamination damage (only at extreme >= 90% bio-toxicity)
  if (player.contamination >= 90) {
    const severity = (player.contamination - 90) / 10;
    player.health -= CONFIG.HIGH_CONTAMINATION_DPS * (0.5 + severity * 0.6) * dt;
    if (player.health <= 0) {
      return { diedCause: 'Overcome by terminal Hollow spore contamination' };
    }
  } else if (
    player.hunger >= 55 &&
    !player.conditions.bleeding &&
    !inSporeField &&
    player.contamination < 75 &&
    player.health > 0 &&
    player.health < player.maxHealth
  ) {
    // Gentle natural stabilization when well-fed, clean, and not bleeding
    player.health = Math.min(
      player.maxHealth,
      player.health + CONFIG.STABILIZED_HEAL_PER_SEC * dt
    );
  }

  return { diedCause: null };
}

export function applyBackpackItemEffect(
  player: PlayerState,
  backpack: (InventoryItemInstance | null)[],
  slotIdx: number,
  aimWorldX: number,
  aimWorldY: number,
  flaresOut: ActiveFlare[]
): { used: boolean; feedback: string | null; antiviralInjected?: boolean } {
  const inst = backpack[slotIdx];
  if (!inst) return { used: false, feedback: null };
  const def = ITEMS[inst.itemId];
  if (!def) return { used: false, feedback: null };

  if (def.category === 'weapon_melee' || def.category === 'weapon_ranged') {
    player.equippedSlot = player.equippedSlot === slotIdx ? null : slotIdx;
    player.isReloading = false;
    return {
      used: false,
      feedback: player.equippedSlot === slotIdx ? `Equipped ${def.name}` : `Holstered ${def.name}`,
    };
  }

  if (!def.effects) {
    return { used: false, feedback: `${def.name} is used contextually in the world.` };
  }

  const fx = def.effects;
  const isAntiviral = inst.itemId === 'antiviral';

  if (fx.armorBonus) {
    if (player.armorEquipped) {
      return { used: false, feedback: 'Patrol Vest already worn.' };
    }
    player.armorEquipped = true;
    backpack[slotIdx] = null;
    return { used: true, feedback: 'Equipped Patrol Vest (-30% physical damage)' };
  }

  if (fx.throwableType) {
    const dx = aimWorldX - player.x;
    const dy = aimWorldY - player.y;
    const dist = Math.min(185, Math.hypot(dx, dy));
    const angle = dist > 4 ? Math.atan2(dy, dx) : player.angle;
    const tx =
      fx.throwableType === 'flare'
        ? player.x + Math.cos(angle) * 26
        : player.x + Math.cos(angle) * dist;
    const ty =
      fx.throwableType === 'flare'
        ? player.y + Math.sin(angle) * 26
        : player.y + Math.sin(angle) * dist;

    flaresOut.push({
      id: `flr_${Date.now()}_${Math.random()}`,
      x: tx,
      y: ty,
      remaining: fx.throwableType === 'flare' ? 38 : 9,
      type: fx.throwableType,
      pulseTimer: 0.1,
    });

    inst.quantity -= 1;
    if (inst.quantity <= 0) backpack[slotIdx] = null;
    return {
      used: true,
      feedback:
        fx.throwableType === 'flare' ? 'Ignited Road Flare' : 'Deployed Alarm Decoy',
    };
  }

  if (fx.heal) {
    player.health = Math.min(player.maxHealth, player.health + fx.heal);
  }
  if (fx.hunger) {
    player.hunger = Math.min(player.maxHunger, player.hunger + fx.hunger);
  }
  if (fx.stamina) {
    player.stamina = Math.min(player.maxStamina, player.stamina + fx.stamina);
    if (player.stamina > 25) player.conditions.exhausted = false;
  }
  if (fx.contaminationDelta) {
    player.contamination = Math.max(
      0,
      Math.min(player.maxContamination, player.contamination + fx.contaminationDelta)
    );
  }
  if (fx.cureBleeding) {
    player.conditions.bleeding = false;
    player.bleedTimer = 0;
  }
  if (fx.cureInfection) {
    player.conditions.infected = false;
    player.infectionTimer = 0;
  }
  if (fx.clearSpores) {
    player.conditions.sporeExposure = false;
  }
  if (fx.batteryCharge) {
    player.flashlightBattery = Math.min(100, player.flashlightBattery + fx.batteryCharge);
  }

  inst.quantity -= 1;
  if (inst.quantity <= 0) {
    backpack[slotIdx] = null;
  }

  return { used: true, feedback: `Used ${def.name}`, antiviralInjected: isAntiviral };
}
