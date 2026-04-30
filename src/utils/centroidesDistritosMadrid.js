/**
 * Centroides WGS84 aproximados de los 21 distritos de Madrid.
 *
 * Sirven para recursos agregados por distrito (p.ej. asignacion de
 * patinetes, densidad de poblacion) que no tienen geometria exacta
 * por registro, pero que necesitan representarse en el mapa como un
 * punto por distrito.
 *
 * Coordenadas: [longitud, latitud] segun RFC 7946 (GeoJSON).
 */

const CENTROIDES_DISTRITOS_MADRID = Object.freeze({
  1: { codigo: 1, nombre: 'CENTRO', coordenadas: [-3.7033, 40.4168] },
  2: { codigo: 2, nombre: 'ARGANZUELA', coordenadas: [-3.7014, 40.4009] },
  3: { codigo: 3, nombre: 'RETIRO', coordenadas: [-3.6820, 40.4094] },
  4: { codigo: 4, nombre: 'SALAMANCA', coordenadas: [-3.6775, 40.4310] },
  5: { codigo: 5, nombre: 'CHAMARTIN', coordenadas: [-3.6773, 40.4595] },
  6: { codigo: 6, nombre: 'TETUAN', coordenadas: [-3.6999, 40.4618] },
  7: { codigo: 7, nombre: 'CHAMBERI', coordenadas: [-3.6993, 40.4336] },
  8: { codigo: 8, nombre: 'FUENCARRAL-EL PARDO', coordenadas: [-3.7100, 40.5065] },
  9: { codigo: 9, nombre: 'MONCLOA-ARAVACA', coordenadas: [-3.7330, 40.4352] },
  10: { codigo: 10, nombre: 'LATINA', coordenadas: [-3.7500, 40.4020] },
  11: { codigo: 11, nombre: 'CARABANCHEL', coordenadas: [-3.7363, 40.3843] },
  12: { codigo: 12, nombre: 'USERA', coordenadas: [-3.7094, 40.3811] },
  13: { codigo: 13, nombre: 'PUENTE DE VALLECAS', coordenadas: [-3.6632, 40.3843] },
  14: { codigo: 14, nombre: 'MORATALAZ', coordenadas: [-3.6450, 40.4080] },
  15: { codigo: 15, nombre: 'CIUDAD LINEAL', coordenadas: [-3.6500, 40.4500] },
  16: { codigo: 16, nombre: 'HORTALEZA', coordenadas: [-3.6400, 40.4820] },
  17: { codigo: 17, nombre: 'VILLAVERDE', coordenadas: [-3.7100, 40.3470] },
  18: { codigo: 18, nombre: 'VILLA DE VALLECAS', coordenadas: [-3.6350, 40.3800] },
  19: { codigo: 19, nombre: 'VICALVARO', coordenadas: [-3.6100, 40.4050] },
  20: { codigo: 20, nombre: 'SAN BLAS-CANILLEJAS', coordenadas: [-3.6200, 40.4370] },
  21: { codigo: 21, nombre: 'BARAJAS', coordenadas: [-3.5900, 40.4770] }
});

// Indice inverso por nombre normalizado (uppercase sin tildes)
// para permitir lookup desde registros que solo traen el nombre.
function normalizarNombreDistrito(nombre) {
  if (!nombre || typeof nombre !== 'string') {return '';}
  return nombre
    .toUpperCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, ''); // quitar diacriticos
}

const CENTROIDES_POR_NOMBRE = Object.freeze(
  Object.values(CENTROIDES_DISTRITOS_MADRID).reduce((acc, distrito) => {
    acc[normalizarNombreDistrito(distrito.nombre)] = distrito;
    return acc;
  }, {})
);

/**
 * Resolver un distrito por codigo numerico (1-21).
 * @param {number|string} codigo
 * @returns {{codigo:number,nombre:string,coordenadas:[number,number]}|null}
 */
function centroidePorCodigo(codigo) {
  const num = Number(codigo);
  if (!Number.isInteger(num)) {return null;}
  return CENTROIDES_DISTRITOS_MADRID[num] || null;
}

/**
 * Resolver un distrito por nombre (tolerante a tildes/case).
 * @param {string} nombre
 * @returns {{codigo:number,nombre:string,coordenadas:[number,number]}|null}
 */
function centroidePorNombre(nombre) {
  const clave = normalizarNombreDistrito(nombre);
  return CENTROIDES_POR_NOMBRE[clave] || null;
}

module.exports = {
  CENTROIDES_DISTRITOS_MADRID,
  centroidePorCodigo,
  centroidePorNombre,
  normalizarNombreDistrito
};
