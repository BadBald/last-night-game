/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState } from 'react';
import { GameEngine } from './game/GameEngine';
import { UISnapshot } from './types';
import { HUD } from './ui/HUD';
import { InventoryModal } from './ui/InventoryModal';
import { MobileControls } from './ui/MobileControls';
import { OfflineIndicator } from './ui/PWAInstallButton';
import { PhoneModal } from './ui/PhoneModal';
import { Screens } from './ui/Screens';
import { useFullscreen } from './ui/useFullscreen';

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const [snap, setSnap] = useState<UISnapshot | null>(null);
  const { isFullscreen, toggleFullscreen, fullscreenHint } = useFullscreen();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const engine = new GameEngine(canvas, (nextSnap) => {
      setSnap(nextSnap);
    });
    engineRef.current = engine;
    engine.startLoop();

    return () => {
      engine.destroy();
      engineRef.current = null;
    };
  }, []);

  const engine = engineRef.current;
  const hidePointerForPad =
    snap?.screen === 'PLAYING' &&
    snap?.panel === 'NONE' &&
    Boolean(snap?.isGamepadActive);

  return (
    <main className="relative w-full h-[100dvh] overflow-hidden bg-[#090706] select-none">
      {/* Isolated 60 FPS Simulation Canvas */}
      <canvas
        ref={canvasRef}
        tabIndex={0}
        className={`block w-full h-full outline-none ${
          hidePointerForPad ? 'cursor-none' : 'cursor-crosshair'
        }`}
      />

      {/* Clean Perimeter HUD & Diegetic Overlays */}
      {snap && engine && (
        <>
          {snap.screen === 'PLAYING' && (
            <HUD
              snap={snap}
              isFullscreen={isFullscreen}
              fullscreenHint={fullscreenHint}
              onToggleFullscreen={toggleFullscreen}
              onToggleInventory={() =>
                engine.setPanel(
                  snap.panel === 'INVENTORY' || snap.panel === 'LOOT'
                    ? 'NONE'
                    : 'INVENTORY'
                )
              }
              onTogglePhone={() => engine.setPanel('PHONE')}
              onToggleMute={() => engine.toggleMute()}
              onTogglePause={() => engine.togglePause()}
              onQuickSlotClick={(idx) => engine.useOrEquipBackpackSlot(idx)}
              onInteract={() => engine.triggerInteract()}
            />
          )}

          {snap.screen === 'PLAYING' && snap.panel === 'PHONE' && (
            <PhoneModal
              snap={snap}
              onClose={() => engine.setPanel('NONE')}
              onToggleFlashlight={() => engine.toggleFlashlight()}
              onUsePowerBank={() => engine.usePowerBank()}
              onReplayRadioBeep={() => engine.replayRadioBeep()}
              onReplayBroadcast={(broadcastId) => engine.playRadioBroadcast(broadcastId)}
              onStopBroadcast={() => engine.stopRadioBroadcast()}
              onClearUnreadRadio={() => engine.clearUnreadRadio()}
            />
          )}

          {snap.screen === 'PLAYING' &&
            (snap.panel === 'INVENTORY' || snap.panel === 'LOOT') && (
              <InventoryModal
                snap={snap}
                onClose={() => engine.setPanel('NONE')}
                onUseOrEquip={(idx) => engine.useOrEquipBackpackSlot(idx)}
                onDrop={(idx) => engine.dropBackpackSlot(idx)}
                onTransferOrSwap={(fs, fi, ts, ti) =>
                  engine.transferOrSwapSlots(fs, fi, ts, ti)
                }
                onQuickTakeContainerSlot={(cIdx) =>
                  engine.quickTransferFromContainer(cIdx)
                }
                onTakeAll={() => engine.takeAllFromActiveContainer()}
              />
            )}

          <MobileControls
            input={engine.input}
            snap={snap}
            onToggleInventory={() =>
              engine.setPanel(
                snap.panel === 'INVENTORY' || snap.panel === 'LOOT'
                  ? 'NONE'
                  : 'INVENTORY'
              )
            }
            onTogglePhone={() => engine.setPanel('PHONE')}
            onQuickSlotClick={(idx) => engine.useOrEquipBackpackSlot(idx)}
            onInteract={() => engine.triggerInteract()}
          />

          <Screens
            snap={snap}
            isFullscreen={isFullscreen}
            fullscreenHint={fullscreenHint}
            onToggleFullscreen={toggleFullscreen}
            onStartNewGame={() => engine.startNewGame()}
            onOpenOnlineMatchmaking={() => engine.openOnlineMatchmaking()}
            onSetOnlineCallsign={(name) => engine.setOnlineCallsign(name)}
            onQuickJoinOnline={() => engine.quickJoinOnline()}
            onLeaveOnlineRoom={() => engine.leaveOnlineRoom()}
            onReturnToTitle={() => engine.returnToTitle()}
            onSetPanel={(p) => engine.setPanel(p)}
            onTogglePause={() => engine.togglePause()}
            onUpdateSettings={(partial) => engine.updateSettings(partial)}
            onMenuTick={() => engine.playMenuTick()}
          />
        </>
      )}

      <OfflineIndicator />
    </main>
  );
}
