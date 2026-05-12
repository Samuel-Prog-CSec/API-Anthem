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
 *                    Valores: ubicaciones,aire,ruido,trafico,censo,contenedores,multas,
 *                             accidentes,patinetes,bicicletas,aforo-bicicletas
 *   --help          Mostrar ayuda
 */

'use strict';

process.env.SCRIPT_MODE = 'true';

const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const { importAllLogger: logger } = require('../src/config/scriptLogger');
const mongoose = require('mongoose');
const { connectDB } = require('../src/config/database');
const appConfig = require('../src/config/config');
const {
  dropIndicesSecundarios,
  recrearIndicesSecundarios
} = require('./importation/helpers/gestorIndices');
const { IMPORT_SUMMARIES_DIR } = require('./importation/helpers/importHelpers');

const Trafico = require('../src/models/Trafico');
const Censo = require('../src/models/Censo');
const Multa = require('../src/models/Multa');

const MODELOS_FASE3 = {
  trafico: Trafico,
  censo: Censo,
  multas: Multa
};

/**
 * Helpers para output al terminal de CLI.
 * NO son logging (de eso se encarga Pino vía `logger`); son UX para el usuario
 * que ejecuta el script en interactivo. Mantenerlos separados evita usar console.*
 * y deja Pino para logs estructurados.
 */
const imprimir = (mensaje = '') => process.stdout.write(`${mensaje}\n`);
const imprimirError = (mensaje = '') => process.stderr.write(`${mensaje}\n`);

/**
 * Definicion de importadores con orden y dependencias
 *
 * Fase 1: Datos de referencia (ubicaciones) - debe ejecutarse primero
 * Fase 2: Datos ligeros - pueden ejecutarse en paralelo
 * Fase 3: Datos pesados (trafico, censo, multas) - secuenciales para no saturar la BD
 */
const IMPORTERS = {
  ubicaciones: {
    script: 'importation/importarUbicaciones.js',
    nombre: 'Ubicaciones',
    fase: 1,
    descripcion: 'Estaciones acusticas, puntos de trafico y rutas de transporte'
  },
  aire: {
    script: 'importation/importarCalidadAire.js',
    nombre: 'Calidad del Aire',
    fase: 2,
    descripcion: 'Mediciones horarias de contaminantes atmosfericos (12 meses)'
  },
  ruido: {
    script: 'importation/importarRuido.js',
    nombre: 'Contaminacion Acustica',
    fase: 2,
    descripcion: 'Niveles de ruido por estacion y periodo del dia'
  },
  trafico: {
    script: 'importation/importarTrafico.js',
    nombre: 'Datos de Trafico',
    fase: 3,
    descripcion: 'Intensidad y carga de trafico por punto de medicion'
  },
  censo: {
    script: 'importation/importarCenso.js',
    nombre: 'Censo',
    fase: 3,
    descripcion: 'Datos censales por seccion'
  },
  contenedores: {
    script: 'importation/importarContenedores.js',
    nombre: 'Contenedores',
    fase: 2,
    descripcion: 'Ubicacion y tipo de contenedores de reciclaje'
  },
  multas: {
    script: 'importation/importarMultas.js',
    nombre: 'Multas',
    fase: 3,
    descripcion: 'Datos de multas de trafico'
  },
  accidentes: {
    script: 'importation/importarAccidentes.js',
    nombre: 'Accidentes',
    fase: 2,
    descripcion: 'Datos de accidentalidad vial'
  },
  patinetes: {
    script: 'importation/importarPatinetes.js',
    nombre: 'Patinetes',
    fase: 2,
    descripcion: 'Asignacion de patinetes electricos'
  },
  bicicletas: {
    script: 'importation/importarBicicletas.js',
    nombre: 'Bicicletas',
    fase: 2,
    descripcion: 'Disponibilidad de bicicletas publicas'
  },
  'aforo-bicicletas': {
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
    showHelp: false,
    skipIndicesManagement: false,
    rebuildIndices: null
  };

  for (const arg of args) {
    if (arg === '--force') {
      options.force = true;
    } else if (arg.startsWith('--only=')) {
      options.only = arg.replace('--only=', '').split(',').map(s => s.trim());
    } else if (arg === '--help') {
      options.showHelp = true;
    } else if (arg === '--skip-indices-management') {
      options.skipIndicesManagement = true;
    } else if (arg.startsWith('--rebuild-indices=')) {
      options.rebuildIndices = arg.replace('--rebuild-indices=', '').split(',').map(s => s.trim());
    }
  }

  return options;
}

/**
 * Mostrar ayuda
 */
function showHelp() {
  imprimir(`
Script Maestro de Importacion de Datos - Smart City Anthem 2051

Uso: node scripts/importAll.js [opciones]

Opciones:
  --force                       Forzar sobrescritura de datos existentes
  --only=x,y,z                  Ejecutar solo importadores especificos
  --skip-indices-management     No dropear/recrear indices en Fase 3 (legacy)
  --rebuild-indices=x[,y,z]     Solo recrear indices (sin importar). Recovery tras crash.
                                Valores: trafico, censo, multas
  --help                        Mostrar esta ayuda

Importadores disponibles:`);

  for (const [key, config] of Object.entries(IMPORTERS)) {
    imprimir(`  ${key.padEnd(15)} Fase ${config.fase} - ${config.nombre}: ${config.descripcion}`);
  }

  imprimir(`
Ejemplos:
  node scripts/importAll.js                          # Ejecutar todos
  node scripts/importAll.js --only=ubicaciones,aire,ruido  # Solo los 3 dominios principales
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

    // Fase 3 carga colecciones pesadas (24M+ docs); 30 min no alcanza para Trafico.
    // Fase 1 y 2 son ligeras: 30 min sigue siendo techo de seguridad sobrado.
    const timeoutMs = importerConfig.fase === 3 ? 120 * 60 * 1000 : 30 * 60 * 1000;

    const child = execFile('node', [scriptPath, ...args], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, SCRIPT_MODE: 'true' },
      maxBuffer: 50 * 1024 * 1024, // 50MB para scripts con mucha salida
      timeout: timeoutMs
    }, (error, _stdout, _stderr) => {
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
  if (ms < 1000) {return `${ms}ms`;}
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes === 0) {return `${seconds}s`;}
  return `${minutes}m ${remainingSeconds}s`;
}

/**
 * Leer summaries -latest.json escritos por cada importer y construir un
 * resumen global consolidado (impreso en stdout y guardado a disco).
 *
 * @param {Array<string>} importerKeys - Claves de los importers ejecutados
 * @param {string} runStartedAt - ISO timestamp del inicio del run global
 * @returns {Object|null} - resumen consolidado o null si no hay summaries
 */
function emitirResumenGlobal(importerKeys, runStartedAt) {
  if (!fs.existsSync(IMPORT_SUMMARIES_DIR)) {
    return null;
  }

  const summaries = [];
  for (const key of importerKeys) {
    const file = path.join(IMPORT_SUMMARIES_DIR, `${key}-latest.json`);
    if (!fs.existsSync(file)) {
      continue;
    }
    try {
      summaries.push(JSON.parse(fs.readFileSync(file, 'utf8')));
    } catch (error) {
      imprimirError(`  ! No se pudo leer ${file}: ${error.message}`);
    }
  }

  if (summaries.length === 0) {
    return null;
  }

  imprimir('\n=== Resumen consolidado de calidad de datos ===\n');
  for (const s of summaries) {
    const c = s.counts || {};
    const inserted = c.inserted || 0;
    const rejected = c.rejected || 0;
    const total = c.totalProcessed || (inserted + rejected);
    const success = total > 0 ? ((inserted / total) * 100).toFixed(1) : '0.0';

    imprimir(`  ${s.importer.padEnd(18)} ${String(inserted).padStart(13)} ok | ${String(rejected).padStart(8)} rech | ${success}% exito`);

    const top = (s.rejections || []).slice(0, 3);
    if (top.length > 0) {
      const desglose = top.map(r => `${r.razon}: ${r.cantidad}`).join('; ');
      imprimir(`                     -> ${desglose}`);
    }
    if ((s.coercions || []).length > 0) {
      const coerc = s.coercions.map(co => `${co.razon}: ${co.cantidad}`).join('; ');
      imprimir(`                     coerciones: ${coerc}`);
    }
  }

  const finishedAt = new Date().toISOString();
  const runSummary = {
    startedAt: runStartedAt,
    finishedAt,
    importers: summaries
  };

  const safeTimestamp = finishedAt.replace(/[:.]/g, '-');
  const runFile = path.join(IMPORT_SUMMARIES_DIR, `run-${safeTimestamp}.summary.json`);
  const latestFile = path.join(IMPORT_SUMMARIES_DIR, 'run-latest.summary.json');
  try {
    fs.writeFileSync(runFile, JSON.stringify(runSummary, null, 2));
    fs.writeFileSync(latestFile, JSON.stringify(runSummary, null, 2));
    imprimir(`\n  Resumen completo: ${path.relative(process.cwd(), latestFile)}`);
  } catch (error) {
    imprimirError(`  ! Error escribiendo resumen global: ${error.message}`);
  }

  return runSummary;
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

  // Modo recovery: solo recrear indices, sin importar
  if (options.rebuildIndices) {
    process.env.SCRIPT_MODE = 'true';
    await connectDB(appConfig.database.uri);

    const colecciones = options.rebuildIndices.filter(k => MODELOS_FASE3[k]);
    const invalidas = options.rebuildIndices.filter(k => !MODELOS_FASE3[k]);

    if (invalidas.length > 0) {
      imprimirError(`Modelos no reconocidos para rebuild-indices: ${invalidas.join(', ')}`);
      imprimirError(`Validos: ${Object.keys(MODELOS_FASE3).join(', ')}`);
      process.exit(1);
    }

    imprimir(`\n=== Rebuild de indices: ${colecciones.join(', ')} ===\n`);
    let huboError = false;
    for (const key of colecciones) {
      try {
        await recrearIndicesSecundarios(MODELOS_FASE3[key], logger);
        imprimir(`  [OK] ${key}`);
      } catch (error) {
        imprimirError(`  [ERROR] ${key}: ${error.message}`);
        huboError = true;
      }
    }

    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
    }
    process.exit(huboError ? 1 : 0);
  }

  // Determinar que importadores ejecutar
  let importersToRun = Object.entries(IMPORTERS);

  if (options.only) {
    const invalidKeys = options.only.filter(key => !IMPORTERS[key]);
    if (invalidKeys.length > 0) {
      logger.error({ claves: invalidKeys }, `Importadores no reconocidos: ${invalidKeys.join(', ')}`);
      imprimirError(`\nImportadores validos: ${Object.keys(IMPORTERS).join(', ')}`);
      process.exit(1);
    }
    importersToRun = importersToRun.filter(([key]) => options.only.includes(key));
  }

  logger.info({
    importadores: importersToRun.map(([key]) => key),
    total: importersToRun.length,
    force: options.force
  }, `Iniciando importacion masiva (${importersToRun.length} importadores)`);

  imprimir('\n=== Importacion Masiva - Smart City Anthem 2051 ===\n');
  imprimir(`Importadores: ${importersToRun.map(([key]) => key).join(', ')}`);
  imprimir(`Modo: ${options.force ? 'Forzar sobrescritura' : 'Normal (omitir existentes)'}\n`);

  const results = [];

  // El padre mantiene su propia conexion a Mongo para gestionar indices.
  // Los procesos hijos (importadores) abren la suya por separado.
  process.env.SCRIPT_MODE = 'true';
  await connectDB(appConfig.database.uri);

  // Fase 1: Datos de referencia (secuencial)
  const fase1 = importersToRun.filter(([, config]) => config.fase === 1);
  if (fase1.length > 0) {
    imprimir('--- Fase 1: Datos de referencia ---\n');
    for (const [key, config] of fase1) {
      const result = await runImporter(key, config, options);
      results.push(result);
      imprimir(`  ${result.success ? '[OK]' : '[ERROR]'} ${config.nombre} (${result.duration})`);
    }
  }

  // Verificar si fase 1 fallo: las demas dependen de ubicaciones (FK)
  // Continuar con fase 2 importaria datos huerfanos -> abortamos para preservar integridad
  const fase1Failed = results.some(r => !r.success);
  if (fase1Failed) {
    const fallidosFase1 = results.filter(r => !r.success).map(r => r.nombre).join(', ');
    logger.error({ fallidosFase1 }, 'Fase 1 fallo. Abortando para no importar datos huerfanos en Fase 2');
    imprimir(`\n  ERROR: Fase 1 fallo (${fallidosFase1}). Abortando importacion masiva.\n`);
    imprimir('  Los datos de Fase 2 (trafico, accidentes, multas, etc.) referencian a ubicaciones.\n');
    imprimir('  Resuelve los errores de Fase 1 antes de continuar.\n');
    process.exit(1);
  }

  // Fase 2: Datos ligeros en paralelo (todos los del modelo de fase 2)
  const FASE_TIMEOUT_MS = 30 * 60 * 1000;
  const fase2 = importersToRun.filter(([, config]) => config.fase === 2);
  if (fase2.length > 0) {
    imprimir('\n--- Fase 2: Datos ligeros (paralelo) ---\n');

    const fase2Promise = Promise.all(
      fase2.map(([key, config]) => runImporter(key, config, options))
    );

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error(`Timeout global de Fase 2 (${FASE_TIMEOUT_MS / 60000}min) alcanzado`)),
        FASE_TIMEOUT_MS
      )
    );

    try {
      const fase2Results = await Promise.race([fase2Promise, timeoutPromise]);
      for (const result of fase2Results) {
        results.push(result);
        imprimir(`  ${result.success ? '[OK]' : '[ERROR]'} ${result.nombre} (${result.duration})`);
      }
    } catch (error) {
      logger.error({ error: error.message }, 'Fase 2 abortada por timeout o error');
      imprimir(`\n  ERROR Fase 2: ${error.message}\n`);
      process.exit(1);
    }
  }

  // Fase 3: Datos pesados en serie (uno usa toda la BD)
  const fase3 = importersToRun.filter(([, config]) => config.fase === 3);
  if (fase3.length > 0) {
    imprimir('\n--- Fase 3: Datos pesados (secuencial) ---\n');

    for (const [key, config] of fase3) {
      const Modelo = MODELOS_FASE3[key];

      if (!options.skipIndicesManagement && Modelo) {
        try {
          await dropIndicesSecundarios(Modelo, logger);
        } catch (error) {
          logger.error({
            importador: key,
            error: error.message
          }, 'Error dropeando indices, abortando esta coleccion');
          results.push({
            key,
            nombre: config.nombre,
            success: false,
            duration: '0s',
            error: `Error en drop de indices: ${error.message}`
          });
          continue;
        }
      }

      let result;
      try {
        result = await runImporter(key, config, options);
        results.push(result);
        imprimir(`  ${result.success ? '[OK]' : '[ERROR]'} ${result.nombre} (${result.duration})`);
      } finally {
        if (!options.skipIndicesManagement && Modelo) {
          try {
            await recrearIndicesSecundarios(Modelo, logger);
          } catch (error) {
            logger.error({
              importador: key,
              error: error.message
            }, `Error recreando indices. Recuperar manualmente: node scripts/importAll.js --rebuild-indices=${key}`);
            imprimirError(`\n  ERROR recreando indices de ${config.nombre}.`);
            imprimirError(`  Recuperar manualmente: node scripts/importAll.js --rebuild-indices=${key}\n`);
          }
        }
      }
    }
  }

  // Resumen final
  const totalDuration = formatDuration(Date.now() - globalStart);
  const exitosos = results.filter(r => r.success).length;
  const fallidos = results.filter(r => !r.success).length;

  imprimir('\n=== Resumen Final ===\n');
  imprimir(`  Total ejecutados: ${results.length}`);
  imprimir(`  Exitosos:         ${exitosos}`);
  imprimir(`  Fallidos:         ${fallidos}`);
  imprimir(`  Duracion total:   ${totalDuration}`);

  if (fallidos > 0) {
    imprimir('\n  Importadores fallidos:');
    for (const result of results.filter(r => !r.success)) {
      imprimir(`    - ${result.nombre}: ${result.error}`);
    }
  }

  imprimir('');

  logger.info({
    duracionTotal: totalDuration,
    exitosos,
    fallidos,
    resultados: results.map(r => ({ importador: r.key, exitoso: r.success, duracion: r.duration }))
  }, `Importacion masiva completada: ${exitosos}/${results.length} exitosos`);

  // Resumen consolidado leyendo logs/import/<importer>-latest.json
  emitirResumenGlobal(results.map(r => r.key), new Date(globalStart).toISOString());

  // Cerrar conexion del padre
  if (mongoose.connection.readyState === 1) {
    await mongoose.connection.close();
  }

  if (fallidos > 0) {
    process.exit(1);
  }
}

// Handler de SIGINT en el padre: si el usuario hace Ctrl+C entre drop y recreate,
// intentamos recrear todos los indices de Fase 3 antes de salir para no dejar
// la BD sin indices secundarios.
let cerrandoPorSenal = false;
process.on('SIGINT', async () => {
  if (cerrandoPorSenal) {
    process.exit(130);
  }
  cerrandoPorSenal = true;

  imprimir('\n[SIGINT] Intentando recrear indices antes de salir...');

  for (const [key, Modelo] of Object.entries(MODELOS_FASE3)) {
    try {
      await recrearIndicesSecundarios(Modelo, logger);
    } catch (error) {
      logger.error({
        importador: key,
        error: error.message
      }, `Error recreando indices en SIGINT. Recuperar: node scripts/importAll.js --rebuild-indices=${key}`);
    }
  }

  if (mongoose.connection.readyState === 1) {
    await mongoose.connection.close();
  }
  process.exit(130);
});

// Ejecutar
main().catch(error => {
  logger.fatal({ error: error.message }, 'Error fatal en script maestro');
  imprimirError(`\nError fatal: ${error.message}`);
  process.exit(1);
});
