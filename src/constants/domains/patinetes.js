/**
 * Constantes de dominio: Patinetes Electricos
 *
 * Niveles de densidad, dominancia, concentracion de mercado, tipos de zona,
 * proveedores conocidos, umbrales y areas clave de la ciudad.
 */

const NIVELES_DENSIDAD_PATINETES = {
  BAJA: 'BAJA',
  MEDIA: 'MEDIA',
  ALTA: 'ALTA',
  MUY_ALTA: 'MUY_ALTA'
};

const DOMINANCIA_PROVEEDORES_PATINETES = {
  EQUILIBRADA: 'EQUILIBRADA',
  MONOPOLIO: 'MONOPOLIO',
  DUOPOLIO: 'DUOPOLIO',
  OLIGOPOLIO: 'OLIGOPOLIO'
};

const CONCENTRACION_MERCADO_PATINETES = {
  COMPETITIVA: 'COMPETITIVA',
  MODERADA: 'MODERADA',
  CONCENTRADA: 'CONCENTRADA',
  ALTA_CONCENTRACION: 'ALTA_CONCENTRACION'
};

const TIPOS_ZONA_PATINETES = {
  CENTRO_URBANO: 'CENTRO_URBANO',
  ZONA_COMERCIAL: 'ZONA_COMERCIAL',
  ZONA_RESIDENCIAL: 'ZONA_RESIDENCIAL',
  ZONA_UNIVERSITARIA: 'ZONA_UNIVERSITARIA',
  ZONA_TURISTICA: 'ZONA_TURISTICA',
  ZONA_EMPRESARIAL: 'ZONA_EMPRESARIAL',
  PERIFERIA: 'PERIFERIA',
  ZONA_TRANSPORTE: 'ZONA_TRANSPORTE'
};

const NIVELES_PRIORIDAD_PATINETES = {
  BAJA: 'BAJA',
  MEDIA: 'MEDIA',
  ALTA: 'ALTA',
  CRITICA: 'CRITICA'
};

const NIVELES_DEMANDA_PATINETES = {
  BAJA: 'BAJA',
  MEDIA: 'MEDIA',
  ALTA: 'ALTA',
  MUY_ALTA: 'MUY_ALTA'
};

const PROVEEDORES_PATINETES = {
  ACCIONA: 'ACCIONA',
  BIRD: 'BIRD',
  FLASH: 'FLASH',
  JUMP_UBER: 'JUMP_UBER',
  KOKO: 'KOKO',
  LIME: 'LIME',
  MOVO: 'MOVO',
  MYGO: 'MYGO',
  REBY_RIDES: 'REBY_RIDES',
  RIDECONGA: 'RIDECONGA',
  SJV_CONSULTING: 'SJV_CONSULTING',
  TAXIFY: 'TAXIFY',
  UFO: 'UFO',
  WIND: 'WIND'
};

const TIPOS_INFORME_PATINETES = {
  PROVEEDORES: 'proveedores',
  UBICACION: 'ubicacion',
  TOTALES: 'totales'
};

/**
 * Umbrales de densidad de patinetes por barrio (numero total de patinetes
 * desplegados en el ambito territorial agregado).
 *
 * Justificacion: cuartiles aproximados sobre el dataset de Patinetes 2051
 * (~5400 asignaciones distribuidas en 21 distritos / ~130 barrios). Tras
 * agrupar por barrio, el percentil 50 cae cerca de 50, p75 cerca de 100 y
 * p90 cerca de 200. Estos umbrales recuperan esa distribucion sin sesgar
 * todas las zonas hacia "MEDIA".
 *
 * Unidades: patinetes totales (no per capita).
 */
// Umbrales recalibrados tras observar la distribucion real del dataset
// Anthem 2051: el barrio con mas patinetes (Valdefuentes) tiene 182, asi
// que con el umbral antiguo MUY_ALTA=200 NINGUNA zona caia en MUY_ALTA.
// Bajamos a 150 para reflejar el "top decile" real.
const UMBRALES_DENSIDAD_PATINETES = {
  MUY_ALTA: 150,
  ALTA: 100,
  MEDIA: 50,
  BAJA: 0
};

/**
 * Umbrales de demanda usados para clasificar la presion de uso de patinetes
 * en una zona. Se aplican sobre el mismo total agregado pero permiten un
 * cuadro distinto al de densidad: un barrio puede tener pocos patinetes
 * (densidad baja) y aun asi ser "ALTA" demanda relativa.
 *
 * Cortes ligeramente mas conservadores que UMBRALES_DENSIDAD_PATINETES
 * (150 / 100 / 50) para reflejar que "demanda" es un proxy de uso futuro,
 * no de inventario actual.
 */
const UMBRALES_DEMANDA_PATINETES = {
  MUY_ALTA: 150,
  ALTA: 100,
  MEDIA: 50,
  BAJA: 0
};

/**
 * Indice Herfindahl-Hirschman (HHI) para concentracion de mercado entre
 * proveedores de patinetes en una zona.
 *
 * Definicion: HHI = sum_i (cuota_i * 100)^2, donde cuota_i es la fraccion
 * de mercado del proveedor i. Rango 0-10000.
 *
 * Cortes (estandar U.S. Department of Justice / FTC Horizontal Merger
 * Guidelines, 2010):
 *   HIGH        >= 5000  -> ALTA_CONCENTRACION (riesgo monopolio practico)
 *   MODERATE    >= 2500  -> CONCENTRADA       (mercado concentrado)
 *   LOW         >= 1500  -> MODERADA          (concentracion moderada)
 *   COMPETITIVE <  1500  -> COMPETITIVA       (mercado fragmentado)
 *
 * Fuente: https://www.justice.gov/atr/herfindahl-hirschman-index
 */
const UMBRALES_CONCENTRACION_MERCADO = {
  HIGH: 5000,
  MODERATE: 2500,
  LOW: 1500,
  COMPETITIVE: 0
};

// Areas clave para clasificar tipo de zona en distribucion de patinetes.
// IMPORTANTE: incluir TANTO la forma sin tildes como la con tildes porque
// `normalizarTexto` no elimina tildes (solo arregla mojibake). El dataset
// real de Madrid trae 'CHAMARTÍN', 'TETUÁN', etc. con tildes.
const AREAS_CLAVE_PATINETES = {
  CENTRAL: ['CENTRO', 'SOL'],
  // Incluimos 'UNIVERSITARIA' / 'UNIVERSITARIO' porque el barrio real es
  // "CIUDAD UNIVERSITARIA" (Moncloa-Aravaca). Antes solo 'UNIVERSIDAD' y
  // 'CAMPUS', y ningun barrio del dataset matcheaba => ZONA_UNIVERSITARIA
  // nunca se asignaba.
  UNIVERSITY: ['UNIVERSIDAD', 'UNIVERSITARIA', 'UNIVERSITARIO', 'CAMPUS'],
  TRANSPORT: ['ATOCHA', 'CHAMARTIN', 'CHAMARTÍN'],
  COMMERCIAL: ['RETIRO', 'SALAMANCA']
};

const SCOOTER_AGGREGATION_FIELDS = {
  DISTRITO: 'distrito',
  BARRIO: 'barrio'
};

module.exports = {
  NIVELES_DENSIDAD_PATINETES,
  DOMINANCIA_PROVEEDORES_PATINETES,
  CONCENTRACION_MERCADO_PATINETES,
  TIPOS_ZONA_PATINETES,
  NIVELES_PRIORIDAD_PATINETES,
  NIVELES_DEMANDA_PATINETES,
  PROVEEDORES_PATINETES,
  TIPOS_INFORME_PATINETES,
  UMBRALES_DENSIDAD_PATINETES,
  UMBRALES_DEMANDA_PATINETES,
  UMBRALES_CONCENTRACION_MERCADO,
  AREAS_CLAVE_PATINETES,
  SCOOTER_AGGREGATION_FIELDS
};
