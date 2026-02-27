param(
  [int]$Limit = 200,
  [string]$Isrc = ""
)

$ErrorActionPreference = "Stop"

$envPath = Join-Path (Join-Path $PSScriptRoot "..\\web") ".env.local"
if (!(Test-Path -LiteralPath $envPath)) {
  throw "Missing web/.env.local at $envPath"
}

foreach ($line in Get-Content -LiteralPath $envPath) {
  if ($line -match "^\s*#" -or $line -match "^\s*$") { continue }
  if ($line -match "^\s*([^=\s]+)\s*=\s*(.*)\s*$") {
    $name = $matches[1].Trim()
    $val = $matches[2].Trim()

    # strip surrounding quotes
    if (($val.StartsWith('"') -and $val.EndsWith('"')) -or ($val.StartsWith("'") -and $val.EndsWith("'"))) {
      $val = $val.Substring(1, $val.Length - 2)
    }

    [System.Environment]::SetEnvironmentVariable($name, $val, "Process")
  }
}

# Provide compatibility for scripts expecting SUPABASE_URL
if (-not $env:SUPABASE_URL -and $env:NEXT_PUBLIC_SUPABASE_URL) {
  $env:SUPABASE_URL = $env:NEXT_PUBLIC_SUPABASE_URL
}

$pyArgs = @((Join-Path $PSScriptRoot "enrich_tracks_with_spotify.py"))
if ($Isrc) {
  $pyArgs += "--isrc", $Isrc
} else {
  $pyArgs += "--limit", $Limit
}
python @pyArgs

