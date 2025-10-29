/**
 * Script de Importación de Asignación de Patinetes
 *
 * Script especializado para importar datos CSV de asignación de patinetes
 * eléctricos a la base de datos MongoDB. Procesa el archivo de asignación
 * del directorio datos_hpe/
 */

const fs = require('fs').promises;
const path = require('path');
const csv = require('csv-parser');
const { createReadStream } = require('fs');
const mongoose = require('mongoose');
const { connectDB } = require('../../src/config/database');
const config = require('../../src/config/config');
const ScooterAssignment = require('../../src/models/ScooterAssignment');

/**
 * Configuración del importador
 */
const IMPORT_CONFIG = {
  dataFile: path.join(__dirname, '..', '..', 'datos_hpe', 'Anthem_CTC_AsignaciónPatinetes.csv'),
  batchSize: 100,
  skipExisting: true,
  csvOptions: {
    separator: ';',
    headers: true,
    skipEmptyLines: true,
    skipLinesWithError: true
  }
};

/**
 * Mapeo de nombres de proveedores para normalización
 */
const PROVIDER_NAME_MAPPING = {
  'ACCIONA': 'ACCIONA',
  'Taxify': 'TAXIFY',
  'KOKO': 'KOKO',
  'UFO': 'UFO',
  'RIDECONGA': 'RIDECONGA',
  'FLASH': 'FLASH',
  'LIME': 'LIME',
  'WIND ': 'WIND', // Nota: hay un espacio extra en el CSV original
  'WIND': 'WIND',
  'BIRD': 'BIRD',
  'REBY RIDES': 'REBY RIDES',
  'MOVO': 'MOVO',
  'MYGO': 'MYGO',
  'JUMP UBER': 'JUMP UBER',
  'SJV CONSULTING': 'SJV CONSULTING'
};

/**
 * Campos que deben ignorarse (no son proveedores)
 */
const IGNORED_FIELDS = [
  'DISTRITO',
  'BARRIO',
  'TOTAL',
  '',
  ' ', // Campos vacíos
  'Total' // Filas de totales
];

/**
 * Parsear datos de una fila CSV de asignación de patinetes
 * @param {Object} row - Fila del CSV
 * @param {string} sourceFile - Archivo origen
 * @returns {Object|null} - Datos procesados para la asignación o null si es fila inválida
 */
function parseScooterAssignmentRow(row, sourceFile) {
  try {
    // Debug: mostrar la fila actual cada 20 filas para debug
    if (Math.random() < 0.1) { // 10% de probabilidad para reducir spam
      console.log('🔍 Debug fila:', {
        DISTRITO: row.DISTRITO,
        BARRIO: row.BARRIO,
        keysDisponibles: Object.keys(row).slice(0, 5)
      });
    }

    // Limpiar y validar campos básicos
    const cleanString = (value, defaultValue = '') => {
      if (!value) {return defaultValue;}
      return value.toString().trim() || defaultValue;
    };

    const parseNumber = (value, defaultValue = 0) => {
      if (!value || value.toString().trim() === '') {return defaultValue;}
      const cleaned = value.toString().replace(/['"]/g, '').trim();
      const parsed = parseInt(cleaned);
      return isNaN(parsed) ? defaultValue : Math.max(0, parsed);
    };

    const distrito = cleanString(row.DISTRITO).toUpperCase();
    const barrio = cleanString(row.BARRIO);

    // Validar campos obligatorios
    if (!distrito || !barrio) {
      console.warn(`⚠️  Fila ignorada - Distrito o barrio vacío: ${distrito} - ${barrio}`);
      return null;
    }

    // Ignorar filas de totales
    if (distrito.includes('TOTAL') || barrio.includes('Total') || barrio.toLowerCase().includes('total')) {
      console.log(`📊 Fila de total ignorada: ${distrito} - ${barrio}`);
      return null;
    }

    // Procesar proveedores
    const proveedores = [];
    let totalCalculado = 0;

    // Iterar sobre todas las columnas para encontrar proveedores
    Object.keys(row).forEach(columnName => {
      const cleanColumnName = cleanString(columnName);

      // Ignorar campos que no son proveedores
      if (IGNORED_FIELDS.includes(cleanColumnName) ||
          IGNORED_FIELDS.includes(columnName) ||
          cleanColumnName === distrito ||
          cleanColumnName === barrio) {
        return;
      }

      // Mapear nombre del proveedor
      const proveedorNombre = PROVIDER_NAME_MAPPING[cleanColumnName] ||
                             PROVIDER_NAME_MAPPING[columnName] ||
                             cleanColumnName;

      if (proveedorNombre && proveedorNombre.length > 0) {
        const cantidad = parseNumber(row[columnName]);

        // Solo agregar proveedores que tengan datos válidos
        if (cantidad >= 0) {
          proveedores.push({
            nombre: proveedorNombre,
            cantidad: cantidad,
            activo: cantidad > 0
          });
          totalCalculado += cantidad;
        }
      }
    });

    // Validar que hay al menos un proveedor
    if (proveedores.length === 0) {
      console.warn(`⚠️  Fila ignorada - Sin proveedores válidos: ${distrito} - ${barrio}`);
      return null;
    }

    // Verificar total si existe en el CSV
    const totalCSV = parseNumber(row.TOTAL);
    if (totalCSV > 0 && totalCalculado !== totalCSV) {
      console.warn(`⚠️  Discrepancia en total para ${distrito}-${barrio}: Calculado=${totalCalculado}, CSV=${totalCSV}`);
    }

    // Crear fecha de asignación (usar fecha actual como predeterminada)
    const fechaAsignacion = new Date();

    const assignmentData = {
      fechaAsignacion,
      distrito: {
        nombre: distrito
      },
      barrio: {
        nombre: barrio
      },
      proveedores,
      estadisticas: {
        totalPatinetes: totalCalculado
      },
      procesamiento: {
        archivoOrigen: path.basename(sourceFile),
        importadoEn: new Date(),
        versionDatos: '1.0'
      }
    };

    return assignmentData;

  } catch (error) {
    console.error(`❌ Error procesando fila: ${JSON.stringify(row)}`, error.message);
    return null;
  }
}

/**
 * Función principal de importación
 */
async function importScooterAssignments() {
  console.log('🛴 Iniciando importación de asignación de patinetes...\n');

  let connection;
  try {
    // Conectar a la base de datos
    connection = await connectDB(config.database.uri);
    console.log('✅ Conexión a MongoDB establecida\n');

    // Verificar que el archivo existe
    console.log(`📂 Ruta del archivo: ${IMPORT_CONFIG.dataFile}`);
    try {
      await fs.access(IMPORT_CONFIG.dataFile);
      console.log('✅ Archivo encontrado');
    } catch (error) {
      throw new Error(`Archivo no encontrado: ${IMPORT_CONFIG.dataFile}`);
    }

    console.log(`📂 Procesando archivo: ${path.basename(IMPORT_CONFIG.dataFile)}`);

    // Estadísticas de importación
    const stats = {
      totalFilas: 0,
      filasValidas: 0,
      filasIgnoradas: 0,
      errores: 0,
      insertados: 0,
      duplicados: 0,
      actualizados: 0
    };

    // Crear array para acumular documentos
    const batch = [];

    // Crear promesa para procesar el CSV
    const processCSV = new Promise((resolve, reject) => {
      const stream = createReadStream(IMPORT_CONFIG.dataFile)
        .pipe(csv({ separator: ';' })); // Usar configuración simple y consistente

      stream.on('data', (row) => {
        stats.totalFilas++;

        // Procesar fila
        const assignmentData = parseScooterAssignmentRow(row, IMPORT_CONFIG.dataFile);

        if (assignmentData) {
          batch.push(assignmentData);
          stats.filasValidas++;

          // Procesar batch cuando alcance el tamaño configurado
          if (batch.length >= IMPORT_CONFIG.batchSize) {
            // No procesamos aquí para evitar problemas de async
            // Se procesará al final
          }
        } else {
          stats.filasIgnoradas++;
        }

        // Mostrar progreso cada 20 filas
        if (stats.totalFilas % 20 === 0) {
          console.log(`📊 Progreso: ${stats.totalFilas} filas procesadas, ${stats.filasValidas} válidas, ${stats.filasIgnoradas} ignoradas`);
        }
      });

      stream.on('end', async () => {
        // Procesar batch final
        if (batch.length > 0) {
          await processBatch(batch, stats);
        }
        resolve();
      });

      stream.on('error', (error) => {
        reject(error);
      });
    });

    // Procesar el archivo CSV
    await processCSV;

    // Mostrar resumen final
    console.log('\n📊 RESUMEN DE IMPORTACIÓN:');
    console.log('================================');
    console.log(`📄 Total de filas procesadas: ${stats.totalFilas}`);
    console.log(`✅ Filas válidas: ${stats.filasValidas}`);
    console.log(`⏭️  Filas ignoradas: ${stats.filasIgnoradas} (incluye ${stats.filasIgnoradas} filas de totales por distrito)`);
    console.log(`❌ Errores: ${stats.errores}`);
    console.log(`➕ Registros insertados: ${stats.insertados}`);
    console.log(`🔄 Registros actualizados: ${stats.actualizados}`);
    console.log(`🔁 Duplicados encontrados: ${stats.duplicados}`);

    // Explicar la discrepancia
    const procesados = stats.insertados + stats.actualizados + stats.duplicados;
    console.log(`\n🔍 ANÁLISIS DE DISCREPANCIAS:`);
    console.log(`   📊 Total procesados efectivamente: ${procesados}`);
    console.log(`   ⚠️  Diferencia con filas válidas: ${stats.filasValidas - procesados} (por errores de BD)`);
    if (stats.duplicados > 0) {
      console.log(`   ℹ️  Nota: ${stats.duplicados} duplicados fueron ignorados (configuración actual)`);
    }

    // Obtener estadísticas finales de la base de datos
    const totalRegistros = await ScooterAssignment.countDocuments();
    const totalPatinetes = await ScooterAssignment.aggregate([
      {
        $group: {
          _id: null,
          total: { $sum: '$estadisticas.totalPatinetes' }
        }
      }
    ]);

    console.log('\n📈 ESTADÍSTICAS DE LA BASE DE DATOS:');
    console.log('====================================');
    console.log(`📍 Total de asignaciones en BD: ${totalRegistros}`);
    console.log(`🛴 Total de patinetes registrados: ${totalPatinetes[0]?.total || 0}`);

    // Mostrar algunos ejemplos de datos importados
    const ejemplos = await ScooterAssignment.find()
      .sort({ 'estadisticas.totalPatinetes': -1 })
      .limit(5)
      .select('distrito.nombre barrio.nombre estadisticas.totalPatinetes estadisticas.densidadPatinetes');

    if (ejemplos.length > 0) {
      console.log('\n🏆 TOP 5 ÁREAS CON MÁS PATINETES:');
      console.log('=================================');
      ejemplos.forEach((area, index) => {
        console.log(`${index + 1}. ${area.distrito.nombre} - ${area.barrio.nombre}: ${area.estadisticas.totalPatinetes} patinetes (${area.estadisticas.densidadPatinetes})`);
      });
    }

    console.log('\n✅ Importación de asignación de patinetes completada exitosamente!');

  } catch (error) {
    console.error('\n❌ Error durante la importación:', error.message);
    throw error;
  } finally {
    // Cerrar conexión MongoDB
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
      console.log('\n🔌 Conexión a MongoDB cerrada');
    }
  }
}

/**
 * Procesar un batch de documentos
 * @param {Array} batch - Array de documentos a procesar
 * @param {Object} stats - Objeto de estadísticas
 */
async function processBatch(batch, stats) {
  console.log(`\n🔄 Procesando batch de ${batch.length} asignaciones...`);

  try {
    for (const assignmentData of batch) {
      try {
        // Buscar documento existente
        const existingDoc = await ScooterAssignment.findOne({
          'distrito.nombre': assignmentData.distrito.nombre,
          'barrio.nombre': assignmentData.barrio.nombre
        });

        if (existingDoc) {
          if (IMPORT_CONFIG.skipExisting) {
            stats.duplicados++;
            console.log(`🔁 Duplicado ignorado: ${assignmentData.distrito.nombre} - ${assignmentData.barrio.nombre}`);
            continue;
          } else {
            // Actualizar documento existente
            await ScooterAssignment.findByIdAndUpdate(
              existingDoc._id,
              assignmentData,
              { new: true, runValidators: true }
            );
            stats.actualizados++;
            console.log(`🔄 Actualizado: ${assignmentData.distrito.nombre} - ${assignmentData.barrio.nombre}`);
          }
        } else {
          // Crear nuevo documento
          const newAssignment = new ScooterAssignment(assignmentData);
          await newAssignment.save();
          stats.insertados++;
          console.log(`➕ Insertado: ${assignmentData.distrito.nombre} - ${assignmentData.barrio.nombre} (${assignmentData.estadisticas.totalPatinetes} patinetes)`);
        }

      } catch (error) {
        stats.errores++;
        console.error(`❌ Error procesando ${assignmentData.distrito.nombre} - ${assignmentData.barrio.nombre}:`, error.message);
      }
    }

  } catch (error) {
    stats.errores += batch.length;
    console.error(`❌ Error procesando batch:`, error.message);
  }
}

/**
 * Función para validar la estructura del archivo CSV
 */
async function validateCSVStructure() {
  console.log('🔍 Validando estructura del archivo CSV...\n');

  return new Promise((resolve, reject) => {
    const headers = [];
    let firstRow = null;
    let rowCount = 0;

    const stream = createReadStream(IMPORT_CONFIG.dataFile)
      .pipe(csv({ separator: ';', maxRows: 5 }));

    stream.on('headers', (headerList) => {
      headers.push(...headerList);
      console.log('📋 Headers detectados:', headerList);
    });

    stream.on('data', (row) => {
      rowCount++;
      if (rowCount === 1) {
        firstRow = row;
        console.log('� Primera fila de ejemplo:', row);
      }
    });

    stream.on('end', () => {
      console.log(`� Total de filas de muestra procesadas: ${rowCount}`);

      // Verificar que tiene los campos mínimos esperados
      const requiredFields = ['DISTRITO', 'BARRIO'];
      const missingFields = requiredFields.filter(field => !headers.includes(field));

      if (missingFields.length > 0) {
        reject(new Error(`Campos obligatorios faltantes: ${missingFields.join(', ')}`));
      } else {
        console.log('✅ Estructura del CSV válida\n');
        resolve({ headers, firstRow });
      }
    });

    stream.on('error', (error) => {
      console.error('❌ Error leyendo CSV:', error.message);
      reject(error);
    });
  });
}

/**
 * Función principal con manejo de argumentos
 */
async function main() {
  // Manejo de señales para cerrar conexión limpiamente
  process.on('SIGINT', async () => {
    console.log('\n\n🛑 Interrupción recibida. Cerrando conexiones...');
    if (mongoose.connection.readyState === 1) {
      try {
        await mongoose.connection.close();
        console.log('🔌 Conexión cerrada');
      } catch (error) {
        console.error('Error cerrando conexión:', error.message);
      }
    }
    process.exit(130);
  });

  try {
    console.log('🛴 IMPORTADOR DE ASIGNACIÓN DE PATINETES ELÉCTRICOS');
    console.log('==================================================\n');

    // Validar estructura del archivo
    await validateCSVStructure();

    // Verificar argumentos de línea de comandos
    const args = process.argv.slice(2);
    if (args.includes('--help') || args.includes('-h')) {
      console.log('💡 USO DEL SCRIPT:');
      console.log('==================');
      console.log('node importScooterAssignments.js [opciones]');
      console.log('');
      console.log('Opciones:');
      console.log('  --help, -h              Mostrar esta ayuda');
      console.log('  --force                 Sobrescribir registros existentes');
      console.log('  --batch-size <número>   Tamaño del batch (default: 100)');
      console.log('');
      console.log('Ejemplos:');
      console.log('  node importScooterAssignments.js');
      console.log('  node importScooterAssignments.js --force');
      console.log('  node importScooterAssignments.js --batch-size 50');
      return;
    }

    // Procesar argumentos
    if (args.includes('--force')) {
      IMPORT_CONFIG.skipExisting = false;
      console.log('🔄 Modo forzado activado - Se sobrescribirán registros existentes\n');
    }

    const batchSizeIndex = args.indexOf('--batch-size');
    if (batchSizeIndex !== -1 && args[batchSizeIndex + 1]) {
      const batchSize = parseInt(args[batchSizeIndex + 1]);
      if (!isNaN(batchSize) && batchSize > 0) {
        IMPORT_CONFIG.batchSize = batchSize;
        console.log(`📦 Tamaño de batch personalizado: ${batchSize}\n`);
      }
    }

    // Ejecutar importación
    await importScooterAssignments();

  } catch (error) {
    console.error('\n💥 Error fatal:', error.message);
    process.exit(1);
  }
}

// Ejecutar si el script se llama directamente
if (require.main === module) {
  main();
}

module.exports = {
  importScooterAssignments,
  parseScooterAssignmentRow,
  IMPORT_CONFIG
};
