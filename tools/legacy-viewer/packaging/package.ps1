param([Parameter(Mandatory=$true)][string]$Destination,
      [Parameter(Mandatory=$true)][string]$Python,
      [Parameter(Mandatory=$true)][string]$Database,
      [string]$ArtSource,
      [string]$Registry)
$ErrorActionPreference='Stop'
$taskRoot=Split-Path -Parent $PSScriptRoot
$packageTarget=[IO.Path]::GetFullPath($Destination)
New-Item -ItemType Directory -Path $packageTarget -Force | Out-Null
$buildWork=Join-Path $packageTarget 'pyinstaller-work'
# PyInstaller logs INFO lines to stderr; under Windows PowerShell 5.1 + 'Stop' those become
# terminating errors, so relax only for this call and rely on the exit code instead.
$ErrorActionPreference='Continue'
& $Python -m PyInstaller --noconfirm --clean --distpath $packageTarget --workpath $buildWork (Join-Path $PSScriptRoot 'legacy_viewer.spec') 2>&1 | ForEach-Object { "$_" } | Out-Host
$pyinstallerExit=$LASTEXITCODE
$ErrorActionPreference='Stop'
if($pyinstallerExit -ne 0){throw 'PyInstaller failed'}
# Remove only the verified build-work child; never use another shell for deletes.
$resolvedWork=[IO.Path]::GetFullPath($buildWork)
if(-not $resolvedWork.StartsWith($packageTarget.TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Unsafe build-work target'}
Remove-Item -LiteralPath $resolvedWork -Recurse -Force
$dataTarget=Join-Path $packageTarget 'data'
New-Item -ItemType Directory -Path $dataTarget -Force | Out-Null
Copy-Item -LiteralPath $Database -Destination (Join-Path $dataTarget 'legacy_archive.duckdb') -Force
if($Registry){Copy-Item -LiteralPath $Registry -Destination (Join-Path $dataTarget 'grafana_registry.json') -Force}
# Small cached cover/artist thumbnails (build\fetch_artwork.py); optional: without them the viewer shows initials tiles.
if($ArtSource -and (Test-Path -LiteralPath $ArtSource)){
    $artTarget=Join-Path $packageTarget 'art'
    New-Item -ItemType Directory -Path $artTarget -Force | Out-Null
    Get-ChildItem -LiteralPath $ArtSource | Copy-Item -Destination $artTarget -Recurse -Force
}else{Write-Warning 'Artwork folder is missing; the viewer will show initials tiles instead of cover art.'}
$uiSource=Join-Path $taskRoot 'ui\dist'
if(Test-Path -LiteralPath $uiSource){
    $uiTarget=Join-Path $packageTarget 'ui'
    New-Item -ItemType Directory -Path $uiTarget -Force | Out-Null
    Get-ChildItem -LiteralPath $uiSource | Copy-Item -Destination $uiTarget -Recurse -Force
}else{Write-Warning 'ui/dist is missing. API works; copy the UI distribution before using the viewer.'}
foreach($file in @('Open Legacy Viewer.cmd','Stop Legacy Viewer.cmd','README.txt')){
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot $file) -Destination (Join-Path $packageTarget $file) -Force
}
$manifest=Join-Path $packageTarget 'SHA256SUMS.txt'
$hashRows=Get-ChildItem -LiteralPath $packageTarget -File -Recurse | Where-Object {$_.FullName -ne $manifest -and $_.Name -notlike '.viewer*'} | Sort-Object FullName | ForEach-Object {
    $relative=$_.FullName.Substring($packageTarget.TrimEnd('\').Length+1).Replace('\','/')
    (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()+'  '+$relative
}
[IO.File]::WriteAllLines($manifest,[string[]]$hashRows,(New-Object Text.UTF8Encoding($false)))
Write-Output ('Packaged '+$packageTarget)
