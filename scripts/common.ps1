# Shared by install.ps1, uninstall.ps1 and doctor.ps1: where Claude Code keeps its
# files, and the checks that must pass before anything is changed.

$MinClaudeVersion = [version]'2.1.287'

# Claude Code's own config directory: CLAUDE_CONFIG_DIR when set (as Claude Code does),
# otherwise ~/.claude.
function Get-ClaudeDir {
    if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { Join-Path $HOME '.claude' }
}

function Get-ClaudeVersion {
    if (-not (Get-Command claude -ErrorAction SilentlyContinue)) { return $null }
    $text = (& claude --version 2>$null | Out-String)
    if ($text -match '(\d+\.\d+\.\d+)') { [version]$Matches[1] } else { $null }
}

function Get-Csc {
    Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
}

# Human-readable problems that block an install; empty when all is well.
function Get-PreflightProblems($repo) {
    $problems = @()
    if (-not $IsWindows) { return @('DictateCLI currently runs on Windows only.') }
    $version = Get-ClaudeVersion
    if (-not (Get-Command claude -ErrorAction SilentlyContinue)) {
        $problems += 'Claude Code was not found (the `claude` command). Install Claude Code first.'
    } elseif ($null -eq $version) {
        $problems += 'Could not read the Claude Code version (`claude --version`).'
    } elseif ($version -lt $MinClaudeVersion) {
        $problems += "DictateCLI requires Claude Code $MinClaudeVersion or newer. Found: $version"
    }
    if (-not (Test-Path (Get-Csc))) {
        $problems += 'The C# compiler included with Windows (.NET Framework 4) was not found.'
    }
    foreach ($manifest in '.claude-plugin\plugin.json', '.claude-plugin\marketplace.json') {
        try { Get-Content (Join-Path $repo $manifest) -Raw | ConvertFrom-Json | Out-Null }
        catch { $problems += "The DictateCLI files look damaged ($manifest). Download DictateCLI again." }
    }
    return $problems
}
