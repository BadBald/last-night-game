import { CONFIG } from '../config';
import { ITEMS } from '../data/items';
import { InventoryItemInstance } from '../types';
import { nextItemUid } from './loot';

export function calculateBackpackWeight(
  slots: (InventoryItemInstance | null)[],
  armorEquipped: boolean
): number {
  let total = armorEquipped ? 1.5 : 0; // Worn vest weight contribution
  for (const s of slots) {
    if (!s) continue;
    const def = ITEMS[s.itemId];
    if (def) {
      total += def.weight * s.quantity;
    }
  }
  return Math.round(total * 100) / 100;
}

export function canFitWeight(
  slots: (InventoryItemInstance | null)[],
  armorEquipped: boolean,
  itemId: string,
  qty: number
): boolean {
  const def = ITEMS[itemId];
  if (!def) return false;
  const current = calculateBackpackWeight(slots, armorEquipped);
  return current + def.weight * qty <= CONFIG.MAX_CARRY_WEIGHT_KG + 0.001;
}

/**
 * Attempts to add an item instance (or stack) into the 12-slot backpack.
 * Mutates slots in place and returns remaining quantity that could not fit.
 */
export function addItemToBackpack(
  slots: (InventoryItemInstance | null)[],
  armorEquipped: boolean,
  incoming: InventoryItemInstance
): { added: number; remaining: number; reason?: 'weight' | 'full' } {
  const def = ITEMS[incoming.itemId];
  if (!def) return { added: 0, remaining: incoming.quantity, reason: 'full' };

  let rem = incoming.quantity;
  let added = 0;

  // Check how many units weight allows
  const curWeight = calculateBackpackWeight(slots, armorEquipped);
  const availKg = Math.max(0, CONFIG.MAX_CARRY_WEIGHT_KG - curWeight);
  const maxByWeight = def.weight > 0 ? Math.floor((availKg + 0.0001) / def.weight) : rem;
  if (maxByWeight <= 0) {
    return { added: 0, remaining: rem, reason: 'weight' };
  }

  let allowedToAdd = Math.min(rem, maxByWeight);

  // 1. Merge into existing partial stacks if stackable
  if (def.stackLimit > 1) {
    for (let i = 0; i < slots.length && allowedToAdd > 0; i++) {
      const s = slots[i];
      if (s && s.itemId === incoming.itemId && s.quantity < def.stackLimit) {
        const space = def.stackLimit - s.quantity;
        const move = Math.min(space, allowedToAdd);
        s.quantity += move;
        allowedToAdd -= move;
        rem -= move;
        added += move;
      }
    }
  }

  // 2. Place remaining into empty slots
  for (let i = 0; i < slots.length && allowedToAdd > 0; i++) {
    if (slots[i] === null) {
      const move = Math.min(def.stackLimit, allowedToAdd);
      slots[i] = {
        uid: added === 0 ? incoming.uid : nextItemUid(),
        itemId: incoming.itemId,
        quantity: move,
        durability: incoming.durability,
        loadedAmmo: incoming.loadedAmmo,
      };
      allowedToAdd -= move;
      rem -= move;
      added += move;
    }
  }

  if (rem > 0) {
    return {
      added,
      remaining: rem,
      reason: added < Math.min(incoming.quantity, maxByWeight) ? 'full' : 'weight',
    };
  }
  return { added, remaining: 0 };
}

export function countItemInBackpack(
  slots: (InventoryItemInstance | null)[],
  itemId: string
): number {
  let count = 0;
  for (const s of slots) {
    if (s && s.itemId === itemId) count += s.quantity;
  }
  return count;
}

export function consumeItemQuantity(
  slots: (InventoryItemInstance | null)[],
  itemId: string,
  amount: number
): number {
  let needed = amount;
  let taken = 0;
  for (let i = 0; i < slots.length && needed > 0; i++) {
    const s = slots[i];
    if (s && s.itemId === itemId) {
      const take = Math.min(s.quantity, needed);
      s.quantity -= take;
      needed -= take;
      taken += take;
      if (s.quantity <= 0) {
        slots[i] = null;
      }
    }
  }
  return taken;
}

export function swapSlots(
  listA: (InventoryItemInstance | null)[],
  idxA: number,
  listB: (InventoryItemInstance | null)[],
  idxB: number
) {
  const itemA = listA[idxA];
  const itemB = listB[idxB];

  // If same item & stackable, stack onto target first!
  if (itemA && itemB && itemA.itemId === itemB.itemId && !(listA === listB && idxA === idxB)) {
    const def = ITEMS[itemA.itemId];
    if (def && def.stackLimit > 1 && itemB.quantity < def.stackLimit) {
      const space = def.stackLimit - itemB.quantity;
      const move = Math.min(space, itemA.quantity);
      itemB.quantity += move;
      itemA.quantity -= move;
      if (itemA.quantity <= 0) {
        listA[idxA] = null;
      }
      return;
    }
  }

  listA[idxA] = itemB;
  listB[idxB] = itemA;
}
