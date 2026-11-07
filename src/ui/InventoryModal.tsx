import React, { useEffect, useState } from 'react';
import { ArrowDownToLine, ArrowLeftRight, Trash2, X } from 'lucide-react';
import { CONFIG } from '../config';
import { ITEMS } from '../data/items';
import { getGamepadGlyphs, subscribeGamepadUI } from '../engine/input';
import { InventoryItemInstance, UISnapshot } from '../types';
import { ItemIconSVG } from './Icons';
import { useViewportLayout } from './useViewportLayout';

interface InventoryModalProps {
  snap: UISnapshot;
  onClose: () => void;
  onUseOrEquip: (slotIdx: number) => void;
  onDrop: (slotIdx: number) => void;
  onTransferOrSwap: (
    fromSource: 'backpack' | 'container',
    fromIdx: number,
    toSource: 'backpack' | 'container',
    toIdx: number
  ) => void;
  onQuickTakeContainerSlot: (containerIdx: number) => void;
  onTakeAll: () => void;
}

export const InventoryModal: React.FC<InventoryModalProps> = ({
  snap,
  onClose,
  onUseOrEquip,
  onDrop,
  onTransferOrSwap,
  onQuickTakeContainerSlot,
  onTakeAll,
}) => {
  const { width, isCompactLandscape } = useViewportLayout();
  const gp = getGamepadGlyphs(snap.gamepadBrand);
  const padActive = snap.isGamepadActive;
  const backpackCols = width >= 640 ? 6 : 4;

  const [selected, setSelected] = useState<{
    source: 'backpack' | 'container';
    idx: number;
  } | null>(() => {
    if (snap.activeContainer) {
      const firstIdx = snap.activeContainer.items.findIndex((it) => it !== null);
      if (firstIdx >= 0) return { source: 'container', idx: firstIdx };
    }
    return { source: 'backpack', idx: snap.equippedSlot ?? 0 };
  });

  const [moveOrigin, setMoveOrigin] = useState<{
    source: 'backpack' | 'container';
    idx: number;
  } | null>(null);

  const [dragOrigin, setDragOrigin] = useState<{
    source: 'backpack' | 'container';
    idx: number;
  } | null>(null);

  const selectedInst: InventoryItemInstance | null =
    selected?.source === 'backpack'
      ? snap.backpack[selected.idx] ?? null
      : selected?.source === 'container' && snap.activeContainer
      ? snap.activeContainer.items[selected.idx] ?? null
      : null;

  const selectedDef = selectedInst ? ITEMS[selectedInst.itemId] : null;
  const isEncumbered = snap.totalWeight > CONFIG.ENCUMBERED_THRESHOLD_KG;

  // Gamepad 2D Grid Navigation & Actions
  useEffect(() => {
    return subscribeGamepadUI((action) => {
      const hasContainer = Boolean(snap.activeContainer);
      const containerLen = snap.activeContainer?.items.length ?? 0;
      const backpackLen = snap.backpack.length;
      const cur = selected ?? { source: 'backpack' as const, idx: 0 };

      if (action === 'ui_cancel') {
        if (moveOrigin) {
          setMoveOrigin(null);
        } else {
          onClose();
        }
        return;
      }

      if (action === 'ui_lb' || action === 'ui_rb') {
        if (hasContainer && containerLen > 0) {
          if (cur.source === 'container') {
            setSelected({
              source: 'backpack',
              idx: Math.min(backpackLen - 1, cur.idx),
            });
          } else {
            setSelected({
              source: 'container',
              idx: Math.min(containerLen - 1, cur.idx % 6),
            });
          }
        }
        return;
      }

      if (action === 'nav_left') {
        const maxLen = cur.source === 'container' ? containerLen : backpackLen;
        if (maxLen > 0) {
          setSelected({
            source: cur.source,
            idx: (cur.idx - 1 + maxLen) % maxLen,
          });
        }
        return;
      }

      if (action === 'nav_right') {
        const maxLen = cur.source === 'container' ? containerLen : backpackLen;
        if (maxLen > 0) {
          setSelected({
            source: cur.source,
            idx: (cur.idx + 1) % maxLen,
          });
        }
        return;
      }

      if (action === 'nav_up') {
        if (cur.source === 'backpack') {
          if (cur.idx >= backpackCols) {
            setSelected({ source: 'backpack', idx: cur.idx - backpackCols });
          } else if (hasContainer && containerLen > 0) {
            const col = cur.idx % backpackCols;
            const lastRowStart = Math.floor((containerLen - 1) / 6) * 6;
            setSelected({
              source: 'container',
              idx: Math.min(containerLen - 1, lastRowStart + Math.min(5, col)),
            });
          }
        } else if (cur.idx >= 6) {
          setSelected({ source: 'container', idx: cur.idx - 6 });
        }
        return;
      }

      if (action === 'nav_down') {
        if (cur.source === 'container') {
          if (cur.idx + 6 < containerLen) {
            setSelected({ source: 'container', idx: cur.idx + 6 });
          } else {
            const col = cur.idx % 6;
            setSelected({
              source: 'backpack',
              idx: Math.min(backpackLen - 1, Math.min(backpackCols - 1, col)),
            });
          }
        } else if (cur.idx + backpackCols < backpackLen) {
          setSelected({ source: 'backpack', idx: cur.idx + backpackCols });
        }
        return;
      }

      if (action === 'ui_west') {
        const hasItemAtCur =
          cur.source === 'backpack'
            ? Boolean(snap.backpack[cur.idx])
            : Boolean(snap.activeContainer?.items[cur.idx]);
        if (moveOrigin) {
          setMoveOrigin(null);
        } else if (hasItemAtCur) {
          setMoveOrigin(cur);
        }
        return;
      }

      if (action === 'ui_north') {
        if (hasContainer && cur.source === 'container') {
          onTakeAll();
        } else if (cur.source === 'backpack' && snap.backpack[cur.idx]) {
          setMoveOrigin(null);
          onDrop(cur.idx);
        }
        return;
      }

      if (action === 'ui_confirm') {
        if (moveOrigin) {
          if (moveOrigin.source !== cur.source || moveOrigin.idx !== cur.idx) {
            onTransferOrSwap(moveOrigin.source, moveOrigin.idx, cur.source, cur.idx);
          }
          setMoveOrigin(null);
          return;
        }

        if (cur.source === 'container') {
          if (snap.activeContainer?.items[cur.idx]) {
            onQuickTakeContainerSlot(cur.idx);
          }
        } else {
          const inst = snap.backpack[cur.idx];
          if (inst) {
            const def = ITEMS[inst.itemId];
            if (def && def.category !== 'ammo' && def.id !== 'fuel_canister') {
              onUseOrEquip(cur.idx);
            }
          }
        }
      }
    });
  }, [
    selected,
    moveOrigin,
    backpackCols,
    snap.activeContainer,
    snap.backpack,
    onClose,
    onUseOrEquip,
    onDrop,
    onTransferOrSwap,
    onQuickTakeContainerSlot,
    onTakeAll,
  ]);

  const handleSlotTap = (source: 'backpack' | 'container', idx: number) => {
    const clickedItem =
      source === 'backpack'
        ? snap.backpack[idx]
        : snap.activeContainer?.items[idx];

    if (moveOrigin) {
      if (moveOrigin.source !== source || moveOrigin.idx !== idx) {
        onTransferOrSwap(moveOrigin.source, moveOrigin.idx, source, idx);
        setSelected({ source, idx });
      }
      setMoveOrigin(null);
      return;
    }

    if (selected && selected.source === source && selected.idx === idx && clickedItem) {
      if (source === 'container') {
        onQuickTakeContainerSlot(idx);
      } else {
        const def = ITEMS[clickedItem.itemId];
        if (def && def.category !== 'ammo' && def.id !== 'fuel_canister') {
          onUseOrEquip(idx);
        }
      }
      return;
    }

    if (
      selected &&
      (selected.source !== source || selected.idx !== idx) &&
      ((selected.source === 'backpack' && snap.backpack[selected.idx]) ||
        (selected.source === 'container' && snap.activeContainer?.items[selected.idx])) &&
      !clickedItem
    ) {
      onTransferOrSwap(selected.source, selected.idx, source, idx);
      setSelected({ source, idx });
      return;
    }

    setSelected({ source, idx });
  };

  return (
    <div
      className="fixed inset-0 z-20 pointer-events-auto bg-[#070504]/74 flex items-center justify-center p-2 sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-3xl max-h-[94dvh] flex flex-col overflow-hidden bg-[#120d0a]/98 border border-[#e4d4c6]/18 rounded-2xl shadow-2xl">
        {/* Sticky Header */}
        <div
          className={`flex items-center justify-between gap-3 border-b border-[#e4d4c6]/14 shrink-0 ${
            isCompactLandscape ? 'px-3.5 py-2' : 'px-4 py-3 sm:px-6 sm:py-4'
          }`}
        >
          <div className="min-w-0">
            <h2
              className={`font-display font-bold tracking-[0.05em] text-[#f7f2e7] truncate ${
                isCompactLandscape ? 'text-lg' : 'text-xl sm:text-2xl'
              }`}
            >
              {snap.activeContainer
                ? `Scavenging · ${snap.activeContainer.label}`
                : 'Survivor Backpack'}
            </h2>
            <p className="text-[11px] sm:text-xs text-[#9c8b79] mt-0.5 font-mono-num truncate">
              Carry Weight{' '}
              <span className={isEncumbered ? 'text-[#c9363b] font-semibold' : 'text-[#f7f2e7]'}>
                {snap.totalWeight.toFixed(1)}/{snap.maxWeight.toFixed(0)} kg
              </span>
              {isEncumbered ? ' · Encumbered' : ''}
              {padActive
                ? ` · D-Pad Select · [${gp.east}] Close`
                : ''}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="min-w-[40px] min-h-[40px] rounded-xl bg-[#19130f] hover:bg-[#241b15] border border-[#e4d4c6]/16 text-[#d8c7b4] hover:text-[#f7f2e7] flex items-center justify-center transition-colors shrink-0 cursor-pointer"
            aria-label="Close Backpack"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Touch-Friendly Body */}
        <div
          className={`scroll-touch overflow-y-auto flex-1 ${
            isCompactLandscape ? 'p-3' : 'p-3.5 sm:p-6'
          }`}
        >
          {moveOrigin && (
            <div className="mb-2.5 px-3 py-1.5 rounded-xl bg-[#c9363b]/16 border border-[#c9363b]/65 flex items-center justify-between gap-2 text-xs text-[#f7f2e7]">
              <span>
                {padActive
                  ? `Select destination slot (Slots 1–4 = Quick Belt) and press [${gp.south}] to swap.`
                  : 'Tap any slot (Slots 1–4 = Quick Belt) to move or swap item.'}
              </span>
              <button
                type="button"
                onClick={() => setMoveOrigin(null)}
                className="px-2.5 py-1 rounded-lg bg-[#19130f] text-[#d8c7b4] font-semibold cursor-pointer"
              >
                Cancel
              </button>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-12 gap-3.5 sm:gap-5">
            {/* Left / Center: Container (if looting) + 12-Slot Backpack */}
            <div className="sm:col-span-7 space-y-3">
              {snap.activeContainer && (
                <div>
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className="text-xs font-semibold text-[#c9363b] truncate">
                      {snap.activeContainer.label}{' '}
                      {padActive ? `([${gp.south}] Take)` : '(Tap twice to take)'}
                    </span>
                    <button
                      type="button"
                      onClick={onTakeAll}
                      className="min-h-[40px] flex items-center gap-1.5 px-3.5 py-1.5 bg-[#c9363b] hover:bg-[#d95338] active:scale-95 text-[#120d0a] rounded-xl text-xs font-semibold transition-all whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <ArrowDownToLine className="w-4 h-4" />
                      <span>Take All{padActive ? ` [${gp.north}]` : ''}</span>
                    </button>
                  </div>

                  <div className="grid grid-cols-6 gap-1.5 sm:gap-2">
                    {snap.activeContainer.items.map((item, idx) => {
                      const def = item ? ITEMS[item.itemId] : null;
                      const isSel =
                        selected?.source === 'container' && selected.idx === idx;
                      const isOrigin =
                        moveOrigin?.source === 'container' && moveOrigin.idx === idx;
                      return (
                        <button
                          key={idx}
                          type="button"
                          draggable={!!item}
                          onDragStart={() => setDragOrigin({ source: 'container', idx })}
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={(e) => {
                            e.preventDefault();
                            if (dragOrigin) {
                              onTransferOrSwap(
                                dragOrigin.source,
                                dragOrigin.idx,
                                'container',
                                idx
                              );
                              setDragOrigin(null);
                            }
                          }}
                          onClick={() => handleSlotTap('container', idx)}
                          className={`relative aspect-square min-h-[46px] rounded-xl border flex items-center justify-center cursor-pointer transition-colors ${
                            isSel
                              ? 'bg-[#251b14] border-[#c9363b] ring-1 ring-[#c9363b]/45'
                              : isOrigin
                              ? 'bg-[#2a1d14] border-dashed border-[#f39c59]'
                              : moveOrigin
                              ? 'bg-[#19130f] border-[#c9363b]/40'
                              : 'bg-[#19130f]/95 border-[#e4d4c6]/14 hover:border-[#e4d4c6]/30'
                          }`}
                        >
                          {def && <ItemIconSVG iconId={def.iconId} className="w-7 h-7" />}
                          {item && item.quantity > 1 && (
                            <span className="absolute bottom-1 right-1.5 text-[11px] font-mono-num font-semibold text-[#f7f2e7]">
                              {item.quantity}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-[#d8c7b4]">
                    12-Slot Pack
                  </span>
                  <span className="text-[11px] text-[#9c8b79] font-mono-num">
                    {padActive
                      ? 'Slots 1–4 = D-Pad Quick Belt'
                      : 'Slots 1–4 = Quick Belt'}
                  </span>
                </div>

                <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                  {snap.backpack.map((item, idx) => {
                    const def = item ? ITEMS[item.itemId] : null;
                    const isSel =
                      selected?.source === 'backpack' && selected.idx === idx;
                    const isOrigin =
                      moveOrigin?.source === 'backpack' && moveOrigin.idx === idx;
                    const isEq = snap.equippedSlot === idx;
                    return (
                      <button
                        key={idx}
                        type="button"
                        draggable={!!item}
                        onDragStart={() => setDragOrigin({ source: 'backpack', idx })}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => {
                          e.preventDefault();
                          if (dragOrigin) {
                            onTransferOrSwap(
                              dragOrigin.source,
                              dragOrigin.idx,
                              'backpack',
                              idx
                            );
                            setDragOrigin(null);
                          }
                        }}
                        onClick={() => handleSlotTap('backpack', idx)}
                        className={`relative aspect-square min-h-[52px] rounded-xl border flex items-center justify-center cursor-pointer transition-colors ${
                          isSel
                            ? 'bg-[#251b14] border-[#c9363b] ring-1 ring-[#c9363b]/45'
                            : isOrigin
                            ? 'bg-[#2a1d14] border-dashed border-[#f39c59]'
                            : moveOrigin
                            ? 'bg-[#19130f] border-[#c9363b]/45'
                            : isEq
                            ? 'bg-[#c9363b]/15 border-[#c9363b]/75'
                            : 'bg-[#19130f]/95 border-[#e4d4c6]/14 hover:border-[#e4d4c6]/30'
                        }`}
                      >
                        {idx < 4 && (
                          <span className="absolute top-1 left-1.5 text-[9px] font-mono-num text-[#f39c59]/80">
                            {idx + 1}
                          </span>
                        )}
                        {isEq && (
                          <span className="absolute top-1 right-1 text-[9px] font-mono-num font-semibold text-[#c9363b]">
                            EQ
                          </span>
                        )}
                        {def && <ItemIconSVG iconId={def.iconId} className="w-7 h-7" />}
                        {item && item.quantity > 1 && (
                          <span className="absolute bottom-1 right-1.5 text-[11px] font-mono-num font-semibold text-[#f7f2e7]">
                            {item.quantity}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>

                {/* Desktop Drag-to-Drop Zone */}
                {!isCompactLandscape && !padActive && (
                  <div
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (dragOrigin && dragOrigin.source === 'backpack') {
                        onDrop(dragOrigin.idx);
                        setDragOrigin(null);
                      }
                    }}
                    className="hidden sm:flex mt-3 py-2 px-3 rounded-lg border border-dashed border-[#e4d4c6]/16 text-center text-xs text-[#9c8b79] items-center justify-center gap-2"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Drag item here or press Drop to leave on ground</span>
                  </div>
                )}
              </div>
            </div>

            {/* Right / Bottom Column: Selected Item Details & Touch/Controller Actions */}
            <div className="sm:col-span-5 bg-[#18120e] border border-[#e4d4c6]/14 rounded-xl p-3 sm:p-4 flex flex-col justify-between min-h-[155px]">
              {selectedInst && selectedDef ? (
                <div>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-base font-semibold text-[#f7f2e7]">
                        {selectedDef.name}
                      </h3>
                      <div className="text-xs text-[#9c8b79] font-mono-num mt-0.5">
                        <span>{(selectedDef.weight * selectedInst.quantity).toFixed(2)} kg</span>
                        <span className="mx-1.5">·</span>
                        <span>
                          Qty {selectedInst.quantity}/{selectedDef.stackLimit}
                        </span>
                      </div>
                    </div>
                    <div className="w-10 h-10 rounded-lg bg-[#120d0a] border border-[#e4d4c6]/14 flex items-center justify-center shrink-0">
                      <ItemIconSVG iconId={selectedDef.iconId} className="w-6 h-6" />
                    </div>
                  </div>

                  <p className="mt-2.5 text-xs text-[#d8c7b4] leading-relaxed">
                    {selectedDef.description}
                  </p>

                  {selectedDef.weaponStats && (
                    <div className="mt-2.5 pt-2 border-t border-[#e4d4c6]/14 text-xs font-mono-num text-[#9c8b79] space-y-1">
                      <div>
                        Damage {selectedDef.weaponStats.damage}
                        {selectedDef.weaponStats.pellets && selectedDef.weaponStats.pellets > 1
                          ? ` × ${selectedDef.weaponStats.pellets}`
                          : ''}{' '}
                        · Range {Math.round(selectedDef.weaponStats.range / 40)}m
                      </div>
                      <div>
                        Noise {Math.round(selectedDef.weaponStats.noiseRadius / 40)}m
                        {selectedInst.durability !== undefined &&
                          ` · Dur ${selectedInst.durability}/${selectedDef.maxDurability}`}
                        {selectedInst.loadedAmmo !== undefined &&
                          ` · Ammo ${selectedInst.loadedAmmo}/${selectedDef.weaponStats.magSize}`}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="my-auto text-center text-xs text-[#9c8b79] py-4">
                  {padActive
                    ? 'Use D-Pad or Left Stick to inspect slots, equip gear, or organize Quick Belt slots 1–4.'
                    : 'Tap an item to inspect, use medical gear, equip weapons, or organize Quick Belt slots 1–4.'}
                </div>
              )}

              {/* Ergonomic 44px+ Touch / Controller Action Buttons */}
              {selectedInst && selectedDef && selected && (
                <div className="mt-3.5 pt-3 border-t border-[#e4d4c6]/14 flex flex-wrap items-center gap-2">
                  {selected.source === 'container' ? (
                    <button
                      type="button"
                      onClick={() => onQuickTakeContainerSlot(selected.idx)}
                      className="flex-1 min-h-[44px] py-2 px-4 rounded-xl bg-[#c9363b] hover:bg-[#d95338] active:scale-95 text-[#120d0a] text-xs font-semibold transition-all whitespace-nowrap cursor-pointer"
                    >
                      Take Item{padActive ? ` [${gp.south}]` : ''}
                    </button>
                  ) : (
                    <>
                      {selectedDef.category !== 'ammo' &&
                        selectedDef.id !== 'fuel_canister' && (
                          <button
                            type="button"
                            onClick={() => {
                              setMoveOrigin(null);
                              onUseOrEquip(selected.idx);
                            }}
                            className="flex-1 min-h-[44px] py-2 px-4 rounded-xl bg-[#c9363b] hover:bg-[#d95338] active:scale-95 text-[#120d0a] text-xs font-semibold transition-all whitespace-nowrap cursor-pointer"
                          >
                            {selected.idx === snap.equippedSlot
                              ? 'Unequip'
                              : selectedDef.interactionLabel}
                            {padActive ? ` [${gp.south}]` : ''}
                          </button>
                        )}

                      <button
                        type="button"
                        onClick={() =>
                          setMoveOrigin((prev) => (prev ? null : selected))
                        }
                        className={`min-h-[44px] py-2 px-3 rounded-xl border text-xs font-semibold flex items-center justify-center gap-1 transition-colors whitespace-nowrap cursor-pointer ${
                          moveOrigin
                            ? 'bg-[#c9363b]/20 border-[#c9363b] text-[#f39c59]'
                            : 'bg-[#211913] hover:bg-[#2b2019] border-[#e4d4c6]/16 text-[#d8c7b4]'
                        }`}
                        title="Move or swap into Quick Belt slots 1–4"
                      >
                        <ArrowLeftRight className="w-3.5 h-3.5" />
                        <span>
                          {moveOrigin ? 'Place' : 'Move'}
                          {padActive ? ` [${gp.west}]` : ''}
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setMoveOrigin(null);
                          onDrop(selected.idx);
                          setSelected(null);
                        }}
                        className="min-h-[44px] py-2 px-3.5 rounded-xl bg-[#211913] hover:bg-[#2b2019] border border-[#e4d4c6]/16 text-[#d8c7b4] text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer"
                      >
                        Drop{padActive ? ` [${gp.north}]` : ''}
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
