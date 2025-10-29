/**
 * Script de Importación de Contaminación Acústica
 *
 * Script especializado para importar datos CSV de contaminación acústica
 * a la base de datos MongoDB. Procesa el archivo datos_hpe/Anthem_CTC_ContaminacionAcustica.csv
 *
 * Uso:
 *   node scripts/importNoise.js [--force] [--batch=N] [--station=NMT] [--help]
 */

const fs = require('fs').promises;
const path = require('path');
const csv = require('csv-parser');
const { createReadStream } = require('fs');
const mongoose = require('mongoose');
const { connectDB } = require('../../src/config/database');
const config = require('../../src/config/config');
const NoiseMonitoring = require('../../src/models/NoiseMonitoring');

/**
 * Configuración del importador de contaminación acústica
 */
const IMPORT_CONFIG = {
  dataDirectory: path.join(__dirname, '..', '..', 'datos_hpe'),
  fileName: 'Anthem_CTC_ContaminacionAcustica.csv',
  batchSize: 50,
  skipExisting: true,
  logInterval: 500
};

/**
 * Mostrar ayuda del script
 */
function showHelp() {
  console.log(`
🔊 Script de Importación de Contaminación Acústica

Uso: node scripts/importNoise.js [opciones]

Opciones:
  --force         Sobrescribir datos existentes (upsert)
  --batch=N       Tamaño del lote para inserción (por defecto: 50)
  --station=NMT   Importar solo una estación específica (NMT)
  --year=YYYY     Importar solo un año específico
  --month=MM      Importar solo un mes específico (01-12)
  --validate      Solo validar archivo sin importar
  --help          Mostrar esta ayuda

Ejemplos:
  node scripts/importNoise.js                    # Importar todos los datos
  node scripts/importNoise.js --station=1        # Solo estación NMT 1
  node scripts/importNoise.js --force            # Con sobreescritura
  node scripts/importNoise.js --validate         # Solo validar datos
  `);
}

/**
 * Parsear argumentos de línea de comandos
 */
function parseArguments() {
  const args = process.argv.slice(2);
  const options = {
    skipExisting: true,
    batchSize: IMPORT_CONFIG.batchSize,
    targetStation: null,
    targetYear: null,
    targetMonth: null,
    validateOnly: false,
    showHelp: false
  };

  for (const arg of args) {
    if (arg === '--help') {
      options.showHelp = true;
    } else if (arg === '--force') {
      options.skipExisting = false;
    } else if (arg === '--validate') {
      options.validateOnly = true;
    } else if (arg.startsWith('--batch=')) {
      const batchValue = parseInt(arg.split('=')[1]);
      if (!isNaN(batchValue) && batchValue > 0) {
        options.batchSize = batchValue;
      }
    } else if (arg.startsWith('--station=')) {
      const stationValue = parseInt(arg.split('=')[1]);
      if (!isNaN(stationValue) && stationValue > 0) {
        options.targetStation = stationValue;
      }
    } else if (arg.startsWith('--year=')) {
      const yearValue = parseInt(arg.split('=')[1]);
      if (!isNaN(yearValue) && yearValue >= 2000 && yearValue <= 3000) {
        options.targetYear = yearValue;
      }
    } else if (arg.startsWith('--month=')) {
      const monthValue = parseInt(arg.split('=')[1]);
      if (!isNaN(monthValue) && monthValue >= 1 && monthValue <= 12) {
        options.targetMonth = monthValue;
      }
    }
  }

  return options;
}

/**
 * Parsear datos de una fila CSV de contaminación acústica
 * @param {Object} row - Fila del CSV
 * @param {string} sourceFile - Archivo origen
 * @returns {Object|null} - Datos procesados o null si es inválido
 */
function parseNoiseRow(row, sourceFile) {
  try {
    // Parsear fecha en formato "ene-51", "feb-51", etc.
    const fechaStr = row.Fecha;
    if (!fechaStr) {return null;}

    // Mapeo de meses en español
    const meses = {
      'ene': 1, 'feb': 2, 'mar': 3, 'abr': 4, 'may': 5, 'jun': 6,
      'jul': 7, 'ago': 8, 'sep': 9, 'oct': 10, 'nov': 11, 'dic': 12
    };

    const [mesStr, añoStr] = fechaStr.split('-');
    const mes = meses[mesStr.toLowerCase()];
    const año = parseInt('20' + añoStr); // "51" -> 2051

    if (!mes || !año) {return null;}

    // Parsear NMT
    const nmt = parseInt(row.NMT);
    if (isNaN(nmt)) {return null;}

    // Crear fecha (primer día del mes)
    const fecha = new Date(año, mes - 1, 1);
    if (isNaN(fecha.getTime())) {return null;}

    // Obtener nombre de la estación
    const nombre = (row.Nombre || `Estación ${nmt}`).toString().trim();

    // Función para parsear valores con coma como decimal y manejar N/D
    const parseNoiseLevel = (value) => {
      if (!value || value.toString().trim() === '' || value.toString().trim() === 'N/D') {return null;}
      const parsed = parseFloat(value.toString().replace(',', '.'));
      return (isNaN(parsed) || parsed < 0 || parsed > 150) ? null : parsed;
    };

    const nivelDiurno = parseNoiseLevel(row.Ld);
    const nivelVespertino = parseNoiseLevel(row.Le);
    const nivelNocturno = parseNoiseLevel(row.Ln);
    const laeq24 = parseNoiseLevel(row.LAeq24);

    // Parsear percentiles
    const percentiles = {
      las01: parseNoiseLevel(row.LAS01),
      las10: parseNoiseLevel(row.LAS10),
      las50: parseNoiseLevel(row.LAS50),
      las90: parseNoiseLevel(row.LAS90),
      las99: parseNoiseLevel(row.LAS99)
    };

    // Verificar que hay al menos un nivel válido
    const hasValidData = nivelDiurno !== null || nivelVespertino !== null ||
                        nivelNocturno !== null || laeq24 !== null;

    if (!hasValidData) {
      return null;
    }

    return {
      fecha,
      mes,
      año,
      nmt,
      nombre,
      nivelDiurno,
      nivelVespertino,
      nivelNocturno,
      laeq24,
      percentiles,
      processingInfo: {
        sourceFile
      }
    };

  } catch (error) {
    console.error(`Error procesando fila de ${sourceFile}:`, error);
    return null;
  }
}

/**
 * Procesar el archivo CSV de contaminación acústica
 * @param {string} filePath - Ruta al archivo CSV
 * @param {Object} options - Opciones de procesamiento
 * @returns {Promise<Object>} - Estadísticas de procesamiento
 */
async function processNoiseFile(filePath, options = {}) {
  const fileName = path.basename(filePath);
  console.log(`\n🔊 Procesando archivo: ${fileName}`);

  return new Promise((resolve, reject) => {
    const stats = {
      fileName,
      totalRows: 0,
      processedRows: 0,
      errorRows: 0,
      emptyRows: 0,
      insertedRecords: 0,
      skippedRecords: 0,
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
          const noiseData = parseNoiseRow(row, fileName);

          if (noiseData) {
            // Aplicar filtros opcionales
            if (options.targetStation && noiseData.nmt !== options.targetStation) {
              return;
            }
            if (options.targetYear && noiseData.año !== options.targetYear) {
              return;
            }
            if (options.targetMonth && noiseData.mes !== options.targetMonth) {
              return;
            }

            if (!options.validateOnly) {
              batch.push(noiseData);
              stats.processedRows++;

              // Procesar lote cuando alcance el tamaño configurado
              if (batch.length >= options.batchSize) {
                stream.pause();
                isProcessing = true;

                try {
                  await processBatch(batch, options, stats);
                  batch.length = 0;
                } catch (error) {
                  console.error('Error procesando lote:', error);
                  stats.errorRows++;
                } finally {
                  isProcessing = false;
                  stream.resume();
                }
              }
            } else {
              stats.processedRows++;
            }
          } else {
            stats.emptyRows++;
          }

          // Log de progreso
          if (stats.totalRows % options.logInterval === 0) {
            console.log(`   📊 Procesadas ${stats.totalRows} filas, ${stats.processedRows} válidas...`);
          }

        } catch (error) {
          stats.errorRows++;
          stats.errors.push({
            row: stats.totalRows,
            error: error.message
          });
        }
      })
      .on('end', async () => {
        try {
          // Procesar lote restante
          if (batch.length > 0 && !options.validateOnly) {
            await processBatch(batch, options, stats);
          }

          console.log(`✅ Archivo completado: ${fileName}`);
          console.log(`   📊 Total filas: ${stats.totalRows}`);
          console.log(`   ✅ Procesadas: ${stats.processedRows}`);
          console.log(`   🈳 Vacías: ${stats.emptyRows}`);
          console.log(`   ❌ Errores: ${stats.errorRows}`);
          if (!options.validateOnly) {
            console.log(`   💾 Insertadas: ${stats.insertedRecords}`);
            console.log(`   ⏭️  Omitidas: ${stats.skippedRecords}`);
          }

          resolve(stats);
        } catch (error) {
          reject(error);
        }
      })
      .on('error', (error) => {
        console.error(`❌ Error leyendo archivo ${fileName}:`, error);
        reject(error);
      });
  });
}

/**
 * Procesar un lote de datos de contaminación acústica
 * @param {Array} batch - Lote de datos
 * @param {Object} options - Opciones de procesamiento
 * @param {Object} stats - Estadísticas de procesamiento
 */
async function processBatch(batch, options, stats) {
  try {
    if (options.skipExisting) {
      // Insertar solo si no existen registros duplicados
      for (const noiseData of batch) {
        try {
          const noiseMonitoring = new NoiseMonitoring(noiseData);
          await noiseMonitoring.save();
          stats.insertedRecords++;
        } catch (error) {
          if (error.code === 11000) {
            // Registro duplicado
            stats.skippedRecords++;
          } else {
            console.error(`Error insertando registro de contaminación acústica:`, error.message);
            stats.errorRows++;
          }
        }
      }
    } else {
      // Usar upsert para sobrescribir existentes
      const operations = batch.map(noiseData => ({
        updateOne: {
          filter: {
            nmt: noiseData.nmt,
            año: noiseData.año,
            mes: noiseData.mes
          },
          update: { $set: noiseData },
          upsert: true
        }
      }));

      const result = await NoiseMonitoring.bulkWrite(operations, { ordered: false });
      stats.insertedRecords += result.upsertedCount + result.modifiedCount;
      stats.skippedRecords += result.matchedCount - result.modifiedCount;
    }

  } catch (error) {
    console.error('Error procesando lote de contaminación acústica:', error);
    throw error;
  }
}

/**
 * Importar datos de contaminación acústica
 * @param {Object} options - Opciones de importación
 * @returns {Promise<Object>} - Estadísticas finales
 */
async function importNoiseData(options = {}) {
  const config = { ...IMPORT_CONFIG, ...options };

  console.log('🔊 Iniciando importación de datos de contaminación acústica...');

  try {
    const filePath = path.join(config.dataDirectory, config.fileName);

    // Verificar que existe el archivo
    try {
      await fs.stat(filePath);
    } catch (error) {
      throw new Error(`No se encontró el archivo: ${filePath}`);
    }

    console.log(`📄 Archivo encontrado: ${config.fileName}`);

    const globalStats = {
      startTime: new Date(),
      totalFiles: 1,
      completedFiles: 0,
      totalRows: 0,
      processedRows: 0,
      emptyRows: 0,
      errorRows: 0,
      insertedRecords: 0,
      skippedRecords: 0,
      fileStats: []
    };

    // Procesar archivo
    try {
      const fileStats = await processNoiseFile(filePath, config);
      globalStats.fileStats.push(fileStats);
      globalStats.completedFiles++;
      globalStats.totalRows += fileStats.totalRows;
      globalStats.processedRows += fileStats.processedRows;
      globalStats.emptyRows += fileStats.emptyRows;
      globalStats.errorRows += fileStats.errorRows;
      globalStats.insertedRecords += fileStats.insertedRecords;
      globalStats.skippedRecords += fileStats.skippedRecords;

    } catch (error) {
      console.error(`❌ Error procesando archivo ${config.fileName}:`, error);
      globalStats.errorRows++;
    }

    globalStats.endTime = new Date();
    globalStats.duration = globalStats.endTime - globalStats.startTime;

    return globalStats;

  } catch (error) {
    console.error('❌ Error en importación de contaminación acústica:', error);
    throw error;
  }
}

/**
 * Generar resumen estadístico post-importación
 */
async function generatePostImportSummary() {
  console.log('\n📈 Generando resumen estadístico...');

  try {
    const totalRecords = await NoiseMonitoring.countDocuments();
    console.log(`📊 Total de registros de contaminación acústica: ${totalRecords.toLocaleString()}`);

    // Distribución por año
    const yearDistribution = await NoiseMonitoring.aggregate([
      {
        $group: {
          _id: '$año',
          totalRegistros: { $sum: 1 },
          estacionesUnicas: { $addToSet: '$nmt' }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    console.log('\n📅 Distribución por año:');
    yearDistribution.forEach(year => {
      console.log(`   ${year._id}: ${year.totalRegistros.toLocaleString()} registros, ${year.estacionesUnicas.length} estaciones`);
    });

    // Distribución por estación
    const stationDistribution = await NoiseMonitoring.aggregate([
      {
        $group: {
          _id: {
            nmt: '$nmt',
            nombre: '$nombre'
          },
          totalRegistros: { $sum: 1 },
          promedioLaeq24: { $avg: '$laeq24' },
          promedioCalidad: { $avg: '$dataQuality.qualityScore' }
        }
      },
      { $sort: { totalRegistros: -1 } },
      { $limit: 10 }
    ]);

    console.log('\n🏭 Top 10 estaciones con más registros:');
    stationDistribution.forEach((station, index) => {
      const avgNoise = station.promedioLaeq24 ? station.promedioLaeq24.toFixed(1) : 'N/A';
      const quality = station.promedioCalidad ? (station.promedioCalidad * 100).toFixed(1) : 'N/A';
      console.log(`   ${index + 1}. ${station._id.nombre} (NMT ${station._id.nmt}): ${station.totalRegistros.toLocaleString()} registros, ${avgNoise} dB promedio, ${quality}% calidad`);
    });

    // Análisis de cumplimiento normativo
    const complianceAnalysis = await NoiseMonitoring.aggregate([
      {
        $match: {
          $or: [
            { nivelDiurno: { $exists: true, $ne: null } },
            { nivelVespertino: { $exists: true, $ne: null } },
            { nivelNocturno: { $exists: true, $ne: null } }
          ]
        }
      },
      {
        $group: {
          _id: null,
          registrosConDiurno: {
            $sum: { $cond: [{ $ne: ['$nivelDiurno', null] }, 1, 0] }
          },
          excesoDiurno: {
            $sum: { $cond: [{ $gt: ['$nivelDiurno', 65] }, 1, 0] }
          },
          registrosConVespertino: {
            $sum: { $cond: [{ $ne: ['$nivelVespertino', null] }, 1, 0] }
          },
          excesoVespertino: {
            $sum: { $cond: [{ $gt: ['$nivelVespertino', 65] }, 1, 0] }
          },
          registrosConNocturno: {
            $sum: { $cond: [{ $ne: ['$nivelNocturno', null] }, 1, 0] }
          },
          excesoNocturno: {
            $sum: { $cond: [{ $gt: ['$nivelNocturno', 55] }, 1, 0] }
          }
        }
      }
    ]);

    if (complianceAnalysis[0]) {
      const compliance = complianceAnalysis[0];
      console.log('\n🎯 Análisis de cumplimiento normativo (límites ejemplo):');

      if (compliance.registrosConDiurno > 0) {
        const pctExceso = (compliance.excesoDiurno / compliance.registrosConDiurno * 100).toFixed(1);
        console.log(`   Periodo diurno: ${compliance.excesoDiurno}/${compliance.registrosConDiurno} (${pctExceso}%) superan 65 dB`);
      }

      if (compliance.registrosConVespertino > 0) {
        const pctExceso = (compliance.excesoVespertino / compliance.registrosConVespertino * 100).toFixed(1);
        console.log(`   Periodo vespertino: ${compliance.excesoVespertino}/${compliance.registrosConVespertino} (${pctExceso}%) superan 65 dB`);
      }

      if (compliance.registrosConNocturno > 0) {
        const pctExceso = (compliance.excesoNocturno / compliance.registrosConNocturno * 100).toFixed(1);
        console.log(`   Periodo nocturno: ${compliance.excesoNocturno}/${compliance.registrosConNocturno} (${pctExceso}%) superan 55 dB`);
      }
    }

  } catch (error) {
    console.error('❌ Error generando resumen estadístico:', error);
  }
}

/**
 * Función principal del script
 */
async function main() {
  const options = parseArguments();

  if (options.showHelp) {
    showHelp();
    return;
  }

  console.log('🔊 Script de Importación de Contaminación Acústica');
  console.log('📊 Configuración:');
  console.log(`   - Omitir existentes: ${options.skipExisting ? 'Sí' : 'No'}`);
  console.log(`   - Tamaño de lote: ${options.batchSize}`);
  console.log(`   - Solo validación: ${options.validateOnly ? 'Sí' : 'No'}`);
  if (options.targetStation) {console.log(`   - Estación específica: NMT ${options.targetStation}`);}
  if (options.targetYear) {console.log(`   - Año específico: ${options.targetYear}`);}
  if (options.targetMonth) {console.log(`   - Mes específico: ${options.targetMonth}`);}

  let connection;

  try {
    if (!options.validateOnly) {
      // Conectar a MongoDB
      console.log('\n🔄 Conectando a MongoDB...');
      connection = await connectDB(config.database.uri);
      console.log('✅ Conectado a la base de datos');

      const noiseCount = await NoiseMonitoring.countDocuments();
      console.log(`📊 Registros actuales de contaminación acústica: ${noiseCount.toLocaleString()}`);
    } else {
      console.log('\n🔍 Modo validación: solo se verificarán los datos sin importar');
    }

    // Ejecutar importación
    const result = await importNoiseData(options);

    // Mostrar resultados finales
    console.log(`\n🎉 ${options.validateOnly ? 'Validación' : 'Importación'} de contaminación acústica completada!`);
    console.log(`⏱️  Tiempo total: ${(result.duration / 1000).toFixed(2)} segundos`);
    console.log(`📁 Archivos procesados: ${result.completedFiles}/${result.totalFiles}`);
    console.log(`📊 Total filas procesadas: ${result.totalRows.toLocaleString()}`);
    console.log(`✅ Registros válidos: ${result.processedRows.toLocaleString()}`);
    if (!options.validateOnly) {
      console.log(`💾 Registros insertados: ${result.insertedRecords.toLocaleString()}`);
      console.log(`⏭️  Registros omitidos: ${result.skippedRecords.toLocaleString()}`);
    }
    console.log(`🈳 Filas vacías: ${result.emptyRows.toLocaleString()}`);
    console.log(`❌ Errores: ${result.errorRows.toLocaleString()}`);

    // Generar resumen estadístico
    if (!options.validateOnly) {
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
  importNoiseData,
  parseNoiseRow
};
