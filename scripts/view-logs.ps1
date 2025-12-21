#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Script auxiliar para visualizar logs con encoding UTF-8 correcto en Windows.

.DESCRIPTION
    Este script configura la sesión de PowerShell para usar UTF-8 y luego
    muestra los logs del servidor o scripts con Get-Content.
    Soluciona el problema de caracteres rotos al leer archivos de log.

.PARAMETER LogType
    Tipo de log a visualizar: 'server' o 'script'. Default: 'server'

.PARAMETER LogFile
    Archivo específico: 'combined' o 'errors'. Default: 'combined'

.PARAMETER Lines
    Número de líneas a mostrar desde el final. Default: 50

.PARAMETER Follow
    Si se especifica, sigue el archivo en tiempo real (como tail -f)

.EXAMPLE
    .\view-logs.ps1
    Muestra las últimas 50 líneas de logs/server/combined.log

.EXAMPLE
    .\view-logs.ps1 -LogType script -Lines 100
    Muestra las últimas 100 líneas de logs/script/combined.log

.EXAMPLE
    .\view-logs.ps1 -Follow
    Sigue el archivo logs/server/combined.log en tiempo real

.EXAMPLE
    .\view-logs.ps1 -LogFile errors
    Muestra logs/server/errors.log
#>

param(
    [Parameter(Position = 0)]
    [ValidateSet('server', 'script')]
    [string]$LogType = 'server',

    [Parameter(Position = 1)]
    [ValidateSet('combined', 'errors')]
    [string]$LogFile = 'combined',

    [Parameter()]
    [int]$Lines = 50,

    [Parameter()]
    [switch]$Follow
)

# Configurar console para UTF-8
Write-Host "Configurando encoding UTF-8..." -ForegroundColor Cyan
chcp 65001 | Out-Null
$OutputEncoding = [System.Text.UTF8Encoding]::new()
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()

# Construir ruta del archivo
$logPath = Join-Path $PSScriptRoot "..\logs\$LogType\$LogFile.log"

# Verificar que el archivo existe
if (-not (Test-Path $logPath)) {
    Write-Host "ERROR: No se encontro el archivo de log: $logPath" -ForegroundColor Red
    Write-Host "`nAsegurate de que el servidor o script haya generado logs." -ForegroundColor Yellow
    exit 1
}

# Mostrar información
Write-Host "`nVisualizando: " -NoNewline -ForegroundColor Green
Write-Host $logPath -ForegroundColor White
Write-Host "Encoding: UTF-8" -ForegroundColor Cyan
Write-Host ("=" * 80) -ForegroundColor DarkGray
Write-Host ""

# Leer y mostrar el archivo
try {
    if ($Follow) {
        # Modo follow (tail -f)
        Write-Host "Siguiendo archivo en tiempo real (Ctrl+C para salir)..." -ForegroundColor Yellow
        Write-Host ""
        Get-Content $logPath -Tail $Lines -Wait -Encoding UTF8
    } else {
        # Modo normal (mostrar últimas N líneas)
        Get-Content $logPath -Tail $Lines -Encoding UTF8
    }
} catch {
    Write-Host "`nERROR al leer el archivo: $_" -ForegroundColor Red
    exit 1
}
