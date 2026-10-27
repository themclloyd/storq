import { usePos } from "@/lib/pos";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { tileTone } from "@/components/pos/till/tiles";

/**
 * One catalogue tile: a flat colour block with the item's name and price in
 * white. Tapping it adds a unit instantly — the press state is the feedback, so
 * there is no confirming dialog between the finger and the cart.
 */
export function ItemTile({
  name,
  price,
  compareAt,
  stock,
  threshold,
  onAdd,
}: {
  name: string;
  price: number;
  /** Catalogue price when a collection discount is active; struck through. */
  compareAt?: number;
  stock: number;
  threshold: number;
  onAdd: () => void;
}) {
  const { money } = usePos();
  const { t } = useI18n();
  const soldOut = stock <= 0;
  const low = !soldOut && stock <= threshold;
  const discounted = compareAt !== undefined && compareAt > price;

  return (
    <button
      type="button"
      onClick={onAdd}
      disabled={soldOut}
      aria-label={
        soldOut
          ? `${name}, ${money(price)}, ${t("till.outOfStock")}`
          : `${name}, ${money(price)}, ${t("till.inStock", { count: stock })}`
      }
      className={cn(
        "till-tile relative flex aspect-[4/3] flex-col justify-end p-2.5 text-left text-tile-foreground",
        "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/40 focus-visible:ring-offset-2",
        tileTone(name),
        soldOut && "pointer-events-none opacity-40 grayscale",
      )}
    >
      {/* A quiet scrim keeps the name and price legible on the lightest tones
          without tinting the block itself. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/20 to-transparent"
      />

      {low && (
        <span className="absolute left-2 top-2 rounded-md bg-warning px-1.5 py-0.5 text-[11px] font-bold tracking-wide text-warning-foreground uppercase">
          {t("till.low")}
        </span>
      )}
      {soldOut && (
        <span className="absolute inset-0 grid place-items-center bg-foreground/50 text-[11px] font-bold tracking-widest text-background uppercase">
          {t("till.outOfStock")}
        </span>
      )}

      <span className="relative line-clamp-2 text-[13px] font-semibold leading-tight break-words">
        {name}
      </span>
      <span className="relative mt-1 flex items-baseline justify-between gap-1">
        <span className="tabular text-sm font-bold">
          {discounted && (
            <span className="mr-1 text-[11px] font-normal text-tile-foreground/70 line-through">
              {money(compareAt)}
            </span>
          )}
          {money(price)}
        </span>
        {!soldOut && (
          <span className="tabular rounded-md bg-foreground/30 px-1.5 py-0.5 text-[11px] font-semibold">
            {stock}
          </span>
        )}
      </span>
    </button>
  );
}
