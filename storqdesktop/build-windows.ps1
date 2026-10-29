<#
  Build the Windows installer, Authenticode-signed when this machine holds a
  code-signing certificate.

  `bun run tauri:build` runs this. Three steps:

  1. sign-windows.ps1 writes src-tauri/tauri.sign.json - the signing identity,
     or `{}` on a machine that has none.
  2. `tauri build` is given both configs, in order, so the generated one wins
     over the committed one and the repository never carries a thumbprint.
  3. The finished installer is read back with Get-AuthenticodeSignature and
     reported.

  Why the two outcomes are treated differently: a laptop without the token
  must still produce a working installer, so a missing certificate is only a
  warning. An installer that was *meant* to be signed and is not, is a
  different thing entirely - it is what a shop downloads and what SmartScreen
  refuses - so that fails the build. A certificate that is configured but
  cancelled (no PIN, token pulled out) must never reach the release folder
  looking like a success.

  Why the timestamp is checked and not just the signature: a signature without
  one stops verifying the day the certificate expires, and every shop is back
  to "Unknown publisher" with no change on our side.

  Only the installer is read back, not target/release/storq-desktop.exe: the
  bundler copies that binary, patches it, signs the copy, embeds it in the
  installer and then restores the untouched original, so the file left on disk
  is deliberately unsigned and is not the one a shop runs.

  Environment (all optional, read by sign-windows.ps1):
    STORQ_SIGN_PFX / STORQ_SIGN_PFX_PASSWORD   a .pfx file
    STORQ_SIGN_THUMBPRINT                      a certificate already in the store
    STORQ_SIGN_SUBJECT                         narrow discovery by subject
    STORQ_TIMESTAMP_URL                        RFC 3161 server (default DigiCert)
#>

[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

# Same module path problem as sign-windows.ps1: `bun run` hands PowerShell 7's
# PSModulePath to Windows PowerShell 5.1, which then cannot load the cmdlet that
# reads the signature back. Set before the first module-backed command runs.
if ($PSVersionTable.PSEdition -eq "Desktop") {
    $env:PSModulePath = @(
        (Join-Path $env:ProgramFiles "WindowsPowerShell\Modules"),
        (Join-Path $env:windir "system32\WindowsPowerShell\v1.0\Modules")
    ) -join ";"
}

$shell = $PSScriptRoot                        # storqdesktop
$configDir = Join-Path $shell "src-tauri"
$config = Join-Path $configDir "tauri.conf.json"
$signConfig = Join-Path $configDir "tauri.sign.json"
$releaseDir = Join-Path $configDir "target\release"

# Throws when a certificate was named but cannot be used, so a mistyped
# thumbprint fails here instead of producing an unsigned installer.
& (Join-Path $shell "sign-windows.ps1") -OutFile $signConfig

$signing = Get-Content -LiteralPath $signConfig -Raw | ConvertFrom-Json
$thumbprint = $null
$timestampUrl = "the configured timestamp server"
if ($signing.bundle -and $signing.bundle.windows) {
    $thumbprint = $signing.bundle.windows.certificateThumbprint
    $timestampUrl = $signing.bundle.windows.timestampUrl
}

$tauri = Join-Path (Split-Path -Parent $shell) "node_modules\.bin\tauri.exe"
if (-not (Test-Path -LiteralPath $tauri)) {
    throw "The Tauri CLI is missing. Run `bun install` first."
}

& $tauri build --config $config --config $signConfig
if ($LASTEXITCODE -ne 0) {
    throw "tauri build exited with code $LASTEXITCODE."
}

$version = (Get-Content -LiteralPath $config -Raw | ConvertFrom-Json).version
$installer = Get-ChildItem -LiteralPath (Join-Path $releaseDir "bundle\nsis") -Filter "*_${version}_x64-setup.exe" |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1

if (-not $installer) {
    throw "The build finished but no *_${version}_x64-setup.exe is in bundle\nsis."
}

function Assert-SignedArtifact {
    param([string] $Path)

    $name = Split-Path -Leaf $Path

    if (-not (Test-Path -LiteralPath $Path)) {
        throw "Expected $Path after the build, and it is not there."
    }

    $signature = Get-AuthenticodeSignature -LiteralPath $Path

    if ($signature.Status -ne "Valid") {
        $hint = if ($signature.Status -eq "UnknownError") {
            " This usually means the CA's root or intermediate certificate is not installed yet; let Windows Update deliver it, or import it, then build again."
        } else {
            ""
        }

        throw "$name did not verify: $($signature.Status) - $($signature.StatusMessage).$hint"
    }

    if (-not $signature.TimeStamperCertificate) {
        throw "$name is signed but has no timestamp, so the signature dies with the certificate. Check that $timestampUrl is reachable."
    }

    Write-Host "  ok          $name"
    Write-Host "              $($signature.SignerCertificate.Subject)"
    Write-Host "              timestamped by $($signature.TimeStamperCertificate.Subject)"
}

Write-Host ""

if ($thumbprint) {
    Write-Host "Verifying the Authenticode signature"
    Assert-SignedArtifact -Path $installer.FullName
}
else {
    Write-Warning @"
This installer is unsigned, so Windows SmartScreen will show "Windows
protected your PC" and "Unknown publisher" to every shop that downloads it.
Nothing is wrong with the build - this machine simply has no code-signing
certificate. Do not publish it as a release: put the OV certificate in the
current user's store (or set STORQ_SIGN_PFX) and build again.
"@
}

Write-Host ""
Write-Host "Installer   $($installer.FullName)"
Write-Host "Size        $([math]::Round($installer.Length / 1MB, 2)) MiB"

$signatureFile = "$($installer.FullName).sig"
if (Test-Path -LiteralPath $signatureFile) {
    Write-Host "Updater sig $signatureFile"
}
