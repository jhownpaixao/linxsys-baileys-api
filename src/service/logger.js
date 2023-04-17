const fs = require('fs');
const { multistream } = require('pino-multi-stream');
const path = require('path');
const dotenv = require('dotenv');
const moment = require('moment');
const pino_1 = require('pino');
dotenv.config();
/**
 * Define a data atual pelo moment
 * @date 24/03/2023 - 20:19:19
 *
 */
const today = moment().format('DD-MM-YYYY');
/**
 * Define a hora atual pelo moment
 * @date 24/03/2023 - 20:19:18
 *
 */
const hour = moment().format('HH_mm');
/**
 * Diretório pardrão de logs
 * @date 24/03/2023 - 20:19:18
 *
 */
const dir_log = '../../logs';

fs.mkdirSync(path.resolve(__dirname, dir_log, today, hour), { recursive: true });
/**
 * Path completo e montado do log atual à ser gerado
 * @date 24/03/2023 - 20:19:18
 *
 */
const path_log = path.resolve(__dirname, dir_log, today, hour);

/**
 * Streams personalizados para a geração dos logs
 * @date 24/03/2023 - 20:19:18
 *
 */
const streams = [
    { stream: fs.createWriteStream(path_log + '/all.log') },
    { level: 'debug', stream: fs.createWriteStream(path_log + '/debug.log') },
    { level: 'error', stream: fs.createWriteStream(path_log + '/error.log') },
    { level: 'info', stream: fs.createWriteStream(path_log + '/info.log') },
    { level: 'fatal', stream: fs.createWriteStream(path_log + '/fatal.log') },
    { level: 'warn', stream: fs.createWriteStream(path_log + '/warn.log') },
    { level: 'silent', stream: fs.createWriteStream(path_log + '/silent.log') },
    { level: 'trace', stream: fs.createWriteStream(path_log + '/trace.log') }
    //{stream: process.stdout},
];
/**
 * Logger padrão par a exportação
 * @date 24/03/2023 - 20:19:18
 *
 */
exports.default = (0, pino_1.default)(
    {
        name: 'linxsys-convenire',
        level: process.env.LOGGER_LEVEL || 'info', // this MUST be set at the lowest level of the
        colorize: true,
        translateTime: 'dd-mm-yyyy HH:MM:ss',
        timestamp: () => `,"time":"${new Date().toJSON()}"`
    },
    multistream(streams)
);
