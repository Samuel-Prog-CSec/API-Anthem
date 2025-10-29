# 🛠️ Guía de Uso de Herramientas de Análisis

Esta guía te explica **cómo y cuándo usar** cada herramienta de análisis del proyecto.

---

## 📋 Tabla de Contenidos

1. [Análisis Rápido (1 comando)](#-análisis-rápido)
2. [ESLint - Calidad de Código](#-eslint---calidad-de-código)
3. [npm audit - Seguridad](#-npm-audit---seguridad)
4. [Depcheck - Dependencias](#-depcheck---dependencias)
5. [Flujo de Trabajo Recomendado](#-flujo-de-trabajo-recomendado)

---

## 🚀 Análisis Rápido

### Un solo comando para analizar TODO:

```bash
npm run analyze
```

**Qué hace:**
- ✅ Analiza calidad de código (ESLint)
- ✅ Escanea vulnerabilidades de seguridad (npm audit)
- ✅ Verifica paquetes desactualizados
- ✅ Genera reportes en `./reports/`

**Output:**
```
✅ Calidad de Código: APROBADO
✅ Seguridad: SIN VULNERABILIDADES CRÍTICAS
⚠️  Dependencias: 7 paquetes desactualizados

📁 Reportes guardados en: ./reports/
```

**Reportes generados:**
- `reports/ANALYSIS_REPORT.md` - Reporte legible en Markdown
- `reports/analysis-summary.json` - Datos en JSON
- `reports/eslint-report.json` - Detalles de ESLint
- `reports/eslint-report.html` - Vista HTML interactiva
- `reports/security-audit.json` - Vulnerabilidades encontradas

---

## 🎨 ESLint - Calidad de Código

### ¿Qué es?
ESLint analiza tu código JavaScript para encontrar:
- ❌ Errores de sintaxis
- ⚠️ Problemas potenciales (variables no usadas, comparaciones incorrectas)
- 📏 Incumplimientos de estilo de código

### Comandos disponibles:

#### 1. Escanear código (sin modificar):
```bash
npm run lint
```

**Ejemplo de output:**
```
src/controllers/fineController.js
  84:23  error  Expected { after 'if' condition  curly
  224:52  error  Expected '!==' and instead saw '!='  eqeqeq

✖ 2 problems (2 errors, 0 warnings)
```

#### 2. Auto-fix (arregla automáticamente):
```bash
npm run lint:fix
```

**Qué arregla automáticamente:**
- Agrega llaves a `if` statements
- Cambia `!=` por `!==`
- Cambia `var` por `const` o `let`
- Arregla indentación
- Elimina espacios extras

**⚠️ No arregla:**
- Variables no usadas (tienes que borrarlas manualmente)
- Funciones sin retorno
- Lógica incorrecta

#### 3. Generar reporte HTML:
```bash
npm run lint:report
```

Abre `reports/eslint-report.html` en tu navegador para ver:
- 📊 Gráficas de problemas por severidad
- 📁 Lista de archivos con problemas
- 🔍 Código con líneas problemáticas resaltadas

---

## 🔐 npm audit - Seguridad

### ¿Qué es?
Escanea tus dependencias (paquetes npm) para encontrar **vulnerabilidades de seguridad** conocidas (CVE).

### Comandos disponibles:

#### 1. Escanear vulnerabilidades:
```bash
npm run security:audit
```

**Ejemplo de output:**
```
validator  *
Severity: moderate
validator.js has a URL validation bypass vulnerability
https://github.com/advisories/GHSA-9965-vmph-33xx

2 moderate severity vulnerabilities
```

**Interpretación:**
- 🔴 **Critical/High**: Arreglar INMEDIATAMENTE
- 🟡 **Moderate**: Arreglar cuando sea posible
- 🟢 **Low**: Revisar pero no urgente

#### 2. Auto-fix de vulnerabilidades:
```bash
npm run security:audit-fix
```

**Qué hace:**
- Actualiza paquetes con parches de seguridad
- Solo aplica actualizaciones compatibles (no breaking changes)

**⚠️ Importante:**
- Después de ejecutar, prueba tu app: `npm run dev`
- Algunas vulnerabilidades NO tienen fix disponible

#### 3. Ver detalles completos:
```bash
npm audit
```

Muestra información detallada de cada vulnerabilidad:
- Descripción del problema
- Paquete afectado
- Versión vulnerable vs versión segura
- Link a GitHub Advisory

---

## 📦 Depcheck - Dependencias

### ¿Qué es?
Encuentra paquetes instalados que **no estás usando** en tu código.

### Comando:
```bash
npm run deps:unused
```

**Ejemplo de output:**
```
Unused dependencies
* pino
* pino-http

Unused devDependencies
* jest
* supertest
```

**¿Qué hacer?**

**Opción 1: Eliminar** (si realmente no los usas)
```bash
npm uninstall pino pino-http
```

**Opción 2: Ignorar** (si los vas a usar pronto)
- Los dejas instalados para implementarlos después

---

## 📅 Flujo de Trabajo Recomendado

### 🔄 Desarrollo Diario

#### Antes de hacer commit:
```bash
# 1. Arreglar problemas de código
npm run lint:fix

# 2. Verificar que no queden errores
npm run lint

# 3. Hacer commit
git add .
git commit -m "feat: nueva funcionalidad"
```

### 📊 Semanalmente

```bash
# Análisis completo
npm run analyze

# Revisar reporte
code reports/ANALYSIS_REPORT.md

# Actualizar dependencias si hay disponibles
npm update
```

### 🔐 Antes de Deploy

```bash
# 1. Análisis completo
npm run analyze

# 2. Verificar seguridad
npm run security:audit

# 3. Si hay vulnerabilidades críticas, arreglarlas
npm run security:audit-fix

# 4. Probar que todo funcione
npm run dev

# 5. Deploy solo si TODO está ✅
```

---

## 🎯 Interpretación de Resultados

### ✅ TODO BIEN (listo para producción)
```
✅ Calidad de Código: APROBADO (0 errores)
✅ Seguridad: SIN VULNERABILIDADES CRÍTICAS
✅ Dependencias: ACTUALIZADAS
```

### ⚠️ REQUIERE ATENCIÓN (antes de deploy)
```
❌ Calidad de Código: 5 errores, 20 warnings
⚠️  Seguridad: 1 vulnerabilidad alta
⚠️  Dependencias: 10 paquetes desactualizados
```

**Acciones:**
1. Arreglar errores: `npm run lint:fix`
2. Arreglar seguridad: `npm run security:audit-fix`
3. Actualizar paquetes: `npm update`

### 🔴 BLOQUEANTE (NO HACER DEPLOY)
```
❌ Calidad de Código: 50+ errores
🔴 Seguridad: Vulnerabilidades CRÍTICAS
```

**Acciones:**
1. **DETENER** el deploy inmediatamente
2. Crear rama de fix: `git checkout -b fix/security-issues`
3. Arreglar problemas uno por uno
4. Re-ejecutar análisis hasta que esté ✅

---

## 🆘 Troubleshooting

### Problema: ESLint encuentra muchos errores

**Solución:**
```bash
# 1. Auto-fix lo que se pueda
npm run lint:fix

# 2. Ver qué quedó
npm run lint

# 3. Arreglar manualmente los que no se auto-fixearon
```

### Problema: npm audit encuentra vulnerabilidades sin fix

**Solución:**
```bash
# 1. Ver detalles
npm audit

# 2. Evaluar severidad:
#    - Si es LOW/MODERATE y no afecta tu código: OK ignorar temporalmente
#    - Si es CRITICAL/HIGH: buscar alternativa al paquete

# 3. Crear issue para recordar:
git commit -m "chore: track security issue GHSA-XXXX"
```

### Problema: Análisis completo tarda mucho

**Solución:**
```bash
# Ejecutar solo una herramienta:
npm run lint              # Solo calidad
npm run security:audit    # Solo seguridad
npm run deps:check        # Solo dependencias
```

---

## 📚 Recursos Adicionales

- [ESLint Docs](https://eslint.org/docs/latest/)
- [npm audit Docs](https://docs.npmjs.com/cli/v8/commands/npm-audit)
- [Snyk Vulnerability Database](https://snyk.io/vuln/)

---

## 🤝 Integración con VS Code

### Extensiones recomendadas:

1. **ESLint** (dbaeumer.vscode-eslint)
   - Muestra errores mientras escribes
   - Auto-fix al guardar archivo

2. **npm Intellisense** (christian-kohler.npm-intellisense)
   - Autocompletado de paquetes npm

### Configuración (settings.json):
```json
{
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": true
  },
  "eslint.validate": [
    "javascript"
  ]
}
```

Ahora ESLint arreglará automáticamente errores cada vez que guardes (Ctrl+S).

---

**Última actualización:** Octubre 2025
**Autor:** Documentación del proyecto
