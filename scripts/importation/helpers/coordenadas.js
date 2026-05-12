/**
 * Framework unificado de coordenadas para importacion.
 *
 * Centraliza:
 *   - Definicion declarativa de perfiles por modulo (que campos del CSV
 *     usar, en que unidades vienen, fuente prioritaria).
 *   - Lectura, parseo, validacion y normalizacion (cm->m).
 *   - Cross-check entre UTM y WGS84 cuando ambos estan presentes.
 *   - Construccion de geometry GeoJSON RFC 7946.
 *
 * Convenciones internas (post-normalizacion):
 *   - UTM siempre en METROS (independientemente de las unidades del CSV).
 *   - WGS84 en grados decimales (lon, lat).
 *   - geometry GeoJSON: { type: 'Point', coordinates: [lon, lat] }.
 *
 * Diseñado para ser la unica forma de extraer coordenadas en los
 * importers. Asi, cualquier nuevo modulo solo necesita declarar su perfil
 * y llamar a `extraerCoordenadasModulo(row, perfilKey)`.
 *
 * Uso tipico:
 *   const { extraerCoordenadasModulo } = require('./helpers/coordenadas');
 *   const coords = extraerCoordenadasModulo(row, 'multas');
 *   if (!coords) {
 *     // perfil con requerida=false; opcional
 *   }
 *   doc.coordenadas = coords.utm;
 *   doc.location = coords.geometry;
 */

const { parseNumeroEstricto } = require('./importHelpers');
const {
  esUTMValida,
  esWGS84Valida,
  utm30NToLatLon,
  latLonToUTM30N,
  construirGeometryDesdeUTM,
  construirGeometryDesdeWGS84
} = require('./conversorCoordenadas');

/**
 * Tolerancia para detectar discrepancia entre UTM y WGS84 cuando ambos
 * vienen en el CSV. ~0.01 grados son aprox 1.1 km en latitud, suficiente
 * para detectar errores graves (UTM en otra zona, lon/lat invertidas)
 * sin disparar falsos positivos por redondeo.
 *
 * Origen del valor: experiencia con datasets municipales espanoles que
 * suelen redondear coordenadas a 4 decimales (~11 metros de precision).
 */
const TOLERANCIA_DISCREPANCIA_GRADOS = 0.01;

/**
 * Codigos de razon de rechazo coordenadas.
 * Se usan al lanzar errores que los importers capturan via su tracker.
 */
const RAZONES_COORD = {
  COORDENADAS_FALTANTES: 'COORDENADAS_FALTANTES',
  COORDENADAS_FORMATO_INVALIDO: 'COORDENADAS_FORMATO_INVALIDO',
  COORDENADAS_FUERA_RANGO: 'COORDENADAS_FUERA_RANGO',
  PERFIL_NO_DEFINIDO: 'PERFIL_COORDENADAS_NO_DEFINIDO'
};

/**
 * Perfiles de coordenadas por modulo. Cada perfil declara:
 *   - utm.campos.x/y: array de nombres de columna alternativos en CSV.
 *     Se prueban en orden hasta encontrar un valor no vacio. Util para
 *     CSVs con nombres inconsistentes entre archivos del mismo dataset.
 *   - utm.unidades: 'm' (metros) o 'cm' (centimetros). Si 'cm', se
 *     normaliza dividiendo por 100 antes de validar/almacenar.
 *   - wgs84.campos.lon/lat: equivalente para WGS84. null si el CSV no
 *     trae coordenadas geograficas directas.
 *   - fuentePrioritaria: 'wgs84' o 'utm'. Determina cual se usa para la
 *     geometry final cuando ambos estan disponibles.
 *   - requerida: si true, lanza error cuando no se puede extraer ninguna
 *     coordenada valida. Si false, devuelve null.
 *
 * Para anadir un nuevo modulo: anadir entrada aqui, sin tocar la logica
 * de extraccion.
 */
const PERFILES_COORDENADAS = {
  // Contenedores: dataset_information.md indica UTM en CENTIMETROS y CSV
  // tambien provee LONGITUD/LATITUD ya calculadas. Preferimos WGS84
  // directo y cross-validamos contra UTM convertido.
  contenedores: {
    utm: {
      campos: {
        x: ['COORDENADA X', 'CoordenadaX', 'COORDENADAX', 'coordenada_x'],
        y: ['COORDENADA Y', 'CoordenadaY', 'COORDENADAY', 'coordenada_y']
      },
      unidades: 'cm'
    },
    wgs84: {
      campos: {
        lon: ['LONGITUD', 'longitud', 'LONG', 'lon'],
        lat: ['LATITUD', 'latitud', 'LAT', 'lat']
      }
    },
    fuentePrioritaria: 'wgs84',
    requerida: true
  },

  // Multas: solo UTM en metros, no hay WGS84 en CSV.
  multas: {
    utm: {
      campos: {
        x: ['COORDENADA_X', 'COORDENADA-X', 'coordenada_x'],
        y: ['COORDENADA_Y', 'COORDENADA-Y', 'coordenada_y']
      },
      unidades: 'm'
    },
    wgs84: null,
    fuentePrioritaria: 'utm',
    // Multas pueden existir sin coordenadas (radar fijo solo registra
    // velocidad, sin posicion). No bloqueamos la importacion.
    requerida: false
  },

  // Accidentes: solo UTM en metros, suffix _utm explicito en columna.
  accidentes: {
    utm: {
      campos: {
        x: ['coordenada_x_utm', 'COORDENADA_X_UTM'],
        y: ['coordenada_y_utm', 'COORDENADA_Y_UTM']
      },
      unidades: 'm'
    },
    wgs84: null,
    fuentePrioritaria: 'utm',
    requerida: false
  },

  // Ubicaciones - estaciones acusticas: tiene UTM ETRS89 + WGS84 directo.
  // Preferimos WGS84 para evitar reprojection error en cada lectura.
  ubicaciones_estacion_acustica: {
    utm: {
      campos: {
        x: ['Coordenada_X_ETRS89', 'COORDENADA_X_ETRS89', 'coordenada_x_etrs89'],
        y: ['Coordenada_Y_ETRS89', 'COORDENADA_Y_ETRS89', 'coordenada_y_etrs89']
      },
      unidades: 'm'
    },
    wgs84: {
      campos: {
        lon: ['LONGITUD_WGS84', 'longitud_wgs84', 'LONGITUD', 'longitud'],
        lat: ['LATITUD_WGS84', 'latitud_wgs84', 'LATITUD', 'latitud']
      }
    },
    fuentePrioritaria: 'wgs84',
    requerida: true
  },

  // Ubicaciones - puntos de medida de trafico: solo UTM en metros (col x, y).
  // Hay puntos sin coordenadas validas en el dataset, asi que requerida=false.
  ubicaciones_punto_trafico: {
    utm: {
      campos: {
        x: ['x', 'X', 'utm_x', 'UTM_X'],
        y: ['y', 'Y', 'utm_y', 'UTM_Y']
      },
      unidades: 'm'
    },
    wgs84: null,
    fuentePrioritaria: 'utm',
    requerida: false
  }
};

/**
 * Lee un valor de un row probando varias claves alternativas.
 * Devuelve el primer valor no vacio o null si no encuentra ninguno.
 *
 * @param {Object} row - Fila del CSV
 * @param {Array<string>} campos - Nombres de columna alternativos
 * @returns {string|null}
 */
function leerCampo(row, campos) {
  if (!row || !Array.isArray(campos)) {return null;}
  for (const campo of campos) {
    const valor = row[campo];
    if (valor !== undefined && valor !== null && String(valor).trim() !== '') {
      return valor;
    }
  }
  return null;
}

/**
 * Parsea un par UTM aplicando normalizacion de unidades (cm -> m).
 *
 * @param {string|number} xRaw
 * @param {string|number} yRaw
 * @param {'m'|'cm'} unidades
 * @returns {{ x: number, y: number, unidadOriginal: string }|null}
 *   null si no se puede parsear o esta fuera de rango.
 */
function parsearUTM(xRaw, yRaw, unidades = 'm') {
  if (xRaw === null || yRaw === null) {return null;}

  // Parseo estricto: rechaza valores con sufijo no numerico.
  let x = parseNumeroEstricto(xRaw);
  let y = parseNumeroEstricto(yRaw);

  if (x === null || y === null) {return null;}

  // (0, 0) no es UTM valido en Espana; algunos CSVs lo usan como
  // centinela "sin datos". Lo descartamos.
  if (x === 0 && y === 0) {return null;}

  if (unidades === 'cm') {
    x = x / 100;
    y = y / 100;
  }

  if (!esUTMValida(x, y)) {return null;}

  return { x, y, unidadOriginal: unidades };
}

/**
 * Parsea un par WGS84 (lon, lat).
 *
 * @param {string|number} lonRaw
 * @param {string|number} latRaw
 * @returns {{ lon: number, lat: number }|null}
 */
function parsearWGS84(lonRaw, latRaw) {
  if (lonRaw === null || latRaw === null) {return null;}

  // Parseo estricto: las columnas LONGITUD/LATITUD no llevan unidades.
  const lon = parseNumeroEstricto(lonRaw);
  const lat = parseNumeroEstricto(latRaw);

  if (lon === null || lat === null) {return null;}

  if (lon === 0 && lat === 0) {return null;}

  if (!esWGS84Valida(lon, lat)) {return null;}

  return { lon, lat };
}

/**
 * Cross-check entre UTM y WGS84 cuando ambos estan disponibles.
 * Devuelve null si la discrepancia esta dentro de la tolerancia, o un
 * objeto con el detalle si excede.
 *
 * @param {{x: number, y: number}} utm - UTM ya normalizado a metros
 * @param {{lon: number, lat: number}} wgs84
 * @returns {{ dLon: number, dLat: number }|null}
 */
function detectarDiscrepancia(utm, wgs84) {
  const derivado = utm30NToLatLon(utm.x, utm.y);
  if (!derivado) {return null;}

  const dLon = Math.abs(derivado.lon - wgs84.lon);
  const dLat = Math.abs(derivado.lat - wgs84.lat);

  if (dLon > TOLERANCIA_DISCREPANCIA_GRADOS || dLat > TOLERANCIA_DISCREPANCIA_GRADOS) {
    return {
      dLon: Number(dLon.toFixed(6)),
      dLat: Number(dLat.toFixed(6)),
      utmDerivedWGS84: derivado
    };
  }

  return null;
}

/**
 * Resultado canonico de extraccion:
 *   {
 *     utm: { x, y } | null,                       // siempre en METROS
 *     wgs84: { lon, lat } | null,                 // grados decimales
 *     geometry: { type:'Point', coordinates:[lon,lat] } | null,
 *     fuente: 'wgs84_csv'|'utm_derivado'|'wgs84_csv_y_utm',
 *     advertencias: Array<string>                 // discrepancias o coercions
 *   }
 *
 * @param {Object} row - Fila del CSV
 * @param {string} perfilKey - Clave del perfil (ej. 'multas', 'contenedores')
 * @returns {Object|null} - null si no se puede extraer y perfil.requerida=false
 * @throws {Error} - Si perfil.requerida=true y no hay coords validas
 */
function extraerCoordenadasModulo(row, perfilKey) {
  const perfil = PERFILES_COORDENADAS[perfilKey];
  if (!perfil) {
    const error = new Error(`${RAZONES_COORD.PERFIL_NO_DEFINIDO}: ${perfilKey}`);
    error.code = RAZONES_COORD.PERFIL_NO_DEFINIDO;
    throw error;
  }

  const advertencias = [];

  // 1. Leer y parsear UTM si el perfil lo declara
  let utm = null;
  if (perfil.utm) {
    const xRaw = leerCampo(row, perfil.utm.campos.x);
    const yRaw = leerCampo(row, perfil.utm.campos.y);
    if (xRaw !== null || yRaw !== null) {
      utm = parsearUTM(xRaw, yRaw, perfil.utm.unidades);
      if (!utm && (xRaw !== null && yRaw !== null)) {
        advertencias.push('UTM presente en CSV pero invalido o fuera de rango');
      }
    }
  }

  // 2. Leer y parsear WGS84 si el perfil lo declara
  let wgs84 = null;
  if (perfil.wgs84) {
    const lonRaw = leerCampo(row, perfil.wgs84.campos.lon);
    const latRaw = leerCampo(row, perfil.wgs84.campos.lat);
    if (lonRaw !== null || latRaw !== null) {
      wgs84 = parsearWGS84(lonRaw, latRaw);
      if (!wgs84 && (lonRaw !== null && latRaw !== null)) {
        advertencias.push('WGS84 presente en CSV pero invalido o fuera de rango');
      }
    }
  }

  // 3. Cross-check si tenemos ambos
  if (utm && wgs84) {
    const disc = detectarDiscrepancia(utm, wgs84);
    if (disc) {
      advertencias.push(
        `Discrepancia UTM<->WGS84: dLon=${disc.dLon}, dLat=${disc.dLat}`
      );
    }
  }

  // 4. Resolver fuente final y geometry
  let geometry = null;
  let fuente = null;

  if (perfil.fuentePrioritaria === 'wgs84' && wgs84) {
    geometry = construirGeometryDesdeWGS84(wgs84.lon, wgs84.lat);
    fuente = utm ? 'wgs84_csv_y_utm' : 'wgs84_csv';
  } else if (utm) {
    // Derivar WGS84 desde UTM si no lo tenemos
    if (!wgs84) {
      const derivado = utm30NToLatLon(utm.x, utm.y);
      if (derivado) {
        wgs84 = derivado;
      }
    }
    if (wgs84) {
      geometry = construirGeometryDesdeWGS84(wgs84.lon, wgs84.lat);
      fuente = perfil.fuentePrioritaria === 'wgs84' ? 'wgs84_csv' : 'utm_derivado';
    }
  } else if (wgs84) {
    // Solo WGS84 disponible aunque no fuera prioritaria
    geometry = construirGeometryDesdeWGS84(wgs84.lon, wgs84.lat);
    fuente = 'wgs84_csv';
  }

  // 5. Si no hay geometry y la coord es requerida, error
  if (!geometry && perfil.requerida) {
    const error = new Error(RAZONES_COORD.COORDENADAS_FALTANTES);
    error.code = RAZONES_COORD.COORDENADAS_FALTANTES;
    error.advertencias = advertencias;
    throw error;
  }

  if (!geometry) {
    return null;
  }

  return {
    utm: utm ? { x: utm.x, y: utm.y } : null,
    wgs84,
    geometry,
    fuente,
    advertencias
  };
}

module.exports = {
  PERFILES_COORDENADAS,
  TOLERANCIA_DISCREPANCIA_GRADOS,
  RAZONES_COORD,
  extraerCoordenadasModulo,
  parsearUTM,
  parsearWGS84,
  detectarDiscrepancia,
  // Re-export del conversor para que importers usen un solo modulo
  esUTMValida,
  esWGS84Valida,
  utm30NToLatLon,
  latLonToUTM30N,
  construirGeometryDesdeUTM,
  construirGeometryDesdeWGS84
};
