const axios = require('axios');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000/api/v1.0';
const USER = {
  username: `tester_${Date.now()}`,
  email: `tester_${Date.now()}@example.com`,
  password: 'Str0ngP@ssw0rd!2025',
  nombre: 'Test',
  apellido: 'User'
};

const client = axios.create({
  baseURL: BASE_URL,
  timeout: 15000
});

const results = [];

async function runTest(name, fn) {
  try {
    const start = Date.now();
    await fn();
    const duration = Date.now() - start;
    console.log(`✅ [PASS] ${name} (${duration}ms)`);
    results.push({ name, status: 'PASS', duration });
  } catch (error) {
    console.error(`❌ [FAIL] ${name}: ${error.message}`);
    if (error.response) {
      console.error('   Status:', error.response.status);
      console.error('   Data:', JSON.stringify(error.response.data, null, 2));
    }
    results.push({ name, status: 'FAIL', error: error.message });
  }
}

async function main() {
  console.log('🚀 Iniciando verificación de API (locations, air-quality, noise-monitoring)');

  let token = '';
  let sampleLocation = null;
  let bboxQuery = null;
  let proximityPoint = [-3.7038, 40.4168]; // Fallback: centro de Madrid
  let sampleAir = null;
  let sampleNoise = null;
  let sampleNoiseAlt = null;

  // 1) Autenticación
  await runTest('Auth - Registro de usuario', async () => {
    const res = await client.post('/auth/register', USER);
    token = res.data?.data?.accessToken;
    if (!token) {
      throw new Error('No se devolvió token JWT');
    }
    client.defaults.headers.common.Authorization = `Bearer ${token}`;
  });

  // 2) LOCATIONS
  await runTest('Locations - listado base (limit=10)', async () => {
    const res = await client.get('/locations', { params: { limit: 10 } });
    if (!res.data?.success) throw new Error('Respuesta success=false');
    const ubicaciones = res.data?.data?.ubicaciones;
    if (!Array.isArray(ubicaciones) || ubicaciones.length === 0) {
      throw new Error('No se devolvieron ubicaciones');
    }
    sampleLocation = ubicaciones[0];
    if (sampleLocation?.coordenadas?.x && sampleLocation?.coordenadas?.y) {
      const { x, y } = sampleLocation.coordenadas;
      bboxQuery = `${x - 500},${y - 500},${x + 500},${y + 500}`;
    }
  });

  await runTest('Locations - filtro tipo ruta_autobus', async () => {
    const res = await client.get('/locations', { params: { tipo: 'ruta_autobus', limit: 10 } });
    if (!res.data?.success) throw new Error('Respuesta success=false');
  });

  await runTest('Locations - filtro bbox dinámico', async () => {
    if (!bboxQuery) throw new Error('bbox no calculado');
    const res = await client.get('/locations', { params: { bbox: bboxQuery, limit: 20 } });
    if (!res.data?.success) throw new Error('Respuesta success=false');
  });

  await runTest('Locations - puntos medición acústica', async () => {
    const res = await client.get('/locations/puntos-medicion/acustica');
    if (!res.data?.success) throw new Error('Respuesta success=false');
    const puntos = res.data?.data?.puntos;
    if (!Array.isArray(puntos) || puntos.length === 0) {
      throw new Error('No se devolvieron puntos acústicos');
    }
    const geo = puntos.find(p => p?.geometry?.coordinates?.length === 2)?.geometry?.coordinates;
    if (geo) {
      proximityPoint = geo;
    }
  });

  await runTest('Locations - puntos medición tráfico', async () => {
    const res = await client.get('/locations/puntos-medicion/trafico');
    if (!res.data?.success) throw new Error('Respuesta success=false');
  });

  await runTest('Locations - transporte metro', async () => {
    const res = await client.get('/locations/transporte/metro');
    if (!res.data?.success) throw new Error('Respuesta success=false');
  });

  await runTest('Locations - transporte todos', async () => {
    const res = await client.get('/locations/transporte/todos');
    if (!res.data?.success) throw new Error('Respuesta success=false');
  });

  /*
  await runTest('Locations - análisis proximidad (radio 750m)', async () => {
    const [x, y] = proximityPoint;
    const res = await client.get('/locations/proximidad', { params: { x, y, radio: 750 } });
    if (!res.data?.success) throw new Error('Respuesta success=false');
    const analisis = res.data?.data?.analisis_proximidad;
    if (!Array.isArray(analisis) || analisis.length === 0) {
      throw new Error('Análisis de proximidad vacío');
    }
  });
  */

  // 3) AIR QUALITY
  await runTest('AirQuality - listado base (limit=5)', async () => {
    const res = await client.get('/air-quality', { params: { limit: 5 } });
    if (!res.data?.success) throw new Error('Respuesta success=false');
    const registros = res.data?.data?.data;
    if (!Array.isArray(registros) || registros.length === 0) {
      throw new Error('No hay registros de calidad de aire');
    }
    sampleAir = registros[0];
  });

  await runTest('AirQuality - filtros fecha+magnitud', async () => {
    const res = await client.get('/air-quality', {
      params: {
        startDate: '2051-01-01',
        endDate: '2051-01-15',
        magnitud: sampleAir?.magnitud || 10,
        limit: 5
      }
    });
    if (!res.data?.success) throw new Error('Respuesta success=false');
  });

  await runTest('AirQuality - includeInvalid, paginado y orden', async () => {
    const res = await client.get('/air-quality', {
      params: {
        includeInvalid: true,
        page: 2,
        limit: 5,
        sortBy: 'fecha',
        sortOrder: 'asc'
      }
    });
    if (!res.data?.success) throw new Error('Respuesta success=false');
  });

  await runTest('AirQuality - estadísticas (groupBy=DAY)', async () => {
    const res = await client.get('/air-quality/statistics', {
      params: {
        startDate: '2051-01-01',
        endDate: '2051-03-31',
        groupBy: 'DAY',
        magnitud: sampleAir?.magnitud || 10
      }
    });
    if (!res.data?.success) throw new Error('Respuesta success=false');
  });

  await runTest('AirQuality - tendencias por provincia/municipio/magnitud', async () => {
    const res = await client.get('/air-quality/trends', {
      params: {
        provincia: sampleAir?.provincia || 28,
        municipio: sampleAir?.municipio || 79,
        magnitud: sampleAir?.magnitud || 10,
        startDate: '2051-06-01',
        endDate: '2051-06-30'
      }
    });
    if (!res.data?.success) throw new Error('Respuesta success=false');
  });

  await runTest('AirQuality - detalle por ID', async () => {
    if (!sampleAir?._id) throw new Error('ID de muestra no disponible');
    const res = await client.get(`/air-quality/${sampleAir._id}`);
    if (!res.data?.success) throw new Error('Respuesta success=false');
  });

  // 4) NOISE MONITORING
  await runTest('Noise - listado base (limit=5)', async () => {
    const res = await client.get('/noise-monitoring', { params: { limit: 5 } });
    if (!res.data?.success) throw new Error('Respuesta success=false');
    const registros = res.data?.data?.data;
    if (!Array.isArray(registros) || registros.length === 0) {
      throw new Error('No hay registros de ruido');
    }
    sampleNoise = registros[0];
    sampleNoiseAlt = registros.find(r => r.nmt !== sampleNoise.nmt) || registros[1] || sampleNoise;
  });

  await runTest('Noise - filtros año/mes/nmt + orden', async () => {
    const res = await client.get('/noise-monitoring', {
      params: {
        año: sampleNoise?.año || 2051,
        mes: sampleNoise?.mes || 6,
        nmt: sampleNoise?.nmt,
        sortBy: 'laeq24',
        sortOrder: 'desc',
        includeInvalid: true,
        limit: 5
      }
    });
    if (!res.data?.success) throw new Error('Respuesta success=false');
  });

  await runTest('Noise - estadísticas (groupBy=month)', async () => {
    const res = await client.get('/noise-monitoring/statistics', {
      params: {
        startDate: '2051-01-01',
        endDate: '2051-12-31',
        groupBy: 'month'
      }
    });
    if (!res.data?.success) throw new Error('Respuesta success=false');
  });

  await runTest('Noise - ranking nocturno top 5', async () => {
    const res = await client.get('/noise-monitoring/ranking', {
      params: {
        startDate: '2051-01-01',
        endDate: '2051-12-31',
        orderBy: 'nocturno',
        limit: 5
      }
    });
    if (!res.data?.success) throw new Error('Respuesta success=false');
  });

  await runTest('Noise - búsqueda de estaciones', async () => {
    const term = sampleNoise?.nombre?.split(' ')[0] || 'Madrid';
    const res = await client.get('/noise-monitoring/stations/search', { params: { q: term, limit: 10 } });
    if (!res.data?.success) throw new Error('Respuesta success=false');
  });

  await runTest('Noise - comparación de estaciones', async () => {
    const stationIds = Array.from(new Set([sampleNoise?.nmt, sampleNoiseAlt?.nmt])).filter(Boolean);
    if (stationIds.length < 2) throw new Error('No hay al menos dos estaciones distintas para comparar');
    const res = await client.get('/noise-monitoring/stations/compare', {
      params: {
        stations: stationIds,
        startDate: '2051-01-01',
        endDate: '2051-12-31',
        metric: 'laeq24'
      }
    });
    if (!res.data?.success) throw new Error('Respuesta success=false');
  });

  await runTest('Noise - tendencias temporales por estación', async () => {
    const res = await client.get('/noise-monitoring/trends/temporal', {
      params: {
        nmt: sampleNoise?.nmt,
        startDate: '2051-01-01',
        endDate: '2051-12-31',
        groupBy: 'month',
        metric: 'laeq24'
      }
    });
    if (!res.data?.success) throw new Error('Respuesta success=false');
  });

  await runTest('Noise - cumplimiento por zona', async () => {
    const res = await client.get('/noise-monitoring/compliance/zone', {
      params: {
        startDate: '2051-01-01',
        endDate: '2051-12-31',
        threshold: 65,
        zoneType: 'residential'
      }
    });
    if (!res.data?.success) throw new Error('Respuesta success=false');
  });

  await runTest('Noise - detalle por ID', async () => {
    if (!sampleNoise?._id) throw new Error('ID de muestra no disponible');
    const res = await client.get(`/noise-monitoring/${sampleNoise._id}`);
    if (!res.data?.success) throw new Error('Respuesta success=false');
  });

  console.log('\n📊 Resumen:');
  console.table(results);
}

main();
