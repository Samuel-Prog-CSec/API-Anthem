/**
 * Asignar distrito a estaciones acústicas por nearest-centroid.
 *
 * MOTIVACIÓN:
 *   El CSV de origen (EstacionesMedidaControlAcustico.csv) no incluye
 *   distrito; sólo dirección textual y coordenadas UTM ETRS89. Sin distrito,
 *   la correlación Ruido vs Censo agrupaba todo a "SIN_ASIGNAR" y mostraba
 *   "POBLACIÓN POTENCIAL EXPUESTA: 0" pese a tener 6 estaciones con
 *   incumplimiento del límite diurno.
 *
 * ALGORITMO:
 *   1. Calcular centroide UTM (cx, cy) de cada distrito agregando todos los
 *      accidents que sí tienen distrito + coordenadas.
 *   2. Para cada estación acústica con coordenadas, calcular distancia
 *      euclídea UTM (metros) a los 21 centroides.
 *   3. Asignar el distrito de centroide más cercano.
 *   4. Persistir como `distritoNombre` en la colección `locations`.
 *
 * USO:
 *   node scripts/asignar_distrito_estaciones_acusticas.js [--dry-run]
 *
 * SEGURIDAD:
 *   Solo modifica el campo `distritoNombre` de docs `tipo: estacion_acustica`.
 *   No toca medidas, ranking ni ningún otro dato.
 *   Idempotente: re-ejecutar es seguro (sobrescribe con el mismo valor).
 */

require('dotenv').config();
const mongoose = require('mongoose');
const scriptLogger = require('../src/config/scriptLogger');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');

async function ejecutar() {
  const uri = process.env.DATABASE_URI;
  if (!uri) {
    scriptLogger.error('Falta DATABASE_URI en .env');
    process.exit(1);
  }

  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  scriptLogger.info({ db: mongoose.connection.name, dryRun }, 'Conectado a MongoDB');

  // 1. Centroides de distritos desde accidents
  const centroides = await db.collection('accidents').aggregate([
    {
      $match: {
        'ubicacion.coordenadas.x': { $ne: null, $type: 'number' },
        'ubicacion.coordenadas.y': { $ne: null, $type: 'number' },
        'ubicacion.nombreDistrito': { $ne: null }
      }
    },
    {
      $group: {
        _id: '$ubicacion.nombreDistrito',
        cx: { $avg: '$ubicacion.coordenadas.x' },
        cy: { $avg: '$ubicacion.coordenadas.y' },
        n: { $sum: 1 }
      }
    }
  ]).toArray();

  if (centroides.length === 0) {
    scriptLogger.error('No se pudieron calcular centroides: 0 accidents con coords + distrito');
    process.exit(1);
  }
  scriptLogger.info({ totalDistritos: centroides.length }, 'Centroides calculados');

  // 2. Estaciones acústicas con coordenadas
  const estaciones = await db.collection('locations').find({
    tipo: 'estacion_acustica',
    'coordenadas.x': { $ne: null, $type: 'number' },
    'coordenadas.y': { $ne: null, $type: 'number' }
  }).project({ nmt: 1, nombre: 1, coordenadas: 1, distritoNombre: 1 }).toArray();

  scriptLogger.info({ totalEstaciones: estaciones.length }, 'Estaciones acústicas con coordenadas cargadas');

  if (estaciones.length === 0) {
    scriptLogger.warn('No hay estaciones acústicas con coordenadas. Nada que asignar.');
    await mongoose.disconnect();
    return;
  }

  // 3. Asignar nearest centroid
  const asignaciones = estaciones.map(e => {
    let mejorDistancia = Infinity;
    let mejorDistrito = null;
    for (const c of centroides) {
      const dx = e.coordenadas.x - c.cx;
      const dy = e.coordenadas.y - c.cy;
      const distancia = Math.sqrt(dx * dx + dy * dy); // metros (UTM)
      if (distancia < mejorDistancia) {
        mejorDistancia = distancia;
        mejorDistrito = c._id;
      }
    }
    return {
      _id: e._id,
      nmt: e.nmt,
      nombre: e.nombre,
      distritoAnterior: e.distritoNombre,
      distritoAsignado: mejorDistrito,
      distanciaMetros: Math.round(mejorDistancia)
    };
  });

  // Resumen
  const porDistrito = new Map();
  asignaciones.forEach(a => {
    porDistrito.set(a.distritoAsignado, (porDistrito.get(a.distritoAsignado) || 0) + 1);
  });
  scriptLogger.info({ distribucion: Object.fromEntries(porDistrito) }, 'Distribución de asignaciones');

  // Detalle por estacion
  asignaciones.forEach(a => {
    scriptLogger.info({
      nmt: a.nmt,
      nombre: a.nombre,
      distrito: a.distritoAsignado,
      distanciaM: a.distanciaMetros,
      cambio: a.distritoAnterior !== a.distritoAsignado ? `${a.distritoAnterior || 'NULL'} -> ${a.distritoAsignado}` : 'sin cambio'
    }, 'Estación asignada');
  });

  // 4. Persistir (a no ser que sea dry-run)
  if (dryRun) {
    scriptLogger.info({ totalAsignaciones: asignaciones.length }, 'DRY RUN — no se persiste');
    await mongoose.disconnect();
    return;
  }

  const ops = asignaciones.map(a => ({
    updateOne: {
      filter: { _id: a._id },
      update: { $set: { distritoNombre: a.distritoAsignado } }
    }
  }));

  const result = await db.collection('locations').bulkWrite(ops);
  scriptLogger.info({
    matched: result.matchedCount,
    modified: result.modifiedCount,
    total: asignaciones.length
  }, 'Asignaciones persistidas');

  await mongoose.disconnect();
}

ejecutar().catch(err => {
  scriptLogger.error({ error: err.message, stack: err.stack }, 'Fallo crítico');
  process.exit(1);
});
