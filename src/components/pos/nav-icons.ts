import {
  BarChartIcon,
  BoxesIcon,
  DashboardSquare01Icon,
  PackageIcon,
  ReceiptIcon,
  ShoppingBag01Icon,
  StoreIcon,
} from "@/lib/icons";
import type { WorkspaceGroup } from "@/lib/workspace-navigation";

/** One glyph per area of the product; the rail and the mobile bar share them. */
export const navIcons: Record<WorkspaceGroup, typeof BoxesIcon> = {
  dashboard: DashboardSquare01Icon,
  register: ShoppingBag01Icon,
  sales: ReceiptIcon,
  inventory: PackageIcon,
  finance: BarChartIcon,
  settings: StoreIcon,
};
