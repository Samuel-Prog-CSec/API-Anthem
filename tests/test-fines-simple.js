/**
 * Test simple para verificar las optimizaciones de Multas
 */

const axios = require('axios');

const API_URL = 'http://localhost:3000/api/v0.1';

async function test() {
  try {
    // 1. Crear usuario o hacer login
    console.log('1. Autenticando...');
    let token;

    // Intentar login directamente (el usuario ya existe)
    const loginRes = await axios.post(`${API_URL}/auth/login`, {
      identifier: 'admintest2',
      password: 'Zx9$Qw2!Ty7@Mn3&Vb5*'
    });
    token = loginRes.data.token || loginRes.data.data?.token;
    console.log('✅ Login exitoso');

    if (!token) {
      console.error('❌ No se obtuvo el token');
      process.exit(1);
    }

    console.log(`Token: ${token.substring(0, 20)}...`);

    // Esperar un poco para evitar rate limit
    await new Promise(resolve => setTimeout(resolve, 1000));

    // 2. Test de estadísticas (sin caché)
    console.log('\n2. Probando /fines/statistics (primera vez - sin caché)...');
    const start1 = Date.now();

    const res1 = await axios.get(`${API_URL}/fines/statistics`, {
      params: { groupBy: 'month', limit: 12 },
      headers: { 'Authorization': `Bearer ${token}` }
    });

    const time1 = Date.now() - start1;
    console.log(`✅ Tiempo: ${time1}ms`);
    console.log(`   Cache: ${res1.headers['x-cache-status'] || 'NO-CACHE'}`);
    console.log(`   Datos: ${res1.data.estadisticas?.length || 0} items`);

    // 3. Test de estadísticas (con caché)
    await new Promise(resolve => setTimeout(resolve, 500));

    console.log('\n3. Probando /fines/statistics (segunda vez - con caché)...');
    const start2 = Date.now();

    const res2 = await axios.get(`${API_URL}/fines/statistics`, {
      params: { groupBy: 'month', limit: 12 },
      headers: { 'Authorization': `Bearer ${token}` }
    });

    const time2 = Date.now() - start2;
    console.log(`✅ Tiempo: ${time2}ms`);
    console.log(`   Cache: ${res2.headers['x-cache-status'] || 'NO-CACHE'}`);
    console.log(`   Mejora: ${Math.round(((time1 - time2) / time1) * 100)}%`);

    // 4. Test de ranking
    await new Promise(resolve => setTimeout(resolve, 500));

    console.log('\n4. Probando /fines/locations/ranking...');
    const start3 = Date.now();

    const res3 = await axios.get(`${API_URL}/fines/locations/ranking`, {
      params: { limit: 10 },
      headers: { 'Authorization': `Bearer ${token}` }
    });

    const time3 = Date.now() - start3;
    console.log(`✅ Tiempo: ${time3}ms`);
    console.log(`   Cache: ${res3.headers['x-cache-status'] || 'NO-CACHE'}`);
    console.log(`   Ubicaciones: ${res3.data.ranking?.length || 0}`);

    // 5. Test de análisis temporal
    await new Promise(resolve => setTimeout(resolve, 500));

    console.log('\n5. Probando /fines/analysis/temporal...');
    const start4 = Date.now();

    const res4 = await axios.get(`${API_URL}/fines/analysis/temporal`, {
      params: { tipoAnalisis: 'monthly' },
      headers: { 'Authorization': `Bearer ${token}` }
    });

    const time4 = Date.now() - start4;
    console.log(`✅ Tiempo: ${time4}ms`);
    console.log(`   Cache: ${res4.headers['x-cache-status'] || 'NO-CACHE'}`);
    console.log(`   Periodos: ${res4.data.datos?.length || 0}`);
    console.log(`   Tendencia: ${res4.data.tendencia?.direccion || 'N/A'}`);

    console.log('\n✅ Todas las pruebas completadas exitosamente');
    console.log(`\nTiempos promedio:`);
    console.log(`  Primera llamada (sin caché): ${time1}ms`);
    console.log(`  Segunda llamada (con caché): ${time2}ms`);
    console.log(`  Mejora por caché: ${Math.round(((time1 - time2) / time1) * 100)}%`);

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Data:', JSON.stringify(error.response.data, null, 2));
    }
    process.exit(1);
  }
}

test();
