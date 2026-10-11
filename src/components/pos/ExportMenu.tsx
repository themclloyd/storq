import { HugeiconsIcon } from "@hugeicons/react";
import { Download01Icon } from "@/lib/icons";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useI18n } from "@/lib/i18n";

/**
 * Collapses separate CSV and PDF buttons into one "Export" dropdown (spec §3).
 * The caller owns the actual download logic; this only routes the chosen format.
 */
export function ExportMenu({
  onExport,
  disabled,
  align = "end",
}: {
  onExport: (kind: "csv" | "pdf") => void;
  disabled?: boolean;
  align?: "start" | "center" | "end";
}) {
  const { t } = useI18n();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" disabled={disabled}>
          <HugeiconsIcon icon={Download01Icon} /> {t("common.export")}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align}>
        <DropdownMenuItem onSelect={() => onExport("csv")}>
          {t("common.exportCsv")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onExport("pdf")}>
          {t("common.exportPdf")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
