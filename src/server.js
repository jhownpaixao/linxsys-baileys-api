const express = require('express');
const path = require('path');
const dotenv = require('dotenv');
const cookieParser = require('cookie-parser');
const logger = require('./service/logger.js').default;
const cors = require('cors');
const { Welcome } = require('./utils/welcome');
const pinoHttp = require('pino-http')({ logger });
const app = express();
const publicDirectory = path.join(__dirname, './public');
const porta = process.env.APP_PORT || 4000;

dotenv.config();

app.use(express.static(publicDirectory));
app.use('/modulos', express.static(path.join(__dirname, '/node_modules')));
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(cookieParser());
app.use(pinoHttp);
app.use(
    cors({
        origin: process.env.FRONT_END_URL || `http://localhost:${porta}`
    })
);
process.on('uncaughtException', function (error) {
    logger.error('erro logger', error.stack);
});

app.use('/', require('./routes'));
app.use(express.static(`${__dirname}/build/`));

app.listen(porta, () => {
    Welcome();
});

/* const SSL_Config = {
   key: fs.readFileSync(path.join(__dirname, 'ssl', 'server.key')),
   cert: fs.readFileSync(path.join(__dirname, 'ssl', 'server.crt')),
   requestCert: false,
   reconnect: true,
   rejectUnauthorized: false
};

https.createServer(SSL_Config, app).listen(process.env.APP_PORT, () => {
   logger.info("Startou porta " + process.env.APP_PORT);
})
 */
