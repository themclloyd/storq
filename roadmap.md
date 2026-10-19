# Storq visual refresh

## Paid store enforcement

- [x] Research Shopify POS per-location subscriptions and audit Storq billing.
- [x] Enforce paid store capacity server-side and explain capacity in Stores and Billing.
- [x] Verify guards, payment activation, and app checks with 22 tests and rollback-only database checks.
- [ ] Verify a real payment and signed-in store creation through the UI. Blocker: external unmanaged sign-in has no available session.

Verification: build OK; database checks passed for store limits, over-capacity write denial, activation, duplicate confirmations and proportional prepaid credit; no test records retained. Live billing redirects to sign-in without runtime errors.

- [x] Apply light workspace tokens with charcoal text, lime accents and consistent controls.
- [x] Refresh navigation, sign-in and billing presentation without changing workflows.
- [x] Check content-page metadata and verify accessible screens.

Verification: light-mode sign-in checked visually; build OK. Signed-in billing and dashboard checks are unavailable with this project's external sign-in setup.

## Store-aware navigation

- [x] Group inventory, sales, financial and business tools without removing existing URLs or staff access.
- [x] Show approval workflows only for approval stores and keep layby in both types.
- [x] Test navigation policies and checkout controls; check preview where access is available.
- [ ] Verify signed-in tab navigation and store switching end-to-end. Blocker: external unmanaged sign-in has no available authenticated test session.

Verification: 15 navigation/checkout/routing tests passed; build OK. Preview reaches sign-in without runtime errors. Switching stores remounts page state to prevent carrying checkout or open dialogs into another store.

## Device-isolated PIN sessions and security hardening

- [x] Add a stable per-device id (persisted in localStorage) and pass it to `unlock_with_pin` so tills sharing one business login stay independent.
- [x] Scope PIN throttling and session replacement to `(business_id, auth_uid, device_id)` — one till's bad PINs no longer lock the whole shop, and unlocking one register no longer kicks another off.
- [x] Convert `my_platform_role()` to SECURITY INVOKER (its `platform_admins` RLS already scopes to `auth.uid()`), keeping the `active` gate so revoked operators resolve to NULL.
- [x] Add explicit deny-all policies to `platform_audit_log` and `platform_deleted_tenants`, and reaffirm `ops_*` are closed to `anon`/PUBLIC while operators (authenticated) reach them via `require_platform_admin`.
- [x] Verify with migration rollback-only database checks plus the full test suite.

Verification: two migrations applied (`20261019213234_device_isolated_pin_sessions`, `20261019213252_ops_security_linter_hardening`); database security linter no longer reports `my_platform_role` as a DEFINER callable by sessions nor the audit tables as RLS-without-policy; `tsc`, `eslint` and 107 vitest tests pass. The remaining `ops_*` "authenticated + SECURITY DEFINER" lint is intentional and matches every guarded business RPC in this schema.

## Direct stock moves, one billing wizard and expiry grace

- [x] Make a stock transfer a single atomic move: `app.create_transfer()` deducts at the source and books the destination inside the same transaction, so nothing waits in transit. Rows still open when this shipped were backfilled to their destination first.
- [x] Drop `receive_transfer` and `cancel_transfer` from both schemas and revoke the residue; the transfers screen loses receive/cancel and now reads "Move stock".
- [x] Merge the three billing wizard dialogs into one dialog with a mode tab row ("Renew all stores" / "Add a location", or a single choose-a-plan tab on a trial), leaving pricing math untouched — one `subscriptions.paid_until` per business already co-times every store.
- [x] Stretch paid-expiry enforcement by three days inside `subscription_active()` so a shop keeps selling while the mobile-money SIM holder is away, mirrored in `subscriptionAccess()` as `inGrace` / `graceDaysRemaining`. Suspension, closure and over-capacity still refuse writes immediately.
- [x] Add an amber grace banner to the workspace shell and the billing page with a WhatsApp hand-off (`wa.me`, defaulting to the store's own number) so any cashier can send the renewal to the owner, and an "Already debited? Check now" button wherever a pending PayChangu reference survives.
- [x] Show the three mobile-money steps in the payment-method sheet plus one line while the checkout window is open, so a manual USSD approval is never mistaken for a failure.
- [x] Drop the `--` heuristic from the client validator — every write is a parameterized RPC, so the rule only produced false positives — while control characters and markup are still refused for CSV and print paths.
- [x] Move `PRICES`, `MONTH_PRESETS`, `calcTotal` and `fmtMoney` into `src/lib/billing.ts` so the shared pricing math has one client-safe home.

Verification: two migrations applied (`20261019220200_direct_stock_moves`, `20261019220255_expiry_grace`); database spot checks show zero `in_transit` rows, `receive_transfer` and `cancel_transfer` absent from `pg_proc` with `create_transfer` still granted in both schemas, and the redefined `subscription_active()` carrying the 3-day interval while still returning `true` for the live tenant. Prettier, `tsc --noEmit`, `eslint` over the touched files and both i18n catalogs, and 115 vitest tests pass. The signed-in screens could not be clicked through: this environment has no staff PIN session.
