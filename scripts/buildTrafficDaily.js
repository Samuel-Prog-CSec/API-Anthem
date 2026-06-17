/**
 * Construccion del rollup diario de trafico (`traffic_daily`).
 *
 * MOTIVACION: `traffic_measurements` tiene ~131M documentos (mediciones cada
 * ~15 min por punto). Agregar millones de docs crudos en cada peticion de
 * /trafico/estadisticas|historico|analisis-congestion|mapa hacia que rangos de
 * mas de unos pocos dias superaran el maxTimeMS (500/timeout). Como el dataset
 * de 2051 es ESTATICO, pre-agregamos una vez a nivel (puntoMedidaId, dia) y las
 * consultas leen de ~1.5M docs en vez de 131M (-98% de docs escaneados).
 *
 * El rollup guarda SUMAS y CONTEOS (no promedios) para poder re-agregar de forma
 * EXACTA por cualquier rango/dimension (promediar promedios seria incorrecto).
 * Incluye `porPeriodo` para reconstruir el desglose por franja del dia
 * (analisis.periodoDia) que consume el frontend.
 *
 * Uso:  node scripts/buildTrafficDaily.js
 * Re-ejecutar tras cada reimport de trafico. Idempotente (usa $out, reemplaza
 * la coleccion entera de forma atomica).
 */

require('dotenv').config();
const mongoose = require('mongoose');
const {
  CONGESTION_LEVELS,
  DATA_QUALITY_LEVELS,
  TRAFFIC_ELEMENT_TYPES
} = require('../src/constants');

const COLECCION_ORIGEN = 'traffic_measurements';
const COLECCION_DESTINO = 'traffic_daily';

// Etapa 1: agrupar por (punto, dia, franja) para conservar el desglose por
// periodo del dia. Etapa 2: re-agrupar por (punto, dia) acumulando los periodos
// en un array `porPeriodo`. Asi un solo recorrido produce el rollup completo.
const pipeline = [
  {
    $group: {
      _id: { p: '$puntoMedidaId', y: '$año', m: '$mes', d: '$dia', per: '$analisis.periodoDia' },
      tipoElemento: { $first: '$tipoElemento' },
      total: { $sum: 1 },
      sumI: { $sum: { $cond: [{ $gte: ['$metricas.intensidad', 0] }, '$metricas.intensidad', 0] } },
      cntI: { $sum: { $cond: [{ $gte: ['$metricas.intensidad', 0] }, 1, 0] } },
      maxI: { $max: { $cond: [{ $gte: ['$metricas.intensidad', 0] }, '$metricas.intensidad', null] } },
      minI: { $min: { $cond: [{ $gte: ['$metricas.intensidad', 0] }, '$metricas.intensidad', null] } },
      sumO: { $sum: { $cond: [{ $gte: ['$metricas.ocupacion', 0] }, '$metricas.ocupacion', 0] } },
      cntO: { $sum: { $cond: [{ $gte: ['$metricas.ocupacion', 0] }, 1, 0] } },
      sumC: { $sum: { $cond: [{ $gte: ['$metricas.carga', 0] }, '$metricas.carga', 0] } },
      cntC: { $sum: { $cond: [{ $gte: ['$metricas.carga', 0] }, 1, 0] } },
      // Velocidad media: solo valida en M-30 con valor >= 0 (en URB el CSV trae 0 de relleno)
      sumVelM30: { $sum: { $cond: [{ $and: [{ $eq: ['$tipoElemento', TRAFFIC_ELEMENT_TYPES.M30] }, { $gte: ['$metricas.velocidadMedia', 0] }] }, '$metricas.velocidadMedia', 0] } },
      cntVelM30: { $sum: { $cond: [{ $and: [{ $eq: ['$tipoElemento', TRAFFIC_ELEMENT_TYPES.M30] }, { $gte: ['$metricas.velocidadMedia', 0] }] }, 1, 0] } },
      fluidas: { $sum: { $cond: [{ $eq: ['$analisis.nivelCongestion', CONGESTION_LEVELS.FLUIDO] }, 1, 0] } },
      densas: { $sum: { $cond: [{ $eq: ['$analisis.nivelCongestion', CONGESTION_LEVELS.DENSO] }, 1, 0] } },
      congestionadas: { $sum: { $cond: [{ $eq: ['$analisis.nivelCongestion', CONGESTION_LEVELS.CONGESTIONADO] }, 1, 0] } },
      colapsadas: { $sum: { $cond: [{ $eq: ['$analisis.nivelCongestion', CONGESTION_LEVELS.COLAPSADO] }, 1, 0] } },
      confiables: { $sum: { $cond: [{ $in: ['$calidadDatos.calidadGeneral', [DATA_QUALITY_LEVELS.ALTA, DATA_QUALITY_LEVELS.MEDIA]] }, 1, 0] } }
    }
  },
  {
    $group: {
      _id: { p: '$_id.p', y: '$_id.y', m: '$_id.m', d: '$_id.d' },
      tipoElemento: { $first: '$tipoElemento' },
      total: { $sum: '$total' },
      sumI: { $sum: '$sumI' }, cntI: { $sum: '$cntI' }, maxI: { $max: '$maxI' }, minI: { $min: '$minI' },
      sumO: { $sum: '$sumO' }, cntO: { $sum: '$cntO' }, sumC: { $sum: '$sumC' }, cntC: { $sum: '$cntC' },
      sumVelM30: { $sum: '$sumVelM30' }, cntVelM30: { $sum: '$cntVelM30' },
      fluidas: { $sum: '$fluidas' }, densas: { $sum: '$densas' },
      congestionadas: { $sum: '$congestionadas' }, colapsadas: { $sum: '$colapsadas' },
      confiables: { $sum: '$confiables' },
      porPeriodo: { $push: { periodo: '$_id.per', total: '$total', sumI: '$sumI', cntI: '$cntI', congestionadas: '$congestionadas', colapsadas: '$colapsadas' } }
    }
  },
  {
    $project: {
      _id: 0,
      puntoMedidaId: '$_id.p',
      año: '$_id.y', mes: '$_id.m', dia: '$_id.d',
      fecha: { $dateFromParts: { year: '$_id.y', month: '$_id.m', day: '$_id.d' } },
      tipoElemento: 1,
      total: 1, sumI: 1, cntI: 1, maxI: 1, minI: 1, sumO: 1, cntO: 1, sumC: 1, cntC: 1,
      sumVelM30: 1, cntVelM30: 1,
      fluidas: 1, densas: 1, congestionadas: 1, colapsadas: 1, confiables: 1,
      porPeriodo: 1
    }
  },
  { $out: COLECCION_DESTINO }
];

(async () => {
  const uri = process.env.DATABASE_URI;
  if (!uri) { throw new Error('DATABASE_URI no definida'); }
  await mongoose.connect(uri);
  const db = mongoose.connection.db;

  const origen = await db.collection(COLECCION_ORIGEN).estimatedDocumentCount();
  console.log(`[rollup] origen ${COLECCION_ORIGEN}: ~${origen} docs. Construyendo ${COLECCION_DESTINO}...`);

  const t0 = Date.now();
  await db.collection(COLECCION_ORIGEN).aggregate(pipeline, { allowDiskUse: true }).toArray();
  console.log(`[rollup] $out completado en ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  const daily = db.collection(COLECCION_DESTINO);
  await daily.createIndex({ fecha: 1 }, { name: 'idx_daily_fecha' });
  await daily.createIndex({ tipoElemento: 1, fecha: 1 }, { name: 'idx_daily_tipo_fecha' });
  await daily.createIndex({ puntoMedidaId: 1, fecha: 1 }, { name: 'idx_daily_punto_fecha' });

  const count = await daily.countDocuments();
  console.log(`[rollup] ${COLECCION_DESTINO} listo: ${count} docs, 3 indices creados. Total ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  await mongoose.disconnect();
  process.exit(0);
})().catch((e) => {
  console.error('[rollup] ERROR', e);
  process.exit(1);
});
