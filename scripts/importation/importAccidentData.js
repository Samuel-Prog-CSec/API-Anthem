/**
 * Script de Importación de Datos de Accidentalidad
 *
 * Procesa y carga datos de accidentes desde el archivo CSV a la base de datos MongoDB.
 * Incluye validación de datos, transformación, normalización y manejo de errores.
 *
 * Uso: node scripts/importation/importAccidentData.js
 */

const fs = require('fs').promises;
const path = require('path');
const csv = require('csv-parser');
const { createReadStream } = require('fs');
const mongoose = require('mongoose');

// Importar modelos y configuración
const Accident = require('../../src/models/Accident');
const config = require('../../src/config/config');

// Configuraciones
const DATA_FILE = path.join(__dirname, '../../datos_hpe/Anthem_CTC_Accidentalidad.csv');
const BATCH_SIZE = 1000;

// Contadores globales
let totalProcessed = 0;
let totalInserted = 0;
let totalSkipped = 0;
let totalErrors = 0;

// Mapas de normalización
const TIPO_ACCIDENTE_MAP = {
  'colisión doble': 'COLISION_DOBLE',
  'colisión múltiple': 'COLISION_MULTIPLE',
  'colisión fronto-lateral': 'COLISION_FRONTO_LATERAL',
  'alcance': 'ALCANCE',
  'choque contra obstáculo': 'CHOQUE_OBSTACULO',
  'choque contra obstáculo fijo': 'CHOQUE_OBSTACULO_FIJO',
  'atropello a persona': 'ATROPELLO_PERSONA',
  'vuelco': 'VUELCO',
  'caída': 'CAIDA',
  'otras causas': 'OTRAS_CAUSAS'
};

const TIPO_VEHICULO_MAP = {
  'turismo': 'TURISMO',
  'motocicleta': 'MOTOCICLETA',
  'ciclomotor': 'CICLOMOTOR',
  'bicicleta': 'BICICLETA',
  'autobús': 'AUTOBUS',
  'autobus': 'AUTOBUS',
  'camión': 'CAMION',
  'camion': 'CAMION',
  'furgoneta': 'FURGONETA',
  'taxi': 'TAXI',
  'ambulancia': 'AMBULANCIA'
};

const TIPO_PERSONA_MAP = {
  'conductor': 'CONDUCTOR',
  'peatón': 'PEATON',
  'peaton': 'PEATON',
  'testigo': 'TESTIGO',
  'viajero': 'VIAJERO',
  'pasajero': 'PASAJERO'
};

const ESTADO_METEOROLOGICO_MAP = {
  'despejado': 'DESPEJADO',
  'nublado': 'NUBLADO',
  'lluvia': 'LLUVIA_LIGERA',
  'lluvia ligera': 'LLUVIA_LIGERA',
  'lluvia intensa': 'LLUVIA_INTENSA',
  'niebla': 'NIEBLA',
  'viento fuerte': 'VIENTO_FUERTE',
  'granizo': 'GRANIZO',
  'nieve': 'NIEVE',
  'null': 'NULL',
  '': 'DESCONOCIDO'
};

/**
 * Conectar a la base de datos
 */
async function connectDatabase() {
  try {
    await mongoose.connect(config.database.uri);
    console.log('✓ Conexión a MongoDB establecida');
    return true;
  } catch (error) {
    console.log('✗ Error conectando a MongoDB:', error.message);
    return false;
  }
}

/**
 * Limpiar datos existentes si se solicita
 */
async function cleanExistingData() {
  console.log('🧹 Limpiando datos existentes...');
  const result = await Accident.deleteMany({});
  console.log(`  ✓ Eliminados ${result.deletedCount} registros existentes`);
}

/**
 * Normalizar tipo de accidente
 */
function normalizeAccidentType(tipo) {
  if (!tipo || tipo.trim() === '') {return 'OTRAS_CAUSAS';}

  const normalized = tipo.toLowerCase().trim();
  return TIPO_ACCIDENTE_MAP[normalized] || 'OTRAS_CAUSAS';
}

/**
 * Normalizar tipo de vehículo
 */
function normalizeVehicleType(tipo) {
  if (!tipo || tipo.trim() === '') {return 'OTROS';}

  const normalized = tipo.toLowerCase().trim();
  return TIPO_VEHICULO_MAP[normalized] || 'OTROS';
}

/**
 * Normalizar tipo de persona
 */
function normalizePersonType(tipo) {
  if (!tipo || tipo.trim() === '') {return 'CONDUCTOR';}

  const normalized = tipo.toLowerCase().trim();
  return TIPO_PERSONA_MAP[normalized] || 'CONDUCTOR';
}

/**
 * Normalizar estado meteorológico
 */
function normalizeWeatherState(estado) {
  if (!estado || estado.trim() === '') {return 'DESCONOCIDO';}

  const normalized = estado.toLowerCase().trim();
  return ESTADO_METEOROLOGICO_MAP[normalized] || 'DESCONOCIDO';
}

/**
 * Parsear y validar coordenadas
 */
function parseCoordinates(xStr, yStr) {
  try {
    if (!xStr || !yStr || xStr.trim() === '' || yStr.trim() === '') {
      return null;
    }

    // Reemplazar comas por puntos para decimales
    const x = parseFloat(xStr.replace(',', '.'));
    const y = parseFloat(yStr.replace(',', '.'));

    if (isNaN(x) || isNaN(y)) {
      return null;
    }

    // Validar rangos para coordenadas UTM de España
    if (x < 100000 || x > 1000000 || y < 3000000 || y > 5000000) {
      console.log(`Coordenadas fuera de rango: (${x}, ${y})`);
      return null;
    }

    return { x, y };

  } catch (error) {
    console.log(`Error parseando coordenadas (${xStr}, ${yStr}):`, error.message);
    return null;
  }
}

/**
 * Parsear fecha del formato DD/MM/YYYY
 */
function parseDate(fechaStr) {
  try {
    if (!fechaStr || fechaStr.trim() === '') {
      throw new Error('Fecha vacía');
    }

    const parts = fechaStr.trim().split('/');
    if (parts.length !== 3) {
      throw new Error(`Formato de fecha inválido: ${fechaStr}`);
    }

    const [day, month, year] = parts.map(p => parseInt(p));

    if (isNaN(day) || isNaN(month) || isNaN(year)) {
      throw new Error(`Componentes de fecha inválidos: ${fechaStr}`);
    }

    if (day < 1 || day > 31 || month < 1 || month > 12 || year < 2000 || year > 3000) {
      throw new Error(`Fecha fuera de rango: ${fechaStr}`);
    }

    const date = new Date(year, month - 1, day); // month es 0-based en Date

    if (isNaN(date.getTime())) {
      throw new Error(`Fecha inválida: ${fechaStr}`);
    }

    return date;

  } catch (error) {
    throw new Error(`Error parseando fecha "${fechaStr}": ${error.message}`);
  }
}

/**
 * Validar y transformar una fila de datos de accidente
 */
function validateAndTransformRow(row, rowIndex) {
  try {
    // Acceder a los campos por índice
    // 0: num_expediente, 1: fecha, 2: hora, 3: localizacion, 4: numero
    // 5: cod_distrito, 6: distrito, 7: tipo_accidente, 8: estado_meteorológico, 9: tipo_vehiculo
    // 10: tipo_persona, 11: rango_edad, 12: sexo, 13: cod_lesividad, 14: lesividad
    // 15: coordenada_x_utm, 16: coordenada_y_utm, 17: positiva_alcohol, 18: positiva_droga

    const numeroExpediente = row['0']?.toString().trim();
    if (!numeroExpediente || !/^\d{4}S\d{6}$/.test(numeroExpediente)) {
      throw new Error(`Número de expediente inválido: ${numeroExpediente}`);
    }

    // Parsear fecha
    const fechaStr = row['1']?.toString().trim();
    const fecha = parseDate(fechaStr);

    // Parsear hora
    const hora = row['2']?.toString().trim();
    if (!hora || !/^\d{1,2}:\d{2}:\d{2}$/.test(hora)) {
      throw new Error(`Formato de hora inválido: ${hora}`);
    }

    // Datos de ubicación
    const calle = row['3']?.toString().trim();
    if (!calle) {
      throw new Error('Localización faltante');
    }

    const numero = row['4']?.toString().trim() || null;
    const codigoDistrito = row['5']?.toString().trim();
    const nombreDistrito = row['6']?.toString().trim().toUpperCase();

    if (!codigoDistrito || !nombreDistrito) {
      throw new Error('Datos de distrito incompletos');
    }

    // Parsear coordenadas
    const coordenadas = parseCoordinates(row['15'], row['16']);

    // Datos del accidente
    const tipoAccidenteOriginal = row['7']?.toString().trim();
    const tipoAccidente = normalizeAccidentType(tipoAccidenteOriginal);

    const estadoMeteorologico = normalizeWeatherState(row['8']?.toString().trim());

    // Datos del vehículo
    const tipoVehiculoOriginal = row['9']?.toString().trim();
    const tipoVehiculo = normalizeVehicleType(tipoVehiculoOriginal);

    // Datos de la persona afectada
    const tipoPersona = normalizePersonType(row['10']?.toString().trim());
    const rangoEdad = row['11']?.toString().trim() || 'Desconocido';
    const sexoRaw = row['12']?.toString().trim().toUpperCase();
    const sexo = (sexoRaw === 'MUJER') ? 'MUJER' : (sexoRaw === 'HOMBRE') ? 'HOMBRE' : 'NO_ASIGNADO';

    // Datos de lesividad
    const codigoLesividad = row['13']?.toString().trim();
    const lesividad = row['14']?.toString().trim();

    // Mapear tipo de lesión basado en código o descripción
    let tipoLesion = 'DESCONOCIDO';
    if (codigoLesividad && codigoLesividad !== 'NULL') {
      const codigoMap = {
        '01': 'LEVE', '02': 'LEVE', '05': 'LEVE', '06': 'LEVE', '07': 'LEVE',
        '03': 'GRAVE',
        '04': 'FALLECIDO',
        '14': 'SIN_ASISTENCIA',
        '77': 'DESCONOCIDO'
      };
      tipoLesion = codigoMap[codigoLesividad] || 'DESCONOCIDO';
    } else if (lesividad && lesividad !== 'NULL') {
      if (lesividad.toLowerCase().includes('fallec')) {tipoLesion = 'FALLECIDO';}
      else if (lesividad.toLowerCase().includes('grave')) {tipoLesion = 'GRAVE';}
      else if (lesividad.toLowerCase().includes('leve')) {tipoLesion = 'LEVE';}
    }

    // Datos de sustancias
    const alcoholRaw = row['17']?.toString().trim().toUpperCase();
    const positivaAlcohol = (alcoholRaw === 'S') ? 'S' : (alcoholRaw === 'N') ? 'N' : 'NULL';

    const drogaRaw = row['18']?.toString().trim().toUpperCase();
    const positivaDroga = (drogaRaw === 'S') ? 'S' : (drogaRaw === 'N') ? 'N' : 'NULL';

    // Construir objeto de accidente
    const accidentData = {
      numeroExpediente,
      fecha,
      hora,

      ubicacion: {
        calle,
        numero,
        codigoDistrito,
        nombreDistrito,
        coordenadas
      },

      circunstancias: {
        tipoAccidenteOriginal,
        tipoAccidente,
        estadoMeteorologico
      },

      vehiculo: {
        tipoVehiculoOriginal,
        tipo: tipoVehiculo
      },

      personaAfectada: {
        tipoPersona,
        rangoEdad,
        sexo,
        codigoLesividad,
        tipoLesion,
        positivaAlcohol,
        positivaDroga
      },

      procesamiento: {
        archivoOrigen: 'Anthem_CTC_Accidentalidad.csv',
        importadoEn: new Date()
      }
    };

    return accidentData;

  } catch (error) {
    throw new Error(`Fila ${rowIndex}: ${error.message}`);
  }
}

/**
 * Procesar el archivo CSV de accidentes
 */
async function processAccidentFile() {
  return new Promise((resolve, reject) => {
    const batch = [];
    const errors = [];
    let rowCount = 0;
    let processedCount = 0;

    console.log(`Procesando archivo: ${path.basename(DATA_FILE)}`);

    const stream = createReadStream(DATA_FILE, { encoding: 'utf8' })
      .pipe(csv({
        separator: ';',
        skipEmptyLines: true,
        headers: false, // No usar header automático
        strict: false,
        quote: '"',
        escape: '"'
      }))
      .on('data', (row) => {
        rowCount++;
        totalProcessed++;

        // Saltar la primera fila (header)
        if (rowCount === 1) {
          return;
        }

        try {
          // Validar y transformar datos
          const accidentData = validateAndTransformRow(row, rowCount);

          batch.push(accidentData);
          processedCount++;

          // Procesar lote cuando alcance el tamaño configurado
          if (batch.length >= BATCH_SIZE) {
            stream.pause(); // Pausar lectura mientras procesamos
            processBatch(batch.splice(0))
              .then(() => stream.resume())
              .catch((error) => {
                errors.push(`Error en lote: ${error.message}`);
                stream.resume();
              });
          }

          // Mostrar progreso cada 100.000 registros
          if (processedCount % 100000 === 0) {
            console.log(`📊 Procesadas ${processedCount.toLocaleString()} filas...`);
          }

        } catch (error) {
          errors.push(error.message);
          totalErrors++;

          // Mostrar algunos errores como ejemplo
          if (errors.length <= 10) {
            console.log('Error de validación:', error.message);
          }

          // Abortar si hay demasiados errores
          if (errors.length > 100) {
            stream.destroy();
            return reject(new Error(`Demasiados errores (${errors.length}). Proceso abortado.`));
          }
        }
      })
      .on('end', async () => {
        try {
          // Procesar lote final
          if (batch.length > 0) {
            await processBatch(batch);
          }

          console.log(`\n✓ Archivo completado:`);
          console.log(`  Filas leídas: ${rowCount.toLocaleString()}`);
          console.log(`  Registros procesados: ${processedCount.toLocaleString()}`);
          console.log(`  Errores encontrados: ${errors.length}`);

          if (errors.length > 0 && errors.length <= 20) {
            console.log('\nPrimeros errores encontrados:');
            errors.slice(0, 20).forEach((error, index) => {
              console.log(`  ${index + 1}. ${error}`);
            });
          }

          resolve({
            totalRows: rowCount,
            processed: processedCount,
            errors: errors.length
          });

        } catch (error) {
          reject(error);
        }
      })
      .on('error', (error) => {
        reject(new Error(`Error leyendo archivo: ${error.message}`));
      });
  });
}

/**
 * Procesar un lote de datos de accidentes
 */
async function processBatch(batch) {
  try {
    const bulkOps = batch.map(accidentData => ({
      updateOne: {
        filter: { numeroExpediente: accidentData.numeroExpediente },
        update: { $set: accidentData },
        upsert: true
      }
    }));

    const result = await Accident.bulkWrite(bulkOps, { ordered: false });

    const newCount = result.upsertedCount || 0;
    const modifiedCount = result.modifiedCount || 0;

    totalInserted += newCount;
    totalSkipped += modifiedCount;

    console.log(`   ✅ Lote: ${newCount} nuevos, ${modifiedCount} actualizados`);

  } catch (error) {
    totalErrors += batch.length;
    console.log(`   ❌ Error insertando lote: ${error.message}`);
  }
}

/**
 * Verificar que el archivo existe
 */
async function checkDataFile() {
  try {
    await fs.access(DATA_FILE);
    return true;
  } catch (error) {
    throw new Error(`Archivo de datos no encontrado: ${DATA_FILE}`);
  }
}

/**
 * Mostrar resumen final
 */
function showSummary(startTime, result) {
  const endTime = Date.now();
  const duration = ((endTime - startTime) / 1000).toFixed(2);

  console.log('\n' + '='.repeat(60));
  console.log('RESUMEN DE IMPORTACIÓN DE ACCIDENTALIDAD');
  console.log('='.repeat(60));
  console.log(`Tiempo total: ${duration} segundos`);
  console.log(`Registros procesados: ${totalProcessed.toLocaleString()}`);
  console.log(`Registros insertados: ${totalInserted.toLocaleString()}`);
  console.log(`Registros duplicados: ${totalSkipped.toLocaleString()}`);
  console.log(`Errores encontrados: ${totalErrors.toLocaleString()}`);

  if (totalProcessed > 0) {
    console.log(`Tasa de éxito: ${((totalInserted / totalProcessed) * 100).toFixed(2)}%`);
    console.log(`Velocidad: ${(totalProcessed / parseFloat(duration)).toFixed(0)} registros/seg`);
  }

  console.log('='.repeat(60));

  // Información adicional
  if (totalInserted > 0) {
    console.log('\n📊 Para verificar los datos importados, puede ejecutar:');
    console.log('  - Total accidentes: db.accidents.countDocuments()');
    console.log('  - Por distrito: db.accidents.aggregate([{$group:{_id:"$ubicacion.nombreDistrito", total:{$sum:1}}}, {$sort:{total:-1}}])');
    console.log('  - Por gravedad: db.accidents.aggregate([{$group:{_id:"$circunstancias.gravedad", total:{$sum:1}}}])');
  }
}

/**
 * Función principal
 */
async function main() {
  const startTime = Date.now();

  try {
    console.log('🚨 Iniciando importación de accidentalidad...');

    await checkDataFile();

    if (!await connectDatabase()) {
      process.exit(1);
    }

    const result = await processAccidentFile();
    showSummary(startTime, result);

  } catch (error) {
    console.error('❌ Error crítico:', error.message);
    process.exit(1);
  } finally {
    // Cerrar conexión de forma segura
    if (mongoose.connection.readyState === 1) {
      try {
        await mongoose.connection.close();
        console.log('✅ Conexión a base de datos cerrada');
      } catch (error) {
        console.error('⚠️  Error cerrando conexión:', error.message);
      }
    }
  }
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
  console.error('Error no capturado:', error);
  console.error('Error no capturado:', error.message);
  process.exit(1);
});

// Ejecutar script si es llamado directamente
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { main, processAccidentFile, validateAndTransformRow };
