<#
Empaqueta miku-voice-server.exe para distribuirlo como asset de una GitHub
Release, ya que supera el limite de 2 GiB por archivo del bundle NSIS (y
tambien el limite de 2 GiB por asset de GitHub Releases, por eso se parte
en fragmentos).

Rhubarb NO se empaqueta aparte: el .spec ya lo embebe dentro del .exe
onefile (datas = [('rhubarb', 'rhubarb')]), verificado corriendo el
ejecutable en una carpeta aislada y confirmando que rhubarb.exe aparece
extraido en _MEIPASS.

Uso:
    .\publish-release.ps1
    .\publish-release.ps1 -PublishRelease
    .\publish-release.ps1 -ExePath "dist\miku-voice-server.exe" -PublishRelease

Sin -PublishRelease solo arma los archivos en .\release-staging\ para que
los puedas revisar antes de subir nada a GitHub.
#>

param(
    [string]$ExePath = "$PSScriptRoot\dist\miku-voice-server.exe",
    [string]$StagingDir = "$PSScriptRoot\release-staging",
    [string]$Repo = "MyNameIsGs/Miku-AI",
    [string]$Tag = "voice-server-assets",
    [int]$ChunkSizeMB = 1800,
    [switch]$PublishRelease
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $ExePath)) {
    throw "No se encontro el ejecutable en: $ExePath"
}

if (Test-Path $StagingDir) {
    Remove-Item $StagingDir -Recurse -Force
}
New-Item -ItemType Directory -Path $StagingDir | Out-Null

function Split-FileIntoChunks {
    param(
        [string]$SourcePath,
        [string]$DestDir,
        [string]$BaseName,
        [long]$ChunkSizeBytes
    )

    $bufferSize = 4MB
    $buffer = New-Object byte[] $bufferSize
    $parts = @()
    $partIndex = 0

    $source = [System.IO.File]::OpenRead($SourcePath)
    try {
        while ($source.Position -lt $source.Length) {
            $partIndex++
            $partName = "{0}.part{1:D3}" -f $BaseName, $partIndex
            $partPath = Join-Path $DestDir $partName
            $remaining = [Math]::Min($ChunkSizeBytes, $source.Length - $source.Position)

            $dest = [System.IO.File]::OpenWrite($partPath)
            try {
                $written = 0
                while ($written -lt $remaining) {
                    $toRead = [Math]::Min($bufferSize, $remaining - $written)
                    $read = $source.Read($buffer, 0, $toRead)
                    if ($read -le 0) { break }
                    $dest.Write($buffer, 0, $read)
                    $written += $read
                }
            } finally {
                $dest.Close()
            }

            Write-Host "  -> $partName ($([Math]::Round($remaining / 1MB, 1)) MB)"
            $parts += $partName
        }
    } finally {
        $source.Close()
    }

    return $parts
}

Write-Host "[1/3] Calculando SHA256 de $ExePath ..."
$exeHash = (Get-FileHash -Path $ExePath -Algorithm SHA256).Hash.ToLower()
$exeSize = (Get-Item $ExePath).Length
Write-Host "  SHA256: $exeHash ($([Math]::Round($exeSize / 1GB, 2)) GB)"

Write-Host "[2/3] Partiendo el ejecutable en fragmentos de $ChunkSizeMB MB ..."
$exeParts = Split-FileIntoChunks -SourcePath $ExePath -DestDir $StagingDir `
    -BaseName "miku-voice-server.exe" -ChunkSizeBytes ([long]$ChunkSizeMB * 1MB)

Write-Host "[3/3] Escribiendo manifest.json ..."
$manifest = @{
    builtAt = (Get-Date).ToUniversalTime().ToString("o")
    exe     = @{
        fileName = "miku-voice-server.exe"
        size     = $exeSize
        sha256   = $exeHash
        parts    = $exeParts
    }
}
$manifestPath = Join-Path $StagingDir "manifest.json"
$manifestJson = $manifest | ConvertTo-Json -Depth 5
# Set-Content -Encoding utf8 en Windows PowerShell 5.1 agrega BOM, y
# serde_json (del lado Rust) no lo tolera al principio del archivo.
[System.IO.File]::WriteAllText($manifestPath, $manifestJson, (New-Object System.Text.UTF8Encoding $false))

Write-Host ""
Write-Host "Listo. Archivos armados en: $StagingDir"

if (-not $PublishRelease) {
    Write-Host ""
    Write-Host "No se publico nada (falta -PublishRelease). Revisa los archivos y corre de nuevo con -PublishRelease para subirlos a GitHub Releases."
    return
}

Write-Host ""
Write-Host "Publicando en GitHub Releases: $Repo (tag: $Tag) ..."

$assets = Get-ChildItem $StagingDir -File | ForEach-Object { $_.FullName }

# gh (como cualquier comando nativo) no lanza una excepcion de PowerShell al
# fallar, y con $ErrorActionPreference = "Stop" su salida por stderr se
# convierte en un NativeCommandError que corta el script. Lo bajamos a
# "Continue" solo para las llamadas a gh y revisamos $LASTEXITCODE a mano.
$prevEap = $ErrorActionPreference
$ErrorActionPreference = "Continue"

gh release view $Tag --repo $Repo | Out-Null
$releaseExists = ($LASTEXITCODE -eq 0)

if (-not $releaseExists) {
    gh release create $Tag $assets --repo $Repo `
        --title "Voice Server Assets" `
        --notes "Binario del servidor de voz (Whisper + RVC + Rhubarb embebido), descargado automaticamente por la app en el primer arranque. No es una version del instalador de Miku-AI."
} else {
    gh release upload $Tag $assets --repo $Repo --clobber
}
$publishExitCode = $LASTEXITCODE

$ErrorActionPreference = $prevEap

if ($publishExitCode -ne 0) {
    throw "gh fallo al publicar la release (exit code $publishExitCode)"
}

Write-Host "Publicado."
