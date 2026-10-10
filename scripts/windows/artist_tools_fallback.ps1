param(
    [switch]$Authorize
)
$ErrorActionPreference = 'Stop'
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$logDirectory = Join-Path $env:LOCALAPPDATA 'StreamBase'
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
$logPath = Join-Path $logDirectory 'artist-tools.log'
$exitCode = 1
try {
    $envFile = Join-Path $repoRoot 'web/.env.local'
    if (-not (Test-Path -LiteralPath $envFile)) { throw 'Missing web/.env.local' }
    $configuration = @{}
    foreach ($line in Get-Content -LiteralPath $envFile) {
        if ($line -match '^\s*(?:export\s+)?(SUPABASE_URL|NEXT_PUBLIC_SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY)\s*=\s*(.*?)\s*$') {
            $name = $Matches[1]
            $value = $Matches[2]
            if ($value.Length -ge 2 -and (($value.StartsWith('"') -and $value.EndsWith('"')) -or
                ($value.StartsWith("'") -and $value.EndsWith("'")))) {
                $value = $value.Substring(1, $value.Length - 2)
            }
            $configuration[$name] = $value
        }
    }
    $env:SUPABASE_URL = $configuration['SUPABASE_URL']
    if (-not $env:SUPABASE_URL) { $env:SUPABASE_URL = $configuration['NEXT_PUBLIC_SUPABASE_URL'] }
    $env:SUPABASE_SERVICE_ROLE_KEY = $configuration['SUPABASE_SERVICE_ROLE_KEY']
    if (-not $env:SUPABASE_URL -or -not $env:SUPABASE_SERVICE_ROLE_KEY) { throw 'Missing Supabase configuration' }
    Push-Location -LiteralPath $repoRoot
    try {
        Add-Content -LiteralPath $logPath -Value "[$(Get-Date -Format o)] Starting artist.tools"
        if ($Authorize) {
            & python scripts/artist_tools_mcp.py authorize 2>&1 | Tee-Object -FilePath $logPath -Append
        } else {
            & python scripts/artist_tools_daily.py run --runner pc --skip-if-done 2>&1 |
                Out-File -LiteralPath $logPath -Append -Encoding utf8
        }
        $exitCode = $LASTEXITCODE
        Add-Content -LiteralPath $logPath -Value "[$(Get-Date -Format o)] Exit $exitCode"
    } finally {
        Pop-Location
    }
} catch {
    # Do not log exception objects: environment parsing must never reveal secrets.
    Add-Content -LiteralPath $logPath -Value "[$(Get-Date -Format o)] Fallback setup failed; check Python and web/.env.local."
} finally {
    Remove-Item Env:SUPABASE_SERVICE_ROLE_KEY -ErrorAction SilentlyContinue
}
exit $exitCode
