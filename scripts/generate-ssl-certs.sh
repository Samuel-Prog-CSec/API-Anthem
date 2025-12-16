#!/bin/bash
# Script para generar certificados SSL autofirmados (solo desarrollo)
# NO usar en producción - usar Let's Encrypt o certificados de una CA

echo "Generando certificados SSL autofirmados para desarrollo..."

# Crear directorio si no existe
mkdir -p certs

# Generar clave privada y certificado autofirmado
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout certs/private.key \
  -out certs/certificate.crt \
  -subj "/C=ES/ST=Madrid/L=Madrid/O=API-Anthem-Dev/CN=localhost"

echo ""
echo "Certificados generados en ./certs/"
echo "  - private.key (clave privada)"
echo "  - certificate.crt (certificado)"
echo ""
echo "IMPORTANTE: Estos certificados son SOLO para desarrollo."
echo "En produccion, usa Let's Encrypt o certificados de una CA."
echo ""
echo "El navegador mostrara una advertencia de seguridad - esto es normal"
echo "para certificados autofirmados."
