/**
 * Script de Importación de Calidad del Aire
 *
 * Script especializado para importar datos CSV de calidad del aire
 * desde los sensores distribuidos por la ciudad. Procesa todos los archivos
 * del directorio datos_hpe/Aire/ con procesamiento paralelo optimizado.
 *
 * Datos incluyen mediciones horarias de diferentes magnitudes:
 * - Partículas (PM2.5, PM10)
 * - Gases (NO2, SO2, O3, CO)
 * - Hidrocarburos y otros contaminantes
 *
 * Uso: node scripts/importation/importAirQuality.js [opciones]
 */

const fs = require('fs').promises;
const path = require('path');
const csv = require('csv-parser');
const { createReadStream } = require('fs');
const mongoose = require('mongoose');
const { connectDB } = require('../../src/config/database');
const config = require('../../src/config/config');
const AirQuality = require('../../src/models/AirQuality');

/**
 * Configuración del importador de calidad del aire
 */
const IMPORT_CONFIG = {
  dataDirectory: path.join(__dirname, '..', '..', 'datos_hpe', 'Aire'),
  batchSize: 500, // Optimizado para datos de aire (mediano tamaño)
  skipExisting: true,
  logInterval: 500, // Logs cada 500 registros
  maxParallel: 4, // Procesamiento paralelo (archivos más pequeños)
  maxRetries: 3,
  retryDelay: 2000
};

// Mapeo de meses en español a números
const MONTH_MAP = {
  'enero': 1, 'febrero': 2, 'marzo': 3, 'abril': 4,
  'mayo': 5, 'junio': 6, 'julio': 7, 'agosto': 8,
  'septiembre': 9, 'octubre': 10, 'noviembre': 11, 'diciembre': 12
};

// Validación de códigos de magnitud según documentación
const VALID_MAGNITUDES = new Set([1, 6, 7, 8, 9, 10, 12, 14, 20, 30, 35, 42, 43, 44]);

/**
 * Extraer mes del nombre del archivo
 * @param {string} fileName - Nombre del archivo (ej: Anthem_CTC_Aire_Enero.csv)
 * @returns {number|null} - Número del mes o null si no se puede determinar
 */
function extractMonthFromFileName(fileName) {
  try {
    const lowerFileName = fileName.toLowerCase();
    for (const [monthName, monthNumber] of Object.entries(MONTH_MAP)) {
      if (lowerFileName.includes(monthName)) {
        return monthNumber;
      }
    }
    return null;
  } catch (error) {
    console.warn(`⚠️  Error extrayendo mes del archivo ${fileName}:`, error.message);
    return null;
  }
}

/**
 * Parsear una fila de datos de calidad del aire
 * @param {Object} row - Fila del CSV
 * @param {string} sourceFile - Archivo origen
 * @returns {Object|null} - Datos procesados para AirQuality o null si es inválido
 */
function parseAirQualityRow(row, sourceFile) {
  try {
    // Validar campos obligatorios básicos
    if (!row.PROVINCIA || !row.MUNICIPIO || !row.ESTACION || !row.MAGNITUD) {
      return null;
    }

    // Parsear identificadores
    const provincia = parseInt(row.PROVINCIA);
    const municipio = parseInt(row.MUNICIPIO);
    const estacion = parseInt(row.ESTACION);
    const magnitud = parseInt(row.MAGNITUD);

    if (isNaN(provincia) || isNaN(municipio) || isNaN(estacion) || isNaN(magnitud)) {
      return null;
    }

    // Validar magnitud
    if (!VALID_MAGNITUDES.has(magnitud)) {
      console.warn(`⚠️  Magnitud inválida (${magnitud}) en archivo ${sourceFile}`);
      return null;
    }

    // Obtener punto de muestreo
    const puntoMuestreo = row.PUNTO_MUESTREO?.toString().trim();
    if (!puntoMuestreo) {
      return null;
    }

    // Parsear fecha
    const año = parseInt(row.ANO);
    const mes = parseInt(row.MES);
    const dia = parseInt(row.DIA);

    if (isNaN(año) || isNaN(mes) || isNaN(dia)) {
      return null;
    }

    // Validar fecha
    if (año < 2000 || año > 3000 || mes < 1 || mes > 12 || dia < 1 || dia > 31) {
      return null;
    }

    // Crear fecha
    const fecha = new Date(año, mes - 1, dia);
    if (isNaN(fecha.getTime())) {
      return null;
    }

    // Procesar mediciones horarias (H01-H24 con V01-V24)
    const medicionesHorarias = new Map();
    let validMeasurements = 0;

    for (let hour = 1; hour <= 24; hour++) {
      const hourKey = `H${hour.toString().padStart(2, '0')}`;
      const validationKey = `V${hour.toString().padStart(2, '0')}`;

      const hourValue = row[hourKey];
      const validationCode = row[validationKey];

      // Valor por defecto para mediciones faltantes
      const measurement = {
        value: null,
        validationCode: 'N'
      };

      if (hourValue !== undefined && hourValue !== null && hourValue !== '') {
        const numericValue = parseFloat(hourValue);

        if (!isNaN(numericValue) && numericValue >= 0) {
          measurement.value = numericValue;
        }
      }

      // Código de validación (V = válido, N = no válido)
      if (validationCode === 'V' || validationCode === 'N') {
        measurement.validationCode = validationCode;

        if (validationCode === 'V' && measurement.value !== null) {
          validMeasurements++;
        }
      }

      medicionesHorarias.set(hourKey, measurement);
    }

    // Verificar que tenemos las 24 mediciones
    if (medicionesHorarias.size !== 24) {
      console.warn(`⚠️  Mediciones horarias incompletas en archivo ${sourceFile}`);
      return null;
    }

    // Calcular score de calidad de datos
    const dataQualityScore = validMeasurements / 24;

    // Construir objeto de datos
    const airQualityData = {
      provincia,
      municipio,
      estacion,
      magnitud,
      puntoMuestreo,
      fecha,
      medicionesHorarias,
      processingMetadata: {
        importedAt: new Date(),
        validMeasurements,
        dataQualityScore
      }
    };

    return airQualityData;

  } catch (error) {
    console.error(`Error procesando fila del archivo ${sourceFile}:`, error.message);
    return null;
  }
}

/**
 * Procesar un archivo CSV de calidad del aire
 * @param {string} filePath - Ruta al archivo CSV
 * @param {Object} options - Opciones de procesamiento
 * @returns {Promise<Object>} - Estadísticas de procesamiento
 */
async function processAirQualityFile(filePath, options = {}) {
  const fileName = path.basename(filePath);
  console.log(`\n🌬️  Procesando archivo: ${fileName}`);

  return new Promise((resolve, reject) => {
    const stats = {
      fileName,
      totalRows: 0,
      processedRows: 0,
      errorRows: 0,
      emptyRows: 0,
      insertedRecords: 0,
      skippedRecords: 0,
      duplicateErrors: 0,
      errors: []
    };

    const batch = [];
    let isProcessing = false;

    const stream = createReadStream(filePath)
      .pipe(csv({ separator: ';' }))
      .on('data', async (row) => {
        if (isProcessing) {return;}

        stats.totalRows++;

        try {
          const airQualityData = parseAirQualityRow(row, fileName);

          if (airQualityData) {
            batch.push(airQualityData);
            stats.processedRows++;

            // Procesar lote cuando alcance el tamaño configurado
            if (batch.length >= options.batchSize) {
              stream.pause();
              isProcessing = true;

              try {
                await processBatch(batch, options, stats);
                batch.length = 0;
              } catch (error) {
                console.error(`   ❌ Error procesando lote:`, error.message);
                stats.errorRows++;
              } finally {
                isProcessing = false;
                stream.resume();
              }
            }
          } else {
            stats.emptyRows++;
          }

          // Log de progreso menos frecuente
          if (stats.totalRows % options.logInterval === 0) {
            console.log(`   📊 Procesadas ${stats.totalRows.toLocaleString()} filas, ${stats.processedRows.toLocaleString()} válidas...`);
          }

        } catch (error) {
          stats.errorRows++;
          stats.errors.push({
            row: stats.totalRows,
            error: error.message
          });

          // Limitar errores almacenados
          if (stats.errors.length > 100) {
            stats.errors = stats.errors.slice(-50);
          }
        }
      })
      .on('end', async () => {
        try {
          // Procesar lote restante
          if (batch.length > 0) {
            console.log(`   💾 Procesando lote final de ${batch.length} registros...`);
            await processBatch(batch, options, stats);
          }

          console.log(`✅ Archivo completado: ${fileName}`);
          console.log(`   📊 Total filas: ${stats.totalRows.toLocaleString()}`);
          console.log(`   ✅ Procesadas: ${stats.processedRows.toLocaleString()}`);
          console.log(`   🈳 Vacías/Inválidas: ${stats.emptyRows.toLocaleString()}`);
          console.log(`   ❌ Errores: ${stats.errorRows.toLocaleString()}`);
          console.log(`   💾 Insertadas: ${stats.insertedRecords.toLocaleString()}`);
          console.log(`   ⏭️  Omitidas: ${stats.skippedRecords.toLocaleString()}`);
          if (stats.duplicateErrors > 0) {
            console.log(`   🔄 Duplicados: ${stats.duplicateErrors.toLocaleString()}`);
          }

          resolve(stats);
        } catch (error) {
          reject(error);
        }
      })
      .on('error', (error) => {
        console.error(`❌ Error leyendo archivo ${fileName}:`, error.message);
        reject(error);
      });
  });
}

/**
 * Procesar un lote de datos de calidad del aire con bulkWrite optimizado
 * @param {Array} batch - Lote de datos
 * @param {Object} options - Opciones de procesamiento
 * @param {Object} stats - Estadísticas de procesamiento
 */
async function processBatch(batch, options, stats) {
  let retries = 0;
  const maxRetries = options.maxRetries || 3;

  while (retries < maxRetries) {
    try {
      if (options.skipExisting) {
        // Usar bulkWrite con manejo de duplicados
        const operations = batch.map(airQualityData => ({
          insertOne: {
            document: airQualityData
          }
        }));

        try {
          const result = await AirQuality.bulkWrite(operations, {
            ordered: false,
            bypassDocumentValidation: false
          });

          stats.insertedRecords += result.insertedCount || 0;
          return; // Éxito, salir del bucle de reintentos

        } catch (bulkError) {
          // Manejar errores específicos de bulkWrite
          if (!bulkError.writeErrors) {
            throw bulkError; // Re-lanzar si no es error de escritura manejable
          }

          // Contar duplicados y otros errores
          let duplicates = 0;
          let otherErrors = 0;

          bulkError.writeErrors.forEach(error => {
            if (error.code === 11000) { // Duplicate key
              duplicates++;
            } else {
              otherErrors++;
              console.warn(`   ⚠️  Error inserción: ${error.errmsg}`);
            }
          });

          stats.skippedRecords += duplicates;
          stats.duplicateErrors += duplicates;
          stats.errorRows += otherErrors;
          stats.insertedRecords += (batch.length - duplicates - otherErrors);
        }
      } else {
        // Usar upsert para sobrescribir existentes
        const operations = batch.map(airQualityData => ({
          updateOne: {
            filter: {
              provincia: airQualityData.provincia,
              municipio: airQualityData.municipio,
              estacion: airQualityData.estacion,
              magnitud: airQualityData.magnitud,
              fecha: airQualityData.fecha
            },
            update: { $set: airQualityData },
            upsert: true
          }
        }));

        const result = await AirQuality.bulkWrite(operations, {
          ordered: false,
          bypassDocumentValidation: false
        });

        stats.insertedRecords += (result.upsertedCount || 0) + (result.modifiedCount || 0);
        stats.skippedRecords += (result.matchedCount || 0) - (result.modifiedCount || 0);
      }

      return; // Éxito, salir del bucle de reintentos

    } catch (error) {
      retries++;
      console.error(`   ❌ Error en lote (intento ${retries}/${maxRetries}):`, error.message);

      if (retries < maxRetries) {
        console.log(`   🔄 Reintentando en ${options.retryDelay || 2000}ms...`);
        await new Promise(resolve => setTimeout(resolve, options.retryDelay || 2000));
      } else {
        console.error(`   💥 Lote fallido después de ${maxRetries} intentos`);
        stats.errorRows += batch.length;
        throw error;
      }
    }
  }
}

/**
 * Importar todos los archivos de calidad del aire con procesamiento paralelo
 * @param {Object} options - Opciones de importación
 * @returns {Promise<Object>} - Estadísticas finales
 */
async function importAirQualityData(options = {}) {
  const importConfig = { ...IMPORT_CONFIG, ...options };

  console.log('🌬️  Iniciando importación de datos de calidad del aire...');
  console.log(`📁 Directorio: ${importConfig.dataDirectory}`);
  console.log(`🔄 Procesamiento paralelo: ${importConfig.maxParallel} archivos simultáneos`);

  try {
    // Verificar que existe el directorio
    const dirStats = await fs.stat(importConfig.dataDirectory);
    if (!dirStats.isDirectory()) {
      throw new Error(`No se encontró el directorio: ${importConfig.dataDirectory}`);
    }

    // Obtener lista de archivos CSV
    const files = await fs.readdir(importConfig.dataDirectory);
    const csvFiles = files
      .filter(file => file.endsWith('.csv') && file.includes('Aire'))
      .sort();

    if (csvFiles.length === 0) {
      throw new Error('No se encontraron archivos CSV de calidad del aire');
    }

    console.log(`📄 Archivos encontrados: ${csvFiles.length}`);
    csvFiles.forEach(file => {
      const month = extractMonthFromFileName(file);
      console.log(`   - ${file}${month ? ` (mes ${month})` : ''}`);
    });

    const globalStats = {
      startTime: new Date(),
      totalFiles: csvFiles.length,
      completedFiles: 0,
      totalRows: 0,
      processedRows: 0,
      emptyRows: 0,
      errorRows: 0,
      insertedRecords: 0,
      skippedRecords: 0,
      duplicateErrors: 0,
      fileStats: []
    };

    // Procesar archivos en paralelo
    const maxParallel = importConfig.maxParallel;
    const processFile = async (file, index, total) => {
      const filePath = path.join(importConfig.dataDirectory, file);
      console.log(`\n🔄 [${index + 1}/${total}] INICIANDO: ${file}`);

      try {
        const fileStats = await processAirQualityFile(filePath, config);
        console.log(`✅ [${index + 1}/${total}] COMPLETADO: ${file} - ${fileStats.insertedRecords.toLocaleString()} registros insertados`);
        return fileStats;
      } catch (error) {
        console.error(`❌ [${index + 1}/${total}] ERROR: ${file} - ${error.message}`);
        return {
          fileName: file,
          totalRows: 0,
          processedRows: 0,
          errorRows: 1,
          emptyRows: 0,
          insertedRecords: 0,
          skippedRecords: 0,
          duplicateErrors: 0,
          errors: [error.message]
        };
      }
    };

    // Procesar en lotes paralelos
    for (let i = 0; i < csvFiles.length; i += maxParallel) {
      const batch = csvFiles.slice(i, i + maxParallel);
      console.log(`\n🔄 Procesando lote paralelo ${Math.floor(i/maxParallel) + 1}/${Math.ceil(csvFiles.length/maxParallel)}: ${batch.join(', ')}`);

      const promises = batch.map((file, batchIndex) =>
        processFile(file, i + batchIndex, csvFiles.length)
      );

      const batchResults = await Promise.all(promises);

      // Acumular estadísticas
      batchResults.forEach(fileStats => {
        globalStats.fileStats.push(fileStats);
        globalStats.completedFiles++;
        globalStats.totalRows += fileStats.totalRows;
        globalStats.processedRows += fileStats.processedRows;
        globalStats.emptyRows += fileStats.emptyRows;
        globalStats.errorRows += fileStats.errorRows;
        globalStats.insertedRecords += fileStats.insertedRecords;
        globalStats.skippedRecords += fileStats.skippedRecords;
        globalStats.duplicateErrors += fileStats.duplicateErrors || 0;
      });

      console.log(`✅ Lote paralelo ${Math.floor(i/maxParallel) + 1} completado. Progreso: ${Math.min(i + maxParallel, csvFiles.length)}/${csvFiles.length}`);

      // Breve pausa entre lotes para liberar recursos
      if (i + maxParallel < csvFiles.length) {
        console.log(`⏸️  Pausa de 3 segundos...`);
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }

    globalStats.endTime = new Date();
    globalStats.duration = globalStats.endTime - globalStats.startTime;

    return globalStats;

  } catch (error) {
    console.error('❌ Error en importación de calidad del aire:', error.message);
    throw error;
  }
}

/**
 * Generar resumen estadístico post-importación
 */
async function generatePostImportSummary() {
  console.log('\n📈 Generando resumen estadístico de calidad del aire...');

  try {
    const totalRecords = await AirQuality.countDocuments();
    console.log(`📊 Total de registros de calidad del aire: ${totalRecords.toLocaleString()}`);

    // Distribución por magnitud
    const magnitudeDistribution = await AirQuality.aggregate([
      {
        $group: {
          _id: '$magnitud',
          totalRegistros: { $sum: 1 },
          promedioCalidad: { $avg: '$processingMetadata.dataQualityScore' },
          estacionesUnicas: { $addToSet: '$puntoMuestreo' }
        }
      },
      { $sort: { totalRegistros: -1 } }
    ]);

    const magnitudeNames = AirQuality.getMagnitudes();

    console.log('\n🧪 Distribución por tipo de contaminante:');
    magnitudeDistribution.forEach(mag => {
      const name = magnitudeNames[mag._id] || `Magnitud ${mag._id}`;
      const quality = (mag.promedioCalidad * 100).toFixed(1);
      console.log(`   ${name}: ${mag.totalRegistros.toLocaleString()} registros, ${mag.estacionesUnicas.length} estaciones, ${quality}% calidad`);
    });

    // Distribución temporal
    const temporalDistribution = await AirQuality.aggregate([
      {
        $group: {
          _id: {
            año: { $year: '$fecha' },
            mes: { $month: '$fecha' }
          },
          totalRegistros: { $sum: 1 },
          magnitudesUnicas: { $addToSet: '$magnitud' }
        }
      },
      { $sort: { '_id.año': 1, '_id.mes': 1 } }
    ]);

    console.log('\n📅 Distribución temporal:');
    temporalDistribution.forEach(period => {
      const monthNames = ['', 'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun',
                         'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
      const monthName = monthNames[period._id.mes];
      console.log(`   ${monthName} ${period._id.año}: ${period.totalRegistros.toLocaleString()} registros, ${period.magnitudesUnicas.length} contaminantes`);
    });

    // Top estaciones con más datos
    const topStations = await AirQuality.aggregate([
      {
        $group: {
          _id: {
            estacion: '$estacion',
            puntoMuestreo: '$puntoMuestreo'
          },
          totalRegistros: { $sum: 1 },
          magnitudesUnicas: { $addToSet: '$magnitud' },
          promedioCalidad: { $avg: '$processingMetadata.dataQualityScore' }
        }
      },
      { $sort: { totalRegistros: -1 } },
      { $limit: 10 }
    ]);

    console.log('\n🏭 Top 10 estaciones con más datos:');
    topStations.forEach((station, index) => {
      const quality = (station.promedioCalidad * 100).toFixed(1);
      console.log(`   ${index + 1}. Estación ${station._id.estacion} (${station._id.puntoMuestreo}): ${station.totalRegistros.toLocaleString()} registros, ${station.magnitudesUnicas.length} contaminantes, ${quality}% calidad`);
    });

    // Análisis de calidad de datos
    const qualityAnalysis = await AirQuality.aggregate([
      {
        $group: {
          _id: null,
          totalRegistros: { $sum: 1 },
          promedioCalidad: { $avg: '$processingMetadata.dataQualityScore' },
          registrosAltaCalidad: {
            $sum: { $cond: [{ $gte: ['$processingMetadata.dataQualityScore', 0.8] }, 1, 0] }
          },
          registrosMediaCalidad: {
            $sum: { $cond: [{ $and: [
              { $gte: ['$processingMetadata.dataQualityScore', 0.5] },
              { $lt: ['$processingMetadata.dataQualityScore', 0.8] }
            ]}, 1, 0] }
          },
          registrosBajaCalidad: {
            $sum: { $cond: [{ $lt: ['$processingMetadata.dataQualityScore', 0.5] }, 1, 0] }
          }
        }
      }
    ]);

    if (qualityAnalysis[0]) {
      const qa = qualityAnalysis[0];
      console.log('\n📊 Análisis de calidad de datos:');
      console.log(`   Promedio de calidad: ${(qa.promedioCalidad * 100).toFixed(1)}%`);
      console.log(`   Alta calidad (≥80%): ${qa.registrosAltaCalidad.toLocaleString()} (${(qa.registrosAltaCalidad/qa.totalRegistros*100).toFixed(1)}%)`);
      console.log(`   Media calidad (50-79%): ${qa.registrosMediaCalidad.toLocaleString()} (${(qa.registrosMediaCalidad/qa.totalRegistros*100).toFixed(1)}%)`);
      console.log(`   Baja calidad (<50%): ${qa.registrosBajaCalidad.toLocaleString()} (${(qa.registrosBajaCalidad/qa.totalRegistros*100).toFixed(1)}%)`);
    }

  } catch (error) {
    console.error('❌ Error generando resumen estadístico:', error.message);
  }
}

/**
 * Función principal del script
 */
async function main() {
  const args = process.argv.slice(2);
  const options = {
    skipExisting: !args.includes('--force'),
    batchSize: args.find(arg => arg.startsWith('--batch='))?.split('=')[1] || IMPORT_CONFIG.batchSize,
    maxParallel: args.find(arg => arg.startsWith('--parallel='))?.split('=')[1] || IMPORT_CONFIG.maxParallel,
    generateSummary: !args.includes('--no-summary')
  };

  console.log('🌬️  Script de Importación de Calidad del Aire');
  console.log('📊 Configuración:');
  console.log(`   - Omitir existentes: ${options.skipExisting ? 'Sí' : 'No'}`);
  console.log(`   - Tamaño de lote: ${options.batchSize}`);
  console.log(`   - Procesamiento paralelo: ${options.maxParallel} archivos`);

  let connection;

  try {
    // Conectar a MongoDB
    console.log('\n🔄 Conectando a MongoDB...');
    connection = await connectDB(config.database.uri);
    console.log('✅ Conectado a la base de datos');

    // Verificar modelo y datos actuales
    console.log('🔄 Verificando modelo de calidad del aire...');
    const airQualityCount = await AirQuality.countDocuments();
    console.log(`📊 Registros actuales: ${airQualityCount.toLocaleString()}`);

    // Ejecutar importación
    const result = await importAirQualityData(options);

    // Mostrar resultados finales
    console.log('\n🎉 Importación de calidad del aire completada!');
    console.log(`⏱️  Tiempo total: ${(result.duration / 1000).toFixed(2)} segundos`);
    console.log(`📁 Archivos procesados: ${result.completedFiles}/${result.totalFiles}`);
    console.log(`📊 Total filas procesadas: ${result.totalRows.toLocaleString()}`);
    console.log(`✅ Registros válidos: ${result.processedRows.toLocaleString()}`);
    console.log(`💾 Registros insertados: ${result.insertedRecords.toLocaleString()}`);
    console.log(`⏭️  Registros omitidos: ${result.skippedRecords.toLocaleString()}`);
    console.log(`🈳 Filas inválidas: ${result.emptyRows.toLocaleString()}`);
    console.log(`❌ Errores: ${result.errorRows.toLocaleString()}`);
    if (result.duplicateErrors > 0) {
      console.log(`🔄 Duplicados: ${result.duplicateErrors.toLocaleString()}`);
    }

    // Estadísticas finales de la base de datos
    const finalCount = await AirQuality.countDocuments();
    console.log(`\n📈 Total de registros de calidad del aire: ${finalCount.toLocaleString()}`);

    // Generar resumen estadístico
    if (options.generateSummary) {
      await generatePostImportSummary();
    }

  } catch (error) {
    console.error('\n❌ Error durante la importación:');
    console.error(`   Mensaje: ${error.message}`);
    process.exit(1);

  } finally {
    if (connection) {
      console.log('\n🔄 Cerrando conexión...');
      try {
        await mongoose.connection.close();
        console.log('✅ Conexión cerrada');
      } catch (error) {
        console.error('⚠️  Error cerrando conexión:', error.message);
      }
    }
  }

  console.log('\n👋 Script completado');
}

// Ejecutar si es llamado directamente
if (require.main === module) {
  main().catch(error => {
    console.error('❌ Error fatal:', error);
    process.exit(1);
  });
}

module.exports = {
  importAirQualityData,
  parseAirQualityRow
};
