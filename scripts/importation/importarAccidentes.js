/**
 * Script de Importación de Datos de Accidentalidad
 *
 * Procesa y carga datos de accidentes desde el archivo CSV a la base de datos MongoDB.
 * Incluye validación de datos, transformación, normalización y manejo de errores.
 *
 * Uso: node scripts/importation/importarAccidentes.js
 */

process.env.SCRIPT_MODE = 'true';

const path = require('path');
const csv = require('csv-parser');
const fs = require('fs').promises;
const mongoose = require('mongoose');

// Importar modelos, configuración y utilidades
const Accidente = require('../../src/models/Accidente');
const { connectDB } = require('../../src/config/database');
const config = require('../../src/config/config');
const { importarAccidentesLogger: logger } = require('../../src/config/scriptLogger');
const {
  VALIDATION_LIMITS,
  GENDERS,
  WEATHER_CONDITIONS,
  BINARY_INDICATORS,
  TIPOS_ACCIDENTE,
  TIPOS_VEHICULO,
  TIPOS_PERSONA,
  TIPOS_LESION,
  DAY_PERIODS,
  WORKDAY_TYPES,
  FACTORES_RIESGO,
  SEVERITY_LEVELS
} = require('../../src/constants');
const {
  RejectionTracker,
  formatDuration,
  calculateProcessingSpeed,
  buildAndWriteSummary
} = require('./helpers/importHelpers');
const { normalizarTexto, crearLectorCSV } = require('./helpers/normalizarEncoding');
const { extraerCoordenadasModulo } = require('./helpers/coordenadas');


// ============================================================================
// CONFIGURACIÓN
// ============================================================================

const DATA_FILE = path.join(__dirname, '../../datos_hpe/Anthem_CTC_Accidentalidad.csv');
const BATCH_SIZE = 1000;
const LOG_INTERVAL = 50000;

// ============================================================================
// RAZONES DE RECHAZO
// ============================================================================

/**
 * Razones de rechazo para filas que no se insertan en la BD
 * @constant {Object}
 */
const REJECTION_REASONS = {
  // Campos obligatorios faltantes
  NUMERO_EXPEDIENTE_FALTANTE: 'Numero de expediente faltante o vacio',
  NUMERO_EXPEDIENTE_FORMATO_INVALIDO: 'Formato de numero de expediente invalido (esperado: YYYYSNNNNNN)',
  FECHA_FALTANTE: 'Fecha faltante o vacia',
  FECHA_FORMATO_INVALIDO: 'Formato de fecha invalido (esperado: DD/MM/YYYY)',
  FECHA_COMPONENTES_INVALIDOS: 'Componentes de fecha invalidos (dia, mes o año no numericos)',
  FECHA_FUERA_RANGO: 'Fecha fuera de rango valido',
  HORA_FALTANTE: 'Hora faltante o vacia',
  HORA_FORMATO_INVALIDO: 'Formato de hora invalido (esperado: HH:MM:SS)',
  LOCALIZACION_FALTANTE: 'Localizacion (calle) faltante',
  DISTRITO_INCOMPLETO: 'Datos de distrito incompletos (codigo o nombre)',

  // Coordenadas
  COORDENADAS_FORMATO_INVALIDO: 'Coordenadas con formato invalido (no numerico)',
  COORDENADAS_FUERA_RANGO_UTM: 'Coordenadas fuera de rango UTM valido para España',

  // Errores de procesamiento
  ERROR_TRANSFORMACION: 'Error durante la transformacion de datos',
  ERROR_VALIDACION_MONGOOSE: 'Error de validacion de esquema Mongoose',
  ERROR_INSERCION_BD: 'Error al insertar en base de datos'
};

// ============================================================================
// CONTADORES GLOBALES
// ============================================================================

let totalProcessed = 0;
let totalInserted = 0;
let totalRejected = 0;
let totalErrors = 0;
let isShuttingDown = false;

// Tracker de rechazos por tipo
const rejectionTracker = new RejectionTracker();

// ============================================================================
// MAPAS DE NORMALIZACIÓN
// ============================================================================

/**
 * Mapa de normalización de tipos de accidente
 * Mapea valores del CSV a valores del enum del modelo (usando constantes centralizadas)
 */
const TIPO_ACCIDENTE_MAP = {
  'alcance': TIPOS_ACCIDENTE.ALCANCE,
  'atropello a animal': TIPOS_ACCIDENTE.ATROPELLO_A_ANIMAL,
  'atropello a persona': TIPOS_ACCIDENTE.ATROPELLO_A_PERSONA,
  'caída': TIPOS_ACCIDENTE.CAIDA,
  'caida': TIPOS_ACCIDENTE.CAIDA,
  'choque contra obstáculo fijo': TIPOS_ACCIDENTE.CHOQUE_CONTRA_OBSTACULO_FIJO,
  'choque contra obstaculo fijo': TIPOS_ACCIDENTE.CHOQUE_CONTRA_OBSTACULO_FIJO,
  'colisión frontal': TIPOS_ACCIDENTE.COLISION_FRONTAL,
  'colision frontal': TIPOS_ACCIDENTE.COLISION_FRONTAL,
  'colisión fronto-lateral': TIPOS_ACCIDENTE.COLISION_FRONTO_LATERAL,
  'colision fronto-lateral': TIPOS_ACCIDENTE.COLISION_FRONTO_LATERAL,
  'colisión lateral': TIPOS_ACCIDENTE.COLISION_LATERAL,
  'colision lateral': TIPOS_ACCIDENTE.COLISION_LATERAL,
  'colisión múltiple': TIPOS_ACCIDENTE.COLISION_MULTIPLE,
  'colision multiple': TIPOS_ACCIDENTE.COLISION_MULTIPLE,
  'despeñamiento': TIPOS_ACCIDENTE.DESPEÑAMIENTO,
  'despenamiento': TIPOS_ACCIDENTE.DESPEÑAMIENTO,
  'otro': TIPOS_ACCIDENTE.OTRO,
  'solo salida de la vía': TIPOS_ACCIDENTE.SOLO_SALIDA_DE_LA_VIA,
  'solo salida de la via': TIPOS_ACCIDENTE.SOLO_SALIDA_DE_LA_VIA,
  'vuelco': TIPOS_ACCIDENTE.VUELCO
};

/**
 * Mapa de normalización de tipos de vehiculo
 * Mapea valores del CSV a valores del enum del modelo (usando constantes centralizadas)
 */
const TIPO_VEHICULO_MAP = {
  'ambulancia samur': TIPOS_VEHICULO.AMBULANCIA_SAMUR,
  'autobús': TIPOS_VEHICULO.AUTOBUS,
  'autobus': TIPOS_VEHICULO.AUTOBUS,
  'autobús articulado': TIPOS_VEHICULO.AUTOBUS_ARTICULADO,
  'autobus articulado': TIPOS_VEHICULO.AUTOBUS_ARTICULADO,
  'autobús articulado emt': TIPOS_VEHICULO.AUTOBUS_ARTICULADO_EMT,
  'autobus articulado emt': TIPOS_VEHICULO.AUTOBUS_ARTICULADO_EMT,
  'autobus emt': TIPOS_VEHICULO.AUTOBUS_EMT,
  'autocaravana': TIPOS_VEHICULO.AUTOCARAVANA,
  'bicicleta': TIPOS_VEHICULO.BICICLETA,
  'bicicleta epac (pedaleo asistido)': TIPOS_VEHICULO.BICICLETA_EPAC,
  'camión de bomberos': TIPOS_VEHICULO.CAMION_DE_BOMBEROS,
  'camion de bomberos': TIPOS_VEHICULO.CAMION_DE_BOMBEROS,
  'camión rígido': TIPOS_VEHICULO.CAMION_RIGIDO,
  'camion rígido': TIPOS_VEHICULO.CAMION_RIGIDO,
  'camion rigido': TIPOS_VEHICULO.CAMION_RIGIDO,
  'ciclo': TIPOS_VEHICULO.CICLO,
  'ciclomotor': TIPOS_VEHICULO.CICLOMOTOR,
  'ciclomotor de dos ruedas l1e-b': TIPOS_VEHICULO.CICLOMOTOR_DOS_RUEDAS,
  'ciclomotor de tres ruedas': TIPOS_VEHICULO.CICLOMOTOR_TRES_RUEDAS,
  'cuadriciclo ligero': TIPOS_VEHICULO.CUADRICICLO_LIGERO,
  'cuadriciclo no ligero': TIPOS_VEHICULO.CUADRICICLO_NO_LIGERO,
  'furgoneta': TIPOS_VEHICULO.FURGONETA,
  'maquinaria agrícola': TIPOS_VEHICULO.MAQUINARIA_AGRICOLA,
  'maquinaria agricola': TIPOS_VEHICULO.MAQUINARIA_AGRICOLA,
  'maquinaria de obras': TIPOS_VEHICULO.MAQUINARIA_DE_OBRAS,
  'motocicleta hasta 125cc': TIPOS_VEHICULO.MOTOCICLETA_HASTA_125CC,
  'motocicleta > 125cc': TIPOS_VEHICULO.MOTOCICLETA_MAS_125CC,
  'moto de tres ruedas hasta 125cc': TIPOS_VEHICULO.MOTO_TRES_RUEDAS_HASTA_125CC,
  'moto de tres ruedas > 125cc': TIPOS_VEHICULO.MOTO_TRES_RUEDAS_MAS_125CC,
  'otros vehículos con motor': TIPOS_VEHICULO.OTROS_VEHICULOS_CON_MOTOR,
  'otros vehiculos con motor': TIPOS_VEHICULO.OTROS_VEHICULOS_CON_MOTOR,
  'otros vehículos sin motor': TIPOS_VEHICULO.OTROS_VEHICULOS_SIN_MOTOR,
  'otros vehiculos sin motor': TIPOS_VEHICULO.OTROS_VEHICULOS_SIN_MOTOR,
  'patinete': TIPOS_VEHICULO.PATINETE,
  'remolque': TIPOS_VEHICULO.REMOLQUE,
  'semiremolque': TIPOS_VEHICULO.SEMIREMOLQUE,
  'sin especificar': TIPOS_VEHICULO.SIN_ESPECIFICAR,
  'taxi': TIPOS_VEHICULO.TAXI,
  'todo terreno': TIPOS_VEHICULO.TODO_TERRENO,
  'tractocamión': TIPOS_VEHICULO.TRACTOCAMION,
  'tractocamion': TIPOS_VEHICULO.TRACTOCAMION,
  'tren/metro': TIPOS_VEHICULO.TREN_METRO,
  'turismo': TIPOS_VEHICULO.TURISMO,
  'vehículo articulado': TIPOS_VEHICULO.VEHICULO_ARTICULADO,
  'vehiculo articulado': TIPOS_VEHICULO.VEHICULO_ARTICULADO,
  'vmu eléctrico': TIPOS_VEHICULO.VMU_ELECTRICO,
  'vmu electrico': TIPOS_VEHICULO.VMU_ELECTRICO,
  'null': TIPOS_VEHICULO.SIN_ESPECIFICAR
};

/**
 * Mapa de normalización de tipos de persona
 * Mapea valores del CSV a valores del enum del modelo (usando constantes centralizadas)
 */
const TIPO_PERSONA_MAP = {
  'conductor': TIPOS_PERSONA.CONDUCTOR,
  'peatón': TIPOS_PERSONA.PEATÓN,
  'peaton': TIPOS_PERSONA.PEATÓN,
  'testigo': TIPOS_PERSONA.TESTIGO,
  'viajero': TIPOS_PERSONA.VIAJERO,
  'pasajero': TIPOS_PERSONA.PASAJERO
};

/**
 * Mapa de normalización de estados meteorológicos
 */
const ESTADO_METEOROLOGICO_MAP = {
  'despejado': WEATHER_CONDITIONS.DESPEJADO,
  'nublado': WEATHER_CONDITIONS.NUBLADO,
  'lluvia débil': WEATHER_CONDITIONS.LLUVIA_DEBIL,
  'lluvia debil': WEATHER_CONDITIONS.LLUVIA_DEBIL,
  'lluvia': WEATHER_CONDITIONS.LLUVIA_DEBIL,
  'lluvia ligera': WEATHER_CONDITIONS.LLUVIA_DEBIL,
  'lluvia intensa': WEATHER_CONDITIONS.LLUVIA_INTENSA,
  'niebla': WEATHER_CONDITIONS.NIEBLA,
  'viento fuerte': WEATHER_CONDITIONS.VIENTO_FUERTE,
  'granizando': WEATHER_CONDITIONS.GRANIZANDO,
  'granizo': WEATHER_CONDITIONS.GRANIZANDO,
  'nevando': WEATHER_CONDITIONS.NEVANDO,
  'nieve': WEATHER_CONDITIONS.NEVANDO,
  'se desconoce': WEATHER_CONDITIONS.SE_DESCONOCE,
  'null': WEATHER_CONDITIONS.NULL,
  '': WEATHER_CONDITIONS.SE_DESCONOCE
};

// ============================================================================
// FUNCIONES DE NORMALIZACIÓN
// ============================================================================

/**
 * Normalizar tipo de accidente
 * @param {string} tipo - Tipo de accidente original del CSV
 * @returns {string} - Tipo normalizado
 */
function normalizarTipoAccidente(tipo) {
  if (!tipo || tipo.trim() === '') {
    return TIPOS_ACCIDENTE.OTRO;
  }
  const normalized = tipo.toLowerCase().trim();
  return TIPO_ACCIDENTE_MAP[normalized] || TIPOS_ACCIDENTE.OTRO;
}

/**
 * Normalizar tipo de vehículo
 * @param {string} tipo - Tipo de vehículo original del CSV
 * @returns {string} - Tipo normalizado
 */
function normalizarTipoVehiculo(tipo) {
  if (!tipo || tipo.trim() === '' || tipo.toLowerCase() === 'null') {
    return TIPOS_VEHICULO.SIN_ESPECIFICAR;
  }
  const normalized = tipo.toLowerCase().trim();
  return TIPO_VEHICULO_MAP[normalized] || TIPOS_VEHICULO.SIN_ESPECIFICAR;
}

/**
 * Normalizar tipo de persona
 * @param {string} tipo - Tipo de persona original del CSV
 * @returns {string} - Tipo normalizado
 */
function normalizarTipoPersona(tipo) {
  if (!tipo || tipo.trim() === '') {
    return TIPOS_PERSONA.CONDUCTOR;
  }
  const normalized = tipo.toLowerCase().trim();
  return TIPO_PERSONA_MAP[normalized] || TIPOS_PERSONA.CONDUCTOR;
}

/**
 * Normalizar estado meteorológico.
 *
 * El CSV del dataset Anthem trae la columna `estado_meteorológico` totalmente
 * VACIA en las 32 431 filas (verificado). Antes el importador resolvia esto
 * llenando 100% de los docs con "SE_DESCONOCE", creando un campo inutil que
 * parece informacion pero no aporta. Ahora si el CSV no trae dato devolvemos
 * `null` y la UI puede mostrar "no disponible" en lugar de "se desconoce"
 * (que ademas no se ajusta a la realidad: no se desconoce, simplemente no
 * se recolecto).
 *
 * @param {string} estado - Estado meteorológico original del CSV
 * @returns {string|null} - Estado normalizado o null si ausente
 */
function normalizarEstadoMeteorologico(estado) {
  if (!estado || estado.trim() === '') {
    return null;
  }
  const normalized = estado.toLowerCase().trim();
  return ESTADO_METEOROLOGICO_MAP[normalized] || WEATHER_CONDITIONS.SE_DESCONOCE;
}

/**
 * Normalizar rango de edad
 * @param {string} rango - Rango de edad original del CSV
 * @returns {string} - Rango normalizado (ej: "18-25", "65+", "DESCONOCIDO")
 */
function normalizarRangoEdad(rango) {
  if (!rango || rango.trim() === '' || rango.toLowerCase() === 'desconocido') {
    return 'DESCONOCIDO';
  }

  const normalized = rango.trim();

  // Formato "De X a Y años" -> "X-Y"
  const matchDeA = normalized.match(/De (\d+) a (\d+) años/i);
  if (matchDeA) {
    return `${matchDeA[1]}-${matchDeA[2]}`;
  }

  // Formato "Menor de X años" -> "0-X" (aprox)
  const matchMenor = normalized.match(/Menor de (\d+) años/i);
  if (matchMenor) {
    return `0-${parseInt(matchMenor[1]) - 1}`;
  }

  // Formato "Mayor de X años" o "Más de X años" -> "X+"
  // (el CSV usa la variante "Más de N años" pero aceptamos ambas)
  const matchMayor = normalized.match(/(?:Mayor|M[áa]s) de (\d+) años/i);
  if (matchMayor) {
    return `${matchMayor[1]}+`;
  }

  // Si ya cumple el formato esperado, devolver tal cual
  if (/^(\d+-\d+|\d+\+|DESCONOCIDO)$/i.test(normalized)) {
    return normalized;
  }

  return 'DESCONOCIDO';
}

/**
 * Parsear coordenadas via framework unificado.
 * Accidentes tiene perfil con utm.unidades='m', wgs84=null y requerida=false.
 *
 * @param {Object} row - Fila completa del CSV (el framework lee los campos del perfil)
 * @param {number} rowIndex - Indice de fila para logging
 * @returns {{utm:{x,y}|null, geometry:Object|null}}
 */
function parsearCoordenadas(row, rowIndex) {
  try {
    const coords = extraerCoordenadasModulo(row, 'accidentes');
    if (!coords) {return { utm: null, geometry: null };}

    // Loggear advertencias del cross-check sin rechazar
    for (const adv of coords.advertencias) {
      const razon = REJECTION_REASONS.COORDENADAS_FORMATO_INVALIDO;
      if (rejectionTracker.shouldLogWarn(razon, { advertencia: adv, fila: rowIndex })) {
        logger.warn({ fila: rowIndex, advertencia: adv }, 'Coordenadas con advertencia');
      }
    }

    return { utm: coords.utm, geometry: coords.geometry };
  } catch (e) {
    // accidentes tiene requerida=false; no deberia llegar aqui salvo bug
    logger.debug({ fila: rowIndex, error: e.message }, 'extraerCoordenadasModulo lanzo en accidentes');
    return { utm: null, geometry: null };
  }
}

/**
 * Parsear fecha del formato DD/MM/YYYY
 * @param {string} fechaStr - Fecha en formato string
 * @param {number} rowIndex - Índice de fila para logging
 * @returns {Date} - Objeto Date
 * @throws {Error} - Si la fecha es inválida
 */
function parsearFecha(fechaStr, rowIndex) {
  if (!fechaStr || fechaStr.trim() === '') {
    const razon = REJECTION_REASONS.FECHA_FALTANTE;
    const nivel = rejectionTracker.shouldLogWarn(razon, { fecha: fechaStr }) ? 'warn' : 'debug';
    logger[nivel]({
      fila: rowIndex,
      razon,
      datosOriginales: { fecha: fechaStr }
    }, 'Fila rechazada: fecha vacia');
    throw new Error(REJECTION_REASONS.FECHA_FALTANTE);
  }

  const parts = fechaStr.trim().split('/');
  if (parts.length !== 3) {
    const razon = REJECTION_REASONS.FECHA_FORMATO_INVALIDO;
    const nivel = rejectionTracker.shouldLogWarn(razon, { fecha: fechaStr, formatoEsperado: 'DD/MM/YYYY' }) ? 'warn' : 'debug';
    logger[nivel]({
      fila: rowIndex,
      razon,
      datosOriginales: { fecha: fechaStr, formatoEsperado: 'DD/MM/YYYY' }
    }, 'Fila rechazada: formato de fecha invalido');
    throw new Error(REJECTION_REASONS.FECHA_FORMATO_INVALIDO);
  }

  const [day, month, year] = parts.map(p => parseInt(p));

  if (isNaN(day) || isNaN(month) || isNaN(year)) {
    const razon = REJECTION_REASONS.FECHA_COMPONENTES_INVALIDOS;
    const nivel = rejectionTracker.shouldLogWarn(razon, { fecha: fechaStr, dia: day, mes: month, año: year }) ? 'warn' : 'debug';
    logger[nivel]({
      fila: rowIndex,
      razon,
      datosOriginales: { fecha: fechaStr, dia: day, mes: month, año: year }
    }, 'Fila rechazada: componentes de fecha no numericos');
    throw new Error(REJECTION_REASONS.FECHA_COMPONENTES_INVALIDOS);
  }

  if (day < VALIDATION_LIMITS.DAY_MIN || day > VALIDATION_LIMITS.DAY_MAX ||
      month < VALIDATION_LIMITS.MONTH_MIN || month > VALIDATION_LIMITS.MONTH_MAX ||
      year < VALIDATION_LIMITS.YEAR_MIN || year > VALIDATION_LIMITS.YEAR_MAX) {
    const razon = REJECTION_REASONS.FECHA_FUERA_RANGO;
    const nivel = rejectionTracker.shouldLogWarn(razon, { fecha: fechaStr, dia: day, mes: month, año: year }) ? 'warn' : 'debug';
    logger[nivel]({
      fila: rowIndex,
      razon,
      datosOriginales: { fecha: fechaStr, dia: day, mes: month, año: year }
    }, 'Fila rechazada: fecha fuera de rango');
    throw new Error(REJECTION_REASONS.FECHA_FUERA_RANGO);
  }

  // Usar Date.UTC para evitar desfase de TZ del runtime: el constructor
  // multiparam `new Date(year, month, day)` interpreta los componentes
  // en zona local (en Madrid podia desplazar la fecha 1-2h hacia atras y
  // dejar `getDate()` en el dia anterior). Date.UTC fija siempre UTC,
  // que es lo que esperan las queries posteriores (modelos sin tz).
  const date = new Date(Date.UTC(year, month - 1, day));

  if (isNaN(date.getTime())) {
    const razon = REJECTION_REASONS.FECHA_FORMATO_INVALIDO;
    const nivel = rejectionTracker.shouldLogWarn(razon, { fecha: fechaStr }) ? 'warn' : 'debug';
    logger[nivel]({
      fila: rowIndex,
      razon,
      datosOriginales: { fecha: fechaStr }
    }, 'Fila rechazada: fecha invalida');
    throw new Error(REJECTION_REASONS.FECHA_FORMATO_INVALIDO);
  }

  // Coercion: si JS rebobinó la fecha (ej: 29/02 en año no bisiesto, 31/04, etc),
  // la convertimos al ultimo dia existente del mismo mes. En este dataset ficticio
  // las "fechas calendario-imposibles" se interpretan como un desajuste menor del
  // generador de datos, no como dato corrupto. Se conserva mes y año intactos.
  if (date.getUTCMonth() !== month - 1 || date.getUTCFullYear() !== year) {
    // El truco `Date.UTC(year, month, 0)` devuelve el ultimo dia del mes
    // (month-1) en UTC, evitando ambiguedades de TZ.
    const ultimoDia = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const dateCoercida = new Date(Date.UTC(year, month - 1, ultimoDia));
    rejectionTracker.coerce('FECHA_COERCIDA_AL_ULTIMO_DIA_DEL_MES', {
      fila: rowIndex,
      original: fechaStr,
      coercida: `${String(ultimoDia).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`
    });
    return dateCoercida;
  }

  return date;
}

// ============================================================================
// CAMPOS DE ANALISIS COMPUTADOS
// ============================================================================

/**
 * Computar campos de analisis derivados de los datos base del accidente.
 * Replica la logica del pre-save hook del modelo, ya que bulkWrite no ejecuta middleware.
 *
 * @param {Object} data - Datos del accidente ya transformados
 * @returns {Object} - Datos con campos de analisis computados (merged)
 */
function calcularCamposAnalisis(data) {
  const { fecha, hora, personaAfectada, circunstancias, vehiculo } = data;

  // Campos temporales basicos.
  // La fecha se construye con Date.UTC en parsearFecha, asi que leemos sus
  // componentes con getters UTC (getUTCFullYear/getUTCMonth/getUTCDate). Con
  // los getters locales habia desfase de un dia en hosts con offset negativo.
  const año = fecha.getUTCFullYear();
  const mes = fecha.getUTCMonth() + 1;
  const dia = fecha.getUTCDate();
  const franjaHoraria = parseInt(hora.split(':')[0], 10);

  // Periodo del dia segun franja horaria
  let periodoDia;
  if (franjaHoraria >= 0 && franjaHoraria <= 5) {
    periodoDia = DAY_PERIODS.MADRUGADA;
  } else if (franjaHoraria >= 6 && franjaHoraria <= 11) {
    periodoDia = DAY_PERIODS.MAÑANA;
  } else if (franjaHoraria >= 12 && franjaHoraria <= 14) {
    periodoDia = DAY_PERIODS.MEDIODIA;
  } else if (franjaHoraria >= 15 && franjaHoraria <= 20) {
    periodoDia = DAY_PERIODS.TARDE;
  } else {
    periodoDia = DAY_PERIODS.NOCHE;
  }

  // Dia de la semana y tipo de jornada (getUTCDay coherente con Date.UTC)
  const diaSemana = fecha.getUTCDay();
  let tipoJornada;
  if (diaSemana === 0) {
    tipoJornada = WORKDAY_TYPES.DOMINGO_FESTIVO;
  } else if (diaSemana === 6) {
    tipoJornada = WORKDAY_TYPES.SABADO;
  } else {
    tipoJornada = WORKDAY_TYPES.LABORABLE;
  }

  // Factores de riesgo
  const factoresRiesgo = [];
  if (personaAfectada.positivaAlcohol === BINARY_INDICATORS.YES) {
    factoresRiesgo.push(FACTORES_RIESGO.ALCOHOL);
  }
  if (personaAfectada.positivaDroga === BINARY_INDICATORS.YES) {
    factoresRiesgo.push(FACTORES_RIESGO.DROGAS);
  }
  if (franjaHoraria >= 0 && franjaHoraria <= 5) {
    factoresRiesgo.push(FACTORES_RIESGO.HORA_MADRUGADA);
  }
  // Solo registrar "condiciones meteorologicas" como factor de riesgo si
  // tenemos un dato real Y distinto de despejado/desconocido. Con el fix
  // de `normalizarEstadoMeteorologico` el valor vacio del CSV se traduce
  // a `null` en lugar de "SE_DESCONOCE", asi que la comparacion `!== NULL`
  // (string literal) dejaba pasar `null` (valor) y se anyadia el factor
  // a TODOS los 32 429 accidentes (verificado en BD).
  const weather = circunstancias.estadoMeteorologico;
  if (weather &&
      weather !== WEATHER_CONDITIONS.DESPEJADO &&
      weather !== WEATHER_CONDITIONS.SE_DESCONOCE &&
      weather !== WEATHER_CONDITIONS.NULL) {
    factoresRiesgo.push(FACTORES_RIESGO.CONDICIONES_METEOROLOGICAS);
  }
  const tipoVehiculo = vehiculo.tipo;
  if (tipoVehiculo &&
      (tipoVehiculo.includes('BICICLETA') ||
       tipoVehiculo.includes('MOTOCICLETA') ||
       tipoVehiculo.includes('CICLOMOTOR') ||
       tipoVehiculo.includes('PATINETE'))) {
    factoresRiesgo.push(FACTORES_RIESGO.VEHICULO_DOS_RUEDAS);
  }

  // Puntuacion de gravedad (escala 0-10) segun tipo de lesion
  const tipoLesion = personaAfectada.tipoLesion;
  const gravityScores = {
    'FALLECIDO_24_HORAS': 10,
    'INGRESO_SUPERIOR_A_24_HORAS': 7,
    'INGRESO_INFERIOR_O_IGUAL_A_24_HORAS': 5,
    'ATENCI\u00d3N_EN_URGENCIAS_SIN_POSTERIOR_INGRESO': 4,
    'ASISTENCIA_SANITARIA_AMBULATORIA_CON_POSTERIORIDAD': 3,
    'ASISTENCIA_SANITARIA_INMEDIATA_EN_CENTRO_DE_SALUD_O_MUTUA': 3,
    'ASISTENCIA_SANITARIA_S\u00d3LO_EN_EL_LUGAR_DEL_ACCIDENTE': 2,
    'SIN_ASISTENCIA_SANITARIA': 1
  };
  const puntuacionGravedad = gravityScores[tipoLesion] || 0;

  // Clasificacion de gravedad en circunstancias
  let gravedad;
  if (tipoLesion === 'FALLECIDO_24_HORAS') {
    gravedad = SEVERITY_LEVELS.ACCIDENT.MORTAL;
  } else if (
    tipoLesion === 'INGRESO_SUPERIOR_A_24_HORAS' ||
    tipoLesion === 'INGRESO_INFERIOR_O_IGUAL_A_24_HORAS' ||
    tipoLesion === 'ATENCI\u00d3N_EN_URGENCIAS_SIN_POSTERIOR_INGRESO'
  ) {
    gravedad = SEVERITY_LEVELS.ACCIDENT.GRAVE;
  } else if (tipoLesion === 'SIN_ASISTENCIA_SANITARIA' || tipoLesion === 'SE_DESCONOCE') {
    // "Sin asistencia sanitaria" (cod_lesividad 14) y lesividad en blanco/null
    // (que el dataset documenta como "sin asistencia sanitaria") = persona
    // ilesa, NO un herido leve. Antes ambos caian al else -> LEVE, inflando
    // LEVE al ~74,5% de los afectados y vaciando SIN_LESIONES (que el enum
    // admite pero el importador nunca emitia). El resto de lesividades con
    // asistencia ambulatoria/in-situ (codigos 2,3) si son LEVE legitimas.
    gravedad = SEVERITY_LEVELS.ACCIDENT.SIN_LESIONES;
  } else {
    gravedad = SEVERITY_LEVELS.ACCIDENT.LEVE;
  }

  // Merge de campos computados
  data.año = año;
  data.mes = mes;
  data.dia = dia;
  data.franjaHoraria = franjaHoraria;
  data.analisis = {
    periodoDia,
    diaSemana,
    tipoJornada,
    factoresRiesgo,
    puntuacionGravedad
  };
  data.circunstancias.gravedad = gravedad;

  return data;
}

// ============================================================================
// VALIDACION Y TRANSFORMACION
// ============================================================================

/**
 * Validar y transformar una fila de datos de accidente
 * @param {Object} row - Fila del CSV
 * @param {number} rowIndex - Indice de fila
 * @returns {Object} - Datos transformados para insertar
 * @throws {Error} - Si los datos son invalidos
 */
function validarYTransformarFila(row, rowIndex) {
  // Campos por nombre de columna del CSV (con fallback BOM para primera columna):
  // num_expediente, fecha, hora, localizacion, numero, cod_distrito, distrito,
  // tipo_accidente, estado_meteorologico, tipo_vehiculo, tipo_persona, rango_edad,
  // sexo, cod_lesividad, lesividad, coordenada_x_utm, coordenada_y_utm,
  // positiva_alcohol, positiva_droga

  // El CSV puede traer un BOM UTF-8 (EF BB BF) que al leerse con encoding
  // latin1 se convierte en "\u00EF\u00BB\u00BF" (3 chars), por lo que la cabecera real
  // es "\u00EF\u00BB\u00BFnum_expediente" en vez de "num_expediente". Como no podemos
  // garantizar el formato exacto del BOM en runs futuros, buscamos la
  // clave por sufijo (cualquier key cuyo nombre termine en "num_expediente").
  const expedienteKey = Object.keys(row).find(k => k.endsWith('num_expediente'));
  const numExpedienteRaw = expedienteKey ? row[expedienteKey] : undefined;
  const numeroExpediente = numExpedienteRaw?.toString().trim();
  if (!numeroExpediente) {
    const razon = REJECTION_REASONS.NUMERO_EXPEDIENTE_FALTANTE;
    const nivel = rejectionTracker.shouldLogWarn(razon, { numeroExpediente: numExpedienteRaw }) ? 'warn' : 'debug';
    logger[nivel]({
      fila: rowIndex,
      razon,
      datosOriginales: { numeroExpediente: numExpedienteRaw }
    }, 'Fila rechazada: numero de expediente faltante');
    throw new Error(REJECTION_REASONS.NUMERO_EXPEDIENTE_FALTANTE);
  }

  if (!/^\d{4}S\d{6}$/.test(numeroExpediente)) {
    const razon = REJECTION_REASONS.NUMERO_EXPEDIENTE_FORMATO_INVALIDO;
    const nivel = rejectionTracker.shouldLogWarn(razon, { numeroExpediente, formatoEsperado: 'YYYYSNNNNNN' }) ? 'warn' : 'debug';
    logger[nivel]({
      fila: rowIndex,
      razon,
      datosOriginales: { numeroExpediente, formatoEsperado: 'YYYYSNNNNNN' }
    }, 'Fila rechazada: formato de expediente invalido');
    throw new Error(REJECTION_REASONS.NUMERO_EXPEDIENTE_FORMATO_INVALIDO);
  }

  // Parsear fecha
  const fechaStr = row.fecha?.toString().trim();
  const fecha = parsearFecha(fechaStr, rowIndex);

  // Parsear hora (CSV tiene formato H:MM:SS o HH:MM:SS, modelo espera HH:MM)
  const horaRaw = row.hora?.toString().trim();
  if (!horaRaw || !/^\d{1,2}:\d{2}(:\d{2})?$/.test(horaRaw)) {
    const razon = REJECTION_REASONS.HORA_FORMATO_INVALIDO;
    const nivel = rejectionTracker.shouldLogWarn(razon, { hora: horaRaw, formatoEsperado: 'H:MM:SS o HH:MM:SS' }) ? 'warn' : 'debug';
    logger[nivel]({
      fila: rowIndex,
      razon,
      datosOriginales: { hora: horaRaw, formatoEsperado: 'H:MM:SS o HH:MM:SS' }
    }, 'Fila rechazada: formato de hora invalido');
    throw new Error(REJECTION_REASONS.HORA_FORMATO_INVALIDO);
  }
  // Convertir a formato HH:MM (sin segundos, con padding)
  const partes = horaRaw.split(':');
  const hora = partes[0].padStart(2, '0') + ':' + partes[1];

  // Datos de ubicacion (normalizados para corregir mojibake del CSV)
  const calle = normalizarTexto(row.localizacion);
  if (!calle) {
    const razon = REJECTION_REASONS.LOCALIZACION_FALTANTE;
    const nivel = rejectionTracker.shouldLogWarn(razon, { localizacion: row.localizacion }) ? 'warn' : 'debug';
    logger[nivel]({
      fila: rowIndex,
      razon,
      datosOriginales: { localizacion: row.localizacion }
    }, 'Fila rechazada: localizacion faltante');
    throw new Error(REJECTION_REASONS.LOCALIZACION_FALTANTE);
  }

  const numero = normalizarTexto(row.numero) || null;
  const codigoDistrito = normalizarTexto(row.cod_distrito);
  const nombreDistrito = normalizarTexto(row.distrito).toUpperCase();

  if (!codigoDistrito || !nombreDistrito) {
    const razon = REJECTION_REASONS.DISTRITO_INCOMPLETO;
    const nivel = rejectionTracker.shouldLogWarn(razon, { codigoDistrito, nombreDistrito }) ? 'warn' : 'debug';
    logger[nivel]({
      fila: rowIndex,
      razon,
      datosOriginales: { codigoDistrito, nombreDistrito }
    }, 'Fila rechazada: datos de distrito incompletos');
    throw new Error(REJECTION_REASONS.DISTRITO_INCOMPLETO);
  }

  // Parsear coordenadas (no criticas, pueden ser null)
  const { utm: coordenadas, geometry } = parsearCoordenadas(row, rowIndex);

  // Datos del accidente.
  // BUG fix: aplicar normalizarTexto al tipo. Sin esto los valores con
  // tildes ("Colisi\u00f3n", "Ca\u00edda", "Despe\u00f1amiento", "Solo salida de la v\u00eda")
  // llegan corruptos (mojibake o latin1 mal-leido) y no matchean con
  // TIPO_ACCIDENTE_MAP, cayendo todos a OTRO y perdiendo 8 de los 13 tipos.
  const tipoAccidenteOriginal = normalizarTexto(row.tipo_accidente) || '';
  const tipoAccidente = normalizarTipoAccidente(tipoAccidenteOriginal);
  // El CSV es UTF-8 pero se lee con encoding latin1, asi que la cabecera con
  // tilde "estado_meteorologico" llega mojibakeada (p.ej. estado_meteorol\u00c3\u00b3gico)
  // y el acceso por clave exacta devolvia undefined -> null en el 100% de los
  // docs, perdiendo ~28k filas con meteorologia real. Resolvemos la columna por
  // patron robusto al mojibake (mismo enfoque que num_expediente arriba).
  const meteoKey = Object.keys(row).find(k => /estado_meteorol.+gico/i.test(k));
  const estadoMeteorologico = normalizarEstadoMeteorologico(
    normalizarTexto(meteoKey ? row[meteoKey] : '') || ''
  );

  // Datos del vehiculo
  // BUG fix: aplicar normalizarTexto. Sin esto valores como "AutobÃºs", "CamiÃ³n",
  // "VehÃ­culo articulado", "Maquinaria agrÃ­cola" no matchean con
  // TIPO_VEHICULO_MAP y caen a SIN_ESPECIFICAR.
  const tipoVehiculoOriginal = normalizarTexto(row.tipo_vehiculo) || '';
  const tipoVehiculo = normalizarTipoVehiculo(tipoVehiculoOriginal);

  // Datos de la persona afectada
  // BUG fix: aplicar normalizarTexto. Sin esto "PeatÃ³n" no matchea y todos
  // los peatones caen a CONDUCTOR por defecto.
  const tipoPersona = normalizarTipoPersona(normalizarTexto(row.tipo_persona));
  const rangoEdadRaw = normalizarTexto(row.rango_edad);
  const rangoEdad = normalizarRangoEdad(rangoEdadRaw);
  const sexoRaw = row.sexo?.toString().trim().toUpperCase();
  const sexo = (sexoRaw === 'MUJER') ? GENDERS.MUJER :
    (sexoRaw === 'HOMBRE') ? GENDERS.HOMBRE : GENDERS.DESCONOCIDO;

  // Datos de lesividad.
  // BUG fix: el CSV trae codigos sin padding ('4', '7' en vez de '04', '07').
  // Antes el lookup buscaba siempre con padding cero y los codigos 1-9 caian
  // a SE_DESCONOCE, perdiendo TODOS los GRAVE e incluso los 34 MORTAL
  // (codigo 4 = FALLECIDO). Normalizamos a 2 digitos con padStart antes del
  // lookup para cubrir ambos formatos.
  // Antes guardabamos la cadena 'NULL' literal del CSV cuando no habia
  // codigo de lesividad. Eso producia 14 133 docs (43%) con el string 'NULL'
  // en BD, que confunde a cualquier query/agregado que espere null o ausencia.
  const codigoLesividadRaw = row.cod_lesividad?.toString().trim();
  const codigoLesividad = codigoLesividadRaw && codigoLesividadRaw !== 'NULL'
    ? codigoLesividadRaw.padStart(2, '0')
    : null;
  const lesividad = normalizarTexto(row.lesividad) || '';

  // Mapear tipo de lesion basado en codigo o descripcion (usando constantes centralizadas)
  let tipoLesion = TIPOS_LESION.SE_DESCONOCE;
  if (codigoLesividad) {
    // Mapeo segun dataset_information.md (seccion Lesividad, lineas 115-124).
    // Claves SIEMPRE en formato '01'-'77' (2 digitos) tras el padStart.
    const codigoMap = {
      '01': TIPOS_LESION.ATENCIÓN_EN_URGENCIAS_SIN_POSTERIOR_INGRESO,
      '02': TIPOS_LESION.INGRESO_INFERIOR_O_IGUAL_A_24_HORAS,
      '03': TIPOS_LESION.INGRESO_SUPERIOR_A_24_HORAS,
      '04': TIPOS_LESION.FALLECIDO_24_HORAS,
      '05': TIPOS_LESION.ASISTENCIA_SANITARIA_AMBULATORIA_CON_POSTERIORIDAD,
      '06': TIPOS_LESION.ASISTENCIA_SANITARIA_INMEDIATA_EN_CENTRO_DE_SALUD_O_MUTUA,
      '07': TIPOS_LESION.ASISTENCIA_SANITARIA_SÓLO_EN_EL_LUGAR_DEL_ACCIDENTE,
      '14': TIPOS_LESION.SIN_ASISTENCIA_SANITARIA,
      '77': TIPOS_LESION.SE_DESCONOCE
    };
    tipoLesion = codigoMap[codigoLesividad] || TIPOS_LESION.SE_DESCONOCE;
  } else if (lesividad && lesividad !== 'NULL') { // 'NULL' string defensivo: el CSV puede traerlo en `lesividad`
    if (lesividad.toLowerCase().includes('fallec')) {
      tipoLesion = TIPOS_LESION.FALLECIDO_24_HORAS;
    } else if (lesividad.toLowerCase().includes('grave') || lesividad.toLowerCase().includes('ingreso')) {
      tipoLesion = TIPOS_LESION.INGRESO_SUPERIOR_A_24_HORAS;
    } else if (lesividad.toLowerCase().includes('leve') || lesividad.toLowerCase().includes('ambulat')) {
      tipoLesion = TIPOS_LESION.ASISTENCIA_SANITARIA_AMBULATORIA_CON_POSTERIORIDAD;
    }
  } else {
    // Sin codigo de lesividad ni descripcion: segun la doc del dataset, la
    // lesividad en blanco significa "Sin asistencia sanitaria" (ileso, cod 14),
    // NO "se desconoce". Antes ~14.800 filas (45,6%) caian a SE_DESCONOCE,
    // confundiendo "ileso" con "desconocido" (solo ~3 filas son SE_DESCONOCE
    // reales, via codigo 77).
    tipoLesion = TIPOS_LESION.SIN_ASISTENCIA_SANITARIA;
  }

  // Datos de sustancias.
  // BINARY_INDICATORS.NULL es la cadena 'NULL' literal: guardabamos eso en
  // BD cuando el CSV no especificaba S/N/1/0 (en droga, 32 349 docs / 99.7%
  // se quedaban con 'NULL' string). Ahora usamos null real para que las
  // queries pueden distinguir "no informado" de "negativo".
  const alcoholRaw = row.positiva_alcohol?.toString().trim().toUpperCase();
  const positivaAlcohol = (alcoholRaw === 'S') ? BINARY_INDICATORS.YES :
    (alcoholRaw === 'N') ? BINARY_INDICATORS.NO : null;

  const drogaRaw = row.positiva_droga?.toString().trim().toUpperCase();
  const positivaDroga = (drogaRaw === 'S' || drogaRaw === '1') ? BINARY_INDICATORS.YES :
    (drogaRaw === 'N' || drogaRaw === '0') ? BINARY_INDICATORS.NO : null;

  // Construir objeto de accidente
  const accidentData = {
    numeroExpediente,
    fecha,
    hora,

    ubicacion: {
      calle,
      numero,
      codigoDistrito,
      nombreDistrito,
      coordenadas,
      geometry: geometry || undefined
    },

    circunstancias: {
      tipoAccidenteOriginal,
      tipoAccidente,
      estadoMeteorologico
    },

    vehiculo: {
      tipoVehiculoOriginal,
      tipo: tipoVehiculo
    },

    personaAfectada: {
      tipoPersona,
      rangoEdad,
      sexo,
      codigoLesividad,
      tipoLesion,
      positivaAlcohol,
      positivaDroga
    },

    procesamiento: {
      archivoOrigen: 'Anthem_CTC_Accidentalidad.csv',
      importadoEn: new Date()
    }
  };

  // Computar campos de analisis (bypass de middleware pre-save en bulkWrite)
  return calcularCamposAnalisis(accidentData);
}

// ============================================================================
// PROCESAMIENTO
// ============================================================================

/**
 * Procesar un lote de datos de accidentes
 * @param {Array} batch - Lote de datos de accidentes
 * @returns {Promise<Object>} - Resultados del procesamiento
 */
async function procesarLote(batch) {
  if (batch.length === 0) {
    return { nuevos: 0, errores: 0 };
  }

  try {
    const bulkOps = batch.map(accidentData => ({
      insertOne: { document: accidentData }
    }));

    const result = await Accidente.bulkWrite(bulkOps, {
      ordered: false,
      bypassDocumentValidation: true
    });

    const nuevos = result.insertedCount || 0;

    totalInserted += nuevos;

    if (nuevos > 0) {
      logger.debug({
        lote: { nuevos, total: batch.length }
      }, 'Lote procesado correctamente');
    }

    return { nuevos, errores: 0 };

  } catch (error) {
    // Si el bulkWrite falla completamente, intentar procesar documentos individuales
    logger.warn({
      error: error.message,
      loteSize: batch.length
    }, 'Error en bulkWrite, procesando documentos individualmente');

    let nuevos = 0;
    let errores = 0;

    // Procesar cada documento individualmente
    for (const accidentData of batch) {
      try {
        await Accidente.create(accidentData);
        nuevos++;
        totalInserted++;
      } catch (individualError) {
        errores++;
        totalErrors++;

        // Solo loguear los primeros 5 errores para no saturar los logs
        if (errores <= 5) {
          logger.error({
            numeroExpediente: accidentData.numeroExpediente,
            error: individualError.message
          }, 'Error insertando accidente individual');
        }
      }
    }

    if (errores > 5) {
      logger.warn({
        erroresAdicionales: errores - 5
      }, 'Errores adicionales omitidos en logs');
    }

    return { nuevos, errores };
  }
}

/**
 * Procesar el archivo CSV de accidentes
 * @returns {Promise<Object>} - Estadísticas de procesamiento
 */
async function procesarArchivoAccidentes() {
  return new Promise((resolve, reject) => {
    const batch = [];
    const pendingBatches = [];
    let rowCount = 0;
    let processedCount = 0;
    let errorCount = 0;

    logger.info({
      archivo: path.basename(DATA_FILE),
      batchSize: BATCH_SIZE
    }, 'Iniciando procesamiento de archivo de accidentes');

    const stream = crearLectorCSV(DATA_FILE)
      .pipe(csv({
        separator: ';',
        skipEmptyLines: true,
        strict: false,
        quote: '"',
        escape: '"'
      }))
      .on('data', (row) => {
        if (isShuttingDown) {
          stream.destroy();
          return;
        }

        rowCount++;
        totalProcessed++;

        try {
          const accidentData = validarYTransformarFila(row, rowCount);
          batch.push(accidentData);
          processedCount++;

          // Procesar lote cuando alcance el tamaño configurado
          if (batch.length >= BATCH_SIZE) {
            stream.pause();
            const batchPromise = procesarLote(batch.splice(0))
              .then(() => {
                if (!isShuttingDown) {
                  stream.resume();
                }
              })
              .catch((error) => {
                logger.error({ error: error.message }, 'Error en lote');
                if (!isShuttingDown) {
                  stream.resume();
                }
              });
            pendingBatches.push(batchPromise);
          }

          // Mostrar progreso
          if (processedCount % LOG_INTERVAL === 0) {
            logger.info({
              procesadas: processedCount.toLocaleString(),
              errores: errorCount,
              insertadas: totalInserted
            }, 'Progreso de importacion');
          }

        } catch (_error) {
          errorCount++;
          totalRejected++;
          // El error ya fue loggeado en validarYTransformarFila o parsearFecha
        }
      })
      .on('end', async () => {
        try {
          // Esperar a que todos los lotes pendientes terminen
          if (pendingBatches.length > 0) {
            await Promise.all(pendingBatches);
          }

          // Procesar lote final
          if (batch.length > 0 && !isShuttingDown) {
            await procesarLote(batch);
          }

          logger.info({
            archivo: path.basename(DATA_FILE),
            filasLeidas: rowCount.toLocaleString(),
            registrosProcesados: processedCount.toLocaleString(),
            errores: errorCount
          }, 'Archivo completado');

          resolve({
            totalRows: rowCount,
            processed: processedCount,
            errors: errorCount
          });

        } catch (error) {
          reject(error);
        }
      })
      .on('error', (error) => {
        logger.error({ error: error.message }, 'Error leyendo archivo CSV');
        reject(new Error(`Error leyendo archivo: ${error.message}`));
      });
  });
}

/**
 * Verificar que el archivo de datos existe
 * @returns {Promise<boolean>}
 */
async function verificarArchivoDatos() {
  try {
    await fs.access(DATA_FILE);
    return true;
  } catch (_error) {
    throw new Error(`Archivo de datos no encontrado: ${DATA_FILE}`);
  }
}

/**
 * Mostrar resumen final
 * @param {number} startTime - Tiempo de inicio en ms
 */
function mostrarResumen(startTime) {
  const endTime = Date.now();
  const durationMs = endTime - startTime;

  logger.info({
    resumen: {
      duracion: formatDuration(durationMs),
      velocidad: calculateProcessingSpeed(totalProcessed, durationMs),
      registrosProcesados: totalProcessed.toLocaleString(),
      registrosInsertados: totalInserted.toLocaleString(),
      registrosRechazados: totalRejected.toLocaleString(),
      errores: totalErrors.toLocaleString(),
      tasaExito: totalProcessed > 0 ?
        `${(totalInserted / totalProcessed * 100).toFixed(2)}%` : '0%'
    }
  }, 'Importacion de accidentes completada');

  // Resumen de rechazos por tipo
  const rejectionSummary = rejectionTracker.getSortedSummary();
  if (rejectionSummary.length > 0) {
    logger.info({
      totalRechazos: rejectionTracker.totalRejected,
      desglose: rejectionSummary
    }, 'Resumen de rechazos por tipo');
  }
}

// ============================================================================
// FUNCIÓN PRINCIPAL
// ============================================================================

/**
 * Función principal del script
 */
async function main() {
  const startTime = Date.now();

  logger.info('Iniciando importacion de datos de accidentalidad');

  try {
    // Verificar archivo de datos
    await verificarArchivoDatos();
    logger.info({ archivo: DATA_FILE }, 'Archivo de datos verificado');

    // Conectar a MongoDB
    logger.info('Conectando a MongoDB...');
    await connectDB(config.database.uri);
    logger.info('Conexion a MongoDB establecida');

    // Verificar modelo
    const countAntes = await Accidente.countDocuments().maxTimeMS(10000);
    logger.info({
      registrosExistentes: countAntes.toLocaleString()
    }, 'Modelo de accidentes verificado');

    // Procesar archivo
    await procesarArchivoAccidentes();

    // Mostrar resumen
    mostrarResumen(startTime);

    // Contar registros finales
    const countDespues = await Accidente.countDocuments().maxTimeMS(10000);
    logger.info({
      registrosFinales: countDespues.toLocaleString(),
      incremento: (countDespues - countAntes).toLocaleString()
    }, 'Estadisticas finales de la base de datos');

  } catch (error) {
    logger.error({
      error: error.message,
      stack: error.stack
    }, 'Error critico durante la importacion');
    process.exit(1);

  } finally {
    // Escribir summary estructurado a logs/import/ para que el padre lo agregue
    buildAndWriteSummary('accidentes', {
      startTime,
      counts: {
        totalProcessed,
        inserted: totalInserted,
        rejected: totalRejected,
        errors: totalErrors
      },
      rejectionTracker
    });

    // Cerrar conexión
    if (mongoose.connection.readyState === 1) {
      try {
        await mongoose.connection.close();
        logger.info('Conexion a MongoDB cerrada');
      } catch (error) {
        logger.error({ error: error.message }, 'Error cerrando conexion');
      }
    }
  }

  logger.info('Script completado');
  if (process.exitCode === 1) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

// ============================================================================
// MANEJO DE SEÑALES
// ============================================================================

/**
 * Manejador de señales de terminación
 * @param {string} signal - Señal recibida
 */
async function manejarCierre(signal) {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;

  logger.warn({ signal }, 'Senal de terminacion recibida, cerrando...');

  if (mongoose.connection.readyState === 1) {
    try {
      await mongoose.connection.close();
      logger.info('Conexion cerrada por senal de terminacion');
    } catch (error) {
      logger.error({ error: error.message }, 'Error cerrando conexion');
    }
  }

  process.exit(0);
}

process.on('SIGINT', () => manejarCierre('SIGINT'));
process.on('SIGTERM', () => manejarCierre('SIGTERM'));

process.on('uncaughtException', (error) => {
  console.error('UNCAUGHT EXCEPTION:', error);
  logger.fatal({ error: error.message, stack: error.stack }, 'Error no capturado');
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('UNHANDLED REJECTION:', reason);
  logger.fatal({ reason, promise }, 'Promesa rechazada no manejada');
  process.exit(1);
});

// ============================================================================
// EJECUCIÓN
// ============================================================================

if (require.main === module) {
  main().catch(error => {
    logger.fatal({ error: error.message }, 'Error fatal ejecutando script');
    process.exit(1);
  });
}

module.exports = {
  main,
  procesarArchivoAccidentes,
  validarYTransformarFila,
  REJECTION_REASONS
};
