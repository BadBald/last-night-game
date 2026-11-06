import React, { useEffect, useRef, useState } from 'react';
import {
  BatteryCharging,
  BatteryLow,
  BatteryMedium,
  Compass,
  Flashlight,
  MapPin,
  MessageCircle,
  Mic,
  MicOff,
  Play,
  Radio,
  Send,
  Signal,
  Square,
  Volume2,
  X,
} from 'lucide-react';
import { getGamepadGlyphs, subscribeGamepadUI } from '../engine/input';
import { countItemInBackpack } from '../systems/inventory';
import { UISnapshot } from '../types';
import { ItemIconSVG } from './Icons';
import { useViewportLayout } from './useViewportLayout';

interface PhoneModalProps {
  snap: UISnapshot;
  onClose: () => void;
  onToggleFlashlight: () => void;
  onUsePowerBank: () => void;
  onReplayRadioBeep: () => void;
  onReplayBroadcast: (broadcastId: string) => void;
  onStopBroadcast: () => void;
  onClearUnreadRadio: () => void;
  onSendChat: (text: string) => void;
  onToggleMic: () => void;
  onClearUnreadChat: () => void;
}

type PhoneAppTab = 'maps' | 'radio' | 'chat';

export const PhoneModal: React.FC<PhoneModalProps> = ({
  snap,
  onClose,
  onToggleFlashlight,
  onUsePowerBank,
  onReplayRadioBeep,
  onReplayBroadcast,
  onStopBroadcast,
  onClearUnreadRadio,
  onSendChat,
  onToggleMic,
  onClearUnreadChat,
}) => {
  const { isCompactLandscape } = useViewportLayout();
  const gp = getGamepadGlyphs(snap.gamepadBrand);
  const padActive = snap.isGamepadActive;
  const feedScrollRef = useRef<HTMLDivElement | null>(null);
  const msgRefs = useRef<(HTMLDivElement | null)[]>([]);
  const phoneBodyRef = useRef<HTMLDivElement | null>(null);
  const chatInputRef = useRef<HTMLInputElement | null>(null);

  const [activeTab, setActiveTab] = useState<PhoneAppTab>(() =>
    snap.unreadRadioCount > 0 || Boolean(snap.activeRadioBroadcast) ? 'radio' : 'maps'
  );
  const [focusedMsgIdx, setFocusedMsgIdx] = useState(0);

  const powerBankCount = countItemInBackpack(snap.backpack, 'powerbank');
  const canCharge = powerBankCount > 0 && snap.flashlightBattery < 100;
  const isBatteryLow = snap.flashlightBattery <= 18;
  const activeRadio = snap.activeRadioBroadcast;

  useEffect(() => {
    if (activeTab === 'radio' && snap.unreadRadioCount > 0) {
      onClearUnreadRadio();
    }
    if (activeTab === 'chat' && snap.online.unreadChatCount > 0) {
      onClearUnreadChat();
    }
  }, [activeTab, snap.unreadRadioCount, snap.online.unreadChatCount, onClearUnreadRadio, onClearUnreadChat]);

  useEffect(() => {
    if (activeTab !== 'chat') return;
    const body = phoneBodyRef.current;
    if (!body) return;
    // Chat uses the phone body as its single scroll container. Keeping one
    // scroller makes touch scrolling reliable on mobile (no nested traps).
    body.scrollTop = body.scrollHeight;
  }, [snap.online.chatMessages.length, activeTab]);

  // Gamepad navigation inside Survivor Phone
  useEffect(() => {
    return subscribeGamepadUI((action) => {
      if (action === 'ui_cancel' || action === 'ui_select') {
        onClose();
        return;
      }
      if (action === 'ui_lb' || action === 'ui_rb') {
        setActiveTab((prev) => {
          const next = prev === 'maps' ? 'radio' : 'maps';
          if (next === 'radio') onClearUnreadRadio();
          return next;
        });
        return;
      }
      if (action === 'ui_north') {
        onToggleFlashlight();
        return;
      }
      if (action === 'ui_west') {
        if (canCharge) {
          onUsePowerBank();
        }
        return;
      }

      if (activeTab === 'radio') {
        if (action === 'nav_down') {
          if (snap.radioMessages.length > 0) {
            setFocusedMsgIdx((prev) => {
              const next = Math.min(snap.radioMessages.length - 1, prev + 1);
              msgRefs.current[next]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
              return next;
            });
          } else {
            feedScrollRef.current?.scrollBy({ top: 96, behavior: 'smooth' });
          }
        } else if (action === 'nav_up') {
          if (snap.radioMessages.length > 0) {
            setFocusedMsgIdx((prev) => {
              const next = Math.max(0, prev - 1);
              msgRefs.current[next]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
              return next;
            });
          } else {
            feedScrollRef.current?.scrollBy({ top: -96, behavior: 'smooth' });
          }
        } else if (action === 'ui_confirm') {
          if (snap.radioMessages.length === 0) {
            onReplayRadioBeep();
          } else {
            const safeIdx = Math.min(focusedMsgIdx, snap.radioMessages.length - 1);
            const targetMsg = snap.radioMessages[safeIdx];
            if (targetMsg?.broadcastId) {
              if (activeRadio?.broadcastId === targetMsg.broadcastId) {
                onStopBroadcast();
              } else {
                onReplayBroadcast(targetMsg.broadcastId);
              }
            } else {
              onReplayRadioBeep();
            }
          }
        }
      }
    });
  }, [
    activeTab,
    canCharge,
    focusedMsgIdx,
    activeRadio?.broadcastId,
    snap.radioMessages,
    onClose,
    onClearUnreadRadio,
    onToggleFlashlight,
    onUsePowerBank,
    onReplayRadioBeep,
    onReplayBroadcast,
    onStopBroadcast,
  ]);

  const ext = snap.extraction;
  const obj = snap.objective;

  const mapW = 460;
  const mapH = 196;
  const px = Math.max(12, Math.min(mapW - 12, ext.playerNormPos.x * mapW));
  const py = Math.max(12, Math.min(mapH - 12, ext.playerNormPos.y * mapH));
  const tx = Math.max(14, Math.min(mapW - 14, obj.targetNormPos.x * mapW));
  const ty = Math.max(14, Math.min(mapH - 14, obj.targetNormPos.y * mapH));

  const villageEndX = (38 / 216) * mapW;
  const f45EndX = (95 / 216) * mapW;
  const f45Y = (56 / 92) * mapH;
  const northAveY = (28 / 92) * mapH;

  const renderBatteryIcon = () => {
    if (isBatteryLow) {
      return <BatteryLow className="w-4 h-4 text-[#e0523c] shrink-0" />;
    }
    if (snap.flashlightBattery >= 80) {
      return <BatteryCharging className="w-4 h-4 text-[#9ab37c] shrink-0" />;
    }
    return <BatteryMedium className="w-4 h-4 text-[#d8c7b4] shrink-0" />;
  };

  const renderStatusBar = () => (
    <div className="flex items-center justify-between gap-2 text-[11px] font-mono-num text-[#9c8b79] pb-2 border-b border-[#e4d4c6]/14">
      <div className="flex items-center gap-1.5 min-w-0 truncate">
        <Signal
          className={`w-3.5 h-3.5 shrink-0 ${
            activeRadio
              ? 'text-[#e0484d]'
              : obj.radioDiscovered
              ? 'text-[#e26d27]'
              : 'text-[#c9363b]'
          }`}
        />
        <span className="truncate">
          {snap.online.isOnlineMode
            ? `${snap.online.aliveCount}/${snap.online.totalParticipants} ALIVE · 1 SEAT`
            : activeRadio
            ? 'LIVE 162.55 MHz'
            : obj.radioDiscovered
            ? 'VHF SYNC'
            : '162.55 MHz EMERGENCY'}
        </span>
        {!snap.online.isOnlineMode && (
          <>
            <span aria-hidden="true" className="text-[#6e5f51]">
              ·
            </span>
            <span className="truncate text-[#9c8b79]">{snap.weatherLabel}</span>
          </>
        )}
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {snap.flashlightOn && snap.flashlightBattery > 0 && (
          <Flashlight className="w-3.5 h-3.5 text-[#e26d27] shrink-0" />
        )}
        <div className="flex items-center gap-1">
          <span
            className={
              isBatteryLow ? 'text-[#e0523c] font-semibold' : 'text-[#f7f2e7]'
            }
          >
            {snap.flashlightBattery}%
          </span>
          {renderBatteryIcon()}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="ml-1 w-7 h-7 rounded-lg bg-[#19130f] hover:bg-[#241b15] border border-[#e4d4c6]/16 text-[#d8c7b4] hover:text-[#f7f2e7] flex items-center justify-center transition-colors cursor-pointer"
          aria-label="Put Away Phone"
          title={padActive ? `Close Phone (${gp.east})` : 'Close Phone (Q / Esc)'}
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );

  const renderClockAndControls = () => (
    <div className="space-y-3">
      {/* Diegetic Phone Lock/Home Clock & District */}
      <div className="pt-1 flex items-baseline justify-between gap-3">
        <div>
          <div className="font-display text-4xl sm:text-[2.6rem] font-bold tracking-wider text-[#f7f2e7] leading-none font-mono-num">
            {snap.clockFormatted}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-[#9c8b79] font-mono-num">
            <span>Dawn in {snap.countdownFormatted}</span>
            <span aria-hidden="true" className="text-[#6e5f51]">
              ·
            </span>
            <span className="font-sans text-[#d8c7b4] truncate max-w-[210px]">
              {snap.districtName}
            </span>
          </div>
        </div>

        {/* Direction Bearing Readout */}
        <div className="text-right shrink-0 font-mono-num">
          <div className="inline-flex items-center gap-1 text-xs text-[#f39c59]">
            <Compass
              className="w-3.5 h-3.5 shrink-0 text-[#e26d27]"
              style={{
                transform: `rotate(${(obj.directionAngle * 180) / Math.PI + 90}deg)`,
              }}
            />
            <span>
              {obj.stage === 'SURVIVE_TO_HELIPAD' && ext.playerInZone
                ? 'IN LZ'
                : `${obj.distanceMeters}m ${obj.compassCardinal}`}
            </span>
          </div>
          <div className="text-[10px] text-[#9c8b79] mt-0.5">
            Step {obj.stepNumber}/{obj.totalSteps}
          </div>
        </div>
      </div>

      {/* Hardware Quick Toggles: Phone Torch + Power Bank */}
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onToggleFlashlight}
          className={`min-h-[48px] px-3 py-2 rounded-xl border text-left flex items-center gap-2.5 transition-colors cursor-pointer ${
            snap.flashlightOn && snap.flashlightBattery > 0
              ? 'bg-[#e26d27] text-[#120d0a] border-[#f07c34]'
              : snap.flashlightBattery <= 0
              ? 'bg-[#19130f]/55 text-[#6e5f51] border-[#e4d4c6]/10'
              : 'bg-[#19130f] hover:bg-[#231a14] text-[#f7f2e7] border-[#e4d4c6]/16'
          }`}
        >
          <Flashlight
            className={`w-4 h-4 shrink-0 ${
              snap.flashlightOn && snap.flashlightBattery > 0
                ? 'text-[#120d0a]'
                : 'text-[#e26d27]'
            }`}
          />
          <div className="min-w-0">
            <div className="text-xs font-semibold leading-tight whitespace-nowrap">
              {snap.flashlightOn && snap.flashlightBattery > 0
                ? 'Flashlight On'
                : 'Flashlight Off'}
            </div>
            <div
              className={`text-[10px] font-mono-num leading-tight mt-0.5 whitespace-nowrap ${
                snap.flashlightOn && snap.flashlightBattery > 0
                  ? 'text-[#120d0a]/80'
                  : isBatteryLow
                  ? 'text-[#e0523c]'
                  : 'text-[#9c8b79]'
              }`}
            >
              {snap.flashlightBattery <= 0
                ? '0% · Needs Charge'
                : `${snap.flashlightBattery}% · ${padActive ? gp.north : 'Key F'}`}
            </div>
          </div>
        </button>

        <button
          type="button"
          onClick={onUsePowerBank}
          disabled={!canCharge}
          className={`min-h-[48px] px-3 py-2 rounded-xl border text-left flex items-center gap-2.5 transition-colors ${
            canCharge
              ? 'bg-[#19130f] hover:bg-[#231a14] text-[#f7f2e7] border-[#e26d27]/45 cursor-pointer'
              : 'bg-[#16100d]/60 text-[#6e5f51] border-[#e4d4c6]/10 cursor-not-allowed'
          }`}
        >
          <ItemIconSVG iconId="powerbank" className="w-5 h-5 shrink-0" />
          <div className="min-w-0">
            <div className="text-xs font-semibold leading-tight whitespace-nowrap">
              Power Bank{padActive && canCharge ? ` [${gp.west}]` : ''}
            </div>
            <div className="text-[10px] font-mono-num leading-tight mt-0.5 whitespace-nowrap">
              {powerBankCount <= 0
                ? '0 in Pack'
                : snap.flashlightBattery >= 100
                ? `Full · ${powerBankCount} Carried`
                : `+60% · ${powerBankCount} Carried`}
            </div>
          </div>
        </button>
      </div>

      {/* App Switcher Segmented Control: Maps | Radio | Chat (online) */}
      <div className={`grid ${snap.online.isOnlineMode ? 'grid-cols-3' : 'grid-cols-2'} gap-1 p-1 rounded-xl bg-[#19130f] border border-[#e4d4c6]/14`}>
        <button
          type="button"
          onClick={() => setActiveTab('maps')}
          className={`min-h-[40px] px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap cursor-pointer ${
            activeTab === 'maps'
              ? 'bg-[#281e17] text-[#f7f2e7] border border-[#e26d27]/35'
              : 'text-[#9c8b79] hover:text-[#d8c7b4]'
          }`}
        >
          <MapPin className="w-3.5 h-3.5 text-[#e26d27] shrink-0" />
          <span>Maps{padActive ? ` [${gp.lb}]` : ''}</span>
        </button>

        <button
          type="button"
          onClick={() => {
            setActiveTab('radio');
            onClearUnreadRadio();
          }}
          className={`min-h-[40px] px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap cursor-pointer ${
            activeTab === 'radio'
              ? 'bg-[#281e17] text-[#f7f2e7] border border-[#c9363b]/55'
              : 'text-[#9c8b79] hover:text-[#d8c7b4]'
          }`}
        >
          <Radio className="w-3.5 h-3.5 shrink-0 text-[#e0484d]" />
          <span>Radio{padActive ? ` [${gp.rb}]` : ''}</span>
          {snap.unreadRadioCount > 0 && (
            <span className="font-mono-num text-[#e26d27]">
              ({snap.unreadRadioCount})
            </span>
          )}
        </button>

        {snap.online.isOnlineMode && (
          <button
            type="button"
            onClick={() => {
              setActiveTab('chat');
              // mark read via parent? handled by setPanel? We'll clear by direct? Use onClearUnreadChat? none. We'll just reset locally not possible. Instead, parent handles via setPanel. Keep simple.
            }}
            className={`min-h-[40px] px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap cursor-pointer ${
              activeTab === 'chat'
                ? 'bg-[#281e17] text-[#f7f2e7] border border-[#e26d27]/35'
                : 'text-[#9c8b79] hover:text-[#d8c7b4]'
            }`}
          >
            <MessageCircle className="w-3.5 h-3.5 shrink-0 text-[#f39c59]" />
            <span>Chat</span>
            {snap.online.unreadChatCount > 0 && (
              <span className="font-mono-num text-[#e26d27]">
                ({snap.online.unreadChatCount})
              </span>
            )}
          </button>
        )}
      </div>
    </div>
  );

  const renderMapsApp = () => (
    <div className="space-y-2.5">
      <div className="relative rounded-xl bg-[#0b0806] border border-[#e4d4c6]/16 overflow-hidden">
        <svg
          viewBox={`0 0 ${mapW} ${mapH}`}
          className="w-full h-auto block select-none"
          aria-label="Phone Offline Quarantine Map"
        >
          <rect
            x={0}
            y={0}
            width={villageEndX}
            height={mapH}
            fill="rgba(34, 38, 24, 0.42)"
          />
          <rect
            x={villageEndX}
            y={0}
            width={f45EndX - villageEndX}
            height={mapH}
            fill="rgba(24, 21, 16, 0.65)"
          />
          <line
            x1={villageEndX}
            y1={0}
            x2={villageEndX}
            y2={mapH}
            stroke="#3a2d23"
            strokeDasharray="3 3"
          />
          <line
            x1={f45EndX}
            y1={0}
            x2={f45EndX}
            y2={mapH}
            stroke="#4e3c2f"
            strokeWidth="1.5"
          />
          <line
            x1={14}
            y1={f45Y}
            x2={villageEndX}
            y2={f45Y}
            stroke="#4c3726"
            strokeWidth="4"
          />
          <line
            x1={villageEndX}
            y1={f45Y}
            x2={mapW}
            y2={f45Y}
            stroke="#2f241c"
            strokeWidth="6"
          />
          <line
            x1={villageEndX}
            y1={f45Y}
            x2={f45EndX}
            y2={f45Y}
            stroke="#e26d27"
            strokeOpacity="0.45"
            strokeWidth="1"
            strokeDasharray="4 4"
          />
          <line
            x1={f45EndX}
            y1={northAveY}
            x2={mapW}
            y2={northAveY}
            stroke="#2b211a"
            strokeWidth="4"
          />
          <line
            x1={(126 / 216) * mapW}
            y1={0}
            x2={(126 / 216) * mapW}
            y2={mapH}
            stroke="#2b211a"
            strokeWidth="4"
          />
          <line
            x1={(164 / 216) * mapW}
            y1={northAveY}
            x2={(164 / 216) * mapW}
            y2={mapH}
            stroke="#2b211a"
            strokeWidth="4"
          />

          <line
            x1={px}
            y1={py}
            x2={tx}
            y2={ty}
            stroke={obj.stage === 'HOSPITAL_INJECTION' ? '#c7a955' : '#e26d27'}
            strokeOpacity="0.82"
            strokeWidth="1.5"
            strokeDasharray="5 4"
          />

          {ext.mapMarkers.map((m) => {
            const mx = Math.max(24, Math.min(mapW - 24, m.nx * mapW));
            const my = Math.max(14, Math.min(mapH - 16, m.ny * mapH));

            if (m.isTargetLZ && obj.radioDiscovered) {
              return (
                <g key={m.id} transform={`translate(${mx}, ${my})`}>
                  <circle
                    r="11"
                    fill="rgba(226, 109, 39, 0.22)"
                    stroke="#e26d27"
                    strokeWidth="1.5"
                  />
                  <text
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill="#f7f2e7"
                    fontSize="8.5"
                    fontWeight="700"
                    fontFamily="JetBrains Mono, monospace"
                  >
                    H
                  </text>
                  <text
                    y="18"
                    textAnchor="middle"
                    fill="#f3a871"
                    fontSize="7.5"
                    fontWeight="600"
                    fontFamily="Plus Jakarta Sans, sans-serif"
                  >
                    {m.label}
                  </text>
                </g>
              );
            }

            if (
              m.id === 'hospital' &&
              (obj.stage === 'HOSPITAL_INJECTION' || obj.stage === 'HOSPITAL_RADIO')
            ) {
              const col = obj.stage === 'HOSPITAL_INJECTION' ? '#c7a955' : '#e26d27';
              return (
                <g key={m.id} transform={`translate(${mx}, ${my})`}>
                  <circle
                    r="9.5"
                    fill="rgba(199, 169, 85, 0.18)"
                    stroke={col}
                    strokeWidth="1.5"
                  />
                  <text
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill={col}
                    fontSize="8.5"
                    fontWeight="700"
                    fontFamily="JetBrains Mono, monospace"
                  >
                    +
                  </text>
                  <text
                    y="17"
                    textAnchor="middle"
                    fill="#f7f2e7"
                    fontSize="7.5"
                    fontWeight="600"
                    fontFamily="Plus Jakarta Sans, sans-serif"
                  >
                    {m.label}
                  </text>
                </g>
              );
            }

            return (
              <g key={m.id} transform={`translate(${mx}, ${my})`}>
                <rect
                  x="-2.5"
                  y="-2.5"
                  width="5"
                  height="5"
                  rx="1"
                  fill="#2c221b"
                  stroke="#7b6857"
                  strokeWidth="1"
                />
                <text
                  y="10"
                  textAnchor="middle"
                  fill="#9c8b79"
                  fontSize="7"
                  fontFamily="Plus Jakarta Sans, sans-serif"
                >
                  {m.isLZCandidate && !obj.radioDiscovered ? `${m.label} [?]` : m.label}
                </text>
              </g>
            );
          })}

          {!obj.radioDiscovered && (
            <g transform={`translate(${tx}, ${ty})`}>
              <circle
                r="6"
                fill="none"
                stroke={obj.stage === 'HOSPITAL_INJECTION' ? '#c7a955' : '#e26d27'}
                strokeWidth="1.5"
              />
            </g>
          )}

          <g transform={`translate(${px}, ${py})`}>
            <circle r="5" fill="#f7f2e7" stroke="#120d0a" strokeWidth="1.5" />
            <text
              y="-8"
              textAnchor="middle"
              fill="#f7f2e7"
              fontSize="7.5"
              fontWeight="700"
              fontFamily="JetBrains Mono, monospace"
            >
              YOU
            </text>
          </g>
        </svg>
      </div>

      {/* Unboxed Clean Route Objective Details */}
      <div className="pt-1 space-y-1.5 text-xs">
        <div className="flex items-center justify-between gap-2 font-mono-num">
          <span
            className={`font-semibold truncate ${
              obj.stage === 'HOSPITAL_INJECTION' ? 'text-[#e3c674]' : 'text-[#e26d27]'
            }`}
          >
            {obj.title}
          </span>
          <span className="text-[#d8c7b4] shrink-0">
            {obj.stage === 'SURVIVE_TO_HELIPAD' && ext.playerInZone
              ? 'Hold LZ to 6:00 AM'
              : `${obj.distanceMeters}m ${obj.compassCardinal}`}
          </span>
        </div>

        <p className="text-[#d8c7b4] leading-relaxed text-[11px] sm:text-xs">
          {obj.hint}
        </p>

        <div className="pt-1.5 border-t border-[#e4d4c6]/14 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] font-mono-num text-[#9c8b79]">
          <span className={obj.stepNumber > 1 ? 'text-[#9ab37c]' : 'text-[#f39c59]'}>
            1. Village {obj.stepNumber > 1 ? '✓' : ''}
          </span>
          <span aria-hidden="true">·</span>
          <span
            className={
              obj.stepNumber > 2
                ? 'text-[#9ab37c]'
                : obj.stepNumber === 2
                ? 'text-[#f39c59]'
                : ''
            }
          >
            2. Road F45 {obj.stepNumber > 2 ? '✓' : ''}
          </span>
          <span aria-hidden="true">·</span>
          <span
            className={
              obj.injectionTaken
                ? 'text-[#9ab37c]'
                : obj.stepNumber === 3
                ? 'text-[#e3c674]'
                : ''
            }
          >
            3. Serum {obj.injectionTaken ? '✓' : ''}
          </span>
          <span aria-hidden="true">·</span>
          <span
            className={
              obj.radioDiscovered
                ? 'text-[#9ab37c]'
                : obj.stepNumber === 4
                ? 'text-[#f39c59]'
                : ''
            }
          >
            4. Radio {obj.radioDiscovered ? '✓' : ''}
          </span>
          <span aria-hidden="true">·</span>
          <span className={obj.radioDiscovered ? 'text-[#f39c59]' : ''}>
            5. 6:00 AM LZ
          </span>
        </div>
      </div>
    </div>
  );

  const renderTranscriptBlocks = (
    transcript: {
      type: 'speaker' | 'cue';
      speaker?: string;
      cue?: string;
      lines?: string[];
    }[]
  ) => (
    <div className="mt-2 space-y-2 pt-2 border-t border-[#e4d4c6]/10">
      {transcript.map((blk, bIdx) => {
        if (blk.type === 'cue') {
          return (
            <div
              key={bIdx}
              className="text-[10px] font-mono-num text-[#e0484d] tracking-wider"
            >
              {blk.cue}
            </div>
          );
        }
        return (
          <div key={bIdx} className="space-y-1">
            <div className="text-[10px] font-mono-num font-semibold tracking-wider text-[#f39c59]">
              {blk.speaker}
            </div>
            {blk.lines?.map((line, lIdx) => (
              <p key={lIdx} className="text-xs text-[#f7f2e7] leading-relaxed">
                {line}
              </p>
            ))}
          </div>
        );
      })}
    </div>
  );

  const renderRadioApp = () => (
    <div className="space-y-2.5">
      {/* Frequency Header — Live Feed Only */}
      <div className="flex items-center justify-between gap-2 pb-2 border-b border-[#e4d4c6]/14 text-[11px] font-mono-num">
        <div className="text-[#d8c7b4] truncate">
          <span>162.55 MHz</span>
          <span aria-hidden="true" className="mx-1.5 text-[#6e5f51]">
            ·
          </span>
          <span className="text-[#e0484d]">Live Feed</span>
        </div>

        <span
          className={`shrink-0 ${
            activeRadio ? 'text-[#e0484d] font-semibold' : 'text-[#9c8b79]'
          }`}
        >
          {activeRadio ? 'ON AIR' : 'Monitoring'}
        </span>
      </div>

      {/* Active On-Air Live Transmission Readout */}
      {activeRadio && (
        <div className="p-2.5 rounded-xl bg-[#16090b] border border-[#c9363b]/45 space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[10px] font-mono-num text-[#e0484d] font-semibold tracking-wider truncate">
              LIVE · {activeRadio.timeLabel} · {activeRadio.speaker}
            </div>
            <button
              type="button"
              onClick={onStopBroadcast}
              className="px-2 py-0.5 rounded-md bg-[#261013] hover:bg-[#341519] border border-[#c9363b]/50 text-[10px] font-mono-num font-semibold text-[#f7f2e7] flex items-center gap-1 whitespace-nowrap shrink-0 transition-colors cursor-pointer"
            >
              <Square className="w-2.5 h-2.5 fill-current text-[#e0484d] shrink-0" />
              <span>Stop</span>
            </button>
          </div>
          <p
            className={`text-xs leading-snug ${
              activeRadio.isCue
                ? 'font-mono-num text-[#d89b9e]'
                : 'text-[#f7f2e7]'
            }`}
          >
            {activeRadio.captionText}
          </p>
        </div>
      )}

      <div
        ref={feedScrollRef}
        className="max-h-60 sm:max-h-68 overflow-y-auto scroll-touch divide-y divide-[#e4d4c6]/12 pr-1"
      >
        {snap.radioMessages.length === 0 ? (
          <div className="py-5 text-xs text-[#9c8b79] flex items-center justify-between gap-2">
            <span>Monitoring 162.55 MHz Civil Protection frequency...</span>
            <button
              type="button"
              onClick={onReplayRadioBeep}
              className="min-h-[36px] px-2.5 py-1 rounded-lg bg-[#19130f] border border-[#e4d4c6]/16 text-[11px] text-[#f39c59] flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Volume2 className="w-3.5 h-3.5 shrink-0" />
              <span>Tune</span>
            </button>
          </div>
        ) : (
          snap.radioMessages.map((msg, idx) => {
            const safeFocusedIdx = Math.min(focusedMsgIdx, snap.radioMessages.length - 1);
            const isFocused = padActive && idx === safeFocusedIdx;
            const isPlayingThis = Boolean(
              msg.broadcastId && activeRadio?.broadcastId === msg.broadcastId
            );

            return (
              <div
                key={msg.id}
                ref={(el) => {
                  msgRefs.current[idx] = el;
                }}
                onClick={() => setFocusedMsgIdx(idx)}
                className={`py-3 first:pt-1.5 transition-colors ${
                  isFocused ? 'bg-[#1b1210]/75 rounded-lg px-2 -mx-1' : ''
                }`}
              >
                <div className="flex items-center justify-between gap-2 text-[11px] font-mono-num">
                  <span
                    className={
                      msg.urgent
                        ? 'text-[#e0484d] font-semibold truncate'
                        : 'text-[#d8c7b4] truncate'
                    }
                  >
                    {msg.sender}
                  </span>

                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[#9c8b79]">{msg.timeFormatted}</span>
                    {msg.broadcastId && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (isPlayingThis) {
                            onStopBroadcast();
                          } else {
                            onReplayBroadcast(msg.broadcastId!);
                          }
                        }}
                        className={`min-h-[28px] px-2.5 py-0.5 rounded-lg border text-[11px] font-sans font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                          isPlayingThis
                            ? 'bg-[#2a1114] hover:bg-[#38161a] text-[#f7f2e7] border-[#c9363b]/65'
                            : isFocused
                            ? 'bg-[#281b15] text-[#f7f2e7] border-[#e26d27]/75'
                            : 'bg-[#19130f] hover:bg-[#241b15] text-[#f39c59] hover:text-[#f7f2e7] border-[#e4d4c6]/18'
                        }`}
                      >
                        {isPlayingThis ? (
                          <>
                            <Square className="w-2.5 h-2.5 fill-current text-[#e0484d] shrink-0" />
                            <span>Stop{isFocused ? ` [${gp.south}]` : ''}</span>
                          </>
                        ) : (
                          <>
                            <Play className="w-3 h-3 fill-current shrink-0" />
                            <span>Replay{isFocused ? ` [${gp.south}]` : ''}</span>
                          </>
                        )}
                      </button>
                    )}
                  </div>
                </div>

                {msg.headline && (
                  <div className="mt-1 text-xs font-semibold text-[#f7f2e7]">
                    {msg.headline}
                  </div>
                )}

                {msg.transcript ? (
                  renderTranscriptBlocks(msg.transcript)
                ) : (
                  <p className="mt-1 text-xs text-[#f7f2e7] leading-relaxed">
                    {msg.text}
                  </p>
                )}
              </div>
            );
          })
        )}

        {!obj.radioDiscovered && (
          <div className="pt-3 pb-1 text-[11px] text-[#9c8b79] leading-relaxed">
            <span className="text-[#e3c674] font-semibold">
              Flight Echo-7 GPS Coordinates Locked:
            </span>{' '}
            Tune the <strong className="text-[#d8c7b4]">Emergency Radio</strong> inside{' '}
            <strong className="text-[#d8c7b4]">St. Jude Memorial Hospital</strong> (or survive until the 5:00 AM evacuation broadcast) to reveal the exact 6:00 AM landing zone on your map.
          </div>
        )}
      </div>
    </div>
  );

  const renderChatApp = () => {
    const sendDraft = () => {
      const input = chatInputRef.current;
      const t = input?.value.trim() ?? '';
      if (!t) return;
      onSendChat(t);
      if (input) input.value = '';
      const body = phoneBodyRef.current;
      if (body) body.scrollTop = body.scrollHeight;
      input?.focus();
    };
    const handleSendKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        sendDraft();
      }
    };
    const isTalking = snap.online.selfTalking;
    return (
      <div className="space-y-2.5">
        <div className="flex items-center justify-between gap-2 pb-2 border-b border-[#e4d4c6]/14">
          <span className="text-[#d8c7b4] text-xs font-semibold">Squad Chat</span>
          <button
            type="button"
            onClick={onToggleMic}
            className={`min-h-[36px] px-3 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${isTalking ? 'bg-[#c9363b] text-[#f8eded]' : 'bg-[#19130f] text-[#9c8b79] border border-[#e4d4c6]/16'}`}
            aria-label={isTalking ? 'Stop talking' : 'Start talking'}
          >
            {isTalking ? <Mic className="w-3.5 h-3.5" /> : <MicOff className="w-3.5 h-3.5" />}
            {isTalking ? 'Talking' : 'Tap to Talk'}
          </button>
        </div>
        <div className="space-y-1.5 pr-1">
          {snap.online.chatMessages.length === 0 && (
            <p className="text-xs text-[#9c8b79] text-center mt-6">No messages yet.</p>
          )}
          {snap.online.chatMessages.map((m) => (
            <div key={m.id} className={`flex flex-col ${m.fromId === snap.online.selfId ? 'items-end' : 'items-start'}`}>
              <span className="text-[10px] font-mono-num text-[#9c8b79] mb-0.5">{m.fromCallsign}</span>
              <div className={`max-w-[85%] px-2.5 py-1 rounded-lg text-xs leading-relaxed break-words ${m.fromId === snap.online.selfId ? 'bg-[#e26d27] text-[#120d0a] rounded-br-sm' : 'bg-[#19130f] border border-[#e4d4c6]/16 text-[#f7f2e7] rounded-bl-sm'}`}>
                {m.text}
              </div>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2 pt-2 border-t border-[#e4d4c6]/14">
          <input
            ref={chatInputRef}
            type="text"
            inputMode="text"
            autoComplete="off"
            enterKeyHint="send"
            placeholder="Type a message..."
            className="flex-1 min-h-[36px] px-2.5 py-1.5 rounded-lg bg-[#0b0806] border border-[#e4d4c6]/16 text-[#f7f2e7] text-xs placeholder:text-[#9c8b79] focus:outline-none focus:border-[#e26d27]/60"
            maxLength={200}
            onKeyDown={handleSendKey}
            onFocus={() => {
              window.setTimeout(() => {
                const body = phoneBodyRef.current;
                if (body) body.scrollTop = body.scrollHeight;
              }, 250);
            }}
          />
          <button
            type="button"
            onClick={sendDraft}
            className="min-w-[38px] min-h-[36px] rounded-lg bg-[#e26d27] hover:bg-[#f07c34] text-[#120d0a] flex items-center justify-center cursor-pointer active:scale-95 transition-transform"
            aria-label="Send message"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </div>
        <p className="text-[10px] text-[#9c8b79]">Tap the mic or press T to toggle voice chat.</p>
      </div>
    );
  };

  return (
    <div
      className="fixed inset-0 z-20 pointer-events-auto bg-[#070504]/74 flex items-center justify-center p-2 sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Handheld Survivor Smartphone Chassis */}
      <div
        className={`relative w-full max-h-[94dvh] flex flex-col overflow-hidden bg-[#120d0a] rounded-[1.75rem] border shadow-2xl transition-colors ${
          activeRadio
            ? 'border-[#c9363b]/65'
            : snap.flashlightOn && snap.flashlightBattery > 0
            ? 'border-[#e26d27]/55'
            : 'border-[#e4d4c6]/20'
        } ${isCompactLandscape ? 'max-w-3xl' : 'max-w-[420px]'}`}
      >
        {/* Top Earpiece Speaker Notch */}
        <div className="pt-2 pb-1 flex justify-center shrink-0">
          <div className="w-12 h-1 rounded-full bg-[#2a2019]" />
        </div>

        <div
          ref={phoneBodyRef}
          className={`scroll-touch overflow-y-auto flex-1 ${
            isCompactLandscape ? 'px-4 pb-3.5 pt-1' : 'px-4 sm:px-5 pb-4 pt-1'
          }`}
        >
          {renderStatusBar()}

          {isCompactLandscape ? (
            <div className="mt-2.5 grid grid-cols-12 gap-4 items-start">
              <div className="col-span-5">{renderClockAndControls()}</div>
              <div className="col-span-7">
                {activeTab === 'maps'
                  ? renderMapsApp()
                  : activeTab === 'chat'
                  ? renderChatApp()
                  : renderRadioApp()}
              </div>
            </div>
          ) : (
            <div className="mt-2 space-y-3">
              {renderClockAndControls()}
              <div className="pt-1 border-t border-[#e4d4c6]/14">
                {activeTab === 'maps'
                  ? renderMapsApp()
                  : activeTab === 'chat'
                  ? renderChatApp()
                  : renderRadioApp()}
              </div>
            </div>
          )}
        </div>

        {/* Bottom Home Gesture Bar */}
        <div className="py-2 flex justify-center shrink-0 border-t border-[#e4d4c6]/10">
          <button
            type="button"
            onClick={onClose}
            className="w-24 h-1.5 rounded-full bg-[#382b22] hover:bg-[#e26d27] transition-colors cursor-pointer"
            aria-label="Close Phone"
          />
        </div>
      </div>
    </div>
  );
};
