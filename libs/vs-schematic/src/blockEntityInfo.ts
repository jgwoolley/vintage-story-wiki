// What a decoded block entity (schematicDecode.ts's TreeAttributes) holds, in a form the viewers can list:
// the item stacks in its inventory. Shared by the schematic viewer's block details tab and the schematic search.
import type { TreeAttributes } from "./schematicDecode.js";

export type ItemStack = { itemClass: "block" | "item"; id: number; stackSize: number; attributes?: TreeAttributes };

export function isItemStack(value: unknown): value is ItemStack {
  const v = value as Partial<ItemStack> | null;
  return !!v && typeof v === "object" && (v.itemClass === "block" || v.itemClass === "item") && typeof v.id === "number";
}

/** Every item stack anywhere in a decoded entity, with the key path it was found under (slots can nest under any container-specific key). */
export function* itemStacksWithPath(value: unknown, path: string[] = []): Generator<{ path: string; stack: ItemStack }> {
  if (!value || typeof value !== "object" || path.length > 8) return;
  if (isItemStack(value)) {
    yield { path: path.join("."), stack: value };
    return;
  }
  for (const [key, child] of Object.entries(value)) yield* itemStacksWithPath(child, [...path, key]);
}

export interface InventoryEntry {
  /** Where in the entity the stack sits, e.g. `inventory.slots.3`. */
  path: string;
  /** Resolved block/item code (e.g. `game:gear-rusty`), or null when the schematic's code table lacks the id. */
  code: string | null;
  kind: "block" | "item";
  stackSize: number;
  /** The stack's own attributes (e.g. a stackrandomizer's `totalChance`). */
  attributes: TreeAttributes;
}

/** The item stacks in a block entity, resolved through the schematic's `BlockCodes`/`ItemCodes` (a stack's `id` indexes the matching table). */
export function inventoryOf(attrs: TreeAttributes, blockCodes: Record<string, string>, itemCodes: Record<string, string> = {}): InventoryEntry[] {
  return [...itemStacksWithPath(attrs)].map(({ path, stack }) => ({
    path,
    code: (stack.itemClass === "block" ? blockCodes : itemCodes)[String(stack.id)] ?? null,
    kind: stack.itemClass,
    stackSize: stack.stackSize,
    attributes: stack.attributes ?? {},
  }));
}
