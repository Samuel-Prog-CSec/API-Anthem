/**
 * Envoltura para handlers async de Express.
 *
 * Captura excepciones lanzadas por el handler (ya sean sincronas o rechazos
 * de promesa) y las delega a `next(err)`, donde el `globalErrorHandler` se
 * encarga de formatear la respuesta. Elimina la necesidad de `try/catch`
 * repetidos en cada controlador.
 *
 * Uso:
 *
 *   const obtenerMultas = asyncHandler(async (req, res) => {
 *     const data = await Multa.find();
 *     res.json(data);
 *   });
 *
 * En vez de:
 *
 *   const obtenerMultas = async (req, res, next) => {
 *     try {
 *       const data = await Multa.find();
 *       res.json(data);
 *     } catch (error) {
 *       next(error);
 *     }
 *   };
 *
 * @param {Function} handler - Handler async con firma (req, res, next)
 * @returns {Function} Handler envuelto que propaga errores a Express
 */
const asyncHandler = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);

module.exports = asyncHandler;
