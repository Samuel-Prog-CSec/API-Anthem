# Script PowerShell para generar certificados SSL autofirmados (solo desarrollo)
# NO usar en produccion - usar Let's Encrypt o certificados de una CA

Write-Host "Generando certificados SSL autofirmados para desarrollo..." -ForegroundColor Cyan

# Crear directorio si no existe
$certsDir = "certs"
if (-not (Test-Path $certsDir)) {
    New-Item -ItemType Directory -Path $certsDir | Out-Null
}

# Verificar si OpenSSL está disponible
$opensslPath = Get-Command openssl -ErrorAction SilentlyContinue

if ($opensslPath) {
    # Usar OpenSSL si está disponible
    Write-Host "Usando OpenSSL..." -ForegroundColor Green
    
    openssl req -x509 -nodes -days 365 -newkey rsa:2048 `
        -keyout "$certsDir/private.key" `
        -out "$certsDir/certificate.crt" `
        -subj "/C=ES/ST=Madrid/L=Madrid/O=API-Anthem-Dev/CN=localhost"
} else {
    # Usar cmdlets de PowerShell nativos
    Write-Host "OpenSSL no encontrado, usando PowerShell nativo..." -ForegroundColor Yellow
    
    # Crear certificado autofirmado
    $cert = New-SelfSignedCertificate `
        -DnsName "localhost" `
        -CertStoreLocation "Cert:\CurrentUser\My" `
        -NotAfter (Get-Date).AddYears(1) `
        -FriendlyName "API-Anthem Development Certificate"
    
    # Exportar certificado (.crt)
    Export-Certificate -Cert $cert -FilePath "$certsDir\certificate.crt" -Type CERT | Out-Null
    
    # Exportar con clave privada (.pfx) - necesario para Node.js
    $password = ConvertTo-SecureString -String "development" -Force -AsPlainText
    Export-PfxCertificate -Cert $cert -FilePath "$certsDir\certificate.pfx" -Password $password | Out-Null
    
    Write-Host ""
    Write-Host "NOTA: Se genero un archivo .pfx en lugar de .key/.crt separados" -ForegroundColor Yellow
    Write-Host "Necesitaras modificar el codigo para usar el formato PFX o instalar OpenSSL" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Para instalar OpenSSL en Windows:" -ForegroundColor Cyan
    Write-Host "  winget install ShiningLight.OpenSSL" -ForegroundColor White
}

Write-Host ""
Write-Host "Certificados generados en ./$certsDir/" -ForegroundColor Green
Write-Host ""
Write-Host "IMPORTANTE: Estos certificados son SOLO para desarrollo." -ForegroundColor Red
Write-Host "En produccion, usa Let's Encrypt o certificados de una CA." -ForegroundColor Red
Write-Host ""
Write-Host "El navegador mostrara una advertencia de seguridad - esto es normal" -ForegroundColor Yellow
Write-Host "para certificados autofirmados."
