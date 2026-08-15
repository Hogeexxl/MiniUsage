$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$installer = Join-Path $env:GITHUB_WORKSPACE "target/release/MiniUsage-v$env:TAG_VERSION-windows-x64-setup.exe"
if (-not (Test-Path -LiteralPath $installer -PathType Leaf)) {
    throw "Windows installer was not found: $installer"
}

$testUser = "mu-ci-$([Guid]::NewGuid().ToString('N').Substring(0, 8))"
$plainPassword = "Mu!9aA$([Guid]::NewGuid().ToString('N'))"
$securePassword = ConvertTo-SecureString $plainPassword -AsPlainText -Force
$credential = [System.Management.Automation.PSCredential]::new("$env:COMPUTERNAME\$testUser", $securePassword)
$testUserCreated = $false
$testUserSid = $null
$profilePath = $null

function Stop-TestProcessTree {
    param([Parameter(Mandatory = $true)][System.Diagnostics.Process]$Process)

    if ($Process.HasExited) {
        return
    }

    try {
        & (Join-Path $env:SystemRoot 'System32\taskkill.exe') /PID $Process.Id /T /F | Out-Null
    } catch {
        try {
            $Process.Kill()
        } catch {
            # Preserve the smoke failure while still attempting cleanup.
        }
    }

    try {
        if (-not $Process.WaitForExit(10000)) {
            throw "Timed out waiting for test process tree $($Process.Id) to stop"
        }
    } catch {
        # Preserve the original smoke failure when cleanup races process exit.
    }
}

function Invoke-InstalledRuntimeSmoke {
    param(
        [Parameter(Mandatory = $true)][string]$BinaryPath,
        [Parameter(Mandatory = $true)][string]$RuntimeRoot,
        [Parameter(Mandatory = $true)][System.Management.Automation.PSCredential]$Credential,
        [Parameter(Mandatory = $true)][string]$CodexHome,
        [Parameter(Mandatory = $true)][string]$Temp
    )

    $launcher = Join-Path $RuntimeRoot 'launch-mini-usage.cmd'
    $stdoutPath = Join-Path $RuntimeRoot 'stdout.log'
    $stderrPath = Join-Path $RuntimeRoot 'stderr.log'
    @"
@echo off
set "PATH=%SystemRoot%\System32;%SystemRoot%"
set "CARGO_HOME="
set "RUSTUP_HOME="
set "NODE_PATH="
set "npm_config_prefix="
set "TEMP=$Temp"
set "TMP=$Temp"
set "CODEX_HOME=$CodexHome"
set "MINIUSAGE_DISABLE_BROWSER=1"
cd /d "$RuntimeRoot"
"$BinaryPath" >"$stdoutPath" 2>"$stderrPath"
"@ | Set-Content -LiteralPath $launcher -Encoding ascii

    $cmd = Join-Path $env:SystemRoot 'System32\cmd.exe'
    $process = $null
    try {
        $process = Start-Process -FilePath $cmd `
            -ArgumentList @('/d', '/c', "`"$launcher`"") `
            -Credential $Credential `
            -LoadUserProfile `
            -WorkingDirectory $RuntimeRoot `
            -WindowStyle Hidden `
            -PassThru

        $healthy = $false
        $deadline = (Get-Date).AddSeconds(30)
        while ((Get-Date) -lt $deadline) {
            try {
                $response = Invoke-WebRequest -UseBasicParsing -SkipHttpErrorCheck -Uri 'http://127.0.0.1:3210/api/health' -TimeoutSec 2
                $expectedBinaryVersion = $env:CARGO_VERSION
                if ($response.StatusCode -eq 204 -and
                    [string]$response.Headers['X-MiniUsage-App'] -eq 'MiniUsage' -and
                    [string]$response.Headers['X-MiniUsage-Version'] -eq $expectedBinaryVersion) {
                    $healthy = $true
                    break
                }
            } catch {
                # The listener may not be ready yet.
            }
            Start-Sleep -Milliseconds 250
        }
        if (-not $healthy) {
            if (Test-Path -LiteralPath $stderrPath) {
                Get-Content -LiteralPath $stderrPath -ErrorAction SilentlyContinue | Write-Host
            }
            throw 'Installed Windows runtime did not pass the health marker/version smoke'
        }

        $root = Invoke-WebRequest -UseBasicParsing -SkipHttpErrorCheck -Uri 'http://127.0.0.1:3210/' -TimeoutSec 5
        if ($root.StatusCode -ne 200 -or [string]$root.Headers['Content-Type'] -notmatch '(?i)^text/html(?:;|$)' -or [string]::IsNullOrWhiteSpace([string]$root.Content)) {
            throw 'Installed Windows runtime root did not return a non-empty HTML document'
        }
        $references = [regex]::Matches([string]$root.Content, '(?:src|href)="([^"]+)"') |
            ForEach-Object { $_.Groups[1].Value } |
            Where-Object { $_ -match '^/' }
        $javascriptReference = $references | Where-Object { $_ -match '(?i)\.js(?:\?|$)' } | Select-Object -First 1
        $stylesheetReference = $references | Where-Object { $_ -match '(?i)\.css(?:\?|$)' } | Select-Object -First 1
        if ($null -eq $javascriptReference -or $null -eq $stylesheetReference) {
            throw 'Installed Windows runtime index did not reference both JavaScript and CSS assets'
        }
        foreach ($assetReference in @($javascriptReference, $stylesheetReference)) {
            $assetResponse = Invoke-WebRequest -UseBasicParsing -SkipHttpErrorCheck -Uri ("http://127.0.0.1:3210" + $assetReference) -TimeoutSec 5
            if ($assetResponse.StatusCode -ne 200 -or [string]::IsNullOrWhiteSpace([string]$assetResponse.Content)) {
                throw "Installed Windows runtime asset failed: $assetReference"
            }
            $assetType = [string]$assetResponse.Headers['Content-Type']
            if ($assetReference -match '(?i)\.js(?:\?|$)' -and $assetType -notmatch '(?i)(?:application|text)/javascript') {
                throw "JavaScript asset has unexpected MIME type $assetType"
            }
            if ($assetReference -match '(?i)\.css(?:\?|$)' -and $assetType -notmatch '(?i)text/css') {
                throw "CSS asset has unexpected MIME type $assetType"
            }
        }

        $spa = Invoke-WebRequest -UseBasicParsing -SkipHttpErrorCheck -Uri 'http://127.0.0.1:3210/acceptance/spa-route' -TimeoutSec 5
        if ($spa.StatusCode -ne 200 -or [string]$spa.Headers['Content-Type'] -notmatch '(?i)^text/html(?:;|$)' -or [string]$spa.Content -notmatch '(?i)<html') {
            throw 'Installed Windows runtime did not serve the SPA fallback document'
        }
        $unknownApi = Invoke-WebRequest -UseBasicParsing -SkipHttpErrorCheck -Uri 'http://127.0.0.1:3210/api/acceptance-not-found' -TimeoutSec 5
        if ($unknownApi.StatusCode -ne 404 -or [string]$unknownApi.Headers['Content-Type'] -notmatch '(?i)application/json') {
            throw 'Installed Windows runtime unknown API did not return JSON 404'
        }
        $unknownApiBody = [string]$unknownApi.Content | ConvertFrom-Json
        if ($unknownApiBody.error.code -ne 'NOT_FOUND') {
            throw 'Installed Windows runtime unknown API returned the wrong error code'
        }
    } finally {
        if ($null -ne $process) {
            Stop-TestProcessTree -Process $process
            $process.Dispose()
        }
    }
}

try {
    $secondaryLogon = Get-Service -Name 'seclogon' -ErrorAction Stop
    if ($secondaryLogon.Status -ne 'Running') {
        Start-Service -Name 'seclogon'
    }

    New-LocalUser -Name $testUser -Password $securePassword -PasswordNeverExpires -UserMayNotChangePassword | Out-Null
    $testUserCreated = $true
    $testUserSid = (Get-LocalUser -Name $testUser).SID.Value

    $bootstrap = Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\cmd.exe') `
        -ArgumentList @('/d', '/c', 'exit 0') `
        -Credential $credential `
        -LoadUserProfile `
        -WindowStyle Hidden `
        -Wait `
        -PassThru
    if ($bootstrap.ExitCode -ne 0) {
        throw "Isolated Windows profile bootstrap exited with $($bootstrap.ExitCode)"
    }
    $bootstrap.Dispose()

    $profile = Get-CimInstance -ClassName Win32_UserProfile | Where-Object { [string]$_.SID -eq $testUserSid } | Select-Object -First 1
    if ($null -eq $profile -or [string]::IsNullOrWhiteSpace([string]$profile.LocalPath)) {
        throw "Isolated Windows user profile was not created for SID $testUserSid"
    }
    $profilePath = [string]$profile.LocalPath

    $knownFolderProbe = Join-Path $profilePath 'miniusage-known-folder.txt'
    $probeScript = "[Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData) | Set-Content -LiteralPath '$knownFolderProbe' -NoNewline"
    $probeEncoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($probeScript))
    $probe = Start-Process -FilePath (Join-Path $PSHOME 'pwsh.exe') `
        -ArgumentList @('-NoProfile', '-NonInteractive', '-EncodedCommand', $probeEncoded) `
        -Credential $credential `
        -LoadUserProfile `
        -WindowStyle Hidden `
        -Wait `
        -PassThru
    if ($probe.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $knownFolderProbe -PathType Leaf)) {
        throw 'Windows LocalApplicationData known folder probe failed inside the isolated user profile'
    }
    $probe.Dispose()

    $localAppData = (Get-Content -LiteralPath $knownFolderProbe -Raw).Trim()
    if ([string]::IsNullOrWhiteSpace($localAppData)) {
        throw 'Windows LocalApplicationData known folder could not be resolved inside the isolated user profile'
    }
    if (-not $localAppData.StartsWith($profilePath, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Windows LocalApplicationData escaped the isolated user profile: $localAppData"
    }

    $installRoot = Join-Path $profilePath 'MiniUsage-Acceptance-Install'
    $runtimeRoot = Join-Path $profilePath 'MiniUsage-Acceptance-Runtime'
    $codexHome = Join-Path $profilePath '.codex'
    $temp = Join-Path $profilePath 'AppData\Local\Temp'
    $codexSessions = Join-Path $codexHome 'sessions'
    $codexArchived = Join-Path $codexHome 'archived_sessions'
    $appDataRoot = Join-Path $localAppData 'MiniUsage'
    $databasePath = Join-Path $appDataRoot 'mu.sqlite3'
    $sentinelPath = Join-Path $appDataRoot 'acceptance-user-data.txt'

    New-Item -ItemType Directory -Force -Path $installRoot, $runtimeRoot, $temp, $codexSessions, $codexArchived | Out-Null
    if (Test-Path -LiteralPath $appDataRoot) {
        throw "Fresh isolated Windows user unexpectedly already has MiniUsage data: $appDataRoot"
    }

    $install = Start-Process -FilePath $installer -ArgumentList @('/S', "/D=$installRoot") -Wait -PassThru -NoNewWindow
    if ($install.ExitCode -ne 0) {
        throw "NSIS installer exited with $($install.ExitCode)"
    }
    $install.Dispose()

    $installedBinary = Get-ChildItem -Path $installRoot -Recurse -Filter 'mini-usage.exe' -File | Select-Object -First 1
    if ($null -eq $installedBinary) {
        throw 'Installed mini-usage.exe was not found'
    }
    if ($installedBinary.FullName.StartsWith($env:GITHUB_WORKSPACE, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw 'Installed binary unexpectedly resolves inside the repository'
    }
    if (Get-ChildItem -Path $installRoot -Recurse -Directory | Where-Object { $_.Name -eq 'frontend' }) {
        throw 'Installed runtime unexpectedly contains a frontend directory'
    }
    $uninstallers = @(Get-ChildItem -Path $installRoot -Recurse -Filter 'uninstall*.exe' -File)
    if ($uninstallers.Count -ne 1) {
        throw "Expected exactly one NSIS uninstaller (uninstall*.exe, including packager uninstall.exe), found $($uninstallers.Count)"
    }
    $uninstallerPath = $uninstallers[0].FullName

    Invoke-InstalledRuntimeSmoke -BinaryPath $installedBinary.FullName -RuntimeRoot $runtimeRoot -Credential $credential -CodexHome $codexHome -Temp $temp

    if (-not (Test-Path -LiteralPath $appDataRoot -PathType Container) -or -not (Test-Path -LiteralPath $databasePath -PathType Leaf)) {
        throw "Installed runtime did not create its user database in the isolated Windows known folder: $databasePath"
    }
    $unexpectedDatabase = Get-ChildItem -Path $profilePath -Recurse -Filter 'mu.sqlite3' -File -ErrorAction SilentlyContinue |
        Where-Object { -not $_.FullName.Equals($databasePath, [System.StringComparison]::OrdinalIgnoreCase) } |
        Select-Object -First 1
    if ($null -ne $unexpectedDatabase) {
        throw "Installed runtime created a database outside the isolated default path: $($unexpectedDatabase.FullName)"
    }

    Set-Content -LiteralPath $sentinelPath -Value 'preserve across reinstall' -NoNewline
    $databaseHashBeforeReinstall = (Get-FileHash -LiteralPath $databasePath -Algorithm SHA256).Hash

    $reinstall = Start-Process -FilePath $installer -ArgumentList @('/S', "/D=$installRoot") -Wait -PassThru -NoNewWindow
    if ($reinstall.ExitCode -ne 0) {
        throw "NSIS reinstall exited with $($reinstall.ExitCode)"
    }
    $reinstall.Dispose()
    if ((Get-Content -LiteralPath $sentinelPath -Raw) -ne 'preserve across reinstall' -or -not (Test-Path -LiteralPath $databasePath -PathType Leaf)) {
        throw 'NSIS reinstall did not preserve isolated MiniUsage user data'
    }
    if ((Get-FileHash -LiteralPath $databasePath -Algorithm SHA256).Hash -ne $databaseHashBeforeReinstall) {
        throw 'NSIS reinstall changed the isolated MiniUsage database'
    }

    $installedBinary = Get-ChildItem -Path $installRoot -Recurse -Filter 'mini-usage.exe' -File | Select-Object -First 1
    if ($null -eq $installedBinary) {
        throw 'Reinstalled mini-usage.exe was not found'
    }
    Invoke-InstalledRuntimeSmoke -BinaryPath $installedBinary.FullName -RuntimeRoot $runtimeRoot -Credential $credential -CodexHome $codexHome -Temp $temp
    if ((Get-Content -LiteralPath $sentinelPath -Raw) -ne 'preserve across reinstall') {
        throw 'Installed runtime relaunch did not preserve isolated MiniUsage user data'
    }

    $databaseHashBeforeUninstall = (Get-FileHash -LiteralPath $databasePath -Algorithm SHA256).Hash
    $sentinelHashBeforeUninstall = (Get-FileHash -LiteralPath $sentinelPath -Algorithm SHA256).Hash
    if (-not (Test-Path -LiteralPath $uninstallerPath -PathType Leaf)) {
        throw "NSIS uninstaller disappeared before uninstall: $uninstallerPath"
    }

    $uninstall = Start-Process -FilePath $uninstallerPath -ArgumentList @('/S') -Wait -PassThru -NoNewWindow
    if ($uninstall.ExitCode -ne 0) {
        throw "NSIS uninstaller exited with $($uninstall.ExitCode)"
    }
    $uninstall.Dispose()

    $uninstallDeadline = (Get-Date).AddSeconds(30)
    while ((Test-Path -LiteralPath $installRoot) -and ((Get-Date) -lt $uninstallDeadline)) {
        Start-Sleep -Milliseconds 250
    }
    if (Test-Path -LiteralPath $installedBinary.FullName) {
        throw 'NSIS uninstall left mini-usage.exe in the install directory'
    }
    if (Test-Path -LiteralPath $installRoot) {
        $remainingInstalledExecutables = @(Get-ChildItem -Path $installRoot -Recurse -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '(?i)^mini-usage(?:\.exe)?$' })
        if ($remainingInstalledExecutables.Count -ne 0) {
            throw 'NSIS uninstall left an installed MiniUsage executable in the install directory'
        }
        throw "NSIS uninstall left the install directory in place: $installRoot"
    }
    if (-not (Test-Path -LiteralPath $sentinelPath -PathType Leaf) -or -not (Test-Path -LiteralPath $databasePath -PathType Leaf)) {
        throw 'NSIS uninstall removed isolated MiniUsage user data'
    }
    if ((Get-FileHash -LiteralPath $databasePath -Algorithm SHA256).Hash -ne $databaseHashBeforeUninstall) {
        throw 'NSIS uninstall changed the isolated MiniUsage database'
    }
    if ((Get-FileHash -LiteralPath $sentinelPath -Algorithm SHA256).Hash -ne $sentinelHashBeforeUninstall) {
        throw 'NSIS uninstall changed isolated MiniUsage user data'
    }
} finally {
    if ($testUserCreated) {
        if ($null -ne $testUserSid) {
            try {
                Get-CimInstance -ClassName Win32_UserProfile |
                    Where-Object { [string]$_.SID -eq $testUserSid } |
                    Remove-CimInstance -ErrorAction Stop
            } catch {
                Write-Warning "Unable to remove isolated Windows profile for $testUserSid`: $($_.Exception.Message)"
            }
        }
        try {
            Remove-LocalUser -Name $testUser -ErrorAction Stop
        } catch {
            Write-Warning "Unable to remove isolated Windows test user $testUser`: $($_.Exception.Message)"
        }
    }
}
