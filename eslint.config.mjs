import js from "@eslint/js";
import globals from "globals";

export default [
  js.configs.recommended,
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: "commonjs",
      globals: {
        ...globals.node,
        ...globals.es2021,
      }
    },
    rules: {
      // Errores comunes
      "no-console": "off", // Permitimos console.log por ahora (luego migrar a Pino)
      "no-unused-vars": ["warn", { "argsIgnorePattern": "^_", "varsIgnorePattern": "^_" }],
      "no-undef": "error",

      // Buenas prácticas
      "eqeqeq": ["error", "always"], // Usar === en vez de ==
      "curly": ["error", "all"], // Siempre usar llaves en if/else
      "no-var": "error", // No usar var, solo let/const
      "prefer-const": "warn", // Preferir const cuando no se reasigna

      // Seguridad
      "no-eval": "error",
      "no-implied-eval": "error",
    },
    ignores: [
      "node_modules/**",
      "datos_hpe/**",
      "docs/**",
      "coverage/**",
      "reports/**"
    ]
  }
];
