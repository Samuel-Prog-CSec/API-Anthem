/**
 * Controlador de Censo (barrel)
 *
 * El controlador original excedia 726 lineas y mezclaba responsabilidades.
 * Se ha dividido por responsabilidad:
 *   - controladorCensoDemografia: consulta (listado, piramide, resumen)
 *   - controladorCensoAnalisis: analisis pesado (estadisticas, analisis,
 *     evolucion temporal, dashboard)
 *
 * Este archivo se mantiene como fachada/re-export para evitar romper
 * cualquier consumidor existente.
 */

const {
  obtenerDatosCenso,
  obtenerPiramidePoblacional,
  obtenerResumenDistritos
} = require('./controladorCensoDemografia');

const {
  obtenerEstadisticasDistritos,
  obtenerAnalisisDemografico,
  obtenerEvolucionDemografica,
  obtenerDashboardDemografico
} = require('./controladorCensoAnalisis');

module.exports = {
  obtenerDatosCenso,
  obtenerPiramidePoblacional,
  obtenerEstadisticasDistritos,
  obtenerAnalisisDemografico,
  obtenerEvolucionDemografica,
  obtenerDashboardDemografico,
  obtenerResumenDistritos
};
