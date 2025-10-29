/**
 * Test simple para verificar las optimizaciones de Traffic
 */

const axios = require('axios');

const API_URL = 'http://localhost:3000/api/v0.1';

async function test() {
  try {
    console.log('🚦 TEST DE OPTIMIZACIONES - TRAFFIC CONTROLLER\n');

    // 1. Autenticar
    console.log('1. Autenticando...');
    const loginRes = await axios.post(`${API_URL}/auth/login`, {
      identifier: 'admintest2',
      password: 'Zx9$Qw2!Ty7@Mn3&Vb5*'
    });
    const token = loginRes.data.token || loginRes.data.data?.token;
    console.log('✅ Login exitoso\n');

    await new Promise(resolve => setTimeout(resolve, 1000));

    // 2. Test de estadísticas (sin caché)
    console.log('2. Probando /traffic/stats (primera vez - sin caché)...');
    const start1 = Date.now();

    const res1 = await axios.get(`${API_URL}/traffic/stats`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    const time1 = Date.now() - start1;
    console.log(`✅ Tiempo: ${time1}ms`);
    console.log(`   Cache: ${res1.headers['x-cache-status'] || 'NO-CACHE'}`);
    console.log(`   Resumen presente: ${res1.data.data?.resumen ? 'Sí' : 'No'}`);

    // 3. Test de estadísticas (con caché)
    await new Promise(resolve => setTimeout(resolve, 500));

    console.log('\n3. Probando /traffic/stats (segunda vez - con caché)...');
    const start2 = Date.now();

    const res2 = await axios.get(`${API_URL}/traffic/stats`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    const time2 = Date.now() - start2;
    console.log(`✅ Tiempo: ${time2}ms`);
    console.log(`   Cache: ${res2.headers['x-cache-status'] || 'NO-CACHE'}`);
    const improvement = Math.round(((time1 - time2) / time1) * 100);
    console.log(`   Mejora: ${improvement}%`);

    // 4. Test de análisis de congestión
    await new Promise(resolve => setTimeout(resolve, 500));

    console.log('\n4. Probando /traffic/congestion-analysis...');
    const start3 = Date.now();

    const res3 = await axios.get(`${API_URL}/traffic/congestion-analysis`, {
      params: { groupBy: 'tipoElemento' },
      headers: { 'Authorization': `Bearer ${token}` }
    });

    const time3 = Date.now() - start3;
    console.log(`✅ Tiempo: ${time3}ms`);
    console.log(`   Cache: ${res3.headers['x-cache-status'] || 'NO-CACHE'}`);
    console.log(`   Análisis encontrados: ${res3.data.data?.analisis?.length || 0}`);

    // 5. Test de datos históricos
    await new Promise(resolve => setTimeout(resolve, 500));

    console.log('\n5. Probando /traffic/historical...');
    const start4 = Date.now();

    const res4 = await axios.get(`${API_URL}/traffic/historical`, {
      params: { aggregation: 'day' },
      headers: { 'Authorization': `Bearer ${token}` }
    });

    const time4 = Date.now() - start4;
    console.log(`✅ Tiempo: ${time4}ms`);
    console.log(`   Cache: ${res4.headers['x-cache-status'] || 'NO-CACHE'}`);
    console.log(`   Periodos: ${res4.data.data?.serie?.length || 0}`);

    console.log('\n✅ TODAS LAS PRUEBAS COMPLETADAS EXITOSAMENTE');
    console.log(`\n📊 Resumen de Tiempos:`);
    console.log(`  Primera llamada (sin caché): ${time1}ms`);
    console.log(`  Segunda llamada (con caché): ${time2}ms`);
    console.log(`  Mejora por caché: ${improvement}%`);

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
