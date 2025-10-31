# Guía de ESLint - API REST Anthem

## Introducción

Este proyecto utiliza ESLint 9 con configuración moderna (flat config) para mantener la calidad y consistencia del código. La configuración está optimizada para proyectos Node.js con Express, MongoDB y JavaScript moderno.

## Configuración Actual

### Archivo de configuración: `eslint.config.mjs`

La configuración está dividida en múltiples bloques:

1. **Configuración general** - Reglas para todos los archivos `.js`
2. **Scripts** - Reglas más permisivas para archivos en `scripts/`
3. **Tests** - Configuración específica para archivos de test
4. **Ignores** - Archivos y directorios excluidos del linting

## Comandos Disponibles

```bash
# Lint completo del proyecto
npm run lint

# Auto-fix de problemas que se pueden corregir automáticamente
npm run lint:fix

# Lint solo del código fuente
npm run lint:src

# Lint solo de los scripts
npm run lint:scripts

# Generar reporte HTML
npm run lint:report

# Generar reporte JSON (útil para CI/CD)
npm run lint:report:json
```

## Reglas Principales

### Errores que Bloquean (Error)

- **no-undef**: Variables sin declarar
- **curly**: Siempre usar llaves en estructuras de control
- **eqeqeq**: Usar `===` y `!==` en lugar de `==` y `!=`
- **no-var**: No usar `var`, usar `let` o `const`
- **no-eval**: Prohibido usar `eval()`
- **semi**: Siempre usar punto y coma

### Advertencias (Warning)

- **no-console**: Usar Pino logger en lugar de `console.log/error/warn`
- **no-unused-vars**: Variables declaradas pero no utilizadas
- **prefer-const**: Usar `const` cuando la variable no se reasigna
- **require-await**: Funciones `async` deben contener `await`
- **complexity**: Complejidad ciclomática máxima de 20
- **max-depth**: Máximo 4 niveles de anidamiento
- **max-lines-per-function**: Máximo 150 líneas por función

## Convenciones de Variables No Usadas

Puedes prefijar variables no usadas con `_` para evitar warnings:

```javascript
// ❌ Genera warning
app.use((err, req, res, next) => {
  res.status(500).json({ error: err.message });
});

// ✅ Sin warning
app.use((err, req, res, _next) => {
  res.status(500).json({ error: err.message });
});
```

## Buenas Prácticas Específicas del Proyecto

### 1. Uso de Logger (No Console)

```javascript
// ❌ Incorrecto
console.log('Usuario creado:', user);
console.error('Error:', error);

// ✅ Correcto
const logger = require('./config/logger');
logger.info({ user }, 'Usuario creado');
logger.error({ error }, 'Error al crear usuario');
```

### 2. Siempre Usar Llaves en Estructuras de Control

```javascript
// ❌ Incorrecto
if (condition) return true;

// ✅ Correcto
if (condition) {
  return true;
}
```

### 3. Comparaciones Estrictas

```javascript
// ❌ Incorrecto
if (value == null) { }

// ✅ Correcto
if (value === null || value === undefined) { }
// O también aceptable para null checks:
if (value == null) { } // Permitido solo con null
```

### 4. Async/Await Best Practices

```javascript
// ❌ Incorrecto - async innecesario
async function getData() {
  return data;
}

// ✅ Correcto
async function getData() {
  return await fetchFromDB();
}

// O mejor aún, si no necesitas await:
function getData() {
  return fetchFromDB();
}
```

### 5. Evitar Complejidad Excesiva

Si una función supera 20 de complejidad ciclomática o 150 líneas, considera:

1. Dividirla en funciones más pequeñas
2. Extraer lógica a métodos estáticos del modelo
3. Usar helpers/utils

```javascript
// ❌ Muy complejo (simplificado)
function processData(data) {
  if (data.type === 'A') {
    if (data.status === 'active') {
      // 50 líneas más...
    } else if (data.status === 'pending') {
      // 50 líneas más...
    }
  } else if (data.type === 'B') {
    // 50 líneas más...
  }
}

// ✅ Mejor
function processData(data) {
  if (data.type === 'A') {
    return processTypeA(data);
  }
  if (data.type === 'B') {
    return processTypeB(data);
  }
  throw new Error('Unknown type');
}
```

## Integración con VS Code

### Extensión Recomendada

Instala la extensión oficial de ESLint:
- **dbaeumer.vscode-eslint**

### Configuración Workspace (settings.json)

```json
{
  "eslint.enable": true,
  "eslint.validate": ["javascript"],
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": true
  },
  "eslint.format.enable": true
}
```

## Pre-commit Hooks (Futuro)

Se recomienda configurar Husky + lint-staged para ejecutar ESLint automáticamente antes de cada commit:

```bash
# Instalar dependencias
npm install --save-dev husky lint-staged

# Configurar husky
npx husky init
```

## Problemas Comunes y Soluciones

### 1. "Unexpected console statement"

**Solución**: Usar el logger de Pino en lugar de console.

### 2. "Expected { after 'if' condition"

**Solución**: Agregar llaves a todas las estructuras de control.

```javascript
// Antes
if (x) return;

// Después
if (x) {
  return;
}
```

### 3. "'variable' is assigned a value but never used"

**Solución**:
- Eliminar la variable si no se usa
- Prefija con `_` si es intencional
- Usar destructuring con rest para ignorar valores

```javascript
// Si no necesitas 'status' en la destructuración
const { name, _status } = user;

// O usa rest operator
const { name, ...rest } = user;
```

## Excepciones Permitidas

### Scripts de Importación
- `no-console` está desactivado
- Mayor complejidad permitida (30)
- Funciones más largas permitidas (250 líneas)

### Tests
- `no-console` desactivado
- Sin límite de líneas por función
- Expresiones no usadas permitidas (para expects)

## Métricas de Calidad

Objetivo del proyecto:
- ✅ **0 errores** en el código fuente (`src/`)
- ⚠️ **Mínimas warnings** (idealmente < 10)
- 📊 **Complejidad media < 10** por función
- 📏 **Funciones < 100 líneas** en promedio

## Recursos Adicionales

- [Documentación oficial de ESLint 9](https://eslint.org/docs/latest/)
- [Flat Config Migration Guide](https://eslint.org/docs/latest/use/configure/migration-guide)
- [ESLint Rules Reference](https://eslint.org/docs/latest/rules/)

## Mantenimiento

Esta configuración debe revisarse:
- Cada vez que se actualice ESLint a una versión mayor
- Al agregar nuevas dependencias que requieran reglas específicas
- Cuando el equipo identifique nuevos patrones problemáticos
- Trimestralmente para ajustar reglas según el crecimiento del proyecto

---

**Última actualización**: Octubre 2025
**Versión ESLint**: 9.37.0
**Configuración**: Flat Config (eslint.config.mjs)
