/**
 * Script de Testing Exhaustivo de Todos los Endpoints
 *
 * Prueba todos los endpoints definidos en la API REST
 */

const axios = require('axios');

const API_BASE_URL = 'http://localhost:3000';
const API_VERSION = 'v0.1';
const API_URL = `${API_BASE_URL}/api/${API_VERSION}`;

// Configuración de axios
const client = axios.create({
  timeout: 15000,
  validateStatus: () => true // Aceptar cualquier status code
});

// Variables globales para el testing
let authToken = null;
let testUser = null;

/**
 * Colores para la consola
 */
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m'
};

/**
 * Utilidad para logging con colores
 */
function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function logSuccess(endpoint, status, time) {
  log(`✅ ${endpoint.padEnd(60)} | Status: ${status} | ${time}ms`, colors.green);
}

function logFail(endpoint, status, error) {
  log(`❌ ${endpoint.padEnd(60)} | Status: ${status} | Error: ${error}`, colors.red);
}

function logSection(title) {
  log(`\n${'='.repeat(80)}`, colors.cyan);
  log(`${title}`, colors.cyan);
  log(`${'='.repeat(80)}`, colors.cyan);
}

/**
 * Estadísticas de testing
 */
const stats = {
  total: 0,
  passed: 0,
  failed: 0,
  endpoints: []
};

/**
 * Función helper para hacer requests y registrar resultados
 */
async function testEndpoint(name, method, url, options = {}) {
  const startTime = Date.now();
  stats.total++;

  try {
    const config = {
      method,
      url,
      ...options
    };

    if (authToken && !options.skipAuth) {
      config.headers = {
        ...config.headers,
        'Authorization': `Bearer ${authToken}`
      };
    }

    const response = await client(config);
    const time = Date.now() - startTime;

    // Determinar si es exitoso
    const isSuccess = response.status >= 200 && response.status < 300;

    if (isSuccess) {
      stats.passed++;
      logSuccess(name, response.status, time);
      stats.endpoints.push({ name, status: response.status, success: true, time });
      return { success: true, response };
    } else {
      stats.failed++;
      logFail(name, response.status, response.data?.message || 'Unknown error');
      stats.endpoints.push({ name, status: response.status, success: false, time });
      return { success: false, response };
    }

  } catch (error) {
    const time = Date.now() - startTime;
    stats.failed++;
    logFail(name, 'ERROR', error.message);
    stats.endpoints.push({ name, status: 'ERROR', success: false, time, error: error.message });
    return { success: false, error };
  }
}

/**
 * Setup: Crear usuario y autenticar
 */
async function setupAuthentication() {
  logSection('🔐 CONFIGURACIÓN INICIAL - AUTENTICACIÓN');

  // Registrar usuario
  testUser = {
    username: `testuser_${Date.now()}`,
    email: `test_${Date.now()}@example.com`,
    password: 'UltraStrong123!@$',
    firstName: 'Test',
    lastName: 'User'
  };

  const registerResult = await testEndpoint(
    'POST /auth/register',
    'POST',
    `${API_URL}/auth/register`,
    {
      data: testUser,
      skipAuth: true
    }
  );

  if (!registerResult.success) {
    log('\n❌ No se pudo registrar el usuario. Abortando tests.', colors.red);
    return false;
  }

  // Login
  const loginResult = await testEndpoint(
    'POST /auth/login',
    'POST',
    `${API_URL}/auth/login`,
    {
      data: {
        identifier: testUser.email,
        password: testUser.password
      },
      skipAuth: true
    }
  );

  if (!loginResult.success) {
    log('\n❌ No se pudo hacer login. Abortando tests.', colors.red);
    return false;
  }

  authToken = loginResult.response.data?.data?.token;

  if (!authToken) {
    log('\n❌ No se recibió token de autenticación. Abortando tests.', colors.red);
    return false;
  }

  log(`\n✅ Autenticación exitosa. Token obtenido.`, colors.green);
  return true;
}

/**
 * Test: Endpoints básicos (públicos)
 */
async function testBasicEndpoints() {
  logSection('🏠 ENDPOINTS BÁSICOS (PÚBLICOS)');

  await testEndpoint('GET /health', 'GET', `${API_BASE_URL}/health`, { skipAuth: true });
  await testEndpoint('GET /', 'GET', `${API_BASE_URL}/`, { skipAuth: true });
  await testEndpoint('GET /api/v0.1', 'GET', `${API_URL}`, { skipAuth: true });
  await testEndpoint('GET /api/v0.1/health', 'GET', `${API_URL}/health`, { skipAuth: true });
  await testEndpoint('GET /api/v0.1/docs', 'GET', `${API_URL}/docs`, { skipAuth: true });
}

/**
 * Test: Endpoints de autenticación
 */
async function testAuthEndpoints() {
  logSection('🔐 ENDPOINTS DE AUTENTICACIÓN');

  await testEndpoint('GET /auth/me', 'GET', `${API_URL}/auth/me`);
  await testEndpoint('GET /auth/verify-token', 'GET', `${API_URL}/auth/verify-token`);

  // Test de actualización de perfil
  await testEndpoint('PUT /auth/profile', 'PUT', `${API_URL}/auth/profile`, {
    data: {
      firstName: 'Updated',
      lastName: 'Name'
    }
  });
}

/**
 * Test: Endpoints de Air Quality
 */
async function testAirQualityEndpoints() {
  logSection('🌬️  ENDPOINTS DE CALIDAD DEL AIRE');

  await testEndpoint('GET /air-quality', 'GET', `${API_URL}/air-quality?limit=10`);
  await testEndpoint('GET /air-quality (con filtros)', 'GET', `${API_URL}/air-quality?provincia=28&limit=5`);
  await testEndpoint('GET /air-quality/statistics', 'GET', `${API_URL}/air-quality/statistics`);
  await testEndpoint('GET /air-quality/trends', 'GET', `${API_URL}/air-quality/trends`);

  // Necesitamos obtener un ID válido primero
  const airQualityData = await client.get(`${API_URL}/air-quality?limit=1`, {
    headers: { 'Authorization': `Bearer ${authToken}` }
  });

  if (airQualityData.data?.data?.[0]?._id) {
    const airQualityId = airQualityData.data.data[0]._id;
    await testEndpoint('GET /air-quality/:id', 'GET', `${API_URL}/air-quality/${airQualityId}`);
  }
}

/**
 * Test: Endpoints de Noise Monitoring
 */
async function testNoiseMonitoringEndpoints() {
  logSection('🔊 ENDPOINTS DE MONITOREO DE RUIDO');

  await testEndpoint('GET /noise-monitoring', 'GET', `${API_URL}/noise-monitoring?limit=10`);
  await testEndpoint('GET /noise-monitoring/statistics', 'GET', `${API_URL}/noise-monitoring/statistics`);
  await testEndpoint('GET /noise-monitoring/ranking', 'GET', `${API_URL}/noise-monitoring/ranking`);
  await testEndpoint('GET /noise-monitoring/stations/search', 'GET', `${API_URL}/noise-monitoring/stations/search?q=NMT`);

  // Obtener un ID válido
  const noiseData = await client.get(`${API_URL}/noise-monitoring?limit=1`, {
    headers: { 'Authorization': `Bearer ${authToken}` }
  });

  if (noiseData.data?.data?.[0]?._id) {
    const noiseId = noiseData.data.data[0]._id;
    await testEndpoint('GET /noise-monitoring/:id', 'GET', `${API_URL}/noise-monitoring/${noiseId}`);
  }
}

/**
 * Test: Endpoints de Multas (Fines)
 */
async function testFinesEndpoints() {
  logSection('🚗 ENDPOINTS DE MULTAS');

  await testEndpoint('GET /fines', 'GET', `${API_URL}/fines?limit=10`);
  await testEndpoint('GET /fines (con filtros)', 'GET', `${API_URL}/fines?distrito=1&limit=5`);
  await testEndpoint('GET /fines/statistics', 'GET', `${API_URL}/fines/statistics`);
  await testEndpoint('GET /fines/locations/ranking', 'GET', `${API_URL}/fines/locations/ranking`);
  await testEndpoint('GET /fines/analysis/temporal', 'GET', `${API_URL}/fines/analysis/temporal`);
  await testEndpoint('GET /fines/dashboard', 'GET', `${API_URL}/fines/dashboard`);

  // Obtener un ID válido
  const finesData = await client.get(`${API_URL}/fines?limit=1`, {
    headers: { 'Authorization': `Bearer ${authToken}` }
  });

  if (finesData.data?.data?.multas?.[0]?._id) {
    const fineId = finesData.data.data.multas[0]._id;
    await testEndpoint('GET /fines/:id', 'GET', `${API_URL}/fines/${fineId}`);
  }
}

/**
 * Test: Endpoints de Censo
 */
async function testCensusEndpoints() {
  logSection('👥 ENDPOINTS DE CENSO');

  await testEndpoint('GET /census', 'GET', `${API_URL}/census?limit=10`);
  await testEndpoint('GET /census (con filtros)', 'GET', `${API_URL}/census?distrito=1&limit=5`);
  await testEndpoint('GET /census/pyramid', 'GET', `${API_URL}/census/pyramid`);
  await testEndpoint('GET /census/districts/statistics', 'GET', `${API_URL}/census/districts/statistics`);
  await testEndpoint('GET /census/analysis/demographic', 'GET', `${API_URL}/census/analysis/demographic`);
  await testEndpoint('GET /census/evolution', 'GET', `${API_URL}/census/evolution`);
  await testEndpoint('GET /census/dashboard', 'GET', `${API_URL}/census/dashboard`);
}

/**
 * Test: Endpoints de Ubicaciones
 */
async function testLocationEndpoints() {
  logSection('📍 ENDPOINTS DE UBICACIONES');

  await testEndpoint('GET /locations', 'GET', `${API_URL}/locations?limit=10`);
  await testEndpoint('GET /locations/puntos-medicion (acustica)', 'GET', `${API_URL}/locations/puntos-medicion/acustica`);
  await testEndpoint('GET /locations/puntos-medicion (trafico)', 'GET', `${API_URL}/locations/puntos-medicion/trafico`);
  await testEndpoint('GET /locations/transporte (metro)', 'GET', `${API_URL}/locations/transporte/metro?limit=5`);
  await testEndpoint('GET /locations/transporte (autobus)', 'GET', `${API_URL}/locations/transporte/autobus?limit=5`);
  await testEndpoint('GET /locations/proximidad', 'GET', `${API_URL}/locations/proximidad?x=-3.7038&y=40.4168&radio=1000&limit=5`);
}

/**
 * Test: Endpoints de Tráfico
 */
async function testTrafficEndpoints() {
  logSection('🚦 ENDPOINTS DE TRÁFICO');

  await testEndpoint('GET /traffic', 'GET', `${API_URL}/traffic?limit=10`);
  await testEndpoint('GET /traffic/stats', 'GET', `${API_URL}/traffic/stats`);
  await testEndpoint('GET /traffic/congestion-analysis', 'GET', `${API_URL}/traffic/congestion-analysis`);
  await testEndpoint('GET /traffic/historical', 'GET', `${API_URL}/traffic/historical?startDate=2051-01-01&endDate=2051-01-31&limit=10`);

  // Obtener un ID de punto de tráfico
  const trafficData = await client.get(`${API_URL}/traffic?limit=1`, {
    headers: { 'Authorization': `Bearer ${authToken}` }
  });

  if (trafficData.data?.data?.[0]?.idelem) {
    const puntoId = trafficData.data.data[0].idelem;
    await testEndpoint('GET /traffic/punto/:id', 'GET', `${API_URL}/traffic/punto/${puntoId}`);
  }
}

/**
 * Test: Endpoints de Accidentes
 */
async function testAccidentEndpoints() {
  logSection('🚨 ENDPOINTS DE ACCIDENTES');

  await testEndpoint('GET /accidents', 'GET', `${API_URL}/accidents?limit=10`);
  await testEndpoint('GET /accidents/stats', 'GET', `${API_URL}/accidents/stats`);
  await testEndpoint('GET /accidents/heatmap', 'GET', `${API_URL}/accidents/heatmap`);
  await testEndpoint('GET /accidents/safety-analysis', 'GET', `${API_URL}/accidents/safety-analysis`);
  await testEndpoint('GET /accidents/district-comparison', 'GET', `${API_URL}/accidents/district-comparison`);

  // Obtener un expediente válido
  const accidentData = await client.get(`${API_URL}/accidents?limit=1`, {
    headers: { 'Authorization': `Bearer ${authToken}` }
  });

  if (accidentData.data?.data?.accidentes?.[0]?.expediente) {
    const expediente = accidentData.data.data.accidentes[0].expediente;
    await testEndpoint('GET /accidents/expediente/:numero', 'GET', `${API_URL}/accidents/expediente/${expediente}`);
  }
}

/**
 * Test: Endpoints de Asignación de Patinetes
 */
async function testScooterAssignmentEndpoints() {
  logSection('🛴 ENDPOINTS DE ASIGNACIÓN DE PATINETES');

  await testEndpoint('GET /scooter-assignments', 'GET', `${API_URL}/scooter-assignments?limit=10`);
  await testEndpoint('GET /scooter-assignments/statistics/districts', 'GET', `${API_URL}/scooter-assignments/statistics/districts`);
  await testEndpoint('GET /scooter-assignments/market-analysis/providers', 'GET', `${API_URL}/scooter-assignments/market-analysis/providers`);
  await testEndpoint('GET /scooter-assignments/concentration-zones', 'GET', `${API_URL}/scooter-assignments/concentration-zones`);
  await testEndpoint('GET /scooter-assignments/dashboard', 'GET', `${API_URL}/scooter-assignments/dashboard`);
  await testEndpoint('GET /scooter-assignments/optimization-analysis', 'GET', `${API_URL}/scooter-assignments/optimization-analysis`);

  // Obtener un distrito/barrio válido
  const scooterData = await client.get(`${API_URL}/scooter-assignments?limit=1`, {
    headers: { 'Authorization': `Bearer ${authToken}` }
  });

  if (scooterData.data?.data?.asignaciones?.[0]) {
    const { distrito, barrio } = scooterData.data.data.asignaciones[0];
    await testEndpoint('GET /scooter-assignments/area/:distrito/:barrio', 'GET', `${API_URL}/scooter-assignments/area/${encodeURIComponent(distrito)}/${encodeURIComponent(barrio)}`);
  }
}

/**
 * Test: Endpoints de Disponibilidad de Bicicletas
 */
async function testBikeAvailabilityEndpoints() {
  logSection('🚴 ENDPOINTS DE DISPONIBILIDAD DE BICICLETAS');

  // GET /bikes - Obtener registros con paginación
  await testEndpoint('GET /bikes', 'GET', `${API_URL}/bikes?limit=10`);

  // GET /bikes - Con filtros de fecha
  await testEndpoint('GET /bikes (con filtros de fecha)', 'GET', `${API_URL}/bikes?startDate=2051-01-01&endDate=2051-01-31&limit=20`);

  // GET /bikes - Con ordenamiento
  await testEndpoint('GET /bikes (ordenado por usos)', 'GET', `${API_URL}/bikes?sortBy=totalUsos&sortOrder=desc&limit=10`);

  // GET /bikes/date/:date - Obtener una fecha válida primero
  const bikesData = await client.get(`${API_URL}/bikes?limit=1`, {
    headers: { 'Authorization': `Bearer ${authToken}` }
  });

  if (bikesData.data?.data?.[0]?.fecha) {
    const fecha = bikesData.data.data[0].fecha.split('T')[0]; // Formato YYYY-MM-DD
    await testEndpoint('GET /bikes/date/:date', 'GET', `${API_URL}/bikes/date/${fecha}`);
  }

  // GET /bikes/stats - Estadísticas generales
  await testEndpoint('GET /bikes/stats', 'GET', `${API_URL}/bikes/stats`);

  // GET /bikes/stats - Con rango de fechas
  await testEndpoint('GET /bikes/stats (con fechas)', 'GET', `${API_URL}/bikes/stats?startDate=2051-01-01&endDate=2051-03-31`);

  // GET /bikes/trends/monthly - Tendencias mensuales
  await testEndpoint('GET /bikes/trends/monthly', 'GET', `${API_URL}/bikes/trends/monthly?year=2051`);

  // GET /bikes/top-usage - Días con mayor uso
  await testEndpoint('GET /bikes/top-usage', 'GET', `${API_URL}/bikes/top-usage?limit=5`);

  // GET /bikes/subscription-comparison - Comparación de tipos de abonados
  await testEndpoint('GET /bikes/subscription-comparison', 'GET', `${API_URL}/bikes/subscription-comparison?startDate=2051-01-01&endDate=2051-12-31`);

  // GET /bikes/efficiency - Análisis de eficiencia
  await testEndpoint('GET /bikes/efficiency', 'GET', `${API_URL}/bikes/efficiency`);

  // GET /bikes/historical - Datos históricos por día
  await testEndpoint('GET /bikes/historical (por día)', 'GET', `${API_URL}/bikes/historical?startDate=2051-01-01&endDate=2051-01-31&aggregation=day`);

  // GET /bikes/historical - Agregación por semana
  await testEndpoint('GET /bikes/historical (por semana)', 'GET', `${API_URL}/bikes/historical?startDate=2051-01-01&endDate=2051-03-31&aggregation=week`);

  // GET /bikes/historical - Agregación por mes
  await testEndpoint('GET /bikes/historical (por mes)', 'GET', `${API_URL}/bikes/historical?aggregation=month`);
}

/**
 * Test: Endpoints de Contenedores de Residuos
 */
async function testContainerEndpoints() {
  logSection('🗑️  ENDPOINTS DE CONTENEDORES DE RESIDUOS');

  // GET /containers - Obtener todos con paginación
  await testEndpoint('GET /containers', 'GET', `${API_URL}/containers?limit=20`);

  // GET /containers - Filtrar por tipo
  await testEndpoint('GET /containers (tipo VIDRIO)', 'GET', `${API_URL}/containers?tipoContenedor=VIDRIO&limit=10`);

  // GET /containers - Filtrar por distrito
  await testEndpoint('GET /containers (distrito)', 'GET', `${API_URL}/containers?distrito=HORTALEZA&limit=10`);

  // GET /containers - Múltiples filtros
  await testEndpoint('GET /containers (múltiples filtros)', 'GET', `${API_URL}/containers?distrito=HORTALEZA&tipoContenedor=ORGANICA&limit=5`);

  // GET /containers/nearby - Contenedores cercanos (Puerta del Sol)
  await testEndpoint('GET /containers/nearby', 'GET', `${API_URL}/containers/nearby?longitude=-3.7038&latitude=40.4168&maxDistance=500`);

  // GET /containers/nearby - Con filtro de tipo
  await testEndpoint('GET /containers/nearby (con tipo)', 'GET', `${API_URL}/containers/nearby?longitude=-3.7038&latitude=40.4168&maxDistance=300&tipoContenedor=PAPEL-CARTON`);

  // GET /containers/stats - Estadísticas generales
  await testEndpoint('GET /containers/stats', 'GET', `${API_URL}/containers/stats`);

  // GET /containers/stats/district - Estadísticas por distrito
  await testEndpoint('GET /containers/stats/district', 'GET', `${API_URL}/containers/stats/district`);

  // GET /containers/stats/district - Distrito específico
  await testEndpoint('GET /containers/stats/district (específico)', 'GET', `${API_URL}/containers/stats/district?distrito=CARABANCHEL`);

  // GET /containers/stats/neighborhood - Por barrio
  await testEndpoint('GET /containers/stats/neighborhood', 'GET', `${API_URL}/containers/stats/neighborhood?distrito=HORTALEZA`);

  // GET /containers/count-by-type - Conteo por tipo (general)
  await testEndpoint('GET /containers/count-by-type', 'GET', `${API_URL}/containers/count-by-type?distrito=CENTRO`);

  // GET /containers/count-by-type - Por distrito
  await testEndpoint('GET /containers/count-by-type (distrito)', 'GET', `${API_URL}/containers/count-by-type?distrito=LATINA`);

  // GET /containers/districts - Lista de distritos
  await testEndpoint('GET /containers/districts', 'GET', `${API_URL}/containers/districts`);

  // GET /containers/neighborhoods/:distrito - Barrios de un distrito
  await testEndpoint('GET /containers/neighborhoods/:distrito', 'GET', `${API_URL}/containers/neighborhoods/HORTALEZA`);

  // GET /containers/search - Búsqueda por dirección
  await testEndpoint('GET /containers/search', 'GET', `${API_URL}/containers/search?q=GRAN VIA`);

  // GET /containers/heatmap - Datos para mapa de calor
  await testEndpoint('GET /containers/heatmap', 'GET', `${API_URL}/containers/heatmap?tipoContenedor=ORGANICA`);

  // GET /containers/coverage - Análisis de cobertura
  await testEndpoint('GET /containers/coverage', 'GET', `${API_URL}/containers/coverage?distrito=HORTALEZA`);
}

/**
 * Test: Endpoints de Administración
 */
async function testAdminEndpoints() {
  logSection('⚙️  ENDPOINTS DE ADMINISTRACIÓN');

  // Nota: Estos endpoints requieren rol de admin, así que pueden fallar
  await testEndpoint('GET /admin/cache/stats', 'GET', `${API_URL}/admin/cache/stats`);
  await testEndpoint('GET /admin/system/health', 'GET', `${API_URL}/admin/system/health`);
}

/**
 * Test: Endpoints de seguridad y errores
 */
async function testSecurityEndpoints() {
  logSection('🔒 TESTS DE SEGURIDAD');

  // Test sin autenticación (debería fallar con 401)
  const noAuthResult = await client.get(`${API_URL}/air-quality`);
  if (noAuthResult.status === 401) {
    stats.total++;
    stats.passed++;
    logSuccess('GET /air-quality (sin auth) - Debe devolver 401', 401, 0);
  } else {
    stats.total++;
    stats.failed++;
    logFail('GET /air-quality (sin auth) - Debe devolver 401', noAuthResult.status, 'Expected 401');
  }

  // Test con token inválido (debería fallar con 401)
  const invalidTokenResult = await client.get(`${API_URL}/air-quality`, {
    headers: { 'Authorization': 'Bearer token_invalido_12345' }
  });
  if (invalidTokenResult.status === 401) {
    stats.total++;
    stats.passed++;
    logSuccess('GET /air-quality (token inválido) - Debe devolver 401', 401, 0);
  } else {
    stats.total++;
    stats.failed++;
    logFail('GET /air-quality (token inválido) - Debe devolver 401', invalidTokenResult.status, 'Expected 401');
  }

  // Test de ruta no encontrada (debería devolver 404)
  const notFoundResult = await client.get(`${API_URL}/ruta-inexistente`);
  if (notFoundResult.status === 404) {
    stats.total++;
    stats.passed++;
    logSuccess('GET /ruta-inexistente - Debe devolver 404', 404, 0);
  } else {
    stats.total++;
    stats.failed++;
    logFail('GET /ruta-inexistente - Debe devolver 404', notFoundResult.status, 'Expected 404');
  }
}

/**
 * Test de logout
 */
async function testLogout() {
  logSection('👋 LOGOUT');

  await testEndpoint('POST /auth/logout', 'POST', `${API_URL}/auth/logout`, {
    data: {},
    headers: {
      'Content-Type': 'application/json'
    }
  });
}

/**
 * Mostrar resumen final
 */
function showSummary() {
  logSection('📊 RESUMEN FINAL DE TESTING');

  log(`\nTotal de endpoints probados: ${stats.total}`, colors.cyan);
  log(`✅ Exitosos: ${stats.passed} (${((stats.passed / stats.total) * 100).toFixed(1)}%)`, colors.green);
  log(`❌ Fallidos: ${stats.failed} (${((stats.failed / stats.total) * 100).toFixed(1)}%)`, colors.red);

  if (stats.failed > 0) {
    log(`\n${'='.repeat(80)}`, colors.red);
    log(`ENDPOINTS FALLIDOS:`, colors.red);
    log(`${'='.repeat(80)}`, colors.red);

    stats.endpoints
      .filter(e => !e.success)
      .forEach(e => {
        log(`❌ ${e.name} - Status: ${e.status} ${e.error ? `- ${e.error}` : ''}`, colors.red);
      });
  }

  // Estadísticas de tiempo
  const times = stats.endpoints.filter(e => e.time).map(e => e.time);
  if (times.length > 0) {
    const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
    const maxTime = Math.max(...times);
    const minTime = Math.min(...times);

    log(`\n${'='.repeat(80)}`, colors.cyan);
    log(`ESTADÍSTICAS DE RENDIMIENTO:`, colors.cyan);
    log(`${'='.repeat(80)}`, colors.cyan);
    log(`Tiempo promedio de respuesta: ${avgTime.toFixed(0)}ms`, colors.cyan);
    log(`Tiempo mínimo: ${minTime}ms`, colors.cyan);
    log(`Tiempo máximo: ${maxTime}ms`, colors.cyan);
  }

  log(`\n${'='.repeat(80)}`, colors.cyan);
  if (stats.failed === 0) {
    log(`🎉 ¡TODOS LOS TESTS PASARON EXITOSAMENTE!`, colors.green);
  } else {
    log(`⚠️  ALGUNOS TESTS FALLARON - Revisa los detalles arriba`, colors.yellow);
  }
  log(`${'='.repeat(80)}`, colors.cyan);
}

/**
 * Función principal
 */
async function main() {
  log('\n🚀 INICIANDO TESTING EXHAUSTIVO DE LA API REST', colors.magenta);
  log(`📍 URL Base: ${API_BASE_URL}`, colors.magenta);
  log(`📍 API URL: ${API_URL}`, colors.magenta);

  try {
    // 1. Setup de autenticación
    const authSuccess = await setupAuthentication();
    if (!authSuccess) {
      log('\n❌ No se pudo completar la autenticación inicial', colors.red);
      process.exit(1);
    }

    // 2. Tests de endpoints básicos
    await testBasicEndpoints();

    // 3. Tests de endpoints de autenticación
    await testAuthEndpoints();

    // 4. Tests de endpoints de datos ambientales
    await testAirQualityEndpoints();
    await testNoiseMonitoringEndpoints();

    // 5. Tests de endpoints de datos de ciudad
    await testFinesEndpoints();
    await testCensusEndpoints();
    await testLocationEndpoints();
    await testTrafficEndpoints();
    await testAccidentEndpoints();
    await testScooterAssignmentEndpoints();

    // 6. Tests de endpoints de movilidad y medio ambiente
    await testBikeAvailabilityEndpoints();
    await testContainerEndpoints();

    // 7. Tests de administración
    await testAdminEndpoints();

    // 8. Tests de seguridad
    await testSecurityEndpoints();

    // 9. Logout
    await testLogout();

    // 9. Mostrar resumen
    showSummary();

    // Exit code basado en resultados
    process.exit(stats.failed > 0 ? 1 : 0);

  } catch (error) {
    log(`\n❌ ERROR FATAL: ${error.message}`, colors.red);
    console.error(error);
    process.exit(1);
  }
}

// Ejecutar tests
if (require.main === module) {
  main();
}

module.exports = { main };
