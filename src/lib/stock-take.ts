import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { downloadCsv, downloadPdf, fileStamp } from "@/lib/pdf";
import { t } from "@/lib/i18n";

export type StockTake = {
  id: string;
  store_id: string;
  status: string;
  created_at: string;
  closed_at: string | null;
  started_by: string | null;
  closed_by: string | null;
};

export type StockTakeLine = {
  product_id: string;
  expected: number;
  counted: number | null;
  counted_by: string | null;
};

export function useStockTake(id: string | undefined) {
  return useQuery({
    queryKey: ["take", id],
    enabled: !!id,
    // Start/finish invalidates ["take"]; a revisit inside the minute is instant.
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("stock_takes")
        .select("id,store_id,status,created_at,closed_at,started_by,closed_by")
        .eq("id", id!)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as StockTake | null;
    },
  });
}

export function useStockTakeLines(id: string | undefined, live = false) {
  return useQuery({
    queryKey: ["take-lines", id],
    enabled: !!id,
    // The counting screen polls for teammates; a finished session never changes.
    refetchInterval: live ? 15_000 : false,
    refetchIntervalInBackground: false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("stock_take_lines")
        .select("product_id,expected,counted,counted_by")
        .eq("stock_take_id", id!);
      if (error) throw error;
      return data as unknown as StockTakeLine[];
    },
  });
}

const shortDate = (d: string) =>
  new Date(d).toLocaleString("en-ZA", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

/** One session header; the counting screen and the exported report share it. */
export function stockTakeSubtitle(
  take: Pick<StockTake, "created_at" | "closed_at" | "started_by" | "closed_by">,
  storeName: string | null | undefined,
  staffNames: Record<string, string>,
) {
  const startedBy = take.started_by ? staffNames[take.started_by] : undefined;
  const closedBy = take.closed_by ? staffNames[take.closed_by] : undefined;
  return [
    storeName,
    startedBy
      ? t("stk.startedBy", { date: shortDate(take.created_at), name: startedBy })
      : `${t("stk.startedWord")} ${shortDate(take.created_at)}`,
    take.closed_at
      ? closedBy
        ? t("stk.closedBy", { date: shortDate(take.closed_at), name: closedBy })
        : `${t("stk.closedWord")} ${shortDate(take.closed_at)}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export type StockTakeReport = {
  take: StockTake;
  lines: StockTakeLine[];
  nameById: Record<string, string>;
  skuById: Record<string, string>;
  staffNames: Record<string, string>;
  storeName?: string | null | undefined;
  businessName?: string | null | undefined;
};

/**
 * The one stock take document: CSV rows and the branded PDF are built from the
 * same counted lines, so a re-export after finishing matches the screen.
 */
export async function downloadStockTakeReport(kind: "csv" | "pdf", src: StockTakeReport) {
  const { take, lines, nameById, skuById, staffNames, storeName, businessName } = src;
  const countedBy = (pid: string | null) => (pid ? (staffNames[pid] ?? "") : "");
  const rows = [...lines].sort((a, b) =>
    (nameById[a.product_id] ?? "").localeCompare(nameById[b.product_id] ?? ""),
  );
  let counted = 0;
  let diffs = 0;
  let net = 0;
  for (const l of rows) {
    if (l.counted === null) continue;
    counted++;
    const d = Number(l.counted) - Number(l.expected);
    if (d !== 0) diffs++;
    net += d;
  }
  net = Math.round(net * 100) / 100;

  if (kind === "csv") {
    downloadCsv(`storq-stocktake-${fileStamp()}.csv`, [
      ["item", "sku", "expected", "counted", "difference", "counted_by"],
      ...rows.map((l) => [
        nameById[l.product_id] ?? "",
        skuById[l.product_id] ?? "",
        Number(l.expected),
        l.counted === null ? "" : Number(l.counted),
        l.counted === null ? "" : Number(l.counted) - Number(l.expected),
        countedBy(l.counted_by),
      ]),
    ]);
    return;
  }

  await downloadPdf({
    filename: `storq-stocktake-${fileStamp()}`,
    title: t("stk.reportTitle"),
    business: businessName ?? undefined,
    subtitle: stockTakeSubtitle(take, storeName, staffNames),
    badge: t(`status.${take.status}`),
    orientation: "landscape",
    kpis: [
      [t("stk.itemsWord"), String(rows.length)],
      [t("stk.countedWord"), `${counted} / ${rows.length}`],
      [t("stk.withDiff"), String(diffs)],
      [t("stk.netVariance"), net > 0 ? `+${net}` : String(net)],
    ],
    sections: [
      {
        type: "table",
        head: [
          t("doc.item"),
          "SKU",
          t("stk.expectedCol"),
          t("stk.countedWord"),
          t("stk.varianceCol"),
          t("stk.countedByCol"),
        ],
        align: ["left", "left", "right", "right", "right", "left"],
        body: rows.map((l) => [
          nameById[l.product_id] ?? "",
          skuById[l.product_id] ?? "",
          Number(l.expected),
          l.counted === null ? "—" : String(Number(l.counted)),
          l.counted === null
            ? "—"
            : Number(l.counted) - Number(l.expected) > 0
              ? `+${Number(l.counted) - Number(l.expected)}`
              : String(Number(l.counted) - Number(l.expected)),
          countedBy(l.counted_by),
        ]),
      },
    ],
    footerNote:
      rows.length > counted ? t("stk.notCountedNote", { n: rows.length - counted }) : undefined,
  });
}
