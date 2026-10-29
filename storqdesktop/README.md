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

The installer is machine-wide (`installMode: perMachine`), so it needs one admin
approval and installs under `%ProgramFiles%\Storq POS` for every Windows account
on the counter PC. It writes a Start Menu entry and a desktop shortcut (see
`src-tauri/installer-hooks.nsh`), and removes a per-user copy left by 1.1.0 or
earlier before it installs, so a shop never ends up with two icons pointing at
two builds. The database lives in `%APPDATA%\xyz.storq.pos\storq.db`, per
Windows account, and an uninstall keeps it unless the "delete app data" box is
ticked.

Because the files sit in `Program Files`, an update needs the same approval:
Windows raises the elevation prompt when the app installs the new build, so
whoever accepts an update needs admin rights on that PC.

## Release

1. Bump the version in **both** `storqdesktop/src-tauri/tauri.conf.json` and
   `storqdesktop/src-tauri/Cargo.toml` (`Cargo.lock` follows on the next build).
2. Put the code-signing certificate where the build can see it — insert the USB
   token, or point `STORQ_SIGN_PFX` at the `.pfx` (see [Signing](#signing)).
3. Build and sign (`bundle.createUpdaterArtifacts` is already `true`, so this
   also emits `Storq POS_<version>_x64-setup.exe.sig` alongside the installer):

   ```powershell
   $env:TAURI_SIGNING_PRIVATE_KEY = Get-Content -Raw "$env:USERPROFILE\.tauri\storq_updater.key"
   $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "..."
   bun run tauri:build
   ```

   The last block of output is the Authenticode check: the app executable and
   the installer both report `ok` with their signer and timestamp, or the build
   stops. Only then is the folder worth publishing.

4. Publish to the `storq-updates` bucket on the Supabase project:

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

5. The public half of the signing key is already in `plugins.updater.pubkey` in
   `tauri.conf.json` (minisign key `5C66E3C7AD77EEDD`), so an installed build only
   accepts an update whose `.sig` that key verifies. If it were empty the updater
   would stay silent (`check_update` returns nothing) and the app would simply
   keep running its installed build.

The endpoint is public storage on purpose: the signature, not the URL, is what
decides whether an update is ours. Keep the private key out of the repository and
out of the CI logs.

## Signing

Two signatures ship with an installer and they answer different questions:

| Signature          | Answers                                                                                       | Written by                                           |
| ------------------ | --------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Authenticode       | who published this file, and has it changed since? — what SmartScreen and the UAC prompt read | `signtool`, driven by `bun run tauri:build`          |
| minisign (updater) | is this update ours?                                                                          | `tauri build`, into the `.sig` next to the installer |

The first one is what a shop sees. An installer with no Authenticode signature
gets "Windows protected your PC" and a grey "Unknown publisher", and the only way
past it is _More info → Run anyway_ — which trains staff to click through the one
warning that matters. A signed installer carries the name from the certificate
instead.

`storqdesktop/build-windows.ps1` is what `bun run tauri:build` runs. It asks
`sign-windows.ps1` which certificate to use, writes that identity to
`src-tauri/tauri.sign.json` and passes it to `tauri build` as a second `--config`.
The thumbprint is deliberately not in `tauri.conf.json`: it names one certificate
store, not the repository. The generated file is git-ignored, and on a machine
with no certificate it is `{}` — the build then runs unsigned and says so rather
than pretending otherwise.

Where the certificate comes from, first match wins:

| Setting                                        | Meaning                                                                                                                                 |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `STORQ_SIGN_PFX` (+ `STORQ_SIGN_PFX_PASSWORD`) | the `.pfx` file; imported into the current user's store once, because that is the store `signtool` reads                                |
| `STORQ_SIGN_THUMBPRINT`                        | a certificate already in `Cert:\CurrentUser\My`                                                                                         |
| neither                                        | discovery: the newest unexpired code-signing certificate holding a private key in that store — what a USB token registers when inserted |

`STORQ_SIGN_SUBJECT` narrows discovery when the store holds several certificates,
and `STORQ_TIMESTAMP_URL` replaces the timestamp server. It defaults to DigiCert's
RFC 3161 endpoint because timestamping is independent of who sold the
certificate — any authority can stamp any CA's signature.

Three things the build refuses to fudge:

- **A signature without a timestamp is a failure.** It stops verifying the day the
  certificate expires, and every shop is abruptly back to "Unknown publisher"
  with nothing changed on our side.
- **An unsigned build is not a release.** It still produces an installer — a
  laptop without the token has to be able to build — but it prints what SmartScreen
  will show and must not be published.
- **A certificate that was named but cannot sign fails before Rust compiles.**
  Expired, no private key on this account, not a code-signing certificate (the EKU
  1.3.6.1.5.5.7.3.3 is checked), or sitting in the machine store where `signtool`
  will not look.

What this does and does not change about the warning: the publisher name replaces
"Unknown", and SmartScreen starts trusting the download as it accumulates
downloads. It is not instant — reputation is earned per certificate and each new
version starts earning it again. A self-signed certificate is worse than none:
Windows does not trust it and the block stays.

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
