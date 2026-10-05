<#
.SYNOPSIS
  Removes Dictate: uninstalls the plugin and its marketplace, and puts back the voice,
  renderer and F9 / Space binding values recorded before the first install.
#>
$ErrorActionPreference = 'Stop'

$claudeDir = Join-Path $HOME '.claude'
$settingsPath = Join-Path $claudeDir 'settings.json'
$keysPath = Join-Path $claudeDir 'keybindings.json'
$previousPath = Join-Path $claudeDir 'backups\dictate-previous.json'

function Write-JsonAtomic($value, $path, $depth) {
    $tmp = "$path.dictate-tmp"
    $value | ConvertTo-Json -Depth $depth | Set-Content $tmp -Encoding utf8
    Move-Item -Force $tmp $path
}
function Restore($object, $name, $saved) {
    if ($saved.present) { $object | Add-Member -Force $name $saved.value }
    else { $object.PSObject.Properties.Remove($name) }
}

claude plugin uninstall dictate@dictate --scope user
claude plugin marketplace remove dictate

if (-not (Test-Path $previousPath)) {
    Write-Warning "No ${previousPath}: settings and keybindings left as they are."
    exit 0
}
$previous = Get-Content $previousPath -Raw | ConvertFrom-Json

if (Test-Path $settingsPath) {
    $settings = Get-Content $settingsPath -Raw | ConvertFrom-Json
    Restore $settings 'voice' $previous.voice
    Restore $settings 'tui' $previous.tui
    Write-JsonAtomic $settings $settingsPath 100
}

if (Test-Path $keysPath) {
    $keys = Get-Content $keysPath -Raw | ConvertFrom-Json
    $chat = @($keys.bindings) | Where-Object { $_.context -eq 'Chat' } | Select-Object -First 1
    if ($chat) {
        Restore $chat.bindings 'f9' $previous.f9
        Restore $chat.bindings 'space' $previous.space
        $isEmpty = @($chat.bindings.PSObject.Properties).Count -eq 0
        if (-not $previous.chatBlock -and $isEmpty) {
            $keys.bindings = @($keys.bindings | Where-Object { $_ -ne $chat })
        }
    }
    if (@($keys.bindings).Count -eq 0 -and @($keys.PSObject.Properties).Count -eq 1) {
        Remove-Item $keysPath # Dictate created it
    } else {
        Write-JsonAtomic $keys $keysPath 20
    }
}

Remove-Item $previousPath
Write-Host 'Dictate removed. Restart Claude Code sessions (or /reload-plugins) to drop the mic.'
