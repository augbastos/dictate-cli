#Requires -Version 7
<#
.SYNOPSIS
  The installer's preflight: an old Claude Code is refused with a plain message, a
  current one passes, and a refused install changes nothing.
#>
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
. (Join-Path $repo 'scripts\common.ps1')
$failures = 0
function Check($name, $condition) {
    if ($condition) { Write-Host "PASS  $name" } else { Write-Host "FAIL  $name"; $script:failures++ }
}

function Get-ClaudeVersion { [version]'2.1.200' }
$old = @(Get-PreflightProblems $repo)
Check 'old Claude Code is refused' ($old -match 'requires Claude Code 2\.1\.287 or newer\. Found: 2\.1\.200')

function Get-ClaudeVersion { [version]'2.1.291' }
Check 'current Claude Code passes' (@(Get-PreflightProblems $repo).Count -eq 0)

# A refused install exits before touching anything: point PATH at a fake old `claude`.
$fake = Join-Path ([IO.Path]::GetTempPath()) ("dictate-cli-fake-" + [guid]::NewGuid())
$config = Join-Path $fake 'config'
New-Item -ItemType Directory $config -Force | Out-Null
Set-Content (Join-Path $fake 'claude.cmd') '@echo 2.1.100 (Claude Code)'
$savedPath = $env:PATH
$env:PATH = "$fake;$env:PATH"
$env:CLAUDE_CONFIG_DIR = $config
try {
    $out = pwsh -NoProfile -File (Join-Path $repo 'scripts\install.ps1') | Out-String
    Check 'refused install exits 1' ($LASTEXITCODE -eq 1)
    Check 'refused install says nothing was changed' ($out -match 'Nothing was changed')
    Check 'refused install wrote no files' (@(Get-ChildItem $config -Recurse -Force).Count -eq 0)
} finally {
    $env:PATH = $savedPath
    Remove-Item Env:\CLAUDE_CONFIG_DIR
    Remove-Item $fake -Recurse -Force -ErrorAction SilentlyContinue
}
exit $failures
