$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$installer = Join-Path $env:GITHUB_WORKSPACE "target/release/MiniUsage-v$env:TAG_VERSION-windows-x64-setup.exe"
if (-not (Test-Path -LiteralPath $installer -PathType Leaf)) {
    throw "Windows installer was not found: $installer"
}

$testUser = "mu-ci-$([Guid]::NewGuid().ToString('N').Substring(0, 8))"
$testAccount = "$env:COMPUTERNAME\$testUser"
$plainPassword = "Mu!9aA$([Guid]::NewGuid().ToString('N'))"
$securePassword = ConvertTo-SecureString $plainPassword -AsPlainText -Force
$testUserCreated = $false
$testUserSid = $null
$profilePath = $null
$workRoot = Join-Path $env:ProgramData "MiniUsage-S12-$([Guid]::NewGuid().ToString('N'))"
$registeredTasks = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)

function Grant-TestUserModify {
    param([Parameter(Mandatory = $true)][string]$Path)

    New-Item -ItemType Directory -Force -Path $Path | Out-Null
    & (Join-Path $env:SystemRoot 'System32\icacls.exe') $Path /grant "${testAccount}:(OI)(CI)M" /T /C | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to grant isolated Windows user modify access to $Path"
    }
}

function Register-PasswordTask {
    param(
        [Parameter(Mandatory = $true)][string]$TaskName,
        [Parameter(Mandatory = $true)][string]$Execute,
        [Parameter(Mandatory = $true)][string]$Arguments,
        [Parameter(Mandatory = $true)][string]$WorkingDirectory
    )

    $action = New-ScheduledTaskAction -Execute $Execute -Argument $Arguments -WorkingDirectory $WorkingDirectory
    Register-ScheduledTask `
        -TaskName $TaskName `
        -Action $action `
        -User $testAccount `
        -Password $plainPassword `
        -RunLevel Limited `
        -Force | Out-Null
    [void]$registeredTasks.Add($TaskName)
}

function Remove-TestTask {
    param(
        [Parameter(Mandatory = $true)][string]$TaskName,
        [switch]$Stop
    )

    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if ($null -eq $task) {
        [void]$registeredTasks.Remove($TaskName)
        return
    }
    if ($Stop) {
        Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue | Out-Null
    }
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
    [void]$registeredTasks.Remove($TaskName)
}

function Wait-ForFile {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$TaskName,
        [int]$TimeoutSeconds = 30
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        if (Test-Path -LiteralPath $Path -PathType Leaf) {
            return
        }
        $info = Get-ScheduledTaskInfo -TaskName $TaskName -ErrorAction SilentlyContinue
        if ($null -ne $info -and $info.LastTaskResult -ne 0 -and $info.LastRunTime -gt [datetime]::MinValue) {
            throw "Scheduled task $TaskName failed with result $($info.LastTaskResult) before producing $Path"
        }
        Start-Sleep -Milliseconds 250
    }
    throw "Timed out waiting for scheduled task $TaskName to produce $Path"
}

function Stop-InstalledRuntime {
    param(
        [Parameter(Mandatory = $true)][string]$TaskName,
        [Parameter(Mandatory = $true)][string]$BinaryPath
    )

    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue | Out-Null
    $deadline = (Get-Date).AddSeconds(10)
    while ((Get-Date) -lt $deadline) {
        $processes = @(Get-CimInstance Win32_Process -Filter "Name = 'mini-usage.exe'" -ErrorAction SilentlyContinue |
            Where-Object { [string]$_.ExecutablePath -and [string]$_.ExecutablePath -ieq $BinaryPath })
        if ($processes.Count -eq 0) {
            break
        }
        foreach ($process in $processes) {
            Stop-Process -Id ([int]$process.ProcessId) -Force -ErrorAction SilentlyContinue
        }
        Start-Sleep -Milliseconds 250
    }
    Remove-TestTask -TaskName $TaskName
}

function Invoke-InstalledRuntimeSmoke {
    param(
        [Parameter(Mandatory = $true)][string]$BinaryPath,
        [Parameter(Mandatory = $true)][string]$RuntimeRoot,
        [Parameter(Mandatory = $true)][string]$CodexHome,
        [Parameter(Mandatory = $true)][string]$Temp,
        [Parameter(Mandatory = $true)][string]$ExpectedLocalAppData
    )

    Grant-TestUserModify -Path $RuntimeRoot
    Grant-TestUserModify -Path $Temp
    Grant-TestUserModify -Path $CodexHome
    New-Item -ItemType Directory -Force -Path (Join-Path $CodexHome 'sessions'), (Join-Path $CodexHome 'archived_sessions') | Out-Null

    $taskName = "MiniUsage-S12-Runtime-$([Guid]::NewGuid().ToString('N'))"
    $launcher = Join-Path $RuntimeRoot 'launch-mini-usage.ps1'
    $runtimeIdentityPath = Join-Path $RuntimeRoot 'runtime-identity.json'
    $stdoutPath = Join-Path $RuntimeRoot 'stdout.log'
    $stderrPath = Join-Path $RuntimeRoot 'stderr.log'
    $escapedBinary = $BinaryPath.Replace("'", "''")
    $escapedRuntimeRoot = $RuntimeRoot.Replace("'", "''")
    $escapedCodexHome = $CodexHome.Replace("'", "''")
    $escapedTemp = $Temp.Replace("'", "''")
    $escapedIdentityPath = $runtimeIdentityPath.Replace("'", "''")
    $escapedStdout = $stdoutPath.Replace("'", "''")
    $escapedStderr = $stderrPath.Replace("'", "''")

    @"
`$ErrorActionPreference = 'Stop'
`$env:PATH = "`$env:SystemRoot\System32;`$env:SystemRoot"
Remove-Item Env:CARGO_HOME, Env:RUSTUP_HOME, Env:NODE_PATH, Env:npm_config_prefix -ErrorAction SilentlyContinue
`$env:TEMP = '$escapedTemp'
`$env:TMP = '$escapedTemp'
`$env:CODEX_HOME = '$escapedCodexHome'
`$env:MINIUSAGE_DISABLE_BROWSER = '1'
Set-Location -LiteralPath '$escapedRuntimeRoot'
[pscustomobject]@{
    UserName = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    UserSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    UserProfile = `$env:USERPROFILE
    LocalAppData = [Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
} | ConvertTo-Json -Compress | Set-Content -LiteralPath '$escapedIdentityPath' -Encoding utf8 -NoNewline
& '$escapedBinary' 1>'$escapedStdout' 2>'$escapedStderr'
exit `$LASTEXITCODE
"@ | Set-Content -LiteralPath $launcher -Encoding utf8

    $pwsh = Join-Path $PSHOME 'pwsh.exe'
    $arguments = "-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$launcher`""
    Register-PasswordTask -TaskName $taskName -Execute $pwsh -Arguments $arguments -WorkingDirectory $RuntimeRoot

    try {
        Start-ScheduledTask -TaskName $taskName
        Wait-ForFile -Path $runtimeIdentityPath -TaskName $taskName
        $runtimeIdentity = Get-Content -LiteralPath $runtimeIdentityPath -Raw | ConvertFrom-Json
        if ([string]$runtimeIdentity.UserSid -ne [string]$testUserSid) {
            throw "Installed runtime did not run as isolated Windows user: $($runtimeIdentity.UserName) / $($runtimeIdentity.UserSid)"
        }
        if ([string]$runtimeIdentity.LocalAppData -ine $ExpectedLocalAppData) {
            throw "Installed runtime resolved the wrong Windows LocalApplicationData known folder: $($runtimeIdentity.LocalAppData)"
        }

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
        Stop-InstalledRuntime -TaskName $taskName -BinaryPath $BinaryPath
    }
}

try {
    New-LocalUser -Name $testUser -Password $securePassword -PasswordNeverExpires -UserMayNotChangePassword | Out-Null
    $testUserCreated = $true
    $testUserSid = (Get-LocalUser -Name $testUser).SID.Value
    Grant-TestUserModify -Path $workRoot

    $probeTaskName = "MiniUsage-S12-Probe-$([Guid]::NewGuid().ToString('N'))"
    $probeScript = Join-Path $workRoot 'probe-profile.ps1'
    $probeResult = Join-Path $workRoot 'probe-profile.json'
    $escapedProbeResult = $probeResult.Replace("'", "''")
    @"
`$ErrorActionPreference = 'Stop'
[pscustomobject]@{
    UserName = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    UserSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    UserProfile = `$env:USERPROFILE
    LocalAppData = [Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
} | ConvertTo-Json -Compress | Set-Content -LiteralPath '$escapedProbeResult' -Encoding utf8 -NoNewline
"@ | Set-Content -LiteralPath $probeScript -Encoding utf8

    $probeArguments = "-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$probeScript`""
    Register-PasswordTask -TaskName $probeTaskName -Execute (Join-Path $PSHOME 'pwsh.exe') -Arguments $probeArguments -WorkingDirectory $workRoot
    try {
        Start-ScheduledTask -TaskName $probeTaskName
        Wait-ForFile -Path $probeResult -TaskName $probeTaskName
        $probe = Get-Content -LiteralPath $probeResult -Raw | ConvertFrom-Json
    } finally {
        Remove-TestTask -TaskName $probeTaskName -Stop
    }

    if ([string]$probe.UserSid -ne [string]$testUserSid) {
        throw "Windows password-logon task did not run as the isolated user: $($probe.UserName) / $($probe.UserSid)"
    }
    $profilePath = [string]$probe.UserProfile
    $localAppData = [string]$probe.LocalAppData
    if ([string]::IsNullOrWhiteSpace($profilePath) -or [string]::IsNullOrWhiteSpace($localAppData)) {
        throw 'Windows password-logon task did not resolve an isolated user profile and LocalApplicationData known folder'
    }
    if (-not $localAppData.StartsWith($profilePath, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Windows LocalApplicationData escaped the isolated user profile: $localAppData"
    }

    $profile = Get-CimInstance -ClassName Win32_UserProfile | Where-Object { [string]$_.SID -eq $testUserSid } | Select-Object -First 1
    if ($null -eq $profile -or [string]::IsNullOrWhiteSpace([string]$profile.LocalPath)) {
        throw "Isolated Windows user profile was not created for SID $testUserSid"
    }
    if ([string]$profile.LocalPath -ine $profilePath) {
        throw "Windows profile registry path does not match password-logon task profile: $($profile.LocalPath) vs $profilePath"
    }

    $installRoot = Join-Path $workRoot 'install'
    $runtimeRoot = Join-Path $workRoot 'runtime'
    $codexHome = Join-Path $profilePath '.codex'
    $temp = Join-Path $workRoot 'temp'
    $appDataRoot = Join-Path $localAppData 'MiniUsage'
    $databasePath = Join-Path $appDataRoot 'mu.sqlite3'
    $sentinelPath = Join-Path $appDataRoot 'acceptance-user-data.txt'

    Grant-TestUserModify -Path $installRoot
    Grant-TestUserModify -Path $runtimeRoot
    Grant-TestUserModify -Path $temp
    Grant-TestUserModify -Path $codexHome
    New-Item -ItemType Directory -Force -Path (Join-Path $codexHome 'sessions'), (Join-Path $codexHome 'archived_sessions') | Out-Null
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

    Invoke-InstalledRuntimeSmoke -BinaryPath $installedBinary.FullName -RuntimeRoot $runtimeRoot -CodexHome $codexHome -Temp $temp -ExpectedLocalAppData $localAppData

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
    Invoke-InstalledRuntimeSmoke -BinaryPath $installedBinary.FullName -RuntimeRoot $runtimeRoot -CodexHome $codexHome -Temp $temp -ExpectedLocalAppData $localAppData
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
    foreach ($taskName in @($registeredTasks)) {
        Remove-TestTask -TaskName $taskName -Stop
    }
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
    if (Test-Path -LiteralPath $workRoot) {
        Remove-Item -LiteralPath $workRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}
