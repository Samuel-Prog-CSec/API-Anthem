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
const { createReadStream } = require('fs');
const fs = require('fs').promises;
const mongoose = require('mongoose');

// Importar modelos, configuración y utilidades
const Accidente = require('../../src/models/Accidente');
const { connectDB } = require('../../src/config/database');
const config = require('../../src/config/config');
const { importAccidentsLogger: logger } = require('../../src/config/scriptLogger');
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
  MAPEO_SEVERIDAD_LESIONES,
  SEVERITY_LEVELS
} = require('../../src/constants');
const {
  RejectionTracker,
  formatDuration,
  calculateProcessingSpeed
} = require('./helpers/importHelpers');


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
 * Normalizar estado meteorológico
 * @param {string} estado - Estado meteorológico original del CSV
 * @returns {string} - Estado normalizado
 */
function normalizarEstadoMeteorologico(estado) {
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
function parsearCoordenadas(xStr, yStr, rowIndex) {
  if (!xStr || !yStr || xStr.trim() === '' || yStr.trim() === '') {
    return null;
  }

  // Reemplazar comas por puntos para decimales
  const x = parseFloat(xStr.replace(',', '.'));
  const y = parseFloat(yStr.replace(',', '.'));

  if (isNaN(x) || isNaN(y)) {
    rejectionTracker.track(REJECTION_REASONS.COORDENADAS_FORMATO_INVALIDO);
    logger.warn({
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
    logger.warn({
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
function parsearFecha(fechaStr, rowIndex) {
  if (!fechaStr || fechaStr.trim() === '') {
    rejectionTracker.track(REJECTION_REASONS.FECHA_FALTANTE);
    logger.warn({
      fila: rowIndex,
      razon: REJECTION_REASONS.FECHA_FALTANTE,
      datosOriginales: { fecha: fechaStr }
    }, 'Fila rechazada: fecha vacia');
    throw new Error(REJECTION_REASONS.FECHA_FALTANTE);
  }

  const parts = fechaStr.trim().split('/');
  if (parts.length !== 3) {
    rejectionTracker.track(REJECTION_REASONS.FECHA_FORMATO_INVALIDO);
    logger.warn({
      fila: rowIndex,
      razon: REJECTION_REASONS.FECHA_FORMATO_INVALIDO,
      datosOriginales: { fecha: fechaStr, formatoEsperado: 'DD/MM/YYYY' }
    }, 'Fila rechazada: formato de fecha invalido');
    throw new Error(REJECTION_REASONS.FECHA_FORMATO_INVALIDO);
  }

  const [day, month, year] = parts.map(p => parseInt(p));

  if (isNaN(day) || isNaN(month) || isNaN(year)) {
    rejectionTracker.track(REJECTION_REASONS.FECHA_COMPONENTES_INVALIDOS);
    logger.warn({
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
    logger.warn({
      fila: rowIndex,
      razon: REJECTION_REASONS.FECHA_FUERA_RANGO,
      datosOriginales: { fecha: fechaStr, dia: day, mes: month, año: year }
    }, 'Fila rechazada: fecha fuera de rango');
    throw new Error(REJECTION_REASONS.FECHA_FUERA_RANGO);
  }

  const date = new Date(year, month - 1, day);

  if (isNaN(date.getTime())) {
    logger.warn({
      fila: rowIndex,
      razon: REJECTION_REASONS.FECHA_FORMATO_INVALIDO,
      datosOriginales: { fecha: fechaStr }
    }, 'Fila rechazada: fecha invalida');
    throw new Error(REJECTION_REASONS.FECHA_FORMATO_INVALIDO);
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

  // Campos temporales basicos
  const año = fecha.getFullYear();
  const mes = fecha.getMonth() + 1;
  const dia = fecha.getDate();
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

  // Dia de la semana y tipo de jornada
  const diaSemana = fecha.getDay();
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
  const weather = circunstancias.estadoMeteorologico;
  if (weather !== WEATHER_CONDITIONS.DESPEJADO &&
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

  const numExpedienteRaw = row['num_expediente'] || row['\uFEFFnum_expediente'];
  const numeroExpediente = numExpedienteRaw?.toString().trim();
  if (!numeroExpediente) {
    rejectionTracker.track(REJECTION_REASONS.NUMERO_EXPEDIENTE_FALTANTE);
    logger.warn({
      fila: rowIndex,
      razon: REJECTION_REASONS.NUMERO_EXPEDIENTE_FALTANTE,
      datosOriginales: { numeroExpediente: numExpedienteRaw }
    }, 'Fila rechazada: numero de expediente faltante');
    throw new Error(REJECTION_REASONS.NUMERO_EXPEDIENTE_FALTANTE);
  }

  if (!/^\d{4}S\d{6}$/.test(numeroExpediente)) {
    rejectionTracker.track(REJECTION_REASONS.NUMERO_EXPEDIENTE_FORMATO_INVALIDO);
    logger.warn({
      fila: rowIndex,
      razon: REJECTION_REASONS.NUMERO_EXPEDIENTE_FORMATO_INVALIDO,
      datosOriginales: { numeroExpediente, formatoEsperado: 'YYYYSNNNNNN' }
    }, 'Fila rechazada: formato de expediente invalido');
    throw new Error(REJECTION_REASONS.NUMERO_EXPEDIENTE_FORMATO_INVALIDO);
  }

  // Parsear fecha
  const fechaStr = row['fecha']?.toString().trim();
  const fecha = parsearFecha(fechaStr, rowIndex);

  // Parsear hora (CSV tiene formato H:MM:SS o HH:MM:SS, modelo espera HH:MM)
  const horaRaw = row['hora']?.toString().trim();
  if (!horaRaw || !/^\d{1,2}:\d{2}(:\d{2})?$/.test(horaRaw)) {
    rejectionTracker.track(REJECTION_REASONS.HORA_FORMATO_INVALIDO);
    logger.warn({
      fila: rowIndex,
      razon: REJECTION_REASONS.HORA_FORMATO_INVALIDO,
      datosOriginales: { hora: horaRaw, formatoEsperado: 'H:MM:SS o HH:MM:SS' }
    }, 'Fila rechazada: formato de hora invalido');
    throw new Error(REJECTION_REASONS.HORA_FORMATO_INVALIDO);
  }
  // Convertir a formato HH:MM (sin segundos, con padding)
  const partes = horaRaw.split(':');
  const hora = partes[0].padStart(2, '0') + ':' + partes[1];

  // Datos de ubicacion
  const calle = row['localizacion']?.toString().trim();
  if (!calle) {
    rejectionTracker.track(REJECTION_REASONS.LOCALIZACION_FALTANTE);
    logger.warn({
      fila: rowIndex,
      razon: REJECTION_REASONS.LOCALIZACION_FALTANTE,
      datosOriginales: { localizacion: row['localizacion'] }
    }, 'Fila rechazada: localizacion faltante');
    throw new Error(REJECTION_REASONS.LOCALIZACION_FALTANTE);
  }

  const numero = row['numero']?.toString().trim() || null;
  const codigoDistrito = row['cod_distrito']?.toString().trim();
  const nombreDistrito = row['distrito']?.toString().trim().toUpperCase();

  if (!codigoDistrito || !nombreDistrito) {
    rejectionTracker.track(REJECTION_REASONS.DISTRITO_INCOMPLETO);
    logger.warn({
      fila: rowIndex,
      razon: REJECTION_REASONS.DISTRITO_INCOMPLETO,
      datosOriginales: { codigoDistrito, nombreDistrito }
    }, 'Fila rechazada: datos de distrito incompletos');
    throw new Error(REJECTION_REASONS.DISTRITO_INCOMPLETO);
  }

  // Parsear coordenadas (no criticas, pueden ser null)
  const coordenadas = parsearCoordenadas(row['coordenada_x_utm'], row['coordenada_y_utm'], rowIndex);

  // Datos del accidente
  const tipoAccidenteOriginal = row['tipo_accidente']?.toString().trim();
  const tipoAccidente = normalizarTipoAccidente(tipoAccidenteOriginal);
  const estadoMeteorologico = normalizarEstadoMeteorologico(row['estado_meteorol\u00f3gico']?.toString().trim());

  // Datos del vehiculo
  const tipoVehiculoOriginal = row['tipo_vehiculo']?.toString().trim();
  const tipoVehiculo = normalizarTipoVehiculo(tipoVehiculoOriginal);

  // Datos de la persona afectada
  const tipoPersona = normalizarTipoPersona(row['tipo_persona']?.toString().trim());
  const rangoEdadRaw = row['rango_edad']?.toString().trim();
  const rangoEdad = normalizarRangoEdad(rangoEdadRaw);
  const sexoRaw = row['sexo']?.toString().trim().toUpperCase();
  const sexo = (sexoRaw === 'MUJER') ? GENDERS.MUJER :
    (sexoRaw === 'HOMBRE') ? GENDERS.HOMBRE : GENDERS.DESCONOCIDO;

  // Datos de lesividad
  const codigoLesividad = row['cod_lesividad']?.toString().trim();
  const lesividad = row['lesividad']?.toString().trim();

  // Mapear tipo de lesion basado en codigo o descripcion (usando constantes centralizadas)
  let tipoLesion = TIPOS_LESION.SE_DESCONOCE;
  if (codigoLesividad && codigoLesividad !== 'NULL') {
    // Mapeo segun dataset_information.md (seccion Lesividad, lineas 115-124)
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
  } else if (lesividad && lesividad !== 'NULL') {
    if (lesividad.toLowerCase().includes('fallec')) {
      tipoLesion = TIPOS_LESION.FALLECIDO_24_HORAS;
    } else if (lesividad.toLowerCase().includes('grave') || lesividad.toLowerCase().includes('ingreso')) {
      tipoLesion = TIPOS_LESION.INGRESO_SUPERIOR_A_24_HORAS;
    } else if (lesividad.toLowerCase().includes('leve') || lesividad.toLowerCase().includes('ambulat')) {
      tipoLesion = TIPOS_LESION.ASISTENCIA_SANITARIA_AMBULATORIA_CON_POSTERIORIDAD;
    }
  }

  // Datos de sustancias
  const alcoholRaw = row['positiva_alcohol']?.toString().trim().toUpperCase();
  const positivaAlcohol = (alcoholRaw === 'S') ? BINARY_INDICATORS.YES :
    (alcoholRaw === 'N') ? BINARY_INDICATORS.NO : BINARY_INDICATORS.NULL;

  const drogaRaw = row['positiva_droga']?.toString().trim().toUpperCase();
  const positivaDroga = (drogaRaw === 'S' || drogaRaw === '1') ? BINARY_INDICATORS.YES :
    (drogaRaw === 'N' || drogaRaw === '0') ? BINARY_INDICATORS.NO : BINARY_INDICATORS.NULL;

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

    const result = await Accidente.bulkWrite(bulkOps, { ordered: false });

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

    const stream = createReadStream(DATA_FILE, { encoding: 'utf8' })
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
  logger.fatal({ error: error.message, stack: error.stack }, 'Error no capturado');
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
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
