import { CONFIG } from '../config';
import { ENEMY_ARCHETYPES } from '../data/enemies';
import { WorldMapData } from '../data/map';
import { SoundEngine } from '../engine/audio';
import { hasLineOfSight, resolveCircleWorldCollision } from '../engine/collision';
import {
  EnemyEntity,
  NoiseEvent,
  PlayerState,
  TileType,
} from '../types';

export interface EnemyAICallbacks {
  onPlayerDamaged: (amount: number, bleedRoll: number, infectRoll: number, attackerName: string) => void;
  emitNoise: (
    x: number,
    y: number,
    radius: number,
    intensity: number,
    label: string,
    isMimicLure?: boolean
  ) => void;
  spawnSporeBurst: (x: number, y: number, radius: number, duration: number) => void;
  spawnParticles: (x: number, y: number, count: number, color: string, speed: number, life?: number) => void;
  onEnemySpotted?: (dist: number) => void;
}

export function updateEnemiesAI(
  dt: number,
  world: WorldMapData,
  player: PlayerState,
  noises: NoiseEvent[],
  currentHourIndex: number,
  powerGridOnline: boolean,
  isHeavyRain: boolean,
  extractionActive: boolean,
  sound: SoundEngine,
  cb: EnemyAICallbacks
) {
  // Night aggression scaling (3:00 AM hunting phase + 5:00 AM extraction frenzy)
  const aggressionMult =
    currentHourIndex >= 6 ? 1.24 : currentHourIndex >= 4 ? 1.14 : 1.0;

  let closestThreatDist = Infinity;

  for (const e of world.enemies) {
    if (e.hurtFlash > 0) e.hurtFlash = Math.max(0, e.hurtFlash - dt);

    if (e.state === 'DEAD') {
      // Bloom releases toxic spore burst on death!
      if (e.enemyClass === 'bloom' && !e.deathBurstDone) {
        e.deathBurstDone = true;
        cb.spawnSporeBurst(e.x, e.y, 115, 42);
        cb.spawnParticles(e.x, e.y, 22, '#a3e635', 140, 0.65);
      }
      continue;
    }

    // Performance cull: distant Idle/Patrol enemies far off-screen tick lightweight
    const dxPlayer = player.x - e.x;
    const dyPlayer = player.y - e.y;
    const distToPlayer = Math.hypot(dxPlayer, dyPlayer);
    if (distToPlayer > 1350 && e.state !== 'CHASE' && !extractionActive) {
      continue;
    }

    e.animTime += dt;
    if (e.attackCooldown > 0) e.attackCooldown = Math.max(0, e.attackCooldown - dt);
    const arch = ENEMY_ARCHETYPES[e.enemyClass];

    // Special Class & Horror Audio Behaviors
    e.specialTimer -= dt;
    if (e.specialTimer <= 0) {
      if (e.state === 'CHASE') {
        // Rabid hunting snarls & snapping jaws while chasing the player
        e.specialTimer = 2.5 + Math.random() * 1.8;
        if (distToPlayer < 560) {
          sound.playEnemyVocal(e.enemyClass, player.x, player.y, e.x, e.y, 'chase');
        }
      } else if (e.enemyClass === 'still' && e.state !== 'ATTACK') {
        // Chilling dry spine/neck bone clicks from Stills lurking motionless in the dark
        e.specialTimer = 4.8 + Math.random() * 3.5;
        if (distToPlayer < 460) {
          sound.playEnemyVocal('still', player.x, player.y, e.x, e.y, 'ambient');
        }
      } else if (e.enemyClass === 'mimic' && e.state !== 'ATTACK') {
        // Mimic emits uncanny distorted human distress cry + acoustic lure
        e.specialTimer = 7.5 + Math.random() * 4.5;
        if (distToPlayer < 860) {
          sound.playEnemyVocal('mimic', player.x, player.y, e.x, e.y, 'ambient');
          cb.emitNoise(e.x, e.y, 280, 0.65, 'Distorted cry', true);
        }
      } else if (e.enemyClass === 'bloom') {
        e.specialTimer = 5.5 + Math.random() * 3.5;
        if (distToPlayer < 680) {
          sound.playEnemyVocal('bloom', player.x, player.y, e.x, e.y, 'ambient');
          cb.spawnParticles(e.x, e.y, 8, '#84cc16', 45, 0.55);
        }
      } else if (e.enemyClass === 'crawler' && e.state !== 'ATTACK') {
        // Choked guttural shadow rasps from Crawlers stalking nearby
        e.specialTimer = 4.2 + Math.random() * 3.0;
        if (distToPlayer < 620) {
          sound.playEnemyVocal('crawler', player.x, player.y, e.x, e.y, 'ambient');
        }
      } else {
        e.specialTimer = 4.5 + Math.random() * 3.5;
      }
    }

    // 1. Sensory Check: Vision (Never sees through walls!)
    let effectiveSight = arch.sightRange * aggressionMult;
    if (!powerGridOnline && !player.flashlightOn) effectiveSight *= 0.68;
    if (player.isCrouching) effectiveSight *= 0.6;
    if (isHeavyRain) effectiveSight *= 0.85;
    if (player.flashlightOn) effectiveSight *= 1.25;

    let canSeePlayer = false;
    if (player.animState !== 'dead' && distToPlayer <= effectiveSight) {
      const angleToPlayer = Math.atan2(dyPlayer, dxPlayer);
      let angleDiff = angleToPlayer - e.angle;
      while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
      while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

      // Close personal bump awareness or inside vision cone
      const inCone =
        distToPlayer < 48 || Math.abs(angleDiff) <= arch.sightHalfAngle;

      // Still wakes up if player shines flashlight directly on it within 190px!
      let flashlightDisturbedStill = false;
      if (e.enemyClass === 'still' && player.flashlightOn && distToPlayer < 190) {
        const playerToEnemyAngle = Math.atan2(e.y - player.y, e.x - player.x);
        let beamDiff = playerToEnemyAngle - player.angle;
        while (beamDiff > Math.PI) beamDiff -= Math.PI * 2;
        while (beamDiff < -Math.PI) beamDiff += Math.PI * 2;
        if (Math.abs(beamDiff) < CONFIG.FLASHLIGHT_HALF_ANGLE) {
          flashlightDisturbedStill = true;
        }
      }

      if ((inCone || flashlightDisturbedStill) && hasLineOfSight(world, e.x, e.y, player.x, player.y)) {
        canSeePlayer = true;
      }
    }

    // 2. Sensory Check: Sound Detection
    let loudestHeard: NoiseEvent | null = null;
    if (!canSeePlayer) {
      for (const n of noises) {
        if (n.isMimicLure && e.enemyClass === 'mimic') continue;
        if (n.age > 0.15) continue; // React on fresh acoustic wavefront
        const dn = Math.hypot(n.x - e.x, n.y - e.y);
        const rainMask = isHeavyRain ? 0.82 : 1.0;
        const hearLimit = n.radius * arch.hearingMultiplier * aggressionMult * rainMask;
        if (dn <= hearLimit) {
          if (!loudestHeard || n.intensity > loudestHeard.intensity) {
            loudestHeard = n;
          }
        }
      }
    }

    // Extraction rooftop beacon lures nearby rooftop/stairwell Hollow when active at 5:00 AM!
    if (
      extractionActive &&
      !canSeePlayer &&
      e.state !== 'CHASE' &&
      e.state !== 'ATTACK' &&
      distToPlayer < 650 &&
      Math.random() < dt * 0.25
    ) {
      e.lastKnownTarget = { x: player.x, y: player.y };
      e.state = 'SEARCH';
      e.stateTimer = 7;
    }

    // 3. State Machine Transitions
    if (canSeePlayer) {
      const newlySpotted = e.state !== 'CHASE' && e.state !== 'ATTACK';
      if (newlySpotted) {
        sound.playEnemyVocal(e.enemyClass, player.x, player.y, e.x, e.y, 'spot');
        sound.playEnemyRoar(e.enemyClass, player.x, player.y, e.x, e.y);
        sound.playHorrorSpotSting(player.x, player.y, e.x, e.y);
        cb.onEnemySpotted?.(distToPlayer);
        e.specialTimer = 2.2 + Math.random() * 1.5;
      }
      e.lastKnownTarget = { x: player.x, y: player.y };
      if (distToPlayer <= arch.attackRange + player.radius && e.state !== 'ATTACK') {
        if (!newlySpotted) {
          sound.playEnemyVocal(e.enemyClass, player.x, player.y, e.x, e.y, 'attack');
        }
        e.state = 'ATTACK';
        e.windupTimer = arch.attackWindup;
        e.hasDealtAttackHit = false;
      } else if (e.state !== 'ATTACK') {
        e.state = 'CHASE';
        e.stateTimer = 6.0;
      }
    } else if (loudestHeard) {
      e.lastKnownTarget = { x: loudestHeard.x, y: loudestHeard.y };
      if (loudestHeard.intensity >= 0.8) {
        if (e.state !== 'CHASE') {
          sound.playEnemyVocal(e.enemyClass, player.x, player.y, e.x, e.y, 'spot');
         sound.playEnemyRoar(e.enemyClass, player.x, player.y, e.x, e.y);
        }
        e.state = 'ALERT';
        e.stateTimer = 0.35;
      } else if (e.state === 'IDLE' || e.state === 'PATROL' || e.state === 'RETURN') {
        e.state = 'SUSPICIOUS';
        e.stateTimer = 0.8;
      }
    }

    // 4. Execute Active State
    switch (e.state) {
      case 'IDLE': {
        e.vx = 0;
        e.vy = 0;
        if (e.enemyClass !== 'still' && e.patrolWaypoints.length > 1) {
          e.stateTimer -= dt;
          if (e.stateTimer <= 0) {
            e.state = 'PATROL';
          }
        }
        break;
      }

      case 'PATROL': {
        const wp = e.patrolWaypoints[e.waypointIndex % e.patrolWaypoints.length];
        const arrived = steerToward(e, wp.x, wp.y, arch.patrolSpeed, dt, world, false, player, sound, cb);
        if (arrived) {
          e.waypointIndex = (e.waypointIndex + 1) % e.patrolWaypoints.length;
          e.state = 'IDLE';
          e.stateTimer = 1.5 + Math.random() * 2.5;
        }
        break;
      }

      case 'SUSPICIOUS': {
        if (e.lastKnownTarget) {
          e.angle = Math.atan2(e.lastKnownTarget.y - e.y, e.lastKnownTarget.x - e.x);
        }
        e.stateTimer -= dt;
        if (e.stateTimer <= 0) {
          e.state = 'SEARCH';
          e.stateTimer = 6.5;
        }
        break;
      }

      case 'ALERT': {
        if (e.lastKnownTarget) {
          e.angle = Math.atan2(e.lastKnownTarget.y - e.y, e.lastKnownTarget.x - e.x);
        }
        e.stateTimer -= dt;
        if (e.stateTimer <= 0) {
          e.state = 'SEARCH';
          e.stateTimer = 8.5;
        }
        break;
      }

      case 'CHASE': {
        if (canSeePlayer) {
          const chaseSpd = arch.chaseSpeed * aggressionMult;
          steerToward(e, player.x, player.y, chaseSpd, dt, world, true, player, sound, cb);
          if (distToPlayer <= arch.attackRange + player.radius && e.attackCooldown <= 0) {
            sound.playEnemyVocal(e.enemyClass, player.x, player.y, e.x, e.y, 'attack');
            e.state = 'ATTACK';
            e.windupTimer = arch.attackWindup;
            e.hasDealtAttackHit = false;
          }
        } else {
          // Lost line of sight -> investigate last known position!
          sound.playEnemyVocal(e.enemyClass, player.x, player.y, e.x, e.y, 'flee');
          e.state = 'SEARCH';
          e.stateTimer = 7.5;
        }
        break;
      }

      case 'ATTACK': {
        e.angle = Math.atan2(dyPlayer, dxPlayer);
        e.windupTimer -= dt;
        if (e.windupTimer <= 0 && !e.hasDealtAttackHit) {
          e.hasDealtAttackHit = true;
          e.attackCooldown = arch.attackCooldown;
          // Verify player didn't dodge out of strike reach or behind wall!
          if (
            distToPlayer <= arch.attackRange + player.radius + 14 &&
            hasLineOfSight(world, e.x, e.y, player.x, player.y)
          ) {
            sound.playEnemyBite(e.enemyClass, player.x, player.y, e.x, e.y);
            cb.onPlayerDamaged(
              arch.attackDamage,
              arch.bleedChance,
              arch.infectChance,
              arch.name
            );
          }
          e.state = 'CHASE';
        }
        break;
      }

      case 'SEARCH': {
        e.stateTimer -= dt;
        if (e.lastKnownTarget) {
          const searchSpd = arch.chaseSpeed * 0.72;
          const reached = steerToward(
            e,
            e.lastKnownTarget.x,
            e.lastKnownTarget.y,
            searchSpd,
            dt,
            world,
            true,
            player,
            sound,
            cb
          );
          if (reached) {
            // Look around suspiciously at last known position
            e.angle += dt * 2.2;
          }
        }
        if (e.stateTimer <= 0) {
          e.state = e.enemyClass === 'still' ? 'IDLE' : 'RETURN';
        }
        break;
      }

      case 'RETURN': {
        const reachedHome = steerToward(
          e,
          e.spawnPos.x,
          e.spawnPos.y,
          arch.patrolSpeed,
          dt,
          world,
          false,
          player,
          sound,
          cb
        );
        if (reachedHome) {
          e.state = e.patrolWaypoints.length > 1 ? 'PATROL' : 'IDLE';
          e.stateTimer = 2.0;
        }
        break;
      }
    }

    if (e.state === 'CHASE' || e.state === 'ATTACK') {
      closestThreatDist = Math.min(closestThreatDist, distToPlayer);
    }
  }

  // Close-danger physiological panic heartbeat when hunted at close range or critically wounded
  if (player.animState !== 'dead' && (closestThreatDist < 310 || player.health <= 28)) {
    const chaseIntensity =
      closestThreatDist < 310 ? Math.max(0, 1 - closestThreatDist / 310) : 0;
    const lowHpIntensity = player.health <= 28 ? 0.36 : 0;
    sound.playDreadHeartbeat(Math.max(chaseIntensity, lowHpIntensity));
  }
}

function steerToward(
  e: EnemyEntity,
  tx: number,
  ty: number,
  speed: number,
  dt: number,
  world: WorldMapData,
  canBashDoors: boolean,
  player: PlayerState,
  sound: SoundEngine,
  cb: EnemyAICallbacks
): boolean {
  const dx = tx - e.x;
  const dy = ty - e.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 10) {
    e.vx = 0;
    e.vy = 0;
    return true;
  }

  const baseAngle = Math.atan2(dy, dx);
  e.angle = baseAngle;
  const T = CONFIG.TILE_SIZE;

  // Check if a closed door is directly blocking path while chasing/searching
  if (canBashDoors) {
    const probeX = e.x + Math.cos(baseAngle) * (e.radius + 14);
    const probeY = e.y + Math.sin(baseAngle) * (e.radius + 14);
    const dtx = Math.floor(probeX / T);
    const dty = Math.floor(probeY / T);
    if (dtx >= 0 && dtx < world.width && dty >= 0 && dty < world.height) {
      if (world.tiles[dty * world.width + dtx] === TileType.DOOR_CLOSED) {
        if (e.attackCooldown <= 0) {
          e.attackCooldown = 0.85;
          // Break/force door open!
          world.tiles[dty * world.width + dtx] = TileType.DOOR_OPEN;
          sound.playDoor(player.x, player.y, dtx * T + T / 2, dty * T + T / 2, 'bash');
          cb.emitNoise(dtx * T + T / 2, dty * T + T / 2, 220, 0.7, 'Hollow forced door');
        }
        return false;
      }
    }
  }

  // Try direct heading first; if blocked by corner/furniture, test +/- 45 and +/- 80 deg feelers
  const candidateOffsets = [0, 0.75, -0.75, 1.35, -1.35];
  for (const offset of candidateOffsets) {
    const testAngle = baseAngle + offset;
    const stepX = e.x + Math.cos(testAngle) * speed * dt;
    const stepY = e.y + Math.sin(testAngle) * speed * dt;
    const res = resolveCircleWorldCollision(world, stepX, stepY, e.radius);
    const moved = Math.hypot(res.x - e.x, res.y - e.y);
    if (!res.collided || moved > speed * dt * 0.45) {
      e.vx = (res.x - e.x) / dt;
      e.vy = (res.y - e.y) / dt;
      e.x = res.x;
      e.y = res.y;
      e.angle = testAngle;

      // Spatialized stalking/chasing footsteps in the dark
      const stepRate = canBashDoors
        ? e.enemyClass === 'crawler'
          ? 3.8
          : e.enemyClass === 'bloom'
          ? 1.85
          : 3.1
        : e.enemyClass === 'bloom'
        ? 1.15
        : 1.75;
      const prevStep = Math.floor((e.animTime - dt) * stepRate);
      const curStep = Math.floor(e.animTime * stepRate);
      if (curStep > prevStep) {
        sound.playEnemyStep(e.enemyClass, canBashDoors, player.x, player.y, res.x, res.y);
      }
      return false;
    }
  }

  return false;
}
