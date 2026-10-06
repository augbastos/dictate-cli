#Requires -Version 7
<#
.SYNOPSIS
  Install → uninstall must leave Claude Code's settings exactly as they were, both for the
  full install and for -SkipPlugin (what /dictate setup and /dictate remove run).
  Each case runs in a throwaway config directory (CLAUDE_CONFIG_DIR), never the real one.
#>
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$install = Join-Path $repo 'scripts\install.ps1'
$uninstall = Join-Path $repo 'scripts\uninstall.ps1'

$cases = [ordered]@{
    'no settings, no keybindings' = @{ settings = $null; keys = $null }
    'existing settings and keybindings, voice/tui/alt+d/f11 already set' = @{
        settings = '{ "theme": "dark", "voice": { "enabled": false, "mode": "hold" }, "tui": "default", "language": "spanish" }'
        keys     = '{ "bindings": [ { "context": "Chat", "bindings": { "alt+d": "chat:stash", "f11": "chat:newline", "ctrl+k": "chat:clear" } } ] }'
    }
}

# Same content, key order ignored (Claude Code itself rewrites settings.json sorted).
function Sorted($value) {
    if ($value -is [System.Collections.IDictionary]) {
        $out = [ordered]@{}
        foreach ($key in ($value.Keys | Sort-Object)) { $out[$key] = Sorted $value[$key] }
        return $out
    }
    if ($value -is [System.Collections.IList]) { return , @($value | ForEach-Object { Sorted $_ }) }
    return $value
}

function Snapshot($dir) {
    $out = [ordered]@{}
    foreach ($name in 'settings.json', 'keybindings.json') {
        $path = Join-Path $dir $name
        $out[$name] = if (Test-Path $path) { Sorted (Get-Content $path -Raw | ConvertFrom-Json -AsHashtable) | ConvertTo-Json -Depth 100 -Compress } else { '<absent>' }
    }
    $out
}

$failures = 0
foreach ($case in $cases.GetEnumerator()) {
    foreach ($run in @{ n = 1; flags = @() }, @{ n = 2; flags = @() }, @{ n = 1; flags = @('-SkipPlugin') }) {
        $installs = $run.n; $flags = $run.flags; $label = "installed ${installs}x$(if ($flags) { ' ' + ($flags -join ' ') })"
        $dir = Join-Path ([IO.Path]::GetTempPath()) ("dictate-cli-test-" + [guid]::NewGuid())
        New-Item -ItemType Directory $dir | Out-Null
        if ($case.Value.settings) { Set-Content (Join-Path $dir 'settings.json') $case.Value.settings }
        if ($case.Value.keys) { Set-Content (Join-Path $dir 'keybindings.json') $case.Value.keys }
        $before = Snapshot $dir
        $env:CLAUDE_CONFIG_DIR = $dir
        try {
            for ($i = 0; $i -lt $installs; $i++) {
                pwsh -NoProfile -File $install @flags | Out-Null
                if ($LASTEXITCODE -ne 0) { throw "install exited $LASTEXITCODE" }
            }
            $keys = Get-Content (Join-Path $dir 'keybindings.json') -Raw | ConvertFrom-Json
            $chat = @($keys.bindings) | Where-Object { $_.context -eq 'Chat' } | Select-Object -First 1
            if ($chat.bindings.'alt+d' -ne 'command:dictate' -or $chat.bindings.f11 -ne 'voice:pushToTalk') { throw 'install did not bind alt+d and f11' }
            pwsh -NoProfile -File $uninstall @flags | Out-Null
            if ($LASTEXITCODE -ne 0) { throw "uninstall exited $LASTEXITCODE" }
            $after = Snapshot $dir
            foreach ($name in $before.Keys) {
                if ($before[$name] -ne $after[$name]) { throw "$name differs: before $($before[$name]) after $($after[$name])" }
            }
            $junk = @(Get-ChildItem $dir -Recurse -File | Where-Object { $_.Name -like '*.dictate-tmp' -or $_.Name -eq 'dictate-cli-previous.json' })
            if ($junk.Count -gt 0) { throw "left behind: $($junk.Name -join ', ')" }
            Write-Host "PASS  $($case.Key) ($label)"
        } catch {
            Write-Host "FAIL  $($case.Key) ($label): $_"
            $failures++
        } finally {
            Remove-Item Env:\CLAUDE_CONFIG_DIR
            Remove-Item $dir -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}
exit $failures
