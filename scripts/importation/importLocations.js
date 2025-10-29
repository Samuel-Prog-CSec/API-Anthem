const fs = require('fs');
const csv = require('csv-parser');
const path = require('path');
const mongoose = require('mongoose');
const Location = require('../../src/models/Location');
const { connectDB } = require('../../src/config/database');
const config = require('../../src/config/config');

// Parser para archivos GPX
const { DOMParser } = require('@xmldom/xmldom');

/**
 * Importar estaciones de medida acústica
 */
async function importAcousticStations() {
  const filePath = path.join(__dirname, '../../datos_hpe/Ubicaciones/Anthem_CTC_EstacionesMedidaControlAcustico.csv');
  const stations = [];

  return new Promise((resolve, reject) => {
    if (!fs.existsSync(filePath)) {
      console.log('Archivo de estaciones acústicas no encontrado');
      return resolve([]);
    }

    fs.createReadStream(filePath)
      .pipe(csv({ separator: ';' }))
      .on('data', (row) => {
        // Estructura real del CSV: Nº;Nombre;COD_VIA;VIA_CLASE;VIA_PAR;VIA_NOMBRE;Dirección;...;Coordenada_X_ETRS89;Coordenada_Y_ETRS89;LONGITUD_WGS84;LATITUD_WGS84
        const station = {
          tipo: 'estacion_acustica',
          nmt: row['Nº'] || row.Nº || row.id,
          nombre: row.Nombre || row.nombre || `Estación ${row['Nº'] || row.Nº || row.id}`,
          coordenadas: {
            x: parseFloat(row.Coordenada_X_ETRS89 || row.COORDENADA_X_ETRS89 || row.X || 0),
            y: parseFloat(row.Coordenada_Y_ETRS89 || row.COORDENADA_Y_ETRS89 || row.Y || 0)
          },
          distrito: row.DISTRITO || row.distrito,
          barrio: row.BARRIO || row.barrio,
          direccion: row['Dirección'] || row.direccion,
          fechaAlta: row['Fecha alta'] || row.fechaAlta,
          geometry: {
            type: 'Point',
            coordinates: [
              parseFloat(row.LONGITUD_WGS84 || row.longitud || row.Coordenada_X_ETRS89 || 0),
              parseFloat(row.LATITUD_WGS84 || row.latitud || row.Coordenada_Y_ETRS89 || 0)
            ]
          }
        };

        if (station.coordenadas.x && station.coordenadas.y) {
          stations.push(station);
        }
      })
      .on('end', () => {
        console.log(`✅ ${stations.length} estaciones acústicas procesadas`);
        resolve(stations);
      })
      .on('error', reject);
  });
}

/**
 * Importar puntos de medida de tráfico
 */
async function importTrafficPoints() {
  const filePath = path.join(__dirname, '../../datos_hpe/Ubicaciones/Anthem_CTC_PuntoMedidaTrafico.csv');
  const points = [];

  return new Promise((resolve, reject) => {
    if (!fs.existsSync(filePath)) {
      console.log('❌ Archivo de puntos de tráfico no encontrado');
      return resolve([]);
    }

    fs.createReadStream(filePath)
      .pipe(csv({ separator: ';' }))
      .on('data', (row) => {
        // Estructura real: tipo_elem;distrito;id;cod_cent;nombre;utm_x;utm_y;longitud;latitud
        const point = {
          tipo: 'punto_trafico',
          cod_cent: row.cod_cent,
          id_punto: row.id,
          nombre: row.nombre,
          tipo_elem: row.tipo_elem,
          distrito: row.distrito,
          coordenadas: {
            x: parseFloat(row.utm_x || 0),
            y: parseFloat(row.utm_y || 0)
          },
          geometry: {
            type: 'Point',
            coordinates: [parseFloat(row.longitud || 0), parseFloat(row.latitud || 0)]
          }
        };

        if (point.coordenadas.x && point.coordenadas.y) {
          points.push(point);
        }
      })
      .on('end', () => {
        console.log(`✅ ${points.length} puntos de tráfico procesados`);
        resolve(points);
      })
      .on('error', reject);
  });
}

/**
 * Importar archivos GPX (rutas de transporte)
 */
async function importGPXRoutes() {
  const gpxFiles = [
    { file: 'Anthem_CTC_Cercanias.gpx', tipo: 'ruta_cercanias', nombre: 'Cercanías' },
    { file: 'Anthem_CTC_Autobus.gpx', tipo: 'ruta_autobus', nombre: 'Autobús' },
    { file: 'Anthem_CTC_Interurbano.gpx', tipo: 'ruta_interurbano', nombre: 'Interurbano' },
    { file: 'Anthem_CTC_Metro.gpx', tipo: 'ruta_metro', nombre: 'Metro' },
    { file: 'Anthem_CTC_MetroLigero.gpx', tipo: 'ruta_metro_ligero', nombre: 'Metro Ligero' },
    { file: 'Anthem_CTC_Taxi.gpx', tipo: 'zona_taxi', nombre: 'Zona Taxi' }
  ];

  const routes = [];

  for (const gpxInfo of gpxFiles) {
    const filePath = path.join(__dirname, '../../datos_hpe/Ubicaciones', gpxInfo.file);

    if (!fs.existsSync(filePath)) {
      console.log(`⚠️  Archivo ${gpxInfo.file} no encontrado`);
      continue;
    }

    try {
      const gpxContent = fs.readFileSync(filePath, 'utf8');
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(gpxContent, 'text/xml');

      // Extraer waypoints y tracks
      const waypoints = xmlDoc.getElementsByTagName('wpt');
      const tracks = xmlDoc.getElementsByTagName('trk');

      // Procesar waypoints como puntos individuales
      for (let i = 0; i < waypoints.length; i++) {
        const wp = waypoints[i];
        const lat = parseFloat(wp.getAttribute('lat'));
        const lon = parseFloat(wp.getAttribute('lon'));
        const name = wp.getElementsByTagName('name')[0]?.textContent || `${gpxInfo.nombre} ${i+1}`;

        routes.push({
          tipo: gpxInfo.tipo,
          nombre: name,
          coordenadas: {
            x: lon,
            y: lat,
            ruta: [{ lat, lon }]
          },
          geometry: {
            type: 'Point',
            coordinates: [lon, lat]
          }
        });
      }

      // Procesar tracks como líneas
      for (let i = 0; i < tracks.length; i++) {
        const trk = tracks[i];
        const trksegs = trk.getElementsByTagName('trkseg');

        for (let j = 0; j < trksegs.length; j++) {
          const trkpts = trksegs[j].getElementsByTagName('trkpt');
          const rutaPuntos = [];
          const coordinates = [];

          for (let k = 0; k < trkpts.length; k++) {
            const pt = trkpts[k];
            const lat = parseFloat(pt.getAttribute('lat'));
            const lon = parseFloat(pt.getAttribute('lon'));

            rutaPuntos.push({ lat, lon });
            coordinates.push([lon, lat]);
          }

          if (coordinates.length > 1) {
            routes.push({
              tipo: gpxInfo.tipo,
              nombre: `${gpxInfo.nombre} - Ruta ${i+1}-${j+1}`,
              coordenadas: {
                x: coordinates[0][0], // Primer punto como referencia
                y: coordinates[0][1],
                ruta: rutaPuntos
              },
              geometry: {
                type: 'LineString',
                coordinates: coordinates
              }
            });
          }
        }
      }

      console.log(`✅ Archivo ${gpxInfo.file} procesado correctamente`);

    } catch (error) {
      console.error(`❌ Error procesando ${gpxInfo.file}:`, error.message);
    }
  }

  return routes;
}

/**
 * Función principal de importación
 */
async function importAllLocations() {
  try {
    console.log('🚀 Iniciando importación de ubicaciones...\n');

    // Conectar a la base de datos
    await connectDB(config.database.uri);

    // Limpiar colección existente
    await Location.deleteMany({});
    console.log('🧹 Colección de ubicaciones limpiada\n');

    // Importar datos
    console.log('📍 Importando estaciones acústicas...');
    const acousticStations = await importAcousticStations();

    console.log('🚗 Importando puntos de tráfico...');
    const trafficPoints = await importTrafficPoints();

    console.log('🚌 Importando rutas GPX...');
    const transportRoutes = await importGPXRoutes();

    // Combinar todos los datos
    const allLocations = [
      ...acousticStations,
      ...trafficPoints,
      ...transportRoutes
    ];

    if (allLocations.length > 0) {
      // Insertar en lotes para mejorar rendimiento
      const batchSize = 1000;
      for (let i = 0; i < allLocations.length; i += batchSize) {
        const batch = allLocations.slice(i, i + batchSize);
        await Location.insertMany(batch);
        console.log(`✅ Insertado lote ${Math.floor(i/batchSize) + 1}/${Math.ceil(allLocations.length/batchSize)}`);
      }

      console.log(`\n🎉 Importación completada exitosamente!`);
      console.log(`📊 Total de ubicaciones importadas: ${allLocations.length}`);
      console.log(`   - Estaciones acústicas: ${acousticStations.length}`);
      console.log(`   - Puntos de tráfico: ${trafficPoints.length}`);
      console.log(`   - Rutas de transporte: ${transportRoutes.length}`);
    } else {
      console.log('⚠️  No se encontraron datos para importar');
    }

  } catch (error) {
    console.error('❌ Error en la importación:', error);
  } finally {
    // Cerrar conexión de forma segura
    if (mongoose.connection.readyState === 1) {
      try {
        await mongoose.connection.close();
        console.log('\n👋 Conexión a la base de datos cerrada');
      } catch (error) {
        console.error('⚠️  Error cerrando conexión:', error.message);
      }
    }
  }
}

// Ejecutar si es llamado directamente
if (require.main === module) {
  importAllLocations();
}

module.exports = { importAllLocations };
