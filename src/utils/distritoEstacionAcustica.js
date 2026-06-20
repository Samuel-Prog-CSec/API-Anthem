/**
 * Asignacion aproximada de distrito a las estaciones acusticas por cercania.
 *
 * MOTIVACION: el dataset de ruido (noise_monitoring) identifica cada estacion
 * por `nmt` + nombre, pero NO trae distrito; tampoco lo trae la ubicacion
 * (locations tipo estacion_acustica), que solo guarda coordenadas UTM. La
 * correlacion Ruido x Censo necesita un distrito por estacion para cruzar con la
 * poblacion. Aproximamos el distrito asignando cada estacion al distrito cuyo
 * CENTROIDE quede mas cerca (distancia euclidea en UTM, metros).
 *
 * LIMITACION CONOCIDA: es una aproximacion. Los distritos reales son poligonos
 * irregulares; el centroide mas cercano puede errar en estaciones situadas cerca
 * de una frontera entre distritos o en distritos muy alargados. La pagina que lo
 * consume ya presenta la poblacion como "cota superior" / estimacion. Cuando el
 * modelo de Ubicaciones incorpore poligonos de distrito reales, sustituir esta
 * heuristica por un `$geoWithin`.
 *
 * Los 21 centroides (WGS84) se convierten a UTM 30N UNA sola vez al cargar el
 * modulo, reutilizando el conversor del proyecto, para no recalcular por peticion.
 */

'use strict';

const { CENTROIDES_DISTRITOS_MADRID } = require('./centroidesDistritosMadrid');
const { latLonAUTM30N } = require('./conversorCoordenadas');

// Pre-convertir los centroides WGS84 [lng, lat] -> UTM ETRS89 30N {x, y}.
// Los que no conviertan (no deberia ocurrir con Madrid) se descartan.
const CENTROIDES_UTM = Object.values(CENTROIDES_DISTRITOS_MADRID)
  .map((distrito) => {
    const [lng, lat] = distrito.coordenadas;
    const utm = latLonAUTM30N(lat, lng);
    return utm ? { codigo: distrito.codigo, nombre: distrito.nombre, x: utm.x, y: utm.y } : null;
  })
  .filter(Boolean);

/**
 * Resolver el distrito cuyo centroide esta mas cerca de una coordenada UTM.
 *
 * @param {number} x - Coordenada UTM X (easting) de la estacion
 * @param {number} y - Coordenada UTM Y (northing) de la estacion
 * @returns {{codigo:number, nombre:string}|null} distrito mas cercano o null si
 *   las coordenadas no son numeros finitos
 */
function resolverDistritoMasCercanoUTM(x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) { return null; }

  let mejor = null;
  let mejorDistancia2 = Infinity;
  for (const centroide of CENTROIDES_UTM) {
    const dx = centroide.x - x;
    const dy = centroide.y - y;
    // Comparamos distancias al cuadrado: evita el sqrt y el orden es identico.
    const distancia2 = dx * dx + dy * dy;
    if (distancia2 < mejorDistancia2) {
      mejorDistancia2 = distancia2;
      mejor = centroide;
    }
  }

  return mejor ? { codigo: mejor.codigo, nombre: mejor.nombre } : null;
}

module.exports = {
  resolverDistritoMasCercanoUTM,
  CENTROIDES_UTM
};
