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
  try {
    const indicesReales = await Modelo.collection.indexes();
    return indicesReales.filter(idx => idx.name !== '_id_' && idx.unique !== true);
  } catch (error) {
    // Mongo lanza "ns does not exist" cuando la coleccion fue dropeada
    // antes del run (escenario habitual cuando re-ejecutamos importadores
    // tras un fix). No es un error real: simplemente no hay indices que
    // dropear todavia y el script puede continuar.
    if (error.codeName === 'NamespaceNotFound' || /ns does not exist/i.test(error.message || '')) {
      return [];
    }
    throw error;
  }
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

  // Snapshot de indices unicos pre-recreate. Sirve para sanity check
  // post-recreate: si createIndexes() no recreara alguno, lo detectamos
  // en vez de continuar a ciegas con la BD en estado inconsistente.
  const indicesUnicosPre = (await Modelo.collection.indexes())
    .filter(idx => idx.unique === true)
    .map(idx => idx.name);

  logger.info({
    coleccion: Modelo.collection.name,
    indicesUnicosConservados: indicesUnicosPre
  }, 'Recreando indices secundarios');

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

  // Sanity check: los indices unicos preservados deben seguir presentes.
  const indicesPostRecreate = await Modelo.collection.indexes();
  const nombresPost = new Set(indicesPostRecreate.map(idx => idx.name));
  const unicosPerdidos = indicesUnicosPre.filter(nombre => !nombresPost.has(nombre));
  if (unicosPerdidos.length > 0) {
    logger.error({
      coleccion: Modelo.collection.name,
      perdidos: unicosPerdidos
    }, 'INTEGRIDAD: indices unicos preservados desaparecieron tras createIndexes()');
  }

  const duracion = Date.now() - inicio;
  logger.info({
    coleccion: Modelo.collection.name,
    duracionMs: duracion,
    totalIndices: indicesPostRecreate.length
  }, 'Indices secundarios recreados');
}

module.exports = {
  listarIndicesSecundarios,
  dropIndicesSecundarios,
  recrearIndicesSecundarios
};
