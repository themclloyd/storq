# Migrations

Ten files, down from sixty. Each numbered file is the ordered, verbatim
concatenation of a contiguous slice of the original migration history, so
replaying them top to bottom builds exactly the schema the sixty files built.
Numbered files after `009` are ordinary forward migrations, not part of that
squash.

Every original is kept unedited in `supabase/migration-archive/`, next to
`schema_migrations-before-squash.txt`, which records the sixty ledger rows these
ten files replaced.

All ten files are already recorded in the remote ledger, so `supabase db push`
has nothing to apply. A fresh `db reset` replays them in filename order and
rebuilds the live schema.

Four originals carried hand-typed versions that never matched what the ledger
recorded (`20261021120000`, `20261021150000`, `20261022120000`, `20261022130000`).
Their archived copies now use the ledger's versions, which is why the archive is
the authoritative mapping.

| File                                                                   | Covers                                                                                                                                                | Sources |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| `20261007084733_001_foundation_auth_and_rls.sql`                       | Foundation: tenants, auth, RLS and the security hardening pass                                                                                        | 19      |
| `20261010230825_002_retail_operations_catalog_and_stock.sql`           | Retail operations: catalogue, stock movement and sales summary                                                                                        | 8       |
| `20261017165825_003_store_settings_subscriptions_and_speed.sql`        | Store settings, subscription billing shape and read-path speed                                                                                        | 7       |
| `20261018215802_004_platform_operator_console.sql`                     | Platform operator console and tenant lifecycle                                                                                                        | 4       |
| `20261019213234_005_pin_sessions_stock_moves_and_expiry.sql`           | Device PIN sessions, direct stock moves and expiry grace                                                                                              | 4       |
| `20261020222117_006_offline_sync_desktop_release_and_input_guards.sql` | Offline sync, desktop release policy and input shape guards                                                                                           | 4       |
| `20261022195822_007_staff_permissions.sql`                             | Staff permissions: view/change grants and PIN hash secrecy                                                                                            | 3       |
| `20261022214141_008_payment_methods_billing_and_devices.sql`           | Payment methods, billing lifecycle and device-scoped reads                                                                                            | 8       |
| `20261023225018_009_rpc_grants_and_trial_policy.sql`                   | RPC grant fixes and the one-day trial policy                                                                                                          | 2       |
| `20261024173758_data_repair_trial_clip_backfill.sql`                   | Data repair: shortens trials handed out by the old fourteen-day backfill. Rewrites live rows, never folded into a baseline.                           | 1       |
| `20261024211253_010_multi_store_lifecycle.sql`                         | Multi-store lifecycle: archive/restore a location, co-terminous capacity pricing, renewal right-sizing, payment rate snapshot, operator `grace` state | 0       |
| `20261026230934_payment_attempt_ttl.sql`                               | Payment attempt lifetime: a checkout the buyer closed is closed after thirty minutes (or immediately, from the screen), stops being scanned, and stays activatable if the money lands late | 0       |
| `20261026231048_payment_attempt_cancelled_status.sql`                   | Repair: 011 closed attempts as `abandoned`, which `sub_payments_bounds` never allowed. The sweep, the cancel RPC and activation now use the table's own `cancelled` | 0       |

## Adding a migration

- One file per change, named `<timestamp>_<what_it_does>.sql` - never a bare UUID.
- A follow-up repair to something already applied gets its own file; do not
  edit a file that is already in the remote ledger.
- Version prefixes must be real timestamps (`YYYYMMDDHHMMSS`) taken from the
  clock, never typed by hand - that is what produced the four drifts above.
- Data-only repairs stay separate and say so in the name (`_data_repair_`).
- Apply through the Supabase MCP `apply_migration` tool, then keep the local
  filename at the exact version the remote ledger recorded.
