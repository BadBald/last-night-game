import React, { useEffect, useMemo, useState } from 'react';
import { Gamepad2, Maximize2, Minimize2, X } from 'lucide-react';
import { getGamepadGlyphs, subscribeGamepadUI } from '../engine/input';
import { GameSettings, OverlayPanel, UISnapshot } from '../types';
import { LastNightTitleSVG, MenuSwallowtailSVG } from './Icons';
import { OnlineLobbyModal } from './OnlineLobbyModal';
import { PWAInstallButton } from './PWAInstallButton';
import { useViewportLayout } from './useViewportLayout';

interface ScreensProps {
  snap: UISnapshot;
  isFullscreen: boolean;
  fullscreenHint: string | null;
  onToggleFullscreen: () => void;
  onStartNewGame: () => void;
  onOpenOnlineMatchmaking: () => void;
  onSetOnlineCallsign: (name: string) => void;
  onQuickJoinOnline: () => void;
  onLeaveOnlineRoom: () => void;
  onReturnToTitle: () => void;
  onSetPanel: (panel: OverlayPanel) => void;
  onTogglePause: () => void;
  onUpdateSettings: (partial: Partial<GameSettings>) => void;
  onMenuTick: () => void;
}

const DottedRule: React.FC<{ crimson?: boolean }> = ({ crimson = false }) => (
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
      stroke={crimson ? 'rgba(190, 44, 50, 0.38)' : 'rgba(228, 212, 198, 0.26)'}
      strokeWidth="1.35"
      strokeDasharray="1.4 5.6"
      strokeLinecap="round"
    />
  </svg>
);

const TitleMenuScreen: React.FC<{
  snap: UISnapshot;
  isFullscreen: boolean;
  fullscreenHint: string | null;
  isCompactLandscape: boolean;
  onToggleFullscreen: () => void;
  onStartNewGame: () => void;
  onOpenOnlineMatchmaking: () => void;
  onSetOnlineCallsign: (name: string) => void;
  onQuickJoinOnline: () => void;
  onLeaveOnlineRoom: () => void;
  onSetPanel: (panel: OverlayPanel) => void;
  onUpdateSettings: (partial: Partial<GameSettings>) => void;
  onMenuTick: () => void;
}> = ({
  snap,
  isFullscreen,
  fullscreenHint,
  isCompactLandscape,
  onToggleFullscreen,
  onStartNewGame,
  onOpenOnlineMatchmaking,
  onSetOnlineCallsign,
  onQuickJoinOnline,
  onLeaveOnlineRoom,
  onSetPanel,
  onUpdateSettings,
  onMenuTick,
}) => {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const gp = getGamepadGlyphs(snap.gamepadBrand);

  const menuItems = useMemo(
    () => [
      {
        id: 'online',
        label: 'ONLINE MATCH',
        onSelect: onOpenOnlineMatchmaking,
      },
      { id: 'new', label: 'SOLO NIGHT', onSelect: onStartNewGame },
      {
        id: 'options',
        label: 'OPTIONS',
        onSelect: () => onSetPanel('SETTINGS'),
      },
      {
        id: 'guide',
        label: 'FIELD GUIDE',
        onSelect: () => onSetPanel('CREDITS'),
      },
      {
        id: 'records',
        label: 'VIEW RECORDS',
        onSelect: () => onSetPanel('CONTINUE_DOSSIER'),
      },
    ],
    [onOpenOnlineMatchmaking, onStartNewGame, onSetPanel]
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (snap.panel !== 'NONE') {
        if (e.code === 'Escape') {
          e.preventDefault();
          if (snap.panel === 'ONLINE_LOBBY' && snap.online.roomId) {
            onLeaveOnlineRoom();
          }
          onSetPanel('NONE');
        }
        return;
      }

      if (e.code === 'ArrowDown' || e.code === 'KeyS') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % menuItems.length);
        onMenuTick();
      } else if (e.code === 'ArrowUp' || e.code === 'KeyW') {
        e.preventDefault();
        setSelectedIndex(
          (prev) => (prev - 1 + menuItems.length) % menuItems.length
        );
        onMenuTick();
      } else if (e.code === 'Enter' || e.code === 'Space') {
        const activeEl = document.activeElement;
        if (activeEl && activeEl.tagName === 'BUTTON') return;
        e.preventDefault();
        menuItems[selectedIndex]?.onSelect();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    snap.panel,
    snap.online.roomId,
    menuItems,
    selectedIndex,
    onSetPanel,
    onLeaveOnlineRoom,
    onMenuTick,
  ]);

  // Controller Navigation on Title Menu
  useEffect(() => {
    if (snap.panel !== 'NONE') return;
    return subscribeGamepadUI((action) => {
      if (action === 'nav_down') {
        setSelectedIndex((prev) => (prev + 1) % menuItems.length);
        onMenuTick();
      } else if (action === 'nav_up') {
        setSelectedIndex(
          (prev) => (prev - 1 + menuItems.length) % menuItems.length
        );
        onMenuTick();
      } else if (action === 'ui_confirm' || action === 'ui_start') {
        menuItems[selectedIndex]?.onSelect();
      } else if (action === 'ui_west') {
        onUpdateSettings({ muted: !snap.settings.muted });
      } else if (action === 'ui_north') {
        onToggleFullscreen();
      }
    });
  }, [
    snap.panel,
    snap.settings.muted,
    menuItems,
    selectedIndex,
    onMenuTick,
    onUpdateSettings,
    onToggleFullscreen,
  ]);

  return (
    <div
      className={`fixed inset-0 z-20 pointer-events-none flex flex-col justify-between overflow-y-auto scroll-touch bg-gradient-to-r from-[#0b0203]/84 via-[#090203]/42 to-transparent ${
        isCompactLandscape
          ? 'safe-area-landscape-hud px-6 sm:px-12 py-2.5'
          : 'safe-area-hud px-6 sm:px-14 md:px-20 lg:px-28 py-6 sm:py-10'
      }`}
    >
      {/* Left-Anchored Dark Crimson Emblem & Unboxed Menu Column */}
      <div
        className={`pointer-events-auto flex flex-col justify-between h-full ${
          isCompactLandscape
            ? 'w-full max-w-[260px]'
            : 'w-full max-w-[290px] sm:max-w-[336px]'
        }`}
      >
        {/* Top Block: Stacked Dark-Crimson Wordmark + Upper Dotted Rule */}
        <div className={isCompactLandscape ? 'pt-0.5' : 'pt-2 sm:pt-6'}>
          <div
            className={`mx-auto ${
              isCompactLandscape
                ? 'w-[178px]'
                : 'w-[236px] sm:w-[292px]'
            }`}
          >
            <LastNightTitleSVG />
          </div>

          <div className={isCompactLandscape ? 'mt-2.5' : 'mt-5 sm:mt-8'}>
            <DottedRule crimson />
          </div>
        </div>

        {/* Center Block: Unboxed Dark-Red Typographic Menu With Symmetric Swallowtail Pointers */}
        <nav
          aria-label="Main Menu"
          className={`flex flex-col items-center ${
            isCompactLandscape ? 'gap-0.5 my-1.5' : 'gap-1.5 sm:gap-2 my-6'
          }`}
        >
          {menuItems.map((item, idx) => {
            const isSelected = selectedIndex === idx;
            return (
              <button
                key={item.id}
                type="button"
                onPointerEnter={() => {
                  if (selectedIndex !== idx) {
                    setSelectedIndex(idx);
                    onMenuTick();
                  }
                }}
                onFocus={() => {
                  if (selectedIndex !== idx) {
                    setSelectedIndex(idx);
                    onMenuTick();
                  }
                }}
                onClick={item.onSelect}
                className={`group w-full flex items-center justify-center gap-3 rounded transition-colors duration-150 cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-[#e0484d]/60 whitespace-nowrap ${
                  isCompactLandscape
                    ? 'min-h-[36px] py-1 text-[13px] tracking-[0.18em]'
                    : 'min-h-[44px] py-1.5 text-sm sm:text-[16px] tracking-[0.2em]'
                } font-semibold ${
                  isSelected
                    ? 'text-[#f8eded]'
                    : 'text-[#c9363b] hover:text-[#f8eded]'
                }`}
              >
                <MenuSwallowtailSVG
                  direction="right"
                  className={`w-4 h-2.5 text-[#d9383e] transition-all duration-150 ${
                    isSelected
                      ? 'opacity-100 translate-x-0'
                      : 'opacity-0 -translate-x-1'
                  }`}
                />
                <span>{item.label}</span>
                <MenuSwallowtailSVG
                  direction="left"
                  className={`w-4 h-2.5 text-[#d9383e] transition-all duration-150 ${
                    isSelected
                      ? 'opacity-100 translate-x-0'
                      : 'opacity-0 translate-x-1'
                  }`}
                />
              </button>
            );
          })}
        </nav>

        {/* Bottom Block: Lower Crimson Dotted Rule + Dark-Red Corner Controls */}
        <div className={isCompactLandscape ? 'pb-0.5' : 'pb-1 sm:pb-2'}>
          {fullscreenHint && (
            <p className="mb-2 text-[11px] text-[#e88c8f] text-center leading-snug">
              {fullscreenHint}
            </p>
          )}

          {snap.isGamepadConnected && (
            <div className="mb-2 flex items-center justify-center gap-1.5 text-[11px] font-mono-num text-[#d9383e]">
              <Gamepad2 className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">
                {snap.isGamepadActive
                  ? `[${gp.south}] Select · [${gp.west}] Sound · [${gp.north}] Screen`
                  : `${snap.gamepadName || 'Controller'} Ready`}
              </span>
            </div>
          )}

          <DottedRule crimson />

          <div
            className={`flex items-center justify-between text-[11px] sm:text-xs font-medium text-[#b83237] ${
              isCompactLandscape ? 'mt-1.5' : 'mt-3 sm:mt-4'
            }`}
          >
            <button
              type="button"
              onClick={() => onUpdateSettings({ muted: !snap.settings.muted })}
              className="min-h-[36px] pr-2 flex items-center hover:text-[#f8eded] transition-colors whitespace-nowrap cursor-pointer"
              aria-label={snap.settings.muted ? 'Unmute audio' : 'Mute audio'}
            >
              {snap.settings.muted ? 'Sound: Off' : 'Sound: On'}
            </button>

            <button
              type="button"
              onClick={onToggleFullscreen}
              className="min-h-[36px] pl-2 flex items-center hover:text-[#f8eded] transition-colors whitespace-nowrap cursor-pointer"
              aria-label={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
            >
              {isFullscreen ? 'Windowed' : 'Full Screen'}
            </button>
          </div>
        </div>
      </div>

      {snap.panel === 'ONLINE_LOBBY' && (
        <OnlineLobbyModal
          online={snap.online}
          isGamepadActive={snap.isGamepadActive}
          gamepadBrand={snap.gamepadBrand}
          onClose={() => onSetPanel('NONE')}
          onSetCallsign={onSetOnlineCallsign}
          onQuickJoin={onQuickJoinOnline}
          onLeaveRoom={onLeaveOnlineRoom}
        />
      )}
      {snap.panel === 'CONTINUE_DOSSIER' && (
        <ContinueDossierModal
          snap={snap}
          onClose={() => onSetPanel('NONE')}
          onStartNewGame={onStartNewGame}
        />
      )}
      {snap.panel === 'SETTINGS' && (
        <SettingsModal
          settings={snap.settings}
          isFullscreen={isFullscreen}
          isGamepadActive={snap.isGamepadActive}
          gamepadBrand={snap.gamepadBrand}
          onToggleFullscreen={onToggleFullscreen}
          onUpdate={onUpdateSettings}
          onClose={() => onSetPanel('NONE')}
        />
      )}
      {snap.panel === 'CREDITS' && (
        <CreditsModal
          isTouchDevice={snap.isTouchDevice}
          isGamepadConnected={snap.isGamepadConnected}
          gamepadBrand={snap.gamepadBrand}
          onClose={() => onSetPanel('NONE')}
        />
      )}
    </div>
  );
};

const PauseModal: React.FC<{
  snap: UISnapshot;
  isFullscreen: boolean;
  isCompactLandscape: boolean;
  onTogglePause: () => void;
  onToggleFullscreen: () => void;
  onSetPanel: (panel: OverlayPanel) => void;
  onStartNewGame: () => void;
  onReturnToTitle: () => void;
  onUpdateSettings: (partial: Partial<GameSettings>) => void;
  onMenuTick: () => void;
}> = ({
  snap,
  isFullscreen,
  isCompactLandscape,
  onTogglePause,
  onToggleFullscreen,
  onSetPanel,
  onStartNewGame,
  onReturnToTitle,
  onUpdateSettings,
  onMenuTick,
}) => {
  const [focusIdx, setFocusIdx] = useState(0);
  const gp = getGamepadGlyphs(snap.gamepadBrand);
  const padActive = snap.isGamepadActive;

  const actions = useMemo(() => {
    const list = [
      { id: 'resume', label: 'Resume Night', run: onTogglePause },
      {
        id: 'fullscreen',
        label: isFullscreen ? 'Exit Full Screen' : 'Enter Full Screen',
        run: onToggleFullscreen,
      },
      {
        id: 'options',
        label: 'Options & Audio',
        run: () => onSetPanel('SETTINGS'),
      },
    ];
    if (!snap.online.isOnlineMode) {
      list.push({
        id: 'restart',
        label: 'Restart Solo Night',
        run: onStartNewGame,
      });
    }
    list.push({
      id: 'menu',
      label: 'Main Menu',
      run: onReturnToTitle,
    });
    return list;
  }, [
    isFullscreen,
    snap.online.isOnlineMode,
    onTogglePause,
    onToggleFullscreen,
    onSetPanel,
    onStartNewGame,
    onReturnToTitle,
  ]);

  useEffect(() => {
    if (snap.panel !== 'NONE') return;
    return subscribeGamepadUI((action) => {
      if (action === 'ui_cancel') {
        onTogglePause();
      } else if (action === 'nav_down') {
        setFocusIdx((prev) => (prev + 1) % actions.length);
        onMenuTick();
      } else if (action === 'nav_up') {
        setFocusIdx((prev) => (prev - 1 + actions.length) % actions.length);
        onMenuTick();
      } else if (action === 'ui_confirm') {
        actions[focusIdx]?.run();
      }
    });
  }, [snap.panel, actions, focusIdx, onTogglePause, onMenuTick]);

  return (
    <div className="fixed inset-0 z-30 bg-[#070504]/85 flex items-center justify-center p-2.5 sm:p-4">
      <div
        className={`w-full max-h-[94dvh] overflow-y-auto scroll-touch bg-[#120d0a]/96 border border-[#e4d4c6]/18 rounded-2xl shadow-2xl ${
          isCompactLandscape ? 'max-w-lg p-4' : 'max-w-md p-5 sm:p-6'
        }`}
      >
        <h2
          className={`font-display font-bold tracking-[0.06em] text-[#f7f2e7] ${
            isCompactLandscape ? 'text-2xl' : 'text-3xl'
          }`}
        >
          {snap.online.isOnlineMode ? 'Online Sector Menu' : 'Night Paused'}
        </h2>
        <p className="mt-1 text-xs text-[#9c8b79] font-mono-num">
          {snap.clockFormatted} · {snap.districtName} · Dawn in {snap.countdownFormatted}
        </p>
        {snap.online.isOnlineMode && (
          <p className="mt-1 text-[11px] text-[#e26d27] font-mono-num">
            LIVE PvPvE ({snap.online.aliveCount}/{snap.online.totalParticipants} Alive) — Night continues in real time
          </p>
        )}

        <div className="my-4">
          <DottedRule />
        </div>

        <div className={isCompactLandscape ? 'space-y-2' : 'flex flex-col gap-2.5'}>
          {actions.map((act, idx) => {
            const isPrimary = idx === 0;
            const isFocused = padActive && focusIdx === idx;
            return (
              <button
                key={act.id}
                type="button"
                onPointerEnter={() => setFocusIdx(idx)}
                onClick={act.run}
                className={
                  isPrimary
                    ? `group w-full min-h-[46px] py-2.5 px-4 rounded-xl bg-[#e26d27] hover:bg-[#f07c34] text-[#120d0a] text-sm font-semibold flex items-center justify-center gap-2.5 transition-colors whitespace-nowrap cursor-pointer ${
                        isFocused ? 'ring-2 ring-[#f7f2e7]' : ''
                      }`
                    : `min-h-[44px] py-2 px-3 rounded-xl border text-xs sm:text-sm font-medium flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap cursor-pointer ${
                        isFocused
                          ? 'bg-[#281e17] border-[#e26d27] text-[#f7f2e7]'
                          : 'bg-[#19130f] hover:bg-[#231a14] border-[#e4d4c6]/15 text-[#d8c7b4] hover:text-[#f7f2e7]'
                      }`
                }
              >
                {isPrimary && (
                  <MenuSwallowtailSVG direction="right" className="w-3.5 h-2 text-[#120d0a]" />
                )}
                {act.id === 'fullscreen' &&
                  (isFullscreen ? (
                    <Minimize2 className="w-4 h-4 text-[#e26d27] shrink-0" />
                  ) : (
                    <Maximize2 className="w-4 h-4 text-[#e26d27] shrink-0" />
                  ))}
                <span>
                  {act.label}
                  {isFocused ? ` [${gp.south}]` : ''}
                </span>
                {isPrimary && (
                  <MenuSwallowtailSVG direction="left" className="w-3.5 h-2 text-[#120d0a]" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {snap.panel === 'SETTINGS' && (
        <SettingsModal
          settings={snap.settings}
          isFullscreen={isFullscreen}
          isGamepadActive={snap.isGamepadActive}
          gamepadBrand={snap.gamepadBrand}
          onToggleFullscreen={onToggleFullscreen}
          onUpdate={onUpdateSettings}
          onClose={() => onSetPanel('NONE')}
        />
      )}
    </div>
  );
};

const EndScreenModal: React.FC<{
  snap: UISnapshot;
  onStartNewGame: () => void;
  onReturnToTitle: () => void;
  onOpenOnlineMatchmaking: () => void;
}> = ({ snap, onStartNewGame, onReturnToTitle, onOpenOnlineMatchmaking }) => {
  const [focusedBtn, setFocusedBtn] = useState<0 | 1>(0);
  const gp = getGamepadGlyphs(snap.gamepadBrand);
  const padActive = snap.isGamepadActive;

  const isWin = snap.screen === 'VICTORY';
  const isMissed = snap.screen === 'MISSED_EXTRACTION';
  const rs = snap.runStats;
  const accuracy =
    rs.shotsFired > 0 ? Math.round((rs.shotsHit / rs.shotsFired) * 100) : 0;

  useEffect(() => {
    return subscribeGamepadUI((action) => {
      if (action === 'nav_left' || action === 'nav_right') {
        setFocusedBtn((prev) => (prev === 0 ? 1 : 0));
      } else if (action === 'ui_cancel') {
        onReturnToTitle();
      } else if (action === 'ui_confirm') {
        if (focusedBtn === 1) {
          onReturnToTitle();
        } else if (rs.isOnlineMatch) {
          onReturnToTitle();
          onOpenOnlineMatchmaking();
        } else {
          onStartNewGame();
        }
      }
    });
  }, [
    focusedBtn,
    rs.isOnlineMatch,
    onStartNewGame,
    onReturnToTitle,
    onOpenOnlineMatchmaking,
  ]);

  return (
    <div className="fixed inset-0 z-30 bg-[#070504]/90 flex items-center justify-center p-3 sm:p-4">
      <div className="w-full max-w-lg max-h-[92dvh] overflow-y-auto scroll-touch bg-[#120d0a]/96 border border-[#e4d4c6]/18 rounded-2xl p-5 sm:p-8 shadow-2xl">
        <div className="text-xs font-mono-num text-[#9c8b79]">
          {isWin
            ? `06:00 AM · ${rs.extractionSiteName.toUpperCase()}`
            : isMissed
            ? `06:00 AM · ${rs.extractionSiteName.toUpperCase()} DEPARTED`
            : `${rs.finalTimeFormatted} · PERMADEATH`}
        </div>

        <h2
          className={`mt-1 font-display text-3xl sm:text-4xl font-bold tracking-[0.05em] ${
            isWin ? 'text-[#f3a85b]' : 'text-[#d95338]'
          }`}
        >
          {isWin
            ? 'EXTRACTION COMPLETE'
            : isMissed
            ? 'LEFT BEHIND AT DAWN'
            : 'YOU DID NOT SURVIVE'}
        </h2>

        <p className="mt-2 text-xs sm:text-sm text-[#d8c7b4] leading-relaxed">
          {rs.causeOfDeath}
        </p>

        <div className="my-4">
          <DottedRule />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-2.5 gap-x-6 text-xs font-mono-num">
          <StatRow label="Assigned LZ" value={rs.extractionSiteName} />
          <StatRow label="Final Clock" value={rs.finalTimeFormatted} />
          <StatRow
            label="Real Time Survived"
            value={`${Math.floor(rs.survivedSeconds / 60)}m ${Math.floor(
              rs.survivedSeconds % 60
            )}s`}
          />
          {rs.isOnlineMatch && rs.placement !== undefined && (
            <StatRow
              label="Sector Placement"
              value={`#${rs.placement} of ${rs.totalParticipants ?? 1}`}
            />
          )}
          {rs.isOnlineMatch && (
            <StatRow
              label="Rival Survivors Slain"
              value={String(rs.pvpKills ?? 0)}
            />
          )}
          {rs.isOnlineMatch && (
            <StatRow
              label="Echo-7 Sole Seat"
              value={rs.winnerCallsign || 'No Survivor Aboard'}
            />
          )}
          <StatRow label="Hollow Eliminated" value={String(rs.enemiesKilled)} />
          <StatRow
            label="Containers Scavenged"
            value={String(rs.containersSearched)}
          />
          <StatRow
            label="Firearm Accuracy"
            value={`${accuracy}% (${rs.shotsHit}/${rs.shotsFired})`}
          />
          <StatRow
            label="Distance Covered"
            value={`${Math.round(rs.distanceTraveledMeters)} m`}
          />
        </div>

        <div className="mt-6 flex items-center gap-3">
          {rs.isOnlineMatch ? (
            <button
              type="button"
              onClick={() => {
                onReturnToTitle();
                onOpenOnlineMatchmaking();
              }}
              className={`flex-1 min-h-[48px] py-3 px-4 rounded-xl bg-[#e26d27] hover:bg-[#f07c34] text-[#120d0a] text-sm font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                padActive && focusedBtn === 0 ? 'ring-2 ring-[#f7f2e7]' : ''
              }`}
            >
              Queue Next Online Match
              {padActive && focusedBtn === 0 ? ` [${gp.south}]` : ''}
            </button>
          ) : (
            <button
              type="button"
              onClick={onStartNewGame}
              className={`flex-1 min-h-[48px] py-3 px-4 rounded-xl bg-[#e26d27] hover:bg-[#f07c34] text-[#120d0a] text-sm font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                padActive && focusedBtn === 0 ? 'ring-2 ring-[#f7f2e7]' : ''
              }`}
            >
              Play Again{padActive && focusedBtn === 0 ? ` [${gp.south}]` : ''}
            </button>
          )}
          <button
            type="button"
            onClick={onReturnToTitle}
            className={`min-h-[48px] py-3 px-4 rounded-xl border text-sm font-medium transition-colors whitespace-nowrap cursor-pointer ${
              padActive && focusedBtn === 1
                ? 'bg-[#281e17] border-[#e26d27] text-[#f7f2e7]'
                : 'bg-[#19130f] hover:bg-[#231a14] border-[#e4d4c6]/16 text-[#d8c7b4] hover:text-[#f7f2e7]'
            }`}
          >
            Main Menu{padActive ? ` [${gp.east}]` : ''}
          </button>
        </div>
      </div>
    </div>
  );
};

export const Screens: React.FC<ScreensProps> = ({
  snap,
  isFullscreen,
  fullscreenHint,
  onToggleFullscreen,
  onStartNewGame,
  onOpenOnlineMatchmaking,
  onSetOnlineCallsign,
  onQuickJoinOnline,
  onLeaveOnlineRoom,
  onReturnToTitle,
  onSetPanel,
  onTogglePause,
  onUpdateSettings,
  onMenuTick,
}) => {
  const { isCompactLandscape } = useViewportLayout();

  // 1. TITLE SCREEN OVER NOCTURNAL STARRY WOODLAND & QUARANTINE CITY
  if (snap.screen === 'TITLE') {
    return (
      <TitleMenuScreen
        snap={snap}
        isFullscreen={isFullscreen}
        fullscreenHint={fullscreenHint}
        isCompactLandscape={isCompactLandscape}
        onToggleFullscreen={onToggleFullscreen}
        onStartNewGame={onStartNewGame}
        onOpenOnlineMatchmaking={onOpenOnlineMatchmaking}
        onSetOnlineCallsign={onSetOnlineCallsign}
        onQuickJoinOnline={onQuickJoinOnline}
        onLeaveOnlineRoom={onLeaveOnlineRoom}
        onSetPanel={onSetPanel}
        onUpdateSettings={onUpdateSettings}
        onMenuTick={onMenuTick}
      />
    );
  }

  // 2. PAUSE MODAL
  if (snap.screen === 'PAUSED') {
    return (
      <PauseModal
        snap={snap}
        isFullscreen={isFullscreen}
        isCompactLandscape={isCompactLandscape}
        onTogglePause={onTogglePause}
        onToggleFullscreen={onToggleFullscreen}
        onSetPanel={onSetPanel}
        onStartNewGame={onStartNewGame}
        onReturnToTitle={onReturnToTitle}
        onUpdateSettings={onUpdateSettings}
        onMenuTick={onMenuTick}
      />
    );
  }

  // 3. DEATH / VICTORY / MISSED EXTRACTION END SCREENS
  if (
    snap.screen === 'DEATH' ||
    snap.screen === 'VICTORY' ||
    snap.screen === 'MISSED_EXTRACTION'
  ) {
    return (
      <EndScreenModal
        snap={snap}
        onStartNewGame={onStartNewGame}
        onReturnToTitle={onReturnToTitle}
        onOpenOnlineMatchmaking={onOpenOnlineMatchmaking}
      />
    );
  }

  return null;
};

const StatRow: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex items-center justify-between border-b border-[#e4d4c6]/12 pb-1.5 gap-2">
    <span className="text-[#9c8b79] font-sans shrink-0">{label}</span>
    <span className="text-[#f7f2e7] font-semibold truncate">{value}</span>
  </div>
);

const ContinueDossierModal: React.FC<{
  snap: UISnapshot;
  onClose: () => void;
  onStartNewGame: () => void;
}> = ({ snap, onClose, onStartNewGame }) => {
  const rec = snap.records;
  const gp = getGamepadGlyphs(snap.gamepadBrand);
  const padActive = snap.isGamepadActive;
  const bestMins = Math.floor(rec.longestSurvivalSeconds / 60);
  const bestSecs = Math.floor(rec.longestSurvivalSeconds % 60);

  useEffect(() => {
    return subscribeGamepadUI((action) => {
      if (action === 'ui_cancel') onClose();
      else if (action === 'ui_confirm') onStartNewGame();
    });
  }, [onClose, onStartNewGame]);

  return (
    <div className="fixed inset-0 z-30 bg-[#070504]/86 pointer-events-auto flex items-center justify-center p-3 sm:p-4">
      <div className="w-full max-w-lg max-h-[92dvh] overflow-y-auto scroll-touch bg-[#120d0a]/96 border border-[#e4d4c6]/18 rounded-2xl p-5 sm:p-6 shadow-2xl">
        <div className="flex items-center justify-between pb-3">
          <h2 className="font-display text-2xl font-bold tracking-[0.06em] text-[#f7f2e7]">
            Survivor Records
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="min-w-[42px] min-h-[42px] rounded-xl bg-[#19130f] hover:bg-[#231a14] border border-[#e4d4c6]/16 text-[#d8c7b4] hover:text-[#f7f2e7] flex items-center justify-center cursor-pointer transition-colors"
            aria-label="Close Records"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <DottedRule />

        <p className="mt-3.5 text-xs text-[#9c8b79] leading-relaxed">
          Permadeath is strictly enforced—active runs are never saved or restored. Every night begins anew at 11:00 PM in Oakhaven Countryside Village with a randomized 6:00 AM airlift destination.
        </p>

        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs font-mono-num">
          <StatRow label="Nights Attempted" value={String(rec.totalRuns)} />
          <StatRow label="6:00 AM Extractions" value={String(rec.extractions)} />
          <StatRow label="Longest Survival" value={`${bestMins}m ${bestSecs}s`} />
          <StatRow label="Total Hollow Slain" value={String(rec.totalHollowSlain)} />
        </div>

        {rec.lastRun && (
          <div className="mt-4 pt-3 border-t border-[#e4d4c6]/14 text-xs">
            <div className="text-[#9c8b79] font-mono-num">
              Previous Night · {rec.lastRun.finalTimeFormatted} · LZ: {rec.lastRun.extractionSiteName}
            </div>
            <div className="text-[#d8c7b4] mt-1 font-medium">
              {rec.lastRun.causeOfDeath}
            </div>
          </div>
        )}

        <div className="mt-5 pt-3 border-t border-[#e4d4c6]/14 flex items-center justify-between gap-3">
          <span className="text-[#d8c7b4] text-xs font-medium">
            Install as App (no Chrome needed)
          </span>
          <PWAInstallButton compact />
        </div>

        <div className="mt-6 flex items-center gap-3">
          <button
            type="button"
            onClick={onStartNewGame}
            className="flex-1 min-h-[46px] py-2.5 px-4 rounded-xl bg-[#9f1d22] hover:bg-[#b8252b] text-[#f8eded] text-xs font-semibold whitespace-nowrap cursor-pointer transition-colors"
          >
            Start Solo Night{padActive ? ` [${gp.south}]` : ''}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[46px] py-2.5 px-4 rounded-xl bg-[#19130f] hover:bg-[#231a14] border border-[#e4d4c6]/16 text-[#d8c7b4] hover:text-[#f7f2e7] text-xs font-medium whitespace-nowrap cursor-pointer transition-colors"
          >
            Close{padActive ? ` [${gp.east}]` : ''}
          </button>
        </div>
      </div>
    </div>
  );
};

const SettingsModal: React.FC<{
  settings: GameSettings;
  isFullscreen: boolean;
  isGamepadActive?: boolean;
  gamepadBrand?: UISnapshot['gamepadBrand'];
  onToggleFullscreen: () => void;
  onUpdate: (partial: Partial<GameSettings>) => void;
  onClose: () => void;
}> = ({
  settings,
  isFullscreen,
  isGamepadActive = false,
  gamepadBrand = 'xbox',
  onToggleFullscreen,
  onUpdate,
  onClose,
}) => {
  const [focusedRow, setFocusedRow] = useState(0);
  const gp = getGamepadGlyphs(gamepadBrand);
  const totalRows = 12;

  useEffect(() => {
    return subscribeGamepadUI((action) => {
      if (action === 'ui_cancel') {
        onClose();
        return;
      }
      if (action === 'nav_down') {
        setFocusedRow((r) => (r + 1) % totalRows);
        return;
      }
      if (action === 'nav_up') {
        setFocusedRow((r) => (r - 1 + totalRows) % totalRows);
        return;
      }

      const stepSlider = (cur: number, delta: number) =>
        Math.round(Math.max(0, Math.min(1, cur + delta)) * 100) / 100;

      if (action === 'nav_left' || action === 'nav_right') {
        const delta = action === 'nav_right' ? 0.05 : -0.05;
        switch (focusedRow) {
          case 0:
            onUpdate({ masterVolume: stepSlider(settings.masterVolume, delta) });
            break;
          case 1:
            onUpdate({
              radioVolume: stepSlider(settings.radioVolume ?? 0.95, delta),
            });
            break;
          case 2:
            onUpdate({ musicVolume: stepSlider(settings.musicVolume, delta) });
            break;
          case 3:
            onUpdate({ sfxVolume: stepSlider(settings.sfxVolume, delta) });
            break;
          case 4:
            onUpdate({
              ambientVolume: stepSlider(settings.ambientVolume, delta),
            });
            break;
          case 10: {
            const modes: ('auto' | 'on' | 'off')[] = ['auto', 'on', 'off'];
            const idx = modes.indexOf(settings.mobileControlsMode);
            const nextIdx =
              (idx + (action === 'nav_right' ? 1 : -1) + modes.length) %
              modes.length;
            onUpdate({ mobileControlsMode: modes[nextIdx] });
            break;
          }
          default:
            break;
        }
        return;
      }

      if (action === 'ui_confirm') {
        switch (focusedRow) {
          case 5:
            onUpdate({ muted: !settings.muted });
            break;
          case 6:
            onUpdate({
              controllerVibration: !(settings.controllerVibration ?? true),
            });
            break;
          case 7:
            onToggleFullscreen();
            break;
          case 8:
            onUpdate({ screenShake: !settings.screenShake });
            break;
          case 9:
            onUpdate({ showAcousticRings: !settings.showAcousticRings });
            break;
          case 10: {
            const modes: ('auto' | 'on' | 'off')[] = ['auto', 'on', 'off'];
            const idx = modes.indexOf(settings.mobileControlsMode);
            onUpdate({ mobileControlsMode: modes[(idx + 1) % modes.length] });
            break;
          }
          case 11:
            onClose();
            break;
          default:
            break;
        }
      }
    });
  }, [focusedRow, settings, onUpdate, onToggleFullscreen, onClose]);

  const rowCls = (idx: number) =>
    isGamepadActive && focusedRow === idx
      ? 'rounded-lg bg-[#1d1410] px-2 py-1 -mx-2'
      : '';

  return (
    <div className="fixed inset-0 z-40 bg-[#070504]/86 pointer-events-auto flex items-center justify-center p-3 sm:p-4">
      <div className="w-full max-w-md max-h-[92dvh] flex flex-col overflow-hidden bg-[#120d0a]/96 border border-[#e4d4c6]/18 rounded-2xl shadow-2xl">
        <div className="px-5 pt-5 pb-3.5 shrink-0">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-2xl font-bold tracking-[0.06em] text-[#f7f2e7]">
              Options
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="min-w-[42px] min-h-[42px] rounded-xl bg-[#19130f] hover:bg-[#231a14] border border-[#e4d4c6]/16 text-[#d8c7b4] hover:text-[#f7f2e7] flex items-center justify-center cursor-pointer transition-colors"
              aria-label="Close Options"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="mt-3.5">
            <DottedRule />
          </div>
        </div>

        <div className="scroll-touch overflow-y-auto px-5 pb-5 space-y-3.5 text-xs flex-1">
          <div className={rowCls(0)}>
            <SliderRow
              label="Master Volume"
              value={settings.masterVolume}
              onChange={(v) => onUpdate({ masterVolume: v })}
            />
          </div>
          <div className={rowCls(1)}>
            <SliderRow
              label="Radio Broadcast Voice"
              value={settings.radioVolume ?? 0.95}
              onChange={(v) => onUpdate({ radioVolume: v })}
            />
          </div>
          <div className={rowCls(2)}>
            <SliderRow
              label="Main Music"
              value={settings.musicVolume}
              onChange={(v) => onUpdate({ musicVolume: v })}
            />
          </div>
          <div className={rowCls(3)}>
            <SliderRow
              label="Sound Effects"
              value={settings.sfxVolume}
              onChange={(v) => onUpdate({ sfxVolume: v })}
            />
          </div>
          <div className={rowCls(4)}>
            <SliderRow
              label="Rain & Atmosphere"
              value={settings.ambientVolume}
              onChange={(v) => onUpdate({ ambientVolume: v })}
            />
          </div>

          <div
            className={`flex items-center justify-between pt-3 border-t border-[#e4d4c6]/14 ${rowCls(
              5
            )}`}
          >
            <span className="text-[#d8c7b4] font-medium">Mute All Audio</span>
            <button
              type="button"
              onClick={() => onUpdate({ muted: !settings.muted })}
              className={`min-h-[40px] px-3.5 py-1.5 rounded-xl font-semibold cursor-pointer transition-colors ${
                settings.muted
                  ? 'bg-[#c94a38] text-[#f7f2e7]'
                  : 'bg-[#19130f] border border-[#e4d4c6]/16 text-[#d8c7b4]'
              }`}
            >
              {settings.muted ? 'Muted' : 'Active'}
            </button>
          </div>

          <div className={`flex items-center justify-between ${rowCls(6)}`}>
            <span className="text-[#d8c7b4] font-medium">Controller Vibration</span>
            <button
              type="button"
              onClick={() =>
                onUpdate({
                  controllerVibration: !(settings.controllerVibration ?? true),
                })
              }
              className={`min-h-[40px] px-3.5 py-1.5 rounded-xl font-semibold cursor-pointer transition-colors ${
                settings.controllerVibration ?? true
                  ? 'bg-[#e26d27] text-[#120d0a]'
                  : 'bg-[#19130f] border border-[#e4d4c6]/16 text-[#9c8b79]'
              }`}
            >
              {settings.controllerVibration ?? true ? 'Enabled' : 'Off'}
            </button>
          </div>

          <div className={`flex items-center justify-between ${rowCls(7)}`}>
            <span className="text-[#d8c7b4] font-medium">Full Screen Mode</span>
            <button
              type="button"
              onClick={onToggleFullscreen}
              className={`min-h-[40px] px-3.5 py-1.5 rounded-xl font-semibold flex items-center gap-1.5 cursor-pointer transition-colors ${
                isFullscreen
                  ? 'bg-[#e26d27] text-[#120d0a]'
                  : 'bg-[#19130f] border border-[#e4d4c6]/16 text-[#d8c7b4]'
              }`}
            >
              {isFullscreen ? (
                <>
                  <Minimize2 className="w-3.5 h-3.5" />
                  <span>Exit Full Screen</span>
                </>
              ) : (
                <>
                  <Maximize2 className="w-3.5 h-3.5" />
                  <span>Full Screen</span>
                </>
              )}
            </button>
          </div>

          <div className={`flex items-center justify-between ${rowCls(8)}`}>
            <span className="text-[#d8c7b4] font-medium">Impact Camera Shake</span>
            <button
              type="button"
              onClick={() => onUpdate({ screenShake: !settings.screenShake })}
              className={`min-h-[40px] px-3.5 py-1.5 rounded-xl font-semibold cursor-pointer transition-colors ${
                settings.screenShake
                  ? 'bg-[#e26d27] text-[#120d0a]'
                  : 'bg-[#19130f] border border-[#e4d4c6]/16 text-[#9c8b79]'
              }`}
            >
              {settings.screenShake ? 'Enabled' : 'Off'}
            </button>
          </div>

          <div className={`flex items-center justify-between ${rowCls(9)}`}>
            <span className="text-[#d8c7b4] font-medium">Acoustic Stealth Ripples</span>
            <button
              type="button"
              onClick={() =>
                onUpdate({ showAcousticRings: !settings.showAcousticRings })
              }
              className={`min-h-[40px] px-3.5 py-1.5 rounded-xl font-semibold cursor-pointer transition-colors ${
                settings.showAcousticRings
                  ? 'bg-[#e26d27] text-[#120d0a]'
                  : 'bg-[#19130f] border border-[#e4d4c6]/16 text-[#9c8b79]'
              }`}
            >
              {settings.showAcousticRings ? 'Visible' : 'Hidden'}
            </button>
          </div>

          <div className={`flex items-center justify-between ${rowCls(10)}`}>
            <span className="text-[#d8c7b4] font-medium">Touch Joysticks</span>
            <div className="flex items-center gap-1 p-1 bg-[#19130f] rounded-xl border border-[#e4d4c6]/16">
              {(['auto', 'on', 'off'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => onUpdate({ mobileControlsMode: m })}
                  className={`min-h-[36px] px-3 py-1 rounded-lg text-xs font-medium capitalize cursor-pointer transition-colors ${
                    settings.mobileControlsMode === m
                      ? 'bg-[#e26d27] text-[#120d0a] font-semibold'
                      : 'text-[#9c8b79] hover:text-[#f7f2e7]'
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between pt-3 border-t border-[#e4d4c6]/14">
            <span className="text-[#d8c7b4] font-medium">Standalone App (PWA)</span>
            <PWAInstallButton compact />
          </div>

          <button
            type="button"
            onClick={onClose}
            className={`mt-2 w-full min-h-[46px] py-2.5 rounded-xl border text-xs font-semibold cursor-pointer transition-colors ${
              isGamepadActive && focusedRow === 11
                ? 'bg-[#9f1d22] border-[#d9383e] text-[#f8eded]'
                : 'bg-[#19130f] hover:bg-[#231a14] border-[#e4d4c6]/18 text-[#f7f2e7]'
            }`}
          >
            Done{isGamepadActive ? ` [${gp.east}]` : ''}
          </button>
        </div>
      </div>
    </div>
  );
};

const SliderRow: React.FC<{
  label: string;
  value: number;
  onChange: (v: number) => void;
}> = ({ label, value, onChange }) => (
  <div>
    <div className="flex items-center justify-between mb-1.5">
      <span className="text-[#d8c7b4] font-medium">{label}</span>
      <span className="font-mono-num text-[#9c8b79]">{Math.round(value * 100)}%</span>
    </div>
    <input
      type="range"
      min={0}
      max={100}
      value={Math.round(value * 100)}
      onChange={(e) => onChange(Number(e.target.value) / 100)}
      className="w-full h-6 accent-[#b92b30] cursor-pointer"
    />
  </div>
);

const CreditsModal: React.FC<{
  isTouchDevice?: boolean;
  isGamepadConnected?: boolean;
  gamepadBrand?: UISnapshot['gamepadBrand'];
  onClose: () => void;
}> = ({
  isTouchDevice = false,
  isGamepadConnected = false,
  gamepadBrand = 'xbox',
  onClose,
}) => {
  const gp = getGamepadGlyphs(gamepadBrand);

  useEffect(() => {
    return subscribeGamepadUI((action) => {
      if (action === 'ui_cancel' || action === 'ui_confirm') {
        onClose();
      }
    });
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40 bg-[#070504]/86 pointer-events-auto flex items-center justify-center p-3 sm:p-4">
      <div className="w-full max-w-md max-h-[92dvh] overflow-y-auto scroll-touch bg-[#120d0a]/96 border border-[#e4d4c6]/18 rounded-2xl p-5 sm:p-6 shadow-2xl">
        <div className="flex items-center justify-between pb-3">
          <h2 className="font-display text-2xl font-bold tracking-[0.06em] text-[#f7f2e7]">
            Field Guide &amp; Controls
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="min-w-[42px] min-h-[42px] rounded-xl bg-[#19130f] hover:bg-[#231a14] border border-[#e4d4c6]/16 text-[#d8c7b4] hover:text-[#f7f2e7] flex items-center justify-center cursor-pointer transition-colors"
            aria-label="Close Field Guide"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <DottedRule />

        <div className="mt-4 space-y-3 text-xs text-[#d8c7b4] leading-relaxed">
          <p>
            <strong className="text-[#f7f2e7]">01. Oakhaven Village &amp; Highway F45:</strong> You awaken at 11:00 PM in Oakhaven Countryside Village carrying airborne spore exposure. Scavenge nearby cottages and take straight <strong>Road F45</strong>—the only highway into Quarantine City—weaving past multi-car pileups and ambushing Hollow.
          </p>
          <p>
            <strong className="text-[#f7f2e7]">02. Survivor Phone &amp; Breaking News Radio:</strong> Open your <strong>Phone [Q / {gp.select}]</strong> at any time to check the current hour, toggle your LED <strong>Flashlight</strong>, navigate offline <strong>Maps</strong>, and listen to <strong>162.55 MHz Breaking News Radio</strong> broadcasts.
          </p>
          <p>
            <strong className="text-[#f7f2e7]">03. St. Jude Hospital &amp; 6:00 AM Extraction:</strong> Push north to <strong>St. Jude Memorial Hospital</strong> to inject the <strong>Antiviral Serum</strong>, then sync with the hospital’s <strong>Emergency Radio</strong> to reveal Flight Echo-7’s <strong>06:00 AM</strong> landing zone.
          </p>
          <p>
            <strong className="text-[#f7f2e7]">04. Online Matchmaking (2-20 Survivors):</strong> Click Online Match and the system automatically drops you into a shared night — no room code or password. The 50s countdown starts once at least 2 survivors are queued, then launches with everyone available (up to 20). Gunfire draws both rival players and The Hollow-and Flight Echo-7 carries <strong>only one extraction seat</strong>.
          </p>

          <div className="pt-3 border-t border-[#e4d4c6]/14 space-y-2 text-[11px] font-mono-num text-[#9c8b79] leading-relaxed">
            <div>
              <div className="text-[#e26d27] font-sans font-semibold mb-0.5">
                Controller ({isGamepadConnected ? 'Connected' : 'Xbox / PlayStation / Switch'})
              </div>
              <div>
                Left Stick Move ({gp.l3}/{gp.lt} Sprint) · Right Stick Aim ({gp.r3} Light) · {gp.rt} Attack · {gp.lb}/{gp.rb} Weapons · D-Pad Quick Belt 1–4 · {gp.south} Interact · {gp.east} Stealth · {gp.west} Reload · {gp.north} Pack · {gp.select} Phone
              </div>
            </div>

            <div>
              <div className="text-[#e26d27] font-sans font-semibold mb-0.5">
                {isTouchDevice ? 'Touch Controls' : 'Keyboard & Mouse'}
              </div>
              <div>
                {isTouchDevice
                  ? 'Left Stick Move · Right Stick Aim & Outer-Rim Fire · Quick Belt 1–4 · Phone for Time, Light, Map & Radio'
                  : 'WASD Move · Mouse Aim & Attack · Shift Sprint · Ctrl Crouch · E Interact · Q Phone (Time, Map, Radio & Light) · F Flashlight · Tab Pack'}
              </div>
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="mt-5 w-full min-h-[46px] py-2.5 rounded-xl bg-[#9f1d22] hover:bg-[#b8252b] text-[#f8eded] text-xs font-semibold cursor-pointer transition-colors"
        >
          Back to Main Menu{isGamepadConnected ? ` [${gp.east}]` : ''}
        </button>
      </div>
    </div>
  );
};
