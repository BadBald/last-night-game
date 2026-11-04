import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import { getGamepadGlyphs, subscribeGamepadUI } from '../engine/input';
import { GamepadBrand, OnlineSessionSnapshot } from '../types';
import { MenuSwallowtailSVG } from './Icons';

interface OnlineLobbyModalProps {
  online: OnlineSessionSnapshot;
  isGamepadActive?: boolean;
  gamepadBrand?: GamepadBrand;
  onClose: () => void;
  onSetCallsign: (name: string) => void;
  onQuickJoin: () => void;
  onLeaveRoom: () => void;
}

const WarmDottedRule: React.FC = () => (
  <svg
    viewBox="0 0 320 4"
    className="w-full h-1 block select-none shrink-0"
    preserveAspectRatio="none"
    aria-hidden="true"
  >
    <line
      x1="2"
      y1="2"
      x2="318"
      y2="2"
      stroke="rgba(190, 44, 50, 0.34)"
      strokeWidth="1.35"
      strokeDasharray="1.4 5.6"
      strokeLinecap="round"
    />
  </svg>
);

export const OnlineLobbyModal: React.FC<OnlineLobbyModalProps> = ({
  online,
  isGamepadActive = false,
  gamepadBrand = 'xbox',
  onClose,
  onSetCallsign,
  onQuickJoin,
  onLeaveRoom,
}) => {
  const gp = getGamepadGlyphs(gamepadBrand);
  const minPlayers = online.minAutoStartPlayers || 2;
  const maxPlayers = online.maxPlayers || 20;
  const count = online.playerCount;
  const secs = Math.max(0, online.countdownSeconds);
  const formattedWait = `00:${String(secs).padStart(2, '0')}`;
  const neededForMin = Math.max(0, minPlayers - count);
  const fillPct = Math.max(0, Math.min(100, (count / maxPlayers) * 100));

  const handleCancelAndClose = () => {
    if (online.roomId) {
      onLeaveRoom();
    }
    onClose();
  };

  useEffect(() => {
    return subscribeGamepadUI((action) => {
      const activeEl = document.activeElement;
      if (activeEl && activeEl.tagName === 'INPUT') {
        if (action === 'ui_cancel') {
          (activeEl as HTMLElement).blur();
        }
        return;
      }
      if (action === 'ui_cancel') {
        if (online.roomId) onLeaveRoom();
        onClose();
      } else if (action === 'ui_confirm' && !online.roomId && online.wsConnected) {
        onQuickJoin();
      }
    });
  }, [online.roomId, online.wsConnected, onLeaveRoom, onClose, onQuickJoin]);

  let statusHeadline = 'Linking to quarantine sector...';
  if (online.roomId) {
    if (count >= maxPlayers) {
      statusHeadline = `Full sector (${count}/${maxPlayers}) · Deploying in ${secs}s`;
    } else if (count >= minPlayers) {
      statusHeadline = `${count} survivors ready · Auto-starting in ${secs}s`;
    } else if (secs > 0) {
      statusHeadline = `Waiting for survivors (${count}/${minPlayers} minimum) · ${secs}s countdown ready`;
    } else {
      statusHeadline = `50s reached · Need ${neededForMin} more survivor${
        neededForMin === 1 ? '' : 's'
      } to launch (${minPlayers} min)`;
    }
  }

  return (
    <div className="fixed inset-0 z-40 bg-[#070504]/86 pointer-events-auto flex items-center justify-center p-3 sm:p-4">
      <div className="w-full max-w-md max-h-[92dvh] flex flex-col overflow-hidden bg-[#120d0a]/96 border border-[#e4d4c6]/18 rounded-2xl shadow-2xl">
        {/* Header */}
        <div className="px-5 pt-5 pb-3.5 shrink-0">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-display text-2xl sm:text-[28px] font-bold tracking-[0.06em] text-[#f7f2e7] leading-none">
                Online Matchmaking
              </h2>
              <p className="mt-1.5 text-[11px] font-mono-num text-[#9c8b79]">
                <span>2–20 Survivors</span>
                <span aria-hidden="true" className="mx-1.5 text-[#6e5f51]">
                  ·
                </span>
                <span>50s Max Wait</span>
                <span aria-hidden="true" className="mx-1.5 text-[#6e5f51]">
                  ·
                </span>
                <span className="text-[#d9383e]">1 Helicopter Seat</span>
              </p>
            </div>

            <button
              type="button"
              onClick={handleCancelAndClose}
              className="min-w-[40px] min-h-[40px] rounded-xl bg-[#1b1410] hover:bg-[#251b15] border border-[#e4d4c6]/16 text-[#d8c7b4] hover:text-[#f7f2e7] flex items-center justify-center cursor-pointer transition-colors"
              aria-label="Cancel Matchmaking"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="mt-4">
            <WarmDottedRule />
          </div>
        </div>

        {/* Body */}
        <div className="scroll-touch overflow-y-auto px-5 pb-5 space-y-5 text-xs flex-1">
          {online.errorMessage && (
            <div className="px-3.5 py-2.5 rounded-xl bg-[#2a120e] border border-[#c94a38]/55 text-[#f7d6cf] text-xs">
              {online.errorMessage}
            </div>
          )}

          {/* Focal Queue Readout: Survivors Count & 50s Timer */}
          <div className="space-y-3">
            <div className="flex items-end justify-between gap-4">
              <div>
                <div className="text-[11px] text-[#9c8b79]">Survivors in Queue</div>
                <div className="mt-0.5 font-display text-4xl font-bold tracking-wider text-[#f7f2e7] font-mono-num leading-none">
                  <span>{count}</span>
                  <span className="text-[#9c8b79] text-2xl"> / {maxPlayers}</span>
                </div>
              </div>

              <div className="text-right">
                <div className="text-[11px] text-[#9c8b79]">Queue Timer</div>
                <div className="mt-0.5 font-display text-4xl font-bold tracking-wider text-[#d9383e] font-mono-num leading-none">
                  {online.roomId ? formattedWait : '--:--'}
                </div>
              </div>
            </div>

            {/* Progress Track with Minimum-Survivor Threshold */}
            <div className="relative h-2 w-full rounded-sm bg-[#1c1011] overflow-hidden">
              <div
                className="h-full bg-[#b8252b] transition-transform duration-200 origin-left"
                style={{ transform: `scaleX(${fillPct / 100})` }}
              />
              <div
                className="absolute inset-y-0 w-[1.5px] bg-[#f7f2e7]/45"
                style={{ left: `${(minPlayers / maxPlayers) * 100}%` }}
                title={`Minimum ${minPlayers} Survivors`}
              />
            </div>

            <div className="flex items-center justify-between gap-2 text-[11px] font-mono-num text-[#d8c7b4]">
              <span>{statusHeadline}</span>
            </div>
          </div>

          <WarmDottedRule />

          {/* Inline Callsign Field */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label
                htmlFor="survivor-callsign-input"
                className="text-[#d8c7b4] font-medium"
              >
                Your Callsign
              </label>
              <span className="text-[11px] font-mono-num text-[#9c8b79]">
                {online.wsConnected ? 'Signal Linked' : 'Connecting...'}
              </span>
            </div>
            <input
              id="survivor-callsign-input"
              type="text"
              maxLength={16}
              value={online.callsign}
              onChange={(e) => onSetCallsign(e.target.value)}
              placeholder="SURVIVOR"
              className="w-full min-h-[42px] px-3.5 rounded-xl bg-[#180e10] border border-[#e4d4c6]/16 focus:border-[#c9363b] text-[#f7f2e7] placeholder-[#6e5f51] font-mono-num text-sm outline-none transition-colors"
            />
          </div>

          {/* Connected Real Players List (Unboxed, No Cards-Within-Cards) */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-[11px] font-mono-num text-[#9c8b79]">
              <span>Matched Survivors ({online.roster.length})</span>
              <span>Min {minPlayers} · Max {maxPlayers}</span>
            </div>

            {online.roster.length === 0 ? (
              <div className="py-3 text-[#9c8b79] font-mono-num text-[11px]">
                {online.wsConnected
                  ? 'Joining active matchmaking sector...'
                  : 'Establishing radio link...'}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 max-h-40 overflow-y-auto scroll-touch pt-1">
                {online.roster.map((p) => {
                  const isMe = p.id === online.selfId;
                  return (
                    <div
                      key={p.id}
                      className="flex items-center gap-2 py-1 border-b border-[#e4d4c6]/10 min-w-0"
                    >
                      <span
                        className="w-2.5 h-2.5 rounded-xs shrink-0"
                        style={{ backgroundColor: p.color }}
                      />
                      <span
                        className={`font-mono-num text-xs truncate ${
                          isMe
                            ? 'text-[#f7f2e7] font-semibold'
                            : 'text-[#d8c7b4]'
                        }`}
                      >
                        {p.callsign}
                        {isMe ? ' (You)' : ''}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

            <p className="text-[11px] text-[#9c8b79] leading-relaxed">
              Survive both <strong className="text-[#f7f2e7]">rival survivors</strong> and{' '}
              <strong className="text-[#f7f2e7]">The Hollow</strong> across the 7-hour night.
              Flight Echo-7 carries <strong className="text-[#d9383e]">only one extraction seat</strong> at 6:00 AM.
            </p>

            {/* Footer Action */}
            <div className="pt-1 flex items-center gap-2.5">
              {!online.roomId && online.wsConnected && (
                <button
                  type="button"
                  onClick={onQuickJoin}
                  className="flex-1 min-h-[44px] px-4 py-2.5 rounded-xl bg-[#9f1d22] hover:bg-[#b8252b] text-[#f8eded] font-semibold text-xs sm:text-sm transition-colors whitespace-nowrap cursor-pointer"
                >
                  Rejoin Queue
                </button>
              )}

              <button
                type="button"
                onClick={handleCancelAndClose}
                className="group flex-1 min-h-[44px] px-4 py-2.5 rounded-xl bg-[#180e10] hover:bg-[#241316] border border-[#c9363b]/35 text-[#d9383e] hover:text-[#f8eded] font-semibold text-xs sm:text-sm flex items-center justify-center gap-2.5 transition-colors whitespace-nowrap cursor-pointer"
              >
              <MenuSwallowtailSVG
                direction="right"
                className="w-3.5 h-2 text-current opacity-80 group-hover:opacity-100 transition-opacity"
              />
              <span>
                Cancel Matchmaking{isGamepadActive ? ` [${gp.east}]` : ''}
              </span>
              <MenuSwallowtailSVG
                direction="left"
                className="w-3.5 h-2 text-current opacity-80 group-hover:opacity-100 transition-opacity"
              />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
