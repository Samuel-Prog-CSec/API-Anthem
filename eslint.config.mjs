import js from "@eslint/js";
import globals from "globals";

export default [
  // Configuración base recomendada de ESLint
  js.configs.recommended,

  // Configuración para archivos JavaScript
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: {
        ...globals.node,
        ...globals.es2021,
      }
    },
    rules: {
      // === Errores comunes ===
      "no-console": "warn", // Advertir uso de console (usar Pino logger)
      "no-unused-vars": [
        "warn",
        {
          "argsIgnorePattern": "^_",
          "varsIgnorePattern": "^_",
          "caughtErrorsIgnorePattern": "^_",
          "destructuredArrayIgnorePattern": "^_"
        }
      ],
      "no-undef": "error",
      "no-duplicate-imports": "error",
      "no-unreachable": "error",
      "no-constant-condition": ["error", { "checkLoops": false }],

      // === Buenas prácticas ===
      "eqeqeq": ["error", "always", { "null": "ignore" }], // Usar === (excepto con null)
      "curly": ["error", "all"], // Siempre usar llaves en if/else/for/while
      "no-var": "error", // No usar var, solo let/const
      "prefer-const": "warn", // Preferir const cuando no se reasigna
      "no-lonely-if": "warn", // Evitar if solitarios en else
      "no-else-return": ["warn", { "allowElseIf": false }], // Evitar else innecesarios después de return
      "no-useless-return": "warn", // Evitar returns innecesarios
      "dot-notation": "warn", // Usar notación de punto cuando sea posible
      "no-unneeded-ternary": "warn", // Evitar ternarios innecesarios

      // === Async/Await ===
      "require-await": "off", // Permitir async sin await (muchas funciones retornan Promises)
      "no-async-promise-executor": "error", // No usar async en Promise executor
      "prefer-promise-reject-errors": "error", // Rechazar Promises solo con Error objects
      "no-return-await": "warn", // No usar return await innecesariamente

      // === Seguridad ===
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
      "no-script-url": "error",

      // === Calidad de código ===
      "no-shadow": ["warn", { "builtinGlobals": false, "hoist": "functions" }],
      "no-use-before-define": ["error", { "functions": false, "classes": true, "variables": true }],
      "complexity": ["warn", 40], // Advertir sobre complejidad ciclomática alta
      "max-depth": ["warn", 4], // Máximo 4 niveles de anidamiento
      "max-lines-per-function": ["warn", { "max": 150, "skipBlankLines": true, "skipComments": true }],

      // === Estilo y consistencia ===
      "camelcase": ["warn", { "properties": "never", "ignoreDestructuring": true }],
      "consistent-return": "off", // Permitir return mixtos (patrón estándar en Express middlewares)
      "default-case-last": "error",
      "no-multi-spaces": "warn",
      "no-trailing-spaces": "warn",
      "semi": ["error", "always"],
      "quotes": ["warn", "single", { "avoidEscape": true, "allowTemplateLiterals": true }],
      "comma-dangle": ["warn", "only-multiline"],
    }
  },

  // Configuración específica para scripts de importación y análisis.
  // Los validadores/transformadores de los importadores (ETL) son
  // inherentemente ramificados: parsean decenas de columnas con reglas de
  // normalizacion por campo y clasificaciones derivadas. Refactorizarlos solo
  // para bajar la metrica anadiria riesgo a logica critica ya validada en QA,
  // asi que ampliamos el presupuesto de complejidad/anidamiento SOLO aqui.
  {
    files: ["scripts/**/*.js"],
    rules: {
      "no-console": "off", // Permitir console en scripts
      "max-lines-per-function": ["warn", { "max": 250 }], // Scripts pueden ser más largos
      "complexity": ["warn", 55], // Validadores ETL con muchas ramas por campo
      "max-depth": ["warn", 6], // Anidamiento en manejo de writeErrors / bucles horarios
    }
  },

  // Archivos y directorios a ignorar
  {
    ignores: [
      "node_modules/**",
      "datos_hpe/**",
      "docs/**",
      "coverage/**",
      "reports/**",
      "dist/**",
      "build/**",
      ".clinic/**",
      ".git/**",
      ".github/**",
      "*.min.js",
      "**/*.md"
    ]
  }
];
