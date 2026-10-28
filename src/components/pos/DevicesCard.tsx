import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import { SmartPhone01Icon } from "@/lib/icons";
import { usePos } from "@/lib/pos";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { fmtDate } from "@/components/pos/bits";
import { RowsSkeleton } from "@/components/pos/skeletons";

/** One live PIN session, as `account_devices` returns it. */
type AccountDevice = {
  device_id: string;
  staff_id: string;
  staff_name: string;
  created_at: string;
  expires_at: string;
  is_current: boolean;
};

/**
 * A short handle for a till. `device_id` is a UUID, which reads as noise, but two
 * sessions opened by the same person are otherwise identical rows, the owner
 * cannot tell which one is the phone upstairs and which is the counter.
 */
function tillHandle(deviceId: string) {
  return deviceId
    .replace(/[^0-9a-zA-Z]/g, "")
    .slice(-4)
    .toUpperCase();
}

/**
 * The shop's other tills.
 *
 * The business login is shared by every register, so the only thing that says
 * "this phone is open" is its PIN session row, which nothing in the product
 * could see or end before. A phone left signed in on a counter is a shop that
 * anyone can walk up to and sell from, so this lists them and lets the owner
 * cut one off without waiting out its eight hours.
 *
 * The current till has no button: ending it is a sign-out, and it is done from
 * the pad. Reading the list needs `view_staff`; ending one needs `staff`.
 */
export function DevicesCard() {
  const { t } = useI18n();
  const { rpc, can, staff } = usePos();
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const manage = can("staff");

  const devices = useQuery({
    queryKey: ["account-devices", staff?.id],
    enabled: !!staff,
    staleTime: 30_000,
    queryFn: async () => (await rpc<AccountDevice[] | null>("account_devices")) ?? [],
  });

  async function end(deviceId: string) {
    // Two taps: the first asks, the second does it. A till ended by mistake
    // costs that person a walk back to the pad, so it is worth a pause.
    if (confirming !== deviceId) {
      setConfirming(deviceId);
      return;
    }
    setBusy(deviceId);
    try {
      await rpc("revoke_device", { p_device_id: deviceId });
      toast.success(t("staff.devicesEnded"));
      setConfirming(null);
      await devices.refetch();
    } catch (e) {
      toast.error((e as Error).message || t("staff.devicesFailed"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="mb-4 p-4">
      <div className="flex items-center gap-2 text-[13px] font-semibold">
        <HugeiconsIcon icon={SmartPhone01Icon} className="size-4 text-muted-foreground" />
        {t("staff.devicesTitle")}
      </div>
      <p className="mt-0.5 text-xs text-muted-foreground">{t("staff.devicesDesc")}</p>
      <div className="mt-2 divide-y">
        {devices.isPending ? (
          <RowsSkeleton rows={2} className="py-2" />
        ) : !devices.data?.length ? (
          <p className="py-2 text-[12px] text-muted-foreground">{t("staff.devicesEmpty")}</p>
        ) : (
          devices.data.map((d) => (
            <div
              key={`${d.device_id}:${d.staff_id}`}
              className="flex flex-wrap items-center justify-between gap-2 py-2 text-[13px]"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5 font-medium">
                  <span className="truncate">{d.staff_name}</span>
                  <span className="tabular rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground">
                    {t("staff.deviceHandle", { id: tillHandle(d.device_id) })}
                  </span>
                  {d.is_current && (
                    <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[11px] font-semibold text-primary">
                      {t("staff.devicesCurrent")}
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {t("staff.devicesSignedIn", { when: fmtDate(d.created_at) })} ·{" "}
                  {t("staff.devicesExpires", { when: fmtDate(d.expires_at) })}
                </div>
              </div>
              {manage && !d.is_current && (
                <Button
                  size="sm"
                  variant={confirming === d.device_id ? "destructive" : "outline"}
                  disabled={busy === d.device_id}
                  onClick={() => void end(d.device_id)}
                >
                  {busy === d.device_id
                    ? t("common.saving")
                    : confirming === d.device_id
                      ? t("staff.devicesEndConfirm")
                      : t("staff.devicesEnd")}
                </Button>
              )}
            </div>
          ))
        )}
      </div>
    </Card>
  );
}
