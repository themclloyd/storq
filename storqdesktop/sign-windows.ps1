<#
  Decide which code-signing certificate this machine signs the installer with,
  and write the Tauri override that makes `tauri build` use it.

  Why the identity is not in tauri.conf.json: a thumbprint belongs to one
  machine's certificate store - a USB token plugged in today, a .pfx imported
  on the release laptop - not to the repository. Committing one would mean
  every other machine builds against a certificate it cannot resolve, and a
  build that silently skips signing is worse than one that never claimed to.
  So tauri.conf.json stays unsigned and this script writes
  src-tauri/tauri.sign.json, which build-windows.ps1 merges in as the last
  --config.

  Why it matters at all: SmartScreen's "Windows protected your PC" banner and
  the "Unknown publisher" line under it are attached to an installer with no
  Authenticode signature. A valid signature puts the publisher's name there
  instead, and that is the only lever a vendor has over the warning.

  Resolution order, first hit wins:
    1. STORQ_SIGN_PFX (+ STORQ_SIGN_PFX_PASSWORD) - a file, imported into the
       current user's store once.
    2. STORQ_SIGN_THUMBPRINT - a certificate already in the current user's
       store.
    3. Discovery - the newest unexpired code-signing certificate holding a
       private key in the current user's store, which is what a token
       registers when it is inserted.

  Output: src-tauri/tauri.sign.json. When nothing is found it is written as
  `{}` and the script only warns - the build must still run on a machine
  without the token.
#>

[CmdletBinding()]
param(
    # Resolved below rather than here: Windows PowerShell 5.1 evaluates a
    # parameter default before $PSScriptRoot exists, and silently hands
    # Join-Path an empty path.
    [string] $OutFile,

    # Timestamps are what keep a signature valid after the certificate itself
    # expires, and any RFC 3161 authority can stamp any CA's certificate, so
    # DigiCert's is a safe default for an OV certificate bought elsewhere.
    [string] $TimestampUrl = $(if ($env:STORQ_TIMESTAMP_URL) { $env:STORQ_TIMESTAMP_URL } else { "http://timestamp.digicert.com" })
)

$ErrorActionPreference = "Stop"

if (-not $OutFile) {
    $OutFile = Join-Path $PSScriptRoot "src-tauri\tauri.sign.json"
}

# `bun run` inherits the environment of the terminal that started it. Started
# from PowerShell 7 - which is the default on this project - Windows PowerShell
# 5.1 receives PS7's module path, fails to load Microsoft.PowerShell.Security
# and ends up with no Certificate provider and no signing cmdlets at all. Point
# it back at its own modules before anything touches the store.
if ($PSVersionTable.PSEdition -eq "Desktop") {
    $env:PSModulePath = @(
        (Join-Path $env:ProgramFiles "WindowsPowerShell\Modules"),
        (Join-Path $env:windir "system32\WindowsPowerShell\v1.0\Modules")
    ) -join ";"
}

# Code Signing EKU, 1.3.6.1.5.5.7.3.3. An OV certificate usually also carries
# Server Authentication, so the EKU is the only reliable way to tell "may sign
# code" from "someone once imported this into My". It is read from the
# extension itself (2.5.29.37) because X509Certificate2 exposes no usage list.
$codeSigningOid = "1.3.6.1.5.5.7.3.3"
$ekuExtensionOid = "2.5.29.37"

function Get-UsageOids {
    param([System.Security.Cryptography.X509Certificates.X509Certificate2] $Certificate)

    $extension = $Certificate.Extensions | Where-Object { $_.Oid.Value -eq $ekuExtensionOid } | Select-Object -First 1
    if (-not $extension) { return @() }

    $usage = New-Object System.Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension($extension, $false)

    return @($usage.EnhancedKeyUsages | ForEach-Object { $_.Value })
}

function Test-CodeSigningCertificate {
    param([System.Security.Cryptography.X509Certificates.X509Certificate2] $Certificate)

    if (-not $Certificate.HasPrivateKey) { return $false }
    if ($Certificate.NotAfter -le (Get-Date)) { return $false }

    return (Get-UsageOids -Certificate $Certificate) -contains $codeSigningOid
}

function Get-UserCertificate {
    param([string] $Thumbprint)

    # signtool runs as `signtool /sha1 <thumbprint>`, which reads the current
    # user's store, so that is the only store worth looking in.
    $path = "Cert:\CurrentUser\My\$($Thumbprint -replace '\s', '')"
    if (-not (Test-Path -LiteralPath $path)) { return $null }

    return Get-Item -LiteralPath $path
}

$certificate = $null

if ($env:STORQ_SIGN_PFX) {
    $pfx = $env:STORQ_SIGN_PFX
    if (-not (Test-Path -LiteralPath $pfx)) {
        throw "STORQ_SIGN_PFX points at '$pfx', which does not exist."
    }

    # Read the file first to learn the thumbprint, so a second build does not
    # pile duplicate copies of the same certificate into the store.
    $fromFile = if ($env:STORQ_SIGN_PFX_PASSWORD) {
        New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($pfx, $env:STORQ_SIGN_PFX_PASSWORD)
    } else {
        New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($pfx)
    }

    $certificate = Get-UserCertificate -Thumbprint $fromFile.Thumbprint

    if (-not $certificate) {
        if ($env:STORQ_SIGN_PFX_PASSWORD) {
            $password = ConvertTo-SecureString -String $env:STORQ_SIGN_PFX_PASSWORD -AsPlainText -Force
            Import-PfxCertificate -FilePath $pfx -CertStoreLocation "Cert:\CurrentUser\My" -Password $password | Out-Null
        } else {
            Import-PfxCertificate -FilePath $pfx -CertStoreLocation "Cert:\CurrentUser\My" | Out-Null
        }

        $certificate = Get-UserCertificate -Thumbprint $fromFile.Thumbprint
    }
}
elseif ($env:STORQ_SIGN_THUMBPRINT) {
    $thumbprint = ($env:STORQ_SIGN_THUMBPRINT -replace '\s', '').ToUpperInvariant()
    $certificate = Get-UserCertificate -Thumbprint $thumbprint

    if (-not $certificate) {
        if (Test-Path -LiteralPath "Cert:\LocalMachine\My\$thumbprint") {
            throw "Certificate $thumbprint is in the machine store only. signtool looks in the current user's store, so import it there or pass it as STORQ_SIGN_PFX."
        }

        throw "No certificate with thumbprint $thumbprint in the current user's store. Insert the token, or import the .pfx with STORQ_SIGN_PFX."
    }
}
else {
    $candidates = @(Get-ChildItem Cert:\CurrentUser\My | Where-Object { Test-CodeSigningCertificate -Certificate $_ })

    if ($env:STORQ_SIGN_SUBJECT) {
        $candidates = @($candidates | Where-Object { $_.Subject -like "*$($env:STORQ_SIGN_SUBJECT)*" })
    }

    $certificate = $candidates | Sort-Object NotAfter -Descending | Select-Object -First 1
}

if ($certificate -and -not (Test-CodeSigningCertificate -Certificate $certificate)) {
    $reasons = @()
    if (-not $certificate.HasPrivateKey) { $reasons += "it has no private key on this account" }
    if ($certificate.NotAfter -le (Get-Date)) { $reasons += "it expired on $($certificate.NotAfter.ToString('yyyy-MM-dd'))" }
    if (-not ((Get-UsageOids -Certificate $certificate) -contains $codeSigningOid)) {
        $reasons += "it does not carry the Code Signing usage (1.3.6.1.5.5.7.3.3)"
    }

    throw "Certificate '$($certificate.Subject)' cannot sign code: $($reasons -join '; ')."
}

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

if (-not $certificate) {
    # `{}` rather than no file at all: build-windows.ps1 always passes this
    # config, and an empty object merges to nothing.
    [System.IO.File]::WriteAllText($OutFile, "{`n}`n", $utf8NoBom)

    Write-Warning @"
No code-signing certificate was found in this account's certificate store, so
this build cannot be signed and Windows SmartScreen will warn everyone who
downloads it. Install the OV certificate (insert the token, or set
STORQ_SIGN_PFX to the .pfx file) and build again before publishing anything.
"@

    return
}

$override = [ordered]@{
    bundle = [ordered]@{
        windows = [ordered]@{
            certificateThumbprint = $certificate.Thumbprint
            digestAlgorithm       = "sha256"
            timestampUrl          = $TimestampUrl
            tsp                   = $true
        }
    }
}

[System.IO.File]::WriteAllText($OutFile, ($override | ConvertTo-Json -Depth 6), $utf8NoBom)

Write-Host "Signing as $($certificate.Subject)"
Write-Host "  thumbprint  $($certificate.Thumbprint)"
Write-Host "  expires     $($certificate.NotAfter.ToString('yyyy-MM-dd'))"
Write-Host "  timestamp   $TimestampUrl (RFC 3161)"

# A certificate close to expiry is not an error, but it is the moment to
# renew: once it expires, only builds that carry a timestamp keep verifying.
$daysLeft = ($certificate.NotAfter - (Get-Date)).Days
if ($daysLeft -lt 60) {
    Write-Warning "This certificate expires in $daysLeft day(s). Renew it before the next release."
}
