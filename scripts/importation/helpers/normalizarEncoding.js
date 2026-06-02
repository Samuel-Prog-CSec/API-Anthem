/**
 * Helper de normalizacion de encoding para importacion de CSV
 *
 * Los CSV del dataset Anthem/Madrid son originalmente latin1/Windows-1252
 * (estandar municipal espanol). Cuando se leen con codificacion incorrecta
 * o se procesan por herramientas que asumen UTF-8, aparecen dos
 * patologias distintas:
 *
 *   1. **Mojibake U+FFFD**: archivo es latin1 pero se leyo como UTF-8.
 *      Los bytes invalidos para UTF-8 se sustituyen por U+FFFD ("�").
 *      Ejemplo: "Espa�a" en lugar de "España".
 *
 *   2. **Mojibake "Ã"/"Â"**: archivo es UTF-8 (o doble-codificado) pero se
 *      leyo como latin1. Cada byte multibyte UTF-8 se interpreta como
 *      uno o dos caracteres latin1 que empiezan por "Ã" o "Â".
 *      Ejemplo: "EspaÃ±a" en lugar de "España".
 *
 * Este helper aplica una tabla determinista de reemplazos para ambas
 * patologias. La estrategia recomendada del proyecto es leer SIEMPRE
 * los CSV como latin1 (ver `crearLectorCSV` mas abajo) y usar
 * `normalizarTexto` como defense in depth.
 *
 * Uso:
 *   const { normalizarTexto, crearLectorCSV } = require('./helpers/normalizarEncoding');
 *   station.nombre = normalizarTexto(station.nombre);
 */

// Caracter de reemplazo Unicode (U+FFFD)
const REPLACEMENT_CHAR = '�';

/**
 * Reemplazos contextuales para secuencias mojibake conocidas U+FFFD.
 * El orden importa: primero patrones especificos (palabras completas),
 * luego patrones generales por contexto (vocales, silabas), finalmente
 * limpieza defensiva.
 */
const REEMPLAZOS_EXPLICITOS = [
  // Palabras completas donde se conoce el resultado correcto
  [/Espa�a/gi, 'España'],
  [/Espa�ola/gi, 'Española'],
  [/Espa�oles/gi, 'Españoles'],
  [/Direcci�n/gi, 'Dirección'],
  [/Situaci�n/gi, 'Situación'],
  [/Estaci�n/gi, 'Estación'],
  [/Poblaci�n/gi, 'Población'],
  [/Descripci�n/gi, 'Descripción'],
  [/Comunicaci�n/gi, 'Comunicación'],
  [/Informaci�n/gi, 'Información'],
  [/Se�al/gi, 'Señal'],
  [/a�o/gi, 'año'],
  [/ma�ana/gi, 'mañana'],
  [/peque�o/gi, 'pequeño'],
  [/espa�ol/gi, 'español'],

  // Cabeceras y abreviaturas habituales
  [/N�(?=[\s;,\t]|$)/g, 'Nº'],
  [/\bN�\b/g, 'Nº']
];

/**
 * Heuristicas por contexto (prefijo/sufijo de vocal) para resolver
 * el caracter U+FFFD faltante cuando no hay una palabra explicita.
 *
 * Regla general: si U+FFFD esta entre vocales suele ser "ñ"; si esta
 * detras de consonante y antes de vocal suele ser un acento.
 */
const REEMPLAZOS_CONTEXTUALES = [
  // ñ entre vocales (ej: "ba?o" -> "baño")
  [/([aeiouAEIOU])�([aeiouAEIOU])/g, '$1ñ$2'],

  // Acentos finales comunes (ej: "despu?s" -> "después")
  [/a�s\b/gi, 'ás'],
  [/e�s\b/gi, 'és'],
  [/i�s\b/gi, 'ís'],
  [/o�s\b/gi, 'ós'],
  [/u�s\b/gi, 'ús']
];

/**
 * Patrones para mojibake "Ã"/"Â": cuando un archivo UTF-8 se lee como
 * latin1 (o cuando el dato esta doble-codificado). Cada caracter espanol
 * acentuado o con ene aparece como una secuencia que empieza por
 * "Ã" o "Â".
 *
 * Tabla derivada de la conversion bytewise UTF-8 -> latin1:
 *   ñ (UTF-8: C3 B1) -> "Ã±" leido como latin1
 *   é (UTF-8: C3 A9) -> "Ã©" leido como latin1
 *   ¿ (UTF-8: C2 BF) -> "Â¿" leido como latin1
 *
 * Aplicar ANTES de los REEMPLAZOS_EXPLICITOS para no provocar dobles
 * sustituciones (que las palabras vuelvan a su forma esperada).
 *
 * AVISO PARA QUIEN EDITE LA TABLA: en las entradas de vocales acentuadas
 * MAYUSCULAS y la "Ñ" mayuscula, el segundo caracter del patron es un
 * control no imprimible (U+0081..U+009C: '\x81' para Á, '\x89' para É,
 * '\x8D' para Í, '\x93' para Ó, '\x9A' para Ú, '\x9C' para Ü,
 * '\x91' para Ñ). Visualmente parece que solo hay un caracter "Ã" pero
 * el archivo se guarda como UTF-8 con dos caracteres reales por entrada.
 * NO elimines los caracteres invisibles desde el editor: si lo haces, el
 * patron coincidira con cualquier "Ã" suelto y rompera la cadena entera.
 */
const REEMPLAZOS_LATIN1_DESDE_UTF8 = [
  // Vocales acentuadas minusculas (C3 + byte)
  ['Ã¡', 'á'],
  ['Ã©', 'é'],
  ['Ã­', 'í'],
  ['Ã³', 'ó'],
  ['Ãº', 'ú'],
  ['Ã¼', 'ü'],
  // Vocales acentuadas mayusculas
  ['Ã', 'Á'],
  ['Ã', 'É'],
  ['Ã', 'Í'],
  ['Ã', 'Ó'],
  ['Ã', 'Ú'],
  ['Ã', 'Ü'],
  // Eñes
  ['Ã±', 'ñ'],
  ['Ã', 'Ñ'],
  // Signos espanoles (C2 + byte)
  ['Â¿', '¿'],
  ['Â¡', '¡'],
  ['Â°', '°'],
  ['Âº', 'º'],
  ['Âª', 'ª'],
  ['Â·', '·'],
  ['Â´', '´'], // U+00B4 acute accent (apostrofo): "OÂ´Donnell" -> "O´Donnell"
  ['Â¨', '¨'], // U+00A8 diaeresis
  ['Â²', '²'], // U+00B2 superscript 2
  ['Â³', '³'], // U+00B3 superscript 3
  // Otros caracteres latin1 menos comunes pero presentes en dataset
  // Madrid (PuntoMedidaTrafico tiene "SEPULVEDA Ã˜118" con simbolo
  // diametro/Ø). El segundo char (0x98) es un control no imprimible
  // en latin1 por lo que tras el split puede quedar invisible; usamos
  // \x98 explicito para que el patron tenga 2 chars (no 1).
  ['Ã\x98', 'Ø']
];

/**
 * Normalizar un texto proveniente del CSV.
 *
 *   - Convierte a string y trim.
 *   - Elimina comillas sobrantes (mismo criterio que cleanString()).
 *   - Aplica primero patrones "Ã"/"Â" (UTF-8 leido como latin1).
 *   - Luego patrones U+FFFD (latin1 leido como UTF-8) explicitos +
 *     contextuales.
 *   - Colapsa cualquier U+FFFD residual eliminandolo.
 *
 * @param {string|null|undefined} valor
 * @param {string} [porDefecto='']
 * @returns {string}
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

  const tieneFFFD = texto.includes(REPLACEMENT_CHAR);
  const tieneAUTF = texto.includes('Ã') || texto.includes('Â');

  // Salida rapida si no hay mojibake conocido
  if (!tieneFFFD && !tieneAUTF) {
    return texto;
  }

  // 1. Tratar primero el patron "Ã"/"Â" (UTF-8 leido como latin1).
  //    Si lo hicieramos despues, los REEMPLAZOS_EXPLICITOS U+FFFD podrian
  //    no coincidir porque las palabras estarian deformadas.
  if (tieneAUTF) {
    for (const [patron, reemplazo] of REEMPLAZOS_LATIN1_DESDE_UTF8) {
      if (texto.includes(patron)) {
        texto = texto.split(patron).join(reemplazo);
      }
    }
  }

  // 2. Tratar U+FFFD (latin1 leido como UTF-8) con tabla explicita y
  //    luego heuristicas contextuales.
  if (texto.includes(REPLACEMENT_CHAR)) {
    for (const [patron, reemplazo] of REEMPLAZOS_EXPLICITOS) {
      texto = texto.replace(patron, reemplazo);
    }

    for (const [patron, reemplazo] of REEMPLAZOS_CONTEXTUALES) {
      texto = texto.replace(patron, reemplazo);
    }

    // Cualquier U+FFFD residual se elimina (ultima linea de defensa).
    if (texto.includes(REPLACEMENT_CHAR)) {
      texto = texto.replace(/�/g, '');
    }
  }

  return texto.trim();
}

/**
 * Comprobar si un texto contiene caracteres de mojibake conocido
 * (U+FFFD o secuencias "Ã"/"Â"). Util para tests de integridad
 * post-import.
 *
 * @param {string} valor
 * @returns {boolean}
 */
function tieneMojibake(valor) {
  if (typeof valor !== 'string') {return false;}
  if (valor.includes(REPLACEMENT_CHAR)) {return true;}
  // Sondeo: si aparece "Ã" o "Â" seguido de un byte alto
  // (-¿), probablemente es mojibake. En datos espanoles "Ã"
  // o "Â" como caracter literal aislado es muy raro.
  return /[ÃÂ][-¿]/.test(valor);
}

/**
 * Helper para crear un read stream CSV con la convencion del proyecto.
 *
 * Estrategia: TODOS los CSV del dataset Anthem se leen como latin1.
 * Es el formato natural de exports municipales espanoles
 * (Windows-1252 / ISO-8859-1) y `normalizarTexto` cubre los casos
 * patologicos como defense in depth.
 *
 * Uso:
 *   const { crearLectorCSV } = require('./helpers/normalizarEncoding');
 *   const stream = crearLectorCSV(filePath);
 *   stream.pipe(csv({ separator: ';' }))
 *
 * @param {string} filePath
 * @param {Object} [opcionesAdicionales]
 * @returns {fs.ReadStream}
 */
function crearLectorCSV(filePath, opcionesAdicionales = {}) {
  // Lazy require para no forzar fs cuando se importa el helper en
  // contextos sin filesystem (tests, browser bundlers).
  const fs = require('fs');
  return fs.createReadStream(filePath, {
    encoding: 'latin1',
    ...opcionesAdicionales
  });
}

module.exports = {
  normalizarTexto,
  tieneMojibake,
  crearLectorCSV,
  REPLACEMENT_CHAR
};
