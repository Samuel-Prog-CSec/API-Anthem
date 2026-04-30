/**
 * Constantes de la API REST
 *
 * Agregador central de constantes. La definicion real vive en modulos por
 * dominio (./core, ./auth, ./geo, ./validation, ./dataset, ./errorCodes y
 * ./domains/*). Este index re-exporta todo para mantener compat con los imports
 * existentes (`require('../constants')`).
 *
 * Para imports nuevos, preferir el modulo especifico:
 *   const { HTTP_STATUS } = require('../constants/core');
 *   const { TIPOS_ACCIDENTE } = require('../constants/domains/accidente');
 *
 * NO definir constantes nuevas en este archivo: ubicarlas en el modulo de su
 * dominio correspondiente (o crear uno nuevo bajo /domains).
 */

const core = require('./core');
const auth = require('./auth');
const geo = require('./geo');
const validation = require('./validation');
const dataset = require('./dataset');
const ERROR_CODES = require('./errorCodes');

const accidente = require('./domains/accidente');
const aire = require('./domains/aire');
const ruido = require('./domains/ruido');
const trafico = require('./domains/trafico');
const multas = require('./domains/multas');
const censo = require('./domains/censo');
const patinetes = require('./domains/patinetes');
const bicicletas = require('./domains/bicicletas');
const contenedores = require('./domains/contenedores');

module.exports = {
  ...core,
  ...auth,
  ...geo,
  ...validation,
  ...dataset,
  ...accidente,
  ...aire,
  ...ruido,
  ...trafico,
  ...multas,
  ...censo,
  ...patinetes,
  ...bicicletas,
  ...contenedores,
  ERROR_CODES
};
