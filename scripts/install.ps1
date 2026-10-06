<#
.SYNOPSIS
  Installs DictateCLI (voice dictation for Claude Code) for the current user: builds the
  key helper, installs the plugin `dictate-cli@dictate-cli` from this folder, turns on
  Claude Code's voice dictation in tap mode, and switches to the fullscreen renderer
  (mouse clicks). Backs up every file it touches first.
  Run it on every machine: the helper (bin/) is built locally, never committed.
.PARAMETER NoFullscreen
  Leave the renderer alone (the card is then not clickable; /dictate still works).
.PARAMETER Beside
  Set DictateCLI's `beside` option: share the band row with another plugin's card (AFKSwitch).
.PARAMETER Shortcut
  The key for /dictate: alt+d (default) or disabled. Other chords can be bound by hand to
  `command:dictate` in ~/.claude/keybindings.json (context Chat). Function keys are refused: Claude Code 2.1.289/2.1.290 never routes them to its keybindings (tested).
  The Application/Menu key is refused: Claude Code has no name for it. DictateCLI never
  installs a global keyboard hook.
#>
param([switch]$NoFullscreen, [switch]$Beside, [string]$Shortcut = 'alt+d')
$ErrorActionPreference = 'Stop'

switch ($Shortcut.Trim().ToLowerInvariant()) {
    'alt+d' { $userKey = 'alt+d' }
    'disabled' { $userKey = $null }
    { $_ -match '^(ctrl\+|shift\+|alt\+)*f([1-9]|1[0-2])$' } {
        throw "Function keys cannot be a DictateCLI shortcut: Claude Code never routes them to its keybindings (tested on 2.1.289 and 2.1.290). Nothing was changed."
    }
    { $_ -in 'apps', 'menu', 'application' } {
        throw 'The Application/Menu key cannot be a DictateCLI shortcut: Claude Code does not receive it from the terminal. Nothing was changed.'
    }
    default { throw "Unknown shortcut '$Shortcut'. Use alt+d or disabled (nothing was changed)." }
}
# The helper presses F11 for Claude Code's voice (`voice:pushToTalk`); a user key, when
# one is bound, runs /dictate (`command:dictate`). Never the same key: no loop.
$transportKey = 'f11'

$repo = Split-Path -Parent $PSScriptRoot
$claudeDir = Join-Path $HOME '.claude'
$settingsPath = Join-Path $claudeDir 'settings.json'
$keysPath = Join-Path $claudeDir 'keybindings.json'
$backups = Join-Path $claudeDir 'backups'
$backup = Join-Path $backups ("dictate-cli-" + (Get-Date -Format 'yyyyMMdd-HHmmss'))
# The values from before the FIRST install; a re-install never overwrites them.
$previousPath = Join-Path $backups 'dictate-cli-previous.json'

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

# 3. Migrate an install of the former name (Dictate, `dictate@dictate`): its recorded
#    pre-install values carry over, its options move to the new id, and it is removed so
#    two copies never both register /dictate and draw a card.
$oldPrevious = Join-Path $backups 'dictate-previous.json'
if ((Test-Path $oldPrevious) -and -not (Test-Path $previousPath)) { Move-Item $oldPrevious $previousPath }
$oldOptions = (Read-Json $settingsPath ([pscustomobject]@{})).pluginConfigs.'dictate@dictate'.options
if ((claude plugin list 2>&1 | Out-String) -match 'dictate@dictate') {
    claude plugin uninstall dictate@dictate --scope user
    claude plugin marketplace remove dictate
}

# 4. Install the plugin from this folder (a local marketplace: edits here reach /reload-plugins).
#    Done before the settings edits, so a failure here leaves settings untouched.
claude plugin marketplace add $repo
claude plugin install dictate-cli@dictate-cli --scope user
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
        'alt+d'   = if ($chat) { Value-Of $chat.bindings 'alt+d' } else { @{ present = $false } }
        space     = if ($chat) { Value-Of $chat.bindings 'space' } else { @{ present = $false } }
    }
    Write-JsonAtomic $previous $previousPath 10
} else {
    # Upgrade from a version that did not record every key: record it now, while the
    # value in place is still the user's own (not one DictateCLI sets).
    $previous = Get-Content $previousPath -Raw | ConvertFrom-Json
    if (-not $previous.PSObject.Properties['alt+d']) {
        $altD = if ($chat) { Value-Of $chat.bindings 'alt+d' } else { @{ present = $false } }
        if ($altD.present -and $altD.value -eq 'command:dictate') { $altD = @{ present = $false } }
        $previous | Add-Member 'alt+d' ([pscustomobject]$altD)
        Write-JsonAtomic $previous $previousPath 10
    }
    if (-not $previous.PSObject.Properties['f11']) {
        $f11 = if ($chat) { Value-Of $chat.bindings 'f11' } else { @{ present = $false } }
        if ($f11.present -and $f11.value -eq 'voice:pushToTalk') { $f11 = @{ present = $false } }
        $previous | Add-Member f11 ([pscustomobject]$f11)
        Write-JsonAtomic $previous $previousPath 10
    }
}

# 5. settings.json: voice on, tap mode; fullscreen renderer unless -NoFullscreen.
$settings | Add-Member -Force voice ([pscustomobject]@{ enabled = $true; mode = 'tap' })
if (-not $NoFullscreen) { $settings | Add-Member -Force tui 'fullscreen' }
if ($oldOptions) {
    # The former install's options (icon, beside) under the new id; new values win.
    if (-not $settings.PSObject.Properties['pluginConfigs']) { $settings | Add-Member pluginConfigs ([pscustomobject]@{}) }
    $entry = $settings.pluginConfigs.PSObject.Properties['dictate-cli@dictate-cli']?.Value
    if (-not $entry) { $entry = [pscustomobject]@{}; $settings.pluginConfigs | Add-Member 'dictate-cli@dictate-cli' $entry }
    if (-not $entry.PSObject.Properties['options']) { $entry | Add-Member options ([pscustomobject]@{}) }
    foreach ($option in $oldOptions.PSObject.Properties) {
        if (-not $entry.options.PSObject.Properties[$option.Name]) { $entry.options | Add-Member $option.Name $option.Value }
    }
}
if ($settings.PSObject.Properties['pluginConfigs']) { $settings.pluginConfigs.PSObject.Properties.Remove('dictate@dictate') }
if ($Beside) {
    # Merge: keep any other DictateCLI option the user set (icon).
    if (-not $settings.PSObject.Properties['pluginConfigs']) { $settings | Add-Member pluginConfigs ([pscustomobject]@{}) }
    $entry = $settings.pluginConfigs.PSObject.Properties['dictate-cli@dictate-cli']?.Value
    if (-not $entry) { $entry = [pscustomobject]@{}; $settings.pluginConfigs | Add-Member 'dictate-cli@dictate-cli' $entry }
    if (-not $entry.PSObject.Properties['options']) { $entry | Add-Member options ([pscustomobject]@{}) }
    $entry.options | Add-Member -Force beside $true
}
Write-JsonAtomic $settings $settingsPath 100

# 6. keybindings.json: the user's key runs /dictate, F11 is Claude Code's voice key
#    (pressed only by the helper), Space no longer starts dictation.
if (-not $chat) {
    $chat = [pscustomobject]@{ context = 'Chat'; bindings = [pscustomobject]@{} }
    $keys.bindings = @($keys.bindings) + $chat
}
$chat.bindings | Add-Member -Force $transportKey 'voice:pushToTalk'
$chat.bindings | Add-Member -Force 'space' $null
if ($userKey) { $chat.bindings | Add-Member -Force $userKey 'command:dictate' }
elseif ($chat.bindings.PSObject.Properties['f9'] -and $chat.bindings.f9 -in 'command:dictate', 'voice:pushToTalk') {
    $chat.bindings.PSObject.Properties.Remove('f9') # an F9 an older Dictate install bound
}
Write-JsonAtomic $keys $keysPath 20

Write-Host 'DictateCLI installed. Open a new Claude Code session (or /reload-plugins) and look for the DictateCLI card above the prompt; /dictate toggles it too.'
