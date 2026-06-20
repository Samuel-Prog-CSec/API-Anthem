/**
 * Utilidades compartidas para los endpoints de ingesta de datos de sensores.
 *
 * - `upsertConReintento`: upsert idempotente por clave unica con reintento ante
 *   colision E11000 (carrera de dos upserts concurrentes sobre la misma clave).
 * - `resumirLote`: resume el resultado de procesar un lote de lecturas.
 */

/**
 * Ejecuta un upsert idempotente (`findOneAndUpdate` con upsert) y devuelve si el
 * documento se creo o se actualizo.
 *
 * `findOneAndUpdate` con upsert puede lanzar E11000 si dos operaciones
 * concurrentes intentan insertar la misma clave a la vez; en ese caso el
 * documento ya existe y basta con reintentar una vez (pasara a ser un update).
 *
 * @param {import('mongoose').Model} Model - Modelo Mongoose destino
 * @param {Object} filtro - Filtro por la clave unica
 * @param {Object} set - Campos a establecer (se aplican con $set)
 * @param {Object} [opciones={}] - Opciones extra para findOneAndUpdate
 * @returns {Promise<{estado: 'creado'|'actualizado', creado: boolean, documento: Object}>}
 */
const upsertConReintento = async (Model, filtro, set, opciones = {}) => {
  let ultimoError = null;
  for (let intento = 0; intento < 2; intento += 1) {
    try {
      const resultado = await Model.findOneAndUpdate(
        filtro,
        { $set: set },
        { upsert: true, new: true, runValidators: true, includeResultMetadata: true, ...opciones }
      );
      const creado = !(resultado.lastErrorObject && resultado.lastErrorObject.updatedExisting);
      return { estado: creado ? 'creado' : 'actualizado', creado, documento: resultado.value };
    } catch (error) {
      ultimoError = error;
      // Carrera de upsert: el documento se creo entre el find y el insert.
      // Reintentar una vez convierte la operacion en un update limpio.
      if (error && error.code === 11000 && intento === 0) {
        continue;
      }
      throw error;
    }
  }
  throw ultimoError;
};

/**
 * Resume el resultado de procesar un lote de lecturas con `Promise.allSettled`.
 *
 * @param {Array<{status: string, value?: {creado: boolean}, reason?: Error}>} resultados
 * @returns {{total: number, creados: number, actualizados: number, fallidos: number, errores: Array}}
 */
const resumirLote = (resultados) => {
  let creados = 0;
  let actualizados = 0;
  let fallidos = 0;
  const errores = [];

  resultados.forEach((resultado, indice) => {
    if (resultado.status === 'fulfilled') {
      if (resultado.value.creado) { creados += 1; } else { actualizados += 1; }
    } else {
      fallidos += 1;
      // Limitar el detalle de errores devuelto para no inflar la respuesta.
      if (errores.length < 10) {
        errores.push({ indice, mensaje: resultado.reason && resultado.reason.message ? resultado.reason.message : 'Error desconocido' });
      }
    }
  });

  return { total: resultados.length, creados, actualizados, fallidos, errores };
};

// Mapa de cerrojos en memoria por clave de documento. Serializa las escrituras
// read-modify-save concurrentes al MISMO documento dentro de ESTE proceso
// (p.ej. las 24 horas del mismo dia/estacion/magnitud de calidad del aire, o el
// mismo mes/estacion de ruido), evitando VersionError. El reintento de
// `ingestar*` cubre ademas el caso multi-proceso (varias instancias del API).
const _cerrojos = new Map();

/**
 * Ejecuta `fn` en serie respecto a otras llamadas con la misma `clave`.
 * @param {string} clave - Clave del documento a serializar
 * @param {Function} fn - Funcion async a ejecutar
 * @returns {Promise<*>} El resultado de `fn`
 */
const conCerrojo = (clave, fn) => {
  const anterior = _cerrojos.get(clave) || Promise.resolve();
  const ejecucion = anterior.then(fn, fn);
  // `guardada` encadena la siguiente espera y limpia el mapa cuando es la cola.
  const guardada = ejecucion.then(() => {}, () => {}).finally(() => {
    if (_cerrojos.get(clave) === guardada) {
      _cerrojos.delete(clave);
    }
  });
  _cerrojos.set(clave, guardada);
  return ejecucion;
};

module.exports = {
  upsertConReintento,
  resumirLote,
  conCerrojo
};
