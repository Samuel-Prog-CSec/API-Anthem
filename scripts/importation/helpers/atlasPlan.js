'use strict';

/**
 * Plan declarativo del modo ATLAS (subset para MongoDB M0, limite duro de 512MB).
 *
 * Fuente unica de todos los numeros del subset: para ajustar cuanto se importa de cada
 * coleccion se edita SOLO este archivo, sin tocar los importadores.
 *
 * Por importador (clave = misma que en importAll.js IMPORTERS):
 *   - entera: true             -> importar la coleccion completa (sin cupo ni filtro).
 *   - tope: number             -> maximo de documentos a insertar (muestreo).
 *   - cupoPorEstrato: number   -> maximo por valor de clave de estrato (fuerza variedad).
 *   - estratosEsperados: number-> alternativa a cupoPorEstrato; el LimitadorAtlas deriva
 *                                 cupoPorEstrato = ceil(tope / estratosEsperados).
 *   - archivos: string[]       -> subset de CSV mensuales a abrir (importers directorio-based).
 *
 * La clave de estrato (que campo define un estrato) la fija cada importador al crear el
 * LimitadorAtlas, porque depende del shape del documento ya transformado. Se documenta
 * aqui junto a cada entrada para tener la imagen completa en un solo sitio. Importante:
 * la clave incluye el MES en las colecciones con varios archivos mensuales, para que el
 * cupo reparta el tope entre los meses elegidos y ninguno acapare al procesarse en serie.
 *
 * Objetivo de tamano: apurar hacia ~450MB de los 512MB. IMPORTANTE: Atlas M0/Flex mide el
 * limite sobre dataSize + indexSize (tamano LOGICO sin compresion), NO sobre el disco
 * comprimido (que aqui es ~7x menor). Los topes de abajo estan calibrados a ~450MB logicos
 * medidos con db.stats() en local. Censo es con diferencia la coleccion mas pesada
 * (~1KB logico por doc con sus subdocumentos derivados), por eso lleva el mayor recorte.
 */
module.exports = {
  // --- Referencia: SIEMPRE entera (FK del resto de dominios) ---
  ubicaciones: { entera: true },

  // --- Pequenas o series temporales completas: enteras ---
  ruido: { entera: true },        // ~359 docs (30 estaciones x 12 meses, tendencia mensual)
  bicicletas: { entera: true },   // ~365 docs (1 por dia, tendencia anual)
  patinetes: { entera: true },    // ~128 docs (21 distritos x proveedores)
  accidentes: { entera: true },   // ~32K: muestrear partiria expedientes (1 fila = 1 afectado)
  contenedores: { entera: true }, // ~38K (~13MB): el mapa por viewport lo agradece
  aire: { entera: true },         // ~55K (12 meses): cabe barato y maximiza variedad estacional

  // --- Aforos (archivo unico, todos los meses): muestreo estratificado ---
  // Clave de estrato: `identificador|mes|hora` -> cubre estaciones, los 12 meses y el
  // patron horario 0-23h que necesitan los graficos.
  'aforo-bicicletas': { tope: 52000, estratosEsperados: 10000 },
  'aforo-peatones': { tope: 45000, estratosEsperados: 9000 },

  // --- Censo (4 meses): muestreo estratificado ---
  // Clave de estrato: `mes|distrito.codigo|edad` -> los 4 meses, los 21 distritos y un
  // barrido de edades por mes (piramide poblacional con forma). El frontend consulta
  // siempre por un mes concreto y nunca suma, asi que varios meses son seguros.
  //
  // RECALIBRADO contra Atlas M0 real (jun 2026): la medicion previa de ~450MB era en
  // local y se quedaba corta. En Atlas, dataSize+indexSize del censo a 113K docs era
  // ~145MB (la coleccion mas pesada, ~1.28KB/doc con sus 15 indices). Con air_quality
  // (~98MB, entera) y traffic (~98MB) ya casi sin margen, el censo es la palanca de
  // recorte: 30K docs estratificados (~40MB) bastan para piramides por mes/distrito.
  censo: {
    tope: 30000,
    estratosEsperados: 8400,
    archivos: [
      'Anthem_CTC_Censo_012051.csv',
      'Anthem_CTC_Censo_042051.csv',
      'Anthem_CTC_Censo_072051.csv',
      'Anthem_CTC_Censo_102051.csv'
    ]
  },

  // --- Multas (4 meses): muestreo estratificado ---
  // Clave de estrato: `mes|calificacion|metadatos.tipoInfraccion` -> variedad de meses,
  // gravedades y tipos de infraccion para que los graficos no salgan monotonos.
  //
  // RECALIBRADO contra Atlas M0 real (jun 2026): 50K docs (~40MB) para no superar el
  // limite duro de 512MB de M0 una vez sumadas todas las colecciones + traffic_daily.
  // (Conservador a proposito: M0 bloquea TODAS las escrituras al exceder 512MB.)
  multas: {
    tope: 50000,
    estratosEsperados: 190,
    archivos: [
      'Anthem_CTC_Multas_012051.csv',
      'Anthem_CTC_Multas_042051.csv',
      'Anthem_CTC_Multas_072051.csv',
      'Anthem_CTC_Multas_102051.csv'
    ]
  },

  // --- Trafico (3 meses): caso especial, NO usa LimitadorAtlas ---
  // La pagina de trafico lee del rollup traffic_daily y permite elegir un rango CONTINUO
  // (max 7 dias) y filtrar por tipo URB/M30. El importador aplica un filtro determinista
  // estratificado POR TIPO y por archivo: hasta maxPuntosPorTipo puntos URB y M30 de cada
  // mes, solo los dias 1..diaMax (contiguos). Los CSV estan ordenados por punto y cada mes
  // empieza por un tipo distinto (enero M30 id 1001, julio URB id 3396), por eso se
  // estratifica por tipo y el estado de seleccion es por archivo (no global).
  trafico: {
    tope: 150000,
    maxPuntosPorTipo: 15,
    diaMax: 10,
    archivos: [
      'Anthem_CTC_Traffic_012051.csv',
      'Anthem_CTC_Traffic_042051.csv',
      'Anthem_CTC_Traffic_072051.csv',
      'Anthem_CTC_Traffic_102051.csv'
    ]
  }
};
