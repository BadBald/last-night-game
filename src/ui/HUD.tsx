import React from 'react';
import {
  Backpack,
  Gamepad2,
  Maximize2,
  Minimize2,
  Pause,
  Smartphone,
  MessageCircle,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { CONFIG } from '../config';
import { ITEMS } from '../data/items';
import { getGamepadGlyphs } from '../engine/input';
import { countItemInBackpack } from '../systems/inventory';
import { ActiveRadioBroadcastState, UISnapshot } from '../types';
import { ItemIconSVG } from './Icons';
import { useViewportLayout } from './useViewportLayout';

interface HUDProps {
  snap: UISnapshot;
  isFullscreen: boolean;
  fullscreenHint: string | null;
  onToggleFullscreen: () => void;
  onToggleInventory: () => void;
  onTogglePhone: () => void;
  onToggleChat: () => void;
  onToggleMute: () => void;
  onTogglePause: () => void;
  onQuickSlotClick: (slotIdx: number) => void;
  onInteract: () => void;
}

const DPAD_SLOT_LABELS = ['↑', '→', '↓', '←'] as const;

export const HUD: React.FC<HUDProps> = ({
  snap,
  isFullscreen,
  fullscreenHint,
  onToggleFullscreen,
  onToggleInventory,
  onTogglePhone,
  onToggleChat,
  onToggleMute,
  onTogglePause,
  onQuickSlotClick,
  onInteract,
}) => {
  const { width, isCompactLandscape } = useViewportLayout();
  const gp = getGamepadGlyphs(snap.gamepadBrand);
  const padActive = snap.isGamepadActive;

  const equippedInst =
    snap.equippedSlot !== null ? snap.backpack[snap.equippedSlot] : null;
  const equippedDef = equippedInst ? ITEMS[equippedInst.itemId] : null;
  const reserveAmmo = equippedDef?.weaponStats?.ammoItemId
    ? countItemInBackpack(snap.backpack, equippedDef.weaponStats.ammoItemId)
    : 0;

  const touchModeActive =
    snap.settings.mobileControlsMode === 'on' ||
    (snap.settings.mobileControlsMode === 'auto' &&
      snap.isTouchDevice &&
      !padActive);

  const isPortraitOrCompactTouch =
    !isCompactLandscape && (touchModeActive || width < 768);
  const isDesktopLayout = !isCompactLandscape && !isPortraitOrCompactTouch;
  const isEncumbered = snap.totalWeight > CONFIG.ENCUMBERED_THRESHOLD_KG;
  const isPhoneBatteryLow = snap.flashlightBattery <= 18;

  const activeConditions: string[] = [];
  if (snap.conditions.bleeding) activeConditions.push('BLEEDING');
  if (snap.conditions.infected) activeConditions.push('INFECTED');
  if (snap.conditions.sporeExposure) activeConditions.push('SPORES');
  if (snap.conditions.exhausted) activeConditions.push('EXHAUSTED');
  if (snap.armorEquipped) activeConditions.push('VEST');

  const compactConditionBadge = snap.conditions.bleeding
    ? { text: 'BLEED', cls: 'text-[#e0523c] font-semibold' }
    : snap.conditions.infected || snap.conditions.sporeExposure
    ? { text: 'SPORES', cls: 'text-[#c7a955] font-semibold' }
    : snap.conditions.exhausted
    ? { text: 'TIRED', cls: 'text-[#f39c59]' }
    : snap.armorEquipped
    ? { text: 'VEST', cls: 'text-[#e6d6c3]' }
    : null;

  const healthStateWord = snap.conditions.bleeding
    ? 'BLEEDING'
    : snap.contamination >= 90
    ? 'TOXIC'
    : snap.hunger <= 0
    ? 'STARVING'
    : snap.health <= 30
    ? 'CRITICAL'
    : undefined;

  const healthBarCls = snap.health <= 30 ? 'bg-[#e03c28]' : 'bg-[#c94a38]';
  const hungerBarCls = snap.hunger <= 20 ? 'bg-[#b85318]' : 'bg-[#e26d27]';
  const staminaBarCls = 'bg-[#e6d6c3]';
  const contamBarCls =
    snap.contamination >= 90
      ? 'bg-[#d95338]'
      : snap.objective.injectionTaken
      ? 'bg-[#8fa86b]'
      : 'bg-[#c7a955]';

  const activeRadio = snap.activeRadioBroadcast;

  const formatPromptLabel = (rawLabel: string): string => {
    if (touchModeActive) {
      return rawLabel.replace('[E] ', 'Tap: ');
    }
    if (padActive) {
      return rawLabel.replace('[E]', `[${gp.south}]`);
    }
    return rawLabel;
  };

  return (
    <div
      className={`fixed inset-0 pointer-events-none z-10 flex flex-col justify-between ${
        isCompactLandscape
          ? 'safe-area-landscape-hud'
          : isDesktopLayout
          ? 'safe-area-hud sm:p-4'
          : 'safe-area-hud'
      }`}
    >
      {/* =====================================================================
          1. COMPACT LANDSCAPE TOP BAR (<= 560px H)
             Clean perimeter: Vitals left, unobstructed center, Phone/Pack/System right
         ===================================================================== */}
      {isCompactLandscape && (
        <div className="flex items-center justify-between gap-2 min-w-0">
          <div className="pointer-events-auto h-8 px-2.5 rounded-lg bg-[#110c09]/76 backdrop-blur-sm border border-[#e4d4c6]/16 flex items-center gap-2.5 shrink-0">
            <LandscapeStatChip
              code="HP"
              value={snap.health}
              barColor={healthBarCls}
              alert={Boolean(healthStateWord)}
            />
            <LandscapeStatChip
              code="HNG"
              value={snap.hunger}
              barColor={hungerBarCls}
              alert={snap.hunger <= 15}
            />
            <LandscapeStatChip
              code="STM"
              value={snap.stamina}
              barColor={staminaBarCls}
            />
            <LandscapeStatChip
              code="CTM"
              value={snap.contamination}
              barColor={contamBarCls}
              alert={snap.contamination >= 90}
            />
            {compactConditionBadge && (
              <span
                className={`pl-1.5 border-l border-[#e4d4c6]/16 text-[9px] font-mono-num leading-none ${compactConditionBadge.cls}`}
              >
                {compactConditionBadge.text}
              </span>
            )}
            {snap.online.isOnlineMode && (
              <span
                className={`pl-1.5 border-l border-[#e4d4c6]/16 text-[9px] font-mono-num leading-none whitespace-nowrap ${
                  snap.extraction.contested
                    ? 'text-[#e0523c] font-semibold'
                    : 'text-[#f39c59]'
                }`}
              >
                {snap.extraction.contested
                  ? 'LZ CONTESTED'
                  : `ALIVE ${snap.online.aliveCount}/${snap.online.totalParticipants} · 1 SEAT`}
              </span>
            )}
          </div>

          <div className="pointer-events-auto flex items-center shrink-0 -mr-1">
            <LandscapeIconBtn
              onClick={onTogglePhone}
              label="Open Phone (Time, Flashlight, Maps & Radio)"
              active={snap.panel === 'PHONE' || snap.flashlightOn}
              danger={isPhoneBatteryLow}
              badgeCount={snap.unreadRadioCount}
            >
              <Smartphone className="w-3.5 h-3.5" />
            </LandscapeIconBtn>

             {snap.online.isOnlineMode && (
               <div
                 className={`min-h-[40px] px-2 flex items-center gap-1 rounded-xl border text-xs font-semibold ${
                   snap.online.selfTalking
                     ? 'bg-[#c9363b]/20 text-[#f3a093] border-[#c9363b]/60'
                     : 'bg-[#19130f] text-[#9c8b79] border-[#e4d4c6]/16'
                 }`}
                 title="Push-to-talk (hold T)"
               >
                 {snap.online.selfTalking ? <Mic className="w-3.5 h-3.5" /> : <MicOff className="w-3.5 h-3.5" />}
                 <span className="hidden sm:inline">{snap.online.selfTalking ? 'Talking' : 'T: Talk'}</span>
               </div>
             )}

            <LandscapeIconBtn
              onClick={onToggleInventory}
              label="Open Survivor Backpack"
              active={snap.panel === 'INVENTORY' || snap.panel === 'LOOT' || isEncumbered}
            >
              <Backpack className="w-3.5 h-3.5" />
            </LandscapeIconBtn>

            <LandscapeIconBtn
              onClick={onToggleFullscreen}
              label={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
              active={isFullscreen}
            >
              {isFullscreen ? (
                <Minimize2 className="w-3.5 h-3.5" />
              ) : (
                <Maximize2 className="w-3.5 h-3.5" />
              )}
            </LandscapeIconBtn>

            <LandscapeIconBtn onClick={onTogglePause} label="Pause Game">
              <Pause className="w-3.5 h-3.5" />
            </LandscapeIconBtn>
          </div>
        </div>
      )}

      {isCompactLandscape && activeRadio && snap.panel !== 'PHONE' && (
        <div className="mt-1 flex justify-center px-2">
          <BreakingNewsTopBanner radio={activeRadio} compact />
        </div>
      )}

      {/* =====================================================================
          2. PORTRAIT MOBILE TOP PERIMETER
             Clean minimal HUD: Vitals top-left, Fullscreen + Pause top-right
         ===================================================================== */}
      {isPortraitOrCompactTouch && (
        <div className="flex items-start justify-between gap-2">
          <div className="pointer-events-auto bg-[#110c09]/90 border border-[#e4d4c6]/16 rounded-xl px-2.5 py-2 min-w-[160px] max-w-[196px]">
            <div className="grid grid-cols-2 gap-x-2.5 gap-y-1.5">
              <MiniStat
                code="HP"
                value={snap.health}
                barColor={healthBarCls}
                alert={Boolean(healthStateWord)}
              />
              <MiniStat
                code="HNG"
                value={snap.hunger}
                barColor={hungerBarCls}
                alert={snap.hunger <= 15}
              />
              <MiniStat
                code="STM"
                value={snap.stamina}
                barColor={staminaBarCls}
              />
              <MiniStat
                code="CTM"
                value={snap.contamination}
                barColor={contamBarCls}
                alert={snap.contamination >= 90}
              />
            </div>

            {activeConditions.length > 0 && (
              <div className="mt-1.5 pt-1 border-t border-[#e4d4c6]/14 text-[10px] font-mono-num leading-none truncate">
                {activeConditions.map((c, idx) => (
                  <React.Fragment key={c}>
                    {idx > 0 && <span className="mx-1 text-[#6e5f51]">·</span>}
                    <span
                      className={
                        c === 'BLEEDING'
                          ? 'text-[#e0523c] font-semibold'
                          : c === 'INFECTED' || c === 'SPORES'
                          ? 'text-[#c7a955] font-semibold'
                          : c === 'VEST'
                          ? 'text-[#e6d6c3]'
                          : 'text-[#f39c59]'
                      }
                    >
                      {c}
                    </span>
                  </React.Fragment>
                ))}
              </div>
            )}

            {snap.online.isOnlineMode && (
              <div
                className={`mt-1.5 pt-1 border-t border-[#e4d4c6]/14 text-[10px] font-mono-num leading-none truncate ${
                  snap.extraction.contested
                    ? 'text-[#e0523c] font-semibold'
                    : 'text-[#f39c59]'
                }`}
              >
                {snap.extraction.contested
                  ? 'LZ CONTESTED · 1 SEAT!'
                  : `ALIVE ${snap.online.aliveCount}/${snap.online.totalParticipants} · 1 SEAT`}
              </div>
            )}
          </div>

          <div className="flex items-center gap-1.5 pointer-events-auto">
            {!touchModeActive && (
              <button
                type="button"
                onClick={onTogglePhone}
                className={`relative min-w-[44px] min-h-[44px] rounded-xl border flex items-center justify-center cursor-pointer transition-colors ${
                  isPhoneBatteryLow
                    ? 'bg-[#2a120e]/85 border-[#c94a38]/70 text-[#f3a093]'
                    : snap.flashlightOn
                    ? 'bg-[#110c09]/92 border-[#e26d27]/65 text-[#f39c59]'
                    : 'bg-[#110c09]/92 active:bg-[#1f1712] border-[#e4d4c6]/16 text-[#d8c7b4]'
                }`}
                aria-label="Open Phone"
              >
                <Smartphone className="w-4 h-4" />
                {snap.unreadRadioCount > 0 && (
                  <span className="absolute -top-1 -right-1 px-1 rounded bg-[#e26d27] text-[#120d0a] text-[9px] font-mono-num font-bold leading-tight">
                    {snap.unreadRadioCount}
                  </span>
                )}
              </button>
            )}

            <button
              type="button"
              onClick={onToggleFullscreen}
              className={`min-w-[44px] min-h-[44px] rounded-xl border flex items-center justify-center cursor-pointer transition-colors ${
                isFullscreen
                  ? 'bg-[#e26d27]/20 border-[#e26d27]/70 text-[#f39c59]'
                  : 'bg-[#110c09]/92 active:bg-[#1f1712] border-[#e4d4c6]/16 text-[#d8c7b4]'
              }`}
              aria-label={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
              title={isFullscreen ? 'Exit Fullscreen' : 'Full Screen'}
            >
              {isFullscreen ? (
                <Minimize2 className="w-4 h-4" />
              ) : (
                <Maximize2 className="w-4 h-4" />
              )}
            </button>

            <button
              type="button"
              onClick={onTogglePause}
              className="min-w-[44px] min-h-[44px] rounded-xl bg-[#110c09]/92 active:bg-[#1f1712] border border-[#e4d4c6]/16 flex items-center justify-center text-[#d8c7b4] cursor-pointer transition-colors"
              aria-label="Pause Game"
            >
              <Pause className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {isPortraitOrCompactTouch && activeRadio && snap.panel !== 'PHONE' && (
        <div className="mt-2 flex justify-center">
          <BreakingNewsTopBanner radio={activeRadio} compact />
        </div>
      )}

      {/* =====================================================================
          3. DESKTOP TOP PERIMETER ROW (Non-touch >= 768px)
             Clean perimeter: Vitals top-left, empty top-center, System controls top-right
         ===================================================================== */}
      {isDesktopLayout && (
        <div className="flex items-start justify-between gap-4">
          <div className="bg-[#110c09]/90 border border-[#e4d4c6]/16 rounded-xl p-3 w-56 pointer-events-auto">
            <div className="space-y-2">
              <StatBar
                label="Health"
                value={snap.health}
                max={snap.maxHealth}
                barColor={healthBarCls}
                stateWord={healthStateWord}
              />
              <StatBar
                label="Hunger"
                value={snap.hunger}
                max={100}
                barColor={hungerBarCls}
                stateWord={snap.hunger <= 15 ? 'STARVING' : undefined}
              />
              <StatBar
                label="Stamina"
                value={snap.stamina}
                max={100}
                barColor={staminaBarCls}
                stateWord={
                  snap.isCrouching
                    ? 'STEALTH'
                    : snap.isSprinting
                    ? 'SPRINT'
                    : undefined
                }
              />
              <StatBar
                label="Contam"
                value={snap.contamination}
                max={100}
                barColor={contamBarCls}
                stateWord={
                  snap.contamination >= 90
                    ? 'TOXIC'
                    : !snap.objective.injectionTaken
                    ? 'SERUM'
                    : undefined
                }
              />
            </div>

            {activeConditions.length > 0 && (
              <div className="mt-2.5 pt-2 border-t border-[#e4d4c6]/14 text-[11px] font-mono-num text-[#d8c7b4] leading-tight">
                {activeConditions.map((c, idx) => (
                  <React.Fragment key={c}>
                    {idx > 0 && <span className="mx-1.5 text-[#6e5f51]">·</span>}
                    <span
                      className={
                        c === 'BLEEDING'
                          ? 'text-[#e0523c] font-semibold'
                          : c === 'INFECTED' || c === 'SPORES'
                          ? 'text-[#c7a955] font-semibold'
                          : c === 'VEST'
                          ? 'text-[#e6d6c3]'
                          : 'text-[#f39c59]'
                      }
                    >
                      {c === 'VEST' ? 'VEST ACTIVE' : c}
                    </span>
                  </React.Fragment>
                ))}
              </div>
            )}

            {snap.online.isOnlineMode && (
              <div className="mt-2.5 pt-2 border-t border-[#e4d4c6]/14 flex items-center justify-between text-[11px] font-mono-num">
                <span
                  className={
                    snap.extraction.contested
                      ? 'text-[#e0523c] font-semibold'
                      : 'text-[#f39c59] font-semibold'
                  }
                >
                  {snap.extraction.contested
                    ? 'LZ CONTESTED!'
                    : `ALIVE ${snap.online.aliveCount}/${snap.online.totalParticipants}`}
                </span>
                <span className="text-[#9c8b79]">
                  {snap.runStats.pvpKills ? `${snap.runStats.pvpKills} KILLS · ` : ''}1 SEAT
                </span>
              </div>
            )}
          </div>

          {/* TOP-CENTER: Simple Elegant Breaking News Radio Transmission */}
          <div className="flex-1 flex justify-center min-w-0">
            {activeRadio && snap.panel !== 'PHONE' && (
              <BreakingNewsTopBanner radio={activeRadio} compact={false} />
            )}
          </div>

          <div className="flex items-center gap-2 pointer-events-auto shrink-0">
            {snap.isGamepadConnected && (
              <div
                className={`min-h-[44px] px-3 rounded-xl border flex items-center gap-1.5 text-[11px] font-mono-num ${
                  padActive
                    ? 'bg-[#110c09]/90 border-[#e26d27]/45 text-[#f39c59]'
                    : 'bg-[#110c09]/76 border-[#e4d4c6]/14 text-[#9c8b79]'
                }`}
                title={snap.gamepadName || 'Controller Connected'}
              >
                <Gamepad2 className="w-3.5 h-3.5 shrink-0" />
                <span className="hidden lg:inline">
                  {padActive ? 'Pad Active' : 'Pad Ready'}
                </span>
              </div>
            )}

            <button
              type="button"
              onClick={onToggleFullscreen}
              className={`min-w-[44px] min-h-[44px] flex items-center justify-center border rounded-xl transition-colors cursor-pointer ${
                isFullscreen
                  ? 'bg-[#e26d27]/20 border-[#e26d27]/70 text-[#f39c59]'
                  : 'bg-[#110c09]/90 hover:bg-[#1c1510] border-[#e4d4c6]/16 text-[#d8c7b4] hover:text-[#f7f2e7]'
              }`}
              title={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
              aria-label={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
            >
              {isFullscreen ? (
                <Minimize2 className="w-4 h-4" />
              ) : (
                <Maximize2 className="w-4 h-4" />
              )}
            </button>

            <button
              type="button"
              onClick={onToggleMute}
              className="min-w-[44px] min-h-[44px] flex items-center justify-center bg-[#110c09]/90 hover:bg-[#1c1510] border border-[#e4d4c6]/16 rounded-xl text-[#d8c7b4] hover:text-[#f7f2e7] transition-colors cursor-pointer"
              title="Toggle Audio Mute (M)"
              aria-label={snap.settings.muted ? 'Unmute audio' : 'Mute audio'}
            >
              {snap.settings.muted ? (
                <VolumeX className="w-4 h-4 text-[#e0523c]" />
              ) : (
                <Volume2 className="w-4 h-4 text-[#d8c7b4]" />
              )}
            </button>

            <button
              type="button"
              onClick={onTogglePause}
              className="min-h-[44px] flex items-center gap-1.5 px-3.5 py-2 bg-[#110c09]/90 hover:bg-[#1c1510] border border-[#e4d4c6]/16 rounded-xl text-xs font-medium text-[#d8c7b4] hover:text-[#f7f2e7] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              title={padActive ? `Pause Game (${gp.start})` : 'Pause Game (Esc)'}
            >
              <Pause className="w-4 h-4 text-[#e26d27]" />
              <span>{padActive ? `Pause [${gp.start}]` : 'Pause'}</span>
            </button>
          </div>
        </div>
      )}

      {/* =====================================================================
          CONTEXTUAL ALERTS & INTERACTION PROMPT
         ===================================================================== */}
      <div
        className={`flex flex-col items-center px-2 ${
          isCompactLandscape
            ? 'gap-1 mt-1 mb-auto'
            : touchModeActive
            ? 'gap-2 mt-2 mb-auto'
            : 'gap-2 my-auto'
        }`}
      >
        {fullscreenHint && (
          <div className="max-w-sm px-3 py-1.5 rounded-xl bg-[#1a110c]/92 border border-[#e26d27]/55 text-[11px] text-[#f7f2e7] text-center">
            {fullscreenHint}
          </div>
        )}

        {snap.latestToast && !activeRadio && (
          <div
            className={`border text-center transition-opacity ${
              isCompactLandscape
                ? 'max-w-xs px-2.5 py-1 rounded-lg backdrop-blur-sm'
                : 'max-w-sm sm:max-w-md px-3.5 py-2 rounded-xl'
            } ${
              snap.latestToast.urgent
                ? 'bg-[#1c100b]/90 border-[#e26d27]/60 text-[#f7f2e7]'
                : 'bg-[#110c09]/86 border-[#e4d4c6]/18 text-[#d8c7b4]'
            }`}
          >
            <div className="text-[11px] font-semibold tracking-wide text-[#e26d27] leading-tight">
              {snap.latestToast.title}
            </div>
            <div
              className={`text-[11px] text-[#d8c7b4] mt-0.5 leading-snug ${
                isCompactLandscape ? 'line-clamp-2' : 'line-clamp-3'
              }`}
            >
              {snap.latestToast.text}
            </div>
          </div>
        )}

        {snap.interactionPrompt && snap.panel === 'NONE' && (
          <button
            type="button"
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onInteract();
            }}
            className={`pointer-events-auto cursor-pointer hover:bg-[#1c1510] active:scale-95 border border-[#e26d27]/70 text-center transition-all shadow-lg ${
              isCompactLandscape
                ? 'min-h-[38px] px-3 py-1 rounded-lg bg-[#110c09]/86 backdrop-blur-sm'
                : `min-h-[44px] px-4 py-2 rounded-xl bg-[#110c09]/94 ${
                    touchModeActive ? 'mt-1' : 'mt-20'
                  }`
            }`}
          >
            <div className="text-[11px] sm:text-xs font-semibold text-[#f7f2e7] whitespace-nowrap">
              {formatPromptLabel(snap.interactionPrompt.label)}
              {isCompactLandscape && snap.interactionPrompt.sublabel
                ? ` · ${snap.interactionPrompt.sublabel}`
                : ''}
            </div>
            {!isCompactLandscape && snap.interactionPrompt.sublabel && (
              <div className="text-[11px] text-[#9c8b79] mt-0.5">
                {snap.interactionPrompt.sublabel}
              </div>
            )}
            {snap.interactionPrompt.progress !== undefined && (
              <div className="mt-1 w-36 h-1 bg-[#221914] rounded overflow-hidden mx-auto">
                <div
                  className="h-full bg-[#e26d27] transition-none"
                  style={{
                    width: `${Math.round(snap.interactionPrompt.progress * 100)}%`,
                  }}
                />
              </div>
            )}
          </button>
        )}
      </div>

      {/* =====================================================================
          DESKTOP / CONTROLLER BOTTOM PERIMETER ROW
         ===================================================================== */}
      {isDesktopLayout ? (
        <div className="flex items-end justify-between gap-4">
          {/* BOTTOM-LEFT: Equipped Weapon & Ammo */}
          <div className="bg-[#110c09]/90 border border-[#e4d4c6]/16 rounded-xl p-3 flex items-center gap-3.5 pointer-events-auto">
            <div className="w-11 h-11 rounded-lg bg-[#19130f] border border-[#e4d4c6]/14 flex items-center justify-center shrink-0">
              {equippedDef ? (
                <ItemIconSVG iconId={equippedDef.iconId} className="w-7 h-7" />
              ) : (
                <span className="text-[11px] font-mono-num text-[#9c8b79]">FISTS</span>
              )}
            </div>

            <div className="min-w-[128px]">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-[#f7f2e7] leading-tight">
                  {equippedDef ? equippedDef.name : 'Unarmed'}
                </span>
                {padActive && (
                  <span className="text-[10px] font-mono-num text-[#9c8b79]">
                    {gp.lb}/{gp.rb}
                  </span>
                )}
              </div>
              <div className="text-xs font-mono-num text-[#9c8b79] mt-0.5">
                {equippedDef?.category === 'weapon_ranged' ? (
                  snap.isReloading ? (
                    <span className="text-[#e26d27]">
                      RELOADING {Math.round(snap.reloadProgress * 100)}%
                    </span>
                  ) : (
                    <span>
                      AMMO{' '}
                      <strong className="text-[#f7f2e7] font-semibold">
                        {equippedInst?.loadedAmmo ?? 0}
                      </strong>{' '}
                      / {reserveAmmo}
                      {padActive ? ` · [${gp.west}] Reload` : ''}
                    </span>
                  )
                ) : equippedDef?.category === 'weapon_melee' ? (
                  <span>
                    DURABILITY {equippedInst?.durability ?? 0}/{equippedDef.maxDurability}
                    {padActive ? ` · [${gp.rt}] Hit` : ''}
                  </span>
                ) : (
                  <span>
                    Melee Shove · {padActive ? `[${gp.rt}] Attack` : 'Low Damage'}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* BOTTOM-RIGHT: Quick Belt (1-4 / D-Pad), Survivor Phone & Pack */}
          <div className="flex items-center gap-2 pointer-events-auto">
            <div className="flex items-center gap-1.5 bg-[#110c09]/90 border border-[#e4d4c6]/16 rounded-xl p-1.5">
              {[0, 1, 2, 3].map((slotIdx) => {
                const it = snap.backpack[slotIdx];
                const def = it ? ITEMS[it.itemId] : null;
                const isEquipped = snap.equippedSlot === slotIdx;
                const keyBadge = padActive
                  ? DPAD_SLOT_LABELS[slotIdx]
                  : String(slotIdx + 1);
                return (
                  <button
                    key={slotIdx}
                    type="button"
                    onClick={() => onQuickSlotClick(slotIdx)}
                    className={`relative w-11 h-11 rounded-lg border flex items-center justify-center transition-colors cursor-pointer ${
                      isEquipped
                        ? 'bg-[#e26d27]/20 border-[#e26d27]'
                        : 'bg-[#19130f]/95 border-[#e4d4c6]/14 hover:border-[#e4d4c6]/32'
                    }`}
                    title={
                      def
                        ? `${def.name} (${padActive ? `D-Pad ${keyBadge}` : `Key ${slotIdx + 1}`})`
                        : `Quick Slot ${slotIdx + 1}`
                    }
                  >
                    <span className="absolute top-0.5 left-1 text-[9px] font-mono-num text-[#9c8b79]">
                      {keyBadge}
                    </span>
                    {def && <ItemIconSVG iconId={def.iconId} className="w-6 h-6" />}
                    {it && it.quantity > 1 && (
                      <span className="absolute bottom-0.5 right-1 text-[10px] font-mono-num text-[#f7f2e7]">
                        {it.quantity}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              onClick={onTogglePhone}
              className={`min-h-[44px] flex items-center gap-2 px-3.5 py-3 rounded-xl border text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                snap.panel === 'PHONE'
                  ? 'bg-[#e26d27] text-[#120d0a] border-[#f07c34]'
                  : isPhoneBatteryLow
                  ? 'bg-[#2a120e]/92 hover:bg-[#361712] text-[#f3a093] border-[#c94a38]/65'
                  : 'bg-[#110c09]/90 hover:bg-[#1c1510] text-[#f7f2e7] border-[#e4d4c6]/16'
              }`}
              title="Open Phone: Time, Flashlight, Maps & Radio"
            >
              <Smartphone
                className={`w-4 h-4 shrink-0 ${
                  snap.panel === 'PHONE'
                    ? 'text-[#120d0a]'
                    : snap.flashlightOn
                    ? 'text-[#e26d27]'
                    : 'text-[#d8c7b4]'
                }`}
              />
              <span>{padActive ? `Phone [${gp.select}]` : 'Phone [Q]'}</span>
              {snap.unreadRadioCount > 0 && (
                <span
                  className={`font-mono-num ${
                    snap.panel === 'PHONE' ? 'text-[#120d0a]' : 'text-[#e26d27]'
                  }`}
                >
                  ({snap.unreadRadioCount})
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={onToggleInventory}
              className={`min-h-[44px] flex items-center gap-2 px-4 py-3 rounded-xl border text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                snap.panel === 'INVENTORY' || snap.panel === 'LOOT'
                  ? 'bg-[#e26d27] text-[#120d0a] border-[#f07c34]'
                  : 'bg-[#110c09]/90 hover:bg-[#1c1510] text-[#f7f2e7] border-[#e4d4c6]/16'
              }`}
            >
              <Backpack
                className={`w-4 h-4 ${
                  snap.panel === 'INVENTORY' || snap.panel === 'LOOT'
                    ? 'text-[#120d0a]'
                    : 'text-[#e26d27]'
                }`}
              />
              <span>{padActive ? `Pack [${gp.north}]` : 'Pack [Tab]'}</span>
              <span className="font-mono-num opacity-80">
                {snap.totalWeight.toFixed(1)}/{snap.maxWeight}kg
              </span>
            </button>
          </div>
        </div>
      ) : (
        <div />
      )}
    </div>
  );
};

const BreakingNewsTopBanner: React.FC<{
  radio: ActiveRadioBroadcastState;
  compact: boolean;
}> = ({ radio, compact }) => {
  const isUnknownSpeaker = radio.speaker.includes('UNKNOWN');
  return (
    <div
      role="status"
      aria-live="polite"
      className={`pointer-events-none relative overflow-hidden w-full bg-[#0e0708]/88 backdrop-blur-md border border-[#e4d4c6]/14 shadow-xl transition-opacity duration-150 ${
        compact
          ? 'max-w-md rounded-lg px-3 py-1.5'
          : 'max-w-xl rounded-xl px-4 py-2.5'
      }`}
    >
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-[#c9363b]/85 to-transparent"
      />
      <div className="flex items-center justify-between gap-3 text-[10px] font-mono-num leading-none">
        <div className="flex items-center gap-1.5 min-w-0 truncate">
          <span className="font-semibold tracking-wider text-[#e0484d] shrink-0">
            BREAKING NEWS
          </span>
          <span aria-hidden="true" className="text-[#6e4648] shrink-0">
            ·
          </span>
          <span className="text-[#d8c7b4] shrink-0">{radio.timeLabel}</span>
          <span aria-hidden="true" className="text-[#6e4648] shrink-0">
            ·
          </span>
          <span
            className={`truncate ${
              isUnknownSpeaker ? 'text-[#d99fa2]' : 'text-[#f39c59]'
            }`}
          >
            {radio.speaker}
          </span>
        </div>

        <RadioWaveformBars level={radio.audioLevel} isCue={radio.isCue} />
      </div>

      <p
        className={`mt-1.5 leading-snug ${
          compact ? 'text-[11px] line-clamp-2' : 'text-[13px]'
        } ${
          radio.isCue
            ? 'font-mono-num text-[#d89b9e] tracking-wide'
            : isUnknownSpeaker
            ? 'text-[#e8d5d7] italic'
            : 'text-[#f7f2e7]'
        }`}
      >
        {radio.captionText}
      </p>
    </div>
  );
};

const RadioWaveformBars: React.FC<{ level: number; isCue: boolean }> = ({
  level,
  isCue,
}) => {
  const weights = [0.45, 0.85, 1.0, 0.72, 0.5];
  return (
    <div className="flex items-end gap-[2px] h-3 shrink-0" aria-hidden="true">
      {weights.map((w, idx) => {
        const activeH = Math.max(2, Math.min(12, Math.round((0.18 + level * w) * 12)));
        return (
          <span
            key={idx}
            className={`w-[2px] rounded-xs transition-transform duration-75 ${
              isCue ? 'bg-[#e0484d]' : 'bg-[#f39c59]'
            }`}
            style={{ height: `${activeH}px` }}
          />
        );
      })}
    </div>
  );
};

const LandscapeStatChip: React.FC<{
  code: string;
  value: number;
  barColor: string;
  alert?: boolean;
}> = ({ code, value, barColor, alert }) => {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className="w-10">
      <div className="flex items-center justify-between text-[9px] font-mono-num leading-none mb-0.5">
        <span className={alert ? 'text-[#e0523c] font-semibold' : 'text-[#9c8b79]'}>
          {code}
        </span>
        <span className={alert ? 'text-[#f7d6cf] font-semibold' : 'text-[#f7f2e7]'}>
          {value}
        </span>
      </div>
      <div className="h-[3px] w-full bg-[#221914] rounded-full overflow-hidden">
        <div className={`h-full ${barColor}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
};

const LandscapeIconBtn: React.FC<{
  onClick: () => void;
  label: string;
  active?: boolean;
  danger?: boolean;
  badgeCount?: number;
  children: React.ReactNode;
}> = ({ onClick, label, active, danger, badgeCount = 0, children }) => (
  <button
    type="button"
    onClick={onClick}
    aria-label={label}
    title={label}
    className="w-10 h-11 -my-1.5 flex items-center justify-center cursor-pointer active:scale-95 transition-transform"
  >
    <span
      className={`relative w-8 h-8 rounded-lg border backdrop-blur-sm flex items-center justify-center ${
        danger
          ? 'bg-[#2a120e]/80 border-[#c94a38]/70 text-[#f3a093]'
          : active
          ? 'bg-[#e26d27]/22 border-[#e26d27]/70 text-[#f39c59]'
          : 'bg-[#110c09]/76 border-[#e4d4c6]/16 text-[#d8c7b4]'
      }`}
    >
      {children}
      {badgeCount > 0 && (
        <span className="absolute -top-1 -right-1 px-1 rounded bg-[#e26d27] text-[#120d0a] text-[8px] font-mono-num font-bold leading-tight">
          {badgeCount}
        </span>
      )}
    </span>
  </button>
);

const MiniStat: React.FC<{
  code: string;
  value: number;
  barColor: string;
  alert?: boolean;
}> = ({ code, value, barColor, alert }) => {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className="min-w-[66px]">
      <div className="flex items-center justify-between text-[10px] font-mono-num leading-none mb-0.5">
        <span className={alert ? 'text-[#e0523c] font-semibold' : 'text-[#9c8b79]'}>
          {code}
        </span>
        <span className={alert ? 'text-[#f7d6cf] font-semibold' : 'text-[#f7f2e7]'}>
          {value}
        </span>
      </div>
      <div className="h-1 w-full bg-[#221914] rounded-xs overflow-hidden">
        <div className={`h-full ${barColor}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
};

const StatBar: React.FC<{
  label: string;
  value: number;
  max: number;
  barColor: string;
  stateWord?: string;
}> = ({ label, value, max, barColor, stateWord }) => {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div>
      <div className="flex items-center justify-between text-[11px] font-mono-num leading-none mb-1">
        <span className="text-[#d8c7b4] font-sans font-medium">{label}</span>
        <span className="text-[#f7f2e7]">
          {value}
          {stateWord ? ` · ${stateWord}` : ''}
        </span>
      </div>
      <div className="h-1.5 w-full bg-[#221914] rounded-xs overflow-hidden">
        <div className={`h-full ${barColor}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
};
