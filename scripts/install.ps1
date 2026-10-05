<#
.SYNOPSIS
  Installs Dictate for the current user: builds the key helper, installs the plugin from
  this folder, turns on Claude Code's voice dictation in tap mode, binds the Dictate key
  (F9), and switches to the fullscreen renderer (mouse clicks). Backs up every file it
  touches first.
  Run it on every machine: the helper (bin/) is built locally, never committed.
.PARAMETER NoFullscreen
  Leave the renderer alone (the mic is then not clickable; the keyboard shortcut still works).
.PARAMETER Shortcut
  The Dictate key: f9 (default) or disabled. The Application/Menu key is not supported:
  Claude Code's key reader has no name for it, so no keybinding can hold it, and
  Dictate does not install a global keyboard hook.
#>
param([switch]$NoFullscreen, [string]$Shortcut = 'f9')
$ErrorActionPreference = 'Stop'

switch ($Shortcut.Trim().ToLowerInvariant()) {
    'f9' { $userKey = 'f9' }
    'disabled' { $userKey = $null }
    { $_ -in 'apps', 'menu', 'application' } {
        throw 'The Application/Menu key cannot be a Dictate shortcut: Claude Code does not receive it from the terminal. Use -Shortcut f9 (nothing was changed).'
    }
    default { throw "Unknown shortcut '$Shortcut'. Use f9 or disabled (nothing was changed)." }
}
# The helper presses F11 for Claude Code's voice (`voice:pushToTalk`); the user's key
# runs /dictate (`command:dictate`). Never the same key: no F9 -> Dictate -> F9 loop.
$transportKey = 'f11'

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
        f11       = if ($chat) { Value-Of $chat.bindings 'f11' } else { @{ present = $false } }
        space     = if ($chat) { Value-Of $chat.bindings 'space' } else { @{ present = $false } }
    }
    Write-JsonAtomic $previous $previousPath 10
}

# 4. settings.json: voice on, tap mode; fullscreen renderer unless -NoFullscreen.
$settings | Add-Member -Force voice ([pscustomobject]@{ enabled = $true; mode = 'tap' })
if (-not $NoFullscreen) { $settings | Add-Member -Force tui 'fullscreen' }
Write-JsonAtomic $settings $settingsPath 100

# 5. keybindings.json: the user's key runs /dictate, F11 is Claude Code's voice key
#    (pressed only by the helper), Space no longer starts dictation.
if (-not $chat) {
    $chat = [pscustomobject]@{ context = 'Chat'; bindings = [pscustomobject]@{} }
    $keys.bindings = @($keys.bindings) + $chat
}
$chat.bindings | Add-Member -Force $transportKey 'voice:pushToTalk'
$chat.bindings | Add-Member -Force 'space' $null
if ($userKey) { $chat.bindings | Add-Member -Force $userKey 'command:dictate' }
elseif ($chat.bindings.PSObject.Properties['f9'] -and $chat.bindings.f9 -in 'command:dictate', 'voice:pushToTalk') {
    $chat.bindings.PSObject.Properties.Remove('f9') # disabled: drop Dictate's own F9 only
}
Write-JsonAtomic $keys $keysPath 20

Write-Host 'Dictate installed. Open a new Claude Code session (or /reload-plugins) and look for the Dictate card above the prompt; F9 toggles it.'
