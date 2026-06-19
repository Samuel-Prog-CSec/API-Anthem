'use strict';

/**
 * Limitador de muestreo estratificado para el modo ATLAS (MongoDB M0, limite 512MB).
 *
 * En modo atlas cada importador inserta solo un subset. Para que el subset sea VARIADO
 * (y no "las primeras N filas", que en CSV ordenados por fecha o distrito serian todas del
 * mismo dia o distrito) se concede un CUPO por estrato: cada importador define que campo
 * constituye un estrato (mes, distrito, estacion, hora...) y se aceptan como mucho
 * `cupoPorEstrato` documentos de cada valor de estrato. Las filas que exceden el cupo se
 * descartan.
 *
 * El importador sigue LEYENDO el archivo completo (para poder muestrear de todos los
 * estratos sin sesgo de orden) pero solo inserta los documentos aceptados. Esto evita el
 * sesgo de "cortar a mitad de archivo" y mantiene las promesas de procesamiento simples
 * (resuelven en el evento `end`, sin destruir el stream). El trafico, cuyos CSV son
 * enormes (~650MB por mes), es el unico caso que corta la lectura, con un filtro propio
 * por eficiencia (ver importarTrafico.js).
 *
 * Patron de uso (dentro de stream.on('data'), tras transformar/validar la fila):
 *   if (limitador && !limitador.aceptar(doc)) { return; }   // descartada por cupo
 *   batch.push(doc);
 *
 * Opera SOLO en memoria sobre documentos ya transformados (un Map de contadores,
 * O(estratos)); no abre conexiones a Mongo ni anade indices ni storage.
 */
class LimitadorAtlas {
  /**
   * @param {Object} opciones
   * @param {number} opciones.cupoPorEstrato - Maximo de documentos por valor de estrato.
   * @param {(doc: Object) => string} opciones.claveEstrato - Extrae la clave de estrato de
   *   un documento ya transformado. Documentos con la misma clave compiten por el cupo.
   */
  constructor({ cupoPorEstrato, claveEstrato }) {
    if (typeof claveEstrato !== 'function') {
      throw new Error('LimitadorAtlas requiere una funcion claveEstrato');
    }

    this.cupoPorEstrato = cupoPorEstrato > 0 ? cupoPorEstrato : Infinity;
    this.claveEstrato = claveEstrato;
    this.contadorPorEstrato = new Map();
    this.aceptados = 0;
  }

  /**
   * Decide si el documento se acepta (cuenta para el cupo) o se descarta.
   * El caller solo hace batch.push cuando esto devuelve true.
   *
   * @param {Object} doc - Documento ya transformado y validado.
   * @returns {boolean} true si se acepta; false si su estrato ya lleno el cupo.
   */
  aceptar(doc) {
    const clave = String(this.claveEstrato(doc));
    const usados = this.contadorPorEstrato.get(clave) || 0;
    if (usados >= this.cupoPorEstrato) {
      return false;
    }

    this.contadorPorEstrato.set(clave, usados + 1);
    this.aceptados += 1;
    return true;
  }

  /**
   * @returns {Object} Resumen para logging estructurado.
   */
  resumen() {
    return {
      aceptados: this.aceptados,
      estratos: this.contadorPorEstrato.size,
      cupoPorEstrato: this.cupoPorEstrato === Infinity ? null : this.cupoPorEstrato
    };
  }
}

/**
 * Factory: crea un LimitadorAtlas a partir de la entrada de plan de un importador.
 *
 * Devuelve null cuando atlas esta desactivado, no hay entrada de plan, o la coleccion se
 * importa entera. Asi el importador puede escribir `if (limitador) { ... }` y, en modo
 * normal, el flujo queda exactamente igual que antes (sin rama atlas activa).
 *
 * El cupo por estrato se toma explicito (`cupoPorEstrato`) o se deriva del objetivo de
 * tamano por coleccion (`tope / estratosEsperados`).
 *
 * @param {boolean} atlasActivo - Si el modo atlas esta activo en esta ejecucion.
 * @param {Object|undefined} planEntry - Entrada de atlasPlan para este importador.
 * @param {(doc: Object) => string} claveEstrato - Funcion de clave de estrato.
 * @returns {LimitadorAtlas|null}
 */
function crearLimitador(atlasActivo, planEntry, claveEstrato) {
  if (!atlasActivo || !planEntry || planEntry.entera) {
    return null;
  }

  const cupoPorEstrato = planEntry.cupoPorEstrato > 0
    ? planEntry.cupoPorEstrato
    : (planEntry.estratosEsperados > 0
      ? Math.ceil(planEntry.tope / planEntry.estratosEsperados)
      : Infinity);

  return new LimitadorAtlas({ cupoPorEstrato, claveEstrato });
}

module.exports = { LimitadorAtlas, crearLimitador };
