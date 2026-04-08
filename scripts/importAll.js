/**
 * Script Maestro de Importacion de Datos
 *
 * Coordina la importacion de todos los tipos de datos de forma optimizada
 * y con manejo robusto de errores y conexiones.
 *
 * Uso: node scripts/importAll.js [opciones]
 *
 * Opciones:
 *   --force         Forzar sobrescritura de datos existentes
 *   --only=x,y,z    Ejecutar solo importadores especificos
 *                    Valores: locations,air,noise,traffic,census,containers,fines,
 *                             accidents,scooters,bikes,bike-traffic
 *   --help          Mostrar ayuda
 */

'use strict';

process.env.SCRIPT_MODE = 'true';

const { execFile } = require('child_process');
const path = require('path');
const { importAllLogger: logger } = require('../src/config/scriptLogger');

/**
 * Definicion de importadores con orden y dependencias
 *
 * Fase 1: Datos de referencia (ubicaciones) - debe ejecutarse primero
 * Fase 2: Datos independientes - pueden ejecutarse en paralelo
 */
const IMPORTERS = {
  locations: {
    script: 'importation/importarUbicaciones.js',
    nombre: 'Ubicaciones',
    fase: 1,
    descripcion: 'Estaciones acusticas, puntos de trafico y rutas de transporte'
  },
  air: {
    script: 'importation/importAirQuality.js',
    nombre: 'Calidad del Aire',
    fase: 2,
    descripcion: 'Mediciones horarias de contaminantes atmosfericos (12 meses)'
  },
  noise: {
    script: 'importation/importNoise.js',
    nombre: 'Contaminacion Acustica',
    fase: 2,
    descripcion: 'Niveles de ruido por estacion y periodo del dia'
  },
  traffic: {
    script: 'importation/importTrafficData.js',
    nombre: 'Datos de Trafico',
    fase: 2,
    descripcion: 'Intensidad y carga de trafico por punto de medicion'
  },
  census: {
    script: 'importation/importCensus.js',
    nombre: 'Censo',
    fase: 2,
    descripcion: 'Datos censales por seccion'
  },
  containers: {
    script: 'importation/importContainers.js',
    nombre: 'Contenedores',
    fase: 2,
    descripcion: 'Ubicacion y tipo de contenedores de reciclaje'
  },
  fines: {
    script: 'importation/importFines.js',
    nombre: 'Multas',
    fase: 2,
    descripcion: 'Datos de multas de trafico'
  },
  accidents: {
    script: 'importation/importarAccidentes.js',
    nombre: 'Accidentes',
    fase: 2,
    descripcion: 'Datos de accidentalidad vial'
  },
  scooters: {
    script: 'importation/importarPatinetes.js',
    nombre: 'Patinetes',
    fase: 2,
    descripcion: 'Asignacion de patinetes electricos'
  },
  bikes: {
    script: 'importation/importarBicicletas.js',
    nombre: 'Bicicletas',
    fase: 2,
    descripcion: 'Disponibilidad de bicicletas publicas'
  },
  'bike-traffic': {
    script: 'importation/importarAforoBicicletas.js',
    nombre: 'Aforo Bicicletas',
    fase: 2,
    descripcion: 'Conteo horario de bicicletas por punto de medicion'
  }
};

/**
 * Parsear argumentos de linea de comandos
 * @returns {Object} Opciones parseadas
 */
function parseArguments() {
  const args = process.argv.slice(2);
  const options = {
    force: false,
    only: null,
    showHelp: false
  };

  for (const arg of args) {
    if (arg === '--force') {
      options.force = true;
    } else if (arg.startsWith('--only=')) {
      options.only = arg.replace('--only=', '').split(',').map(s => s.trim());
    } else if (arg === '--help') {
      options.showHelp = true;
    }
  }

  return options;
}

/**
 * Mostrar ayuda
 */
function showHelp() {
  console.log(`
Script Maestro de Importacion de Datos - Smart City Anthem 2051

Uso: node scripts/importAll.js [opciones]

Opciones:
  --force         Forzar sobrescritura de datos existentes
  --only=x,y,z    Ejecutar solo importadores especificos
  --help          Mostrar esta ayuda

Importadores disponibles:`);

  for (const [key, config] of Object.entries(IMPORTERS)) {
    console.log(`  ${key.padEnd(15)} Fase ${config.fase} - ${config.nombre}: ${config.descripcion}`);
  }

  console.log(`
Ejemplos:
  node scripts/importAll.js                          # Ejecutar todos
  node scripts/importAll.js --only=locations,air,noise  # Solo los 3 dominios principales
  node scripts/importAll.js --force                  # Forzar sobrescritura
`);
}

/**
 * Ejecutar un script importador como proceso hijo
 * @param {string} key - Clave del importador
 * @param {Object} importerConfig - Configuracion del importador
 * @param {Object} options - Opciones globales
 * @returns {Promise<Object>} Resultado de la ejecucion
 */
function runImporter(key, importerConfig, options) {
  return new Promise((resolve) => {
    const scriptPath = path.join(__dirname, importerConfig.script);
    const args = [];

    if (options.force) {
      args.push('--force');
    }

    const startTime = Date.now();

    logger.info({ importador: key, nombre: importerConfig.nombre }, `Iniciando importacion: ${importerConfig.nombre}`);

    const child = execFile('node', [scriptPath, ...args], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, SCRIPT_MODE: 'true' },
      maxBuffer: 50 * 1024 * 1024, // 50MB para scripts con mucha salida
      timeout: 30 * 60 * 1000 // 30 minutos maximo por importador
    }, (error, stdout, stderr) => {
      const duration = Date.now() - startTime;
      const durationStr = formatDuration(duration);

      if (error) {
        logger.error({
          importador: key,
          nombre: importerConfig.nombre,
          duracion: durationStr,
          error: error.message,
          exitCode: error.code
        }, `Error en importacion: ${importerConfig.nombre}`);

        resolve({
          key,
          nombre: importerConfig.nombre,
          success: false,
          duration: durationStr,
          error: error.message
        });
      } else {
        logger.info({
          importador: key,
          nombre: importerConfig.nombre,
          duracion: durationStr
        }, `Importacion completada: ${importerConfig.nombre}`);

        resolve({
          key,
          nombre: importerConfig.nombre,
          success: true,
          duration: durationStr
        });
      }
    });

    // Redirigir salida del proceso hijo al logger
    if (child.stdout) {
      child.stdout.on('data', (data) => {
        const lines = data.toString().trim().split('\n');
        for (const line of lines) {
          if (line.trim()) {
            logger.debug({ importador: key }, line.trim());
          }
        }
      });
    }

    if (child.stderr) {
      child.stderr.on('data', (data) => {
        const lines = data.toString().trim().split('\n');
        for (const line of lines) {
          if (line.trim()) {
            logger.warn({ importador: key }, line.trim());
          }
        }
      });
    }
  });
}

/**
 * Formatear duracion en formato legible
 * @param {number} ms - Milisegundos
 * @returns {string} Duracion formateada
 */
function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${remainingSeconds}s`;
}

/**
 * Funcion principal
 */
async function main() {
  const globalStart = Date.now();
  const options = parseArguments();

  if (options.showHelp) {
    showHelp();
    return;
  }

  // Determinar que importadores ejecutar
  let importersToRun = Object.entries(IMPORTERS);

  if (options.only) {
    const invalidKeys = options.only.filter(key => !IMPORTERS[key]);
    if (invalidKeys.length > 0) {
      logger.error({ claves: invalidKeys }, `Importadores no reconocidos: ${invalidKeys.join(', ')}`);
      console.error(`\nImportadores validos: ${Object.keys(IMPORTERS).join(', ')}`);
      process.exit(1);
    }
    importersToRun = importersToRun.filter(([key]) => options.only.includes(key));
  }

  logger.info({
    importadores: importersToRun.map(([key]) => key),
    total: importersToRun.length,
    force: options.force
  }, `Iniciando importacion masiva (${importersToRun.length} importadores)`);

  console.log('\n=== Importacion Masiva - Smart City Anthem 2051 ===\n');
  console.log(`Importadores: ${importersToRun.map(([key]) => key).join(', ')}`);
  console.log(`Modo: ${options.force ? 'Forzar sobrescritura' : 'Normal (omitir existentes)'}\n`);

  const results = [];

  // Fase 1: Datos de referencia (secuencial)
  const fase1 = importersToRun.filter(([, config]) => config.fase === 1);
  if (fase1.length > 0) {
    console.log('--- Fase 1: Datos de referencia ---\n');
    for (const [key, config] of fase1) {
      const result = await runImporter(key, config, options);
      results.push(result);
      console.log(`  ${result.success ? '[OK]' : '[ERROR]'} ${config.nombre} (${result.duration})`);
    }
  }

  // Verificar si fase 1 fallo (las demas dependen de ubicaciones)
  const fase1Failed = results.some(r => !r.success);
  if (fase1Failed) {
    logger.warn('Fase 1 tuvo errores. Continuando con fase 2 de todos modos...');
    console.log('\n  AVISO: Fase 1 tuvo errores. Los datos de referencia pueden estar incompletos.\n');
  }

  // Fase 2: Datos independientes (paralelo)
  const fase2 = importersToRun.filter(([, config]) => config.fase === 2);
  if (fase2.length > 0) {
    console.log('\n--- Fase 2: Datos de dominio (paralelo) ---\n');

    const fase2Results = await Promise.all(
      fase2.map(([key, config]) => runImporter(key, config, options))
    );

    for (const result of fase2Results) {
      results.push(result);
      console.log(`  ${result.success ? '[OK]' : '[ERROR]'} ${result.nombre} (${result.duration})`);
    }
  }

  // Resumen final
  const totalDuration = formatDuration(Date.now() - globalStart);
  const exitosos = results.filter(r => r.success).length;
  const fallidos = results.filter(r => !r.success).length;

  console.log('\n=== Resumen Final ===\n');
  console.log(`  Total ejecutados: ${results.length}`);
  console.log(`  Exitosos:         ${exitosos}`);
  console.log(`  Fallidos:         ${fallidos}`);
  console.log(`  Duracion total:   ${totalDuration}`);

  if (fallidos > 0) {
    console.log('\n  Importadores fallidos:');
    for (const result of results.filter(r => !r.success)) {
      console.log(`    - ${result.nombre}: ${result.error}`);
    }
  }

  console.log('');

  logger.info({
    duracionTotal: totalDuration,
    exitosos,
    fallidos,
    resultados: results.map(r => ({ importador: r.key, exitoso: r.success, duracion: r.duration }))
  }, `Importacion masiva completada: ${exitosos}/${results.length} exitosos`);

  if (fallidos > 0) {
    process.exit(1);
  }
}

// Ejecutar
main().catch(error => {
  logger.fatal({ error: error.message }, 'Error fatal en script maestro');
  console.error(`\nError fatal: ${error.message}`);
  process.exit(1);
});
