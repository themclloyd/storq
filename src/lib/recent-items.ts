import { useCallback, useEffect, useState } from "react";
import type { Product } from "@/lib/products";

/**
 * What this till has rung up lately.
 *
 * A counter runs on a dozen items, not a catalogue: the tiles a cashier reaches
 * for again and again are what makes a register feel instant, and they are also
 * the only items an offline till can still resolve by code. Kept per account,
 * deliberately small, and stripped to the fields every staff member may read —
 * the till never writes a buying cost to disk.
 */
export const RECENT_MAX = 18;

const keyFor = (userId: string) => `storq-recent-${userId}`;

type Stored = Pick<
  Product,
  "id" | "name" | "sku" | "category" | "price" | "active" | "reorder_point"
>;

const toStored = (p: Product): Stored => ({
  id: p.id,
  name: p.name,
  sku: p.sku,
  category: p.category,
  price: p.price,
  active: p.active,
  reorder_point: p.reorder_point,
});

const toProduct = (p: Stored): Product => ({ ...p, price: Number(p.price) || 0, cost: 0 });

const isStored = (v: unknown): v is Stored =>
  !!v && typeof v === "object" && typeof (v as Stored).id === "string";

export function loadRecent(userId: string): Product[] {
  if (typeof window === "undefined" || !userId) return [];
  try {
    const raw = JSON.parse(localStorage.getItem(keyFor(userId)) ?? "[]") as unknown;
    return Array.isArray(raw) ? raw.filter(isStored).map(toProduct) : [];
  } catch {
    return [];
  }
}

/** Prepends one item, drops the oldest, and returns the list now on the device. */
export function rememberRecent(userId: string, product: Product): Product[] {
  const next = [product, ...loadRecent(userId).filter((p) => p.id !== product.id)].slice(
    0,
    RECENT_MAX,
  );
  try {
    localStorage.setItem(keyFor(userId), JSON.stringify(next.map(toStored)));
  } catch {
    // A full disk only costs the next boot its shortcut list, never the sale.
  }
  return next;
}

export function useRecentItems(userId: string) {
  const [items, setItems] = useState<Product[]>(() => loadRecent(userId));
  useEffect(() => setItems(loadRecent(userId)), [userId]);
  const remember = useCallback((p: Product) => setItems(rememberRecent(userId, p)), [userId]);
  return { items, remember };
}
