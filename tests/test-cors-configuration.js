/**
 * Test de configuración CORS
 *
 * Verifica que la configuración CORS funciona correctamente
 * y rechaza origins no autorizados
 */

const axios = require('axios');

const API_BASE_URL = 'http://localhost:3030/api/v0.1';

/**
 * Colores para output en consola
 */
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m'
};

/**
 * Test: Petición desde origin permitido
 */
async function testAllowedOrigin() {
  console.log(`\n${colors.blue}Test 1: Origin permitido${colors.reset}`);

  try {
    const response = await axios.get(`${API_BASE_URL}/health`, {
      headers: {
        'Origin': 'http://localhost:3030'
      }
    });

    const corsHeader = response.headers['access-control-allow-origin'];

    if (corsHeader === 'http://localhost:3030') {
      console.log(`${colors.green}✓ PASS${colors.reset} - Origin permitido correctamente`);
      console.log(`  Access-Control-Allow-Origin: ${corsHeader}`);
      return true;
    }
      console.log(`${colors.red}✗ FAIL${colors.reset} - Header CORS incorrecto`);
      console.log(`  Esperado: http://localhost:3030`);
      console.log(`  Recibido: ${corsHeader}`);
      return false;

  } catch (error) {
    console.log(`${colors.red}✗ FAIL${colors.reset} - Error en petición`);
    console.log(`  ${error.message}`);
    return false;
  }
}

/**
 * Test: Petición desde origin no permitido
 */
async function testBlockedOrigin() {
  console.log(`\n${colors.blue}Test 2: Origin no permitido${colors.reset}`);

  try {
    await axios.get(`${API_BASE_URL}/health`, {
      headers: {
        'Origin': 'http://malicious-site.com'
      },
      validateStatus: () => true // No lanzar error en status no 2xx
    });

    console.log(`${colors.red}✗ FAIL${colors.reset} - Origin no autorizado fue permitido`);
    return false;
  } catch (error) {
    if (error.code === 'ERR_BAD_RESPONSE') {
      console.log(`${colors.green}✓ PASS${colors.reset} - Origin bloqueado correctamente`);
      console.log(`  Origin: http://malicious-site.com rechazado`);
      return true;
    }
      console.log(`${colors.yellow}? WARN${colors.reset} - Error inesperado`);
      console.log(`  ${error.message}`);
      return false;

  }
}

/**
 * Test: Petición preflight (OPTIONS)
 */
async function testPreflightRequest() {
  console.log(`\n${colors.blue}Test 3: Preflight request (OPTIONS)${colors.reset}`);

  try {
    const response = await axios.options(`${API_BASE_URL}/health`, {
      headers: {
        'Origin': 'http://localhost:3030',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type'
      }
    });

    const allowOrigin = response.headers['access-control-allow-origin'];
    const allowMethods = response.headers['access-control-allow-methods'];
    const allowCredentials = response.headers['access-control-allow-credentials'];
    const maxAge = response.headers['access-control-max-age'];

    const checks = [
      { name: 'Allow-Origin', value: allowOrigin, expected: 'http://localhost:3030' },
      { name: 'Allow-Credentials', value: allowCredentials, expected: 'true' },
      { name: 'Max-Age', value: maxAge, expected: '3600' }
    ];

    let allPassed = true;
    checks.forEach(check => {
      if (check.value === check.expected) {
        console.log(`  ${colors.green}✓${colors.reset} ${check.name}: ${check.value}`);
      } else {
        console.log(`  ${colors.red}✗${colors.reset} ${check.name}: ${check.value} (esperado: ${check.expected})`);
        allPassed = false;
      }
    });

    if (allowMethods && allowMethods.includes('POST')) {
      console.log(`  ${colors.green}✓${colors.reset} Allow-Methods incluye POST`);
    } else {
      console.log(`  ${colors.red}✗${colors.reset} Allow-Methods no incluye POST`);
      allPassed = false;
    }

    if (allPassed) {
      console.log(`${colors.green}✓ PASS${colors.reset} - Preflight request configurado correctamente`);
    } else {
      console.log(`${colors.red}✗ FAIL${colors.reset} - Preflight request con errores`);
    }

    return allPassed;
  } catch (error) {
    console.log(`${colors.red}✗ FAIL${colors.reset} - Error en preflight request`);
    console.log(`  ${error.message}`);
    return false;
  }
}

/**
 * Test: Header Vary presente
 */
async function testVaryHeader() {
  console.log(`\n${colors.blue}Test 4: Header Vary${colors.reset}`);

  try {
    const response = await axios.get(`${API_BASE_URL}/health`, {
      headers: {
        'Origin': 'http://localhost:3030'
      }
    });

    const varyHeader = response.headers.vary;

    if (varyHeader && varyHeader.includes('Origin')) {
      console.log(`${colors.green}✓ PASS${colors.reset} - Header Vary configurado correctamente`);
      console.log(`  Vary: ${varyHeader}`);
      return true;
    }
      console.log(`${colors.red}✗ FAIL${colors.reset} - Header Vary faltante o incorrecto`);
      console.log(`  Vary: ${varyHeader || 'no presente'}`);
      return false;

  } catch (error) {
    console.log(`${colors.red}✗ FAIL${colors.reset} - Error al verificar header Vary`);
    console.log(`  ${error.message}`);
    return false;
  }
}

/**
 * Test: Petición sin origin (Postman, cURL)
 */
async function testNoOrigin() {
  console.log(`\n${colors.blue}Test 5: Petición sin origin (development)${colors.reset}`);

  try {
    const response = await axios.get(`${API_BASE_URL}/health`);

    if (response.status === 200) {
      console.log(`${colors.green}✓ PASS${colors.reset} - Petición sin origin permitida en desarrollo`);
      console.log(`  Status: ${response.status}`);
      return true;
    }
      console.log(`${colors.red}✗ FAIL${colors.reset} - Petición sin origin rechazada`);
      console.log(`  Status: ${response.status}`);
      return false;

  } catch (error) {
    console.log(`${colors.red}✗ FAIL${colors.reset} - Error en petición sin origin`);
    console.log(`  ${error.message}`);
    return false;
  }
}

/**
 * Ejecutar todos los tests
 */
async function runAllTests() {
  console.log(`${colors.yellow}==============================================`);
  console.log(`  Tests de Configuración CORS`);
  console.log(`==============================================${colors.reset}`);
  console.log(`API: ${API_BASE_URL}`);

  const results = {
    total: 0,
    passed: 0,
    failed: 0
  };

  const tests = [
    testAllowedOrigin,
    testBlockedOrigin,
    testPreflightRequest,
    testVaryHeader,
    testNoOrigin
  ];

  for (const test of tests) {
    results.total++;
    const passed = await test();
    if (passed) {
      results.passed++;
    } else {
      results.failed++;
    }
  }

  console.log(`\n${colors.yellow}==============================================`);
  console.log(`  Resultados`);
  console.log(`==============================================${colors.reset}`);
  console.log(`Total:   ${results.total}`);
  console.log(`${colors.green}Pasados: ${results.passed}${colors.reset}`);
  console.log(`${colors.red}Fallados: ${results.failed}${colors.reset}`);

  if (results.failed === 0) {
    console.log(`\n${colors.green}✓ Todos los tests pasaron correctamente${colors.reset}\n`);
    process.exit(0);
  } else {
    console.log(`\n${colors.red}✗ Algunos tests fallaron${colors.reset}\n`);
    process.exit(1);
  }
}

// Ejecutar tests
runAllTests().catch(error => {
  console.error(`${colors.red}Error fatal en tests:${colors.reset}`, error);
  process.exit(1);
});
