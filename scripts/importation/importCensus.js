/**
 * Script de Importación de Censo
 *
 * Script especializado para importar datos CSV del censo poblacional
 * a la base de datos MongoDB. Procesa todos los archivos de censo
 * del directorio datos_hpe/Censo/
 */

const fs = require('fs').promises;
const path = require('path');
const csv = require('csv-parser');
const { createReadStream } = require('fs');
const mongoose = require('mongoose');
const { connectDB } = require('../../src/config/database');
const config = require('../../src/config/config');
const Census = require('../../src/models/Census');

/**
 * Configuración del importador
 */
const IMPORT_CONFIG = {
  dataDirectory: path.join(__dirname, '..', '..', 'datos_hpe', 'Censo'),
  batchSize: 500,
  skipExisting: true
};

/**
 * Parsear datos de una fila CSV de censo
 * @param {Object} row - Fila del CSV
 * @param {string} sourceFile - Archivo origen
 * @returns {Object} - Datos procesados para el censo
 */
function parseCensusRow(row, sourceFile) {
  try {
    // Extraer mes y año del nombre del archivo (formato: Anthem_CTC_Censo_MMAAAA.csv)
    const fileMatch = sourceFile.match(/(\d{2})(\d{4})/);
    const mes = fileMatch ? parseInt(fileMatch[1]) : 1;
    const año = fileMatch ? parseInt(fileMatch[2]) : new Date().getFullYear();

    // Crear fecha del censo
    const fechaCenso = new Date(año, mes - 1, 1);

    // Limpiar y parsear campos numéricos
    const parseNumber = (value, defaultValue = 0) => {
      if (!value || value.trim() === '') {return defaultValue;}
      const cleaned = value.toString().replace(/['"]/g, '').trim();
      const parsed = parseInt(cleaned);
      return isNaN(parsed) ? defaultValue : Math.max(0, parsed);
    };

    // Limpiar campos de texto
    const cleanString = (value, defaultValue = '') => {
      if (!value) {return defaultValue;}
      return value.toString().replace(/['"]/g, '').trim() || defaultValue;
    };

    // Extraer datos poblacionales
    const españolesHombres = parseNumber(row.EspanolesHombres);
    const españolesMujeres = parseNumber(row.EspanolesMujeres);
    const extranjerosHombres = parseNumber(row.ExtranjerosHombres);
    const extranjerosMujeres = parseNumber(row.ExtranjerosMujeres);

    // Validar que al menos hay algún dato poblacional
    const totalPoblacion = españolesHombres + españolesMujeres + extranjerosHombres + extranjerosMujeres;
    if (totalPoblacion === 0) {
      // No crear registro para filas sin población
      return null;
    }

    const censusData = {
      fechaCenso,
      mes,
      año,

      // Información del distrito
      distrito: {
        codigo: parseNumber(row.COD_DISTRITO, 1),
        descripcion: cleanString(row.DESC_DISTRITO, 'SIN DESCRIPCION')
      },

      // Información del barrio
      barrio: {
        codigoDistritoBarrio: parseNumber(row.COD_DIST_BARRIO, 1),
        codigo: parseNumber(row.COD_BARRIO, 1),
        descripcion: cleanString(row.DESC_BARRIO, 'SIN DESCRIPCION')
      },

      // Información de la sección censal
      seccionCensal: {
        codigoDistritoSeccion: parseNumber(row.COD_DIST_SECCION, 1),
        codigo: parseNumber(row.COD_SECCION, 1)
      },

      // Edad del grupo poblacional
      edad: parseNumber(row.COD_EDAD_INT, 0),

      // Datos poblacionales por género y nacionalidad
      poblacion: {
        españoles: {
          hombres: españolesHombres,
          mujeres: españolesMujeres
        },
        extranjeros: {
          hombres: extranjerosHombres,
          mujeres: extranjerosMujeres
        }
      },

      // Información de procesamiento
      procesamiento: {
        archivoOrigen: sourceFile,
        versionDatos: '1.0'
      }
    };

    return censusData;

  } catch (error) {
    console.error(`Error procesando fila del archivo ${sourceFile}:`, error);
    console.error('Datos de la fila:', row);
    return null;
  }
}

/**
 * Procesar un archivo CSV de censo
 * @param {string} filePath - Ruta al archivo CSV
 * @param {Object} options - Opciones de procesamiento
 * @returns {Promise<Object>} - Estadísticas de procesamiento
 */
async function processCensusFile(filePath, options = {}) {
  const fileName = path.basename(filePath);
  console.log(`\n📂 Procesando archivo: ${fileName}`);

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
    const stream = createReadStream(filePath)
      .pipe(csv({ separator: ';' }))
      .on('data', async (row) => {
        stats.totalRows++;

        try {
          const censusData = parseCensusRow(row, fileName);

          if (censusData) {
            batch.push(censusData);
            stats.processedRows++;

            // Procesar lote cuando alcance el tamaño configurado
            if (batch.length >= options.batchSize) {
              stream.pause();
              await processBatch(batch, options, stats);
              batch.length = 0; // Limpiar array
              stream.resume();
            }
          } else {
            stats.emptyRows++;
          }

          // Log de progreso
          if (stats.totalRows % options.logInterval === 0) {
            console.log(`   📊 Procesadas ${stats.totalRows} filas...`);
          }

        } catch (error) {
          stats.errorRows++;
          stats.errors.push({
            row: stats.totalRows,
            error: error.message
          });

          if (stats.errors.length > 100) { // Limitar errores almacenados
            stats.errors = stats.errors.slice(-50);
          }
        }
      })
      .on('end', async () => {
        try {
          // Procesar lote restante
          if (batch.length > 0) {
            await processBatch(batch, options, stats);
          }

          console.log(`✅ Archivo completado: ${fileName}`);
          console.log(`   📊 Total filas: ${stats.totalRows}`);
          console.log(`   ✅ Procesadas: ${stats.processedRows}`);
          console.log(`   🈳 Vacías: ${stats.emptyRows}`);
          console.log(`   ❌ Errores: ${stats.errorRows}`);
          console.log(`   💾 Insertadas: ${stats.insertedRecords}`);
          console.log(`   ⏭️  Omitidas: ${stats.skippedRecords}`);

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
 * Procesar un lote de datos de censo
 * @param {Array} batch - Lote de datos de censo
 * @param {Object} options - Opciones de procesamiento
 * @param {Object} stats - Estadísticas de procesamiento
 */
async function processBatch(batch, options, stats) {
  try {
    if (options.skipExisting) {
      // Insertar solo si no existen registros duplicados
      for (const censusData of batch) {
        try {
          const census = new Census(censusData);
          await census.save();
          stats.insertedRecords++;
        } catch (error) {
          if (error.code === 11000) {
            // Registro duplicado
            stats.skippedRecords++;
          } else {
            console.error(`Error insertando registro de censo:`, error.message);
            stats.errorRows++;
          }
        }
      }
    } else {
      // Usar upsert para sobrescribir existentes
      const operations = batch.map(censusData => ({
        updateOne: {
          filter: {
            'distrito.codigo': censusData.distrito.codigo,
            'barrio.codigo': censusData.barrio.codigo,
            'seccionCensal.codigo': censusData.seccionCensal.codigo,
            edad: censusData.edad,
            año: censusData.año,
            mes: censusData.mes
          },
          update: { $set: censusData },
          upsert: true
        }
      }));

      const result = await Census.bulkWrite(operations, { ordered: false });
      stats.insertedRecords += result.upsertedCount;
      stats.insertedRecords += result.modifiedCount;

      // Los matched count son registros que ya existían
      stats.skippedRecords += result.matchedCount - result.modifiedCount;
    }

  } catch (error) {
    console.error('Error procesando lote de censo:', error);
    throw error;
  }
}

/**
 * Importar todos los archivos de censo
 * @param {Object} options - Opciones de importación
 * @returns {Promise<Object>} - Estadísticas finales
 */
async function importCensusData(options = {}) {
  const config = { ...IMPORT_CONFIG, ...options };

  console.log('👥 Iniciando importación de datos de censo...');
  console.log(`📁 Directorio: ${config.dataDirectory}`);

  try {
    // Verificar que existe el directorio
    const dirStats = await fs.stat(config.dataDirectory);
    if (!dirStats.isDirectory()) {
      throw new Error(`No se encontró el directorio: ${config.dataDirectory}`);
    }

    // Obtener lista de archivos CSV
    const files = await fs.readdir(config.dataDirectory);
    const csvFiles = files
      .filter(file => file.endsWith('.csv') && file.includes('Censo'))
      .sort();

    if (csvFiles.length === 0) {
      throw new Error('No se encontraron archivos CSV de censo');
    }

    console.log(`📄 Archivos encontrados: ${csvFiles.length}`);
    csvFiles.forEach(file => console.log(`   - ${file}`));

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
      fileStats: []
    };

    // Procesar cada archivo
    for (const file of csvFiles) {
      const filePath = path.join(config.dataDirectory, file);

      try {
        const fileStats = await processCensusFile(filePath, config);
        globalStats.fileStats.push(fileStats);
        globalStats.completedFiles++;
        globalStats.totalRows += fileStats.totalRows;
        globalStats.processedRows += fileStats.processedRows;
        globalStats.emptyRows += fileStats.emptyRows;
        globalStats.errorRows += fileStats.errorRows;
        globalStats.insertedRecords += fileStats.insertedRecords;
        globalStats.skippedRecords += fileStats.skippedRecords;

      } catch (error) {
        console.error(`❌ Error procesando archivo ${file}:`, error);
        globalStats.errorRows++;
      }
    }

    globalStats.endTime = new Date();
    globalStats.duration = globalStats.endTime - globalStats.startTime;

    return globalStats;

  } catch (error) {
    console.error('❌ Error en importación de censo:', error);
    throw error;
  }
}

/**
 * Generar resumen estadístico post-importación
 */
async function generatePostImportSummary() {
  console.log('\n📈 Generando resumen estadístico...');

  try {
    // Estadísticas básicas
    const totalRecords = await Census.countDocuments();
    console.log(`📊 Total de registros de censo: ${totalRecords.toLocaleString()}`);

    // Distribución por año
    const yearDistribution = await Census.aggregate([
      {
        $group: {
          _id: '$año',
          totalRegistros: { $sum: 1 },
          poblacionTotal: { $sum: '$estadisticas.totalPoblacion' }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    console.log('\n📅 Distribución por año:');
    yearDistribution.forEach(year => {
      console.log(`   ${year._id}: ${year.totalRegistros.toLocaleString()} registros, ${year.poblacionTotal?.toLocaleString() || 0} habitantes`);
    });

    // Top 10 distritos más poblados
    const topDistricts = await Census.aggregate([
      {
        $group: {
          _id: {
            codigo: '$distrito.codigo',
            nombre: '$distrito.descripcion'
          },
          poblacionTotal: { $sum: '$estadisticas.totalPoblacion' }
        }
      },
      { $sort: { poblacionTotal: -1 } },
      { $limit: 10 }
    ]);

    console.log('\n🏙️  Top 10 distritos más poblados:');
    topDistricts.forEach((district, index) => {
      console.log(`   ${index + 1}. ${district._id.nombre}: ${district.poblacionTotal?.toLocaleString() || 0} habitantes`);
    });

    // Distribución por grupos de edad
    const ageGroups = await Census.aggregate([
      {
        $group: {
          _id: '$clasificacionEdad.grupoEdad',
          poblacionTotal: { $sum: '$estadisticas.totalPoblacion' },
          totalRegistros: { $sum: 1 }
        }
      },
      { $sort: { poblacionTotal: -1 } }
    ]);

    console.log('\n👶👨👴 Distribución por grupos de edad:');
    ageGroups.forEach(group => {
      console.log(`   ${group._id}: ${group.poblacionTotal?.toLocaleString() || 0} habitantes (${group.totalRegistros.toLocaleString()} registros)`);
    });

  } catch (error) {
    console.error('❌ Error generando resumen estadístico:', error);
  }
}

/**
 * Función principal del script
 */
async function main() {
  console.log('👥 Script de Importación de Censo');
  console.log('📊 Configuración:');
  console.log(`   - Omitir existentes: Sí`);
  console.log(`   - Tamaño de lote: ${IMPORT_CONFIG.batchSize}`);

  let connection;

  try {
    // Conectar a MongoDB
    console.log('\n🔄 Conectando a MongoDB...');
    connection = await connectDB(config.database.uri);
    console.log('✅ Conectado a la base de datos');

    // Verificar que el modelo de censo esté disponible
    console.log('🔄 Verificando modelo de censo...');
    const censusCount = await Census.countDocuments();
    console.log(`📊 Registros actuales de censo: ${censusCount.toLocaleString()}`);

    // Ejecutar importación
    const result = await importCensusData();

    // Mostrar resultados finales
    console.log('\n🎉 Importación de censo completada!');
    console.log(`⏱️  Tiempo total: ${(result.duration / 1000).toFixed(2)} segundos`);
    console.log(`📁 Archivos procesados: ${result.completedFiles}/${result.totalFiles}`);
    console.log(`📊 Total filas procesadas: ${result.totalRows.toLocaleString()}`);
    console.log(`✅ Registros insertados: ${result.insertedRecords.toLocaleString()}`);
    console.log(`⏭️  Registros omitidos: ${result.skippedRecords.toLocaleString()}`);
    console.log(`🈳 Filas vacías: ${result.emptyRows.toLocaleString()}`);
    console.log(`❌ Errores: ${result.errorRows.toLocaleString()}`);

    // Estadísticas finales de la base de datos
    const finalCount = await Census.countDocuments();
    console.log(`\n📈 Total de registros de censo en la base de datos: ${finalCount.toLocaleString()}`);

    // Generar resumen estadístico
    await generatePostImportSummary();

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
  importCensusData,
  parseCensusRow
};
