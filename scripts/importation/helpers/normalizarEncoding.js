/**
 * Helper de normalizacion de encoding para importacion de CSV
 *
 * Los CSV del dataset Anthem/Madrid vienen con codificaciones mixtas
 * (latin1 heredado + UTF-8). En algunos archivos aparece el caracter
 * de reemplazo U+FFFD en lugar del caracter original (habitualmente
 * n, ñ, acentos y apertura de interrogacion/exclamacion).
 *
 * Este helper aplica una tabla determinista de reemplazos sobre los
 * valores antes de persistirlos en la BD para que las queries, los
 * indices de texto y las respuestas JSON queden limpias.
 *
 * Uso:
 *   const { normalizarTexto } = require('./helpers/normalizarEncoding');
 *   station.nombre = normalizarTexto(station.nombre);
 */

// Caracter de reemplazo Unicode (U+FFFD)
const REPLACEMENT_CHAR = '\uFFFD';

/**
 * Reemplazos contextuales para secuencias mojibake conocidas.
 * El orden importa: primero patrones especificos (palabras completas),
 * luego patrones generales por contexto (vocales, silabas), finalmente
 * limpieza defensiva.
 */
const REEMPLAZOS_EXPLICITOS = [
  // Palabras completas donde se conoce el resultado correcto
  [/Espa\uFFFDa/gi, 'España'],
  [/Espa\uFFFDola/gi, 'Española'],
  [/Espa\uFFFDoles/gi, 'Españoles'],
  [/Direcci\uFFFDn/gi, 'Dirección'],
  [/Situaci\uFFFDn/gi, 'Situación'],
  [/Estaci\uFFFDn/gi, 'Estación'],
  [/Poblaci\uFFFDn/gi, 'Población'],
  [/Descripci\uFFFDn/gi, 'Descripción'],
  [/Comunicaci\uFFFDn/gi, 'Comunicación'],
  [/Informaci\uFFFDn/gi, 'Información'],
  [/Se\uFFFDal/gi, 'Señal'],
  [/a\uFFFDo/gi, 'año'],
  [/ma\uFFFDana/gi, 'mañana'],
  [/peque\uFFFDo/gi, 'pequeño'],
  [/espa\uFFFDol/gi, 'español'],

  // Cabeceras y abreviaturas habituales
  [/N\uFFFD(?=[\s;,\t]|$)/g, 'Nº'],
  [/\bN\uFFFD\b/g, 'Nº']
];

/**
 * Heuristicas por contexto (prefijo/sufijo de vocal) para resolver
 * el caracter faltante cuando no hay una palabra explicita.
 *
 * La regla general: si \uFFFD esta entre vocales suele ser "ñ",
 * si esta detras de consonante y antes de vocal suele ser acento.
 */
const REEMPLAZOS_CONTEXTUALES = [
  // ñ entre vocales (ej: "ba?o" -> "baño")
  [/([aeiouAEIOU])\uFFFD([aeiouAEIOU])/g, '$1ñ$2'],

  // Acentos finales comunes (ej: "despu?s" -> "después")
  [/a\uFFFDs\b/gi, 'ás'],
  [/e\uFFFDs\b/gi, 'és'],
  [/i\uFFFDs\b/gi, 'ís'],
  [/o\uFFFDs\b/gi, 'ós'],
  [/u\uFFFDs\b/gi, 'ús']
];

/**
 * Normalizar un texto proveniente del CSV:
 *   - Convierte a string y trim.
 *   - Elimina comillas sobrantes (mismo criterio que cleanString()).
 *   - Aplica reemplazos explicitos conocidos.
 *   - Aplica reemplazos contextuales.
 *   - Colapsa cualquier U+FFFD residual eliminandolo.
 *
 * @param {string|null|undefined} valor - Texto bruto del CSV
 * @param {string} [porDefecto=''] - Valor si el input es nulo o vacio
 * @returns {string} Texto normalizado
 */
function normalizarTexto(valor, porDefecto = '') {
  if (valor === null || valor === undefined) {
    return porDefecto;
  }

  let texto = String(valor)
    .replace(/['"]/g, '')
    .trim();

  if (!texto) {
    return porDefecto;
  }

  // Rapida salida si no hay mojibake
  if (!texto.includes(REPLACEMENT_CHAR)) {
    return texto;
  }

  for (const [patron, reemplazo] of REEMPLAZOS_EXPLICITOS) {
    texto = texto.replace(patron, reemplazo);
  }

  for (const [patron, reemplazo] of REEMPLAZOS_CONTEXTUALES) {
    texto = texto.replace(patron, reemplazo);
  }

  // Cualquier U+FFFD residual se elimina (ultima linea de defensa).
  if (texto.includes(REPLACEMENT_CHAR)) {
    texto = texto.replace(/\uFFFD/g, '');
  }

  return texto.trim();
}

/**
 * Comprobar si un texto contiene el caracter de reemplazo U+FFFD.
 * Util para tests de integridad post-import.
 *
 * @param {string} valor
 * @returns {boolean}
 */
function tieneMojibake(valor) {
  return typeof valor === 'string' && valor.includes(REPLACEMENT_CHAR);
}

module.exports = {
  normalizarTexto,
  tieneMojibake,
  REPLACEMENT_CHAR
};
