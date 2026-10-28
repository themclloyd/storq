import {
  Archive01Icon,
  ArrowReloadHorizontalIcon,
  BarChartIcon,
  BoxesIcon,
  DashboardSquare01Icon,
  GridViewIcon,
  PackageIcon,
  ReceiptIcon,
  ShoppingBag01Icon,
  StoreIcon,
} from "@/lib/icons";
import type { WorkspaceGroup, WorkspacePath } from "@/lib/workspace-navigation";

/** One glyph per area of the product; the rail and the mobile bar share them. */
export const navIcons: Record<WorkspaceGroup, typeof BoxesIcon> = {
  dashboard: DashboardSquare01Icon,
  register: ShoppingBag01Icon,
  sales: ReceiptIcon,
  inventory: PackageIcon,
  finance: BarChartIcon,
  settings: StoreIcon,
};

/**
 * Glyphs for the pages a menu lists as siblings — the inventory tools reached
 * from the inventory page's actions menu. Only pages that appear in such a
 * menu need an entry; anything else falls back to the area glyph.
 */
export const pageIcons: Partial<Record<WorkspacePath, typeof PackageIcon>> = {
  "/app/transfers": ArrowReloadHorizontalIcon,
  "/app/collections": GridViewIcon,
  "/app/stocktake": Archive01Icon,
};
