/**
 * Gestor de indices para importacion masiva
 *
 * Encapsula el drop y recreate de indices secundarios para acelerar la
 * insercion de grandes volumenes de datos. Mantener vivos los 9-16 indices
 * de las colecciones pesadas durante la insercion masiva multiplica el coste
 * de cada documento; es mas rapido dropearlos y recrearlos al final.
 *
 * Reglas:
 * - Fuente de verdad: estado real de la coleccion via collection.indexes(),
 *   no el schema (puede haber divergencia entre runs).
 * - Se conserva siempre _id_ y cualquier indice unique:true (protege contra
 *   duplicados durante el insert).
 * - Idempotente: errores de "indice no existe" se ignoran.
 */

'use strict';

/**
 * Listar indices secundarios reales de la coleccion
 * @param {mongoose.Model} Modelo
 * @returns {Promise<Array>} - Indices excluyendo _id_ y unique:true
 */
async function listarIndicesSecundarios(Modelo) {
  const indicesReales = await Modelo.collection.indexes();
  return indicesReales.filter(idx => idx.name !== '_id_' && idx.unique !== true);
}

/**
 * Dropear indices secundarios. _id_ y unique:true se conservan.
 * @param {mongoose.Model} Modelo
 * @param {Object} logger - Pino logger
 * @returns {Promise<Array>} - Nombres de los indices dropeados
 */
async function dropIndicesSecundarios(Modelo, logger) {
  const indicesADropear = await listarIndicesSecundarios(Modelo);

  if (indicesADropear.length === 0) {
    logger.info({ coleccion: Modelo.collection.name }, 'No hay indices secundarios que dropear');
    return [];
  }

  logger.info({
    coleccion: Modelo.collection.name,
    cantidad: indicesADropear.length,
    nombres: indicesADropear.map(i => i.name)
  }, 'Dropeando indices secundarios');

  const dropeados = [];
  for (const idx of indicesADropear) {
    try {
      await Modelo.collection.dropIndex(idx.name);
      dropeados.push(idx.name);
    } catch (error) {
      logger.warn({
        coleccion: Modelo.collection.name,
        indice: idx.name,
        error: error.message
      }, 'Error dropeando indice (se ignora y sigue)');
    }
  }

  logger.info({
    coleccion: Modelo.collection.name,
    dropeados: dropeados.length
  }, 'Indices secundarios dropeados');

  return dropeados;
}

/**
 * Recrear indices secundarios desde la definicion del schema.
 * Mongoose.createIndexes() es idempotente: ignora los que ya existen.
 *
 * @param {mongoose.Model} Modelo
 * @param {Object} logger - Pino logger
 * @returns {Promise<void>}
 */
async function recrearIndicesSecundarios(Modelo, logger) {
  const inicio = Date.now();
  logger.info({ coleccion: Modelo.collection.name }, 'Recreando indices secundarios');

  try {
    await Modelo.createIndexes();
  } catch (error) {
    logger.error({
      coleccion: Modelo.collection.name,
      error: error.message,
      stack: error.stack
    }, 'Error recreando indices secundarios');
    throw error;
  }

  const duracion = Date.now() - inicio;
  logger.info({
    coleccion: Modelo.collection.name,
    duracionMs: duracion
  }, 'Indices secundarios recreados');
}

module.exports = {
  listarIndicesSecundarios,
  dropIndicesSecundarios,
  recrearIndicesSecundarios
};
