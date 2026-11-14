#Requires -Version 7
# Offline contracts for the workflow and its aggregate gate.
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$workflow = (Get-Content (Join-Path $repo '.github/workflows/ci.yml') -Raw).Replace("`r`n", "`n")
$policy = Get-Content (Join-Path $repo '.github/scripts/safety.sh') -Raw
$failures = 0
function Check($name, $condition) {
    if ($condition) { Write-Host "PASS  $name" } else { Write-Host "FAIL  $name"; $script:failures++ }
}

$jobs = @{}
foreach ($match in [regex]::Matches(($workflow -split "jobs:`n", 2)[1], '(?ms)^  ([\w-]+):\n(.*?)(?=^  [\w-]+:|\z)')) {
    $jobs[$match.Groups[1].Value] = $match.Groups[2].Value
}
Check 'public profile and standard check names' ($workflow.StartsWith("# CI profile: public`nname: CI`n") -and
    (([regex]::Matches($workflow, '(?m)^    name: (.+)$') | ForEach-Object { $_.Groups[1].Value }) -join ',') -eq 'Safety,Lint,Test (Windows),CI passed')
Check 'only the expected jobs run' (($jobs.Keys | Sort-Object) -join ',' -eq 'ci-passed,public-safe,safety,windows')
Check 'old safety workflow removed' (-not (Test-Path (Join-Path $repo '.github/workflows/safety.yml')))
Check 'triggers retained' ($workflow.Contains("  push:`n    branches: [main]") -and
    $workflow.Contains('types: [opened, synchronize, reopened, ready_for_review]') -and $workflow.Contains('  workflow_dispatch:'))
Check 'read-only token and PR-only cancellation' ($workflow.Contains("permissions:`n  contents: read") -and
    $workflow.Contains('group: ${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}') -and
    $workflow.Contains("cancel-in-progress: `${{ github.event_name == 'pull_request' }}") -and
    -not $workflow.Contains('pull_request_target'))
foreach ($job in $jobs.Keys) { Check "$job has a timeout" ($jobs[$job].Contains('timeout-minutes:')) }
foreach ($line in ($workflow -split "`n" | Where-Object { $_ -match 'uses:' })) {
    Check 'action pinned by SHA and version' ($line -match 'uses: actions/[\w-]+@[0-9a-f]{40} # v[\d.]+$')
}
$safety = $jobs['safety']
Check 'base policy with bootstrap only when absent' ($safety.Contains("if: github.event_name == 'pull_request'") -and
    $safety.Contains('ref: ${{ github.event.pull_request.base.sha }}') -and
    $safety.Contains("if: hashFiles('base-policy/.github/scripts/safety.sh') == ''") -and
    $safety.Contains('bash base-policy/.github/scripts/safety.sh') -and
    $safety.Contains('bash bootstrap-policy/.github/scripts/safety.sh') -and
    ([regex]::Matches($safety, 'persist-credentials: false')).Count -eq 3 -and
    ([regex]::Matches($safety, 'sparse-checkout: .github/scripts')).Count -eq 2 -and
    $safety.Contains('fetch-depth: 0'))
Check 'pinned scanner and base rules fail closed' ($policy.Contains('/v8.21.2/gitleaks_8.21.2_linux_x64.tar.gz') -and
    $policy.Contains('5bc41815076e6ed6ef8fbecc9d9b75bcae31f39029ceb55da08086315316e3ba') -and
    $policy.Contains('set -euo pipefail') -and $policy.Contains('.previous_filename') -and
    $policy.Contains('safety-critical.txt?ref=$BASE') -and $policy.Contains('invalid critical-path rule'))
Check 'gate needs every other job and always runs' ($jobs['ci-passed'].Contains('needs: [safety, public-safe, windows]') -and
    $jobs['ci-passed'].Contains('if: always()'))
Check 'Windows runtime, cache and parallel runner retained' ($jobs['windows'].Contains('runs-on: windows-latest') -and
    $jobs['windows'].Contains("node-version: '24'") -and $jobs['windows'].Contains('cache-dependency-path: .github/ci/package-lock.json') -and
    $jobs['windows'].Contains('run: ./tests/ci.ps1'))

# Execute the actual shell gate, including every success/failure/skip/cancel combination.
$bash = Join-Path (Split-Path (Get-Command git).Source) '../bin/bash.exe'
if (-not (Test-Path $bash)) { $bash = (Get-Command bash).Source }
$gate = (($jobs['ci-passed'] -split "        run: \|`n", 2)[1] -replace '(?m)^          ', '').Trim()
$commands = [Collections.Generic.List[string]]::new()
$commands.Add("gate() {`n$gate`n}")
foreach ($event in 'pull_request', 'push', 'workflow_dispatch') {
    foreach ($s in 'success', 'failure', 'skipped', 'cancelled') {
        foreach ($lint in 'success', 'failure', 'skipped', 'cancelled') {
            foreach ($test in 'success', 'failure', 'skipped', 'cancelled') {
                $needs = @{ safety = @{ result = $s }; 'public-safe' = @{ result = $lint }; windows = @{ result = $test } } | ConvertTo-Json -Compress
                $expected = if ($lint -eq 'success' -and $test -eq 'success' -and ($s -eq 'success' -or ($s -eq 'skipped' -and $event -ne 'pull_request'))) { 0 } else { 1 }
                $commands.Add("EVENT_NAME='$event' NEEDS_JSON='$needs' gate >/dev/null 2>&1")
                $commands.Add('[ "$?" -eq ' + $expected + ' ] || exit 99')
            }
        }
    }
}
($commands -join "`n") | & $bash -s
Check 'actual gate handles all 192 result combinations' ($LASTEXITCODE -eq 0)
$rule = [regex]::Match($policy, "'([^']+) :: changes the merge safety check itself'").Groups[1].Value
foreach ($path in '.github/scripts/safety.sh', '.github/safety-critical.txt', '.github/workflows/ci.yml') {
    & $bash -c ('printf ''%s\n'' ''' + $path + ''' | grep -Eq -- ''' + $rule + '''')
    Check "self-protection covers $path" ($LASTEXITCODE -eq 0)
}
exit $failures
