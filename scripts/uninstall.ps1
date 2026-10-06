#Requires -Version 7
<#
.SYNOPSIS
  Removes DictateCLI: uninstalls the plugin and its marketplace, and puts back the voice
  and renderer settings and the Alt+D / F11 / Space bindings (plus an F9 from older
  installs) recorded before the first install.
.PARAMETER SkipPlugin
  Restore the settings only and leave the plugin installed (for a plugin installed from
  the Claude plugin directory: remove it afterwards with /plugin). `/dictate remove` runs this.
#>
param([switch]$SkipPlugin)
$ErrorActionPreference = 'Stop'
trap { Write-Host "Failed: $($_.Exception.Message)"; exit 1 }
. (Join-Path $PSScriptRoot 'common.ps1')

$claudeDir = Get-ClaudeDir
$settingsPath = Join-Path $claudeDir 'settings.json'
$keysPath = Join-Path $claudeDir 'keybindings.json'
$previousPath = Join-Path $claudeDir 'backups\dictate-cli-previous.json'

function Write-JsonAtomic($value, $path, $depth) {
    $tmp = "$path.dictate-tmp"
    $value | ConvertTo-Json -Depth $depth | Set-Content $tmp -Encoding utf8
    Move-Item -Force $tmp $path
}
function Restore($object, $name, $saved, $dictateValue) {
    if ($null -eq $saved) {
        # Not recorded (an older install): remove only what DictateCLI itself set.
        if ($object.PSObject.Properties[$name] -and $object.$name -eq $dictateValue) { $object.PSObject.Properties.Remove($name) }
    } elseif ($saved.present) { $object | Add-Member -Force $name $saved.value }
    else { $object.PSObject.Properties.Remove($name) }
}

if (-not $SkipPlugin) {
    claude plugin uninstall dictate-cli@dictate-cli --scope user
    claude plugin marketplace remove dictate-cli
}

if (-not (Test-Path $previousPath)) {
    Write-Warning "No ${previousPath}: settings and keybindings left as they are."
    exit 0
}
$previous = Get-Content $previousPath -Raw | ConvertFrom-Json

if (Test-Path $settingsPath) {
    $settings = Get-Content $settingsPath -Raw | ConvertFrom-Json
    Restore $settings 'voice' $previous.voice
    Restore $settings 'tui' $previous.tui
    $configs = $settings.PSObject.Properties['pluginConfigs']
    if ($configs -and -not $SkipPlugin) {
        # Plugin uninstall already drops the plugin's options; this clears what is left.
        $configs.Value.PSObject.Properties.Remove('dictate-cli@dictate-cli')
        if (@($configs.Value.PSObject.Properties).Count -eq 0) { $settings.PSObject.Properties.Remove('pluginConfigs') }
    }
    # Claude Code's plugin uninstall can leave its own bookkeeping keys empty.
    foreach ($name in 'enabledPlugins', 'extraKnownMarketplaces') {
        $value = $settings.PSObject.Properties[$name]?.Value
        if ($value -is [pscustomobject] -and @($value.PSObject.Properties).Count -eq 0 -and $previous.pluginKeys -eq $false) {
            $settings.PSObject.Properties.Remove($name)
        }
    }
    if ($previous.settingsFile -eq $false -and @($settings.PSObject.Properties).Count -eq 0) {
        Remove-Item $settingsPath # there was no settings.json before DictateCLI
    } else {
        Write-JsonAtomic $settings $settingsPath 100
    }
}

if (Test-Path $keysPath) {
    $keys = Get-Content $keysPath -Raw | ConvertFrom-Json
    $chat = @($keys.bindings) | Where-Object { $_.context -eq 'Chat' } | Select-Object -First 1
    if ($chat) {
        Restore $chat.bindings 'f9' $previous.f9 'command:dictate'
        Restore $chat.bindings 'f11' $previous.f11 'voice:pushToTalk'
        Restore $chat.bindings 'alt+d' $previous.'alt+d' 'command:dictate'
        Restore $chat.bindings 'space' $previous.space $null
        $isEmpty = @($chat.bindings.PSObject.Properties).Count -eq 0
        if (-not $previous.chatBlock -and $isEmpty) {
            $keys.bindings = @($keys.bindings | Where-Object { $_ -ne $chat })
        }
    }
    $wasThere = $previous.PSObject.Properties['keysFile'] -and $previous.keysFile
    if (-not $wasThere -and @($keys.bindings).Count -eq 0 -and @($keys.PSObject.Properties).Count -eq 1) {
        Remove-Item $keysPath # DictateCLI created it
    } else {
        Write-JsonAtomic $keys $keysPath 20
    }
}

Remove-Item $previousPath
Write-Host $(if ($SkipPlugin) { 'Settings restored. Remove the plugin with /plugin uninstall dictate-cli.' } else { 'DictateCLI removed. Restart Claude Code sessions (or /reload-plugins) to drop the card.' })
