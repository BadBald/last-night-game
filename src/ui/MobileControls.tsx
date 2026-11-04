import React, { useEffect, useRef, useState } from 'react';
import { Backpack, Crosshair, Hand, RotateCw, Smartphone } from 'lucide-react';
import { ITEMS } from '../data/items';
import { InputManager } from '../engine/input';
import { countItemInBackpack } from '../systems/inventory';
import { UISnapshot } from '../types';
import { ItemIconSVG } from './Icons';
import { useViewportLayout } from './useViewportLayout';

interface MobileControlsProps {
  input: InputManager;
  snap: UISnapshot;
  onToggleInventory: () => void;
  onTogglePhone: () => void;
  onQuickSlotClick: (slotIdx: number) => void;
  onInteract: () => void;
}

export const MobileControls: React.FC<MobileControlsProps> = ({
  input,
  snap,
  onToggleInventory,
  onTogglePhone,
  onQuickSlotClick,
  onInteract,
}) => {
  const { isCompactLandscape } = useViewportLayout();
  const mode = snap.settings.mobileControlsMode;
  const shouldRender =
    mode === 'on' ||
    (mode === 'auto' && snap.isTouchDevice && !snap.isGamepadActive);

  const [leftKnob, setLeftKnob] = useState({ x: 0, y: 0, active: false });
  const [rightKnob, setRightKnob] = useState({
    x: 0,
    y: 0,
    active: false,
    firing: false,
  });

  const leftTouchId = useRef<number | null>(null);
  const rightTouchId = useRef<number | null>(null);
  const leftOrigin = useRef({ x: 0, y: 0 });
  const rightOrigin = useRef({ x: 0, y: 0 });
  const rightWasFiring = useRef(false);

  const isVisible =
    shouldRender && snap.screen === 'PLAYING' && snap.panel === 'NONE';

  useEffect(() => {
    if (!isVisible) {
      leftTouchId.current = null;
      rightTouchId.current = null;
      rightWasFiring.current = false;
      input.mobileMoveX = 0;
      input.mobileMoveY = 0;
      input.mobileAimActive = false;
      input.mobileFireHeld = false;
      setLeftKnob({ x: 0, y: 0, active: false });
      setRightKnob({ x: 0, y: 0, active: false, firing: false });
    }
  }, [isVisible, input]);

  if (!isVisible) return null;

  const maxRad = isCompactLandscape ? 30 : 38;
  const equippedInst =
    snap.equippedSlot !== null ? snap.backpack[snap.equippedSlot] : null;
  const equippedDef = equippedInst ? ITEMS[equippedInst.itemId] : null;
  const reserveAmmo = equippedDef?.weaponStats?.ammoItemId
    ? countItemInBackpack(snap.backpack, equippedDef.weaponStats.ammoItemId)
    : 0;

  const hasPrompt = Boolean(snap.interactionPrompt);
  const promptShortLabel = snap.interactionPrompt
    ? snap.interactionPrompt.kind === 'door'
      ? 'Door'
      : snap.interactionPrompt.kind === 'container'
      ? 'Loot'
      : snap.interactionPrompt.kind === 'pickup'
      ? 'Take'
      : snap.interactionPrompt.kind === 'window'
      ? 'Smash'
      : 'Use'
    : 'Act';

  const updateLeftFromPoint = (clientX: number, clientY: number) => {
    const dx = clientX - leftOrigin.current.x;
    const dy = clientY - leftOrigin.current.y;
    const rawDist = Math.hypot(dx, dy);
    const dist = Math.min(maxRad, rawDist);
    const ang = rawDist > 0.5 ? Math.atan2(dy, dx) : 0;
    const kx = Math.cos(ang) * dist;
    const ky = Math.sin(ang) * dist;
    setLeftKnob({ x: kx, y: ky, active: true });
    input.mobileMoveX = kx / maxRad;
    input.mobileMoveY = ky / maxRad;
  };

  const releaseLeftStick = () => {
    leftTouchId.current = null;
    setLeftKnob({ x: 0, y: 0, active: false });
    input.mobileMoveX = 0;
    input.mobileMoveY = 0;
  };

  const updateRightFromPoint = (clientX: number, clientY: number) => {
    const dx = clientX - rightOrigin.current.x;
    const dy = clientY - rightOrigin.current.y;
    const rawDist = Math.hypot(dx, dy);
    const dist = Math.min(maxRad, rawDist);
    const ratio = dist / maxRad;

    if (rawDist > 5) {
      const ang = Math.atan2(dy, dx);
      const kx = Math.cos(ang) * dist;
      const ky = Math.sin(ang) * dist;
      const outerFire = ratio >= 0.8;
      if (outerFire && !rightWasFiring.current) {
        input.mobileFireJustPressed = true;
      }
      rightWasFiring.current = outerFire;
      input.mobileFireHeld = outerFire;
      input.mobileAimX = Math.cos(ang);
      input.mobileAimY = Math.sin(ang);
      input.mobileAimActive = true;
      setRightKnob({ x: kx, y: ky, active: true, firing: outerFire });
    } else {
      rightWasFiring.current = false;
      input.mobileFireHeld = false;
      setRightKnob({ x: 0, y: 0, active: true, firing: false });
    }
  };

  const releaseRightStick = () => {
    rightTouchId.current = null;
    rightWasFiring.current = false;
    input.mobileAimActive = false;
    input.mobileFireHeld = false;
    setRightKnob({ x: 0, y: 0, active: false, firing: false });
  };

  // =========================================================================
  // HORIZONTAL FULLSCREEN / COMPACT LANDSCAPE CONTROLS (<= 560px height)
  // =========================================================================
  if (isCompactLandscape) {
    return (
      <div className="fixed inset-x-0 bottom-0 z-15 pointer-events-none safe-area-landscape-controls flex items-end justify-between gap-2 select-none">
        {/* BOTTOM-LEFT CORNER: 84px Move Stick + Side-Tucked Sprint/Stealth */}
        <div className="pointer-events-auto flex items-end gap-1.5">
          <div
            onTouchStart={(e) => {
              e.preventDefault();
              if (leftTouchId.current !== null) return;
              const t = e.changedTouches[0];
              leftTouchId.current = t.identifier;
              const rect = e.currentTarget.getBoundingClientRect();
              const cx = rect.left + rect.width / 2;
              const cy = rect.top + rect.height / 2;
              leftOrigin.current = {
                x: cx + Math.max(-10, Math.min(10, t.clientX - cx)),
                y: cy + Math.max(-10, Math.min(10, t.clientY - cy)),
              };
              updateLeftFromPoint(t.clientX, t.clientY);
            }}
            onTouchMove={(e) => {
              e.preventDefault();
              for (let i = 0; i < e.changedTouches.length; i++) {
                const t = e.changedTouches[i];
                if (t.identifier === leftTouchId.current) {
                  updateLeftFromPoint(t.clientX, t.clientY);
                }
              }
            }}
            onTouchEnd={(e) => {
              e.preventDefault();
              for (let i = 0; i < e.changedTouches.length; i++) {
                if (e.changedTouches[i].identifier === leftTouchId.current) {
                  releaseLeftStick();
                }
              }
            }}
            onTouchCancel={(e) => {
              e.preventDefault();
              releaseLeftStick();
            }}
            className={`w-[84px] h-[84px] rounded-full border flex items-center justify-center relative touch-none transition-opacity ${
              leftKnob.active
                ? 'bg-[#110c09]/78 border-[#e6d6c3]/65 opacity-100'
                : 'bg-[#110c09]/48 border-[#e4d4c6]/24 opacity-80'
            }`}
          >
            <span className="text-[9px] font-mono-num text-[#9c8b79] uppercase pointer-events-none">
              MOVE
            </span>
            <div
              className="w-9 h-9 rounded-full bg-[#e6d6c3]/85 border border-[#f7f2e7] shadow pointer-events-none absolute"
              style={{
                transform: `translate(${leftKnob.x}px, ${leftKnob.y}px)`,
              }}
            />
          </div>

          <div className="flex flex-col gap-1">
            <button
              type="button"
              onPointerDown={(e) => {
                e.preventDefault();
                input.mobileSprintToggled = !input.mobileSprintToggled;
                if (input.mobileSprintToggled) input.mobileCrouchToggled = false;
              }}
              className={`min-h-[38px] min-w-[52px] px-2.5 rounded-lg border text-[11px] font-semibold active:scale-95 transition-all ${
                snap.isSprinting
                  ? 'bg-[#e26d27] text-[#120d0a] border-[#f07c34]'
                  : 'bg-[#110c09]/60 text-[#d8c7b4] border-[#e4d4c6]/18'
              }`}
            >
              Sprint
            </button>

            <button
              type="button"
              onPointerDown={(e) => {
                e.preventDefault();
                input.mobileCrouchToggled = !input.mobileCrouchToggled;
                if (input.mobileCrouchToggled) input.mobileSprintToggled = false;
              }}
              className={`min-h-[38px] min-w-[52px] px-2.5 rounded-lg border text-[11px] font-semibold active:scale-95 transition-all ${
                snap.isCrouching
                  ? 'bg-[#e6d6c3] text-[#120d0a] border-[#f7f2e7]'
                  : 'bg-[#110c09]/60 text-[#d8c7b4] border-[#e4d4c6]/18'
              }`}
            >
              Stealth
            </button>
          </div>
        </div>

        {/* BOTTOM-CENTER: Single-Row Micro Quick Belt */}
        <div className="pointer-events-auto flex items-center gap-1 px-1.5 py-0.5 rounded-xl bg-[#110c09]/62 backdrop-blur-[2px] border border-[#e4d4c6]/16">
          {equippedDef?.category === 'weapon_ranged' && (
            <span
              className={`px-1.5 text-[10px] font-mono-num whitespace-nowrap ${
                snap.isReloading ? 'text-[#e26d27]' : 'text-[#f39c59]'
              }`}
            >
              {snap.isReloading
                ? `RLD ${Math.round(snap.reloadProgress * 100)}%`
                : `${equippedInst?.loadedAmmo ?? 0}/${reserveAmmo}`}
            </span>
          )}

          {[0, 1, 2, 3].map((slotIdx) => {
            const it = snap.backpack[slotIdx];
            const def = it ? ITEMS[it.itemId] : null;
            const isEquipped = snap.equippedSlot === slotIdx;
            return (
              <button
                key={slotIdx}
                type="button"
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onQuickSlotClick(slotIdx);
                }}
                className="min-w-[40px] min-h-[42px] -my-1 flex items-center justify-center active:scale-95 transition-transform"
                aria-label={
                  def
                    ? `Quick slot ${slotIdx + 1}: ${def.name}`
                    : `Quick slot ${slotIdx + 1}`
                }
              >
                <span
                  className={`relative w-9 h-8 rounded-lg border flex items-center justify-center ${
                    isEquipped
                      ? 'bg-[#e26d27]/22 border-[#e26d27]'
                      : 'bg-[#19130f]/80 border-[#e4d4c6]/14'
                  }`}
                >
                  <span className="absolute top-0 left-1 text-[8px] font-mono-num text-[#9c8b79]">
                    {slotIdx + 1}
                  </span>
                  {def && <ItemIconSVG iconId={def.iconId} className="w-5 h-5" />}
                  {it && it.quantity > 1 && (
                    <span className="absolute bottom-0 right-1 text-[9px] font-mono-num font-semibold text-[#f7f2e7]">
                      {it.quantity}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>

        {/* BOTTOM-RIGHT CORNER: Side-Tucked Act/Reload/Fire + 84px Dual Aim/Fire Stick */}
        <div className="pointer-events-auto flex items-end gap-1.5">
          <div className="flex flex-col items-end gap-1">
            <div className="flex items-center gap-1">
              {equippedDef?.category === 'weapon_ranged' && (
                <button
                  type="button"
                  onPointerDown={(e) => {
                    e.preventDefault();
                    input.triggerVirtualKey('KeyR');
                  }}
                  className={`min-w-[38px] min-h-[38px] rounded-lg border flex items-center justify-center active:scale-95 transition-all ${
                    snap.isReloading
                      ? 'bg-[#e26d27]/25 border-[#e26d27] text-[#f39c59]'
                      : 'bg-[#110c09]/60 border-[#e4d4c6]/18 text-[#d8c7b4]'
                  }`}
                  aria-label="Reload Weapon"
                >
                  <RotateCw
                    className={`w-3.5 h-3.5 ${snap.isReloading ? 'animate-spin' : ''}`}
                  />
                </button>
              )}

              <button
                type="button"
                onPointerDown={(e) => {
                  e.preventDefault();
                  onInteract();
                }}
                className={`min-w-[52px] min-h-[38px] px-2 rounded-lg border text-[11px] font-semibold flex items-center justify-center gap-1 active:scale-95 transition-all ${
                  hasPrompt
                    ? 'bg-[#e26d27] text-[#120d0a] border-[#f07c34]'
                    : 'bg-[#110c09]/60 text-[#d8c7b4] border-[#e4d4c6]/18'
                }`}
                aria-label="Contextual Interact"
              >
                <Hand className="w-3.5 h-3.5 shrink-0" />
                <span>{promptShortLabel}</span>
              </button>
            </div>

            <button
              type="button"
              onTouchStart={(e) => {
                e.preventDefault();
                input.mobileFireHeld = true;
                input.mobileFireJustPressed = true;
              }}
              onTouchEnd={(e) => {
                e.preventDefault();
                input.mobileFireHeld = false;
              }}
              onTouchCancel={(e) => {
                e.preventDefault();
                input.mobileFireHeld = false;
              }}
              onMouseDown={() => {
                input.mobileFireHeld = true;
                input.mobileFireJustPressed = true;
              }}
              onMouseUp={() => {
                input.mobileFireHeld = false;
              }}
              className="w-full min-w-[58px] min-h-[40px] px-2.5 rounded-xl bg-[#c94a38]/90 active:bg-[#e0523c] border border-[#e67a68]/75 text-[#f7f2e7] text-[11px] font-bold flex items-center justify-center gap-1 active:scale-95 transition-all"
              aria-label="Attack or Fire Weapon"
            >
              <Crosshair className="w-3.5 h-3.5 shrink-0" />
              <span>
                {equippedDef?.category === 'weapon_ranged' ? 'FIRE' : 'HIT'}
              </span>
            </button>
          </div>

          <div
            onTouchStart={(e) => {
              e.preventDefault();
              if (rightTouchId.current !== null) return;
              const t = e.changedTouches[0];
              rightTouchId.current = t.identifier;
              const rect = e.currentTarget.getBoundingClientRect();
              const cx = rect.left + rect.width / 2;
              const cy = rect.top + rect.height / 2;
              rightOrigin.current = {
                x: cx + Math.max(-10, Math.min(10, t.clientX - cx)),
                y: cy + Math.max(-10, Math.min(10, t.clientY - cy)),
              };
              updateRightFromPoint(t.clientX, t.clientY);
            }}
            onTouchMove={(e) => {
              e.preventDefault();
              for (let i = 0; i < e.changedTouches.length; i++) {
                const t = e.changedTouches[i];
                if (t.identifier === rightTouchId.current) {
                  updateRightFromPoint(t.clientX, t.clientY);
                }
              }
            }}
            onTouchEnd={(e) => {
              e.preventDefault();
              for (let i = 0; i < e.changedTouches.length; i++) {
                if (e.changedTouches[i].identifier === rightTouchId.current) {
                  releaseRightStick();
                }
              }
            }}
            onTouchCancel={(e) => {
              e.preventDefault();
              releaseRightStick();
            }}
            className={`w-[84px] h-[84px] rounded-full border flex items-center justify-center relative touch-none transition-all ${
              rightKnob.firing
                ? 'border-[#e0523c] bg-[#2a120e]/65 opacity-100'
                : rightKnob.active
                ? 'border-[#e26d27] bg-[#110c09]/78 opacity-100'
                : 'border-[#e26d27]/42 bg-[#110c09]/48 opacity-80'
            }`}
          >
            <div className="w-14 h-14 rounded-full border border-dashed border-[#e26d27]/30 pointer-events-none flex items-center justify-center">
              <span className="text-[8px] font-mono-num text-[#f39c59]/80 uppercase pointer-events-none">
                {rightKnob.firing ? 'FIRE' : 'AIM'}
              </span>
            </div>
            <div
              className={`w-9 h-9 rounded-full border shadow pointer-events-none absolute ${
                rightKnob.firing
                  ? 'bg-[#c94a38] border-[#f7d6cf]'
                  : 'bg-[#e26d27]/90 border-[#f7f2e7]'
              }`}
              style={{
                transform: `translate(${rightKnob.x}px, ${rightKnob.y}px)`,
              }}
            />
          </div>
        </div>
      </div>
    );
  }

  // =========================================================================
  // PORTRAIT MOBILE / TABLET CONTROLS
  // =========================================================================
  const quickBeltStrip = (
    <div className="pointer-events-auto flex flex-col items-center gap-1">
      <div className="px-2.5 py-0.5 rounded bg-[#110c09]/92 border border-[#e4d4c6]/16 text-[10px] font-mono-num text-[#f7f2e7] flex items-center gap-1.5 whitespace-nowrap">
        <span className="truncate max-w-[110px]">
          {equippedDef ? equippedDef.name : 'Unarmed'}
        </span>
        {equippedDef?.category === 'weapon_ranged' && (
          <>
            <span className="text-[#6e5f51]">·</span>
            <span className={snap.isReloading ? 'text-[#e26d27]' : 'text-[#f39c59]'}>
              {snap.isReloading
                ? `RLD ${Math.round(snap.reloadProgress * 100)}%`
                : `${equippedInst?.loadedAmmo ?? 0}/${reserveAmmo}`}
            </span>
          </>
        )}
        {equippedDef?.category === 'weapon_melee' && (
          <>
            <span className="text-[#6e5f51]">·</span>
            <span className="text-[#9c8b79]">
              {equippedInst?.durability ?? 0}/{equippedDef.maxDurability}
            </span>
          </>
        )}
      </div>

      <div className="flex items-center gap-1 bg-[#110c09]/92 border border-[#e4d4c6]/16 rounded-xl p-1">
        {[0, 1, 2, 3].map((slotIdx) => {
          const it = snap.backpack[slotIdx];
          const def = it ? ITEMS[it.itemId] : null;
          const isEquipped = snap.equippedSlot === slotIdx;
          return (
            <button
              key={slotIdx}
              type="button"
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onQuickSlotClick(slotIdx);
              }}
              className={`relative min-w-[44px] min-h-[44px] rounded-lg border flex items-center justify-center active:scale-95 transition-transform ${
                isEquipped
                  ? 'bg-[#e26d27]/20 border-[#e26d27]'
                  : 'bg-[#19130f]/95 border-[#e4d4c6]/14'
              }`}
              aria-label={
                def
                  ? `Quick slot ${slotIdx + 1}: ${def.name}`
                  : `Quick slot ${slotIdx + 1}`
              }
            >
              <span className="absolute top-0.5 left-1 text-[9px] font-mono-num text-[#9c8b79]">
                {slotIdx + 1}
              </span>
              {def && <ItemIconSVG iconId={def.iconId} className="w-6 h-6" />}
              {it && it.quantity > 1 && (
                <span className="absolute bottom-0.5 right-1 text-[10px] font-mono-num font-semibold text-[#f7f2e7]">
                  {it.quantity}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className="fixed inset-x-0 bottom-0 z-15 pointer-events-none safe-area-controls pt-1 flex flex-col gap-1.5 select-none">
      <div className="flex sm:hidden justify-center">{quickBeltStrip}</div>

      <div className="flex items-end justify-between gap-2 px-1 sm:px-3">
        {/* LEFT THUMB CLUSTER */}
        <div className="flex flex-col items-start gap-2 pointer-events-auto">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onPointerDown={(e) => {
                e.preventDefault();
                input.mobileSprintToggled = !input.mobileSprintToggled;
                if (input.mobileSprintToggled) input.mobileCrouchToggled = false;
              }}
              className={`min-h-[44px] min-w-[60px] px-3 rounded-xl border text-xs font-semibold active:scale-95 transition-transform ${
                snap.isSprinting
                  ? 'bg-[#e26d27] text-[#120d0a] border-[#f07c34]'
                  : 'bg-[#110c09]/92 text-[#d8c7b4] border-[#e4d4c6]/18'
              }`}
            >
              Sprint
            </button>

            <button
              type="button"
              onPointerDown={(e) => {
                e.preventDefault();
                input.mobileCrouchToggled = !input.mobileCrouchToggled;
                if (input.mobileCrouchToggled) input.mobileSprintToggled = false;
              }}
              className={`min-h-[44px] min-w-[60px] px-3 rounded-xl border text-xs font-semibold active:scale-95 transition-transform ${
                snap.isCrouching
                  ? 'bg-[#e6d6c3] text-[#120d0a] border-[#f7f2e7]'
                  : 'bg-[#110c09]/92 text-[#d8c7b4] border-[#e4d4c6]/18'
              }`}
            >
              Stealth
            </button>
          </div>

          <div
            onTouchStart={(e) => {
              e.preventDefault();
              if (leftTouchId.current !== null) return;
              const t = e.changedTouches[0];
              leftTouchId.current = t.identifier;
              const rect = e.currentTarget.getBoundingClientRect();
              const cx = rect.left + rect.width / 2;
              const cy = rect.top + rect.height / 2;
              leftOrigin.current = {
                x: cx + Math.max(-14, Math.min(14, t.clientX - cx)),
                y: cy + Math.max(-14, Math.min(14, t.clientY - cy)),
              };
              updateLeftFromPoint(t.clientX, t.clientY);
            }}
            onTouchMove={(e) => {
              e.preventDefault();
              for (let i = 0; i < e.changedTouches.length; i++) {
                const t = e.changedTouches[i];
                if (t.identifier === leftTouchId.current) {
                  updateLeftFromPoint(t.clientX, t.clientY);
                }
              }
            }}
            onTouchEnd={(e) => {
              e.preventDefault();
              for (let i = 0; i < e.changedTouches.length; i++) {
                if (e.changedTouches[i].identifier === leftTouchId.current) {
                  releaseLeftStick();
                }
              }
            }}
            onTouchCancel={(e) => {
              e.preventDefault();
              releaseLeftStick();
            }}
            className={`w-24 h-24 sm:w-28 sm:h-28 rounded-full bg-[#110c09]/84 border-2 flex items-center justify-center relative touch-none ${
              leftKnob.active ? 'border-[#e6d6c3]/75' : 'border-[#e4d4c6]/22'
            }`}
          >
            <span className="text-[10px] font-mono-num text-[#9c8b79] uppercase pointer-events-none">
              MOVE
            </span>
            <div
              className="w-11 h-11 rounded-full bg-[#e6d6c3]/88 border border-[#f7f2e7] shadow-md pointer-events-none absolute"
              style={{
                transform: `translate(${leftKnob.x}px, ${leftKnob.y}px)`,
              }}
            />
          </div>
        </div>

        <div className="hidden sm:flex items-end pb-0.5">{quickBeltStrip}</div>

        {/* RIGHT THUMB CLUSTER */}
        <div className="flex flex-col items-end gap-2 pointer-events-auto">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onPointerDown={(e) => {
                e.preventDefault();
                onTogglePhone();
              }}
              className={`relative min-w-[48px] min-h-[44px] px-2.5 rounded-xl border flex items-center justify-center gap-1 text-xs font-semibold active:scale-95 transition-transform ${
                snap.flashlightBattery <= 18
                  ? 'bg-[#2a120e]/85 text-[#f3a093] border-[#c94a38]/70'
                  : snap.flashlightOn
                  ? 'bg-[#110c09]/92 text-[#f39c59] border-[#e26d27]/70'
                  : 'bg-[#110c09]/92 text-[#d8c7b4] border-[#e4d4c6]/18'
              }`}
              aria-label="Open Phone"
            >
              <Smartphone className="w-4 h-4 shrink-0" />
              <span className="hidden xs:inline">Phone</span>
              {snap.unreadRadioCount > 0 && (
                <span className="font-mono-num text-[#e26d27]">
                  ({snap.unreadRadioCount})
                </span>
              )}
            </button>

            <button
              type="button"
              onPointerDown={(e) => {
                e.preventDefault();
                input.triggerVirtualKey('KeyR');
              }}
              className={`min-w-[44px] min-h-[44px] px-2.5 rounded-xl border flex items-center justify-center active:scale-95 transition-transform ${
                snap.isReloading
                  ? 'bg-[#e26d27]/20 border-[#e26d27] text-[#f39c59]'
                  : 'bg-[#110c09]/92 border-[#e4d4c6]/18 text-[#d8c7b4]'
              }`}
              aria-label="Reload Weapon"
            >
              <RotateCw
                className={`w-4 h-4 ${snap.isReloading ? 'animate-spin' : ''}`}
              />
            </button>

            <button
              type="button"
              onPointerDown={(e) => {
                e.preventDefault();
                onToggleInventory();
              }}
              className="min-w-[48px] min-h-[44px] px-2.5 rounded-xl bg-[#110c09]/92 border border-[#e4d4c6]/18 text-[#d8c7b4] flex items-center justify-center gap-1 text-xs font-semibold active:scale-95 transition-transform"
              aria-label="Open Backpack"
            >
              <Backpack className="w-4 h-4 shrink-0 text-[#e26d27]" />
              <span className="hidden xs:inline">Pack</span>
            </button>
          </div>

          <div className="flex items-end gap-2">
            <div className="flex flex-col gap-1.5">
              <button
                type="button"
                onPointerDown={(e) => {
                  e.preventDefault();
                  onInteract();
                }}
                className={`min-w-[58px] min-h-[46px] px-2.5 rounded-xl border text-xs font-semibold flex items-center justify-center gap-1 active:scale-95 transition-all ${
                  hasPrompt
                    ? 'bg-[#e26d27] text-[#120d0a] border-[#f07c34] shadow-lg'
                    : 'bg-[#110c09]/92 text-[#d8c7b4] border-[#e4d4c6]/18'
                }`}
                aria-label="Contextual Interact"
              >
                <Hand className="w-4 h-4 shrink-0" />
                <span>{promptShortLabel}</span>
              </button>

              <button
                type="button"
                onTouchStart={(e) => {
                  e.preventDefault();
                  input.mobileFireHeld = true;
                  input.mobileFireJustPressed = true;
                }}
                onTouchEnd={(e) => {
                  e.preventDefault();
                  input.mobileFireHeld = false;
                }}
                onTouchCancel={(e) => {
                  e.preventDefault();
                  input.mobileFireHeld = false;
                }}
                onMouseDown={() => {
                  input.mobileFireHeld = true;
                  input.mobileFireJustPressed = true;
                }}
                onMouseUp={() => {
                  input.mobileFireHeld = false;
                }}
                className="min-w-[58px] min-h-[54px] px-2.5 rounded-2xl bg-[#c94a38] active:bg-[#e0523c] border-2 border-[#e67a68]/80 text-[#f7f2e7] text-xs font-bold flex flex-col items-center justify-center leading-none gap-0.5 shadow-lg active:scale-95 transition-transform"
                aria-label="Attack or Fire Weapon"
              >
                <Crosshair className="w-4 h-4" />
                <span className="text-[10px] tracking-wide">
                  {equippedDef?.category === 'weapon_ranged' ? 'FIRE' : 'HIT'}
                </span>
              </button>
            </div>

            <div
              onTouchStart={(e) => {
                e.preventDefault();
                if (rightTouchId.current !== null) return;
                const t = e.changedTouches[0];
                rightTouchId.current = t.identifier;
                const rect = e.currentTarget.getBoundingClientRect();
                const cx = rect.left + rect.width / 2;
                const cy = rect.top + rect.height / 2;
                rightOrigin.current = {
                  x: cx + Math.max(-12, Math.min(12, t.clientX - cx)),
                  y: cy + Math.max(-12, Math.min(12, t.clientY - cy)),
                };
                updateRightFromPoint(t.clientX, t.clientY);
              }}
              onTouchMove={(e) => {
                e.preventDefault();
                for (let i = 0; i < e.changedTouches.length; i++) {
                  const t = e.changedTouches[i];
                  if (t.identifier === rightTouchId.current) {
                    updateRightFromPoint(t.clientX, t.clientY);
                  }
                }
              }}
              onTouchEnd={(e) => {
                e.preventDefault();
                for (let i = 0; i < e.changedTouches.length; i++) {
                  if (e.changedTouches[i].identifier === rightTouchId.current) {
                    releaseRightStick();
                  }
                }
              }}
              onTouchCancel={(e) => {
                e.preventDefault();
                releaseRightStick();
              }}
              className={`w-24 h-24 sm:w-28 sm:h-28 rounded-full bg-[#110c09]/84 border-2 flex items-center justify-center relative touch-none transition-colors ${
                rightKnob.firing
                  ? 'border-[#e0523c] bg-[#2a120e]/45'
                  : rightKnob.active
                  ? 'border-[#e26d27]'
                  : 'border-[#e26d27]/45'
              }`}
            >
              <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full border border-dashed border-[#e26d27]/28 pointer-events-none flex items-center justify-center">
                <span className="text-[9px] font-mono-num text-[#f39c59]/80 uppercase pointer-events-none text-center leading-tight">
                  {rightKnob.firing ? 'FIRE' : 'AIM'}
                </span>
              </div>
              <div
                className={`w-11 h-11 rounded-full border shadow-md pointer-events-none absolute ${
                  rightKnob.firing
                    ? 'bg-[#c94a38] border-[#f7d6cf]'
                    : 'bg-[#e26d27]/90 border-[#f7f2e7]'
                }`}
                style={{
                  transform: `translate(${rightKnob.x}px, ${rightKnob.y}px)`,
                }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
