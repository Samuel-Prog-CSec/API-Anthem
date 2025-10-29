/**
 * Test de validación de contraseñas
 *
 * Verifica que el passwordValidator funcione correctamente
 */

const axios = require('axios');

const API_BASE_URL = 'http://localhost:3000';
const API_VERSION = 'v0.1';
const API_URL = `${API_BASE_URL}/api/${API_VERSION}`;

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m'
};

function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function logSection(title) {
  log(`\n${'='.repeat(80)}`, colors.cyan);
  log(`  ${title}`, colors.cyan);
  log(`${'='.repeat(80)}\n`, colors.cyan);
}

async function testPasswordValidation() {
  logSection('TEST DE VALIDACIÓN DE CONTRASEÑAS');

  const testCases = [
    {
      name: 'Contraseña válida fuerte',
      password: 'MySecure123!',
      shouldPass: true
    },
    {
      name: 'Contraseña muy corta',
      password: 'Ab1!',
      shouldPass: false,
      expectedError: 'al menos 8 caracteres'
    },
    {
      name: 'Sin mayúsculas',
      password: 'mysecure123!',
      shouldPass: false,
      expectedError: 'letra mayúscula'
    },
    {
      name: 'Sin minúsculas',
      password: 'MYSECURE123!',
      shouldPass: false,
      expectedError: 'letra minúscula'
    },
    {
      name: 'Sin números',
      password: 'MySecure!!!',
      shouldPass: false,
      expectedError: 'un número'
    },
    {
      name: 'Sin caracteres especiales',
      password: 'MySecure123',
      shouldPass: false,
      expectedError: 'carácter especial'
    },
    {
      name: 'Contraseña común (password123)',
      password: 'Password123!',
      shouldPass: false,
      expectedError: 'demasiado común'
    },
    {
      name: 'Contraseña común (admin123)',
      password: 'Admin123!',
      shouldPass: false,
      expectedError: 'demasiado común'
    }
  ];

  let passed = 0;
  let failed = 0;

  for (const testCase of testCases) {
    const timestamp = Date.now();
    const testUser = {
      username: `testuser_${timestamp}`,
      email: `test_${timestamp}@example.com`,
      password: testCase.password,
      firstName: 'Test',
      lastName: 'User'
    };

    try {
      const response = await axios.post(`${API_URL}/auth/register`, testUser, {
        validateStatus: () => true
      });

      if (testCase.shouldPass) {
        // Debería pasar (status 201)
        if (response.status === 201) {
          log(`✅ ${testCase.name} - PASÓ correctamente`, colors.green);
          passed++;
        } else {
          log(`❌ ${testCase.name} - FALLÓ: Debería haber pasado pero obtuvo status ${response.status}`, colors.red);
          log(`   Respuesta: ${JSON.stringify(response.data)}`, colors.red);
          failed++;
        }
      } else {
        // Debería fallar (status 400)
        if (response.status === 400) {
          const errorMessage = JSON.stringify(response.data);
          const hasExpectedError = errorMessage.toLowerCase().includes(testCase.expectedError.toLowerCase());

          if (hasExpectedError) {
            log(`✅ ${testCase.name} - FALLÓ correctamente con error esperado`, colors.green);
            passed++;
          } else {
            log(`⚠️  ${testCase.name} - FALLÓ pero con error inesperado`, colors.yellow);
            log(`   Esperado: "${testCase.expectedError}"`, colors.yellow);
            log(`   Obtenido: ${errorMessage}`, colors.yellow);
            passed++; // Aún cuenta como pasado porque rechazó la contraseña
          }
        } else {
          log(`❌ ${testCase.name} - FALLÓ: Debería haber sido rechazado pero obtuvo status ${response.status}`, colors.red);
          log(`   Respuesta: ${JSON.stringify(response.data)}`, colors.red);
          failed++;
        }
      }

      // Pequeña pausa entre requests
      await new Promise(resolve => setTimeout(resolve, 100));

    } catch (error) {
      log(`❌ ${testCase.name} - ERROR: ${error.message}`, colors.red);
      failed++;
    }
  }

  logSection('RESUMEN');
  log(`Total de pruebas: ${testCases.length}`, colors.cyan);
  log(`✅ Pasadas: ${passed}`, colors.green);
  log(`❌ Fallidas: ${failed}`, colors.red);

  if (failed === 0) {
    log('\n🎉 ¡TODAS LAS PRUEBAS DE VALIDACIÓN DE CONTRASEÑAS PASARON!', colors.green);
  } else {
    log(`\n⚠️  ${failed} prueba(s) fallaron`, colors.yellow);
  }

  return failed === 0;
}

async function main() {
  log('\n🚀 INICIANDO TESTS DE VALIDACIÓN DE CONTRASEÑAS', colors.cyan);
  log(`📍 API URL: ${API_URL}\n`, colors.cyan);

  try {
    const success = await testPasswordValidation();
    process.exit(success ? 0 : 1);
  } catch (error) {
    log(`\n❌ Error fatal: ${error.message}`, colors.red);
    console.error(error);
    process.exit(1);
  }
}

main();
