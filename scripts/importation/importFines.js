/**
 * Script de Importación de Multas
 *
 * Script especializado para importar datos CSV de multas de tráfico
 * a la base de datos MongoDB. Procesa todos los archivos de multas
 * del directorio datos_hpe/Multas/
 */

const fs = require('fs').promises;
const path = require('path');
const csv = require('csv-parser');
const { createReadStream } = require('fs');
const mongoose = require('mongoose');
const { connectDB } = require('../../src/config/database');
const config = require('../../src/config/config');
const Fine = require('../../src/models/Fine');

/**
 * Configuración del importador
 */
const IMPORT_CONFIG = {
  dataDirectory: path.join(__dirname, '..', '..', 'datos_hpe', 'Multas'),
  batchSize: 2000, // Optimizado para archivos grandes
  skipExisting: true,
  logInterval: 50000, // Logs menos frecuentes
  maxParallel: 3 // Procesamiento paralelo máximo
};

/**
 * Parsear datos de una fila CSV de multas
 * @param {Object} row - Fila del CSV
 * @param {string} sourceFile - Archivo origen
 * @returns {Object} - Datos procesados para la multa
 */
function parseMultaRow(row, sourceFile) {
  try {
    // Extraer mes y año del nombre del archivo (formato: Anthem_CTC_Multas_MMAAAA.csv)
    const fileMatch = sourceFile.match(/(\d{2})(\d{4})/);
    const mes = fileMatch ? parseInt(fileMatch[1]) : 1;
    const año = fileMatch ? parseInt(fileMatch[2]) : new Date().getFullYear();

    // Crear fecha basada en mes y año
    const fecha = new Date(año, mes - 1, 1);

    // Procesar coordenadas
    const coordenadas = {};
    if (row.COORDENADA_X && row.COORDENADA_X.trim() !== '') {
      const coordX = parseFloat(row.COORDENADA_X.replace(',', '.'));
      if (!isNaN(coordX)) {coordenadas.x = coordX;}
    }
    if (row.COORDENADA_Y && row.COORDENADA_Y.trim() !== '') {
      const coordY = parseFloat(row.COORDENADA_Y.replace(',', '.'));
      if (!isNaN(coordY)) {coordenadas.y = coordY;}
    }

    // Procesar datos de velocidad
    const datosVelocidad = {};
    if (row.VEL_LIMITE && row.VEL_LIMITE.trim() !== '') {
      const velLimite = parseInt(row.VEL_LIMITE);
      if (!isNaN(velLimite)) {datosVelocidad.velocidadLimite = velLimite;}
    }
    if (row.VEL_CIRCULA && row.VEL_CIRCULA.trim() !== '') {
      const velCircula = parseInt(row.VEL_CIRCULA);
      if (!isNaN(velCircula)) {datosVelocidad.velocidadCirculacion = velCircula;}
    }

    // Procesar importe
    const importeStr = row.IMP_BOL ? row.IMP_BOL.replace(',', '.').trim() : '0';
    const importe = parseFloat(importeStr) || 0;

    // Procesar puntos
    const puntos = parseInt(row.PUNTOS) || 0;

    // Procesar descuento
    const tieneDescuento = row.DESCUENTO &&
      (row.DESCUENTO.toLowerCase().includes('si') || row.DESCUENTO.toLowerCase().includes('sí'));

    // Crear objeto de multa
    const multa = {
      fecha,
      mes,
      año,
      hora: row.HORA || '00.00',
      calificacion: (row.CALIFICACION || 'LEVE').toUpperCase().trim(),
      lugar: (row.LUGAR || 'NO ESPECIFICADO').trim(),
      coordenadas: Object.keys(coordenadas).length > 0 ? coordenadas : undefined,
      importeBoletín: importe,
      tieneDescuento,
      puntosDetraídos: puntos,
      denunciante: (row.DENUNCIANTE || 'NO ESPECIFICADO').trim(),
      descripcionInfraccion: (row['HECHO-BOL'] || '').trim(),
      datosVelocidad: Object.keys(datosVelocidad).length > 0 ? datosVelocidad : undefined,
      procesamiento: {
        archivoOrigen: sourceFile
      }
    };

    return multa;

  } catch (error) {
    console.error(`Error procesando fila del archivo ${sourceFile}:`, error);
    console.error('Datos de la fila:', row);
    return null;
  }
}

/**
 * Procesar un archivo CSV de multas
 * @param {string} filePath - Ruta al archivo CSV
 * @param {Object} options - Opciones de procesamiento
 * @returns {Promise<Object>} - Estadísticas de procesamiento
 */
async function processMultasFile(filePath, options = {}) {
  const fileName = path.basename(filePath);
  console.log(`\n📂 Procesando archivo: ${fileName}`);

  return new Promise((resolve, reject) => {
    const stats = {
      fileName,
      totalRows: 0,
      processedRows: 0,
      errorRows: 0,
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
          const multaData = parseMultaRow(row, fileName);

          if (multaData) {
            batch.push(multaData);
            stats.processedRows++;

            // Procesar lote cuando alcance el tamaño configurado
            if (batch.length >= options.batchSize) {
              stream.pause();
              await processBatch(batch, options, stats);
              batch.length = 0; // Limpiar array
              stream.resume();
            }
          } else {
            stats.errorRows++;
          }

          // Log de progreso menos frecuente
          if (stats.totalRows % (options.logInterval || 50000) === 0) {
            console.log(`   📊 Procesadas ${stats.totalRows.toLocaleString()} filas...`);
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
 * Procesar un lote de multas con menos logging
 * @param {Array} batch - Lote de datos de multas
 * @param {Object} options - Opciones de procesamiento
 * @param {Object} stats - Estadísticas de procesamiento
 */
async function processBatch(batch, options, stats) {
  try {
    if (options.skipExisting) {
      // Usar bulkWrite para mejor rendimiento
      const operations = batch.map(multaData => ({
        insertOne: {
          document: multaData
        }
      }));

      try {
        const result = await Fine.bulkWrite(operations, {
          ordered: false,
          bypassDocumentValidation: false
        });
        stats.insertedRecords += result.insertedCount || 0;
      } catch (error) {
        // Manejar duplicados individualmente si es necesario
        for (const multaData of batch) {
          try {
            const multa = new Fine(multaData);
            await multa.save();
            stats.insertedRecords++;
          } catch (err) {
            if (err.code === 11000) {
              stats.skippedRecords++;
            } else {
              stats.errorRows++;
            }
          }
        }
      }
    } else {
      // Usar upsert para sobrescribir existentes
      const operations = batch.map(multaData => ({
        updateOne: {
          filter: {
            lugar: multaData.lugar,
            fecha: multaData.fecha,
            hora: multaData.hora,
            importeBoletín: multaData.importeBoletín
          },
          update: { $set: multaData },
          upsert: true
        }
      }));

      const result = await Fine.bulkWrite(operations, { ordered: false });
      stats.insertedRecords += result.upsertedCount;
      stats.insertedRecords += result.modifiedCount;
      stats.skippedRecords += result.matchedCount - result.modifiedCount;
    }

  } catch (error) {
    console.error('Error procesando lote:', error.message);
    throw error;
  }
}

/**
 * Importar todos los archivos de multas con procesamiento paralelo optimizado
 * @param {Object} options - Opciones de importación
 * @returns {Promise<Object>} - Estadísticas finales
 */
async function importMultasData(options = {}) {
  const config = { ...IMPORT_CONFIG, ...options };

  console.log('🚗 Iniciando importación de datos de multas...');
  console.log(`📁 Directorio: ${config.dataDirectory}`);
  console.log(`🔄 Procesamiento paralelo: ${config.maxParallel || 3} archivos simultáneos`);

  try {
    // Verificar que existe el directorio
    const dirStats = await fs.stat(config.dataDirectory);
    if (!dirStats.isDirectory()) {
      throw new Error(`No se encontró el directorio: ${config.dataDirectory}`);
    }

    // Obtener lista de archivos CSV
    const files = await fs.readdir(config.dataDirectory);
    const csvFiles = files
      .filter(file => file.endsWith('.csv') && file.includes('Multas'))
      .sort();

    if (csvFiles.length === 0) {
      throw new Error('No se encontraron archivos CSV de multas');
    }

    console.log(`📄 Archivos encontrados: ${csvFiles.length}`);
    csvFiles.forEach(file => console.log(`   - ${file}`));

    const globalStats = {
      startTime: new Date(),
      totalFiles: csvFiles.length,
      completedFiles: 0,
      totalRows: 0,
      processedRows: 0,
      errorRows: 0,
      insertedRecords: 0,
      skippedRecords: 0,
      fileStats: []
    };

    // Procesar archivos en paralelo
    const maxParallel = config.maxParallel || 3;
    const processFile = async (file) => {
      const filePath = path.join(config.dataDirectory, file);
      try {
        return await processMultasFile(filePath, config);
      } catch (error) {
        console.error(`❌ Error procesando archivo ${file}:`, error.message);
        return {
          fileName: file,
          totalRows: 0,
          processedRows: 0,
          errorRows: 1,
          insertedRecords: 0,
          skippedRecords: 0,
          errors: [error.message]
        };
      }
    };

    // Procesar en lotes paralelos
    for (let i = 0; i < csvFiles.length; i += maxParallel) {
      const batch = csvFiles.slice(i, i + maxParallel);
      console.log(`\n🔄 Procesando lote ${Math.floor(i/maxParallel) + 1}/${Math.ceil(csvFiles.length/maxParallel)}: ${batch.join(', ')}`);

      const promises = batch.map(file => processFile(file));
      const batchResults = await Promise.all(promises);

      // Acumular estadísticas
      batchResults.forEach(fileStats => {
        globalStats.fileStats.push(fileStats);
        globalStats.completedFiles++;
        globalStats.totalRows += fileStats.totalRows;
        globalStats.processedRows += fileStats.processedRows;
        globalStats.errorRows += fileStats.errorRows;
        globalStats.insertedRecords += fileStats.insertedRecords;
        globalStats.skippedRecords += fileStats.skippedRecords;
      });

      console.log(`✅ Lote ${Math.floor(i/maxParallel) + 1} completado. Progreso: ${globalStats.completedFiles}/${csvFiles.length}`);
    }

    globalStats.endTime = new Date();
    globalStats.duration = globalStats.endTime - globalStats.startTime;

    return globalStats;

  } catch (error) {
    console.error('❌ Error en importación de multas:', error);
    throw error;
  }
}

/**
 * Función principal del script
 */
async function main() {
  const args = process.argv.slice(2);
  const options = {
    skipExisting: !args.includes('--force'),
    batchSize: args.find(arg => arg.startsWith('--batch='))?.split('=')[1] || IMPORT_CONFIG.batchSize
  };

  console.log('🚗 Script de Importación de Multas');
  console.log('📊 Configuración:');
  console.log(`   - Omitir existentes: ${options.skipExisting ? 'Sí' : 'No'}`);
  console.log(`   - Tamaño de lote: ${options.batchSize}`);

  let connection;

  try {
    // Conectar a MongoDB
    console.log('\n🔄 Conectando a MongoDB...');
    connection = await connectDB(config.database.uri);
    console.log('✅ Conectado a la base de datos');

    // Verificar que el modelo de multas esté disponible
    console.log('🔄 Verificando modelo de multas...');
    const finesCount = await Fine.countDocuments();
    console.log(`📊 Registros actuales de multas: ${finesCount.toLocaleString()}`);

    // Ejecutar importación
    const result = await importMultasData(options);

    // Mostrar resultados finales
    console.log('\n🎉 Importación de multas completada!');
    console.log(`⏱️  Tiempo total: ${(result.duration / 1000).toFixed(2)} segundos`);
    console.log(`📁 Archivos procesados: ${result.completedFiles}/${result.totalFiles}`);
    console.log(`📊 Total filas procesadas: ${result.totalRows.toLocaleString()}`);
    console.log(`✅ Registros insertados: ${result.insertedRecords.toLocaleString()}`);
    console.log(`⏭️  Registros omitidos: ${result.skippedRecords.toLocaleString()}`);
    console.log(`❌ Errores: ${result.errorRows.toLocaleString()}`);

    // Estadísticas finales de la base de datos
    const finalCount = await Fine.countDocuments();
    console.log(`\n📈 Total de multas en la base de datos: ${finalCount.toLocaleString()}`);

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
  importMultasData,
  parseMultaRow
};
