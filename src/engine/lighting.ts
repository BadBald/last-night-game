import { CONFIG } from '../config';
import { WorldMapData } from '../data/map';
import {
  ActiveFlare,
  DistrictId,
  EnemyEntity,
  ExtractionState,
  PlayerState,
  RemoteSurvivorState,
} from '../types';
import { Camera } from './camera';
import { castVisibilityRay } from './collision';

const INTERIOR_TINT: Record<DistrictId, string> = {
  village: '255, 198, 132',
  road_f45: '255, 206, 150',
  residential: '255, 194, 126',
  commercial: '255, 214, 168',
  supermarket: '255, 226, 190',
  pharmacy: '198, 228, 255',
  hospital: '196, 226, 255',
  police: '186, 214, 244',
  industrial: '218, 226, 164',
  parking: '206, 220, 232',
  stadium: '226, 236, 255',
  military_base: '204, 228, 244',
  rooftop: '190, 214, 238',
  streets: '255, 208, 160',
};

const interiorTint = (district: DistrictId, flicker = 1): string => {
  const rgb = INTERIOR_TINT[district] ?? INTERIOR_TINT.streets;
  return `rgba(${rgb}, ${(0.072 * flicker).toFixed(3)})`;
};

export class LightingEngine {
  private lightCanvas: HTMLCanvasElement | null = null;
  private lightCtx: CanvasRenderingContext2D | null = null;
  private scale = 0.5; // Half-res lightmap for rock-solid 60 FPS with soft atmospheric falloff

  public computeVisibilityPolygon(
    world: WorldMapData,
    px: number,
    py: number,
    maxDist = 560,
    rayCount = 156
  ): { x: number; y: number }[] {
    const pts: { x: number; y: number }[] = [];
    const step = (Math.PI * 2) / rayCount;
    for (let i = 0; i < rayCount; i++) {
      const a = i * step;
      const d = castVisibilityRay(world, px, py, a, maxDist);
      pts.push({
        x: px + Math.cos(a) * d,
        y: py + Math.sin(a) * d,
      });
    }
    return pts;
  }

  public renderDarknessAndLights(
    mainCtx: CanvasRenderingContext2D,
    cam: Camera,
    world: WorldMapData,
    player: PlayerState,
    visPoly: { x: number; y: number }[],
    flares: ActiveFlare[],
    enemies: EnemyEntity[],
    extraction: ExtractionState,
    elapsedSeconds: number,
    powerGridOnline: boolean,
    isHeavyRain: boolean,
    isTitleMode: boolean,
    remoteSurvivors: RemoteSurvivorState[] = []
  ) {
    if (typeof document === 'undefined') return;
    const targetW = Math.max(160, Math.floor(cam.viewportW * this.scale));
    const targetH = Math.max(120, Math.floor(cam.viewportH * this.scale));

    if (
      !this.lightCanvas ||
      this.lightCanvas.width !== targetW ||
      this.lightCanvas.height !== targetH
    ) {
      this.lightCanvas = document.createElement('canvas');
      this.lightCanvas.width = targetW;
      this.lightCanvas.height = targetH;
      this.lightCtx = this.lightCanvas.getContext('2d');
    }
    const lctx = this.lightCtx;
    if (!lctx || !this.lightCanvas) return;

    const s = this.scale;
    const left = cam.renderLeft;
    const top = cam.renderTop;

    // Calculate ambient darkness alpha based on night progression & power grid
    const progress = elapsedSeconds / CONFIG.RUN_DURATION_SECONDS; // 0..1
    let darknessAlpha = powerGridOnline ? 0.72 : 0.89;
    if (isHeavyRain) darknessAlpha = Math.min(0.92, darknessAlpha + 0.03);
    // Subtle pre-dawn indigo lift after 5:35 AM
    if (progress > 0.92) {
      darknessAlpha -= (progress - 0.92) * 0.85;
    }
    if (isTitleMode) darknessAlpha = 0.74;

    lctx.save();
    lctx.globalCompositeOperation = 'source-over';
    lctx.fillStyle = powerGridOnline
      ? `rgba(6, 9, 15, ${darknessAlpha.toFixed(3)})`
      : `rgba(3, 5, 10, ${darknessAlpha.toFixed(3)})`;
    lctx.fillRect(0, 0, targetW, targetH);

    // Helper to punch out darkness with smooth radial gradient
    const punchLight = (wx: number, wy: number, radius: number, strength = 0.92) => {
      const sx = (wx - left) * s;
      const sy = (wy - top) * s;
      const sr = radius * s;
      if (sx + sr < 0 || sx - sr > targetW || sy + sr < 0 || sy - sr > targetH) return;
      const grad = lctx.createRadialGradient(sx, sy, sr * 0.08, sx, sy, sr);
      grad.addColorStop(0, `rgba(255,255,255,${strength})`);
      grad.addColorStop(0.55, `rgba(255,255,255,${strength * 0.45})`);
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      lctx.fillStyle = grad;
      lctx.beginPath();
      lctx.arc(sx, sy, sr, 0, Math.PI * 2);
      lctx.fill();
    };

    lctx.globalCompositeOperation = 'destination-out';

    // 1. Streetlights & Emergency Lights
    for (const sl of world.streetLights) {
      if (!powerGridOnline && !sl.emergencyOnly) continue;
      const flicker =
        Math.sin(elapsedSeconds * 9 + sl.flickerSeed) > 0.93 ? 0.65 : 1.0;
      punchLight(
        sl.x,
        sl.y,
        sl.radius * flicker,
        sl.emergencyOnly ? 0.62 : 0.82
      );
    }

    // 2. Interior Room Lights (before 1:00 AM power failure)
    if (powerGridOnline) {
      const T = CONFIG.TILE_SIZE;
      for (const r of world.rooms) {
        if (!r.hasInteriorLight) continue;
        const cx = (r.tx + r.tw * 0.5) * T;
        const cy = (r.ty + r.th * 0.5) * T;
        const rad = Math.max(r.tw, r.th) * T * 0.58;
        const flick = Math.sin(elapsedSeconds * 7.5 + r.flickerSeed) > 0.96 ? 0.5 : 1;
        punchLight(cx, cy, rad, 0.72 * flick);
      }
    }

    // 3. Active Road Flares
    for (const fl of flares) {
      if (fl.type === 'flare') {
        const j = 0.94 + Math.sin(elapsedSeconds * 18 + fl.x) * 0.06;
        punchLight(fl.x, fl.y, 195 * j, 0.95);
      }
    }

    // 4. Bioluminescent Blooms
    for (const e of enemies) {
      if (e.enemyClass === 'bloom' && e.state !== 'DEAD') {
        punchLight(e.x, e.y, 88, 0.45);
      }
    }

    // 5. Extraction Beacon & Auxiliary Floodlights (5:00 AM+ or Generator Powered)
    const hz = extraction.zoneBounds;
    const hcx = hz.x + hz.w * 0.5;
    const hcy = hz.y + hz.h * 0.5;
    if (extraction.generatorPowered) {
      punchLight(hcx, hcy, 340, 0.95);
    } else if (extraction.zoneActive) {
      punchLight(hcx, hcy, 210, 0.75);
    }

    // 6. Helicopter Sweeping Searchlight (5:50 AM+)
    if (extraction.searchlightActive) {
      punchLight(extraction.searchlightPos.x, extraction.searchlightPos.y, 245, 0.98);
    }

    // 7. Player Close Personal Awareness Halo + Clipped Flashlight Cone
    if (!isTitleMode && player.animState !== 'dead') {
      punchLight(player.x, player.y, CONFIG.AMBIENT_PERSONAL_GLOW, 0.76);

      if (player.flashlightOn && player.flashlightBattery > 0) {
        let beamPower = 0.96;
        if (player.flashlightBattery < 14) {
          // Low-battery nervous flicker
          beamPower = Math.sin(elapsedSeconds * 27) > -0.2 ? 0.78 : 0.22;
        }
        // Clip flashlight cone strictly inside player's wall-occluded visibility polygon!
        lctx.save();
        if (visPoly.length > 2) {
          lctx.beginPath();
          lctx.moveTo((visPoly[0].x - left) * s, (visPoly[0].y - top) * s);
          for (let i = 1; i < visPoly.length; i++) {
            lctx.lineTo((visPoly[i].x - left) * s, (visPoly[i].y - top) * s);
          }
          lctx.closePath();
          lctx.clip();
        }

        const px = (player.x - left) * s;
        const py = (player.y - top) * s;
        const range = CONFIG.FLASHLIGHT_RANGE * s;
        const grad = lctx.createRadialGradient(px, py, 4, px, py, range);
        grad.addColorStop(0, `rgba(255,255,255,${beamPower})`);
        grad.addColorStop(0.68, `rgba(255,255,255,${beamPower * 0.72})`);
        grad.addColorStop(1, 'rgba(255,255,255,0)');

        lctx.fillStyle = grad;
        lctx.beginPath();
        lctx.moveTo(px, py);
        lctx.arc(
          px,
          py,
          range,
          player.angle - CONFIG.FLASHLIGHT_HALF_ANGLE,
          player.angle + CONFIG.FLASHLIGHT_HALF_ANGLE
        );
        lctx.closePath();
        lctx.fill();
        lctx.restore();
      }
    }

    // 8. Rival Online Survivors' Phone Flashlight Cones (visible across dark streets & hallways!)
    if (!isTitleMode && remoteSurvivors.length > 0) {
      for (const rs of remoteSurvivors) {
        if (!rs.alive) continue;
        if (
          rs.x + 420 < left ||
          rs.x - 420 > left + cam.viewportW ||
          rs.y + 420 < top ||
          rs.y - 420 > top + cam.viewportH
        ) {
          continue;
        }
        if (rs.flashlightOn) {
          punchLight(rs.x, rs.y, 44, 0.55);
          const rx = (rs.x - left) * s;
          const ry = (rs.y - top) * s;
          const rRange = CONFIG.FLASHLIGHT_RANGE * 0.86 * s;
          const rGrad = lctx.createRadialGradient(rx, ry, 3, rx, ry, rRange);
          rGrad.addColorStop(0, 'rgba(255,255,255,0.82)');
          rGrad.addColorStop(0.65, 'rgba(255,255,255,0.48)');
          rGrad.addColorStop(1, 'rgba(255,255,255,0)');
          lctx.fillStyle = rGrad;
          lctx.beginPath();
          lctx.moveTo(rx, ry);
          lctx.arc(
            rx,
            ry,
            rRange,
            rs.angle - CONFIG.FLASHLIGHT_HALF_ANGLE * 0.92,
            rs.angle + CONFIG.FLASHLIGHT_HALF_ANGLE * 0.92
          );
          lctx.closePath();
          lctx.fill();
        }
      }
    }

    lctx.restore();

    // Composite darkness layer onto main viewport
    mainCtx.save();
    mainCtx.drawImage(this.lightCanvas, 0, 0, cam.viewportW, cam.viewportH);

    // Subtle colored atmospheric glow accents (emergency red, flares, spores, searchlight)
    const drawTintHalo = (wx: number, wy: number, rad: number, rgba: string) => {
      const sx = wx - left;
      const sy = wy - top;
      if (sx + rad < 0 || sx - rad > cam.viewportW || sy + rad < 0 || sy - rad > cam.viewportH) {
        return;
      }
      const g = mainCtx.createRadialGradient(sx, sy, 4, sx, sy, rad);
      g.addColorStop(0, rgba);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      mainCtx.fillStyle = g;
      mainCtx.beginPath();
      mainCtx.arc(sx, sy, rad, 0, Math.PI * 2);
      mainCtx.fill();
    };

    for (const sl of world.streetLights) {
      if (sl.emergencyOnly) {
        drawTintHalo(sl.x, sl.y, sl.radius * 0.75, 'rgba(220, 38, 38, 0.14)');
      } else if (powerGridOnline) {
        drawTintHalo(sl.x, sl.y, sl.radius * 0.65, 'rgba(251, 191, 36, 0.08)');
      }
    }

    // Interior light color temperature gives each building type its own mood:
    // amber homes and diners, clinical blue-white wards, sickly industrial sodium.
    if (powerGridOnline) {
      const T = CONFIG.TILE_SIZE;
      for (const r of world.rooms) {
        if (!r.hasInteriorLight) continue;
        const cx = (r.tx + r.tw * 0.5) * T;
        const cy = (r.ty + r.th * 0.5) * T;
        const rad = Math.max(r.tw, r.th) * T * 0.56;
        const flick = Math.sin(elapsedSeconds * 7.5 + r.flickerSeed) > 0.96 ? 0.45 : 1;
        drawTintHalo(cx, cy, rad, interiorTint(r.district, flick));
      }
    }
    for (const fl of flares) {
      if (fl.type === 'flare') {
        drawTintHalo(fl.x, fl.y, 170, 'rgba(239, 68, 68, 0.22)');
      }
    }
    if (extraction.searchlightActive) {
      drawTintHalo(
        extraction.searchlightPos.x,
        extraction.searchlightPos.y,
        220,
        'rgba(248, 250, 252, 0.18)'
      );
    }

    // 9. Warm flashlight fill + airborne dust motes.
    // The lightmap only carves darkness; this additive pass makes the beam feel
    // like a physical cone of light and lifts terrain detail inside it.
    if (
      !isTitleMode &&
      player.animState !== 'dead' &&
      player.flashlightOn &&
      player.flashlightBattery > 0
    ) {
      const flicker =
        player.flashlightBattery < 14
          ? Math.sin(elapsedSeconds * 27) > -0.2
            ? 1
            : 0.22
          : 1;
      const px = player.x - left;
      const py = player.y - top;
      const range = CONFIG.FLASHLIGHT_RANGE;
      const half = CONFIG.FLASHLIGHT_HALF_ANGLE;

      mainCtx.save();
      if (visPoly.length > 2) {
        mainCtx.beginPath();
        mainCtx.moveTo(visPoly[0].x - left, visPoly[0].y - top);
        for (let i = 1; i < visPoly.length; i++) {
          mainCtx.lineTo(visPoly[i].x - left, visPoly[i].y - top);
        }
        mainCtx.closePath();
        mainCtx.clip();
      }
      mainCtx.globalCompositeOperation = 'lighter';

      const beam = mainCtx.createRadialGradient(px, py, 8, px, py, range);
      beam.addColorStop(0, `rgba(255, 236, 202, ${(0.17 * flicker).toFixed(3)})`);
      beam.addColorStop(0.5, `rgba(255, 225, 182, ${(0.11 * flicker).toFixed(3)})`);
      beam.addColorStop(0.82, `rgba(255, 216, 168, ${(0.045 * flicker).toFixed(3)})`);
      beam.addColorStop(1, 'rgba(255, 210, 160, 0)');
      mainCtx.fillStyle = beam;
      mainCtx.beginPath();
      mainCtx.moveTo(px, py);
      mainCtx.arc(px, py, range, player.angle - half, player.angle + half);
      mainCtx.closePath();
      mainCtx.fill();

      // Suspended dust in the beam, drifting on a slow thermal current.
      for (let i = 0; i < 20; i++) {
        const seedA = ((i * 127.1) % 97) / 97;
        const seedB = ((i * 311.7) % 89) / 89;
        const dist = 46 + seedA * (range * 0.92);
        const sway = Math.sin(elapsedSeconds * (0.35 + seedB * 0.4) + i * 1.7) * 0.07;
        const ang = player.angle + (seedB - 0.5) * half * 1.7 + sway;
        const drift = Math.sin(elapsedSeconds * 0.5 + i * 2.3) * 8;
        const mx = px + Math.cos(ang) * (dist + drift);
        const my = py + Math.sin(ang) * (dist + drift) - 6;
        const moteAlpha =
          (0.05 + 0.1 * seedA) * (1 - dist / range) * flicker;
        if (moteAlpha <= 0.005) continue;
        mainCtx.fillStyle = `rgba(255, 240, 214, ${moteAlpha.toFixed(3)})`;
        mainCtx.beginPath();
        mainCtx.arc(mx, my, 0.9 + seedB * 1.1, 0, Math.PI * 2);
        mainCtx.fill();
      }
      mainCtx.restore();
    }

    mainCtx.restore();
  }
}
