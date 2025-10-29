# Scripts de Importación de Datos

Esta carpeta contiene los scripts especializados para importar diferentes tipos de datos // En MongoDB shell
db.accidents.countDocuments()
db.census.countDocuments()
db.fines.countDocuments()
db.traffic.countDocuments()
db.noisemonitoring.countDocuments()
db.locations.countDocuments()
db.airquality.countDocuments()  // Nuevorchivos CSV a la base de datos MongoDB.

## 🚀 Scripts Disponibles

### Scripts Individuales

| Script | Descripción | Tiempo Estimado | Tamaño de Datos |
|--------|-------------|----------------|-----------------|
| `importAccidentData.js` | Datos de accidentalidad | ~3 min | Medio |
| `importCensus.js` | Datos del censo poblacional | ~5 min | Medio |
| `importAirQuality.js` | **Calidad del aire** | ~4 min | **Medio** |
| `importFines.js` | **Multas de tráfico** | ~15 min | **Grande** |
| `importTrafficData.js` | **Datos de tráfico** | ~30 min | **Muy Grande** |
| `importNoise.js` | Contaminación acústica | ~2 min | Pequeño |
| `importLocations.js` | Ubicaciones y puntos | ~2 min | Pequeño |

### Script Maestro

| Script | Descripción | Características |
|--------|-------------|----------------|
| `importAll.js` | **Coordinador maestro** | Ejecuta todos los scripts de forma optimizada |

## 🔧 Características de Optimización

### Scripts Pesados (Multas, Tráfico y Calidad del Aire)
- ✅ **Procesamiento paralelo**: Hasta 3-4 archivos simultáneos
- ✅ **Lotes optimizados**: 1500-5000 registros por lote
- ✅ **Logging minimalista**: Menos mensajes de debug
- ✅ **Manejo robusto de errores**
- ✅ **Cierre seguro de conexiones**
- ✅ **Validación de datos específica** por tipo

### Scripts Ligeros
- ✅ **Procesamiento secuencial optimizado**
- ✅ **Lotes apropiados** para cada tipo de datos
- ✅ **Logging detallado** para seguimiento
- ✅ **Validación de datos completa**

## 📋 Uso Recomendado

### Importación Completa
```bash
# Importar todos los datos (recomendado)
node scripts/importation/importAll.js

# Solo datos ligeros (~16 min)
node scripts/importation/importAll.js --only-light

# Omitir archivos pesados
node scripts/importation/importAll.js --skip-heavy
```

### Importaciones Individuales
```bash
# Datos ligeros primero
node scripts/importation/importLocations.js
node scripts/importation/importAccidentData.js
node scripts/importation/importNoise.js
node scripts/importation/importCensus.js
node scripts/importation/importAirQuality.js

# Datos pesados (requieren más tiempo)
node scripts/importation/importFines.js
node scripts/importation/importTrafficData.js
```

## ⚡ Configuraciones de Rendimiento

### Lotes de Inserción Optimizados
- **Ubicaciones**: 1000 registros/lote
- **Accidentes**: 1000 registros/lote
- **Censo**: 200 registros/lote
- **Ruido**: 50 registros/lote
- **Calidad del Aire**: 1500 registros/lote
- **Multas**: 2000 registros/lote
- **Tráfico**: 5000 registros/lote### Procesamiento Paralelo
- **Calidad del Aire**: 4 archivos simultáneos
- **Multas**: 3 archivos simultáneos
- **Tráfico**: 3 archivos simultáneos
- **Otros**: Procesamiento secuencial

### Intervalos de Logging
- **Archivos pequeños**: Cada 500-1000 filas
- **Archivos medianos**: Cada 50,000 filas
- **Archivos grandes**: Cada 100,000 filas

## 🛡️ Características de Seguridad

### Manejo de Conexiones
- ✅ Conexiones cerradas automáticamente
- ✅ Manejo de errores de red
- ✅ Reintentos en fallos temporales
- ✅ Limpieza de recursos en interrupciones

### Manejo de Datos
- ✅ Validación de datos antes de insertar
- ✅ Detección de duplicados
- ✅ Transformación y normalización
- ✅ Logging de errores detallado

### Gestión de Memoria
- ✅ Procesamiento por lotes
- ✅ Liberación de memoria entre lotes
- ✅ Pausas entre archivos pesados
- ✅ Límites en acumulación de errores

## 📊 Monitoreo y Debug

### Variables de Entorno Recomendadas
```bash
export NODE_OPTIONS="--max-old-space-size=4096"  # Para archivos muy grandes
```

### Logs Importantes
```bash
# Seguir logs en tiempo real
tail -f logs/import.log

# Verificar estado de MongoDB durante importación
mongosh --eval "db.stats()"
```

### Comandos de Verificación Post-Importación
```javascript
// En MongoDB shell
db.accidents.countDocuments()
db.census.countDocuments()
db.fines.countDocuments()
db.traffic.countDocuments()
db.noisemonitoring.countDocuments()
db.locations.countDocuments()
```

## 🔄 Orden de Ejecución Recomendado

1. **Ubicaciones** (2min) - Base para otros datos
2. **Accidentes** (3min) - Datos independientes
3. **Censo** (5min) - Datos independientes
4. **Ruido** (2min) - Datos independientes
5. **Calidad del Aire** (4min) - Datos mediano tamaño
6. **Multas** (15min) - Datos pesados
7. **Tráfico** (30min) - Datos muy pesados

**Tiempo Total Estimado**: ~61 minutos para importación completa## ⚠️ Consideraciones Importantes

- **Espacio en disco**: Asegurar >10GB libres durante importación
- **Memoria RAM**: Recomendado >8GB para archivos pesados
- **Conexión de red**: Estable para MongoDB remoto
- **Tiempo**: Reservar 1 hora para importación completa
- **Interrupción**: Usar Ctrl+C para parada segura

## 🐛 Resolución de Problemas Comunes

### Error de Memoria
```bash
# Aumentar límite de memoria
export NODE_OPTIONS="--max-old-space-size=8192"
```

### Conexión MongoDB
```bash
# Verificar conectividad
mongosh "mongodb://localhost:27017/tu_database"
```

### Archivos Corruptos
```bash
# Validar CSV antes de importar
head -n 10 datos_hpe/archivo.csv
```

### Rendimiento Lento
```bash
# Reducir lotes si hay problemas de memoria
node script.js --batch=1000
```
