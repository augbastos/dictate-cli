<#
.SYNOPSIS
  Removes Dictate: uninstalls the plugin and its marketplace, restores the voice and
  renderer settings install.ps1 changed, and removes the F9 / Space voice bindings.
.PARAMETER Backup
  The backup folder install.ps1 printed; the newest dictate-* backup when omitted.
#>
param([string]$Backup)
$ErrorActionPreference = 'Stop'

$claudeDir = Join-Path $HOME '.claude'
$settingsPath = Join-Path $claudeDir 'settings.json'
$keysPath = Join-Path $claudeDir 'keybindings.json'
if (-not $Backup) {
    $Backup = Get-ChildItem (Join-Path $claudeDir 'backups') -Directory -Filter 'dictate-*' |
        Sort-Object Name | Select-Object -Last 1 -ExpandProperty FullName
}

claude plugin uninstall dictate@dictate --scope user
claude plugin marketplace remove dictate

# settings.json: put back the voice and tui values from before install.
$previousPath = if ($Backup) { Join-Path $Backup 'dictate-previous.json' }
if ($previousPath -and (Test-Path $previousPath) -and (Test-Path $settingsPath)) {
    $previous = Get-Content $previousPath -Raw | ConvertFrom-Json
    $settings = Get-Content $settingsPath -Raw | ConvertFrom-Json
    foreach ($name in 'voice', 'tui') {
        $value = $previous.$name
        if ($null -eq $value) { $settings.PSObject.Properties.Remove($name) }
        else { $settings | Add-Member -Force $name $value }
    }
    $settings | ConvertTo-Json -Depth 100 | Set-Content $settingsPath -Encoding utf8
} else {
    Write-Warning 'No install backup found: voice and tui settings left as they are.'
}

# keybindings.json: drop the two bindings Dictate added.
if (Test-Path $keysPath) {
    $keys = Get-Content $keysPath -Raw | ConvertFrom-Json
    foreach ($block in @($keys.bindings) | Where-Object { $_.context -eq 'Chat' }) {
        if ($block.bindings.f9 -eq 'voice:pushToTalk') { $block.bindings.PSObject.Properties.Remove('f9') }
        if ($block.bindings.PSObject.Properties['space'] -and $null -eq $block.bindings.space) {
            $block.bindings.PSObject.Properties.Remove('space')
        }
    }
    $keys.bindings = @($keys.bindings | Where-Object { @($_.bindings.PSObject.Properties).Count -gt 0 })
    $keys | ConvertTo-Json -Depth 20 | Set-Content $keysPath -Encoding utf8
}

Write-Host 'Dictate removed. Restart Claude Code sessions (or /reload-plugins) to drop the mic.'
