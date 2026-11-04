import { CONFIG } from '../config';

export class Camera {
  public x = 0;
  public y = 0;
  public viewportW = 1280;
  public viewportH = 720;
  public zoom = 1;
  private shakeIntensity = 0;
  public offsetX = 0;
  public offsetY = 0;
  private titlePanTime = 0;

  public setViewport(worldW: number, worldH: number, zoom = 1) {
    this.zoom = Math.max(0.5, Math.min(2, zoom));
    this.viewportW = Math.max(320, worldW);
    this.viewportH = Math.max(240, worldH);
  }

  public snapTo(worldX: number, worldY: number) {
    this.x = worldX;
    this.y = worldY;
    this.clampToWorld();
  }

  public addShake(amount: number, enabled: boolean) {
    if (!enabled) return;
    this.shakeIntensity = Math.min(18, this.shakeIntensity + amount);
  }

  public updateFollow(
    dt: number,
    targetX: number,
    targetY: number,
    aimAngle: number,
    lookAheadStrength = 34
  ) {
    const desiredX = targetX + Math.cos(aimAngle) * lookAheadStrength;
    const desiredY = targetY + Math.sin(aimAngle) * lookAheadStrength;
    const lerpFactor = 1 - Math.exp(-7.5 * dt);
    this.x += (desiredX - this.x) * lerpFactor;
    this.y += (desiredY - this.y) * lerpFactor;
    this.clampToWorld();
    this.updateShake(dt);
  }

  public updateTitlePan(dt: number) {
    this.titlePanTime += dt * 0.11;
    const worldW = CONFIG.MAP_WIDTH * CONFIG.TILE_SIZE;
    const worldH = CONFIG.MAP_HEIGHT * CONFIG.TILE_SIZE;
    // Smooth atmospheric pan sweeping from Highway F45 crash carnage into Quarantine City
    this.x = worldW * 0.44 + Math.sin(this.titlePanTime) * (worldW * 0.22);
    this.y = worldH * 0.56 + Math.sin(this.titlePanTime * 1.6) * (worldH * 0.12);
    this.clampToWorld();
    this.offsetX = 0;
    this.offsetY = 0;
  }

  private updateShake(dt: number) {
    if (this.shakeIntensity > 0.1) {
      this.offsetX = (Math.random() * 2 - 1) * this.shakeIntensity;
      this.offsetY = (Math.random() * 2 - 1) * this.shakeIntensity;
      this.shakeIntensity *= Math.exp(-11 * dt);
    } else {
      this.shakeIntensity = 0;
      this.offsetX = 0;
      this.offsetY = 0;
    }
  }

  private clampToWorld() {
    const worldW = CONFIG.MAP_WIDTH * CONFIG.TILE_SIZE;
    const worldH = CONFIG.MAP_HEIGHT * CONFIG.TILE_SIZE;
    const halfW = Math.min(this.viewportW * 0.5, worldW * 0.5);
    const halfH = Math.min(this.viewportH * 0.5, worldH * 0.5);
    this.x = Math.max(halfW, Math.min(worldW - halfW, this.x));
    this.y = Math.max(halfH, Math.min(worldH - halfH, this.y));
  }

  public screenToWorld(sx: number, sy: number): { x: number; y: number } {
    return {
      x: sx / this.zoom - this.viewportW * 0.5 + this.x,
      y: sy / this.zoom - this.viewportH * 0.5 + this.y,
    };
  }

  public get renderLeft(): number {
    return this.x - this.viewportW * 0.5 + this.offsetX;
  }

  public get renderTop(): number {
    return this.y - this.viewportH * 0.5 + this.offsetY;
  }
}
