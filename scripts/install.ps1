<#
.SYNOPSIS
  Installs Dictate for the current user: builds the key helper, turns on Claude Code's
  voice dictation in tap mode on F9, switches to the fullscreen renderer (mouse clicks),
  and installs the plugin from this folder. Backs up every file it touches first.
.PARAMETER NoFullscreen
  Leave the renderer alone (the mic is then not clickable; F9 still works).
#>
param([switch]$NoFullscreen)
$ErrorActionPreference = 'Stop'

$repo = Split-Path -Parent $PSScriptRoot
$claudeDir = Join-Path $HOME '.claude'
$settingsPath = Join-Path $claudeDir 'settings.json'
$keysPath = Join-Path $claudeDir 'keybindings.json'
$backup = Join-Path $claudeDir ("backups\dictate-" + (Get-Date -Format 'yyyyMMdd-HHmmss'))

# 1. Back up what we touch, and remember the values we change (uninstall restores them).
New-Item -ItemType Directory -Force $backup | Out-Null
foreach ($file in $settingsPath, $keysPath) {
    if (Test-Path $file) { Copy-Item $file $backup }
}
Write-Host "Backup: $backup"

# 2. Build the helper with the C# compiler that ships with Windows (.NET Framework 4).
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { throw "C# compiler not found at $csc" }
New-Item -ItemType Directory -Force (Join-Path $repo 'bin') | Out-Null
& $csc -nologo -optimize "-out:$(Join-Path $repo 'bin\dictate-key.exe')" (Join-Path $repo 'helper\dictate-key.cs')
if ($LASTEXITCODE -ne 0) { throw 'Building the helper failed' }

# 3. settings.json: voice on, tap mode; fullscreen renderer unless -NoFullscreen.
$settings = if (Test-Path $settingsPath) { Get-Content $settingsPath -Raw | ConvertFrom-Json } else { [pscustomobject]@{} }
$previous = [ordered]@{
    voice = $settings.PSObject.Properties['voice']?.Value
    tui   = $settings.PSObject.Properties['tui']?.Value
}
$previous | ConvertTo-Json -Depth 10 | Set-Content (Join-Path $backup 'dictate-previous.json') -Encoding utf8
$settings | Add-Member -Force voice ([pscustomobject]@{ enabled = $true; mode = 'tap' })
if (-not $NoFullscreen) { $settings | Add-Member -Force tui 'fullscreen' }
$settings | ConvertTo-Json -Depth 100 | Set-Content $settingsPath -Encoding utf8

# 4. keybindings.json: F9 is the voice key; Space no longer starts dictation.
$keys = if (Test-Path $keysPath) { Get-Content $keysPath -Raw | ConvertFrom-Json } else { [pscustomobject]@{ bindings = @() } }
$chat = @($keys.bindings) | Where-Object { $_.context -eq 'Chat' } | Select-Object -First 1
if (-not $chat) {
    $chat = [pscustomobject]@{ context = 'Chat'; bindings = [pscustomobject]@{} }
    $keys.bindings = @($keys.bindings) + $chat
}
$chat.bindings | Add-Member -Force 'f9' 'voice:pushToTalk'
$chat.bindings | Add-Member -Force 'space' $null
$keys | ConvertTo-Json -Depth 20 | Set-Content $keysPath -Encoding utf8

# 5. Install the plugin from this folder (a local marketplace: edits here reach /reload-plugins).
claude plugin marketplace add $repo
claude plugin install dictate@dictate --scope user
if ($LASTEXITCODE -ne 0) { throw 'claude plugin install failed' }

Write-Host 'Dictate installed. Open a new Claude Code session (or /reload-plugins) and look for the mic under the prompt.'
