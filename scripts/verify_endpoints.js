/**
 * Verificacion de Endpoints
 *
 * Smoke test de los endpoints principales de la API. Usa axios para realizar
 * peticiones reales y comprueba forma de respuesta + status. Pensado para
 * ejecutarse contra un backend ya corriendo (BASE_URL configurable via env).
 *
 * Uso:
 *   node scripts/verify_endpoints.js
 *   BASE_URL=http://localhost:3000/api/v1 node scripts/verify_endpoints.js
 */

'use strict';

const axios = require('axios');

// Helpers de output al terminal: separados de logging para que Pino siga
// reservado a logs estructurados y este CLI muestre texto plano legible
const imprimir = (mensaje = '') => process.stdout.write(`${mensaje}\n`);
const imprimirError = (mensaje = '') => process.stderr.write(`${mensaje}\n`);

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000/api/v1';
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

const resultados = [];

async function ejecutarTest(nombre, fn) {
  const inicio = Date.now();
  try {
    await fn();
    const duracion = Date.now() - inicio;
    imprimir(`[OK]   ${nombre} (${duracion}ms)`);
    resultados.push({ nombre, estado: 'OK', duracion });
  } catch (error) {
    const duracion = Date.now() - inicio;
    imprimirError(`[FAIL] ${nombre}: ${error.message}`);
    if (error.response) {
      imprimirError(`       Status: ${error.response.status}`);
      imprimirError(`       Data:   ${JSON.stringify(error.response.data)}`);
    }
    resultados.push({ nombre, estado: 'FAIL', duracion, error: error.message });
  }
}

async function main() {
  imprimir(`Iniciando verificacion de API contra ${BASE_URL}`);
  imprimir('Recursos: ubicaciones, calidad-aire, ruido\n');

  let token = '';
  let muestraUbicacion = null;
  let bboxQuery = null;
  let muestraAire = null;
  let muestraRuido = null;

  // 1) Autenticacion
  await ejecutarTest('Auth - Registro de usuario', async () => {
    const res = await client.post('/auth/register', USER);
    token = res.data?.data?.accessToken;
    if (!token) {
      throw new Error('No se devolvio token JWT');
    }
    client.defaults.headers.common.Authorization = `Bearer ${token}`;
  });

  // 2) UBICACIONES
  await ejecutarTest('Ubicaciones - listado base (limit=10)', async () => {
    const res = await client.get('/ubicaciones', { params: { limit: 10 } });
    if (!res.data?.success) {throw new Error('Respuesta success=false');}
    const ubicaciones = res.data?.data?.ubicaciones || res.data?.data;
    if (!Array.isArray(ubicaciones) || ubicaciones.length === 0) {
      throw new Error('No se devolvieron ubicaciones');
    }
    muestraUbicacion = ubicaciones[0];
    if (muestraUbicacion?.coordenadas?.x && muestraUbicacion?.coordenadas?.y) {
      const { x, y } = muestraUbicacion.coordenadas;
      bboxQuery = `${x - 500},${y - 500},${x + 500},${y + 500}`;
    }
  });

  await ejecutarTest('Ubicaciones - filtro tipo ruta_autobus', async () => {
    const res = await client.get('/ubicaciones', { params: { tipo: 'ruta_autobus', limit: 10 } });
    if (!res.data?.success) {throw new Error('Respuesta success=false');}
  });

  await ejecutarTest('Ubicaciones - filtro bbox dinamico', async () => {
    if (!bboxQuery) {throw new Error('bbox no calculado');}
    const res = await client.get('/ubicaciones', { params: { bbox: bboxQuery, limit: 20 } });
    if (!res.data?.success) {throw new Error('Respuesta success=false');}
  });

  await ejecutarTest('Ubicaciones - puntos medicion acustica', async () => {
    const res = await client.get('/ubicaciones/puntos-medicion/acustica');
    if (!res.data?.success) {throw new Error('Respuesta success=false');}
  });

  await ejecutarTest('Ubicaciones - puntos medicion trafico', async () => {
    const res = await client.get('/ubicaciones/puntos-medicion/trafico');
    if (!res.data?.success) {throw new Error('Respuesta success=false');}
  });

  await ejecutarTest('Ubicaciones - transporte metro', async () => {
    const res = await client.get('/ubicaciones/transporte/metro');
    if (!res.data?.success) {throw new Error('Respuesta success=false');}
  });

  await ejecutarTest('Ubicaciones - transporte todos', async () => {
    const res = await client.get('/ubicaciones/transporte/todos');
    if (!res.data?.success) {throw new Error('Respuesta success=false');}
  });

  await ejecutarTest('Ubicaciones - mapa GeoJSON', async () => {
    const res = await client.get('/ubicaciones/mapa');
    if (!res.data?.success && !res.data?.type) {throw new Error('Respuesta no es FeatureCollection');}
  });

  // 3) CALIDAD DEL AIRE
  await ejecutarTest('CalidadAire - listado base (limit=5)', async () => {
    const res = await client.get('/calidad-aire', { params: { limit: 5 } });
    if (!res.data?.success) {throw new Error('Respuesta success=false');}
    const registros = res.data?.data?.data || res.data?.data;
    if (!Array.isArray(registros) || registros.length === 0) {
      throw new Error('No hay registros de calidad de aire');
    }
    muestraAire = registros[0];
  });

  await ejecutarTest('CalidadAire - filtros fecha+magnitud', async () => {
    const res = await client.get('/calidad-aire', {
      params: {
        startDate: '2051-01-01',
        endDate: '2051-01-15',
        magnitud: muestraAire?.magnitud || 10,
        limit: 5
      }
    });
    if (!res.data?.success) {throw new Error('Respuesta success=false');}
  });

  await ejecutarTest('CalidadAire - paginado y orden', async () => {
    const res = await client.get('/calidad-aire', {
      params: {
        page: 2,
        limit: 5,
        sortBy: 'fecha',
        sortOrder: 'asc'
      }
    });
    if (!res.data?.success) {throw new Error('Respuesta success=false');}
  });

  await ejecutarTest('CalidadAire - estadisticas', async () => {
    const res = await client.get('/calidad-aire/estadisticas', {
      params: {
        startDate: '2051-01-01',
        endDate: '2051-03-31',
        magnitud: muestraAire?.magnitud || 10
      }
    });
    if (!res.data?.success) {throw new Error('Respuesta success=false');}
  });

  await ejecutarTest('CalidadAire - tendencias', async () => {
    const res = await client.get('/calidad-aire/tendencias', {
      params: {
        provincia: muestraAire?.provincia || 28,
        municipio: muestraAire?.municipio || 79,
        magnitud: muestraAire?.magnitud || 10,
        startDate: '2051-06-01',
        endDate: '2051-06-30'
      }
    });
    if (!res.data?.success) {throw new Error('Respuesta success=false');}
  });

  // 4) RUIDO
  await ejecutarTest('Ruido - listado base (limit=5)', async () => {
    const res = await client.get('/ruido', { params: { limit: 5 } });
    if (!res.data?.success) {throw new Error('Respuesta success=false');}
    const registros = res.data?.data?.data || res.data?.data;
    if (!Array.isArray(registros) || registros.length === 0) {
      throw new Error('No hay registros de ruido');
    }
    muestraRuido = registros[0];
  });

  await ejecutarTest('Ruido - filtros año/mes/nmt + orden', async () => {
    const res = await client.get('/ruido', {
      params: {
        año: muestraRuido?.año || 2051,
        mes: muestraRuido?.mes || 6,
        nmt: muestraRuido?.nmt,
        sortBy: 'laeq24',
        sortOrder: 'desc',
        limit: 5
      }
    });
    if (!res.data?.success) {throw new Error('Respuesta success=false');}
  });

  await ejecutarTest('Ruido - estadisticas (groupBy=month)', async () => {
    const res = await client.get('/ruido/estadisticas', {
      params: {
        startDate: '2051-01-01',
        endDate: '2051-12-31',
        groupBy: 'month'
      }
    });
    if (!res.data?.success) {throw new Error('Respuesta success=false');}
  });

  await ejecutarTest('Ruido - ranking nocturno top 5', async () => {
    const res = await client.get('/ruido/ranking', {
      params: {
        startDate: '2051-01-01',
        endDate: '2051-12-31',
        orderBy: 'nocturno',
        limit: 5
      }
    });
    if (!res.data?.success) {throw new Error('Respuesta success=false');}
  });

  await ejecutarTest('Ruido - tendencias temporales', async () => {
    const res = await client.get('/ruido/tendencias/temporal', {
      params: {
        nmt: muestraRuido?.nmt,
        startDate: '2051-01-01',
        endDate: '2051-12-31',
        groupBy: 'month',
        metric: 'laeq24'
      }
    });
    if (!res.data?.success) {throw new Error('Respuesta success=false');}
  });

  await ejecutarTest('Ruido - cumplimiento por zona', async () => {
    const res = await client.get('/ruido/cumplimiento/zona', {
      params: {
        startDate: '2051-01-01',
        endDate: '2051-12-31',
        threshold: 65,
        zoneType: 'residential'
      }
    });
    if (!res.data?.success) {throw new Error('Respuesta success=false');}
  });

  await ejecutarTest('Ruido - mapa GeoJSON', async () => {
    const res = await client.get('/ruido/mapa');
    if (!res.data?.success && !res.data?.type) {throw new Error('Respuesta no es FeatureCollection');}
  });

  // Resumen
  const ok = resultados.filter(r => r.estado === 'OK').length;
  const fail = resultados.filter(r => r.estado === 'FAIL').length;
  const total = resultados.length;

  imprimir('');
  imprimir('=== Resumen ===');
  imprimir(`Total:  ${total}`);
  imprimir(`OK:     ${ok}`);
  imprimir(`FAIL:   ${fail}`);

  if (fail > 0) {
    imprimir('');
    imprimir('Tests fallidos:');
    for (const r of resultados.filter(x => x.estado === 'FAIL')) {
      imprimir(`  - ${r.nombre}: ${r.error}`);
    }
    process.exitCode = 1;
  }
}

main().catch((error) => {
  imprimirError(`Error fatal: ${error.message}`);
  process.exit(1);
});
