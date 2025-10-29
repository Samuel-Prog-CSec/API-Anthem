# Herramientas Gratuitas de Análisis Automatizado

**Fecha:** Octubre 2025
**Stack del proyecto:** Node.js + Express + MongoDB + JWT
**Objetivo:** Análisis automático de rendimiento, calidad y seguridad

---

## 📋 Índice

1. [Análisis de Seguridad](#-análisis-de-seguridad)
2. [Análisis de Calidad de Código](#-análisis-de-calidad-de-código)
3. [Análisis de Rendimiento](#-análisis-de-rendimiento)
4. [Análisis de Dependencias](#-análisis-de-dependencias)
5. [CI/CD y Automatización](#-cicd-y-automatización)
6. [Configuración Recomendada](#-configuración-recomendada)
7. [Integración con GitHub](#-integración-con-github)

---

## 🔐 Análisis de Seguridad

### 1. **Snyk** (RECOMENDADO)

**Qué hace:** Escanea vulnerabilidades en dependencias npm y código

**Características:**
- ✅ **100% GRATIS** para proyectos open source
- ✅ **500 tests/mes** para proyectos privados (plan gratuito)
- ✅ Integración con GitHub/GitLab
- ✅ Reportes en PR automáticos
- ✅ Sugerencias de fix automáticas
- ✅ Base de datos actualizada diariamente

**Instalación:**
```bash
# Instalar CLI
npm install -g snyk

# Autenticarse
snyk auth

# Escanear proyecto
snyk test

# Escanear y monitorear
snyk monitor
```

**Integración con GitHub:**
```bash
# 1. Ve a https://snyk.io
# 2. Conecta tu cuenta de GitHub
# 3. Selecciona el repositorio
# 4. Snyk escaneará automáticamente cada PR
```

**Output esperado:**
```
Testing c:\Users\Samuel\Desktop\UNI\SSUU\Practica\API...

✓ Tested 89 dependencies for known issues
  Found 3 issues, 3 vulnerable paths

Issues to fix:
  High severity vulnerability found in express
  - Introduced through: express@4.17.1
  - Fix: Upgrade to express@4.18.2

  Medium severity vulnerability in jsonwebtoken
  - Introduced through: jsonwebtoken@8.5.1
  - Fix: Upgrade to jsonwebtoken@9.0.0
```

**Configuración avanzada** (`.snyk` file):
```yaml
# Archivo: .snyk
version: v1.25.0

# Ignorar vulnerabilidades específicas (con justificación)
ignore:
  SNYK-JS-MINIMIST-559764:
    - '*':
        reason: Only used in development
        expires: 2025-12-31T00:00:00.000Z

# Parches automáticos
patch: {}

# Políticas personalizadas
language-settings:
  javascript:
    ignoreDevDependencies: true
```

**Dashboard web:** Accede a https://app.snyk.io para ver:
- Vulnerabilidades encontradas
- Tendencias en el tiempo
- Comparación entre ramas
- Reportes exportables (PDF)

---

### 2. **npm audit** (Built-in)

**Qué hace:** Analiza vulnerabilidades en node_modules

**Ventajas:**
- ✅ Ya viene con npm (sin instalación)
- ✅ Actualización automática de CVE
- ✅ Fix automático disponible

**Uso:**
```bash
# Escaneo básico
npm audit

# Ver detalles completos
npm audit --json > audit-report.json

# Fix automático (vulnerabilidades menores)
npm audit fix

# Fix forzado (puede romper compatibilidad)
npm audit fix --force

# Solo producción
npm audit --production
```

**Output mejorado con formato:**
```bash
npm audit --json | npx npm-audit-html --output audit-report.html
```

**Automatización con package.json:**
```json
{
  "scripts": {
    "security:check": "npm audit --production",
    "security:fix": "npm audit fix",
    "security:report": "npm audit --json > reports/npm-audit-$(date +%Y%m%d).json"
  }
}
```

---

## 🎨 Análisis de Calidad de Código

### 1. **ESLint** (OBLIGATORIO)

**Qué hace:** Linter estático para JavaScript/Node.js

**Instalación:**
```bash
npm install --save-dev eslint eslint-config-airbnb-base eslint-plugin-import eslint-plugin-security eslint-plugin-node
```

**Configuración** (`.eslintrc.json`):
```json
{
  "env": {
    "node": true,
    "es2021": true
  },
  "extends": [
    "airbnb-base",
    "plugin:security/recommended",
    "plugin:node/recommended"
  ],
  "parserOptions": {
    "ecmaVersion": 2021
  },
  "rules": {
    "no-console": "warn",
    "no-unused-vars": ["error", { "argsIgnorePattern": "^_" }],
    "consistent-return": "error",
    "security/detect-object-injection": "warn",
    "node/no-unsupported-features/es-syntax": "off"
  },
  "ignorePatterns": ["node_modules/", "dist/", "coverage/"]
}
```

**Scripts en package.json:**
```json
{
  "scripts": {
    "lint": "eslint . --ext .js",
    "lint:fix": "eslint . --ext .js --fix",
    "lint:report": "eslint . --ext .js --format html --output-file reports/eslint-report.html"
  }
}
```

**Uso:**
```bash
# Escanear
npm run lint

# Auto-fix
npm run lint:fix

# Generar reporte
npm run lint:report
```

---

### 2. **SonarQube / SonarCloud** (RECOMENDADO)

**Qué hace:** Análisis profundo de calidad, bugs, code smells, seguridad

**Características:**
- ✅ **GRATIS** para proyectos open source (SonarCloud)
- ✅ Detección de bugs, vulnerabilidades, code smells
- ✅ Métricas de cobertura de tests
- ✅ Duplicación de código
- ✅ Complejidad ciclomática
- ✅ Integración CI/CD
- ✅ Reportes visuales espectaculares

**Opción 1: SonarCloud (Recomendado para GitHub)**

```bash
# 1. Ir a https://sonarcloud.io
# 2. Login con GitHub
# 3. Agregar organización y proyecto
# 4. Instalar scanner

npm install --save-dev sonarqube-scanner
```

**Configuración** (`sonar-project.properties`):
```properties
# Configuración del proyecto
sonar.projectKey=tu-usuario_API-REST
sonar.organization=tu-organizacion
sonar.projectName=API REST - Node.js Express MongoDB
sonar.projectVersion=1.0.0

# Paths
sonar.sources=src
sonar.tests=tests
sonar.exclusions=**/node_modules/**,**/datos_hpe/**,**/docs/**

# Cobertura de tests (si usas Jest/Mocha)
sonar.javascript.lcov.reportPaths=coverage/lcov.info

# Configuración de lenguaje
sonar.language=js
sonar.sourceEncoding=UTF-8
```

**Script de análisis:**
```json
{
  "scripts": {
    "sonar": "sonar-scanner -Dsonar.login=$SONAR_TOKEN"
  }
}
```

---

## ⚡ Análisis de Rendimiento

### 1. **Clinic.js** (RECOMENDADO para Node.js)

**Qué hace:** Diagnóstico de rendimiento de aplicaciones Node.js

**Instalación:**
```bash
npm install -g clinic
```

**Herramientas incluidas:**

#### A. **Clinic Doctor** (Diagnóstico general)
```bash
# Iniciar servidor con profiling
clinic doctor -- node src/server.js

# Generar carga (otra terminal)
npm run test:load

# Detener (Ctrl+C)
# Se genera reporte HTML automáticamente
```

**Output:** `clinic-doctor-{timestamp}.html` con:
- CPU usage
- Memory leaks
- Event loop delay
- I/O latency

#### B. **Clinic Flame** (Flame graphs - CPU profiling)
```bash
clinic flame -- node src/server.js

# Genera: clinic-flame-{timestamp}.html
```

**Uso:** Identifica funciones que consumen más CPU

#### C. **Clinic Bubbleprof** (Async operations)
```bash
clinic bubbleprof -- node src/server.js

# Genera: clinic-bubbleprof-{timestamp}.html
```

**Uso:** Visualiza operaciones asíncronas (MongoDB queries, HTTP requests)

#### D. **Clinic HeapProfiler** (Memory profiling)
```bash
clinic heapprofiler -- node src/server.js

# Genera: clinic-heapprofiler-{timestamp}.html
```

**Uso:** Detecta memory leaks y objetos grandes en memoria

**Script automatizado:**
```json
{
  "scripts": {
    "profile:doctor": "clinic doctor -- node src/server.js",
    "profile:flame": "clinic flame -- node src/server.js",
    "profile:heap": "clinic heapprofiler -- node src/server.js",
    "profile:all": "npm run profile:doctor && npm run profile:flame && npm run profile:heap"
  }
}
```

---

### 2. **Autocannon** (Load testing)

**Qué hace:** Herramienta de benchmarking HTTP

**Instalación:**
```bash
npm install -g autocannon
```

**Uso:**
```bash
# Test básico
autocannon http://localhost:3000/api/v1/health

# Test con configuración
autocannon -c 100 -d 30 -p 10 http://localhost:3000/api/v1/accidents

# Parámetros:
# -c 100: 100 conexiones concurrentes
# -d 30: Duración de 30 segundos
# -p 10: Pipeline de 10 requests por conexión

# Con headers (autenticación)
autocannon -c 50 -d 20 -H "Authorization: Bearer TOKEN" http://localhost:3000/api/v1/fines

# Generar reporte JSON
autocannon -c 100 -d 30 -j http://localhost:3000/api/v1/traffic > reports/autocannon-traffic.json
```

**Output:**
```
Running 30s test @ http://localhost:3000/api/v1/accidents
100 connections

┌─────────┬────────┬────────┬─────────┬─────────┬───────────┬──────────┐
│ Stat    │ 2.5%   │ 50%    │ 97.5%   │ 99%     │ Avg       │ Stdev    │
├─────────┼────────┼────────┼─────────┼─────────┼───────────┼──────────┤
│ Latency │ 23 ms  │ 45 ms  │ 120 ms  │ 150 ms  │ 52.3 ms   │ 28.5 ms  │
└─────────┴────────┴────────┴─────────┴─────────┴───────────┴──────────┘
┌───────────┬─────────┬─────────┬─────────┬─────────┬──────────┬─────────┐
│ Stat      │ 1%      │ 2.5%    │ 50%     │ 97.5%   │ Avg      │ Stdev   │
├───────────┼─────────┼─────────┼─────────┼─────────┼──────────┼─────────┤
│ Req/Sec   │ 1,523   │ 1,523   │ 1,951   │ 2,105   │ 1,895.4  │ 167.23  │
└───────────┴─────────┴─────────┴─────────┴─────────┴──────────┴─────────┘

30k requests in 30.03s, 125 MB read
```

**Script de benchmark completo:**
```javascript
// scripts/benchmark.js
const autocannon = require('autocannon');

const endpoints = [
  { url: 'http://localhost:3000/api/v1/health', name: 'Health Check' },
  { url: 'http://localhost:3000/api/v1/accidents', name: 'Accidents List' },
  { url: 'http://localhost:3000/api/v1/fines', name: 'Fines List' },
  { url: 'http://localhost:3000/api/v1/traffic', name: 'Traffic Data' }
];

async function runBenchmarks() {
  for (const endpoint of endpoints) {
    console.log(`\n🔥 Benchmarking: ${endpoint.name}\n`);

    const result = await autocannon({
      url: endpoint.url,
      connections: 50,
      duration: 20,
      headers: {
        'Authorization': 'Bearer YOUR_TOKEN_HERE'
      }
    });

    console.log(`Requests/sec: ${result.requests.average}`);
    console.log(`Latency avg: ${result.latency.mean} ms`);
    console.log(`Throughput: ${result.throughput.average} bytes/sec`);
  }
}

runBenchmarks().catch(console.error);
```

---

### 3. **Artillery** (Alternativa a Autocannon)

**Qué hace:** Load testing y performance testing

**Instalación:**
```bash
npm install -g artillery
```

**Configuración** (`artillery-config.yml`):
```yaml
config:
  target: "http://localhost:3000"
  phases:
    - duration: 60
      arrivalRate: 10
      name: "Warm up"
    - duration: 120
      arrivalRate: 50
      name: "Sustained load"
    - duration: 60
      arrivalRate: 100
      name: "Peak load"

scenarios:
  - name: "Get accidents"
    flow:
      - get:
          url: "/api/v1/accidents"
          headers:
            Authorization: "Bearer {{token}}"
          capture:
            - json: "$.data[0].id"
              as: "accidentId"

      - get:
          url: "/api/v1/accidents/expediente/{{ accidentId }}"
          headers:
            Authorization: "Bearer {{token}}"

  - name: "Search and filter"
    flow:
      - get:
          url: "/api/v1/fines?page=1&limit=50"
          headers:
            Authorization: "Bearer {{token}}"
```

**Ejecutar:**
```bash
# Test básico
artillery quick --duration 60 --rate 10 http://localhost:3000/api/v1/health

# Con configuración
artillery run artillery-config.yml

# Generar reporte HTML
artillery run artillery-config.yml --output report.json
artillery report report.json --output report.html
```

---

### 4. **Node.js built-in profiling**

**Qué hace:** Profiling nativo sin dependencias

**Uso:**
```bash
# CPU profiling
node --prof src/server.js

# Después de detener, procesar log
node --prof-process isolate-0x*.log > processed.txt

# Memory profiling
node --inspect src/server.js

# Abrir Chrome DevTools: chrome://inspect
```

---

## 📦 Análisis de Dependencias

### 1. **Depcheck**

**Qué hace:** Detecta dependencias no usadas o faltantes

**Instalación:**
```bash
npm install -g depcheck
```

**Uso:**
```bash
# Escanear proyecto
depcheck

# Ignorar carpetas específicas
depcheck --ignores="eslint,nodemon,jest"

# Generar JSON
depcheck --json > reports/depcheck.json
```

**Output:**
```
Unused dependencies
* lodash
* moment

Missing dependencies
* axios (used in src/controllers/externalApiController.js)
```

---

### 2. **npm-check-updates**

**Qué hace:** Verifica actualizaciones disponibles de paquetes

**Instalación:**
```bash
npm install -g npm-check-updates
```

**Uso:**
```bash
# Ver actualizaciones disponibles
ncu

# Actualizar package.json (sin instalar)
ncu -u

# Instalar después de actualizar
npm install

# Solo actualizaciones menores (seguras)
ncu -t minor -u
```

**Output:**
```
Checking package.json
[====================] 45/45 100%

 express       ^4.17.1  →  ^4.18.2
 mongoose      ^6.0.0   →  ^7.5.0
 jsonwebtoken  ^8.5.1   →  ^9.0.2

Run npm install to install new versions.
```

---

### 3. **Bundlephobia CLI**

**Qué hace:** Analiza el tamaño de dependencias npm

**Instalación:**
```bash
npm install -g bundle-phobia-cli
```

**Uso:**
```bash
# Analizar paquete
bundle-phobia express

# Comparar alternativas
bundle-phobia express fastify koa
```

---

## 🔄 CI/CD y Automatización

### 1. **GitHub Actions** (RECOMENDADO)

**Qué hace:** CI/CD gratis para repos públicos y privados

**Configuración** (`.github/workflows/analysis.yml`):

```yaml
name: Automated Analysis

on:
  push:
    branches: [ main, develop ]
  pull_request:
    branches: [ main, develop ]
  schedule:
    # Ejecutar análisis todos los lunes a las 9 AM
    - cron: '0 9 * * 1'

jobs:
  security-scan:
    name: Security Analysis
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '22.x'

      - name: Install dependencies
        run: npm ci

      - name: Run Snyk Security Scan
        uses: snyk/actions/node@master
        env:
          SNYK_TOKEN: ${{ secrets.SNYK_TOKEN }}
        with:
          args: --severity-threshold=high

      - name: Run npm audit
        run: npm audit --production --audit-level=moderate

      - name: Run GitGuardian scan
        uses: GitGuardian/ggshield-action@v1
        env:
          GITHUB_PUSH_BEFORE_SHA: ${{ github.event.before }}
          GITHUB_PUSH_BASE_SHA: ${{ github.event.base }}
          GITHUB_DEFAULT_BRANCH: ${{ github.event.repository.default_branch }}
          GITGUARDIAN_API_KEY: ${{ secrets.GITGUARDIAN_API_KEY }}

  code-quality:
    name: Code Quality Analysis
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v3
        with:
          fetch-depth: 0  # Para SonarCloud

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '22.x'

      - name: Install dependencies
        run: npm ci

      - name: Run ESLint
        run: npm run lint

      - name: SonarCloud Scan
        uses: SonarSource/sonarcloud-github-action@master
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          SONAR_TOKEN: ${{ secrets.SONAR_TOKEN }}

      - name: Upload ESLint report
        if: always()
        uses: actions/upload-artifact@v3
        with:
          name: eslint-report
          path: reports/eslint-report.html

  dependency-check:
    name: Dependency Analysis
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '22.x'

      - name: Check for unused dependencies
        run: |
          npm install -g depcheck
          depcheck

      - name: Check for outdated packages
        run: npm outdated || true

      - name: Audit dependencies
        run: npm audit --json > reports/npm-audit.json || true

      - name: Upload audit report
        uses: actions/upload-artifact@v3
        with:
          name: dependency-reports
          path: reports/

  performance-check:
    name: Performance Baseline
    runs-on: ubuntu-latest

    services:
      mongodb:
        image: mongo:7.0
        ports:
          - 27017:27017

    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '22.x'

      - name: Install dependencies
        run: npm ci

      - name: Start server
        run: npm start &
        env:
          NODE_ENV: test
          MONGODB_URI: mongodb://localhost:27017/test

      - name: Wait for server
        run: npx wait-on http://localhost:3000/api/v1/health --timeout 30000

      - name: Run performance tests
        run: |
          npm install -g autocannon
          autocannon -c 50 -d 20 http://localhost:3000/api/v1/health > reports/perf-baseline.txt

      - name: Upload performance report
        uses: actions/upload-artifact@v3
        with:
          name: performance-report
          path: reports/perf-baseline.txt
```

**Configurar secrets en GitHub:**
1. Ve a Settings → Secrets and variables → Actions
2. Agregar:
   - `SNYK_TOKEN` (desde snyk.io)
   - `SONAR_TOKEN` (desde sonarcloud.io)
   - `GITGUARDIAN_API_KEY` (desde gitguardian.com)

---

### 2. **Pre-commit Hooks con Husky**

**Qué hace:** Ejecuta checks antes de cada commit

**Instalación:**
```bash
npm install --save-dev husky lint-staged
npx husky install
```

**Configuración** (`package.json`):
```json
{
  "scripts": {
    "prepare": "husky install"
  },
  "lint-staged": {
    "*.js": [
      "eslint --fix",
      "git add"
    ]
  }
}
```

**Crear hooks:**
```bash
# Pre-commit: lint + security check
npx husky add .husky/pre-commit "npx lint-staged && npm run security:check"

# Pre-push: tests + audit
npx husky add .husky/pre-push "npm test && npm audit"
```

---

### 3. **Scripts package.json completos**

```json
{
  "scripts": {
    "dev": "nodemon src/server.js",
    "start": "node src/server.js",

    "// SECURITY": "",
    "security:check": "npm audit --production",
    "security:fix": "npm audit fix",
    "security:snyk": "snyk test",
    "security:secrets": "ggshield secret scan repo .",
    "security:all": "npm run security:check && npm run security:snyk && npm run security:secrets",

    "// CODE QUALITY": "",
    "lint": "eslint . --ext .js",
    "lint:fix": "eslint . --ext .js --fix",
    "lint:report": "eslint . --ext .js --format html --output-file reports/eslint-report.html",

    "// DEPENDENCIES": "",
    "deps:check": "depcheck",
    "deps:update": "ncu -u && npm install",
    "deps:audit": "npm audit --json > reports/npm-audit-$(date +%Y%m%d).json",

    "// PERFORMANCE": "",
    "profile:doctor": "clinic doctor -- node src/server.js",
    "profile:flame": "clinic flame -- node src/server.js",
    "profile:heap": "clinic heapprofiler -- node src/server.js",
    "benchmark": "node scripts/benchmark.js",

    "// REPORTS": "",
    "reports:all": "npm run lint:report && npm run security:all && npm run deps:audit",
    "reports:clean": "rm -rf reports/* && mkdir -p reports",

    "// CI/CD": "",
    "ci:security": "npm run security:all",
    "ci:quality": "npm run lint && npm run test",
    "ci:all": "npm run ci:security && npm run ci:quality"
  }
}
```

---

## 🚀 Configuración Recomendada (Paso a Paso)

### Fase 1: Setup Inicial (30 min)

```bash
# 1. Instalar herramientas globales
npm install -g snyk clinic autocannon depcheck npm-check-updates

# 2. Instalar devDependencies
npm install --save-dev eslint eslint-config-airbnb-base eslint-plugin-import eslint-plugin-security eslint-plugin-node husky lint-staged

# 3. Autenticar servicios
snyk auth
# Ve a https://snyk.io y copia tu token

# 4. Inicializar configs
npx eslint --init
npm run prepare  # Husky

# 5. Crear directorio de reportes
mkdir reports
echo "reports/" >> .gitignore
```

---

### Fase 2: GitHub Integration (30 min)

```bash
# 1. Crear estructura de workflows
mkdir -p .github/workflows

# 2. Copiar workflow de analysis.yml (ver arriba)

# 3. Configurar secrets en GitHub:
# - SNYK_TOKEN
# - SONAR_TOKEN (opcional)
# - GITGUARDIAN_API_KEY

# 4. Push y verificar
git add .
git commit -m "ci: add automated analysis workflows"
git push
```

---

### Fase 3: SonarCloud Setup (20 min)

```bash
# 1. Ve a https://sonarcloud.io
# 2. Login con GitHub
# 3. Importar repositorio "API"

# 4. Instalar scanner
npm install --save-dev sonarqube-scanner

# 5. Crear sonar-project.properties (ver arriba)

# 6. Agregar SONAR_TOKEN a GitHub Secrets

# 7. Push - SonarCloud analizará automáticamente
```

---

### Fase 4: Testing Local (15 min)

```bash
# Ejecutar todos los análisis localmente
npm run security:all    # Seguridad
npm run lint            # Calidad
npm run deps:check      # Dependencias
npm run profile:doctor  # Performance (mientras haces requests)

# Ver reportes
start reports/eslint-report.html
start clinic-doctor-*.html
```

---

## 📊 Dashboard Centralizado

### Opción 1: GitHub Pages (Gratis)

**Crear dashboard HTML:**

```html
<!-- docs/dashboard.html -->
<!DOCTYPE html>
<html>
<head>
  <title>API Analysis Dashboard</title>
  <style>
    body { font-family: Arial; max-width: 1200px; margin: 0 auto; padding: 20px; }
    .card { border: 1px solid #ddd; padding: 20px; margin: 10px 0; border-radius: 8px; }
    .status { display: inline-block; padding: 5px 10px; border-radius: 5px; }
    .pass { background: #4caf50; color: white; }
    .fail { background: #f44336; color: white; }
    .warn { background: #ff9800; color: white; }
  </style>
</head>
<body>
  <h1>🔍 API Analysis Dashboard</h1>

  <div class="card">
    <h2>🔐 Security</h2>
    <p>Snyk: <span class="status pass">0 vulnerabilities</span></p>
    <p>npm audit: <span class="status pass">0 vulnerabilities</span></p>
    <p>Last scan: <span id="security-date"></span></p>
    <a href="https://app.snyk.io/org/tu-org/project/tu-proyecto">View Details</a>
  </div>

  <div class="card">
    <h2>🎨 Code Quality</h2>
    <p>SonarCloud: <span class="status pass">Quality Gate Passed</span></p>
    <p>ESLint: <span class="status warn">5 warnings</span></p>
    <p>Maintainability: <span class="status pass">A</span></p>
    <a href="https://sonarcloud.io/dashboard?id=tu-proyecto">View Details</a>
  </div>

  <div class="card">
    <h2>⚡ Performance</h2>
    <p>Avg Response Time: <span class="status pass">45ms</span></p>
    <p>Requests/sec: <span class="status pass">1,950</span></p>
    <p>Memory Usage: <span class="status pass">245 MB</span></p>
  </div>

  <div class="card">
    <h2>📦 Dependencies</h2>
    <p>Total: 89 packages</p>
    <p>Outdated: <span class="status warn">3 packages</span></p>
    <p>Unused: <span class="status pass">0 packages</span></p>
  </div>

  <script>
    document.getElementById('security-date').textContent = new Date().toLocaleString();
  </script>
</body>
</html>
```

**Publicar en GitHub Pages:**
```bash
# 1. Settings → Pages → Source: GitHub Actions
# 2. El workflow publicará automáticamente en cada push
```

---

### Opción 2: README Badges

**Agregar badges a README.md:**

```markdown
# API REST - Node.js Express MongoDB

![Snyk Vulnerabilities](https://img.shields.io/snyk/vulnerabilities/github/tu-usuario/API-REST)
![Security Rating](https://sonarcloud.io/api/project_badges/measure?project=tu-proyecto&metric=security_rating)
![Maintainability Rating](https://sonarcloud.io/api/project_badges/measure?project=tu-proyecto&metric=sqale_rating)
![Code Coverage](https://sonarcloud.io/api/project_badges/measure?project=tu-proyecto&metric=coverage)
![GitHub Workflow Status](https://img.shields.io/github/actions/workflow/status/tu-usuario/API-REST/analysis.yml)
```

---

## 📅 Cronograma de Análisis Recomendado

| Frecuencia | Herramienta | Qué analiza | Duración |
|------------|-------------|-------------|----------|
| **En cada commit** | ESLint (pre-commit) | Calidad de código | 5-10 seg |
| **En cada PR** | GitHub Actions (full suite) | Seguridad + Calidad | 2-3 min |
| **Diario** | Snyk Monitor | Nuevas vulnerabilidades CVE | Automático |
| **Semanal** | npm audit + Depcheck | Dependencias | 1 min |
| **Mensual** | Clinic.js + Autocannon | Performance profiling | 15 min |
| **Trimestral** | SonarCloud análisis completo | Deuda técnica | 5 min |

---

## 💰 Resumen de Costos

| Herramienta | Plan Gratuito | Limitaciones | Recomendación |
|-------------|---------------|--------------|---------------|
| **Snyk** | 500 tests/mes | Suficiente para proyecto individual | ✅ Usar |
| **SonarCloud** | Ilimitado | Solo repos públicos | ✅ Usar |
| **GitHub Actions** | 2,000 min/mes | Suficiente para CI/CD básico | ✅ Usar |
| **ESLint** | Gratis | Ninguna | ✅ Usar |
| **Clinic.js** | Gratis | Ninguna | ✅ Usar |
| **npm audit** | Gratis | Ninguna | ✅ Usar |
| **GitGuardian** | 25 commits/día | Suficiente | ✅ Usar |
| **Depcheck** | Gratis | Ninguna | ✅ Usar |
| **CodeClimate** | Solo repos públicos | - | ⚠️ Opcional |

**Total cost: 0€/mes** ✅

---

## 🎯 Plan de Implementación (Sprint 2)

### Semana 1: Seguridad
- [ ] Día 1-2: Instalar Snyk + GitHub Actions workflow
- [ ] Día 3: Configurar GitGuardian
- [ ] Día 4: Fix vulnerabilidades detectadas
- [ ] Día 5: Documentación

### Semana 2: Calidad
- [ ] Día 1-2: Configurar ESLint + fix issues
- [ ] Día 3-4: Setup SonarCloud + resolver code smells
- [ ] Día 5: Husky pre-commit hooks

### Semana 3: Performance
- [ ] Día 1-2: Instalar Clinic.js + baseline profiling
- [ ] Día 3: Autocannon benchmark todos los endpoints
- [ ] Día 4-5: Optimizar bottlenecks detectados

### Semana 4: Integración
- [ ] Día 1-2: GitHub Actions completo (security + quality + perf)
- [ ] Día 3: Dashboard en GitHub Pages
- [ ] Día 4: Documentación completa
- [ ] Día 5: Presentación al equipo

---

## 📚 Recursos Adicionales

- [Snyk Docs](https://docs.snyk.io/)
- [SonarCloud Docs](https://docs.sonarcloud.io/)
- [GitHub Actions Docs](https://docs.github.com/en/actions)
- [Clinic.js Docs](https://clinicjs.org/documentation/)
- [ESLint Rules](https://eslint.org/docs/latest/rules/)
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)

---

**Última actualización:** Octubre 2025
**Autor:** Documentación del proyecto API REST
**Estado:** Listo para implementación

