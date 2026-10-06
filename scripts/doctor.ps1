#Requires -Version 7
<#
.SYNOPSIS
  Checks that DictateCLI is ready to dictate, and says what to do when it is not.
  Read-only: it changes nothing and does not touch the microphone.
#>
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')

$repo = Split-Path -Parent $PSScriptRoot
$claudeDir = Get-ClaudeDir
$rows = [System.Collections.Generic.List[object]]::new()
function Row($name, $value, $isOk, $fix) { $rows.Add([pscustomobject]@{ Name = $name; Value = $value; Ok = $isOk; Fix = $fix }) }
function Read-JsonOrNull($path) { if (Test-Path $path) { try { Get-Content $path -Raw | ConvertFrom-Json } catch { $null } } }

$install = 'pwsh -File scripts\install.ps1'
$version = Get-ClaudeVersion
Row 'Claude Code' ($(if ($version) { "$version" } else { 'not found' })) ($null -ne $version -and $version -ge $MinClaudeVersion) "Install or update Claude Code ($MinClaudeVersion or newer)"

$plugins = if ($version) { (& claude plugin list 2>$null | Out-String) } else { '' }
Row 'Plugin' ($(if ($plugins -match 'dictate-cli@dictate-cli') { 'installed' } else { 'not installed' })) ($plugins -match 'dictate-cli@dictate-cli') "Run: $install"

$settings = Read-JsonOrNull (Join-Path $claudeDir 'settings.json')
$voiceOk = $settings.voice.enabled -eq $true -and $settings.voice.mode -eq 'tap'
Row 'Native voice' ($(if ($voiceOk) { 'tap mode' } else { 'not set up' })) $voiceOk "Run: $install"
Row 'Fullscreen' ($(if ($settings.tui -eq 'fullscreen') { 'on' } else { 'off' })) ($settings.tui -eq 'fullscreen') 'Clicks need it. Run the installer, or set tui to fullscreen'

$keys = Read-JsonOrNull (Join-Path $claudeDir 'keybindings.json')
$chat = @($keys.bindings) | Where-Object { $_.context -eq 'Chat' } | Select-Object -First 1
$voiceKey = $chat.bindings.f11 -eq 'voice:pushToTalk'
Row 'Voice key' ($(if ($voiceKey) { 'bound' } else { 'missing' })) $voiceKey "Run: $install"
$shortcut = ($chat.bindings.PSObject.Properties | Where-Object { $_.Value -eq 'command:dictate' } | Select-Object -First 1).Name
Row 'Shortcut' ($(if ($shortcut) { $shortcut } else { 'none (click the mic)' })) $true ''

$helper = Join-Path $repo 'bin\dictate-key.exe'
Row 'Helper' ($(if (Test-Path $helper) { 'ready' } else { 'missing' })) (Test-Path $helper) "Run: $install"
Row 'Language' ($(if ($settings.language) { $settings.language } else { 'Claude Code default' })) $true ''

Write-Host ''
Write-Host 'DictateCLI doctor'
Write-Host ''
foreach ($row in $rows) {
    $mark = if ($row.Ok) { 'ok' } else { '!!' }
    Write-Host ('  {0,-14}{1,-24}{2}' -f $row.Name, $row.Value, $mark)
}
Write-Host ('  {0,-14}{1}' -f 'Microphone', 'checked by Claude Code when you start')
Write-Host ''
$broken = @($rows | Where-Object { -not $_.Ok })
if ($broken.Count -eq 0) {
    Write-Host 'Ready to dictate.'
    exit 0
}
$broken | ForEach-Object { Write-Host "$($_.Name): $($_.Fix)" }
exit 1
