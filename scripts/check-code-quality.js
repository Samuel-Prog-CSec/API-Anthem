#!/usr/bin/env node

/**
 * Pre-commit Code Quality Check
 *
 * Este script verifica la calidad del código antes de permitir commits.
 * Puede ser integrado con Husky para ejecución automática.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Colores para la consola
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  bold: '\x1b[1m'
};

console.log(`${colors.bold}${colors.blue}🔍 Verificando calidad del código...${colors.reset}\n`);

let hasErrors = false;

// 1. Ejecutar ESLint
console.log(`${colors.blue}📋 Ejecutando ESLint...${colors.reset}`);
try {
  execSync('npm run lint -- --max-warnings 50', { stdio: 'inherit' });
  console.log(`${colors.green}✅ ESLint: Sin errores críticos${colors.reset}\n`);
} catch (error) {
  console.log(`${colors.red}❌ ESLint: Errores encontrados${colors.reset}\n`);
  hasErrors = true;
}

// 2. Verificar archivos de configuración críticos
console.log(`${colors.blue}📁 Verificando archivos de configuración...${colors.reset}`);
const criticalFiles = [
  'package.json',
  'eslint.config.mjs',
  '.env.example'
];

let configOk = true;
criticalFiles.forEach(file => {
  if (!fs.existsSync(path.join(process.cwd(), file))) {
    console.log(`${colors.red}❌ Falta archivo crítico: ${file}${colors.reset}`);
    configOk = false;
    hasErrors = true;
  }
});

if (configOk) {
  console.log(`${colors.green}✅ Archivos de configuración: OK${colors.reset}\n`);
}

// 3. Verificar package.json
console.log(`${colors.blue}📦 Verificando package.json...${colors.reset}`);
try {
  const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));

  if (!packageJson.scripts.lint) {
    console.log(`${colors.yellow}⚠️  package.json: Falta script 'lint'${colors.reset}`);
  }

  if (!packageJson.devDependencies.eslint) {
    console.log(`${colors.red}❌ package.json: Falta dependencia 'eslint'${colors.reset}`);
    hasErrors = true;
  } else {
    console.log(`${colors.green}✅ package.json: Configuración válida${colors.reset}\n`);
  }
} catch (error) {
  console.log(`${colors.red}❌ package.json: Error al parsear${colors.reset}\n`);
  hasErrors = true;
}

// 4. Contar archivos con console.log en src/
console.log(`${colors.blue}🔎 Buscando console.log/error/warn en código fuente...${colors.reset}`);
try {
  const grepCommand = process.platform === 'win32'
    ? 'findstr /R /N /I "console\\.(log|error|warn)" src\\*.js src\\**\\*.js 2>nul'
    : 'grep -rn "console\\.(log\\|error\\|warn)" src/ 2>/dev/null';

  try {
    const consoleUsages = execSync(grepCommand, { encoding: 'utf8' });
    const lines = consoleUsages.trim().split('\n').filter(l => l);

    if (lines.length > 0) {
      console.log(`${colors.yellow}⚠️  Encontrados ${lines.length} usos de console en src/`);
      console.log(`${colors.yellow}   Considera usar el logger de Pino en su lugar${colors.reset}\n`);
    }
  } catch (_err) {
    // No se encontraron coincidencias (esperado en código limpio)
    console.log(`${colors.green}✅ Sin usos de console en src/${colors.reset}\n`);
  }
} catch (_error) {
  console.log(`${colors.yellow}⚠️  No se pudo verificar usos de console${colors.reset}\n`);
}

// Resumen final
console.log(`${colors.bold}═══════════════════════════════════════${colors.reset}`);
if (hasErrors) {
  console.log(`${colors.red}${colors.bold}❌ VERIFICACIÓN FALLIDA${colors.reset}`);
  console.log(`${colors.red}   Se encontraron errores críticos.${colors.reset}`);
  console.log(`${colors.yellow}   Por favor, corrige los errores antes de hacer commit.${colors.reset}`);
  process.exit(1);
} else {
  console.log(`${colors.green}${colors.bold}✅ VERIFICACIÓN EXITOSA${colors.reset}`);
  console.log(`${colors.green}   El código cumple con los estándares de calidad.${colors.reset}`);
  process.exit(0);
}
