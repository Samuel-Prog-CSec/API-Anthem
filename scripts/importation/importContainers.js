/**
 * Script de Importación de Contenedores
 *
 * Procesa y carga datos de contenedores de residuos desde CSV a MongoDB.
 * Optimizado para alto volumen de datos (~50k registros).
 * Ejecutar: node scripts/importation/importContainers.js
 */

const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const mongoose = require('mongoose');

// Importar modelos y configuración
const Container = require('../../src/models/Container');
const config = require('../../src/config/config');

// CONFIGURACIÓN OPTIMIZADA
const BATCH_SIZE = 2000; // Lotes grandes para mejor rendimiento
const DATA_FILE = path.join(__dirname, '../../datos_hpe/Anthem_CTC_Contenedores_Ubicacion.csv');
const LOG_INTERVAL = 5000; // Log cada 5000 registros

// Contadores
let totalProcessed = 0;
let totalInserted = 0;
let totalSkipped = 0;
let totalErrors = 0;

// Cache para verificación de duplicados
const processedKeys = new Set();

/**
 * Conectar a la base de datos con opciones optimizadas
 */
async function connectDatabase() {
  try {
    console.log('🔄 Conectando a MongoDB...');

    await mongoose.connect(config.database.uri, {
      maxPoolSize: 50, // Aumentar pool de conexiones
      minPoolSize: 10,
      socketTimeoutMS: 45000,
      serverSelectionTimeoutMS: 10000
    });

    console.log('✅ Conexión a MongoDB establecida');

    // Configurar opciones de escritura para mejor rendimiento
    mongoose.set('strictQuery', false);

    console.log('');
    return true;
  } catch (error) {
    console.error('❌ Error conectando a MongoDB:', error.message);
    return false;
  }
}

/**
 * Limpiar y normalizar string
 */
function cleanString(str) {
  if (!str) {return '';}
  return str.toString().trim().replace(/\s+/g, ' ');
}

/**
 * Parsear número
 */
function parseNumber(value) {
  if (!value || value === '') {return null;}

  const normalized = value.toString()
    .replace(/,/g, '.');

  const parsed = parseFloat(normalized);
  return isNaN(parsed) ? null : parsed;
}

/**
 * Normalizar tipo de contenedor
 */
function normalizeContainerType(tipo) {
  if (!tipo) {return null;}

  const normalized = tipo.toString().trim().toUpperCase();

  // Mapeo de variaciones
  const typeMap = {
    'ORGANICA': 'ORGANICA',
    'ORGÁNICA': 'ORGANICA',
    'RESTO': 'RESTO',
    'ENVASES': 'ENVASES',
    'ENVASE': 'ENVASES',
    'VIDRIO': 'VIDRIO',
    'PAPEL-CARTON': 'PAPEL-CARTON',
    'PAPEL-CARTÓN': 'PAPEL-CARTON',
    'PAPELCARTON': 'PAPEL-CARTON',
    'PAPEL': 'PAPEL-CARTON'
  };

  return typeMap[normalized] || null;
}

/**
 * Generar clave única para el contenedor
 */
function generateUniqueKey(data) {
  return `${data.codigoInternoSituado}_${data.tipoContenedor}_${data.coordenadas.x}_${data.coordenadas.y}`;
}

/**
 * Validar y transformar una fila de datos
 */
function validateAndTransformRow(row, rowIndex) {
  try {
    // Extraer y limpiar datos básicos
    const codigoInternoSituado = cleanString(row['C�digo Interno del Situad'] || row['Código Interno del Situad']);
    const tipoContenedor = normalizeContainerType(row['Tipo Contenedor']);

    // Validaciones básicas
    if (!codigoInternoSituado) {
      throw new Error('Código interno del situado faltante');
    }

    if (!tipoContenedor) {
      throw new Error(`Tipo de contenedor inválido: ${row['Tipo Contenedor']}`);
    }

    // Datos del contenedor
    const modelo = cleanString(row['Modelo']);
    const descripcionModelo = cleanString(row['Descripcion Modelo']);
    const cantidad = parseInt(row['Cantidad']) || 1;
    const lote = parseInt(row['Lote']);

    if (!lote || ![1, 2, 3].includes(lote)) {
      throw new Error(`Lote inválido: ${row['Lote']}`);
    }

    // Información geográfica
    const distrito = cleanString(row['Distrito']);
    const barrio = cleanString(row['Barrio']);

    if (!distrito) {
      throw new Error('Distrito faltante');
    }

    // El barrio puede estar vacío en algunos registros, usar valor por defecto
    const barrioFinal = barrio || 'SIN ESPECIFICAR';

    // Dirección
    const tipoVia = cleanString(row['Tipo V�a'] || row['Tipo Vía']);
    const nombreVia = cleanString(row['Nombre']);
    const numero = cleanString(row['N�mero'] || row['Número']);

    // Coordenadas UTM (en centímetros según documentación)
    const coordX = parseNumber(row['COORDENADA X']);
    const coordY = parseNumber(row['COORDENADA Y']);

    if (coordX === null || coordY === null) {
      throw new Error('Coordenadas UTM faltantes');
    }

    // Coordenadas geográficas (longitud, latitud)
    const longitude = parseNumber(row['LONGITUD']);
    const latitude = parseNumber(row['LATITUD']);

    if (longitude === null || latitude === null) {
      throw new Error('Coordenadas geográficas faltantes');
    }

    // Validar rango de coordenadas
    if (longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) {
      throw new Error(`Coordenadas fuera de rango: ${longitude}, ${latitude}`);
    }

    // Si no hay nombre de vía, generar uno descriptivo basado en coordenadas
    const nombreViaFinal = nombreVia || `Ubicación Geo ${latitude.toFixed(5)}N, ${Math.abs(longitude).toFixed(5)}W`;

    // Construir objeto de datos
    const containerData = {
      codigoInternoSituado,
      tipoContenedor,
      modelo,
      descripcionModelo,
      cantidad,
      lote,
      distrito,
      barrio: barrioFinal,
      direccion: {
        tipoVia: tipoVia || 'Sin especificar',
        nombre: nombreViaFinal,
        numero: numero || 'S/N'
      },
      coordenadas: {
        x: coordX,
        y: coordY
      },
      location: {
        type: 'Point',
        coordinates: [longitude, latitude] // GeoJSON: [lng, lat]
      }
    };

    return containerData;

  } catch (error) {
    throw new Error(`Error en fila ${rowIndex}: ${error.message}`);
  }
}

/**
 * Procesar archivo CSV y cargar datos
 */
async function processCSV() {
  console.log('📂 Procesando archivo de contenedores...');
  console.log(`📍 Archivo: ${DATA_FILE}\n`);

  return new Promise((resolve, reject) => {
    const records = [];
    const stream = fs.createReadStream(DATA_FILE, { encoding: 'utf8' })
      .pipe(csv({ separator: ';' }));

    stream.on('data', (row) => {
      totalProcessed++;

      try {
        const transformedData = validateAndTransformRow(row, totalProcessed);

        // Verificar duplicados en memoria (más rápido que consultar DB)
        const uniqueKey = generateUniqueKey(transformedData);

        if (processedKeys.has(uniqueKey)) {
          totalSkipped++;
        } else {
          processedKeys.add(uniqueKey);
          records.push(transformedData);
        }

        // Imprimir progreso
        if (totalProcessed % LOG_INTERVAL === 0) {
          process.stdout.write(
            `\r📊 Procesados: ${totalProcessed} | Válidos: ${records.length} | Duplicados: ${totalSkipped} | Errores: ${totalErrors}`
          );
        }

      } catch (error) {
        totalErrors++;
        if (totalErrors <= 10) { // Solo mostrar primeros 10 errores
          console.error(`\n⚠️  ${error.message}`);
        }
      }
    });

    stream.on('end', async () => {
      console.log(`\n\n✅ Lectura completada: ${totalProcessed} registros procesados`);
      console.log(`📝 Registros válidos únicos: ${records.length}`);
      console.log(`⏭️  Duplicados en archivo: ${totalSkipped}`);
      console.log(`❌ Errores: ${totalErrors}\n`);

      if (records.length === 0) {
        console.log('⚠️  No hay registros válidos para insertar');
        return resolve();
      }

      // Verificar duplicados en base de datos
      console.log('🔍 Verificando duplicados en base de datos...');

      const codigos = [...new Set(records.map(r => r.codigoInternoSituado))];
      const existingContainers = await Container.find({
        codigoInternoSituado: { $in: codigos }
      }).select('codigoInternoSituado tipoContenedor coordenadas').lean();

      // Crear set de contenedores existentes
      const existingKeys = new Set(
        existingContainers.map(c =>
          `${c.codigoInternoSituado}_${c.tipoContenedor}_${c.coordenadas.x}_${c.coordenadas.y}`
        )
      );

      // Filtrar registros que ya existen en DB
      const newRecords = records.filter(record => {
        const key = generateUniqueKey(record);
        const isDuplicate = existingKeys.has(key);
        if (isDuplicate) {totalSkipped++;}
        return !isDuplicate;
      });

      if (newRecords.length === 0) {
        console.log('✅ Todos los registros ya existen en la base de datos');
        return resolve();
      }

      console.log(`✅ Registros nuevos a insertar: ${newRecords.length}\n`);

      // Insertar en lotes con manejo de errores robusto
      console.log('💾 Insertando datos en la base de datos...');

      let insertedInBatch = 0;

      try {
        for (let i = 0; i < newRecords.length; i += BATCH_SIZE) {
          const batch = newRecords.slice(i, i + BATCH_SIZE);

          try {
            const result = await Container.insertMany(batch, {
              ordered: false, // Continuar si hay errores
              lean: true
            });

            insertedInBatch = result.length;
            totalInserted += insertedInBatch;

          } catch (bulkError) {
            // En caso de error de duplicado, contar los insertados
            if (bulkError.code === 11000 && bulkError.writeErrors) {
              insertedInBatch = batch.length - bulkError.writeErrors.length;
              totalInserted += insertedInBatch;
            } else {
              throw bulkError;
            }
          }

          const progress = Math.round((totalInserted / newRecords.length) * 100);
          process.stdout.write(`\r💾 Insertados: ${totalInserted}/${newRecords.length} (${progress}%)`);
        }

        console.log('\n');
        resolve();

      } catch (error) {
        console.error('\n❌ Error durante la inserción:', error.message);
        resolve(); // Continuar para mostrar estadísticas
      }
    });

    stream.on('error', (error) => {
      console.error('❌ Error leyendo archivo CSV:', error.message);
      reject(error);
    });
  });
}

/**
 * Mostrar estadísticas finales
 */
async function showStatistics() {
  console.log('\n📊 ESTADÍSTICAS FINALES:');
  console.log('═'.repeat(60));
  console.log(`📥 Total procesados:              ${totalProcessed}`);
  console.log(`✅ Total insertados:              ${totalInserted}`);
  console.log(`⏭️  Total omitidos (duplicados):   ${totalSkipped}`);
  console.log(`❌ Total errores:                 ${totalErrors}`);
  console.log('═'.repeat(60));

  // Estadísticas de la base de datos
  console.log('\n📚 ESTADO DE LA BASE DE DATOS:');
  console.log('═'.repeat(60));

  const totalInDB = await Container.countDocuments();
  console.log(`📝 Total contenedores en DB:      ${totalInDB}`);

  // Estadísticas por tipo
  const byType = await Container.aggregate([
    {
      $group: {
        _id: '$tipoContenedor',
        total: { $sum: '$cantidad' },
        ubicaciones: { $sum: 1 }
      }
    },
    { $sort: { _id: 1 } }
  ]);

  console.log('\n📦 Distribución por tipo:');
  byType.forEach(item => {
    console.log(`   ${item._id.padEnd(15)}: ${item.total.toString().padStart(6)} contenedores en ${item.ubicaciones} ubicaciones`);
  });

  // Estadísticas por distrito (top 5)
  const byDistrict = await Container.aggregate([
    {
      $group: {
        _id: '$distrito',
        total: { $sum: '$cantidad' }
      }
    },
    { $sort: { total: -1 } },
    { $limit: 5 }
  ]);

  console.log('\n🏙️  Top 5 distritos con más contenedores:');
  byDistrict.forEach((item, index) => {
    console.log(`   ${(index + 1)}. ${item._id.padEnd(25)}: ${item.total} contenedores`);
  });

  console.log('═'.repeat(60) + '\n');
}

/**
 * Crear índices si no existen
 */
async function ensureIndexes() {
  console.log('🔧 Verificando índices...');

  try {
    await Container.collection.createIndexes([
      { key: { location: '2dsphere' } },
      { key: { distrito: 1, barrio: 1, tipoContenedor: 1 } },
      { key: { tipoContenedor: 1 } },
      { key: { lote: 1 } }
    ]);

    console.log('✅ Índices verificados/creados\n');
  } catch (error) {
    console.warn('⚠️  Advertencia al crear índices:', error.message);
  }
}

/**
 * Función principal
 */
async function main() {
  console.log('\n' + '═'.repeat(60));
  console.log('  🗑️  IMPORTACIÓN DE CONTENEDORES DE RESIDUOS');
  console.log('═'.repeat(60) + '\n');

  const startTime = Date.now();

  try {
    // Conectar a la base de datos
    const connected = await connectDatabase();
    if (!connected) {
      throw new Error('No se pudo conectar a la base de datos');
    }

    // Verificar que el archivo existe
    if (!fs.existsSync(DATA_FILE)) {
      throw new Error(`Archivo no encontrado: ${DATA_FILE}`);
    }

    // Asegurar índices
    await ensureIndexes();

    // Procesar CSV
    await processCSV();

    // Mostrar estadísticas
    await showStatistics();

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`✅ Importación completada en ${duration} segundos\n`);

  } catch (error) {
    console.error('\n❌ ERROR FATAL:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    // Cerrar conexión
    console.log('🔌 Cerrando conexión a MongoDB...');
    await mongoose.connection.close();
    console.log('✅ Conexión cerrada correctamente\n');
  }
}

// Ejecutar script
main();
