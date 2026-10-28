# Storq POS for Windows

The installed till. It runs the same React app the website ships, wrapped in a
Tauri shell so a shop counter gets what a browser tab cannot give it.

```
storqdesktop/
  src-tauri/          the Rust shell
    src/db.rs         local SQLite database (reference snapshot + unsent sales)
    src/tools.rs      native "Save as" for PDFs/CSVs and the system browser opener
    src/updater.rs    signed auto-update, driven by two commands
    src/lib.rs        window, single instance, command registration
    tauri.conf.json   window, CSP, installer and updater configuration
```

The frontend is the app in the repository root, built by `vite.config.desktop.ts`
into `dist-desktop/client` and served from disk. There is no second UI to keep in
sync: a fix to a screen, a report or a receipt reaches the installer too.

## What the shell adds

| Need            | How it works                                                                                                                                                                                                                               |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Durability      | Every persisted query snapshot and every unsent sale is mirrored into `storq.db` (WAL). The webview still reads its own `localStorage` for speed; SQLite is the copy that survives a profile reset, a repair install or "clear site data". |
| Offline selling | Unchanged from the website: a sale is queued on the device and replayed through `checkout_ref` with a client reference, so it can never be recorded twice. The queue is restored from SQLite before the first query runs.                  |
| Documents       | PDFs and CSVs open a real Windows save dialog; receipts print from a hidden frame instead of a popup window.                                                                                                                               |
| Links           | Anything that leaves the app (installation guide, WhatsApp, the PayChangu checkout) goes to the system browser, never to a chrome-less popup.                                                                                              |
| Updates         | The shell checks a signed feed once the workspace opens and offers to install; the minisign signature is what makes the feed untrusted storage.                                                                                            |
| Focus           | Launching the shortcut again focuses the open till instead of starting a second one, so there is exactly one PIN session per device.                                                                                                       |

Everything that used to be a server function is not: `src/lib/billing.functions`
is swapped for `src/lib/billing.desktop.ts`, which calls the deployed web API
(`POST /api/desktop/verify`, `GET /api/desktop/config`). Those two endpoints make
the same decision as the server functions — PayChangu still confirms the charge —
so the installer cannot grant itself time or capacity.

Routes live after the hash (`#/app/reports`) because a folder of static files
cannot answer a deep-link reload. The address bar is not visible, so this only
shows up in logs.

## Local development

```bash
bun install
bun run tauri:dev        # Vite dev server on :8080 + the shell with devtools
bun run build:desktop    # frontend bundle only (dist-desktop/client)
bun run tauri:build      # Windows installer
```

`bun run tauri:dev` needs WebView2 (present on Windows 10/11) and the Rust
toolchain with the MSVC target. `bun run tauri:build` writes:

- `storqdesktop/src-tauri/target/release/storq-desktop.exe`
- `storqdesktop/src-tauri/target/release/bundle/nsis/Storq POS_<version>_x64-setup.exe`

The installer is per-user (`installMode: currentUser`), so it needs no admin
rights and installs under `%LOCALAPPDATA%`. The database lives in
`%APPDATA%\xyz.storq.pos\storq.db`.

## Release

1. Bump the version in **both** `storqdesktop/src-tauri/tauri.conf.json` and
   `storqdesktop/src-tauri/Cargo.toml` (`Cargo.lock` follows on the next build).
2. Build and sign (`bundle.createUpdaterArtifacts` is already `true`, so this
   emits `Storq POS_<version>_x64-setup.exe.sig` alongside the installer):

   ```bash
   export TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/storq_updater.key)"
   export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="..."
   bun run tauri:build
   ```

3. Publish to the `storq-updates` bucket on the Supabase project:

   | Object                                          | Purpose                                                                                                                              |
   | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
   | `desktop/StorqPOS-latest.exe`                   | The download link on the landing page and in the app (`DESKTOP_DOWNLOAD_URL` in `src/lib/desktop.ts`). Overwritten on every release. |
   | `desktop/Storq POS_<version>_x64-setup.exe`     | The immutable, versioned installer the updater downloads.                                                                            |
   | `desktop/Storq POS_<version>_x64-setup.exe.sig` | Its minisign signature.                                                                                                              |
   | `desktop/latest.json`                           | The feed the installed app polls.                                                                                                    |

   `desktop/latest.json`:

   ```json
   {
     "version": "1.1.0",
     "notes": "What changed, as the operator reads it.",
     "pub_date": "2026-11-01T12:00:00Z",
     "platforms": {
       "windows-x86_64": {
         "signature": "<contents of the .sig file>",
         "url": "https://<project>.supabase.co/storage/v1/object/public/storq-updates/desktop/Storq%20POS_1.1.0_x64-setup.exe"
       }
     }
   }
   ```

4. The public half of the signing key is already in `plugins.updater.pubkey` in
   `tauri.conf.json` (minisign key `5C66E3C7AD77EEDD`), so an installed build only
   accepts an update whose `.sig` that key verifies. If it were empty the updater
   would stay silent (`check_update` returns nothing) and the app would simply
   keep running its installed build.

The endpoint is public storage on purpose: the signature, not the URL, is what
decides whether an update is ours. Keep the private key out of the repository and
out of the CI logs.

## Notes and boundaries

- The window CSP allows exactly what the till needs: Supabase over https/wss,
  PayChangu's checkout frame and script, Turnstile, and the deployment that serves
  the two desktop endpoints. Adding a third-party script means adding its origin.
- Nothing role-gated is mirrored into SQLite. The frontend only writes the same
  reference queries it is allowed to persist for every staff member, so one
  person's lock/unlock cannot leave another person's costs on the disk.
- Stock, payments and permissions are decided in Postgres, never here. The shell
  is a delivery mechanism: removing the network from it cannot invent a sale,
  and closing it cannot lose one.
