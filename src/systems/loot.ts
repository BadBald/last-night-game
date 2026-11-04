import { DISTRICT_LOOT_TABLES, ITEMS } from '../data/items';
import { ContainerType, DistrictId, InventoryItemInstance } from '../types';

let uidCounter = 1;
export function nextItemUid(): string {
  uidCounter += 1;
  return `itm_${Date.now().toString(36)}_${uidCounter}`;
}

export function createItemInstance(
  itemId: string,
  quantity = 1,
  customAmmo?: number,
  rng: () => number = Math.random
): InventoryItemInstance {
  const def = ITEMS[itemId];
  const clampedQty = Math.max(1, Math.min(quantity, def ? def.stackLimit : 1));
  const inst: InventoryItemInstance = {
    uid: nextItemUid(),
    itemId,
    quantity: clampedQty,
  };
  if (def?.maxDurability) {
    // Scavenged melee weapons have 70%-100% durability
    inst.durability = Math.round(def.maxDurability * (0.72 + rng() * 0.28));
  }
  if (def?.category === 'weapon_ranged' && def.weaponStats?.magSize) {
    inst.loadedAmmo =
      customAmmo !== undefined
        ? customAmmo
        : Math.max(2, Math.floor(def.weaponStats.magSize * (0.35 + rng() * 0.55)));
  }
  return inst;
}

export function generateContainerLoot(
  district: DistrictId,
  containerType: ContainerType,
  slotCount = 6,
  rng: () => number = Math.random
): (InventoryItemInstance | null)[] {
  const slots: (InventoryItemInstance | null)[] = Array(slotCount).fill(null);

  // Determine how many items spawn in this container
  let minItems = 1;
  let maxItems = 3;
  if (
    containerType === 'police_locker' ||
    containerType === 'medical_cabinet' ||
    containerType === 'survivor_pack'
  ) {
    minItems = 2;
    maxItems = 4;
  } else if (containerType === 'dresser' || containerType === 'desk') {
    minItems = 0; // small chance of empty drawer (~15%)
    maxItems = 2;
  }

  let count =
    minItems === 0 && rng() < 0.16
      ? 0
      : Math.floor(minItems + rng() * (maxItems - minItems + 1));

  // Container-specific bias overrides on top of district table
  const baseTable = DISTRICT_LOOT_TABLES[district] || DISTRICT_LOOT_TABLES.streets;
  const weightedPool = baseTable.map((entry) => {
    let w = entry.weight;
    const def = ITEMS[entry.itemId];
    if (!def) return { ...entry, weight: 0 };

    if (containerType === 'fridge' && def.category === 'food') w *= 3.0;
    if (containerType === 'pharmacy_shelf' && def.category === 'medical') w *= 2.4;
    if (containerType === 'medical_cabinet' && (entry.itemId === 'medkit' || entry.itemId === 'antiviral')) {
      w *= 2.2;
    }
    if (
      containerType === 'police_locker' &&
      (def.category === 'weapon_ranged' || def.category === 'ammo' || entry.itemId === 'kevlar_vest')
    ) {
      w *= 2.2;
    }
    if (
      containerType === 'toolbox' &&
      (entry.itemId === 'powerbank' || entry.itemId === 'crowbar' || entry.itemId === 'pipe_wrench' || entry.itemId === 'flare')
    ) {
      w *= 2.5;
    }
    if (containerType === 'car_trunk' && (entry.itemId === 'fuel_canister' || entry.itemId === 'flare')) {
      w *= 2.2;
    }
    return { ...entry, weight: w };
  });

  const totalWeight = weightedPool.reduce((acc, e) => acc + e.weight, 0);
  if (totalWeight <= 0) return slots;

  count = Math.min(count, slotCount);
  for (let i = 0; i < count; i++) {
    let roll = rng() * totalWeight;
    let chosen = weightedPool[0];
    for (const entry of weightedPool) {
      roll -= entry.weight;
      if (roll <= 0) {
        chosen = entry;
        break;
      }
    }
    const qty =
      chosen.minQty + Math.floor(rng() * (chosen.maxQty - chosen.minQty + 1));
    slots[i] = createItemInstance(chosen.itemId, qty, undefined, rng);
  }

  return slots;
}
