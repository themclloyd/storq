import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { visibleWorkspacePages, workspacePageAt } from "@/lib/workspace-navigation";
import type { Role, Store } from "@/lib/pos";

export function WorkspaceTabs({ path, role, storeType }: { path: string; role: Role; storeType?: Store["store_type"] | undefined }) {
  const current = workspacePageAt(path);
  const pages = visibleWorkspacePages(role, storeType).filter((page) => page.group === current?.group);
  if (pages.length < 2) return null;
  return (
    <nav aria-label={`${current?.group === "finance" ? "Reports" : current?.group === "settings" ? "Settings" : current?.group === "inventory" ? "Inventory" : current?.group === "register" ? "Register" : "Sales"} pages`} className="mb-4 flex gap-1 overflow-x-auto border-b pb-1.5">
      {pages.map((page) => (
        <Button asChild variant="ghost" size="sm" key={page.to} className={cn("shrink-0 text-[13px]", current?.to === page.to ? "bg-secondary text-foreground" : "text-muted-foreground")}>
          <Link to={page.to} aria-current={current?.to === page.to ? "page" : undefined}>{page.label}</Link>
        </Button>
      ))}
    </nav>
  );
}