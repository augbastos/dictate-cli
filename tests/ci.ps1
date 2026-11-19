#Requires -Version 7
# Each installer test runs in its own process and throwaway configuration. Only
# rollback builds the helper; plugin tests mock processes and use virtual clocks.
$ErrorActionPreference = 'Stop'
& pwsh -NoProfile -File (Join-Path $PSScriptRoot 'ci-workflow.ps1')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
$results = @('plugin', 'preflight', 'install-rollback') | ForEach-Object -Parallel {
    $ErrorActionPreference = 'Stop'
    $timer = [Diagnostics.Stopwatch]::StartNew()
    $code = 1
    try {
        if ($_ -eq 'plugin') {
            & claude plugin test . 2>&1 | ForEach-Object { Write-Host $_ }
        } else {
            & pwsh -NoProfile -File "tests/$_.ps1" 2>&1 | ForEach-Object { Write-Host $_ }
        }
        $code = $LASTEXITCODE
    } catch {
        Write-Host "FAIL  ${_}"
    }
    [pscustomobject]@{ Module = $_; ExitCode = $code; Seconds = [math]::Round($timer.Elapsed.TotalSeconds, 2) }
} -ThrottleLimit ([math]::Min(3, [Environment]::ProcessorCount))
$results | Format-Table | Out-Host
if (@($results).Count -ne 3 -or @($results | Where-Object ExitCode -ne 0).Count) { exit 1 }
exit 0
