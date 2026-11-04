import { CONFIG } from '../config';
import { ITEMS } from '../data/items';
import { WorldMapData } from '../data/map';
import {
  ActiveFlare,
  CampaignStage,
  ExtractionState,
  NoiseEvent,
  Particle,
  PlayerState,
  Projectile,
  RemoteSurvivorState,
  TileType,
} from '../types';
import { Camera } from './camera';
import { LightingEngine } from './lighting';
import { SpriteAtlas } from './sprites';

export interface RenderFrameContext {
  world: WorldMapData;
  cam: Camera;
  player: PlayerState;
  equippedItemId: string | null;
  remoteSurvivors: RemoteSurvivorState[];
  projectiles: Projectile[];
  particles: Particle[];
  noises: NoiseEvent[];
  flares: ActiveFlare[];
  extraction: ExtractionState;
  objectiveTarget: { x: number; y: number; stage: CampaignStage };
  elapsedSeconds: number;
  currentHourIndex: number;
  powerGridOnline: boolean;
  isHeavyRain: boolean;
  showAcousticRings: boolean;
  isTitleMode: boolean;
  isGamepadActive?: boolean;
  gamepadAimMagnitude?: number;
  localPlayerColor?: string;
}

export class WorldRenderer {
  private sprites = new SpriteAtlas();
  private lighting = new LightingEngine();
  private roofAlphaMap = new Map<string, number>();

  public render(ctx: CanvasRenderingContext2D, rc: RenderFrameContext) {
    const {
      world,
      cam,
      player,
      equippedItemId,
      remoteSurvivors,
      projectiles,
      particles,
      noises,
      flares,
      extraction,
      objectiveTarget,
      elapsedSeconds,
      currentHourIndex,
      powerGridOnline,
      isHeavyRain,
      showAcousticRings,
      isTitleMode,
      isGamepadActive,
      gamepadAimMagnitude = 0,
      localPlayerColor = '#3f523a',
    } = rc;

    const W = cam.viewportW;
    const H = cam.viewportH;
    const left = cam.renderLeft;
    const top = cam.renderTop;
    const T = CONFIG.TILE_SIZE;

    if (isTitleMode) {
      this.renderTitleScene(ctx, W, H, elapsedSeconds);
      return;
    }

    ctx.fillStyle = '#090c10';
    ctx.fillRect(0, 0, W, H);

    const visPoly = this.lighting.computeVisibilityPolygon(
      world,
      player.x,
      player.y,
      620,
      156
    );

    ctx.save();
    ctx.translate(-left, -top);

    // 1. Visible Tile Culling & Base Terrain Pass
    const minTx = Math.max(0, Math.floor(left / T) - 1);
    const maxTx = Math.min(world.width - 1, Math.ceil((left + W) / T) + 1);
    const minTy = Math.max(0, Math.floor(top / T) - 1);
    const maxTy = Math.min(world.height - 1, Math.ceil((top + H) / T) + 1);

    const isWallLike = (tx: number, ty: number): boolean => {
      if (tx < 0 || tx >= world.width || ty < 0 || ty >= world.height) return false;
      const tt = world.tiles[ty * world.width + tx] as TileType;
      return (
        tt === TileType.WALL_EXTERIOR ||
        tt === TileType.WALL_INTERIOR ||
        tt === TileType.WALL_BRICK ||
        tt === TileType.WALL_HOSPITAL ||
        tt === TileType.WALL_PARAPET ||
        tt === TileType.WINDOW ||
        tt === TileType.WINDOW_BROKEN ||
        tt === TileType.DOOR_CLOSED ||
        tt === TileType.DOOR_OPEN ||
        tt === TileType.BARRICADE
      );
    };

    // N=1 E=2 S=4 W=8 — drives contact shadows and raised wall edges.
    const wallMaskAt = (tx: number, ty: number): number =>
      (isWallLike(tx, ty - 1) ? 1 : 0) |
      (isWallLike(tx + 1, ty) ? 2 : 0) |
      (isWallLike(tx, ty + 1) ? 4 : 0) |
      (isWallLike(tx - 1, ty) ? 8 : 0);

    for (let ty = minTy; ty <= maxTy; ty++) {
      for (let tx = minTx; tx <= maxTx; tx++) {
        const t = world.tiles[ty * world.width + tx] as TileType;
        const px = tx * T;
        const py = ty * T;

        if (t === TileType.DOOR_CLOSED || t === TileType.DOOR_OPEN) {
          const verticalWall =
            (isWallLike(tx, ty - 1) || isWallLike(tx, ty + 1)) &&
            !(isWallLike(tx - 1, ty) && isWallLike(tx + 1, ty));
          this.sprites.drawDoor(ctx, t, px, py, verticalWall);
          continue;
        }

        this.sprites.drawTile(
          ctx,
          t,
          px,
          py,
          this.sprites.getTileVariant(tx, ty),
          wallMaskAt(tx, ty)
        );

        // Worn road centreline (Highway F45 + Quarantine City avenues)
        if (t === TileType.ASPHALT) {
          const worn = 0.24 + ((tx * 7 + ty * 13) % 5) * 0.02;
          ctx.fillStyle = `rgba(234, 179, 8, ${worn.toFixed(2)})`;
          if (ty === 56 && tx >= 38 && tx % 3 === 0) {
            ctx.fillRect(px + 6, py + 18, 26, 4);
            ctx.fillRect(px + 6, py + 24, 26, 1);
          } else if (ty === 28 && tx >= 96 && tx % 3 === 0) {
            ctx.fillRect(px + 6, py + 18, 26, 4);
            ctx.fillRect(px + 6, py + 24, 26, 1);
          } else if ((tx === 126 || tx === 164) && ty % 3 === 0) {
            ctx.fillRect(px + 18, py + 6, 4, 26);
            ctx.fillRect(px + 24, py + 6, 1, 26);
          }
        }

        // Wet asphalt sheen: deterministic puddles that catch the sky and
        // streetlight bloom without shimmering between frames.
        if (
          t === TileType.ASPHALT ||
          t === TileType.SIDEWALK ||
          t === TileType.ALLEY
        ) {
          const hash =
            (((tx * 73856093) ^ (ty * 19349663) ^ (tx * ty * 83492791)) >>> 0) % 97;
          if (hash < 7) {
            const cx = px + 8 + ((hash * 13) % 22);
            const cy = py + 9 + ((hash * 7) % 20);
            const rx = 8 + (hash % 5) * 2.2;
            const ry = 3.4 + (hash % 4) * 1.3;
            ctx.save();
            ctx.translate(cx, cy);
            ctx.rotate(((hash % 9) - 4) * 0.09);
            const puddle = ctx.createRadialGradient(0, 0, 1, 0, 0, rx);
            puddle.addColorStop(0, 'rgba(18, 30, 46, 0.26)');
            puddle.addColorStop(0.72, 'rgba(24, 38, 56, 0.18)');
            puddle.addColorStop(1, 'rgba(24, 38, 56, 0)');
            ctx.fillStyle = puddle;
            ctx.beginPath();
            ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
            ctx.fill();
            // Thin sky reflection along the upper lip of the puddle.
            ctx.strokeStyle = 'rgba(168, 196, 224, 0.16)';
            ctx.lineWidth = 0.9;
            ctx.beginPath();
            ctx.ellipse(-0.6, -0.9, rx * 0.72, ry * 0.62, 0, Math.PI * 1.08, Math.PI * 1.92);
            ctx.stroke();
            ctx.restore();
          }
        }
      }
    }

    // 1b. Ground Carnage Decals (Skid Marks, Scorch Soot, F45 Stencils & Blood Pools)
    for (const d of world.decals) {
      if (d.x + 60 < left || d.x - 60 > left + W || d.y + 60 < top || d.y - 60 > top + H) {
        continue;
      }
      this.sprites.drawDecal(ctx, d);
    }

    // 2. Helipad Markings & Extraction Beacon Strobe
    const hz = extraction.zoneBounds;
    if (
      hz.x + hz.w >= left &&
      hz.x <= left + W &&
      hz.y + hz.h >= top &&
      hz.y <= top + H
    ) {
      const hcx = hz.x + hz.w * 0.5;
      const hcy = hz.y + hz.h * 0.5;
      ctx.strokeStyle = extraction.zoneActive
        ? 'rgba(245, 158, 11, 0.85)'
        : 'rgba(245, 158, 11, 0.32)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(hcx, hcy, 125, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = extraction.zoneActive
        ? 'rgba(245, 158, 11, 0.72)'
        : 'rgba(148, 163, 184, 0.25)';
      ctx.fillRect(hcx - 42, hcy - 52, 16, 104);
      ctx.fillRect(hcx + 26, hcy - 52, 16, 104);
      ctx.fillRect(hcx - 42, hcy - 8, 84, 16);

      if (extraction.zoneActive) {
        const pulse = 0.5 + 0.5 * Math.sin(elapsedSeconds * 8);
        const cornerColor = extraction.contested
          ? `rgba(239, 68, 68, ${(0.45 + pulse * 0.55).toFixed(2)})`
          : `rgba(34, 197, 94, ${(0.35 + pulse * 0.6).toFixed(2)})`;
        ctx.fillStyle = cornerColor;
        for (const [cx, cy] of [
          [hz.x + 14, hz.y + 14],
          [hz.x + hz.w - 14, hz.y + 14],
          [hz.x + 14, hz.y + hz.h - 14],
          [hz.x + hz.w - 14, hz.y + hz.h - 14],
        ]) {
          ctx.beginPath();
          ctx.arc(cx, cy, 7, 0, Math.PI * 2);
          ctx.fill();
        }
        if (extraction.contested) {
          ctx.strokeStyle = `rgba(239, 68, 68, ${(0.5 + pulse * 0.45).toFixed(2)})`;
          ctx.lineWidth = 3;
          ctx.strokeRect(hz.x + 4, hz.y + 4, hz.w - 8, hz.h - 8);
          ctx.fillStyle = '#fecaca';
          ctx.font = '700 13px "Barlow Condensed", sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('CONTESTED LZ — ONLY 1 SEAT!', hcx, hcy - 68);
        }
      }
    }

    // 3. Contamination Spore Zones
    for (const sz of world.sporeZones) {
      if (sz.activeAfterHour > currentHourIndex) continue;
      if (
        sz.x + sz.radius < left ||
        sz.x - sz.radius > left + W ||
        sz.y + sz.radius < top ||
        sz.y - sz.radius > top + H
      ) {
        continue;
      }
      const pulse = 1 + Math.sin(elapsedSeconds * 2.1 + sz.x) * 0.06;
      const g = ctx.createRadialGradient(
        sz.x,
        sz.y,
        sz.radius * 0.15,
        sz.x,
        sz.y,
        sz.radius * pulse
      );
      g.addColorStop(0, 'rgba(132, 204, 22, 0.28)');
      g.addColorStop(0.7, 'rgba(101, 163, 13, 0.14)');
      g.addColorStop(1, 'rgba(101, 163, 13, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(sz.x, sz.y, sz.radius * pulse, 0, Math.PI * 2);
      ctx.fill();
    }

    // 4. Props & Searchable Containers
    for (const p of world.props) {
      if (p.x + p.w < left || p.x > left + W || p.y + p.h < top || p.y > top + H) continue;
      this.sprites.drawProp(ctx, p, elapsedSeconds);
    }

    for (const c of world.containers) {
      if (c.x + 24 < left || c.x - 24 > left + W || c.y + 24 < top || c.y - 24 > top + H) {
        continue;
      }
      this.sprites.drawContainer(ctx, c, elapsedSeconds);
    }

    // 4b. Street Lamps (poles + grounded light pools; the lightmap punches the real beam)
    for (const sl of world.streetLights) {
      if (
        sl.x + 60 < left ||
        sl.x - 60 > left + W ||
        sl.y + 60 < top ||
        sl.y - 60 > top + H
      ) {
        continue;
      }
      this.sprites.drawStreetLight(ctx, sl, elapsedSeconds, powerGridOnline);
    }

    // 5. Ground Item Pickups & Flares
    for (const gi of world.groundItems) {
      if (gi.x + 20 < left || gi.x - 20 > left + W || gi.y + 20 < top || gi.y - 20 > top + H) {
        continue;
      }
      const bob = Math.sin(elapsedSeconds * 4 + gi.x) * 2;
      this.sprites.drawGroundItem(ctx, gi.x, gi.y, gi.item.itemId, elapsedSeconds, bob);
      const def = ITEMS[gi.item.itemId];
      if (def) {
        ctx.fillStyle = 'rgba(8, 11, 16, 0.72)';
        const label = def.name.toUpperCase();
        ctx.font = '600 9px "Barlow Condensed", sans-serif';
        const tw = ctx.measureText(label).width;
        ctx.fillRect(gi.x - tw / 2 - 4, gi.y - 26 + bob, tw + 8, 12);
        ctx.fillStyle = '#e8dcc8';
        ctx.textAlign = 'center';
        ctx.fillText(label, gi.x, gi.y - 17 + bob);
      }
    }

    for (const fl of flares) {
      ctx.fillStyle = fl.type === 'flare' ? '#ef4444' : '#38bdf8';
      ctx.beginPath();
      ctx.arc(fl.x, fl.y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fef08a';
      ctx.beginPath();
      ctx.arc(fl.x, fl.y, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // 6. Acoustic Stealth Ripples
    if (showAcousticRings) {
      for (const n of noises) {
        const progress = Math.min(1, n.age / n.duration);
        const curRad = n.radius * (0.2 + 0.8 * Math.sqrt(progress));
        const alpha = (1 - progress) * (n.isMimicLure ? 0.42 : 0.28);
        ctx.strokeStyle = n.isMimicLure
          ? `rgba(244, 63, 94, ${alpha.toFixed(2)})`
          : `rgba(226, 232, 240, ${alpha.toFixed(2)})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(n.x, n.y, curRad, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // 7. Enemies (Clipped to Player Visibility Polygon)
    if (!isTitleMode && visPoly.length > 2) {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(visPoly[0].x, visPoly[0].y);
      for (let i = 1; i < visPoly.length; i++) {
        ctx.lineTo(visPoly[i].x, visPoly[i].y);
      }
      ctx.closePath();
      ctx.clip();

      for (const e of world.enemies) {
        if (
          e.x + 50 < left ||
          e.x - 50 > left + W ||
          e.y + 50 < top ||
          e.y - 50 > top + H
        ) {
          continue;
        }
        if (e.enemyClass === 'bloom' && e.state !== 'DEAD') {
          ctx.strokeStyle = 'rgba(132, 204, 22, 0.22)';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(e.x, e.y, 96, 0, Math.PI * 2);
          ctx.stroke();
        }
        this.sprites.drawEnemyTelegraph(ctx, e);
        this.sprites.drawEnemy(ctx, e);
      }

      // 7b. Rival Online Survivors (Clipped strictly to Player Line-of-Sight!)
      for (const rs of remoteSurvivors) {
        if (rs.extracted) continue;
        if (
          rs.x + 60 < left ||
          rs.x - 60 > left + W ||
          rs.y + 60 < top ||
          rs.y - 60 > top + H
        ) {
          continue;
        }
        const renderActor = {
          x: rs.x,
          y: rs.y,
          vx: rs.vx,
          vy: rs.vy,
          angle: rs.angle,
          isCrouching: rs.isCrouching,
          animState: rs.alive ? rs.animState : ('dead' as const),
          animTime: rs.animTime,
          hurtFlash: rs.hurtFlash,
          armorEquipped: rs.armorEquipped,
          flashlightOn: rs.flashlightOn,
          flashlightBattery: rs.flashlightOn ? 80 : 0,
          meleeSwingTimer: rs.meleeSwingTimer,
          meleeSwingAngle: rs.angle,
        };
        this.sprites.drawPlayer(ctx, renderActor, rs.color);
        if (rs.alive) {
          this.sprites.drawEquippedWeaponOnPlayer(ctx, renderActor, rs.equippedItemId);
          // Callsign & HP plate above visible rival
          const bw = 34;
          const hpRatio = Math.max(0, Math.min(1, rs.health / Math.max(1, rs.maxHealth)));
          ctx.fillStyle = 'rgba(9, 12, 16, 0.85)';
          ctx.fillRect(rs.x - bw / 2, rs.y - 25, bw, 4);
          ctx.fillStyle = hpRatio > 0.35 ? rs.color : '#ef4444';
          ctx.fillRect(rs.x - bw / 2 + 1, rs.y - 24, (bw - 2) * hpRatio, 2);

          ctx.fillStyle = '#f8fafc';
          ctx.font = '600 10px "JetBrains Mono", monospace';
          ctx.textAlign = 'center';
          ctx.fillText(rs.callsign, rs.x, rs.y - 29);
        }
      }

      ctx.restore();
    } else if (isTitleMode) {
      for (const e of world.enemies) {
        if (e.x + 50 < left || e.x - 50 > left + W || e.y + 50 < top || e.y - 50 > top + H) {
          continue;
        }
        this.sprites.drawEnemy(ctx, e);
      }
    }

    // 8. Player, Equipped Weapon & Diegetic Objective Bearing Chevron
    if (!isTitleMode) {
      const showChevron =
        player.animState !== 'dead' &&
        !(objectiveTarget.stage === 'SURVIVE_TO_HELIPAD' && extraction.playerInZone);

      if (showChevron) {
        const dx = objectiveTarget.x - player.x;
        const dy = objectiveTarget.y - player.y;
        const dist = Math.hypot(dx, dy);
        if (dist > 64) {
          const ang = Math.atan2(dy, dx);
          const orbitR = 36;
          const ix = player.x + Math.cos(ang) * orbitR;
          const iy = player.y + Math.sin(ang) * orbitR;
          ctx.save();
          ctx.translate(ix, iy);
          ctx.rotate(ang);
          ctx.fillStyle =
            objectiveTarget.stage === 'HOSPITAL_INJECTION'
              ? 'rgba(34, 211, 238, 0.85)'
              : extraction.zoneActive && objectiveTarget.stage === 'SURVIVE_TO_HELIPAD'
              ? 'rgba(52, 211, 153, 0.88)'
              : 'rgba(245, 158, 11, 0.78)';
          ctx.beginPath();
          ctx.moveTo(6.5, 0);
          ctx.lineTo(-4.5, -4.5);
          ctx.lineTo(-2, 0);
          ctx.lineTo(-4.5, 4.5);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }
      }

      this.sprites.drawPlayer(ctx, player, localPlayerColor);
      this.sprites.drawEquippedWeaponOnPlayer(ctx, player, equippedItemId);
    }

    // 9. Ballistic Projectiles & Pooled Particles
    for (const pr of projectiles) {
      if (!pr.active) continue;
      ctx.strokeStyle = pr.color;
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(pr.x, pr.y);
      ctx.lineTo(pr.x - pr.vx * 0.022, pr.y - pr.vy * 0.022);
      ctx.stroke();
    }

    const BRIGHT_PARTICLES = new Set([
      '#fde047',
      '#fef08a',
      '#fbbf24',
      '#f59e0b',
      '#22d3ee',
      '#bae6fd',
      '#38bdf8',
      '#f97316',
      '#fb923c',
      '#a3e635',
      '#84cc16',
      '#e2e8f0',
    ]);

    for (const pt of particles) {
      if (!pt.active) continue;
      const fade = Math.max(0, pt.alpha * (pt.life / pt.maxLife));
      ctx.globalAlpha = fade;
      ctx.fillStyle = pt.color;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, pt.size * 0.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Additive bloom on hot embers, sparks, spore motes and muzzle flashes.
    ctx.globalCompositeOperation = 'lighter';
    for (const pt of particles) {
      if (!pt.active || !BRIGHT_PARTICLES.has(pt.color)) continue;
      const fade = Math.max(0, pt.alpha * (pt.life / pt.maxLife));
      ctx.globalAlpha = fade * 0.2;
      ctx.fillStyle = pt.color;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, pt.size * 1.9, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;

    // 10. Seamless Interior Roof Canopy Cutaways
    for (const r of world.rooms) {
      if (!r.hasRoof) continue;
      const rx = r.tx * T;
      const ry = r.ty * T;
      const rw = r.tw * T;
      const rh = r.th * T;
      if (rx + rw < left || rx > left + W || ry + rh < top || ry > top + H) continue;

      const margin = 18;
      const playerInside =
        !isTitleMode &&
        player.x >= rx - margin &&
        player.x <= rx + rw + margin &&
        player.y >= ry - margin &&
        player.y <= ry + rh + margin;

      const prevAlpha = this.roofAlphaMap.get(r.id) ?? 1;
      const targetAlpha = playerInside ? 0 : 0.94;
      const nextAlpha = prevAlpha + (targetAlpha - prevAlpha) * 0.18;
      this.roofAlphaMap.set(r.id, nextAlpha);

      if (nextAlpha > 0.02) {
        this.sprites.drawRoof(ctx, r, rx, ry, rw, rh, nextAlpha);
      }
    }

    // 11. Physical Rescue Helicopter (5:52 AM – 6:00 AM)
    if (extraction.heliVisible) {
      this.sprites.drawHelicopter(
        ctx,
        extraction.heliPosition.x,
        extraction.heliPosition.y,
        extraction.rotorAngle,
        elapsedSeconds
      );
    }

    // 12. Wall-Shadow Occlusion Shroud
    if (!isTitleMode && visPoly.length > 2) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(left - 20, top - 20, W + 40, H + 40);
      ctx.moveTo(visPoly[0].x, visPoly[0].y);
      for (let i = 1; i < visPoly.length; i++) {
        ctx.lineTo(visPoly[i].x, visPoly[i].y);
      }
      ctx.closePath();
      ctx.fillStyle = 'rgba(5, 7, 12, 0.56)';
      ctx.fill('evenodd');
      ctx.restore();
    }

    ctx.restore();

    // 13. Dynamic Darkness & Flashlight Composite Pass
    this.lighting.renderDarknessAndLights(
      ctx,
      cam,
      world,
      player,
      visPoly,
      flares,
      world.enemies,
      extraction,
      elapsedSeconds,
      powerGridOnline,
      isHeavyRain,
      isTitleMode,
      remoteSurvivors
    );

    // 13b. Enemy Status Pass — health, alert diamonds, drawn above darkness for legibility
    if (!isTitleMode && visPoly.length > 2) {
      ctx.save();
      ctx.translate(-left, -top);
      ctx.beginPath();
      ctx.moveTo(visPoly[0].x, visPoly[0].y);
      for (let i = 1; i < visPoly.length; i++) {
        ctx.lineTo(visPoly[i].x, visPoly[i].y);
      }
      ctx.closePath();
      ctx.clip();
      for (const e of world.enemies) {
        if (e.state === 'DEAD') continue;
        if (e.x + 60 < left || e.x - 60 > left + W || e.y + 60 < top || e.y - 60 > top + H) {
          continue;
        }
        this.sprites.drawEnemyOverlay(ctx, e, elapsedSeconds);
      }
      ctx.restore();
    }

    // 14. Twin-Stick Controller Aim Reticle (Drawn post-lighting for darkness legibility)
    if (!isTitleMode && isGamepadActive && player.animState !== 'dead') {
      const eqDef = equippedItemId ? ITEMS[equippedItemId] : null;
      const isRanged = eqDef?.category === 'weapon_ranged';
      const baseDist = isRanged ? 104 : 62;
      const aimDist = baseDist + gamepadAimMagnitude * (isRanged ? 58 : 22);
      const rx = player.x - left + Math.cos(player.angle) * aimDist;
      const ry = player.y - top + Math.sin(player.angle) * aimDist;
      const sx = player.x - left + Math.cos(player.angle) * 24;
      const sy = player.y - top + Math.sin(player.angle) * 24;

      ctx.save();
      ctx.strokeStyle = isRanged
        ? 'rgba(226, 109, 39, 0.28)'
        : 'rgba(230, 214, 195, 0.2)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 5]);
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(rx, ry);
      ctx.stroke();
      ctx.setLineDash([]);

      const tickGap = isRanged ? 4.5 : 3.5;
      const tickLen = isRanged ? 5.5 : 4;
      ctx.translate(rx, ry);
      ctx.strokeStyle =
        gamepadAimMagnitude > 0.1
          ? 'rgba(243, 156, 89, 0.92)'
          : 'rgba(230, 214, 195, 0.65)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(-tickGap - tickLen, 0);
      ctx.lineTo(-tickGap, 0);
      ctx.moveTo(tickGap, 0);
      ctx.lineTo(tickGap + tickLen, 0);
      ctx.moveTo(0, -tickGap - tickLen);
      ctx.lineTo(0, -tickGap);
      ctx.moveTo(0, tickGap);
      ctx.lineTo(0, tickGap + tickLen);
      ctx.stroke();

      ctx.fillStyle = 'rgba(226, 109, 39, 0.9)';
      ctx.beginPath();
      ctx.arc(0, 0, 1.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // 15. Atmospheric Rain Streaks
    this.renderWeatherOverlay(ctx, W, H, elapsedSeconds, isHeavyRain);

    // 15b. Drifting ground fog, rare lightning and film grain
    if (!isTitleMode) {
      for (let i = 0; i < 3; i++) {
        const fogY = H * (0.5 + i * 0.17) + Math.sin(elapsedSeconds * 0.11 + i * 2.1) * 14;
        const fogX =
          (((elapsedSeconds * (7 + i * 5) + i * 420) % (W + 700)) - 350) * (i % 2 === 0 ? 1 : -1);
        const fg = ctx.createRadialGradient(fogX, fogY, 20, fogX, fogY, W * 0.42);
        fg.addColorStop(0, `rgba(140, 158, 178, ${0.05 - i * 0.008})`);
        fg.addColorStop(0.6, `rgba(120, 138, 160, ${0.028 - i * 0.005})`);
        fg.addColorStop(1, 'rgba(110, 128, 150, 0)');
        ctx.fillStyle = fg;
        ctx.fillRect(0, fogY - H * 0.24, W, H * 0.48);
      }

      if (isHeavyRain) {
        const lc = elapsedSeconds % 26;
        const flash = lc < 0.26 ? 1 - lc / 0.26 : 0;
        if (flash > 0.01) {
          ctx.fillStyle = `rgba(203, 225, 255, ${(flash * 0.12).toFixed(3)})`;
          ctx.fillRect(0, 0, W, H);
        }
      }

      // Sparse animated film grain keeps flat gradients from banding.
      ctx.fillStyle = 'rgba(255, 255, 255, 0.035)';
      for (let g = 0; g < 80; g++) {
        const gx = Math.random() * W;
        const gy = Math.random() * H;
        ctx.fillRect(gx, gy, 1, 1);
      }

      // Permanent cinematic corner falloff.
      const vg = ctx.createRadialGradient(
        W * 0.5,
        H * 0.5,
        Math.min(W, H) * 0.34,
        W * 0.5,
        H * 0.5,
        Math.max(W, H) * 0.72
      );
      vg.addColorStop(0, 'rgba(4, 6, 10, 0)');
      vg.addColorStop(1, 'rgba(4, 6, 10, 0.42)');
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, W, H);
    }

    // 16. Survival Vignettes
    if (!isTitleMode) {
      if (player.health < 35) {
        const pulse = 0.22 + 0.14 * Math.sin(elapsedSeconds * 5.5);
        const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.28, W / 2, H / 2, W * 0.65);
        vg.addColorStop(0, 'rgba(0,0,0,0)');
        vg.addColorStop(1, `rgba(153, 27, 27, ${pulse.toFixed(2)})`);
        ctx.fillStyle = vg;
        ctx.fillRect(0, 0, W, H);
      }
      if (player.contamination > 50) {
        const cAlpha = ((player.contamination - 50) / 50) * 0.22;
        const cg = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, W * 0.68);
        cg.addColorStop(0, 'rgba(0,0,0,0)');
        cg.addColorStop(1, `rgba(101, 163, 13, ${cAlpha.toFixed(2)})`);
        ctx.fillStyle = cg;
        ctx.fillRect(0, 0, W, H);
      }
    }
  }

  private renderWeatherOverlay(
    ctx: CanvasRenderingContext2D,
    W: number,
    H: number,
    elapsed: number,
    heavy: boolean
  ) {
    const dropCount = heavy ? 95 : 38;
    ctx.save();
    ctx.strokeStyle = heavy
      ? 'rgba(186, 230, 253, 0.22)'
      : 'rgba(148, 163, 184, 0.13)';
    ctx.lineWidth = heavy ? 1.4 : 1;
    ctx.beginPath();
    for (let i = 0; i < dropCount; i++) {
      const seedX = (i * 197 + Math.floor(elapsed * (heavy ? 540 : 340))) % (W + 120);
      const seedY = (i * 311 + Math.floor(elapsed * (heavy ? 880 : 560))) % (H + 120);
      const rx = seedX - 60;
      const ry = seedY - 60;
      ctx.moveTo(rx, ry);
      ctx.lineTo(rx - (heavy ? 9 : 5), ry + (heavy ? 22 : 14));
    }
    ctx.stroke();
    ctx.restore();
  }

  private renderTitleScene(
    ctx: CanvasRenderingContext2D,
    W: number,
    H: number,
    elapsed: number
  ) {
    // 1. Deep Starry Midnight Sky Canvas (Pure dark on the left behind menu, moody city horizon on the right)
    const skyGrad = ctx.createLinearGradient(0, 0, 0, H);
    skyGrad.addColorStop(0, '#020307');
    skyGrad.addColorStop(0.62, '#04060d');
    skyGrad.addColorStop(0.84, '#090d17');
    skyGrad.addColorStop(1, '#040508');
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, W, H);

    const horizonY = H * 0.74;
    const cityStartX = W * 0.5;

    // 2. Crisp Twinkling Starfield (naturally fading near horizon mist)
    const starCount = 210;
    for (let i = 0; i < starCount; i++) {
      const hx = ((i * 7919 + 104729) % 10000) / 10000;
      const hy = (((i * 6271 + 73856) % 10000) / 10000) * 0.72;
      const sx = hx * W;
      const sy = hy * H;

      const horizonFade = Math.max(0, Math.min(1, (0.68 - hy) * 3.2));
      const twinkle = 0.5 + 0.5 * Math.sin(elapsed * (0.65 + (i % 6) * 0.28) + i * 1.9);
      const baseAlpha = (i % 13 === 0 ? 0.85 : i % 4 === 0 ? 0.52 : 0.28) * horizonFade;
      const alpha = baseAlpha * twinkle;
      if (alpha <= 0.02) continue;

      const size = i % 19 === 0 ? 1.8 : i % 5 === 0 ? 1.3 : 1.0;
      ctx.fillStyle =
        i % 11 === 0
          ? `rgba(254, 215, 170, ${alpha.toFixed(3)})`
          : i % 7 === 0
          ? `rgba(186, 230, 253, ${alpha.toFixed(3)})`
          : `rgba(248, 245, 238, ${alpha.toFixed(3)})`;
      ctx.fillRect(sx, sy, size, size);
    }

    // Subtle Waning Crescent Moon high over the distant city
    const moonX = W * 0.85;
    const moonY = H * 0.16;
    const moonR = Math.max(12, Math.min(20, Math.min(W, H) * 0.024));
    ctx.save();
    const moonHalo = ctx.createRadialGradient(moonX, moonY, moonR * 0.5, moonX, moonY, moonR * 4.2);
    moonHalo.addColorStop(0, 'rgba(248, 242, 228, 0.12)');
    moonHalo.addColorStop(1, 'rgba(248, 242, 228, 0)');
    ctx.fillStyle = moonHalo;
    ctx.beginPath();
    ctx.arc(moonX, moonY, moonR * 4.2, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = 'rgba(247, 242, 231, 0.82)';
    ctx.beginPath();
    ctx.arc(moonX, moonY, moonR, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#03050a';
    ctx.beginPath();
    ctx.arc(moonX - moonR * 0.38, moonY - moonR * 0.14, moonR * 0.92, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // 3. Smoldering Quarantine City Horizon Glow (Right Side)
    const cityGlowX = W * 0.77;
    const cityGlow = ctx.createRadialGradient(
      cityGlowX,
      horizonY,
      12,
      cityGlowX,
      horizonY,
      W * 0.44
    );
    const glowPulse = 0.94 + 0.06 * Math.sin(elapsed * 1.4);
    cityGlow.addColorStop(0, `rgba(185, 28, 36, ${(0.34 * glowPulse).toFixed(3)})`);
    cityGlow.addColorStop(0.4, `rgba(127, 20, 27, ${(0.18 * glowPulse).toFixed(3)})`);
    cityGlow.addColorStop(0.74, 'rgba(38, 12, 18, 0.08)');
    cityGlow.addColorStop(1, 'rgba(2, 3, 7, 0)');
    ctx.fillStyle = cityGlow;
    ctx.fillRect(0, 0, W, H);

    // 4. Slow-Sweeping Quarantine Searchlight Beams Behind the City Skyline
    const drawSearchlight = (
      originX: number,
      baseAngle: number,
      sweepAmp: number,
      speed: number,
      beamLen: number,
      alpha: number
    ) => {
      const ang = baseAngle + Math.sin(elapsed * speed) * sweepAmp;
      const dx = Math.cos(ang) * beamLen;
      const dy = Math.sin(ang) * beamLen;
      const perpX = -Math.sin(ang);
      const perpY = Math.cos(ang);
      const tipHalfW = beamLen * 0.095;

      const grad = ctx.createLinearGradient(
        originX,
        horizonY,
        originX + dx,
        horizonY + dy
      );
      grad.addColorStop(0, `rgba(254, 243, 199, ${alpha.toFixed(3)})`);
      grad.addColorStop(0.55, `rgba(251, 191, 36, ${(alpha * 0.35).toFixed(3)})`);
      grad.addColorStop(1, 'rgba(251, 191, 36, 0)');

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(originX - 2, horizonY);
      ctx.lineTo(originX + dx - perpX * tipHalfW, horizonY + dy - perpY * tipHalfW);
      ctx.lineTo(originX + dx + perpX * tipHalfW, horizonY + dy + perpY * tipHalfW);
      ctx.lineTo(originX + 2, horizonY);
      ctx.closePath();
      ctx.fill();
    };

    drawSearchlight(W * 0.66, -Math.PI * 0.56, 0.24, 0.21, H * 0.62, 0.09);
    drawSearchlight(W * 0.86, -Math.PI * 0.44, 0.2, 0.16, H * 0.56, 0.075);

    // 5. Rising City Quarantine Smoke Plumes
    for (const [smokeBaseFrac, heightFrac, driftPhase] of [
      [0.69, 0.34, 0],
      [0.88, 0.28, 2.4],
    ]) {
      const sbx = W * smokeBaseFrac;
      const sbh = H * heightFrac;
      const segs = 20;
      for (let s = 0; s < segs; s++) {
        const t0 = s / segs;
        const t1 = (s + 1) / segs;
        const y0 = horizonY - H * 0.08 - t0 * sbh;
        const y1 = horizonY - H * 0.08 - t1 * sbh;
        const x0 = sbx + Math.sin(t0 * 4.5 - elapsed * 0.45 + driftPhase) * (4 + t0 * 14) - t0 * 16;
        const x1 = sbx + Math.sin(t1 * 4.5 - elapsed * 0.45 + driftPhase) * (4 + t1 * 14) - t1 * 16;
        const w0 = 5 + t0 * 18;
        const w1 = 5 + t1 * 18;
        const sAlpha = Math.sin(Math.min(1, t0 * 3) * (Math.PI * 0.5)) * (1 - t0) * 0.16;
        ctx.fillStyle = `rgba(120, 74, 52, ${sAlpha.toFixed(3)})`;
        ctx.beginPath();
        ctx.moveTo(x0 - w0, y0);
        ctx.lineTo(x1 - w1, y1);
        ctx.lineTo(x1 + w1, y1);
        ctx.lineTo(x0 + w0, y0);
        ctx.closePath();
        ctx.fill();
      }
    }

    // 6. Quarantine City Skyline (Slowly Breathing Parallax on Right Horizon)
    // Subtle slow forward drift / camera breathing toward the city
    const cityDriftX = Math.sin(elapsed * 0.07) * 6;
    const citySpanW = W * 0.52;

    // 6a. Distant Back-Row High-Rises
    const backBuildings: [number, number, number][] = [
      [0.06, 0.055, 0.13],
      [0.13, 0.065, 0.19],
      [0.22, 0.07, 0.24],
      [0.31, 0.06, 0.17],
      [0.41, 0.075, 0.29],
      [0.52, 0.065, 0.21],
      [0.61, 0.08, 0.26],
      [0.72, 0.07, 0.18],
      [0.82, 0.08, 0.23],
      [0.91, 0.09, 0.15],
    ];
    ctx.fillStyle = '#080c14';
    for (const [fx, fw, fh] of backBuildings) {
      const bx = cityStartX + fx * citySpanW + cityDriftX * 0.5;
      const bw = fw * citySpanW;
      const bh = fh * H;
      ctx.fillRect(bx, horizonY - bh, bw, bh + 4);
    }

    // 6b. Main Architectural City Silhouette (St. Jude Hospital, Meridian Tower, Civic Blocks & Radio Mast)
    const foreBuildings: {
      fx: number;
      fw: number;
      fh: number;
      stepped?: boolean;
      hospital?: boolean;
      helipadTower?: boolean;
    }[] = [
      { fx: 0.03, fw: 0.06, fh: 0.1 },
      { fx: 0.1, fw: 0.085, fh: 0.16, hospital: true }, // St. Jude Hospital
      { fx: 0.2, fw: 0.065, fh: 0.21 },
      { fx: 0.28, fw: 0.075, fh: 0.15 },
      { fx: 0.37, fw: 0.088, fh: 0.34, stepped: true, helipadTower: true }, // Meridian Tower
      { fx: 0.47, fw: 0.07, fh: 0.22 },
      { fx: 0.55, fw: 0.085, fh: 0.27, stepped: true },
      { fx: 0.65, fw: 0.068, fh: 0.17 },
      { fx: 0.73, fw: 0.082, fh: 0.24 },
      { fx: 0.83, fw: 0.075, fh: 0.14 },
      { fx: 0.92, fw: 0.09, fh: 0.19 },
    ];

    for (let bIdx = 0; bIdx < foreBuildings.length; bIdx++) {
      const b = foreBuildings[bIdx];
      const bx = cityStartX + b.fx * citySpanW + cityDriftX;
      const bw = b.fw * citySpanW;
      const bh = b.fh * H;
      const topY = horizonY - bh;

      ctx.fillStyle = '#04060b';
      ctx.fillRect(bx, topY, bw, bh + 6);

      // Subtle dark-crimson rim-edge on building side
      ctx.fillStyle = 'rgba(185, 32, 40, 0.2)';
      ctx.fillRect(bx, topY, 1.2, bh);

      if (b.stepped) {
        const crownW = bw * 0.64;
        const crownH = bh * 0.14;
        const crownX = bx + (bw - crownW) * 0.5;
        ctx.fillStyle = '#04060b';
        ctx.fillRect(crownX, topY - crownH, crownW, crownH + 2);
        // Spire
        ctx.fillRect(bx + bw * 0.5 - 0.8, topY - crownH - 18, 1.6, 18);

        if (b.helipadTower) {
          // Blinking rooftop extraction helipad beacon on Meridian Tower
          const blink = 0.25 + 0.75 * Math.max(0, Math.sin(elapsed * 2.8));
          ctx.fillStyle = `rgba(245, 158, 11, ${blink.toFixed(3)})`;
          ctx.beginPath();
          ctx.arc(bx + bw * 0.5, topY - crownH - 19, 2.1, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      if (b.hospital) {
        // Subtle St. Jude Hospital emergency medical cross
        const cx = bx + bw * 0.5;
        const cy = topY + 14;
        ctx.fillStyle = 'rgba(56, 189, 248, 0.72)';
        ctx.fillRect(cx - 1.3, cy - 4.5, 2.6, 9);
        ctx.fillRect(cx - 4.5, cy - 1.3, 9, 2.6);
      }

      // Sparse flickering skyscraper windows
      const cols = Math.max(2, Math.floor(bw / 9));
      const rows = Math.max(3, Math.floor(bh / 11));
      for (let r = 1; r < rows - 1; r++) {
        for (let c = 0; c < cols; c++) {
          const seed = bIdx * 131 + r * 37 + c * 17;
          if (seed % 5 !== 0 && seed % 7 !== 0) continue;
          const flick = Math.sin(elapsed * (0.4 + (seed % 5) * 0.25) + seed);
          if (flick < -0.25) continue;
          const wx = bx + 4 + c * ((bw - 8) / cols);
          const wy = topY + 6 + r * ((bh - 12) / rows);
          const winAlpha = 0.22 + (seed % 3) * 0.14;
          ctx.fillStyle =
            b.hospital && seed % 2 === 0
              ? `rgba(125, 211, 252, ${(winAlpha * 0.85).toFixed(3)})`
              : `rgba(251, 191, 36, ${winAlpha.toFixed(3)})`;
          ctx.fillRect(wx, wy, 2.5, 3.2);
        }
      }
    }

    // Fort Vanguard Radio Lattice Mast on right skyline with red aviation strobe
    const mastX = cityStartX + 0.79 * citySpanW + cityDriftX;
    const mastH = H * 0.28;
    ctx.strokeStyle = '#070a12';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(mastX - 6, horizonY);
    ctx.lineTo(mastX, horizonY - mastH);
    ctx.lineTo(mastX + 6, horizonY);
    ctx.stroke();
    const strobe = Math.sin(elapsed * 3.4) > 0.35 ? 0.92 : 0.18;
    ctx.fillStyle = `rgba(239, 68, 68, ${strobe})`;
    ctx.beginPath();
    ctx.arc(mastX, horizonY - mastH - 1, 2, 0, Math.PI * 2);
    ctx.fill();

    // Distant Patrol / Rescue Helicopter Slowly Drifting Above Quarantine City
    const heliCycle = (elapsed * 0.022) % 1;
    const heliX = W * 0.96 - heliCycle * (W * 0.36);
    const heliY = horizonY - H * 0.34 + Math.sin(elapsed * 0.9) * 4;
    ctx.save();
    ctx.translate(heliX, heliY);
    // Faint downward searchlight cone from helicopter
    const hBeam = ctx.createLinearGradient(0, 0, -18, 68);
    hBeam.addColorStop(0, 'rgba(248, 250, 252, 0.18)');
    hBeam.addColorStop(1, 'rgba(248, 250, 252, 0)');
    ctx.fillStyle = hBeam;
    ctx.beginPath();
    ctx.moveTo(0, 2);
    ctx.lineTo(-28, 70);
    ctx.lineTo(-6, 70);
    ctx.closePath();
    ctx.fill();
    // Tiny helicopter fuselage & rotor glint
    ctx.fillStyle = '#05070c';
    ctx.fillRect(-5, -2, 8, 3.5);
    ctx.fillRect(3, -1.2, 6, 1.4);
    const rotorSpan = 7 + 4 * Math.abs(Math.sin(elapsed * 28));
    ctx.strokeStyle = 'rgba(226, 232, 240, 0.45)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-rotorSpan, -3.2);
    ctx.lineTo(rotorSpan, -3.2);
    ctx.stroke();
    if (Math.sin(elapsed * 5.2) > 0.2) {
      ctx.fillStyle = 'rgba(239, 68, 68, 0.85)';
      ctx.fillRect(8, -2, 1.6, 1.6);
    }
    ctx.restore();

    // 7. Ground & Perspective Highway F45 Leading From Woods Into Quarantine City
    ctx.fillStyle = '#04060a';
    ctx.fillRect(0, horizonY, W, H - horizonY);

    // Subtle perspective road ribbon converging toward Quarantine City gate (x = cityStartX + 0.06 * citySpanW)
    const gateX = cityStartX + 0.06 * citySpanW;
    const roadGrad = ctx.createLinearGradient(0, horizonY, 0, H);
    roadGrad.addColorStop(0, 'rgba(30, 36, 48, 0.55)');
    roadGrad.addColorStop(1, 'rgba(11, 14, 20, 0.92)');
    ctx.fillStyle = roadGrad;
    ctx.beginPath();
    ctx.moveTo(gateX - 8, horizonY);
    ctx.lineTo(gateX + 12, horizonY);
    ctx.lineTo(W * 0.44, H);
    ctx.lineTo(-W * 0.08, H);
    ctx.closePath();
    ctx.fill();

    // Moving perspective road dashes flowing from the city gate past the camera (traveling toward the city!)
    ctx.strokeStyle = 'rgba(234, 179, 8, 0.28)';
    ctx.lineWidth = 1.6;
    const dashCount = 9;
    const roadFlow = (elapsed * 0.22) % 1;
    for (let d = 0; d < dashCount; d++) {
      const linearT = (d + roadFlow) / dashCount;
      // Perspective quadratic spacing (faster & wider near bottom, tiny near city gate)
      const p0 = linearT * linearT;
      const p1 = Math.min(1, (linearT + 0.045) * (linearT + 0.045));
      const rx0 = gateX + (W * 0.18 - gateX) * p0;
      const ry0 = horizonY + (H - horizonY) * p0;
      const rx1 = gateX + (W * 0.18 - gateX) * p1;
      const ry1 = horizonY + (H - horizonY) * p1;
      ctx.globalAlpha = Math.min(1, linearT * 1.4) * 0.55;
      ctx.beginPath();
      ctx.moveTo(rx0, ry0);
      ctx.lineTo(rx1, ry1);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Dark crimson emergency flare/beacon reflection on wet highway
    const gateLamp = ctx.createRadialGradient(gateX, horizonY, 2, gateX, horizonY, 56);
    gateLamp.addColorStop(0, 'rgba(200, 38, 44, 0.42)');
    gateLamp.addColorStop(1, 'rgba(153, 27, 27, 0)');
    ctx.fillStyle = gateLamp;
    ctx.beginPath();
    ctx.arc(gateX, horizonY, 56, 0, Math.PI * 2);
    ctx.fill();

    // 8. Slow-Moving Multi-Layer Parallax Forest Transitioning Into the City!
    // As the camera travels slowly eastward toward Quarantine City on the right,
    // countryside pine & oak silhouettes glide smoothly right-to-left in 3 depth planes,
    // gradually clearing out near x > 0.62W so the forest opens into the city skyline!
    const drawParallaxPine = (
      tx: number,
      baseY: number,
      treeH: number,
      treeW: number,
      sway: number,
      color: string,
      cityRimAlpha: number
    ) => {
      if (treeH < 8) return;
      // Trunk
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(tx - treeW * 0.09, baseY);
      ctx.lineTo(tx - treeW * 0.04 + sway * 0.4, baseY - treeH * 0.85);
      ctx.lineTo(tx + treeW * 0.04 + sway * 0.4, baseY - treeH * 0.85);
      ctx.lineTo(tx + treeW * 0.09, baseY);
      ctx.closePath();
      ctx.fill();

      // Layered conifer boughs swaying gently in the night wind
      const tiers = 5;
      for (let t = 0; t < tiers; t++) {
        const prog = t / tiers;
        const tierSway = sway * (0.25 + prog * 0.85);
        const yBot = baseY - treeH * (0.18 + prog * 0.62);
        const yTop = baseY - treeH * (0.46 + prog * 0.54);
        const halfSpan = treeW * (1 - prog * 0.6);

        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(tx + tierSway, yTop);
        ctx.lineTo(tx - halfSpan + tierSway * 0.5, yBot);
        ctx.lineTo(tx + tierSway * 0.6, yBot - treeH * 0.03);
        ctx.lineTo(tx + halfSpan + tierSway * 0.5, yBot);
        ctx.closePath();
        ctx.fill();

        // Subtle dark crimson city-glow rim highlight on right-facing bough edge
        if (cityRimAlpha > 0.015) {
          ctx.strokeStyle = `rgba(185, 32, 40, ${cityRimAlpha.toFixed(3)})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(tx + tierSway, yTop);
          ctx.lineTo(tx + halfSpan + tierSway * 0.5, yBot);
          ctx.stroke();
        }
      }
    };

    const renderMovingTreeLayer = (
      count: number,
      speedPxPerSec: number,
      baseY: number,
      minH: number,
      maxH: number,
      clearOutStartFrac: number,
      clearOutEndFrac: number,
      color: string,
      rimScale: number,
      seedOffset: number
    ) => {
      const wrapSpan = W * 1.25;
      for (let i = 0; i < count; i++) {
        const seed = i * 977 + seedOffset;
        const jitter = ((seed * 4999) % 1000) / 1000;
        const rawX = (i / count) * wrapSpan + jitter * (wrapSpan / count) * 0.75;
        // Continuous slow right-to-left parallax motion
        const tx =
          (((rawX - elapsed * speedPxPerSec) % wrapSpan) + wrapSpan) % wrapSpan -
          W * 0.12;

        const normX = tx / W;
        // Smoothly taper forest height down to 0 as trees approach the city outskirts on the right
        if (normX >= clearOutEndFrac) continue;
        const envelope =
          normX <= clearOutStartFrac
            ? 1
            : 1 -
              Math.pow(
                (normX - clearOutStartFrac) /
                  (clearOutEndFrac - clearOutStartFrac),
                1.4
              );

        const sizeVar = 0.68 + (((seed * 313) % 100) / 100) * 0.52;
        const treeH = (minH + (maxH - minH) * sizeVar) * envelope;
        const treeW = treeH * (0.31 + (((seed * 179) % 100) / 100) * 0.08);
        const sway =
          Math.sin(elapsed * (0.9 + (i % 4) * 0.22) + i * 1.7) *
          (1.8 + treeH * 0.018);

        // Trees closer to the city glow catch warm amber rim-light on their right side
        const rimBoost = Math.max(0, Math.min(1, (normX + 0.05) * 1.4)) * rimScale;
        drawParallaxPine(tx, baseY, treeH, treeW, sway, color, rimBoost);
      }
    };

    // Layer 8a: Distant Forest Ridge slowly receding into the city horizon (6 px/s)
    renderMovingTreeLayer(
      26,
      6.5,
      horizonY + 3,
      H * 0.07,
      H * 0.16,
      0.42,
      0.66,
      '#080c13',
      0.11,
      101
    );

    // Drifting Low Woodland Mist Ribbon between distant and mid trees
    const mistGrad = ctx.createLinearGradient(0, horizonY - 22, 0, horizonY + 36);
    mistGrad.addColorStop(0, 'rgba(15, 23, 36, 0)');
    mistGrad.addColorStop(0.5, 'rgba(20, 27, 40, 0.26)');
    mistGrad.addColorStop(1, 'rgba(4, 6, 10, 0)');
    ctx.fillStyle = mistGrad;
    ctx.fillRect(0, horizonY - 22, W, 58);

    // Layer 8b: Midground Swaying Oakhaven Pines (14 px/s)
    renderMovingTreeLayer(
      19,
      14.5,
      horizonY + H * 0.06,
      H * 0.13,
      H * 0.26,
      0.34,
      0.59,
      '#05080e',
      0.16,
      509
    );

    // Layer 8c: Passing Roadside Wooden Utility Poles Along Highway F45 (23 px/s)
    const poleSpan = W * 1.2;
    const poleCount = 5;
    for (let p = 0; p < poleCount; p++) {
      const rawPx = (p / poleCount) * poleSpan;
      const px =
        (((rawPx - elapsed * 23) % poleSpan) + poleSpan) % poleSpan - W * 0.1;
      const normPx = px / W;
      if (normPx > 0.64) continue;
      const persp = Math.max(0.35, 1 - Math.max(0, normPx) * 0.95);
      const pyBase = horizonY + H * 0.12 * persp;
      const poleH = H * 0.22 * persp;

      ctx.strokeStyle = '#070a10';
      ctx.lineWidth = Math.max(1.2, 2.4 * persp);
      ctx.beginPath();
      ctx.moveTo(px, pyBase);
      ctx.lineTo(px, pyBase - poleH);
      ctx.moveTo(px - 8 * persp, pyBase - poleH * 0.88);
      ctx.lineTo(px + 8 * persp, pyBase - poleH * 0.88);
      ctx.stroke();
    }

    // Layer 8d: Close Foreground Framing Pines Gliding Slowly Past (28 px/s)
    renderMovingTreeLayer(
      12,
      28,
      H + 8,
      H * 0.22,
      H * 0.4,
      0.22,
      0.5,
      '#030408',
      0.12,
      997
    );

    // 9. Subtle Floating Nocturnal Embers & Airborne Spores Drifting Across the Air
    for (let m = 0; m < 18; m++) {
      const mx =
        ((((m * 397) % 1000) / 1000) * W -
          elapsed * (8 + (m % 5) * 3.5) +
          W * 10) %
        W;
      const my =
        horizonY -
        H * 0.35 +
        (((m * 613) % 1000) / 1000) * (H * 0.55) +
        Math.sin(elapsed * 0.8 + m) * 10;
      const mAlpha = (0.18 + 0.22 * Math.sin(elapsed * 1.9 + m * 2.3)) * (mx > W * 0.35 ? 1 : 0.45);
      if (mAlpha <= 0.03) continue;
      ctx.fillStyle =
        m % 3 === 0
          ? `rgba(220, 48, 54, ${mAlpha.toFixed(3)})`
          : `rgba(226, 232, 240, ${(mAlpha * 0.6).toFixed(3)})`;
      ctx.fillRect(mx, my, 1.5, 1.5);
    }
  }
}
