/**
 * Script de Auditoría Exhaustiva CSV vs Constantes
 *
 * Analiza TODOS los CSV del dataset, extrae valores únicos de todas las columnas,
 * y los compara con las constantes definidas en src/constants/index.js
 *
 * Manejo robusto de:
 * - Encoding UTF-8 con tildes y ñ
 * - CSV con delimitador punto y coma (;)
 * - Agregación de múltiples CSV del mismo tipo (Aire, Censo, Multas, Tráfico)
 * - Detección automática de constantes relacionadas
 *
 * Uso: node scripts/audit-csv-constants.js
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

// Importar constantes
const constants = require('../src/constants/index.js');

// Configuración
const DATOS_DIR = path.join(__dirname, '..', 'datos_hpe');
const OUTPUT_FILE = path.join(__dirname, '..', 'docs', 'CSV_CONSTANTS_AUDIT.md');
const CSV_DELIMITER = ';';

/**
 * Mapeo de CSV a modelos según dataset_information.md
 */
const CSV_MAPPING = {
  // Calidad del aire (12 archivos mensuales)
  AIR_QUALITY: {
    folder: 'Aire',
    pattern: 'Anthem_CTC_Aire_',
    model: 'AirQuality',
    description: 'Calidad del aire - Mediciones horarias por estación',
    aggregateAll: true
  },

  // Contaminación acústica
  NOISE_MONITORING: {
    files: ['Anthem_CTC_ContaminacionAcustica.csv'],
    model: 'NoiseMonitoring',
    description: 'Contaminación acústica - Niveles de ruido por estación'
  },

  // Multas (12 archivos mensuales)
  FINES: {
    folder: 'Multas',
    pattern: 'Anthem_CTC_Multas_',
    model: 'Fine',
    description: 'Multas de tráfico - Infracciones y sanciones',
    aggregateAll: true
  },

  // Censo (12 archivos mensuales)
  CENSUS: {
    folder: 'Censo',
    pattern: 'Anthem_CTC_Censo',
    model: 'Census',
    description: 'Censo poblacional - Distribución demográfica por distrito/barrio',
    aggregateAll: true
  },

  // Tráfico (múltiples archivos en Trafico/)
  TRAFFIC: {
    folder: 'Trafico',
    pattern: 'Anthem_CTC_Traffic_',
    model: 'Traffic',
    description: 'Tráfico en tiempo real - Intensidad, ocupación, carga',
    aggregateAll: true
  },

  // Accidentalidad
  ACCIDENTS: {
    files: ['Anthem_CTC_Accidentalidad.csv'],
    model: 'Accident',
    description: 'Accidentalidad vial - Detalles de accidentes de tráfico'
  },

  // Asignación de patinetes
  SCOOTERS: {
    files: ['Anthem_CTC_AsignaciónPatinetes.csv'],
    model: 'ScooterAssignment',
    description: 'Patinetes eléctricos - Distribución por distrito y proveedor'
  },

  // Disponibilidad de bicicletas
  BIKES: {
    files: ['Anthem_CTC_Bicicletas_Disponibilidad.csv'],
    model: 'BikeAvailability',
    description: 'Bicicletas eléctricas - Disponibilidad y usos diarios'
  },

  // Contenedores
  CONTAINERS: {
    files: ['Anthem_CTC_Contenedores_Ubicacion.csv'],
    model: 'Container',
    description: 'Contenedores de residuos - Ubicación y tipología'
  },

  // Ubicaciones - Puntos de medida de tráfico
  LOCATIONS_TRAFFIC: {
    files: ['Ubicaciones/Anthem_CTC_PuntoMedidaTrafico.csv'],
    model: 'Location',
    description: 'Ubicaciones - Puntos de medida de tráfico',
    subtype: 'punto_trafico'
  },

  // Ubicaciones - Estaciones de medida acústica
  LOCATIONS_NOISE: {
    files: ['Ubicaciones/Anthem_CTC_EstacionesMedidaControlAcustico.csv'],
    model: 'Location',
    description: 'Ubicaciones - Estaciones de medida de contaminación acústica',
    subtype: 'estacion_acustica'
  }

  // NOTA: GPX files (Cercanias, Autobus, etc.) no se procesan en este script
  // ya que son archivos XML con rutas geográficas, no tablas de datos
};

/**
 * Mapeo de nombres de columnas CSV a constantes en index.js
 * Permite buscar constantes relacionadas automáticamente
 */
const COLUMN_TO_CONSTANT_MAPPING = {
  // Accidentes
  'tipo_accidente': ['ACCIDENT_TYPES'],
  'tipo_vehiculo': ['VEHICLE_TYPES'],
  'tipo_persona': ['PERSON_TYPES'],
  'estado_meteorologico': ['WEATHER_CONDITIONS'],
  'estado_meteorológico': ['WEATHER_CONDITIONS'],
  'lesividad': ['INJURY_TYPES'],
  'sexo': ['GENDERS'],
  'rango_edad': ['AGE_GROUPS'],
  'positiva_alcohol': ['BINARY_INDICATORS'],
  'positiva_droga': ['BINARY_INDICATORS'],

  // Calidad del aire
  'magnitud': ['MAGNITUDES_PERMITIDAS', 'AIR_QUALITY_MAGNITUDES'],
  'v01': ['VALIDATION_CODES'],
  'v02': ['VALIDATION_CODES'],
  'v03': ['VALIDATION_CODES'],
  'v04': ['VALIDATION_CODES'],
  'v05': ['VALIDATION_CODES'],
  'v06': ['VALIDATION_CODES'],
  'v07': ['VALIDATION_CODES'],
  'v08': ['VALIDATION_CODES'],
  'v09': ['VALIDATION_CODES'],
  'v10': ['VALIDATION_CODES'],
  'v11': ['VALIDATION_CODES'],
  'v12': ['VALIDATION_CODES'],
  'v13': ['VALIDATION_CODES'],
  'v14': ['VALIDATION_CODES'],
  'v15': ['VALIDATION_CODES'],
  'v16': ['VALIDATION_CODES'],
  'v17': ['VALIDATION_CODES'],
  'v18': ['VALIDATION_CODES'],
  'v19': ['VALIDATION_CODES'],
  'v20': ['VALIDATION_CODES'],
  'v21': ['VALIDATION_CODES'],
  'v22': ['VALIDATION_CODES'],
  'v23': ['VALIDATION_CODES'],
  'v24': ['VALIDATION_CODES'],

  // Contenedores
  'tipo_contenedor': ['CONTAINER_TYPES'],
  'lote': ['CONTAINER_LOTES'],

  // Patinetes
  'proveedor': ['SCOOTER_PROVIDERS'],

  // Multas
  'calificacion': ['SEVERITY_LEVELS.FINE'],
  'calificación': ['SEVERITY_LEVELS.FINE'],
  'descuento': ['BINARY_INDICATORS'],

  // Tráfico
  'tipo_elem': ['TRAFFIC_ELEMENT_TYPES'],
  'error': ['TRAFFIC_ERROR_CODES'],

  // Censo
  'cod_edad_int': ['AGE_RANGES']

  // NOTA: 'tipo' aparece en múltiples CSV con significados diferentes
  // (ruido: periodos del día, ubicaciones: tipo de punto)
  // Se detectará por keyword matching en findRelatedConstants()
};

/**
 * Lee un archivo CSV línea por línea y extrae valores únicos
 * Manejo robusto de UTF-8 con tildes y ñ
 *
 * @param {string} filePath - Ruta absoluta al archivo CSV
 * @returns {Promise<Object>} - { headers: [], uniqueValues: { columnName: Set() } }
 */
async function parseCSV(filePath) {
  return new Promise((resolve, reject) => {
    const fileStream = fs.createReadStream(filePath, { encoding: 'utf8' });
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity
    });

    let headers = [];
    const uniqueValues = {};
    let lineNumber = 0;
    let processedLines = 0;

    rl.on('line', (line) => {
      lineNumber++;

      // Primera línea: headers
      if (lineNumber === 1) {
        headers = line.split(CSV_DELIMITER).map(h => h.trim());
        // Inicializar Sets para valores únicos
        headers.forEach(header => {
          uniqueValues[header] = new Set();
        });
        return;
      }

      // Líneas de datos
      const values = line.split(CSV_DELIMITER);
      headers.forEach((header, index) => {
        const value = values[index] ? values[index].trim() : '';
        if (value && value !== '' && value !== 'NULL' && value !== 'null') {
          uniqueValues[header].add(value);
        }
      });

      processedLines++;
    });

    rl.on('close', () => {
      // Convertir Sets a Arrays para facilitar serialización
      const result = {
        headers,
        uniqueValues: {},
        totalLines: processedLines
      };

      Object.keys(uniqueValues).forEach(header => {
        result.uniqueValues[header] = Array.from(uniqueValues[header]).sort();
      });

      resolve(result);
    });

    rl.on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Encuentra archivos CSV en una carpeta que coincidan con un prefijo
 *
 * @param {string} folder - Nombre de la carpeta dentro de datos_hpe
 * @param {string} prefix - Prefijo de los archivos a buscar
 * @returns {Array<string>} - Array de rutas absolutas
 */
function findCSVFiles(folder, prefix) {
  const files = [];
  const folderPath = path.join(DATOS_DIR, folder);

  if (!fs.existsSync(folderPath)) {
    return files;
  }

  const entries = fs.readdirSync(folderPath);

  for (const entry of entries) {
    if (entry.startsWith(prefix) && entry.endsWith('.csv')) {
      files.push(path.join(folderPath, entry));
    }
  }

  return files.sort();
}

/**
 * Agrega valores únicos de múltiples CSV del mismo tipo
 *
 * @param {Array<string>} filePaths - Array de rutas a CSV
 * @returns {Promise<Object>} - Datos agregados
 */
async function aggregateCSVData(filePaths) {
  console.log(`   Agregando ${filePaths.length} archivos...`);

  const aggregated = {
    headers: null,
    uniqueValues: {},
    totalFiles: filePaths.length,
    totalLines: 0,
    fileNames: filePaths.map(fp => path.basename(fp))
  };

  for (const filePath of filePaths) {
    const data = await parseCSV(filePath);

    // Primera vez: guardar headers
    if (!aggregated.headers) {
      aggregated.headers = data.headers;
      data.headers.forEach(header => {
        aggregated.uniqueValues[header] = new Set();
      });
    }

    // Agregar valores únicos
    Object.keys(data.uniqueValues).forEach(header => {
      if (aggregated.uniqueValues[header]) {
        data.uniqueValues[header].forEach(value => {
          aggregated.uniqueValues[header].add(value);
        });
      }
    });

    aggregated.totalLines += data.totalLines;
  }

  // Convertir Sets a Arrays
  Object.keys(aggregated.uniqueValues).forEach(header => {
    aggregated.uniqueValues[header] = Array.from(aggregated.uniqueValues[header]).sort();
  });

  return aggregated;
}

/**
 * Busca constantes relacionadas con un nombre de columna
 *
 * @param {string} columnName - Nombre de columna del CSV
 * @returns {Array<Object>} - Array de { constantName, values }
 */
function findRelatedConstants(columnName) {
  const normalizedColumn = columnName.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, ''); // Eliminar tildes para búsqueda

  const related = [];

  // Búsqueda exacta en mapeo
  const mappedConstants = COLUMN_TO_CONSTANT_MAPPING[columnName] ||
                          COLUMN_TO_CONSTANT_MAPPING[columnName.toLowerCase()];

  if (mappedConstants) {
    mappedConstants.forEach(constName => {
      const value = getConstantValue(constName);
      if (value) {
        related.push({
          constantName: constName,
          values: value,
          matchType: 'EXACT_MAPPING'
        });
      }
    });
  }

  // Búsqueda por similitud de nombre
  if (related.length === 0) {
    // Buscar constantes que contengan palabras clave de la columna
    const keywords = normalizedColumn.split('_');

    Object.keys(constants).forEach(constName => {
      const normalizedConstName = constName.toLowerCase();

      // Verificar si alguna keyword aparece en el nombre de la constante
      const hasMatch = keywords.some(keyword =>
        keyword.length > 3 && normalizedConstName.includes(keyword)
      );

      if (hasMatch) {
        const value = constants[constName];
        if (Array.isArray(value) || (typeof value === 'object' && value !== null)) {
          related.push({
            constantName: constName,
            values: value,
            matchType: 'KEYWORD_MATCH'
          });
        }
      }
    });
  }

  return related;
}

/**
 * Obtiene el valor de una constante (puede ser nested como SEVERITY_LEVELS.FINE)
 *
 * @param {string} constPath - Path de la constante (ej: "SEVERITY_LEVELS.FINE")
 * @returns {*} - Valor de la constante
 */
function getConstantValue(constPath) {
  const parts = constPath.split('.');
  let value = constants;

  for (const part of parts) {
    if (value && typeof value === 'object' && part in value) {
      value = value[part];
    } else {
      return null;
    }
  }

  return value;
}

/**
 * Normaliza un valor para comparación (espacios → guiones bajos, sin tildes, mayúsculas)
 *
 * @param {string} value - Valor a normalizar
 * @returns {string} - Valor normalizado
 */
function normalizeValue(value) {
  return String(value)
    .toUpperCase()
    .trim()
    .replace(/\s+/g, '_') // Espacios a guiones bajos
    .normalize('NFD').replace(/[\u0300-\u036f]/g, ''); // Quitar tildes
}

/**
 * Compara valores del CSV con valores en constantes
 * IMPORTANTE: Normaliza espacios → guiones bajos y quita tildes para comparación
 *
 * @param {Array<string>} csvValues - Valores únicos del CSV
 * @param {*} constantValue - Valor de la constante (Array, Object, etc.)
 * @returns {Object} - { inBoth, onlyInCSV, onlyInConstant }
 */
function compareValues(csvValues, constantValue) {
  let constantValues = [];

  // Extraer valores según tipo de constante
  if (Array.isArray(constantValue)) {
    constantValues = constantValue;
  } else if (typeof constantValue === 'object' && constantValue !== null) {
    constantValues = Object.values(constantValue);
  } else {
    return { error: 'Tipo de constante no comparable' };
  }

  // Normalizar valores para comparación
  const csvNormalized = csvValues.map(v => ({
    original: v,
    normalized: normalizeValue(v)
  }));

  const constNormalized = constantValues.map(v => ({
    original: String(v),
    normalized: normalizeValue(v)
  }));

  const csvSet = new Set(csvNormalized.map(v => v.normalized));
  const constSet = new Set(constNormalized.map(v => v.normalized));

  const inBoth = [];
  const onlyInCSV = [];
  const onlyInConstant = [];

  // Valores en ambos (mostrar originales del CSV)
  csvNormalized.forEach(item => {
    if (constSet.has(item.normalized)) {
      inBoth.push(item.original);
    } else {
      onlyInCSV.push(item.original);
    }
  });

  // Valores solo en constante (mostrar originales de constante)
  constNormalized.forEach(item => {
    if (!csvSet.has(item.normalized)) {
      onlyInConstant.push(item.original);
    }
  });

  return {
    inBoth: inBoth.sort(),
    onlyInCSV: onlyInCSV.sort(),
    onlyInConstant: onlyInConstant.sort(),
    coverage: csvSet.size > 0 ? ((inBoth.length / csvSet.size) * 100).toFixed(2) : 0
  };
}

/**
 * Genera reporte en Markdown
 *
 * @param {Object} auditResults - Resultados de la auditoría
 * @returns {string} - Contenido del reporte en Markdown
 */
function generateMarkdownReport(auditResults) {
  let report = `# Auditoría Exhaustiva: CSV vs Constantes\n\n`;
  report += `**Fecha de generación:** ${new Date().toLocaleString('es-ES')}\n\n`;
  report += `**Total de grupos CSV analizados:** ${Object.keys(auditResults).length}\n\n`;
  report += `---\n\n`;
  report += `## Tabla de Contenidos\n\n`;

  // Generar índice
  Object.keys(auditResults).forEach((key, index) => {
    const result = auditResults[key];
    report += `${index + 1}. [${result.model} - ${result.description}](#${index + 1}-${key.toLowerCase().replace(/_/g, '-')})\n`;
  });

  report += `\n---\n\n`;

  // Generar secciones detalladas
  Object.keys(auditResults).forEach((key, index) => {
    const result = auditResults[key];

    report += `## ${index + 1}. ${key}\n\n`;
    report += `**Modelo:** \`${result.model}\`\n\n`;
    report += `**Descripción:** ${result.description}\n\n`;

    if (result.aggregated) {
      report += `**Archivos agregados:** ${result.totalFiles} archivos\n\n`;
      report += `<details>\n<summary>Ver lista de archivos (${result.fileNames.length})</summary>\n\n`;
      result.fileNames.forEach(fn => {
        report += `- ${fn}\n`;
      });
      report += `\n</details>\n\n`;
    } else {
      report += `**Archivos:** ${result.fileNames.join(', ')}\n\n`;
    }

    report += `**Total de líneas procesadas:** ${result.totalLines.toLocaleString('es-ES')}\n\n`;
    report += `**Columnas encontradas:** ${result.headers.length}\n\n`;

    // Tabla de columnas
    report += `### Columnas del CSV\n\n`;
    report += `| # | Nombre Columna | Valores Únicos | Constantes Relacionadas |\n`;
    report += `|---|----------------|----------------|-------------------------|\n`;

    result.headers.forEach((header, idx) => {
      const uniqueCount = result.uniqueValues[header].length;
      const relatedConstants = result.columnAnalysis[header]?.relatedConstants || [];
      const constNames = relatedConstants.map(rc => `\`${rc.constantName}\``).join(', ') || 'Ninguna';

      report += `| ${idx + 1} | \`${header}\` | ${uniqueCount} | ${constNames} |\n`;
    });

    report += `\n`;

    // Análisis detallado de columnas con constantes
    const columnsWithConstants = Object.keys(result.columnAnalysis).filter(
      col => result.columnAnalysis[col].relatedConstants.length > 0
    );

    if (columnsWithConstants.length > 0) {
      report += `### Análisis de Columnas con Constantes\n\n`;

      columnsWithConstants.forEach(columnName => {
        const analysis = result.columnAnalysis[columnName];

        report += `#### \`${columnName}\` (${analysis.uniqueCount} valores únicos)\n\n`;

        analysis.relatedConstants.forEach(rc => {
          report += `**Constante relacionada:** \`${rc.constantName}\` (tipo: ${rc.matchType})\n\n`;

          if (rc.comparison) {
            const comp = rc.comparison;

            // Resumen de cobertura
            report += `**Cobertura:** ${comp.coverage}%\n\n`;

            // Valores en ambos
            if (comp.inBoth.length > 0) {
              report += `<details>\n<summary>✅ Valores en CSV y Constante (${comp.inBoth.length})</summary>\n\n`;
              report += `\`\`\`\n${comp.inBoth.join('\n')}\n\`\`\`\n\n`;
              report += `</details>\n\n`;
            }

            // Valores solo en CSV (CRÍTICO - posibles valores faltantes en constantes)
            if (comp.onlyInCSV.length > 0) {
              report += `<details>\n<summary>⚠️ Valores solo en CSV (${comp.onlyInCSV.length}) - REVISAR</summary>\n\n`;
              report += `**IMPORTANTE:** Estos valores aparecen en los datos pero NO están en las constantes.\n\n`;
              report += `\`\`\`\n${comp.onlyInCSV.join('\n')}\n\`\`\`\n\n`;
              report += `</details>\n\n`;
            }

            // Valores solo en Constante (valores de dominio o no presentes en dataset actual)
            if (comp.onlyInConstant.length > 0) {
              report += `<details>\n<summary>ℹ️ Valores solo en Constante (${comp.onlyInConstant.length})</summary>\n\n`;
              report += `**Nota:** Estos valores están definidos en constantes pero no aparecen en los datos actuales.\n`;
              report += `Pueden ser valores de dominio válidos, valores futuros, o valores no presentes en este dataset.\n\n`;
              report += `\`\`\`\n${comp.onlyInConstant.join('\n')}\n\`\`\`\n\n`;
              report += `</details>\n\n`;
            }
          }
        });

        report += `---\n\n`;
      });
    }

    // Columnas sin constantes relacionadas
    const columnsWithoutConstants = result.headers.filter(
      header => !result.columnAnalysis[header]?.relatedConstants?.length
    );

    if (columnsWithoutConstants.length > 0) {
      report += `### Columnas sin Constantes Relacionadas\n\n`;
      report += `Las siguientes columnas no tienen constantes relacionadas definidas:\n\n`;

      columnsWithoutConstants.forEach(header => {
        const values = result.uniqueValues[header];
        report += `- \`${header}\` (${values.length} valores únicos)\n`;
      });

      report += `\n`;
    }

    report += `---\n\n`;
  });

  // Resumen final
  report += `## Resumen Global\n\n`;

  let totalColumns = 0;
  let columnsWithConstants = 0;
  let totalComparisons = 0;
  let perfectMatches = 0;
  let partialMatches = 0;

  Object.values(auditResults).forEach(result => {
    totalColumns += result.headers.length;

    Object.values(result.columnAnalysis).forEach(analysis => {
      if (analysis.relatedConstants.length > 0) {
        columnsWithConstants++;

        analysis.relatedConstants.forEach(rc => {
          if (rc.comparison) {
            totalComparisons++;
            const coverage = parseFloat(rc.comparison.coverage);
            if (coverage === 100) {
              perfectMatches++;
            } else if (coverage > 0) {
              partialMatches++;
            }
          }
        });
      }
    });
  });

  report += `- **Total de columnas analizadas:** ${totalColumns}\n`;
  report += `- **Columnas con constantes relacionadas:** ${columnsWithConstants}\n`;
  report += `- **Total de comparaciones realizadas:** ${totalComparisons}\n`;
  report += `- **Comparaciones con cobertura 100%:** ${perfectMatches}\n`;
  report += `- **Comparaciones con cobertura parcial:** ${partialMatches}\n`;
  report += `- **Comparaciones sin coincidencias:** ${totalComparisons - perfectMatches - partialMatches}\n\n`;

  return report;
}

/**
 * Función principal
 */
async function main() {
  console.log('='.repeat(80));
  console.log('AUDITORÍA EXHAUSTIVA: CSV vs CONSTANTES');
  console.log('='.repeat(80));
  console.log('');

  const auditResults = {};

  for (const [key, config] of Object.entries(CSV_MAPPING)) {
    console.log(`\n[${key}] ${config.description}`);
    console.log('-'.repeat(80));

    let filePaths = [];

    // Buscar archivos según configuración
    if (config.folder && config.pattern) {
      filePaths = findCSVFiles(config.folder, config.pattern);
      console.log(`   Encontrados ${filePaths.length} archivos en carpeta ${config.folder}`);
    } else if (config.files) {
      filePaths = config.files.map(f => path.join(DATOS_DIR, f));
      console.log(`   Procesando archivos: ${config.files.join(', ')}`);
    }

    if (filePaths.length === 0) {
      console.log(`   ⚠️  No se encontraron archivos CSV`);
      continue;
    }

    // Validar que los archivos existen
    filePaths = filePaths.filter(fp => {
      if (!fs.existsSync(fp)) {
        console.log(`   ⚠️  Archivo no encontrado: ${path.basename(fp)}`);
        return false;
      }
      return true;
    });

    if (filePaths.length === 0) {
      console.log(`   ⚠️  Ningún archivo existe`);
      continue;
    }

    try {
      let data;

      // Agregar múltiples archivos o procesar uno solo
      if (config.aggregateAll && filePaths.length > 1) {
        data = await aggregateCSVData(filePaths);
        data.aggregated = true;
      } else {
        data = await parseCSV(filePaths[0]);
        data.aggregated = false;
        data.totalFiles = 1;
        data.fileNames = [path.basename(filePaths[0])];
      }

      console.log(`   ✓ Procesadas ${data.totalLines.toLocaleString('es-ES')} líneas`);
      console.log(`   ✓ Encontradas ${data.headers.length} columnas`);

      // Analizar cada columna
      const columnAnalysis = {};

      for (const header of data.headers) {
        const uniqueValues = data.uniqueValues[header];
        const relatedConstants = findRelatedConstants(header);

        columnAnalysis[header] = {
          uniqueCount: uniqueValues.length,
          relatedConstants: []
        };

        // Comparar con constantes relacionadas
        for (const rc of relatedConstants) {
          const comparison = compareValues(uniqueValues, rc.values);

          columnAnalysis[header].relatedConstants.push({
            constantName: rc.constantName,
            matchType: rc.matchType,
            comparison
          });
        }
      }

      // Guardar resultados
      auditResults[key] = {
        model: config.model,
        description: config.description,
        aggregated: data.aggregated,
        totalFiles: data.totalFiles,
        totalLines: data.totalLines,
        fileNames: data.fileNames,
        headers: data.headers,
        uniqueValues: data.uniqueValues,
        columnAnalysis
      };

      console.log(`   ✓ Análisis completado`);

    } catch (error) {
      console.error(`   ✗ Error procesando: ${error.message}`);
    }
  }

  // Generar reporte
  console.log('\n' + '='.repeat(80));
  console.log('GENERANDO REPORTE...');
  console.log('='.repeat(80));

  const reportContent = generateMarkdownReport(auditResults);
  fs.writeFileSync(OUTPUT_FILE, reportContent, { encoding: 'utf8' });

  console.log(`\n✓ Reporte generado: ${OUTPUT_FILE}`);
  console.log(`\nAuditoría completada exitosamente.\n`);
}

// Ejecutar
main().catch(err => {
  console.error('Error fatal:', err);
  process.exit(1);
});
