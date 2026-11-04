import { CONFIG } from '../config';
import { ExtractionSiteDef, ExtractionState, PlayerState } from '../types';

export function createInitialExtractionState(site: ExtractionSiteDef): ExtractionState {
  const zoneBounds = site.zoneBounds;
  const cx = zoneBounds.x + zoneBounds.w * 0.5;
  const cy = zoneBounds.y + zoneBounds.h * 0.5;
  return {
    site,
    coordinatesKnown: false, // Unlocked once the survivor tunes the Emergency Radio in St. Jude Hospital!
    zoneActive: false,
    rotorAudible: false,
    searchlightActive: false,
    heliPosition: { x: cx + 520, y: cy - 640 },
    heliTarget: { x: cx, y: cy },
    heliVisible: false,
    rotorAngle: 0,
    searchlightPos: { x: cx, y: cy },
    playerInZone: false,
    generatorPowered: false,
    zoneBounds,
  };
}

export function updateExtractionSequence(
  dt: number,
  elapsedSeconds: number,
  player: PlayerState,
  ext: ExtractionState,
  onMilestoneNote: (title: string, text: string, radioOnly: boolean) => void
): { rotorAudioLevel: number; extractionMomentReached: boolean } {
  const H = CONFIG.SECONDS_PER_GAME_HOUR;
  const t5AM = 6 * H;
  const t545AM = 6.75 * H;
  const t550AM = 6.8333 * H;
  const tHeliVisible = 6.88 * H;

  if (elapsedSeconds >= t5AM && !ext.zoneActive) {
    ext.zoneActive = true;
  }

  if (elapsedSeconds >= t545AM && !ext.rotorAudible) {
    ext.rotorAudible = true;
    if (ext.coordinatesKnown) {
      onMilestoneNote(
        '5:45 AM — Rotor Blades Inbound',
        `Echo-7 rotors are thundering toward ${ext.site.name}! Get inside the [H] landing pad NOW!`,
        true
      );
    } else {
      onMilestoneNote(
        '5:45 AM — Distant Helicopter Rotors',
        'Heavy rotor blades echo over the city! Check St. Jude Hospital Radio for the landing zone!',
        false
      );
    }
  }

  if (elapsedSeconds >= t550AM && !ext.searchlightActive) {
    ext.searchlightActive = true;
    if (ext.coordinatesKnown) {
      onMilestoneNote(
        '5:50 AM — Searchlight Contact',
        `Echo-7 spotlight is sweeping ${ext.site.shortName}. Hold inside the [H] zone until 06:00 AM!`,
        true
      );
    }
  }

  const zb = ext.zoneBounds;
  ext.playerInZone =
    player.health > 0 &&
    player.x >= zb.x &&
    player.x <= zb.x + zb.w &&
    player.y >= zb.y &&
    player.y <= zb.y + zb.h;

  if (ext.searchlightActive) {
    const cx = zb.x + zb.w * 0.5;
    const cy = zb.y + zb.h * 0.5;
    ext.searchlightPos.x = cx + Math.cos(elapsedSeconds * 1.6) * 95;
    ext.searchlightPos.y = cy + Math.sin(elapsedSeconds * 1.1) * 75;
  }

  let rotorAudioLevel = 0;
  if (ext.rotorAudible) {
    const distToPad = Math.hypot(player.x - ext.heliTarget.x, player.y - ext.heliTarget.y);
    const proxFactor = Math.max(0.25, 1 - distToPad / 2800);
    const timeRamp = Math.min(
      1,
      (elapsedSeconds - t545AM) / (CONFIG.RUN_DURATION_SECONDS - t545AM)
    );
    rotorAudioLevel = (0.25 + 0.75 * timeRamp) * proxFactor;
  }

  if (elapsedSeconds >= tHeliVisible) {
    ext.heliVisible = true;
    ext.rotorAngle += dt * 26;
    const approachLerp = 1 - Math.exp(-1.4 * dt);
    ext.heliPosition.x += (ext.heliTarget.x - ext.heliPosition.x) * approachLerp;
    ext.heliPosition.y += (ext.heliTarget.y - ext.heliPosition.y) * approachLerp;
  }

  return {
    rotorAudioLevel,
    extractionMomentReached: elapsedSeconds >= CONFIG.RUN_DURATION_SECONDS,
  };
}
