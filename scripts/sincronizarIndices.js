/**
 * Sincronizacion de Indices con el Esquema
 *
 * Garantiza que TODOS los indices declarados en los schemas de Mongoose existan
 * en la base de datos, ejecutando `Model.syncIndexes()` sobre cada modelo.
 *
 * Motivacion: en produccion `autoIndex` esta DESACTIVADO (ver src/config/database.js),
 * por lo que Mongoose NO crea los indices al vuelo. El script de importacion masiva
 * solo gestiona explicitamente los indices de las colecciones pesadas de Fase 3
 * (trafico, censo, multas); el resto de colecciones (Fase 1/2) y las de
 * autenticacion (users, token_blacklist) dependerian de autoIndex. Este script
 * cierra ese hueco de forma determinista y verificable, imprescindible al poblar
 * un cluster nuevo (por ejemplo MongoDB Atlas).
 *
 * `syncIndexes()` deja la coleccion EXACTAMENTE igual al schema: crea los que
 * faltan y elimina los que no esten declarados. Sobre una BD recien importada solo
 * deberia crear los que falten; cualquier indice eliminado se reporta para auditoria.
 *
 * Uso: node scripts/sincronizarIndices.js
 *
 * La URI de conexion se toma de DATABASE_URI (igual que el resto de la app y de
 * los importadores), de modo que apunta a la misma BD que se este usando (local
 * o Atlas) sin configuracion adicional.
 */

'use strict';

process.env.SCRIPT_MODE = 'true';

const mongoose = require('mongoose');
const logger = require('../src/config/scriptLogger');
const appConfig = require('../src/config/config');
const { connectDB } = require('../src/config/database');

/**
 * Modelos a sincronizar. Se listan explicitamente (no hay barrel de modelos)
 * para que el conjunto sea visible y auditable. El nombre es solo para el
 * resumen en pantalla; la coleccion real la define cada schema.
 */
const MODELOS = [
  { nombre: 'Ubicaciones', modelo: require('../src/models/Ubicacion') },
  { nombre: 'Calidad del Aire', modelo: require('../src/models/CalidadAire') },
  { nombre: 'Ruido', modelo: require('../src/models/Ruido') },
  { nombre: 'Trafico', modelo: require('../src/models/Trafico') },
  { nombre: 'Censo', modelo: require('../src/models/Censo') },
  { nombre: 'Contenedores', modelo: require('../src/models/Contenedor') },
  { nombre: 'Multas', modelo: require('../src/models/Multa') },
  { nombre: 'Accidentes', modelo: require('../src/models/Accidente') },
  { nombre: 'Patinetes', modelo: require('../src/models/AsignacionPatinetes') },
  { nombre: 'Bicicletas', modelo: require('../src/models/DisponibilidadBicicletas') },
  { nombre: 'Aforo Bicicletas', modelo: require('../src/models/AforoBicicletas') },
  { nombre: 'Aforo Peatones', modelo: require('../src/models/AforoPeatones') },
  { nombre: 'Usuarios', modelo: require('../src/models/User') },
  { nombre: 'Token Blacklist', modelo: require('../src/models/TokenBlacklist') }
];

// Helpers de salida al terminal (UX de CLI, no logging; ver nota en importAll.js).
const imprimir = (mensaje = '') => process.stdout.write(`${mensaje}\n`);
const imprimirError = (mensaje = '') => process.stderr.write(`${mensaje}\n`);

/**
 * Sincronizar los indices de un modelo y devolver un resumen del resultado.
 *
 * @param {string} nombre - Nombre legible del modelo
 * @param {mongoose.Model} Modelo - Modelo de Mongoose
 * @returns {Promise<Object>} Resumen { nombre, coleccion, total, eliminados, error }
 */
async function sincronizarModelo(nombre, Modelo) {
  const coleccion = Modelo.collection.name;
  try {
    // syncIndexes devuelve los nombres de los indices que ha ELIMINADO por no
    // estar en el schema. createIndexes (interno) construye los que faltan.
    const eliminados = await Modelo.syncIndexes();
    const indicesActuales = await Modelo.collection.indexes();

    logger.info({
      coleccion,
      totalIndices: indicesActuales.length,
      eliminados
    }, `Indices sincronizados: ${nombre}`);

    return { nombre, coleccion, total: indicesActuales.length, eliminados, error: null };
  } catch (error) {
    logger.error({ coleccion, error: error.message, stack: error.stack }, `Error sincronizando indices: ${nombre}`);
    return { nombre, coleccion, total: 0, eliminados: [], error: error.message };
  }
}

/**
 * Funcion principal
 */
async function main() {
  imprimir('\n=== Sincronizacion de Indices con el Esquema ===\n');

  await connectDB(appConfig.database.uri);

  const resultados = [];
  for (const { nombre, modelo } of MODELOS) {
    const resumen = await sincronizarModelo(nombre, modelo);
    resultados.push(resumen);

    const estado = resumen.error ? '[ERROR]' : '[OK]';
    const detalleEliminados = resumen.eliminados.length > 0
      ? ` | eliminados: ${resumen.eliminados.join(', ')}`
      : '';
    imprimir(`  ${estado} ${nombre.padEnd(18)} ${String(resumen.total).padStart(2)} indices (col: ${resumen.coleccion})${detalleEliminados}`);
    if (resumen.error) {
      imprimir(`           -> ${resumen.error}`);
    }
  }

  const conError = resultados.filter(r => r.error);
  const totalIndices = resultados.reduce((acc, r) => acc + r.total, 0);

  imprimir('\n=== Resumen ===\n');
  imprimir(`  Modelos sincronizados: ${resultados.length - conError.length}/${resultados.length}`);
  imprimir(`  Total de indices:      ${totalIndices}`);
  if (conError.length > 0) {
    imprimir(`  Modelos con error:     ${conError.map(r => r.nombre).join(', ')}`);
  }
  imprimir('');

  if (mongoose.connection.readyState === 1) {
    await mongoose.connection.close();
  }

  process.exit(conError.length > 0 ? 1 : 0);
}

main().catch(error => {
  imprimirError(`\nError fatal en sincronizacion de indices: ${error.message}`);
  logger.fatal({ error: error.message, stack: error.stack }, 'Error fatal en sincronizarIndices');
  process.exit(1);
});
