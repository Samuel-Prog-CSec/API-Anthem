/**
 * Aprovisionamiento de cuentas de servicio para nodos IoT (rol SENSOR).
 *
 * Las rutas POST /ingesta exigen rol `admin` o `sensor` (ver
 * middleware/authorization.sensorOrAdmin). El registro publico (/auth/register)
 * crea SIEMPRE rol `user`, por lo que un usuario que se auto-registre NO puede
 * escribir datos de sensores. Las credenciales de sensor deben aprovisionarse
 * explicitamente con este script, fuera de banda (igual que harias en
 * produccion al dar de alta un dispositivo).
 *
 * Crea la cuenta si no existe, o promueve a `sensor` una cuenta existente
 * (sin tocar su contrasena). La contrasena se hashea via el hook pre('save')
 * del modelo User (bcrypt).
 *
 * Uso:
 *   node scripts/provisionarSensor.js --username=<u> --email=<e> --password=<p>
 *   # o con la contrasena en variable de entorno (evita el historial del shell):
 *   SENSOR_PASSWORD=<p> node scripts/provisionarSensor.js --username=<u> --email=<e>
 *
 * El simulador IoT (simulador-iot) debe configurarse con estas credenciales y
 * con registrar=false (la cuenta ya existe con el rol correcto).
 */

process.env.SCRIPT_MODE = 'true';

const mongoose = require('mongoose');
const { connectDB } = require('../src/config/database');
const config = require('../src/config/config');
const User = require('../src/models/User');
const { USER_ROLES, USER_SECURITY } = require('../src/constants');
const { validatePassword } = require('../src/utils/passwordValidator');

/**
 * Lee un flag --clave=valor de process.argv, con fallback a variable de entorno.
 * @param {string} nombre - nombre del flag (sin --)
 * @param {string} [envVar] - variable de entorno alternativa
 * @returns {string|undefined}
 */
function leerArg(nombre, envVar) {
  const prefijo = `--${nombre}=`;
  const arg = process.argv.find((a) => a.startsWith(prefijo));
  if (arg) { return arg.slice(prefijo.length); }
  return envVar ? process.env[envVar] : undefined;
}

(async () => {
  const username = leerArg('username');
  const email = leerArg('email');
  const password = leerArg('password', 'SENSOR_PASSWORD');

  if (!username || !email || !password) {
    // eslint-disable-next-line no-console
    console.error('[provisionarSensor] Faltan argumentos. Uso: --username=<u> --email=<e> --password=<p> (o SENSOR_PASSWORD).');
    process.exit(1);
  }

  if (username.length < USER_SECURITY.MIN_USERNAME_LENGTH || username.length > USER_SECURITY.MAX_USERNAME_LENGTH) {
    // eslint-disable-next-line no-console
    console.error(`[provisionarSensor] username debe tener entre ${USER_SECURITY.MIN_USERNAME_LENGTH} y ${USER_SECURITY.MAX_USERNAME_LENGTH} caracteres.`);
    process.exit(1);
  }

  // Misma politica de contrasena que el registro publico, para no abrir un
  // hueco mas debil al crear cuentas de servicio.
  const validacion = validatePassword(password);
  if (!validacion.isValid) {
    // eslint-disable-next-line no-console
    console.error(`[provisionarSensor] Contrasena debil: ${validacion.errors.join('; ')}`);
    process.exit(1);
  }

  try {
    await connectDB(config.database.uri);

    const existente = await User.findOne({ $or: [{ username }, { email }] });

    if (existente) {
      const eraSensor = existente.role === USER_ROLES.SENSOR;
      existente.role = USER_ROLES.SENSOR;
      await existente.save(); // no re-hashea la contrasena (no se modifico)
      // eslint-disable-next-line no-console
      console.log(`[provisionarSensor] Cuenta "${existente.username}" ${eraSensor ? 'ya era' : 'promovida a'} rol sensor (id ${existente._id}).`);
    } else {
      const nuevo = await User.create({ username, email, password, role: USER_ROLES.SENSOR });
      // eslint-disable-next-line no-console
      console.log(`[provisionarSensor] Cuenta sensor "${nuevo.username}" creada (id ${nuevo._id}).`);
    }

    await mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(`[provisionarSensor] Error: ${error.message}`);
    try { await mongoose.connection.close(); } catch { /* noop */ }
    process.exit(1);
  }
})();
