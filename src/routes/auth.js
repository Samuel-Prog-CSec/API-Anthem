/**
 * Rutas de Autenticación
 *
 * Define todos los endpoints de API relacionados con autenticación incluyendo
 * registro de usuario, login, logout y gestión de perfil.
 *
 */

const express = require('express');
const router = express.Router();
const { HTTP_STATUS } = require('../constants');
const { createResponse } = require('../utils/responseHelper');
const logger = require('../config/logger');

// Controladores
const {
  register,
  login,
  logout,
  getProfile,
  refreshAccessToken,
  changePassword
} = require('../controllers/authController');

// Middleware
const { authenticate } = require('../middleware/auth');
const { authLimiter, validateRequest } = require('../middleware/security');
const { performanceMonitor } = require('../middleware/performanceMonitor');
const {
  validateRegistration,
  validateLogin,
  validatePasswordChange,
  validateRefreshToken,
  validateOptionalRefreshToken
} = require('../middleware/validation');

// Aplicar performanceMonitor a todas las rutas de autenticación
router.use(performanceMonitor);

/**
 * @route   POST /api/v1/auth/register
 * @desc    Registrar un nuevo usuario
 * @access  Público
 * @middleware Rate limiting, Validación de entrada
 *
 * Body de Request:
 * - username (requerido): Nombre de usuario único (3-30 caracteres)
 * - email (requerido): Dirección de email válida
 * - password (requerido): Contraseña fuerte (8+ caracteres con requisitos de complejidad)
 * - firstName (opcional): Nombre del usuario
 * - lastName (opcional): Apellido del usuario
 *
 * Response: Objeto de usuario y token JWT
 */
router.post('/register',
  authLimiter, // Aplicar rate limiting estricto para endpoints de auth
  validateRegistration, // Validar datos de entrada
  validateRequest, // Procesar errores de validación
  register // Función del controlador
);

/**
 * @route   POST /api/v1/auth/login
 * @desc    Autenticar usuario y obtener token
 * @access  Público
 * @middleware Rate limiting, Validación de entrada
 *
 * Body de Request:
 * - identifier (requerido): Email o nombre de usuario
 * - password (requerido): Contraseña del usuario
 *
 * Response: Objeto de usuario y token JWT
 */
router.post('/login',
  authLimiter, // Aplicar rate limiting estricto para endpoints de auth
  validateLogin, // Validar datos de entrada
  validateRequest, // Procesar errores de validación
  login // Función del controlador
);

/**
 * @route   POST /api/v1/auth/logout
 * @desc    Cerrar sesión del usuario (limpiar cookie del token)
 * @access  Privado
 * @middleware Autenticación requerida
 *
 * Response: Mensaje de éxito
 */
router.post('/logout',
  authenticate, // Requiere autenticación
  validateOptionalRefreshToken,
  logout // Función del controlador
);

/**
 * @route   POST /api/v1/auth/refresh
 * @desc    Renovar access token usando refresh token (con rotación de token)
 * @access  Público
 * @middleware Rate limiting
 *
 * Body de Request:
 * - refreshToken (requerido): Refresh token válido
 *
 * Response: Nuevo access token y nuevo refresh token
 */
router.post('/refresh',
  authLimiter, // Aplicar rate limiting
  validateRefreshToken,
  refreshAccessToken // Función del controlador
);

/**
 * @route   GET /api/v1/auth/me
 * @desc    Obtener perfil del usuario autenticado actual
 * @access  Privado
 * @middleware Autenticación requerida
 *
 * Response: Información del perfil del usuario actual
 */
router.get('/me',
  authenticate, // Requiere autenticación
  getProfile // Función del controlador
);

/**
 * @route   GET /api/v1/auth/verify-token
 * @desc    Verificar si el token actual es válido
 * @access  Privado
 * @middleware Autenticación requerida
 *
 * Response: Estado de validación del token e información del usuario
 */
router.get('/verify-token',
  authenticate, // Requiere autenticación
  (req, res, next) => {
    try {
      // Si llegamos aquí, el token es válido (el middleware authenticate pasó)
      res.status(HTTP_STATUS.OK).json(
        createResponse(
          {
            user: {
              id: req.user._id,
              username: req.user.username,
              email: req.user.email,
              role: req.user.role,
              isActive: req.user.isActive
            },
            tokenValid: true
          },
          'Token válido'
        )
      );
    } catch (error) {
      logger.error({
        error: error.message,
        stack: error.stack,
        userId: req.user?._id
      }, 'Error en verificación de token');
      next(error);
    }
  }
);

/**
 * @route   PUT /api/v1/auth/change-password
 * @desc    Cambiar contraseña del usuario
 * @access  Privado
 * @middleware Autenticación requerida, Rate limiting, Validación de entrada
 *
 * Body de Request:
 * - currentPassword (requerido): Contraseña actual para verificación
 * - newPassword (requerido): Nueva contraseña (8+ caracteres con requisitos de complejidad)
 *
 * Response: Mensaje de éxito
 */
router.put('/change-password',
  authenticate, // Requiere autenticación
  authLimiter, // Aplicar rate limiting para prevenir fuerza bruta
  validatePasswordChange, // Validar datos de entrada
  validateRequest, // Procesar errores de validación
  changePassword // Función del controlador
);

module.exports = router;
