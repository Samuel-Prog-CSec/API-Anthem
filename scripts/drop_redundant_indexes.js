/**
 * Drop de indices single-field redundantes
 *
 * Elimina 44 indices identificados en docs/optimizations_2026-05-26.md.
 * Todos son single-field cubiertos por indices compuestos existentes
 * (verificado con explain executionStats vs los compuestos con prefijo
 * del mismo campo).
 *
 * USO:
 *   - Dry run (solo lista lo que dropearia, no toca BD):
 *       node scripts/drop_redundant_indexes.js --dry-run
 *
 *   - Ejecutar drops reales:
 *       node scripts/drop_redundant_indexes.js
 *
 *   - Solo una coleccion:
 *       node scripts/drop_redundant_indexes.js --only=accidents
 *
 * REVERSION:
 *   Cualquier drop se puede revertir creando el indice de nuevo. Mongoose
 *   los recrea automaticamente al arrancar el servidor si el schema declara
 *   `index: true` en el campo o `schema.index({...})` correspondiente.
 *
 * SEGURIDAD:
 *   - Llamadas paralelas son seguras (cada dropIndex es atomico).
 *   - Si un indice no existe (ya dropeado), MongoDB tira IndexNotFound;
 *     el script lo captura y continua sin abortar.
 *   - Mediciones de duracion por coleccion en el log final.
 */

require('dotenv').config();
const mongoose = require('mongoose');
const { scriptLogger } = require('../src/config/scriptLogger');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const onlyArg = args.find((a) => a.startsWith('--only='));
const onlyCollection = onlyArg ? onlyArg.split('=')[1] : null;

/**
 * Indices a dropear, agrupados por coleccion.
 *
 * Justificacion por indice: ver docs/optimizations_2026-05-26.md.
 * Todos cubiertos por compuestos existentes (validado con explain).
 */
const INDICES_REDUNDANTES = {
  accidents: [
    'ubicacion.nombreDistrito_1',       // cubierto por ubicacion.nombreDistrito_1_fecha_-1
    'circunstancias.gravedad_1',         // cubierto por circunstancias.gravedad_1_fecha_-1
    'circunstancias.tipoAccidente_1',    // cubierto por circunstancias.tipoAccidente_1_fecha_-1
    'vehiculo.tipo_1',                   // cubierto por vehiculo.tipo_1_fecha_-1
    'numeroExpediente_1',                // cubierto por numeroExpediente_1_fecha_-1
    'ubicacion.calle_1',                 // cubierto por ubicacion.calle_1_fecha_-1
    'franjaHoraria_1',                   // cubierto por franjaHoraria_1_fecha_-1
    'mes_1',                             // cubierto por año_1_mes_1_dia_1
    'hora_1',                            // poco selectivo en si mismo
    'año_1',                             // cubierto por año_1_mes_1_dia_1 e idx_accidents_fecha_distrito_smartcity
    'fecha_1'                            // cubierto por todos los compuestos con fecha
  ],
  fines: [
    'mes_1',                             // cubierto por año_1_mes_1_calificacion_1
    'año_1',                             // cubierto por año_1_mes_1_calificacion_1
    'fecha_1',                           // cubierto por fecha_-1_calificacion_1 e idx_multas_listado_cobertura
    'lugar_1',                           // cubierto por lugar_1_fecha_-1
    'denunciante_1',                     // cubierto por denunciante_1_fecha_-1
    'tieneDescuento_1',                  // cubierto por tieneDescuento_1_fecha_-1
    'importeBoletín_1',                  // cubierto por importeBoletín_-1_fecha_-1
    'calificacion_1',                    // cubierto por fecha_-1_calificacion_1 e idx_fines_statistics
    'puntosDetraídos_1',                 // cubierto por puntosDetraídos_-1_fecha_-1
    'hora_1'                             // poco selectivo
  ],
  censuses: [
    'año_1',                             // cubierto por idx_census_temporal_district
    'mes_1',                             // cubierto por idx_census_temporal_district
    'edad_1',                            // cubierto por idx_census_district_age
    'distrito.codigo_1',                 // cubierto por idx_census_district_date
    'barrio.codigo_1',                   // cubierto por idx_census_neighborhood_demographics
    'seccionCensal.codigo_1',            // cubierto por unique_census_record
    'fechaCenso_1',                      // cubierto por idx_census_population_pyramid
    'barrio.descripcion_1',              // cubierto por idx_census_geographic_names
    'distrito.descripcion_1',            // cubierto por idx_census_geographic_names
    'estadisticas.totalPoblacion_1',     // cubierto por idx_census_population_ranking
    'seccionCensal.codigoDistritoSeccion_1', // cubierto por unique_census_record
    'barrio.codigoDistritoBarrio_1'      // cubierto por unique_census_record
  ],
  traffic_measurements: [
    'año_1',                             // cubierto por idx_traffic_temporal_components
    'hora_1',                            // cubierto por idx_traffic_temporal_components
    'mes_1',                             // cubierto por idx_traffic_temporal_components
    'tipoElemento_1',                    // cubierto por idx_traffic_type_timeline
    'metricas.intensidad_1',             // cubierto por idx_traffic_date_point_intensity
    'analisis.nivelCongestion_1',        // cubierto por idx_traffic_congestion_timeline
    'puntoMedidaId_1',                   // cubierto por traffic_unique_measurement
    'fecha_1',                           // cubierto por multiples compuestos
    'analisis.periodoDia_1',             // cubierto por idx_traffic_period_type
    'analisis.clasificacionIntensidad_1', // cubierto por compuestos especificos
    'analisis.tipoJornada_1'             // cubierto por idx_traffic_pattern_analysis
  ]
};

async function ejecutar() {
  const uri = process.env.DATABASE_URI;
  if (!uri) {
    scriptLogger.error('Falta DATABASE_URI en .env');
    process.exit(1);
  }

  await mongoose.connect(uri);
  scriptLogger.info({ database: mongoose.connection.name }, 'Conectado a MongoDB');

  const colecciones = onlyCollection
    ? { [onlyCollection]: INDICES_REDUNDANTES[onlyCollection] }
    : INDICES_REDUNDANTES;

  if (onlyCollection && !INDICES_REDUNDANTES[onlyCollection]) {
    scriptLogger.error({ coleccion: onlyCollection }, 'Coleccion desconocida');
    process.exit(1);
  }

  const resumen = {};

  for (const [coleccion, indices] of Object.entries(colecciones)) {
    const inicio = Date.now();
    let dropped = 0;
    let yaAusentes = 0;
    let errores = 0;
    const db = mongoose.connection.db;

    scriptLogger.info({ coleccion, total: indices.length }, dryRun ? 'DRY RUN' : 'Iniciando drops');

    for (const nombre of indices) {
      if (dryRun) {
        scriptLogger.info({ coleccion, nombre }, 'Dropearia');
        dropped += 1;
        continue;
      }
      try {
        await db.collection(coleccion).dropIndex(nombre);
        scriptLogger.info({ coleccion, nombre }, 'Indice dropeado');
        dropped += 1;
      } catch (err) {
        if (err.codeName === 'IndexNotFound' || err.message.includes('index not found')) {
          scriptLogger.warn({ coleccion, nombre }, 'Indice ya no existe, ignorado');
          yaAusentes += 1;
        } else {
          scriptLogger.error({ coleccion, nombre, error: err.message }, 'Error al dropear');
          errores += 1;
        }
      }
    }

    const duracion = Date.now() - inicio;
    resumen[coleccion] = { dropped, yaAusentes, errores, duracionMs: duracion };
    scriptLogger.info(resumen[coleccion], `Coleccion ${coleccion} procesada`);
  }

  scriptLogger.info(resumen, 'Resumen final');
  await mongoose.disconnect();

  // Sugerencia post-drop: en el proximo arranque del servidor, Mongoose
  // recreara cualquier indice que SIGA declarado en los schemas. Editar
  // los modelos en src/models/ para quitar las declaraciones de los
  // indices recien dropeados (campos con `index: true` redundante).
  scriptLogger.info(
    'IMPORTANTE: si los indices estan declarados en los schemas Mongoose, '
    + 'se recrearan al proximo restart del servidor. Edita src/models/ '
    + '(Accidente.js, Multa.js, Censo.js, Trafico.js) para quitar '
    + '`index: true` redundantes y `schema.index(...)` correspondientes.'
  );
}

ejecutar().catch((err) => {
  scriptLogger.error({ error: err.message, stack: err.stack }, 'Fallo critico');
  process.exit(1);
});
