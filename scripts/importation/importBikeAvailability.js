/**
 * Script de Importación de Disponibilidad de Bicicletas
 *
 * Procesa y carga datos de disponibilidad de bicicletas desde CSV a MongoDB.
 * Ejecutar: node scripts/importation/importBikeAvailability.js
 */

const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const mongoose = require('mongoose');

// Importar modelos y configuración
const BikeAvailability = require('../../src/models/BikeAvailability');
const config = require('../../src/config/config');

// CONFIGURACIÓN
const BATCH_SIZE = 100; // Tamaño de lote para inserciones
const DATA_FILE = path.join(__dirname, '../../datos_hpe/Anthem_CTC_Bicicletas_Disponibilidad.csv');

// Contadores
let totalProcessed = 0;
let totalInserted = 0;
let totalSkipped = 0;
let totalErrors = 0;

/**
 * Conectar a la base de datos
 */
async function connectDatabase() {
  try {
    console.log('🔄 Conectando a MongoDB...');
    await mongoose.connect(config.database.uri);
    console.log('✅ Conexión a MongoDB establecida\n');
    return true;
  } catch (error) {
    console.error('❌ Error conectando a MongoDB:', error.message);
    return false;
  }
}

/**
 * Parsear número con formato español (coma decimal, punto miles)
 */
function parseSpanishNumber(value) {
  if (!value || value === '') {return 0;}

  // Eliminar puntos de miles y reemplazar coma por punto decimal
  const normalized = value.toString()
    .replace(/\./g, '')
    .replace(/,/g, '.');

  const parsed = parseFloat(normalized);
  return isNaN(parsed) ? 0 : parsed;
}

/**
 * Parsear fecha en formato DD/MM/YYYY
 */
function parseDate(dateStr) {
  if (!dateStr) {throw new Error('Fecha vacía');}

  const parts = dateStr.trim().split('/');
  if (parts.length !== 3) {throw new Error(`Formato de fecha inválido: ${dateStr}`);}

  const day = parseInt(parts[0]);
  const month = parseInt(parts[1]) - 1; // Meses en JS son 0-11
  const year = parseInt(parts[2]);

  const date = new Date(year, month, day);
  if (isNaN(date.getTime())) {throw new Error(`Fecha inválida: ${dateStr}`);}

  return date;
}

/**
 * Validar y transformar una fila de datos
 */
function validateAndTransformRow(row, rowIndex) {
  try {
    // Parsear fecha (nombre columna en mayúsculas)
    const dia = parseDate(row['DIA']);

    // Parsear todos los valores numéricos (manejar espacios en nombres de columna)
    const horasTotalesUsosBicicletas = parseSpanishNumber(row['HORAS_TOTALES_USOS_BICICLETAS']);

    // El nombre de esta columna tiene un espacio extra en el CSV
    const horasTotalesDisponibilidadBicicletasEnAnclajes = parseSpanishNumber(
      row['HORAS_TOTALES_DISPONIBILIDAD_BICICLETAS_EN _ANCLAJES'] ||
      row['HORAS_TOTALES_DISPONIBILIDAD_BICICLETAS_EN_ANCLAJES']
    );

    const totalHorasServicioBicicletas = parseSpanishNumber(row['TOTAL_HORAS_SERVICIO_BICICLETAS']);
    const mediaBicicletasDisponibles = parseSpanishNumber(row['MEDIA_BICICLETAS_DISPONIBLES']);
    const usosAbonadoAnual = parseInt(row['USOS_ABONADO_ANUAL']) || 0;
    const usosAbonadoOcasional = parseInt(row['USOS_ABONADO_OCASIONAL']) || 0;
    const totalUsos = parseInt(row['TOTAL_USOS']) || 0;

    // Validar valores mínimos
    if (horasTotalesUsosBicicletas < 0 ||
        horasTotalesDisponibilidadBicicletasEnAnclajes < 0 ||
        totalHorasServicioBicicletas < 0 ||
        mediaBicicletasDisponibles < 0) {
      throw new Error('Valores numéricos no pueden ser negativos');
    }

    return {
      dia,
      horasTotalesUsosBicicletas,
      horasTotalesDisponibilidadBicicletasEnAnclajes,
      totalHorasServicioBicicletas,
      mediaBicicletasDisponibles,
      usosAbonadoAnual,
      usosAbonadoOcasional,
      totalUsos
    };

  } catch (error) {
    throw new Error(`Error en fila ${rowIndex}: ${error.message}`);
  }
}

/**
 * Verificar duplicados antes de insertar
 */
async function checkDuplicates(dates) {
  const existingDates = await BikeAvailability.find({
    dia: { $in: dates }
  }).select('dia').lean();

  return new Set(existingDates.map(doc => doc.dia.toISOString()));
}

/**
 * Procesar archivo CSV y cargar datos
 */
async function processCSV() {
  console.log('📂 Procesando archivo de disponibilidad de bicicletas...');
  console.log(`📍 Archivo: ${DATA_FILE}\n`);

  return new Promise((resolve, reject) => {
    const records = [];
    const stream = fs.createReadStream(DATA_FILE)
      .pipe(csv({ separator: ';' }));

    stream.on('data', (row) => {
      totalProcessed++;

      try {
        const transformedData = validateAndTransformRow(row, totalProcessed);
        records.push(transformedData);

        // Imprimir progreso cada 50 registros
        if (totalProcessed % 50 === 0) {
          process.stdout.write(`\r📊 Procesados: ${totalProcessed} registros`);
        }

      } catch (error) {
        totalErrors++;
        if (totalErrors <= 5) { // Solo mostrar primeros 5 errores
          console.error(`\n⚠️  ${error.message}`);
        }
      }
    });

    stream.on('end', async () => {
      console.log(`\n\n✅ Lectura completada: ${totalProcessed} registros procesados`);
      console.log(`📝 Registros válidos: ${records.length}`);
      console.log(`❌ Errores: ${totalErrors}\n`);

      if (records.length === 0) {
        console.log('⚠️  No hay registros válidos para insertar');
        return resolve();
      }

      // Verificar duplicados
      console.log('🔍 Verificando duplicados...');
      const dates = records.map(r => r.dia);
      const existingDatesSet = await checkDuplicates(dates);

      // Filtrar registros que ya existen
      const newRecords = records.filter(record => {
        const isDuplicate = existingDatesSet.has(record.dia.toISOString());
        if (isDuplicate) {totalSkipped++;}
        return !isDuplicate;
      });

      if (newRecords.length === 0) {
        console.log('✅ Todos los registros ya existen en la base de datos');
        return resolve();
      }

      console.log(`✅ Registros nuevos a insertar: ${newRecords.length}`);
      console.log(`⏭️  Registros duplicados omitidos: ${totalSkipped}\n`);

      // Insertar en lotes
      console.log('💾 Insertando datos en la base de datos...');

      try {
        for (let i = 0; i < newRecords.length; i += BATCH_SIZE) {
          const batch = newRecords.slice(i, i + BATCH_SIZE);

          await BikeAvailability.insertMany(batch, {
            ordered: false,
            rawResult: false
          });

          totalInserted += batch.length;

          const progress = Math.round((totalInserted / newRecords.length) * 100);
          process.stdout.write(`\r💾 Insertados: ${totalInserted}/${newRecords.length} (${progress}%)`);
        }

        console.log('\n');
        resolve();

      } catch (error) {
        if (error.code === 11000) {
          // Error de duplicado - contar cuántos se insertaron exitosamente
          const insertedCount = error.result?.nInserted || 0;
          totalInserted += insertedCount;
          console.log(`\n⚠️  Algunos duplicados encontrados durante la inserción`);
          resolve();
        } else {
          console.error('\n❌ Error durante la inserción:', error.message);
          reject(error);
        }
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
  console.log('═'.repeat(50));
  console.log(`📥 Total procesados:        ${totalProcessed}`);
  console.log(`✅ Total insertados:        ${totalInserted}`);
  console.log(`⏭️  Total omitidos:          ${totalSkipped}`);
  console.log(`❌ Total errores:           ${totalErrors}`);
  console.log('═'.repeat(50));

  // Estadísticas de la base de datos
  const totalInDB = await BikeAvailability.countDocuments();
  const minDate = await BikeAvailability.findOne().sort({ dia: 1 }).select('dia');
  const maxDate = await BikeAvailability.findOne().sort({ dia: -1 }).select('dia');

  console.log('\n📚 ESTADO DE LA BASE DE DATOS:');
  console.log('═'.repeat(50));
  console.log(`📝 Total registros en DB:   ${totalInDB}`);
  if (minDate && maxDate) {
    console.log(`📅 Fecha más antigua:       ${minDate.dia.toISOString().split('T')[0]}`);
    console.log(`📅 Fecha más reciente:      ${maxDate.dia.toISOString().split('T')[0]}`);
  }
  console.log('═'.repeat(50) + '\n');
}

/**
 * Función principal
 */
async function main() {
  console.log('\n' + '═'.repeat(60));
  console.log('  🚲 IMPORTACIÓN DE DISPONIBILIDAD DE BICICLETAS');
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
