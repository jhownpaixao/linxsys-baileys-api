const express = require('express')
const path = require('path')
const dotenv = require('dotenv')
const cookieParser = require('cookie-parser')
const logger = require('./service/logger.js').default;
const moment = require('moment');
const cors = require('cors');
const https = require('https');
const fs = require('fs');
const { Welcome } = require('./utils/welcome')
const pinoHttp = require('pino-http')({
    logger,
    // serializers: {
    //    req(req) {
    //      req.body = req.raw.body;
    //      return req;
    //    },
    //  },

})
const app = express();
const publicDirectory = path.join(__dirname, './public')
const porta = process.env.APP_PORT || 4000;

dotenv.config({ path: './.env' })

app.use(express.static(publicDirectory))
app.use('/modulos', express.static(path.join(__dirname, '/node_modules')))
app.use(express.urlencoded({ extended: false }))
app.use(express.json())
app.use(cookieParser())
app.use(pinoHttp)
app.use(cors({
    origin: String(process.env.FRONT_END_URL).split(',') || `http://localhost:${porta}`
}))



process.on('uncaughtException', function (error) {
    logger.error("erro logger", error.stack)
    console.log("erro console", error);
});


app.use('/', require('./routes'))

const baseDir = `${__dirname}/build/`
app.use(express.static(baseDir))


app.listen(porta, () => {
    Welcome();
})

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
