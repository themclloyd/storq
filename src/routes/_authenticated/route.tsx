import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { currentUserId } from "@/lib/auth-session";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    // One verified, memoized check per session instead of a call to the Auth
    // server on every navigation. The database still authorizes every read
    // and write, so a tampered local session can never see another tenant.
    const userId = await currentUserId();
    if (!userId) throw redirect({ to: "/auth" });
    return { user: { id: userId } };
  },
  component: () => <Outlet />,
});
