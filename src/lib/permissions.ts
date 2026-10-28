/**
 * Access is a checklist, not a job title.
 *
 * The person created with the business is the owner and holds everything.
 * Everyone added afterwards gets exactly the boxes the owner ticks, and each
 * area of the product offers two of them: **view** (read the screen) and
 * **change** (act on it). A change grant always includes its view grant, so a
 * list only names a view key where the person cannot act in that area.
 *
 * The database enforces the same model (`app.expand_perms` / `app.require_perm`
 * and the 12-key `app.all_permissions()`), so hiding a button here is a
 * courtesy, an RPC refuses a view-only session either way.
 */
export const AREAS = ["sales", "stock", "approvals", "money", "staff", "locations"] as const;

export type Area = (typeof AREAS)[number];

/** Canonical order for every stored list; the two boxes per area sit together. */
export const PERMISSIONS = [
  "sell",
  "stock",
  "approvals",
  "money",
  "staff",
  "locations",
  "view_sales",
  "view_stock",
  "view_approvals",
  "view_money",
  "view_staff",
  "view_locations",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export type AreaGrants = { view: Permission; change: Permission };

export const AREA_GRANTS: Record<Area, AreaGrants> = {
  sales: { view: "view_sales", change: "sell" },
  stock: { view: "view_stock", change: "stock" },
  approvals: { view: "view_approvals", change: "approvals" },
  money: { view: "view_money", change: "money" },
  staff: { view: "view_staff", change: "staff" },
  locations: { view: "view_locations", change: "locations" },
};

/** The two facts the database returns with a PIN session. */
export type Access = {
  owner: boolean;
  permissions: readonly string[];
};

/** i18n dot-keys for the access grid, in display order. */
export const AREA_LABEL_KEYS: Record<Area, string> = {
  sales: "staff.permSell",
  stock: "staff.permStock",
  approvals: "staff.permApprovals",
  money: "staff.permMoney",
  staff: "staff.permStaff",
  locations: "staff.permLocations",
};

export const AREA_DESC_KEYS: Record<Area, string> = {
  sales: "staff.permSellDesc",
  stock: "staff.permStockDesc",
  approvals: "staff.permApprovalsDesc",
  money: "staff.permMoneyDesc",
  staff: "staff.permStaffDesc",
  locations: "staff.permLocationsDesc",
};

/**
 * The grants that open an area's screens: either box does it, so a view-only
 * person reaches the page and a change holder reaches it too.
 */
export function areaPerms(area: Area): Permission[] {
  return [AREA_GRANTS[area].view, AREA_GRANTS[area].change];
}

/**
 * True when this person holds at least one of `perms`; an empty list means
 * "everyone signed in" (the dashboard). The owner holds everything.
 */
export function permits(access: Access | null | undefined, perms: readonly Permission[] = []) {
  if (!access) return false;
  if (access.owner || perms.length === 0) return true;
  return perms.some((p) => access.permissions.includes(p));
}

/** Read access to an area, whether through its own box or through change. */
export function canView(access: Access | null | undefined, area: Area) {
  return permits(access, areaPerms(area));
}

/** May act in an area. A view-only grant never satisfies this. */
export function canChange(access: Access | null | undefined, area: Area) {
  return permits(access, [AREA_GRANTS[area].change]);
}

/** One area as the two checkboxes read it. */
export function areaAccess(access: Access | null | undefined, area: Area) {
  const change = canChange(access, area);
  return { view: change || canView(access, area), change };
}

/**
 * Mirror of `app.expand_perms`: a change grant brings its view grant with it.
 * Used to decide which boxes an editor may tick, an editor who may change
 * stock may also hand out the read-only view of it.
 */
export function expandPermissions(perms: readonly string[]): Permission[] {
  const out = new Set<Permission>(toPermissions(perms));
  for (const area of AREAS) {
    const grants = AREA_GRANTS[area];
    if (out.has(grants.change)) out.add(grants.view);
  }
  return PERMISSIONS.filter((p) => out.has(p));
}

/**
 * Narrow an untrusted list (a cached session, an RPC payload) to known grants
 * in canonical order, so an unknown or stale value can never widen access.
 */
export function toPermissions(raw: unknown): Permission[] {
  if (!Array.isArray(raw)) return [];
  return PERMISSIONS.filter((p) => raw.includes(p));
}
