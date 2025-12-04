#!/usr/bin/env node

/**
 * Script de Análisis Completo del Proyecto
 *
 * Ejecuta todas las herramientas de análisis y genera un reporte consolidado
 */

const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPORTS_DIR = path.join(__dirname, '..', 'reports');

// Asegurar que existe el directorio de reportes
if (!fs.existsSync(REPORTS_DIR)) {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
}

console.log('\n🔍 ===== ANÁLISIS COMPLETO DEL PROYECTO ===== \n');

const results = {
  timestamp: new Date().toISOString(),
  eslint: { status: 'pending', errors: 0, warnings: 0 },
  security: { status: 'pending', vulnerabilities: 0 },
  dependencies: { status: 'pending', unused: [], outdated: [] }
};

// Función helper para ejecutar comandos
function runCommand(command, description) {
  return new Promise((resolve) => {
    console.log(`\n📊 ${description}...`);
    exec(command, { maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
      resolve({ error, stdout, stderr });
    });
  });
}

async function analyzeAll() {
  // 1. ESLint
  console.log('\n═══════════════════════════════════════');
  console.log('1️⃣  ANÁLISIS DE CALIDAD DE CÓDIGO (ESLint)');
  console.log('═══════════════════════════════════════');

  const eslintResult = await runCommand('npx eslint . --format json', 'Analizando código con ESLint');

  if (!eslintResult.error || eslintResult.stdout) {
    try {
      const eslintData = JSON.parse(eslintResult.stdout);
      const totalErrors = eslintData.reduce((sum, file) => sum + file.errorCount, 0);
      const totalWarnings = eslintData.reduce((sum, file) => sum + file.warningCount, 0);

      results.eslint = {
        status: totalErrors === 0 ? 'passed' : 'failed',
        errors: totalErrors,
        warnings: totalWarnings,
        filesAnalyzed: eslintData.length
      };

      console.log(`✅ Errores: ${totalErrors}`);
      console.log(`⚠️  Warnings: ${totalWarnings}`);
      console.log(`📁 Archivos analizados: ${eslintData.length}`);

      // Guardar reporte JSON
      fs.writeFileSync(
        path.join(REPORTS_DIR, 'eslint-report.json'),
        JSON.stringify(eslintData, null, 2)
      );
    } catch (err) {
      console.error('❌ Error parseando resultado de ESLint:', err.message);
      results.eslint.status = 'error';
    }
  }

  // 2. npm audit (Seguridad)
  console.log('\n═══════════════════════════════════════');
  console.log('2️⃣  ANÁLISIS DE SEGURIDAD (npm audit)');
  console.log('═══════════════════════════════════════');

  const auditResult = await runCommand('npm audit --json', 'Escaneando vulnerabilidades');

  if (auditResult.stdout) {
    try {
      const auditData = JSON.parse(auditResult.stdout);
      const vulns = auditData.metadata?.vulnerabilities || {};

      results.security = {
        status: (vulns.critical || 0) + (vulns.high || 0) === 0 ? 'passed' : 'failed',
        vulnerabilities: {
          critical: vulns.critical || 0,
          high: vulns.high || 0,
          moderate: vulns.moderate || 0,
          low: vulns.low || 0,
          info: vulns.info || 0,
          total: vulns.total || 0
        }
      };

      console.log(`🔴 Críticas: ${vulns.critical || 0}`);
      console.log(`🟠 Altas: ${vulns.high || 0}`);
      console.log(`🟡 Moderadas: ${vulns.moderate || 0}`);
      console.log(`🟢 Bajas: ${vulns.low || 0}`);
      console.log(`ℹ️  Info: ${vulns.info || 0}`);

      // Guardar reporte
      fs.writeFileSync(
        path.join(REPORTS_DIR, 'security-audit.json'),
        JSON.stringify(auditData, null, 2)
      );
    } catch (err) {
      console.error('❌ Error parseando resultado de audit:', err.message);
      results.security.status = 'error';
    }
  }

  // 3. Dependencias obsoletas
  console.log('\n═══════════════════════════════════════');
  console.log('       ANÁLISIS DE DEPENDENCIAS');
  console.log('═══════════════════════════════════════');

  const outdatedResult = await runCommand('npm outdated --json', 'Verificando paquetes obsoletos');

  if (outdatedResult.stdout) {
    try {
      const outdatedData = JSON.parse(outdatedResult.stdout);
      const outdatedPackages = Object.keys(outdatedData);

      results.dependencies.outdated = outdatedPackages.map(pkg => ({
        package: pkg,
        current: outdatedData[pkg].current,
        wanted: outdatedData[pkg].wanted,
        latest: outdatedData[pkg].latest
      }));

      results.dependencies.status = outdatedPackages.length === 0 ? 'passed' : 'warning';

      console.log(`📦 Paquetes desactualizados: ${outdatedPackages.length}`);

      if (outdatedPackages.length > 0) {
        console.log('\nPaquetes que necesitan actualización:');
        outdatedPackages.slice(0, 5).forEach(pkg => {
          const info = outdatedData[pkg];
          console.log(`  - ${pkg}: ${info.current} → ${info.latest}`);
        });
        if (outdatedPackages.length > 5) {
          console.log(`  ... y ${outdatedPackages.length - 5} más`);
        }
      } else {
        console.log('✅ Todos los paquetes están actualizados');
      }

      fs.writeFileSync(
        path.join(REPORTS_DIR, 'outdated-dependencies.json'),
        JSON.stringify(outdatedData, null, 2)
      );
    } catch (_err) {
      console.log('✅ No hay paquetes desactualizados o error al parsear');
      results.dependencies.status = 'passed';
    }
  }

  // 4. Generar reporte consolidado
  console.log('\n═══════════════════════════════════════');
  console.log('📋 GENERANDO REPORTE CONSOLIDADO');
  console.log('═══════════════════════════════════════\n');

  fs.writeFileSync(
    path.join(REPORTS_DIR, 'analysis-summary.json'),
    JSON.stringify(results, null, 2)
  );

  // Generar reporte Markdown
  const markdownReport = generateMarkdownReport(results);
  fs.writeFileSync(
    path.join(REPORTS_DIR, 'ANALYSIS_REPORT.md'),
    markdownReport
  );

  console.log('✅ Reporte consolidado guardado en:');
  console.log(`   - ${path.join(REPORTS_DIR, 'analysis-summary.json')}`);
  console.log(`   - ${path.join(REPORTS_DIR, 'ANALYSIS_REPORT.md')}`);

  // 5. Resumen final
  printFinalSummary(results);
}

function generateMarkdownReport(analysisResults) {
  const date = new Date(analysisResults.timestamp).toLocaleString('es-ES');

  return `# 📊 Reporte de Análisis del Proyecto

**Fecha:** ${date}

---

## 🎨 Calidad de Código (ESLint)

- **Estado:** ${analysisResults.eslint.status === 'passed' ? '✅ APROBADO' : '❌ REQUIERE ATENCIÓN'}
- **Errores:** ${analysisResults.eslint.errors}
- **Warnings:** ${analysisResults.eslint.warnings}
- **Archivos analizados:** ${analysisResults.eslint.filesAnalyzed || 'N/A'}

${analysisResults.eslint.errors === 0
  ? '✅ No se encontraron errores de linting.'
  : '⚠️ Se encontraron errores que deben ser corregidos.'}

---

## 🔐 Seguridad (npm audit)

- **Estado:** ${analysisResults.security.status === 'passed' ? '✅ SEGURO' : '⚠️ VULNERABILIDADES DETECTADAS'}

### Vulnerabilidades por severidad:

| Severidad | Cantidad |
|-----------|----------|
| 🔴 Críticas | ${analysisResults.security.vulnerabilities?.critical || 0} |
| 🟠 Altas | ${analysisResults.security.vulnerabilities?.high || 0} |
| 🟡 Moderadas | ${analysisResults.security.vulnerabilities?.moderate || 0} |
| 🟢 Bajas | ${analysisResults.security.vulnerabilities?.low || 0} |
| ℹ️ Info | ${analysisResults.security.vulnerabilities?.info || 0} |
| **TOTAL** | **${analysisResults.security.vulnerabilities?.total || 0}** |

${(analysisResults.security.vulnerabilities?.critical || 0) + (analysisResults.security.vulnerabilities?.high || 0) === 0
  ? '✅ No se detectaron vulnerabilidades críticas o altas.'
  : '⚠️ Se detectaron vulnerabilidades que requieren atención inmediata.'}

---

## 📦 Dependencias

- **Estado:** ${analysisResults.dependencies.status === 'passed' ? '✅ ACTUALIZADO' : '⚠️ ACTUALIZACIÓN RECOMENDADA'}
- **Paquetes desactualizados:** ${analysisResults.dependencies.outdated?.length || 0}

${analysisResults.dependencies.outdated && analysisResults.dependencies.outdated.length > 0
  ? `### Paquetes que necesitan actualización:

${analysisResults.dependencies.outdated.map(pkg =>
  `- **${pkg.package}**: ${pkg.current} → ${pkg.latest}`
).join('\n')}

Para actualizar, ejecuta: \`npm update\` o \`npm install ${analysisResults.dependencies.outdated[0].package}@latest\`
`
  : '✅ Todas las dependencias están actualizadas.'}

---

## 📋 Acciones Recomendadas

${analysisResults.eslint.errors > 0 ? '- 🔧 Corregir errores de ESLint con `npm run lint:fix`\n' : ''}
${(analysisResults.security.vulnerabilities?.critical || 0) + (analysisResults.security.vulnerabilities?.high || 0) > 0
  ? '- 🔐 Revisar y corregir vulnerabilidades de seguridad con `npm audit fix`\n'
  : ''}
${analysisResults.dependencies.outdated && analysisResults.dependencies.outdated.length > 5
  ? '- 📦 Actualizar dependencias con `npm update` o `npm run deps:update`\n'
  : ''}
${analysisResults.eslint.errors === 0 && analysisResults.security.vulnerabilities?.total === 0 && analysisResults.dependencies.outdated?.length === 0
  ? '✅ El proyecto está en buen estado. Continúa con el buen trabajo!\n'
  : ''}

---

**Generado automáticamente por el script de análisis**
`;
}

function printFinalSummary(summaryResults) {
  console.log('\n\n╔══════════════════════════════════════╗');
  console.log('║     RESUMEN DEL ANÁLISIS             ║');
  console.log('╚══════════════════════════════════════╝\n');

  // Calidad de código
  if (summaryResults.eslint.status === 'passed') {
    console.log('✅ Calidad de Código: APROBADO');
  } else if (summaryResults.eslint.status === 'failed') {
    console.log(`❌ Calidad de Código: ${summaryResults.eslint.errors} errores, ${summaryResults.eslint.warnings} warnings`);
  } else {
    console.log('⚠️  Calidad de Código: ERROR EN ANÁLISIS');
  }

  // Seguridad
  if (summaryResults.security.status === 'passed') {
    console.log('✅ Seguridad: SIN VULNERABILIDADES CRÍTICAS');
  } else if (summaryResults.security.status === 'failed') {
    const critical = summaryResults.security.vulnerabilities?.critical || 0;
    const high = summaryResults.security.vulnerabilities?.high || 0;
    const moderate = summaryResults.security.vulnerabilities?.moderate || 0;
    console.log(`⚠️  Seguridad: ${critical} críticas, ${high} altas, ${moderate} moderadas`);
  } else {
    console.log('⚠️  Seguridad: ERROR EN ANÁLISIS');
  }

  // Dependencias
  if (summaryResults.dependencies.status === 'passed') {
    console.log('✅ Dependencias: ACTUALIZADAS');
  } else if (summaryResults.dependencies.status === 'warning') {
    console.log(`⚠️  Dependencias: ${summaryResults.dependencies.outdated?.length || 0} paquetes desactualizados`);
  }

  console.log('\n📁 Reportes guardados en: ./reports/');
  console.log('\n✨ Análisis completado!\n');
}

// Ejecutar análisis
analyzeAll().catch(err => {
  console.error('\n❌ Error durante el análisis:', err);
  process.exit(1);
});
