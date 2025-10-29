/**
 * Test de Protección contra XSS
 *
 * Verifica que el middleware XSS está funcionando correctamente
 * y que los inputs maliciosos son sanitizados.
 *
 * @author Senior Developer
 * @date 2025-10-22
 */

const axios = require('axios');

const BASE_URL = 'http://localhost:3000';
const API_URL = `${BASE_URL}/api/v1`;

// Payloads XSS comunes para testing
const XSS_PAYLOADS = [
  '<script>alert("XSS")</script>',
  '<img src=x onerror=alert("XSS")>',
  '<svg onload=alert("XSS")>',
  'javascript:alert("XSS")',
  '<iframe src="javascript:alert(\'XSS\')">',
  '<body onload=alert("XSS")>',
  '"><script>alert(String.fromCharCode(88,83,83))</script>',
  '<IMG SRC="jav&#x09;ascript:alert(\'XSS\');">',
];

/**
 * Test 1: Verificar que el servidor responde
 */
async function testServerHealth() {
  console.log('\n🔍 TEST 1: Verificando servidor...');
  try {
    const response = await axios.get(`${BASE_URL}/health`);
    if (response.status === 200) {
      console.log('✅ Servidor OK');
      return true;
    }
  } catch (error) {
    console.error('❌ Servidor no disponible:', error.message);
    return false;
  }
}

/**
 * Test 2: Verificar protección XSS en query params
 */
async function testXSSInQueryParams() {
  console.log('\n🔍 TEST 2: Protección XSS en query params...');
  let passed = 0;
  let failed = 0;

  for (const payload of XSS_PAYLOADS) {
    try {
      const url = `${BASE_URL}/health?test=${encodeURIComponent(payload)}`;
      const response = await axios.get(url);

      const responseString = JSON.stringify(response.data);

      // Verificar si el payload aparece sin sanitizar
      if (responseString.includes('<script>') ||
          responseString.includes('onerror=') ||
          responseString.includes('onload=')) {
        console.log(`   ❌ VULNERABLE - Payload no sanitizado: ${payload.substring(0, 30)}...`);
        failed++;
      } else {
        console.log(`   ✅ Protegido: ${payload.substring(0, 30)}...`);
        passed++;
      }
    } catch (error) {
      console.log(`   ⚠️  Error: ${error.response?.status || error.message}`);
    }
  }

  console.log(`\n   Resultado: ${passed} protegidos, ${failed} vulnerables`);
  return failed === 0;
}

/**
 * Test 3: Verificar protección XSS en body (POST request)
 */
async function testXSSInBody() {
  console.log('\n🔍 TEST 3: Protección XSS en request body...');
  let passed = 0;
  let failed = 0;

  for (const payload of XSS_PAYLOADS) {
    try {
      // Intentar registrar usuario con payload XSS
      const response = await axios.post(`${API_URL}/auth/register`, {
        username: payload,
        email: 'test@example.com',
        password: 'Test123!@#'
      });

      const responseString = JSON.stringify(response.data);

      if (responseString.includes('<script>') ||
          responseString.includes('onerror=') ||
          responseString.includes('onload=')) {
        console.log(`   ❌ VULNERABLE - Payload en body no sanitizado: ${payload.substring(0, 30)}...`);
        failed++;
      } else {
        console.log(`   ✅ Protegido: ${payload.substring(0, 30)}...`);
        passed++;
      }
    } catch (error) {
      // Errores de validación son esperados
      if (error.response?.status === 400) {
        console.log(`   ✅ Validación rechazó input: ${payload.substring(0, 30)}...`);
        passed++;
      } else {
        console.log(`   ⚠️  Error inesperado: ${error.response?.status || error.message}`);
      }
    }
  }

  console.log(`\n   Resultado: ${passed} protegidos, ${failed} vulnerables`);
  return failed === 0;
}

/**
 * Test 4: Verificar que inputs legítimos funcionan
 */
async function testLegitimateInputs() {
  console.log('\n🔍 TEST 4: Verificando inputs legítimos...');

  const legitimateInputs = [
    'John Doe',
    'user@example.com',
    'Test-123',
    'María José',
    'O\'Connor'
  ];

  let passed = 0;

  for (const input of legitimateInputs) {
    try {
      const response = await axios.get(`${BASE_URL}/health?name=${encodeURIComponent(input)}`);

      if (response.status === 200) {
        console.log(`   ✅ Input legítimo aceptado: ${input}`);
        passed++;
      }
    } catch (error) {
      console.log(`   ❌ Input legítimo rechazado: ${input}`);
    }
  }

  console.log(`\n   Resultado: ${passed}/${legitimateInputs.length} aceptados`);
  return passed === legitimateInputs.length;
}

/**
 * Ejecutar todos los tests
 */
async function runAllTests() {
  console.log('╔═══════════════════════════════════════════════════════╗');
  console.log('║  TEST DE PROTECCIÓN XSS - API REST                    ║');
  console.log('╚═══════════════════════════════════════════════════════╝');

  // Verificar que el servidor esté corriendo
  const serverOk = await testServerHealth();
  if (!serverOk) {
    console.error('\n❌ No se puede continuar sin servidor activo');
    console.log('\n💡 Ejecuta: npm run dev');
    process.exit(1);
  }

  // Ejecutar tests
  const test2 = await testXSSInQueryParams();
  const test3 = await testXSSInBody();
  const test4 = await testLegitimateInputs();

  // Resumen final
  console.log('\n╔═══════════════════════════════════════════════════════╗');
  console.log('║  RESUMEN DE TESTS                                     ║');
  console.log('╚═══════════════════════════════════════════════════════╝');
  console.log(`   Test 1 (Servidor):          ${serverOk ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`   Test 2 (XSS Query Params):  ${test2 ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`   Test 3 (XSS Body):          ${test3 ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`   Test 4 (Inputs Legítimos):  ${test4 ? '✅ PASS' : '❌ FAIL'}`);

  const allPassed = serverOk && test2 && test3 && test4;

  if (allPassed) {
    console.log('\n🎉 TODOS LOS TESTS PASARON - API PROTEGIDA CONTRA XSS');
    console.log('✅ La protección XSS está funcionando correctamente\n');
    process.exit(0);
  } else {
    console.log('\n⚠️  ALGUNOS TESTS FALLARON - REVISAR CONFIGURACIÓN');
    console.log('❌ Verificar middleware XSS en src/middleware/security.js');
    console.log('❌ Verificar que xssProtection esté aplicado en src/server.js\n');
    process.exit(1);
  }
}

// Ejecutar tests
runAllTests().catch(error => {
  console.error('\n❌ Error fatal en tests:', error.message);
  process.exit(1);
});
