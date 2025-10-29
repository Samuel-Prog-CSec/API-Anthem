# 🧪 TESTING Y CALIDAD

**Documento:** 09 de 10
**Fecha:** 16 de Octubre de 2025

---

## 📊 CALIFICACIÓN: 5.0/10

**Estado general:** 🔴 NECESITA MEJORA URGENTE

Existen archivos de test básicos pero cobertura insuficiente y sin integración en CI/CD.

---

## 📂 ESTADO ACTUAL DE TESTS

### Archivos de Test Existentes

```
tests/
├── test-all-endpoints.js           # 150 líneas - Tests básicos
├── test-fines-optimizations.js     # 80 líneas - Performance tests
├── test-fines-simple.js            # 60 líneas - Tests simples
├── test-password-validation.js     # 40 líneas - Validación auth
└── test-traffic-optimizations.js   # 75 líneas - Performance tests
```

**Total:** 5 archivos, ~405 líneas de tests

---

## 🔴 PROBLEMA CRÍTICO: Cobertura de Tests Insuficiente

**Severidad:** CRÍTICA
**Impacto:** Calidad, Confiabilidad, Regresiones

### Análisis de Cobertura

| Componente | Archivos | Con Tests | Cobertura Estimada |
|------------|----------|-----------|-------------------|
| **Controllers** | 11 | 2 parcial | **~15%** |
| **Models** | 11 | 0 | **0%** |
| **Middleware** | 5 | 1 parcial | **~10%** |
| **Routes** | 12 | 1 parcial | **~8%** |
| **Utils** | 3 | 0 | **0%** |
| **TOTAL** | **42** | **4 parcial** | **~10%** |

### Desglose por Controller

| Controller | Endpoints | Tests | Cobertura |
|------------|-----------|-------|-----------|
| censusController | 8 | 0 | 0% |
| fineController | 7 | 3 | ~40% |
| trafficController | 8 | 2 | ~25% |
| accidentController | 9 | 0 | 0% |
| airQualityController | 8 | 0 | 0% |
| scooterAssignmentController | 7 | 0 | 0% |
| bikeAvailabilityController | 8 | 0 | 0% |
| bikeCapacityController | 7 | 0 | 0% |
| containerController | 6 | 0 | 0% |
| noiseMonitoringController | 7 | 0 | 0% |
| parkingOccupancyController | 6 | 0 | 0% |
| authController | 6 | 1 | ~15% |
| **TOTAL** | **89** | **6** | **~7%** |

**Conclusión:** Solo 6 de 89 endpoints tienen tests (7%)

---

## 🔴 PROBLEMA: Tests No Ejecutados Automáticamente

**Severidad:** ALTA
**Impacto:** Detección tardía de bugs

### package.json Actual

```json
{
  "scripts": {
    "dev": "nodemon src/server.js",
    "start": "node src/server.js"
    // ❌ Sin script "test"
    // ❌ Sin script "test:coverage"
    // ❌ Sin script "test:watch"
  }
}
```

### Recomendación

```json
{
  "scripts": {
    "dev": "nodemon src/server.js",
    "start": "node src/server.js",
    "test": "jest --verbose",
    "test:watch": "jest --watch",
    "test:coverage": "jest --coverage",
    "test:unit": "jest --testPathPattern=unit",
    "test:integration": "jest --testPathPattern=integration",
    "test:e2e": "jest --testPathPattern=e2e"
  },
  "devDependencies": {
    "jest": "^29.7.0",
    "supertest": "^6.3.3",
    "@types/jest": "^29.5.8"
  }
}
```

---

## 🟡 PROBLEMA: Tests Incompletos y Sin Estructura

**Severidad:** MEDIA

### Análisis de test-all-endpoints.js

```javascript
// ❌ Problemas detectados:

// 1. Sin describe/it structure
console.log('Testing endpoint: GET /api/census/poblacion');
// Debería ser: describe('Census API', () => { it('should...') })

// 2. Sin assertions
const response = await fetch('/api/census/poblacion');
console.log('Response:', response.status);
// Debería ser: expect(response.status).toBe(200)

// 3. Sin cleanup
// No cierra conexiones, no limpia datos de test

// 4. Sin manejo de errores
// Si falla, no se reporta correctamente

// 5. Tests interdependientes
// Un test depende del estado del anterior
```

### Estructura Recomendada

```javascript
// ✅ test/integration/census.test.js
const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../../src/app');
const Census = require('../../src/models/Census');

describe('Census API', () => {
  // Setup antes de todos los tests
  beforeAll(async () => {
    await mongoose.connect(process.env.TEST_DB_URI);
  });

  // Cleanup después de todos los tests
  afterAll(async () => {
    await mongoose.connection.close();
  });

  // Limpiar datos antes de cada test
  beforeEach(async () => {
    await Census.deleteMany({});
  });

  describe('GET /api/censo/poblacion', () => {
    it('debería retornar 200 y array de población', async () => {
      // Arrange
      await Census.create({
        year: 2051,
        distrito: { nombre: 'Centro', codigo: '01' },
        poblacion: { hombres: 5000, mujeres: 5200 }
      });

      // Act
      const response = await request(app)
        .get('/api/censo/poblacion')
        .query({ year: 2051 });

      // Assert
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeInstanceOf(Array);
      expect(response.body.data.length).toBe(1);
    });

    it('debería retornar 400 si year es inválido', async () => {
      const response = await request(app)
        .get('/api/censo/poblacion')
        .query({ year: 'invalid' });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it('debería aplicar filtro de distrito correctamente', async () => {
      // Arrange
      await Census.create([
        {
          year: 2051,
          distrito: { nombre: 'Centro', codigo: '01' },
          poblacion: { hombres: 5000, mujeres: 5200 }
        },
        {
          year: 2051,
          distrito: { nombre: 'Norte', codigo: '02' },
          poblacion: { hombres: 3000, mujeres: 3100 }
        }
      ]);

      // Act
      const response = await request(app)
        .get('/api/censo/poblacion')
        .query({ year: 2051, distrito: 'Centro' });

      // Assert
      expect(response.status).toBe(200);
      expect(response.body.data.length).toBe(1);
      expect(response.body.data[0].distrito.nombre).toBe('Centro');
    });
  });

  describe('GET /api/censo/piramide', () => {
    it('debería retornar pirámide poblacional', async () => {
      // Arrange
      await Census.create({
        year: 2051,
        distrito: { nombre: 'Centro', codigo: '01' },
        edades: {
          '0-4': { hombres: 200, mujeres: 195 },
          '5-9': { hombres: 210, mujeres: 205 }
        }
      });

      // Act
      const response = await request(app)
        .get('/api/censo/piramide')
        .query({ year: 2051 });

      // Assert
      expect(response.status).toBe(200);
      expect(response.body.data).toHaveProperty('gruposEdad');
    });
  });
});
```

---

## 🟡 PROBLEMA: Sin Tests Unitarios de Modelos

**Severidad:** MEDIA

### Tests Faltantes para Model Static Methods

```javascript
// ✅ test/unit/models/Census.test.js
const mongoose = require('mongoose');
const Census = require('../../../src/models/Census');

describe('Census Model', () => {
  beforeAll(async () => {
    await mongoose.connect(process.env.TEST_DB_URI);
  });

  afterAll(async () => {
    await mongoose.connection.close();
  });

  beforeEach(async () => {
    await Census.deleteMany({});
  });

  describe('Static Method: getPoblacionPorDistritoOptimizada', () => {
    it('debería agrupar población por distrito', async () => {
      // Arrange
      await Census.create([
        {
          year: 2051,
          distrito: { nombre: 'Centro', codigo: '01' },
          poblacion: { hombres: 5000, mujeres: 5200 }
        },
        {
          year: 2051,
          distrito: { nombre: 'Centro', codigo: '01' },
          poblacion: { hombres: 4800, mujeres: 5100 }
        },
        {
          year: 2051,
          distrito: { nombre: 'Norte', codigo: '02' },
          poblacion: { hombres: 3000, mujeres: 3100 }
        }
      ]);

      // Act
      const result = await Census.getPoblacionPorDistritoOptimizada(
        { year: 2051 },
        {}
      );

      // Assert
      expect(result).toBeInstanceOf(Array);
      expect(result.length).toBe(2); // 2 distritos

      const centro = result.find(r => r.distrito === 'Centro');
      expect(centro.totalHombres).toBe(9800);
      expect(centro.totalMujeres).toBe(10300);
    });

    it('debería aplicar filtros correctamente', async () => {
      // Arrange
      await Census.create([
        {
          year: 2051,
          distrito: { nombre: 'Centro', codigo: '01' },
          poblacion: { hombres: 5000, mujeres: 5200 }
        },
        {
          year: 2050,
          distrito: { nombre: 'Centro', codigo: '01' },
          poblacion: { hombres: 4900, mujeres: 5100 }
        }
      ]);

      // Act
      const result = await Census.getPoblacionPorDistritoOptimizada(
        { year: 2051 },
        {}
      );

      // Assert
      expect(result.length).toBe(1);
      expect(result[0].year).toBe(2051);
    });
  });

  describe('Schema Validation', () => {
    it('debería rechazar población negativa', async () => {
      const censusBad = new Census({
        year: 2051,
        distrito: { nombre: 'Centro', codigo: '01' },
        poblacion: { hombres: -1000, mujeres: 5200 }
      });

      await expect(censusBad.save()).rejects.toThrow();
    });

    it('debería calcular totalPoblacion en pre-save', async () => {
      const census = await Census.create({
        year: 2051,
        distrito: { nombre: 'Centro', codigo: '01' },
        poblacion: { hombres: 5000, mujeres: 5200 }
      });

      expect(census.totalPoblacion).toBe(10200);
    });
  });

  describe('Indexes', () => {
    it('debería tener índice en year', async () => {
      const indexes = await Census.collection.getIndexes();
      expect(indexes).toHaveProperty('year_1');
    });

    it('debería tener índice compuesto year + distrito', async () => {
      const indexes = await Census.collection.getIndexes();
      expect(indexes).toHaveProperty('year_1_distrito.nombre_1');
    });
  });
});
```

---

## 🟡 PROBLEMA: Sin Tests de Middleware

**Severidad:** MEDIA

### Tests Faltantes

```javascript
// ✅ test/unit/middleware/auth.test.js
const jwt = require('jsonwebtoken');
const { authenticate } = require('../../../src/middleware/auth');
const User = require('../../../src/models/User');

describe('Auth Middleware', () => {
  describe('authenticate', () => {
    it('debería rechazar request sin token', async () => {
      const req = { headers: {} };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };
      const next = jest.fn();

      await authenticate(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: false })
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('debería rechazar token inválido', async () => {
      const req = {
        headers: { authorization: 'Bearer invalid-token' }
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };
      const next = jest.fn();

      await authenticate(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('debería aceptar token válido y adjuntar usuario', async () => {
      // Arrange
      const user = await User.create({
        email: 'test@example.com',
        password: 'Password123!',
        name: 'Test User'
      });

      const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET);

      const req = {
        headers: { authorization: `Bearer ${token}` }
      };
      const res = {};
      const next = jest.fn();

      // Act
      await authenticate(req, res, next);

      // Assert
      expect(next).toHaveBeenCalled();
      expect(req.user).toBeDefined();
      expect(req.user.email).toBe('test@example.com');
      expect(req.user.password).toBeUndefined(); // Excluido
    });
  });
});
```

---

## 🟢 PROBLEMA MENOR: Sin Tests E2E

**Severidad:** BAJA
**Impacto:** Flujos completos no verificados

### Tests E2E Recomendados

```javascript
// ✅ test/e2e/accident-analysis-flow.test.js
const request = require('supertest');
const app = require('../../src/app');

describe('E2E: Accident Analysis Flow', () => {
  let authToken;

  beforeAll(async () => {
    // Login
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'admin@example.com',
        password: 'Admin123!'
      });

    authToken = loginRes.body.token;
  });

  it('debería completar flujo completo de análisis de accidentes', async () => {
    // 1. Obtener lista de distritos
    const distritosRes = await request(app)
      .get('/api/distritos')
      .set('Authorization', `Bearer ${authToken}`);

    expect(distritosRes.status).toBe(200);
    const distrito = distritosRes.body.data[0];

    // 2. Obtener accidentes del distrito
    const accidentsRes = await request(app)
      .get('/api/accidents')
      .query({ distrito: distrito.nombre })
      .set('Authorization', `Bearer ${authToken}`);

    expect(accidentsRes.status).toBe(200);
    expect(accidentsRes.body.data.length).toBeGreaterThan(0);

    // 3. Obtener estadísticas
    const statsRes = await request(app)
      .get('/api/accidents/stats')
      .query({ distrito: distrito.nombre })
      .set('Authorization', `Bearer ${authToken}`);

    expect(statsRes.status).toBe(200);
    expect(statsRes.body.data).toHaveProperty('total');

    // 4. Obtener heatmap
    const heatmapRes = await request(app)
      .get('/api/accidents/heatmap')
      .query({ distrito: distrito.nombre })
      .set('Authorization', `Bearer ${authToken}`);

    expect(heatmapRes.status).toBe(200);
    expect(heatmapRes.body.data).toBeInstanceOf(Array);
  });
});
```

---

## 📋 PLAN DE IMPLEMENTACIÓN DE TESTS

### Fase 1: Setup (Sprint 2) - 4 horas

**Tareas:**
1. Instalar Jest y Supertest
2. Configurar jest.config.js
3. Crear base de datos de test
4. Configurar scripts en package.json
5. Crear helpers de test (factories, mocks)

```javascript
// jest.config.js
module.exports = {
  testEnvironment: 'node',
  coverageDirectory: 'coverage',
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/server.js',
    '!src/config/**'
  ],
  testMatch: [
    '**/test/**/*.test.js'
  ],
  setupFilesAfterEnv: ['<rootDir>/test/setup.js'],
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 70,
      lines: 70,
      statements: 70
    }
  }
};

// test/setup.js
const mongoose = require('mongoose');

beforeAll(async () => {
  await mongoose.connect(process.env.TEST_DB_URI);
});

afterAll(async () => {
  await mongoose.connection.close();
});
```

---

### Fase 2: Tests Críticos (Sprint 2-3) - 20 horas

**Prioridad ALTA:**

1. **Auth Tests** (3h)
   - Login/Logout
   - Token validation
   - Password reset

2. **Census Tests** (4h)
   - 8 endpoints
   - Model static methods

3. **Fine Tests** (4h)
   - 7 endpoints
   - Validaciones

4. **Traffic Tests** (4h)
   - 8 endpoints
   - Agregaciones

5. **Middleware Tests** (3h)
   - authenticate
   - errorHandler
   - security

6. **Model Tests** (2h)
   - Validaciones
   - Pre-save hooks
   - Índices

---

### Fase 3: Tests Completos (Sprint 3-4) - 30 horas

**Prioridad MEDIA:**

7. **Accident Tests** (5h)
8. **AirQuality Tests** (5h)
9. **ScooterAssignment Tests** (4h)
10. **BikeAvailability Tests** (4h)
11. **NoiseMonitoring Tests** (4h)
12. **Otros Controllers** (8h)

---

### Fase 4: Tests E2E + Refinamiento (Sprint 4) - 10 horas

13. **E2E Tests** (6h)
    - Flujo de autenticación completo
    - Flujo de análisis de datos
    - Flujo de reportes

14. **Performance Tests** (2h)
    - Endpoints optimizados
    - Caché funcionando

15. **Refinamiento** (2h)
    - Alcanzar 70% coverage
    - Fix flaky tests

---

## 📊 RESUMEN

| Fase | Descripción | Esfuerzo | Prioridad |
|------|-------------|----------|-----------|
| 1 | Setup Jest + Infraestructura | 4h | 🔴 Crítica |
| 2 | Tests críticos (Auth, Census, Fine, Traffic) | 20h | 🔴 Alta |
| 3 | Tests completos (resto controllers + models) | 30h | 🟡 Media |
| 4 | E2E + Refinamiento | 10h | 🔵 Baja |
| **TOTAL** | - | **64h** | - |

---

## 🎯 OBJETIVOS DE COBERTURA

### Actual
```
Cobertura total: ~10%
Controllers: ~7% (6/89 endpoints)
Models: 0%
Middleware: ~10%
```

### Objetivo Sprint 2
```
Cobertura total: ~40%
Controllers críticos: 80% (Census, Fine, Traffic, Auth)
Middleware: 70%
```

### Objetivo Sprint 4
```
Cobertura total: 70%+
Controllers: 70%+ todos
Models: 80%+
Middleware: 90%+
E2E: 5+ flujos completos
```

---

## ✅ BENEFICIOS ESPERADOS

### Calidad
- **Detección temprana de bugs:** -80% bugs en producción
- **Regresiones:** Prevención automática
- **Confianza en refactorización:** Seguridad al cambiar código

### Desarrollo
- **Documentación viva:** Tests como ejemplos de uso
- **Onboarding:** Nuevos devs entienden comportamiento
- **Velocidad:** Menos debugging manual

### CI/CD
- **Automatización:** Tests en cada commit
- **Deployment seguro:** No deploy si tests fallan
- **Métricas:** Coverage tracking en cada PR
