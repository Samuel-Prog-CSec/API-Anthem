/**
 * Script Maestro de Importación de Datos
 *
 * Coordina la importación de todos los tipos de datos de forma optimizada
 * y con manejo robusto de errores y conexiones.
 *
 * Uso: node scripts/importation/importAll.js [opciones]
 *
 * Opciones:
 *   --skip-heavy    Omitir importación de archivos pesados (tráfico y multas)
 *   --only-light    Solo importar archivos ligeros (accidentes, censo, ruido, ubicaciones)
 *   --force         Forzar sobrescritura de datos existentes
 *   --help          Mostrar ayuda
 */

const path = require('path');
const mongoose = require('mongoose');
const config = require('../src/config/config');

// Importar todos los módulos de importación
const { main: importAccidents } = require('./importation/importAccidentData');
const { importCensusData } = require('./importation/importCensus');
const { main: importTraffic } = require('./importation/importTrafficData');
const { importMultasData } = require('./importation/importFines');
const { importNoiseData } = require('./importation/importNoise');
const { importAllLocations } = require('./importation/importLocations');
const { importAirQualityData } = require('./importation/importAirQuality');
const { importScooterAssignments } = require('./importation/importScooterAssignments');

/**
 * Configuración del importador maestro
 */
const IMPORT_ORDER = {
  light: [
    { name: 'Ubicaciones', fn: importAllLocations, estimated: '2min' },
    { name: 'Accidentes', fn: importAccidents, estimated: '3min' },
    { name: 'Censo', fn: importCensusData, estimated: '5min' },
    { name: 'Contaminación Acústica', fn: importNoiseData, estimated: '2min' },
    { name: 'Calidad del Aire', fn: importAirQualityData, estimated: '4min' },
    { name: 'Asignación de Patinetes', fn: importScooterAssignments, estimated: '1min' }
  ],
  heavy: [
    { name: 'Multas', fn: importMultasData, estimated: '15min' },
    { name: 'Tráfico', fn: importTraffic, estimated: '30min' }
  ]
};

/**
 * Parsear argumentos de línea de comandos
 */
function parseArguments() {
  const args = process.argv.slice(2);
  return {
    skipHeavy: args.includes('--skip-heavy'),
    onlyLight: args.includes('--only-light'),
    force: args.includes('--force'),
    showHelp: args.includes('--help')
  };
}

/**
 * Mostrar ayuda
 */
function showHelp() {
  console.log(`
🚀 Script Maestro de Importación de Datos

Uso: node scripts/importation/importAll.js [opciones]

Opciones:
  --skip-heavy    Omitir archivos pesados (tráfico y multas)
  --only-light    Solo importar archivos ligeros
  --force         Forzar sobrescritura de datos existentes
  --help          Mostrar esta ayuda

Tipos de datos:
  📍 Ligeros: Ubicaciones, Accidentes, Censo, Ruido, Calidad del Aire, Patinetes (~17min)
  📊 Pesados: Multas, Tráfico (~45min)

Ejemplos:
  node scripts/importation/importAll.js                # Importar todo
  node scripts/importation/importAll.js --only-light  # Solo datos ligeros
  node scripts/importation/importAll.js --skip-heavy  # Evitar tráfico y multas
  `);
}

/**
 * Ejecutar una importación individual con manejo de errores
 */
async function runImport(importConfig, options = {}) {
  const { name, fn, estimated } = importConfig;

  console.log(`\n${'='.repeat(80)}`);
  console.log(`🚀 INICIANDO IMPORTACIÓN: ${name.toUpperCase()}`);
  console.log(`⏱️  Tiempo estimado: ${estimated}`);
  console.log(`${'='.repeat(80)}`);

  const startTime = Date.now();

  try {
    const result = await fn(options);

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log(`\n✅ ${name.toUpperCase()} COMPLETADO`);
    console.log(`⏱️  Tiempo real: ${duration}s`);

    if (result && typeof result === 'object') {
      if (result.insertedRecords !== undefined) {
        console.log(`📊 Registros insertados: ${result.insertedRecords.toLocaleString()}`);
      }
      if (result.totalProcessed !== undefined) {
        console.log(`📊 Total procesados: ${result.totalProcessed.toLocaleString()}`);
      }
      if (result.errorRows !== undefined && result.errorRows > 0) {
        console.log(`⚠️  Errores: ${result.errorRows.toLocaleString()}`);
      }
    }

    return {
      success: true,
      name,
      duration: parseFloat(duration),
      result
    };

  } catch (error) {
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    console.error(`\n❌ ${name.toUpperCase()} FALLÓ`);
    console.error(`⏱️  Tiempo transcurrido: ${duration}s`);
    console.error(`💥 Error: ${error.message}`);

    return {
      success: false,
      name,
      duration: parseFloat(duration),
      error: error.message
    };
  }
}

/**
 * Función principal del script maestro
 */
async function main() {
  const options = parseArguments();

  if (options.showHelp) {
    showHelp();
    return;
  }

  const startTime = Date.now();
  const results = [];

  console.log('🚀 SCRIPT MAESTRO DE IMPORTACIÓN DE DATOS');
  console.log('📊 Configuración:');
  console.log(`   - Omitir archivos pesados: ${options.skipHeavy ? 'Sí' : 'No'}`);
  console.log(`   - Solo archivos ligeros: ${options.onlyLight ? 'Sí' : 'No'}`);
  console.log(`   - Forzar sobrescritura: ${options.force ? 'Sí' : 'No'}`);

  try {
    // Verificar conexión a base de datos
    console.log('\n🔄 Verificando conexión a MongoDB...');
    await mongoose.connect(config.database.uri);
    console.log('✅ Conexión establecida');
    await mongoose.connection.close();

    // Determinar qué importaciones ejecutar
    const importsToRun = [...IMPORT_ORDER.light];
    if (!options.skipHeavy && !options.onlyLight) {
      importsToRun.push(...IMPORT_ORDER.heavy);
    }

    const totalEstimatedTime = importsToRun.reduce((acc, imp) => {
      const minutes = parseInt(imp.estimated.replace('min', ''));
      return acc + minutes;
    }, 0);

    console.log(`\n📋 Plan de importación: ${importsToRun.length} tipos de datos`);
    console.log(`⏱️  Tiempo estimado total: ~${totalEstimatedTime} minutos`);
    console.log(`📄 Orden de ejecución:`);
    importsToRun.forEach((imp, i) => {
      console.log(`   ${i + 1}. ${imp.name} (~${imp.estimated})`);
    });

    // Ejecutar importaciones secuencialmente
    for (let i = 0; i < importsToRun.length; i++) {
      const importConfig = importsToRun[i];

      console.log(`\n🎯 Progreso: ${i + 1}/${importsToRun.length}`);

      const result = await runImport(importConfig, {
        skipExisting: !options.force,
        force: options.force
      });

      results.push(result);

      // Breve pausa entre importaciones para liberar recursos
      if (i < importsToRun.length - 1) {
        console.log('\n⏸️  Pausa de 5 segundos entre importaciones...');
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }

    // Mostrar resumen final
    showFinalSummary(results, startTime);

  } catch (error) {
    console.error('\n💥 ERROR CRÍTICO EN SCRIPT MAESTRO:');
    console.error(`   ${error.message}`);
    process.exit(1);

  } finally {
    // Asegurar que las conexiones están cerradas
    if (mongoose.connection.readyState === 1) {
      try {
        await mongoose.connection.close();
      } catch (error) {
        console.error('⚠️  Error cerrando conexión:', error.message);
      }
    }
  }
}

/**
 * Mostrar resumen final
 */
function showFinalSummary(results, startTime) {
  const totalDuration = ((Date.now() - startTime) / 1000).toFixed(2);
  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);

  console.log('\n\n' + '='.repeat(80));
  console.log('🎉 RESUMEN FINAL DE IMPORTACIÓN MAESTRA');
  console.log('='.repeat(80));

  console.log(`⏱️  Tiempo total: ${totalDuration} segundos (${(totalDuration / 60).toFixed(1)} minutos)`);
  console.log(`✅ Exitosas: ${successful.length}/${results.length}`);
  console.log(`❌ Fallidas: ${failed.length}/${results.length}`);

  if (successful.length > 0) {
    console.log('\n✅ IMPORTACIONES EXITOSAS:');
    successful.forEach((result, i) => {
      console.log(`   ${i + 1}. ${result.name}: ${result.duration}s`);
    });
  }

  if (failed.length > 0) {
    console.log('\n❌ IMPORTACIONES FALLIDAS:');
    failed.forEach((result, i) => {
      console.log(`   ${i + 1}. ${result.name}: ${result.error}`);
    });
  }

  console.log('\n📊 ESTADÍSTICAS FINALES:');
  const avgTime = results.reduce((acc, r) => acc + r.duration, 0) / results.length;
  console.log(`   - Tiempo promedio por importación: ${avgTime.toFixed(2)}s`);
  console.log(`   - Tasa de éxito: ${(successful.length / results.length * 100).toFixed(1)}%`);

  console.log('\n' + '='.repeat(80));
  console.log('🎯 IMPORTACIÓN MAESTRA COMPLETADA');
  console.log('='.repeat(80));
}

// Manejo de señales del sistema
process.on('SIGINT', async () => {
  console.log('\n\n🛑 Interrupción recibida. Cerrando conexiones...');
  if (mongoose.connection.readyState === 1) {
    try {
      await mongoose.connection.close();
    } catch (error) {
      console.error('Error cerrando conexión:', error.message);
    }
  }
  process.exit(0);
});

process.on('uncaughtException', (error) => {
  console.error('💥 Error no capturado:', error.message);
  process.exit(1);
});

// Ejecutar si es llamado directamente
if (require.main === module) {
  main().catch(error => {
    console.error('💥 Error fatal en script maestro:', error.message);
    process.exit(1);
  });
}

module.exports = { main };
