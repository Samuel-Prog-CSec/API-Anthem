/**
 * Script Simplificado de Importación de Datos de Tráfico
 *
 * Procesa y carga TODOS los datos de tráfico desde archivos CSV a la base de datos MongoDB.
 * Ejecutar: node scripts/importation/importTrafficData.js
 */

const fs = require('fs').promises;
const path = require('path');
const csv = require('csv-parser');
const { createReadStream } = require('fs');
const mongoose = require('mongoose');

// Importar modelos y configuración
const Traffic = require('../../src/models/Traffic');
const config = require('../../src/config/config');

// CONFIGURACIÓN OPTIMIZADA
const BATCH_SIZE = 5000; // Lotes más grandes
const DATA_DIR = path.join(__dirname, '../../datos_hpe/Trafico');
const LOCATIONS_FILE = path.join(__dirname, '../../datos_hpe/Ubicaciones/Anthem_CTC_PuntoMedidaTrafico.csv');
const MAX_PARALLEL = 3; // Procesamiento paralelo
const LOG_INTERVAL = 100000; // Logs menos frecuentes

// Contadores globales
let totalProcessed = 0;
let totalInserted = 0;
let totalSkipped = 0;
let totalErrors = 0;
let currentFile = '';

// Cache de puntos de medida
const pointsCache = new Map();

/**
 * Conectar a la base de datos
 */
async function connectDatabase() {
  try {
    console.log('🔄 Conectando a MongoDB...');
    await mongoose.connect(config.database.uri);
    console.log('✅ Conexión a MongoDB establecida');
    return true;
  } catch (error) {
    console.error('❌ Error conectando a MongoDB:', error.message);
    return false;
  }
}

/**
 * Cargar puntos de medida desde el archivo de ubicaciones
 */
async function loadTrafficPoints() {
  console.log('📍 Cargando puntos de medida de tráfico...');
  return new Promise((resolve, reject) => {
    const points = new Map();
    let count = 0;

    createReadStream(LOCATIONS_FILE)
      .pipe(csv({ separator: ';' }))
      .on('data', (row) => {
        try {
          const puntoId = row.id?.toString().trim();

          if (puntoId && /^\d+$/.test(puntoId)) {
            points.set(puntoId, {
              id: puntoId,
              nombre: row.nombre?.trim(),
              distrito: row.distrito?.trim(),
              tipo_elem: row.tipo_elem?.trim(),
              utm_x: parseFloat(row.utm_x),
              utm_y: parseFloat(row.utm_y),
              longitud: parseFloat(row.longitud),
              latitud: parseFloat(row.latitud)
            });
            count++;
          }
        } catch (error) {
          console.warn('⚠️  Error procesando punto de medida:', error.message);
        }
      })
      .on('end', () => {
        console.log(`✅ Cargados ${count} puntos de medida de tráfico`);
        resolve(points);
      })
      .on('error', (error) => {
        console.error('❌ Error leyendo archivo de puntos:', error.message);
        reject(error);
      });
  });
}

/**
 * Validar y transformar una fila de datos de tráfico (versión corregida)
 */
function validateAndTransformRow(row, rowIndex) {
  try {
    // Extraer datos básicos
    const puntoMedidaId = row.id?.toString().trim();
    const fechaStr = row.fecha?.trim();
    const tipoElemento = row.tipo_elem?.trim().toUpperCase();

    // Validaciones básicas
    if (!puntoMedidaId || !/^\d+$/.test(puntoMedidaId)) {
      throw new Error(`ID de punto inválido: ${puntoMedidaId}`);
    }

    if (!fechaStr) {
      throw new Error('Fecha faltante');
    }

    // Parsear fecha
    const fecha = new Date(fechaStr);
    if (isNaN(fecha.getTime())) {
      throw new Error(`Fecha inválida: ${fechaStr}`);
    }

    // Extraer componentes de fecha (requeridos por el esquema)
    const año = fecha.getFullYear();
    const mes = fecha.getMonth() + 1;
    const dia = fecha.getDate();
    const hora = fecha.getHours();
    const minutos = fecha.getMinutes();

    // Normalizar tipo de elemento (M30 -> M-30)
    let normalizedTipoElemento = tipoElemento;
    if (tipoElemento === 'M30') {
      normalizedTipoElemento = 'M-30';
    }

    if (!['URB', 'M-30'].includes(normalizedTipoElemento)) {
      throw new Error(`Tipo de elemento inválido: ${tipoElemento}`);
    }

    // Parsear métricas (valores negativos indican ausencia de datos)
    const intensidad = parseInt(row.intensidad) || -1;
    const ocupacion = parseInt(row.ocupacion) || -1;
    const carga = parseInt(row.carga) || -1;
    const velocidadMedia = row.vmed ? parseInt(row.vmed) : (normalizedTipoElemento === 'M-30' ? -1 : null);

    // Datos de calidad
    const error = (row.error || 'N').trim().toUpperCase();
    const periodoIntegracion = parseInt(row.periodo_integracion) || 0;

    // Construir objeto de datos completo
    const trafficData = {
      puntoMedidaId,
      fecha,

      // Componentes de fecha requeridos
      año,
      mes,
      dia,
      hora,
      minutos,

      tipoElemento: normalizedTipoElemento,
      metricas: {
        intensidad,
        ocupacion,
        carga,
        velocidadMedia
      },
      calidadDatos: {
        error: ['N', 'E', 'S'].includes(error) ? error : 'N',
        periodoIntegracion
      },
      procesamiento: {
        archivoOrigen: currentFile,
        importadoEn: new Date()
      }
    };

    return trafficData;

  } catch (error) {
    throw new Error(`Fila ${rowIndex}: ${error.message}`);
  }
}/**
 * Procesar un archivo CSV de tráfico (versión simplificada)
 */
async function processTrafficFile(filePath) {
  return new Promise((resolve, reject) => {
    const batch = [];
    const errors = [];
    let rowCount = 0;
    let processedCount = 0;

    currentFile = path.basename(filePath);
    console.log(`📁 Procesando archivo: ${currentFile}`);

    const stream = createReadStream(filePath)
      .pipe(csv({ separator: ';' }))
      .on('data', (row) => {
        rowCount++;
        totalProcessed++;

        // Mostrar progreso cada 100,000 registros (menos frecuente)
        if (rowCount % LOG_INTERVAL === 0) {
          console.log(`   📊 Procesadas ${rowCount.toLocaleString()} filas...`);
        }

        try {
          // Validar y transformar datos
          const trafficData = validateAndTransformRow(row, rowCount);
          batch.push(trafficData);
          processedCount++;

          // Procesar lote cuando alcance el tamaño configurado
          if (batch.length >= BATCH_SIZE) {
            stream.pause(); // Pausar lectura mientras procesamos
            const currentBatch = [...batch]; // Crear copia del lote
            batch.length = 0; // Vaciar el array original

            processBatch(currentBatch)
              .then((batchResult) => {
                // Solo mostrar el resultado del lote si hay muchas inserciones
                if (batchResult.nuevos > 1000 || batchResult.actualizados > 1000) {
                  console.log(`   ✅ Lote: ${batchResult.nuevos} nuevos, ${batchResult.actualizados} actualizados`);
                }
                stream.resume();
              })
              .catch((error) => {
                errors.push(`Error en lote: ${error.message}`);
                console.error(`   ❌ Error en lote: ${error.message}`);
                stream.resume();
              });
          }

        } catch (error) {
          errors.push(error.message);
          totalErrors++;

          // Mostrar errores cada 500 errores (menos frecuente)
          if (errors.length % 500 === 0) {
            console.warn(`   ⚠️  ${errors.length} errores acumulados...`);
          }

          // Abortar si hay demasiados errores
          if (errors.length > 1000) {
            stream.destroy();
            return reject(new Error(`Demasiados errores (${errors.length}). Proceso abortado.`));
          }
        }
      })
      .on('end', async () => {
        try {
          // Procesar lote final si existe
          if (batch.length > 0) {
            console.log(`   💾 Procesando lote final de ${batch.length} registros...`);
            const finalResult = await processBatch(batch);
            if (finalResult.nuevos > 100 || finalResult.actualizados > 100) {
              console.log(`   ✅ Lote final: ${finalResult.nuevos} nuevos, ${finalResult.actualizados} actualizados`);
            }
          }

          console.log(`✅ Archivo ${currentFile} completado:`);
          console.log(`   - Filas totales: ${rowCount.toLocaleString()}`);
          console.log(`   - Procesadas: ${processedCount.toLocaleString()}`);
          console.log(`   - Errores: ${errors.length.toLocaleString()}`);

          resolve({
            file: currentFile,
            totalRows: rowCount,
            processed: processedCount,
            errors: errors.length
          });

        } catch (error) {
          reject(error);
        }
      })
      .on('error', (error) => {
        reject(new Error(`Error leyendo archivo ${currentFile}: ${error.message}`));
      });
  });
}

/**
 * Procesar un lote de datos de tráfico (versión simplificada)
 */
async function processBatch(batch) {
  try {
    // Usar bulkWrite con upsert para manejar duplicados
    const bulkOperations = batch.map(record => ({
      updateOne: {
        filter: {
          puntoMedidaId: record.puntoMedidaId,
          fecha: record.fecha
        },
        update: { $set: record },
        upsert: true
      }
    }));

    const result = await Traffic.bulkWrite(bulkOperations, { ordered: false });

    // Contar correctamente nuevos vs actualizados
    const nuevos = result.upsertedCount || 0;
    const actualizados = result.modifiedCount || 0;
    const reconocidos = result.matchedCount || 0;

    totalInserted += nuevos;
    totalSkipped += actualizados;

    // Mostrar progreso solo si hay actividad significativa
    if (nuevos > 1000 || actualizados > 1000) {
      console.log(`   ✅ Lote: ${nuevos} nuevos, ${actualizados} actualizados`);
    }

    return { nuevos, actualizados, reconocidos };

  } catch (error) {
    console.error(`   ❌ Error insertando lote:`, error.message);
    return { nuevos: 0, actualizados: 0, reconocidos: 0 };
  }
}
/**
 * Obtener lista de archivos a procesar (TODOS los archivos de tráfico)
 */
async function getFilesToProcess() {
  try {
    console.log('📂 Buscando archivos de tráfico...');
    const files = await fs.readdir(DATA_DIR);
    const csvFiles = files.filter(file =>
      file.endsWith('.csv') &&
      file.includes('Traffic') &&
      !file.includes('sample') // Excluir archivos de muestra
    );

    console.log(`📋 Encontrados ${csvFiles.length} archivos: ${csvFiles.join(', ')}`);
    return csvFiles.sort(); // Procesar en orden

  } catch (error) {
    throw new Error(`Error accediendo al directorio de datos: ${error.message}`);
  }
}

/**
 * Función principal (versión simplificada)
 */
async function main() {
  const startTime = Date.now();

  try {
    console.log('🚦 INICIANDO IMPORTACIÓN COMPLETA DE DATOS DE TRÁFICO\n');
    console.log(`📊 Configuración:`);
    console.log(`   - Tamaño de lote: ${BATCH_SIZE}`);
    console.log(`   - Directorio de datos: ${DATA_DIR}`);
    console.log(`   - Procesamiento paralelo: ${MAX_PARALLEL} archivos simultáneos`);
    console.log('');

    // Conectar a base de datos
    if (!await connectDatabase()) {
      process.exit(1);
    }

    // Cargar puntos de medida
    const points = await loadTrafficPoints();
    for (const [id, point] of points) {
      pointsCache.set(id, point);
    }

    // Obtener archivos a procesar
    const filesToProcess = await getFilesToProcess();

    if (filesToProcess.length === 0) {
      console.log('❌ No hay archivos para procesar.');
      return;
    }

    console.log('🎯 INICIANDO PROCESAMIENTO PARALELO DE ARCHIVOS\n');

    // Procesar archivos en paralelo
    const fileResults = [];
    const processFile = async (fileName, index, total) => {
      const filePath = path.join(DATA_DIR, fileName);
      console.log(`\n📄 [${index + 1}/${total}] INICIANDO: ${fileName}`);

      try {
        const result = await processTrafficFile(filePath);
        console.log(`✅ [${index + 1}/${total}] COMPLETADO: ${fileName} - ${result.processed.toLocaleString()}/${result.totalRows.toLocaleString()} registros`);
        return result;
      } catch (error) {
        console.error(`❌ [${index + 1}/${total}] ERROR: ${fileName} - ${error.message}`);
        return {
          file: fileName,
          totalRows: 0,
          processed: 0,
          errors: 1,
          error: error.message
        };
      }
    };

    // Procesar en lotes paralelos
    for (let i = 0; i < filesToProcess.length; i += MAX_PARALLEL) {
      const batch = filesToProcess.slice(i, i + MAX_PARALLEL);
      console.log(`\n🔄 Procesando lote paralelo ${Math.floor(i/MAX_PARALLEL) + 1}/${Math.ceil(filesToProcess.length/MAX_PARALLEL)}: ${batch.join(', ')}`);

      const promises = batch.map((fileName, batchIndex) =>
        processFile(fileName, i + batchIndex, filesToProcess.length)
      );

      const batchResults = await Promise.all(promises);
      fileResults.push(...batchResults);

      console.log(`✅ Lote paralelo ${Math.floor(i/MAX_PARALLEL) + 1} completado. Progreso total: ${Math.min(i + MAX_PARALLEL, filesToProcess.length)}/${filesToProcess.length}`);
    }

    // Mostrar resumen final
    showSummary(startTime, fileResults);

  } catch (error) {
    console.error('\n💥 ERROR FATAL:', error.message);
    process.exit(1);

  } finally {
    // Cerrar conexión de forma segura
    if (mongoose.connection.readyState === 1) {
      try {
        await mongoose.connection.close();
        console.log('\n📋 Conexión a base de datos cerrada');
      } catch (error) {
        console.error('⚠️  Error cerrando conexión:', error.message);
      }
    }
  }
}

/**
 * Mostrar resumen final (versión simplificada)
 */
function showSummary(startTime, fileResults) {
  const endTime = Date.now();
  const duration = ((endTime - startTime) / 1000).toFixed(2);

  console.log('\n\n' + '='.repeat(80));
  console.log('🎉 RESUMEN FINAL DE IMPORTACIÓN DE TRÁFICO');
  console.log('='.repeat(80));
  console.log(`⏱️  Tiempo total: ${duration} segundos`);
  console.log(`📁 Archivos procesados: ${fileResults.length}`);
  console.log(`📊 Registros procesados: ${totalProcessed.toLocaleString()}`);
  console.log(`✅ Registros insertados: ${totalInserted.toLocaleString()}`);
  console.log(`🔄 Registros actualizados: ${totalSkipped.toLocaleString()}`);
  console.log(`❌ Errores encontrados: ${totalErrors.toLocaleString()}`);

  if (totalProcessed > 0) {
    console.log(`📈 Tasa de éxito: ${((totalInserted + totalSkipped) / totalProcessed * 100).toFixed(2)}%`);
    console.log(`⚡ Velocidad: ${(totalProcessed / parseFloat(duration)).toFixed(0)} registros/seg`);
  }

  console.log('\n📋 Detalle por archivo:');
  fileResults.forEach((result, i) => {
    const status = result.errors === 0 ? '✅' : result.error ? '❌' : '⚠️';
    console.log(`  ${status} ${result.file}: ${result.processed.toLocaleString()}/${result.totalRows.toLocaleString()} (${result.errors} errores)`);
  });

  console.log('='.repeat(80));
  console.log('🎯 IMPORTACIÓN COMPLETADA');
}

// Manejo de señales del sistema
process.on('SIGINT', async () => {
  console.log('\n\n🛑 Interrupción recibida. Cerrando conexiones...');
  if (mongoose.connection.readyState === 1) {
    await mongoose.connection.close();
  }
  process.exit(0);
});

process.on('uncaughtException', (error) => {
  console.error('💥 Error no capturado:', error.message);
  process.exit(1);
});

// Ejecutar script si es llamado directamente
if (require.main === module) {
  main().catch(error => {
    console.error('💥 Error ejecutando script:', error.message);
    process.exit(1);
  });
}

module.exports = { main, processTrafficFile, validateAndTransformRow };
