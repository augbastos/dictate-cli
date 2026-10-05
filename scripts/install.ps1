<#
.SYNOPSIS
  Installs Dictate for the current user: builds the key helper, installs the plugin from
  this folder, turns on Claude Code's voice dictation in tap mode on F9, and switches to
  the fullscreen renderer (mouse clicks). Backs up every file it touches first.
  Run it on every machine: the helper (bin/) is built locally, never committed.
.PARAMETER NoFullscreen
  Leave the renderer alone (the mic is then not clickable; F9 still works).
#>
param([switch]$NoFullscreen)
$ErrorActionPreference = 'Stop'

$repo = Split-Path -Parent $PSScriptRoot
$claudeDir = Join-Path $HOME '.claude'
$settingsPath = Join-Path $claudeDir 'settings.json'
$keysPath = Join-Path $claudeDir 'keybindings.json'
$backups = Join-Path $claudeDir 'backups'
$backup = Join-Path $backups ("dictate-" + (Get-Date -Format 'yyyyMMdd-HHmmss'))
# The values from before the FIRST install; a re-install never overwrites them.
$previousPath = Join-Path $backups 'dictate-previous.json'

function Read-Json($path, $empty) {
    if (Test-Path $path) { Get-Content $path -Raw | ConvertFrom-Json } else { $empty }
}
function Write-JsonAtomic($value, $path, $depth) {
    $tmp = "$path.dictate-tmp"
    $value | ConvertTo-Json -Depth $depth | Set-Content $tmp -Encoding utf8
    Move-Item -Force $tmp $path
}
function Value-Of($object, $name) {
    $property = $object.PSObject.Properties[$name]
    if ($property) { @{ present = $true; value = $property.Value } } else { @{ present = $false } }
}

# 1. Back up what we touch.
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

# 3. Install the plugin from this folder (a local marketplace: edits here reach /reload-plugins).
#    Done before the settings edits, so a failure here leaves settings untouched.
claude plugin marketplace add $repo
claude plugin install dictate@dictate --scope user
if ($LASTEXITCODE -ne 0) { throw 'claude plugin install failed' }

$settings = Read-Json $settingsPath ([pscustomobject]@{})
$keys = Read-Json $keysPath ([pscustomobject]@{})
if (-not $keys.PSObject.Properties['bindings']) { $keys | Add-Member bindings @() }
$chat = @($keys.bindings) | Where-Object { $_.context -eq 'Chat' } | Select-Object -First 1

if (-not (Test-Path $previousPath)) {
    $previous = [ordered]@{
        voice     = Value-Of $settings 'voice'
        tui       = Value-Of $settings 'tui'
        chatBlock = [bool]$chat
        f9        = if ($chat) { Value-Of $chat.bindings 'f9' } else { @{ present = $false } }
        space     = if ($chat) { Value-Of $chat.bindings 'space' } else { @{ present = $false } }
    }
    Write-JsonAtomic $previous $previousPath 10
}

# 4. settings.json: voice on, tap mode; fullscreen renderer unless -NoFullscreen.
$settings | Add-Member -Force voice ([pscustomobject]@{ enabled = $true; mode = 'tap' })
if (-not $NoFullscreen) { $settings | Add-Member -Force tui 'fullscreen' }
Write-JsonAtomic $settings $settingsPath 100

# 5. keybindings.json: F9 is the voice key; Space no longer starts dictation.
if (-not $chat) {
    $chat = [pscustomobject]@{ context = 'Chat'; bindings = [pscustomobject]@{} }
    $keys.bindings = @($keys.bindings) + $chat
}
$chat.bindings | Add-Member -Force 'f9' 'voice:pushToTalk'
$chat.bindings | Add-Member -Force 'space' $null
Write-JsonAtomic $keys $keysPath 20

Write-Host 'Dictate installed. Open a new Claude Code session (or /reload-plugins) and look for the mic under the prompt.'
