param(
    [string]$BlenderPath = "D:\Blender Foundation\Blender 4.5\blender.exe",
    [string]$AddonUrl = "https://raw.githubusercontent.com/ahujasid/blender-mcp/main/addon.py"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $BlenderPath)) {
    throw "Blender executable not found: $BlenderPath"
}

$versionLine = & $BlenderPath --version | Select-Object -First 1
if ($versionLine -notmatch '^Blender\s+(\d+\.\d+)') {
    throw "Could not determine the Blender version from: $versionLine"
}

$blenderVersion = $Matches[1]
$addonDirectory = Join-Path $env:APPDATA "Blender Foundation\Blender\$blenderVersion\scripts\addons"
$addonPath = Join-Path $addonDirectory "blender_mcp.py"
$downloadPath = Join-Path ([System.IO.Path]::GetTempPath()) "blender-mcp-addon-$PID.py"
$backupPath = $null
$addonCopied = $false

New-Item -ItemType Directory -Path $addonDirectory -Force | Out-Null

try {
    Invoke-WebRequest -Uri $AddonUrl -OutFile $downloadPath -UseBasicParsing

    $addonSource = Get-Content -Raw -LiteralPath $downloadPath
    if ($addonSource.Length -lt 10000 -or $addonSource -notmatch '"name":\s*"Blender MCP"') {
        throw "The downloaded file does not look like the Blender MCP addon."
    }

    if (Test-Path -LiteralPath $addonPath) {
        $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
        $backupPath = "$addonPath.backup-$timestamp"
        Copy-Item -LiteralPath $addonPath -Destination $backupPath
    }

    Copy-Item -LiteralPath $downloadPath -Destination $addonPath -Force
    $addonCopied = $true

    $enableExpression = "import bpy; bpy.ops.preferences.addon_enable(module='blender_mcp'); enabled = 'blender_mcp' in bpy.context.preferences.addons; print('BLENDER_MCP_ADDON_ENABLED=' + str(enabled)); assert enabled; bpy.ops.wm.save_userpref()"
    $blenderOutput = & $BlenderPath --background --python-expr $enableExpression 2>&1
    $blenderOutputText = $blenderOutput -join [Environment]::NewLine
    if ($LASTEXITCODE -ne 0 -or $blenderOutputText -notmatch 'BLENDER_MCP_ADDON_ENABLED=True') {
        throw "Blender could not enable the addon.`n$blenderOutputText"
    }

    [pscustomobject]@{
        BlenderVersion = $blenderVersion
        AddonPath = $addonPath
        BackupPath = $backupPath
        Enabled = $true
    } | ConvertTo-Json
}
catch {
    if ($addonCopied) {
        if ($backupPath -and (Test-Path -LiteralPath $backupPath)) {
            Copy-Item -LiteralPath $backupPath -Destination $addonPath -Force
        }
        elseif (Test-Path -LiteralPath $addonPath) {
            Remove-Item -LiteralPath $addonPath -Force
        }
    }
    throw
}
finally {
    if (Test-Path -LiteralPath $downloadPath) {
        Remove-Item -LiteralPath $downloadPath -Force
    }
}
