/**
 * Helper de derivacion de mediciones de trafico para la ingesta IoT.
 *
 * Replica EXACTAMENTE las reglas de derivacion del importador CSV
 * (scripts/importation/importarTrafico.js -> validateAndTransformRow): extrae
 * los componentes temporales en UTC y calcula los campos de analisis (calidad,
 * congestion, intensidad, periodo del dia, tipo de jornada) con los mismos
 * cortes, para que los datos generados por el simulador sean indistinguibles de
 * los importados y el rollup `traffic_daily` y el dashboard los interpreten igual.
 *
 * NOTA: el modelo Trafico tiene un hook pre('save') que deriva con getters
 * LOCALES y solo si los campos faltan; por eso la ingesta NO usa save() sino que
 * construye el documento completo aqui (UTC) y hace un upsert crudo.
 */

const {
  TRAFFIC_ERROR_CODES,
  TRAFFIC_ELEMENT_TYPES,
  DATA_QUALITY_LEVELS,
  CONGESTION_LEVELS,
  TRAFFIC_INTENSITY_LEVELS,
  DAY_PERIODS,
  WORKDAY_TYPES
} = require('../constants');

/** Convierte a numero finito o null. */
const aNumeroONull = (valor) => (valor == null || !Number.isFinite(Number(valor)) ? null : Number(valor));

/**
 * Deriva el documento de trafico completo a partir de una lectura del sensor.
 *
 * @param {Object} lectura - Lectura del sensor de trafico
 * @param {string} lectura.puntoMedidaId - Id numerico del punto de medida
 * @param {Date|string} lectura.fecha - Timestamp exacto de la medicion (15 min)
 * @param {string} lectura.tipoElemento - 'URB' o 'M30'
 * @param {number} lectura.intensidad - Vehiculos/hora (>=0)
 * @param {number} [lectura.ocupacion] - % ocupacion [0-100]
 * @param {number} [lectura.carga] - Indice de carga [0-100]
 * @param {number} [lectura.velocidadMedia] - km/h (solo M30)
 * @param {string} [lectura.error='N'] - Codigo de error ('N'|'E'|'S')
 * @param {number} [lectura.periodoIntegracion=5] - Sub-muestras integradas [0-5]
 * @returns {Object} Documento de trafico listo para persistir
 */
const derivarMedicionTrafico = (lectura) => {
  const puntoMedidaId = String(lectura.puntoMedidaId).trim();
  const fecha = lectura.fecha instanceof Date ? lectura.fecha : new Date(lectura.fecha);

  // Componentes en UTC (coinciden con el bucket original del CSV de trafico).
  const año = fecha.getUTCFullYear();
  const mes = fecha.getUTCMonth() + 1;
  const dia = fecha.getUTCDate();
  const hora = fecha.getUTCHours();
  const minutos = fecha.getUTCMinutes();

  const tipoElemento = String(lectura.tipoElemento).trim().toUpperCase();
  const intensidad = Number(lectura.intensidad);
  const ocupacion = aNumeroONull(lectura.ocupacion);
  const carga = aNumeroONull(lectura.carga);
  const velNumerica = aNumeroONull(lectura.velocidadMedia);
  // Solo los puntos M30 miden velocidad; en URB se persiste null.
  const velocidadMedia = tipoElemento === TRAFFIC_ELEMENT_TYPES.M30 ? velNumerica : null;

  // Sentinelas internos (-1 = sin dato) para reproducir EXACTO la logica del
  // importador, pero se PERSISTE null (el schema valida 0-100 o null, no -1).
  const ocuS = ocupacion == null ? -1 : ocupacion;
  const carS = carga == null ? -1 : carga;

  // Codigo de error y periodo de integracion.
  const errorEntrada = String(lectura.error || TRAFFIC_ERROR_CODES.NO_ERROR).trim().toUpperCase();
  const error = [TRAFFIC_ERROR_CODES.NO_ERROR, TRAFFIC_ERROR_CODES.ERROR, TRAFFIC_ERROR_CODES.SIN_DATOS].includes(errorEntrada)
    ? errorEntrada
    : TRAFFIC_ERROR_CODES.NO_ERROR;
  const periodoIntegracion = Number.isFinite(Number(lectura.periodoIntegracion)) ? Number(lectura.periodoIntegracion) : 5;

  // Calidad general (heuristica del importador).
  let calidadGeneral;
  if (error === TRAFFIC_ERROR_CODES.NO_ERROR && periodoIntegracion >= 3) {
    calidadGeneral = DATA_QUALITY_LEVELS.ALTA;
  } else if (error === TRAFFIC_ERROR_CODES.NO_ERROR) {
    calidadGeneral = DATA_QUALITY_LEVELS.MEDIA;
  } else if (error === TRAFFIC_ERROR_CODES.SIN_DATOS) {
    calidadGeneral = DATA_QUALITY_LEVELS.SIN_DATOS;
  } else {
    calidadGeneral = DATA_QUALITY_LEVELS.BAJA;
  }

  // Nivel de congestion (cortes 30/60/80 ocupacion, 40/70/90 carga).
  let nivelCongestion;
  if (ocuS < 0 || carS < 0) {
    nivelCongestion = CONGESTION_LEVELS.SIN_DATOS;
  } else if (ocuS >= 80 || carS >= 90) {
    nivelCongestion = CONGESTION_LEVELS.COLAPSADO;
  } else if (ocuS >= 60 || carS >= 70) {
    nivelCongestion = CONGESTION_LEVELS.CONGESTIONADO;
  } else if (ocuS >= 30 || carS >= 40) {
    nivelCongestion = CONGESTION_LEVELS.DENSO;
  } else {
    nivelCongestion = CONGESTION_LEVELS.FLUIDO;
  }

  // Clasificacion por intensidad bruta (veh/h).
  let clasificacionIntensidad;
  if (!Number.isFinite(intensidad) || intensidad < 0) {
    clasificacionIntensidad = TRAFFIC_INTENSITY_LEVELS.SIN_DATOS;
  } else if (intensidad >= 3000) {
    clasificacionIntensidad = TRAFFIC_INTENSITY_LEVELS.MUY_ALTA;
  } else if (intensidad >= 2000) {
    clasificacionIntensidad = TRAFFIC_INTENSITY_LEVELS.ALTA;
  } else if (intensidad >= 1000) {
    clasificacionIntensidad = TRAFFIC_INTENSITY_LEVELS.MEDIA;
  } else if (intensidad >= 300) {
    clasificacionIntensidad = TRAFFIC_INTENSITY_LEVELS.BAJA;
  } else {
    clasificacionIntensidad = TRAFFIC_INTENSITY_LEVELS.MUY_BAJA;
  }

  // Periodo del dia (periodizacion de movilidad urbana, distinta de Ruido).
  let periodoDia;
  if (hora >= 0 && hora < 7) { periodoDia = DAY_PERIODS.MADRUGADA; }
  else if (hora >= 7 && hora < 12) { periodoDia = DAY_PERIODS.MAÑANA; }
  else if (hora >= 12 && hora < 15) { periodoDia = DAY_PERIODS.MEDIODIA; }
  else if (hora >= 15 && hora < 21) { periodoDia = DAY_PERIODS.TARDE; }
  else { periodoDia = DAY_PERIODS.NOCHE; }

  // Tipo de jornada (dia de la semana en UTC).
  const diaSemana = fecha.getUTCDay();
  let tipoJornada;
  if (diaSemana === 0) { tipoJornada = WORKDAY_TYPES.DOMINGO_FESTIVO; }
  else if (diaSemana === 6) { tipoJornada = WORKDAY_TYPES.SABADO; }
  else { tipoJornada = WORKDAY_TYPES.LABORABLE; }

  return {
    puntoMedidaId,
    fecha,
    año,
    mes,
    dia,
    hora,
    minutos,
    tipoElemento,
    metricas: { intensidad, ocupacion, carga, velocidadMedia },
    calidadDatos: { error, periodoIntegracion, calidadGeneral },
    analisis: { nivelCongestion, clasificacionIntensidad, periodoDia, tipoJornada },
    procesamiento: { archivoOrigen: lectura.origen || 'simulador-iot', importadoEn: new Date() }
  };
};

module.exports = { derivarMedicionTrafico };
