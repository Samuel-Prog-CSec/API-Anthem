/**
 * Script de Importación de Datos de Accidentalidad
 *
 * Procesa y carga datos de accidentes desde el archivo CSV a la base de datos MongoDB.
 * Incluye validación de datos, transformación, normalización y manejo de errores.
 *
 * Uso: node scripts/importation/importAccidentData.js
 */

process.env.SCRIPT_MODE = 'true';

const path = require('path');
const csv = require('csv-parser');
const { createReadStream } = require('fs');
const fs = require('fs').promises;
const mongoose = require('mongoose');

// Importar modelos, configuración y utilidades
const Accident = require('../../src/models/Accident');
const { connectDB } = require('../../src/config/database');
const config = require('../../src/config/config');
const logger = require('../../src/config/logger');
const { handleMongoError } = require('../../src/utils/errorUtils');
const {
  VALIDATION_LIMITS,
  GENDERS,
  WEATHER_CONDITIONS,
  BINARY_INDICATORS,
  ACCIDENT_TYPES,
  VEHICLE_TYPES,
  PERSON_TYPES,
  INJURY_TYPES
} = require('../../src/constants');
const {
  RejectionTracker,
  formatDuration,
  calculateProcessingSpeed
} = require('./helpers/importHelpers');

// Logger específico para importación
const importLogger = logger.child({ component: 'import-accidents' });

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
let totalUpdated = 0;
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
  'alcance': ACCIDENT_TYPES.ALCANCE,
  'atropello a animal': ACCIDENT_TYPES.ATROPELLO_A_ANIMAL,
  'atropello a persona': ACCIDENT_TYPES.ATROPELLO_A_PERSONA,
  'caída': ACCIDENT_TYPES.CAIDA,
  'caida': ACCIDENT_TYPES.CAIDA,
  'choque contra obstáculo fijo': ACCIDENT_TYPES.CHOQUE_CONTRA_OBSTACULO_FIJO,
  'choque contra obstaculo fijo': ACCIDENT_TYPES.CHOQUE_CONTRA_OBSTACULO_FIJO,
  'colisión frontal': ACCIDENT_TYPES.COLISION_FRONTAL,
  'colision frontal': ACCIDENT_TYPES.COLISION_FRONTAL,
  'colisión fronto-lateral': ACCIDENT_TYPES.COLISION_FRONTO_LATERAL,
  'colision fronto-lateral': ACCIDENT_TYPES.COLISION_FRONTO_LATERAL,
  'colisión lateral': ACCIDENT_TYPES.COLISION_LATERAL,
  'colision lateral': ACCIDENT_TYPES.COLISION_LATERAL,
  'colisión múltiple': ACCIDENT_TYPES.COLISION_MULTIPLE,
  'colision multiple': ACCIDENT_TYPES.COLISION_MULTIPLE,
  'despeñamiento': ACCIDENT_TYPES.DESPEÑAMIENTO,
  'despenamiento': ACCIDENT_TYPES.DESPEÑAMIENTO,
  'otro': ACCIDENT_TYPES.OTRO,
  'solo salida de la vía': ACCIDENT_TYPES.SOLO_SALIDA_DE_LA_VIA,
  'solo salida de la via': ACCIDENT_TYPES.SOLO_SALIDA_DE_LA_VIA,
  'vuelco': ACCIDENT_TYPES.VUELCO
};

/**
 * Mapa de normalización de tipos de vehiculo
 * Mapea valores del CSV a valores del enum del modelo (usando constantes centralizadas)
 */
const TIPO_VEHICULO_MAP = {
  'ambulancia samur': VEHICLE_TYPES.AMBULANCIA_SAMUR,
  'autobús': VEHICLE_TYPES.AUTOBUS,
  'autobus': VEHICLE_TYPES.AUTOBUS,
  'autobús articulado': VEHICLE_TYPES.AUTOBUS_ARTICULADO,
  'autobus articulado': VEHICLE_TYPES.AUTOBUS_ARTICULADO,
  'autobús articulado emt': VEHICLE_TYPES.AUTOBUS_ARTICULADO_EMT,
  'autobus articulado emt': VEHICLE_TYPES.AUTOBUS_ARTICULADO_EMT,
  'autobus emt': VEHICLE_TYPES.AUTOBUS_EMT,
  'autocaravana': VEHICLE_TYPES.AUTOCARAVANA,
  'bicicleta': VEHICLE_TYPES.BICICLETA,
  'bicicleta epac (pedaleo asistido)': VEHICLE_TYPES.BICICLETA_EPAC,
  'camión de bomberos': VEHICLE_TYPES.CAMION_DE_BOMBEROS,
  'camion de bomberos': VEHICLE_TYPES.CAMION_DE_BOMBEROS,
  'camión rígido': VEHICLE_TYPES.CAMION_RIGIDO,
  'camion rígido': VEHICLE_TYPES.CAMION_RIGIDO,
  'camion rigido': VEHICLE_TYPES.CAMION_RIGIDO,
  'ciclo': VEHICLE_TYPES.CICLO,
  'ciclomotor': VEHICLE_TYPES.CICLOMOTOR,
  'ciclomotor de dos ruedas l1e-b': VEHICLE_TYPES.CICLOMOTOR_DOS_RUEDAS,
  'ciclomotor de tres ruedas': VEHICLE_TYPES.CICLOMOTOR_TRES_RUEDAS,
  'cuadriciclo ligero': VEHICLE_TYPES.CUADRICICLO_LIGERO,
  'cuadriciclo no ligero': VEHICLE_TYPES.CUADRICICLO_NO_LIGERO,
  'furgoneta': VEHICLE_TYPES.FURGONETA,
  'maquinaria agrícola': VEHICLE_TYPES.MAQUINARIA_AGRICOLA,
  'maquinaria agricola': VEHICLE_TYPES.MAQUINARIA_AGRICOLA,
  'maquinaria de obras': VEHICLE_TYPES.MAQUINARIA_DE_OBRAS,
  'motocicleta hasta 125cc': VEHICLE_TYPES.MOTOCICLETA_HASTA_125CC,
  'motocicleta > 125cc': VEHICLE_TYPES.MOTOCICLETA_MAS_125CC,
  'moto de tres ruedas hasta 125cc': VEHICLE_TYPES.MOTO_TRES_RUEDAS_HASTA_125CC,
  'moto de tres ruedas > 125cc': VEHICLE_TYPES.MOTO_TRES_RUEDAS_MAS_125CC,
  'otros vehículos con motor': VEHICLE_TYPES.OTROS_VEHICULOS_CON_MOTOR,
  'otros vehiculos con motor': VEHICLE_TYPES.OTROS_VEHICULOS_CON_MOTOR,
  'otros vehículos sin motor': VEHICLE_TYPES.OTROS_VEHICULOS_SIN_MOTOR,
  'otros vehiculos sin motor': VEHICLE_TYPES.OTROS_VEHICULOS_SIN_MOTOR,
  'patinete': VEHICLE_TYPES.PATINETE,
  'remolque': VEHICLE_TYPES.REMOLQUE,
  'semiremolque': VEHICLE_TYPES.SEMIREMOLQUE,
  'sin especificar': VEHICLE_TYPES.SIN_ESPECIFICAR,
  'taxi': VEHICLE_TYPES.TAXI,
  'todo terreno': VEHICLE_TYPES.TODO_TERRENO,
  'tractocamión': VEHICLE_TYPES.TRACTOCAMION,
  'tractocamion': VEHICLE_TYPES.TRACTOCAMION,
  'tren/metro': VEHICLE_TYPES.TREN_METRO,
  'turismo': VEHICLE_TYPES.TURISMO,
  'vehículo articulado': VEHICLE_TYPES.VEHICULO_ARTICULADO,
  'vehiculo articulado': VEHICLE_TYPES.VEHICULO_ARTICULADO,
  'vmu eléctrico': VEHICLE_TYPES.VMU_ELECTRICO,
  'vmu electrico': VEHICLE_TYPES.VMU_ELECTRICO,
  'null': VEHICLE_TYPES.SIN_ESPECIFICAR
};

/**
 * Mapa de normalización de tipos de persona
 * Mapea valores del CSV a valores del enum del modelo (usando constantes centralizadas)
 */
const TIPO_PERSONA_MAP = {
  'conductor': PERSON_TYPES.CONDUCTOR,
  'peatón': PERSON_TYPES.PEATÓN,
  'peaton': PERSON_TYPES.PEATÓN,
  'testigo': PERSON_TYPES.TESTIGO,
  'viajero': PERSON_TYPES.VIAJERO,
  'pasajero': PERSON_TYPES.PASAJERO
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
function normalizeAccidentType(tipo) {
  if (!tipo || tipo.trim() === '') {
    return ACCIDENT_TYPES.OTRO;
  }
  const normalized = tipo.toLowerCase().trim();
  return TIPO_ACCIDENTE_MAP[normalized] || ACCIDENT_TYPES.OTRO;
}

/**
 * Normalizar tipo de vehículo
 * @param {string} tipo - Tipo de vehículo original del CSV
 * @returns {string} - Tipo normalizado
 */
function normalizeVehicleType(tipo) {
  if (!tipo || tipo.trim() === '' || tipo.toLowerCase() === 'null') {
    return VEHICLE_TYPES.SIN_ESPECIFICAR;
  }
  const normalized = tipo.toLowerCase().trim();
  return TIPO_VEHICULO_MAP[normalized] || VEHICLE_TYPES.SIN_ESPECIFICAR;
}

/**
 * Normalizar tipo de persona
 * @param {string} tipo - Tipo de persona original del CSV
 * @returns {string} - Tipo normalizado
 */
function normalizePersonType(tipo) {
  if (!tipo || tipo.trim() === '') {
    return PERSON_TYPES.CONDUCTOR;
  }
  const normalized = tipo.toLowerCase().trim();
  return TIPO_PERSONA_MAP[normalized] || PERSON_TYPES.CONDUCTOR;
}

/**
 * Normalizar estado meteorológico
 * @param {string} estado - Estado meteorológico original del CSV
 * @returns {string} - Estado normalizado
 */
function normalizeWeatherState(estado) {
  if (!estado || estado.trim() === '') {
    return WEATHER_CONDITIONS.SE_DESCONOCE;
  }
  const normalized = estado.toLowerCase().trim();
  return ESTADO_METEOROLOGICO_MAP[normalized] || WEATHER_CONDITIONS.SE_DESCONOCE;
}

/**
 * Normalizar rango de edad
 * @param {string} rango - Rango de edad original del CSV
 * @returns {string} - Rango normalizado (ej: "18-25", "65+", "DESCONOCIDO")
 */
function normalizeAgeRange(rango) {
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

  // Formato "Mayor de X años" -> "X+"
  const matchMayor = normalized.match(/Mayor de (\d+) años/i);
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
 * Parsear y validar coordenadas UTM
 * @param {string} xStr - Coordenada X
 * @param {string} yStr - Coordenada Y
 * @param {number} rowIndex - Índice de fila para logging
 * @returns {Object|null} - Coordenadas {x, y} o null si inválidas
 */
function parseCoordinates(xStr, yStr, rowIndex) {
  if (!xStr || !yStr || xStr.trim() === '' || yStr.trim() === '') {
    return null;
  }

  // Reemplazar comas por puntos para decimales
  const x = parseFloat(xStr.replace(',', '.'));
  const y = parseFloat(yStr.replace(',', '.'));

  if (isNaN(x) || isNaN(y)) {
    rejectionTracker.track(REJECTION_REASONS.COORDENADAS_FORMATO_INVALIDO);
    importLogger.warn({
      fila: rowIndex,
      razon: REJECTION_REASONS.COORDENADAS_FORMATO_INVALIDO,
      datosOriginales: { coordenadaX: xStr, coordenadaY: yStr }
    }, 'Coordenadas con formato no numerico - se asigna null');
    return null;
  }

  // Validar rangos para coordenadas UTM de España
  if (x < VALIDATION_LIMITS.UTM_X_MIN || x > VALIDATION_LIMITS.UTM_X_MAX ||
      y < VALIDATION_LIMITS.UTM_Y_MIN || y > VALIDATION_LIMITS.UTM_Y_MAX) {
    rejectionTracker.track(REJECTION_REASONS.COORDENADAS_FUERA_RANGO_UTM);
    importLogger.warn({
      fila: rowIndex,
      razon: REJECTION_REASONS.COORDENADAS_FUERA_RANGO_UTM,
      datosOriginales: { x, y },
      limitesValidos: {
        x: { min: VALIDATION_LIMITS.UTM_X_MIN, max: VALIDATION_LIMITS.UTM_X_MAX },
        y: { min: VALIDATION_LIMITS.UTM_Y_MIN, max: VALIDATION_LIMITS.UTM_Y_MAX }
      }
    }, 'Coordenadas fuera de rango UTM - se asigna null');
    return null;
  }

  return { x, y };
}

/**
 * Parsear fecha del formato DD/MM/YYYY
 * @param {string} fechaStr - Fecha en formato string
 * @param {number} rowIndex - Índice de fila para logging
 * @returns {Date} - Objeto Date
 * @throws {Error} - Si la fecha es inválida
 */
function parseDate(fechaStr, rowIndex) {
  if (!fechaStr || fechaStr.trim() === '') {
    rejectionTracker.track(REJECTION_REASONS.FECHA_FALTANTE);
    importLogger.warn({
      fila: rowIndex,
      razon: REJECTION_REASONS.FECHA_FALTANTE,
      datosOriginales: { fecha: fechaStr }
    }, 'Fila rechazada: fecha vacia');
    throw new Error(REJECTION_REASONS.FECHA_FALTANTE);
  }

  const parts = fechaStr.trim().split('/');
  if (parts.length !== 3) {
    rejectionTracker.track(REJECTION_REASONS.FECHA_FORMATO_INVALIDO);
    importLogger.warn({
      fila: rowIndex,
      razon: REJECTION_REASONS.FECHA_FORMATO_INVALIDO,
      datosOriginales: { fecha: fechaStr, formatoEsperado: 'DD/MM/YYYY' }
    }, 'Fila rechazada: formato de fecha invalido');
    throw new Error(REJECTION_REASONS.FECHA_FORMATO_INVALIDO);
  }

  const [day, month, year] = parts.map(p => parseInt(p));

  if (isNaN(day) || isNaN(month) || isNaN(year)) {
    rejectionTracker.track(REJECTION_REASONS.FECHA_COMPONENTES_INVALIDOS);
    importLogger.warn({
      fila: rowIndex,
      razon: REJECTION_REASONS.FECHA_COMPONENTES_INVALIDOS,
      datosOriginales: { fecha: fechaStr, dia: day, mes: month, año: year }
    }, 'Fila rechazada: componentes de fecha no numericos');
    throw new Error(REJECTION_REASONS.FECHA_COMPONENTES_INVALIDOS);
  }

  if (day < VALIDATION_LIMITS.DAY_MIN || day > VALIDATION_LIMITS.DAY_MAX ||
      month < VALIDATION_LIMITS.MONTH_MIN || month > VALIDATION_LIMITS.MONTH_MAX ||
      year < VALIDATION_LIMITS.YEAR_MIN || year > VALIDATION_LIMITS.YEAR_MAX) {
    rejectionTracker.track(REJECTION_REASONS.FECHA_FUERA_RANGO);
    importLogger.warn({
      fila: rowIndex,
      razon: REJECTION_REASONS.FECHA_FUERA_RANGO,
      datosOriginales: { fecha: fechaStr, dia: day, mes: month, año: year }
    }, 'Fila rechazada: fecha fuera de rango');
    throw new Error(REJECTION_REASONS.FECHA_FUERA_RANGO);
  }

  const date = new Date(year, month - 1, day);

  if (isNaN(date.getTime())) {
    importLogger.warn({
      fila: rowIndex,
      razon: REJECTION_REASONS.FECHA_FORMATO_INVALIDO,
      datosOriginales: { fecha: fechaStr }
    }, 'Fila rechazada: fecha invalida');
    throw new Error(REJECTION_REASONS.FECHA_FORMATO_INVALIDO);
  }

  return date;
}

// ============================================================================
// VALIDACIÓN Y TRANSFORMACIÓN
// ============================================================================

/**
 * Validar y transformar una fila de datos de accidente
 * @param {Object} row - Fila del CSV
 * @param {number} rowIndex - Índice de fila
 * @returns {Object} - Datos transformados para insertar
 * @throws {Error} - Si los datos son inválidos
 */
function validateAndTransformRow(row, rowIndex) {
  // Campos por índice del CSV:
  // 0: num_expediente, 1: fecha, 2: hora, 3: localizacion, 4: numero
  // 5: cod_distrito, 6: distrito, 7: tipo_accidente, 8: estado_meteorológico, 9: tipo_vehiculo
  // 10: tipo_persona, 11: rango_edad, 12: sexo, 13: cod_lesividad, 14: lesividad
  // 15: coordenada_x_utm, 16: coordenada_y_utm, 17: positiva_alcohol, 18: positiva_droga

  const numeroExpediente = row['0']?.toString().trim();
  if (!numeroExpediente) {
    rejectionTracker.track(REJECTION_REASONS.NUMERO_EXPEDIENTE_FALTANTE);
    importLogger.warn({
      fila: rowIndex,
      razon: REJECTION_REASONS.NUMERO_EXPEDIENTE_FALTANTE,
      datosOriginales: { numeroExpediente: row['0'] }
    }, 'Fila rechazada: numero de expediente faltante');
    throw new Error(REJECTION_REASONS.NUMERO_EXPEDIENTE_FALTANTE);
  }

  if (!/^\d{4}S\d{6}$/.test(numeroExpediente)) {
    rejectionTracker.track(REJECTION_REASONS.NUMERO_EXPEDIENTE_FORMATO_INVALIDO);
    importLogger.warn({
      fila: rowIndex,
      razon: REJECTION_REASONS.NUMERO_EXPEDIENTE_FORMATO_INVALIDO,
      datosOriginales: { numeroExpediente, formatoEsperado: 'YYYYSNNNNNN' }
    }, 'Fila rechazada: formato de expediente invalido');
    throw new Error(REJECTION_REASONS.NUMERO_EXPEDIENTE_FORMATO_INVALIDO);
  }

  // Parsear fecha
  const fechaStr = row['1']?.toString().trim();
  const fecha = parseDate(fechaStr, rowIndex);

  // Parsear hora
  const hora = row['2']?.toString().trim();
  if (!hora || !/^\d{1,2}:\d{2}:\d{2}$/.test(hora)) {
    rejectionTracker.track(REJECTION_REASONS.HORA_FORMATO_INVALIDO);
    importLogger.warn({
      fila: rowIndex,
      razon: REJECTION_REASONS.HORA_FORMATO_INVALIDO,
      datosOriginales: { hora, formatoEsperado: 'HH:MM:SS' }
    }, 'Fila rechazada: formato de hora invalido');
    throw new Error(REJECTION_REASONS.HORA_FORMATO_INVALIDO);
  }

  // Datos de ubicación
  const calle = row['3']?.toString().trim();
  if (!calle) {
    rejectionTracker.track(REJECTION_REASONS.LOCALIZACION_FALTANTE);
    importLogger.warn({
      fila: rowIndex,
      razon: REJECTION_REASONS.LOCALIZACION_FALTANTE,
      datosOriginales: { localizacion: row['3'] }
    }, 'Fila rechazada: localizacion faltante');
    throw new Error(REJECTION_REASONS.LOCALIZACION_FALTANTE);
  }

  const numero = row['4']?.toString().trim() || null;
  const codigoDistrito = row['5']?.toString().trim();
  const nombreDistrito = row['6']?.toString().trim().toUpperCase();

  if (!codigoDistrito || !nombreDistrito) {
    rejectionTracker.track(REJECTION_REASONS.DISTRITO_INCOMPLETO);
    importLogger.warn({
      fila: rowIndex,
      razon: REJECTION_REASONS.DISTRITO_INCOMPLETO,
      datosOriginales: { codigoDistrito, nombreDistrito }
    }, 'Fila rechazada: datos de distrito incompletos');
    throw new Error(REJECTION_REASONS.DISTRITO_INCOMPLETO);
  }

  // Parsear coordenadas (no críticas, pueden ser null)
  const coordenadas = parseCoordinates(row['15'], row['16'], rowIndex);

  // Datos del accidente
  const tipoAccidenteOriginal = row['7']?.toString().trim();
  const tipoAccidente = normalizeAccidentType(tipoAccidenteOriginal);
  const estadoMeteorologico = normalizeWeatherState(row['8']?.toString().trim());

  // Datos del vehículo
  const tipoVehiculoOriginal = row['9']?.toString().trim();
  const tipoVehiculo = normalizeVehicleType(tipoVehiculoOriginal);

  // Datos de la persona afectada
  const tipoPersona = normalizePersonType(row['10']?.toString().trim());
  const rangoEdadRaw = row['11']?.toString().trim();
  const rangoEdad = normalizeAgeRange(rangoEdadRaw);
  const sexoRaw = row['12']?.toString().trim().toUpperCase();
  const sexo = (sexoRaw === 'MUJER') ? GENDERS.MUJER :
    (sexoRaw === 'HOMBRE') ? GENDERS.HOMBRE : GENDERS.DESCONOCIDO;

  // Datos de lesividad
  const codigoLesividad = row['13']?.toString().trim();
  const lesividad = row['14']?.toString().trim();

  // Mapear tipo de lesion basado en codigo o descripcion (usando constantes centralizadas)
  let tipoLesion = INJURY_TYPES.SE_DESCONOCE;
  if (codigoLesividad && codigoLesividad !== 'NULL') {
    const codigoMap = {
      '01': INJURY_TYPES.ASISTENCIA_SANITARIA_AMBULATORIA_CON_POSTERIORIDAD,
      '02': INJURY_TYPES.ASISTENCIA_SANITARIA_INMEDIATA_EN_CENTRO_DE_SALUD_O_MUTUA,
      '05': INJURY_TYPES.ATENCIÓN_EN_URGENCIAS_SIN_POSTERIOR_INGRESO,
      '06': INJURY_TYPES.INGRESO_INFERIOR_O_IGUAL_A_24_HORAS,
      '07': INJURY_TYPES.ASISTENCIA_SANITARIA_SÓLO_EN_EL_LUGAR_DEL_ACCIDENTE,
      '03': INJURY_TYPES.INGRESO_SUPERIOR_A_24_HORAS,
      '04': INJURY_TYPES.FALLECIDO_24_HORAS,
      '14': INJURY_TYPES.SIN_ASISTENCIA_SANITARIA,
      '77': INJURY_TYPES.SE_DESCONOCE
    };
    tipoLesion = codigoMap[codigoLesividad] || INJURY_TYPES.SE_DESCONOCE;
  } else if (lesividad && lesividad !== 'NULL') {
    if (lesividad.toLowerCase().includes('fallec')) {
      tipoLesion = INJURY_TYPES.FALLECIDO_24_HORAS;
    } else if (lesividad.toLowerCase().includes('grave') || lesividad.toLowerCase().includes('ingreso')) {
      tipoLesion = INJURY_TYPES.INGRESO_SUPERIOR_A_24_HORAS;
    } else if (lesividad.toLowerCase().includes('leve') || lesividad.toLowerCase().includes('ambulat')) {
      tipoLesion = INJURY_TYPES.ASISTENCIA_SANITARIA_AMBULATORIA_CON_POSTERIORIDAD;
    }
  }

  // Datos de sustancias
  const alcoholRaw = row['17']?.toString().trim().toUpperCase();
  const positivaAlcohol = (alcoholRaw === 'S') ? BINARY_INDICATORS.YES :
    (alcoholRaw === 'N') ? BINARY_INDICATORS.NO : BINARY_INDICATORS.NULL;

  const drogaRaw = row['18']?.toString().trim().toUpperCase();
  const positivaDroga = (drogaRaw === 'S' || drogaRaw === '1') ? BINARY_INDICATORS.YES :
    (drogaRaw === 'N' || drogaRaw === '0') ? BINARY_INDICATORS.NO : BINARY_INDICATORS.NULL;

  // Construir objeto de accidente
  return {
    numeroExpediente,
    fecha,
    hora,

    ubicacion: {
      calle,
      numero,
      codigoDistrito,
      nombreDistrito,
      coordenadas
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
}

// ============================================================================
// PROCESAMIENTO
// ============================================================================

/**
 * Procesar un lote de datos de accidentes
 * @param {Array} batch - Lote de datos de accidentes
 * @returns {Promise<Object>} - Resultados del procesamiento
 */
async function processBatch(batch) {
  if (batch.length === 0) {
    return { nuevos: 0, actualizados: 0, errores: 0 };
  }

  try {
    const bulkOps = batch.map(accidentData => ({
      updateOne: {
        filter: { numeroExpediente: accidentData.numeroExpediente },
        update: { $set: accidentData },
        upsert: true
      }
    }));

    const result = await Accident.bulkWrite(bulkOps, { ordered: false });

    const nuevos = result.upsertedCount || 0;
    const actualizados = result.modifiedCount || 0;

    totalInserted += nuevos;
    totalUpdated += actualizados;

    if (nuevos > 0 || actualizados > 0) {
      importLogger.debug({
        lote: { nuevos, actualizados, total: batch.length }
      }, 'Lote procesado correctamente');
    }

    return { nuevos, actualizados, errores: 0 };

  } catch (error) {
    // Si el bulkWrite falla completamente, intentar procesar documentos individuales
    importLogger.warn({
      error: error.message,
      loteSize: batch.length
    }, 'Error en bulkWrite, procesando documentos individualmente');

    let nuevos = 0;
    let actualizados = 0;
    let errores = 0;

    // Procesar cada documento individualmente
    for (const accidentData of batch) {
      try {
        const result = await Accident.updateOne(
          { numeroExpediente: accidentData.numeroExpediente },
          { $set: accidentData },
          { upsert: true }
        );

        if (result.upsertedCount > 0) {
          nuevos++;
          totalInserted++;
        } else if (result.modifiedCount > 0) {
          actualizados++;
          totalUpdated++;
        }
      } catch (individualError) {
        errores++;
        totalErrors++;
        
        // Solo loguear los primeros 5 errores para no saturar los logs
        if (errores <= 5) {
          importLogger.error({
            numeroExpediente: accidentData.numeroExpediente,
            error: individualError.message
          }, 'Error insertando accidente individual');
        }
      }
    }

    if (errores > 5) {
      importLogger.warn({
        erroresAdicionales: errores - 5
      }, 'Errores adicionales omitidos en logs');
    }

    return { nuevos, actualizados, errores };
  }
}

/**
 * Procesar el archivo CSV de accidentes
 * @returns {Promise<Object>} - Estadísticas de procesamiento
 */
async function processAccidentFile() {
  return new Promise((resolve, reject) => {
    const batch = [];
    let rowCount = 0;
    let processedCount = 0;
    let errorCount = 0;

    importLogger.info({
      archivo: path.basename(DATA_FILE),
      batchSize: BATCH_SIZE
    }, 'Iniciando procesamiento de archivo de accidentes');

    const stream = createReadStream(DATA_FILE, { encoding: 'utf8' })
      .pipe(csv({
        separator: ';',
        skipEmptyLines: true,
        headers: false,
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

        // Saltar la primera fila (header)
        if (rowCount === 1) {
          return;
        }

        try {
          const accidentData = validateAndTransformRow(row, rowCount);
          batch.push(accidentData);
          processedCount++;

          // Procesar lote cuando alcance el tamaño configurado
          if (batch.length >= BATCH_SIZE) {
            stream.pause();
            processBatch(batch.splice(0))
              .then(() => {
                if (!isShuttingDown) {
                  stream.resume();
                }
              })
              .catch((error) => {
                importLogger.error({ error: error.message }, 'Error en lote');
                if (!isShuttingDown) {
                  stream.resume();
                }
              });
          }

          // Mostrar progreso
          if (processedCount % LOG_INTERVAL === 0) {
            importLogger.info({
              procesadas: processedCount.toLocaleString(),
              errores: errorCount,
              insertadas: totalInserted,
              actualizadas: totalUpdated
            }, 'Progreso de importacion');
          }

        } catch (_error) {
          errorCount++;
          totalRejected++;
          // El error ya fue loggeado en validateAndTransformRow o parseDate
        }
      })
      .on('end', async () => {
        try {
          // Procesar lote final
          if (batch.length > 0 && !isShuttingDown) {
            await processBatch(batch);
          }

          importLogger.info({
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
        importLogger.error({ error: error.message }, 'Error leyendo archivo CSV');
        reject(new Error(`Error leyendo archivo: ${error.message}`));
      });
  });
}

/**
 * Verificar que el archivo de datos existe
 * @returns {Promise<boolean>}
 */
async function checkDataFile() {
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
function showSummary(startTime) {
  const endTime = Date.now();
  const durationMs = endTime - startTime;

  importLogger.info({
    resumen: {
      duracion: formatDuration(durationMs),
      velocidad: calculateProcessingSpeed(totalProcessed, durationMs),
      registrosProcesados: totalProcessed.toLocaleString(),
      registrosInsertados: totalInserted.toLocaleString(),
      registrosActualizados: totalUpdated.toLocaleString(),
      registrosRechazados: totalRejected.toLocaleString(),
      errores: totalErrors.toLocaleString(),
      tasaExito: totalProcessed > 0 ?
        `${((totalInserted + totalUpdated) / totalProcessed * 100).toFixed(2)}%` : '0%'
    }
  }, 'Importacion de accidentes completada');

  // Resumen de rechazos por tipo
  const rejectionSummary = rejectionTracker.getSortedSummary();
  if (rejectionSummary.length > 0) {
    importLogger.info({
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

  importLogger.info('Iniciando importacion de datos de accidentalidad');

  try {
    // Verificar archivo de datos
    await checkDataFile();
    importLogger.info({ archivo: DATA_FILE }, 'Archivo de datos verificado');

    // Conectar a MongoDB
    importLogger.info('Conectando a MongoDB...');
    await connectDB(config.database.uri);
    importLogger.info('Conexion a MongoDB establecida');

    // Verificar modelo
    const countAntes = await Accident.countDocuments().maxTimeMS(10000);
    importLogger.info({
      registrosExistentes: countAntes.toLocaleString()
    }, 'Modelo de accidentes verificado');

    // Procesar archivo
    await processAccidentFile();

    // Mostrar resumen
    showSummary(startTime);

    // Contar registros finales
    const countDespues = await Accident.countDocuments().maxTimeMS(10000);
    importLogger.info({
      registrosFinales: countDespues.toLocaleString(),
      incremento: (countDespues - countAntes).toLocaleString()
    }, 'Estadisticas finales de la base de datos');

  } catch (error) {
    importLogger.error({
      error: error.message,
      stack: error.stack
    }, 'Error critico durante la importacion');
    process.exit(1);

  } finally {
    // Cerrar conexión
    if (mongoose.connection.readyState === 1) {
      try {
        await mongoose.connection.close();
        importLogger.info('Conexion a MongoDB cerrada');
      } catch (error) {
        importLogger.error({ error: error.message }, 'Error cerrando conexion');
      }
    }
  }

  importLogger.info('Script completado');
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
async function handleShutdown(signal) {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;

  importLogger.warn({ signal }, 'Senal de terminacion recibida, cerrando...');

  if (mongoose.connection.readyState === 1) {
    try {
      await mongoose.connection.close();
      importLogger.info('Conexion cerrada por senal de terminacion');
    } catch (error) {
      importLogger.error({ error: error.message }, 'Error cerrando conexion');
    }
  }

  process.exit(0);
}

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));

process.on('uncaughtException', (error) => {
  importLogger.fatal({ error: error.message, stack: error.stack }, 'Error no capturado');
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  importLogger.fatal({ reason, promise }, 'Promesa rechazada no manejada');
  process.exit(1);
});

// ============================================================================
// EJECUCIÓN
// ============================================================================

if (require.main === module) {
  main().catch(error => {
    importLogger.fatal({ error: error.message }, 'Error fatal ejecutando script');
    process.exit(1);
  });
}

module.exports = {
  main,
  processAccidentFile,
  validateAndTransformRow,
  REJECTION_REASONS
};
