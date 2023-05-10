const { StartSession, onlineSessions, inConnection } = require('../service/baileys/baileys');
const AppStore = require('../service/AppMemory/memory').default;
const logger = require('../service/logger').default;
const crypto = require('crypto');
const Store = AppStore();
const jwt = require('jsonwebtoken');
const JWT_SECRET = 'RDA36fçssa1';
const webhooks = require('node-webhooks');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const uploadPath = path.resolve(__dirname, '../../public/uploads');

const storage = multer.diskStorage({
    destination: async (req, file, cb) => {
        !fs.existsSync(uploadPath) && fs.mkdirSync(uploadPath, { recursive: true, force: true });
        cb(null, uploadPath);
    },
    filename: (req, file, cb) => {
        var name = Date.now() + path.extname(file.originalname);
        req.file = name;
        cb(null, name);
    }
});
exports.upload = multer({ storage });

global.webhook = new webhooks({ db: {} });

const AutoReconnect = async () => {
    const sessions = Store.getall();
    for (const [session, data] of sessions) {
        if (!data.connection) continue;
        console.log('Iniciando Auto Conexão para: ', data.uniqkey, data.name);
        logger.info(data, 'Conexão automática');
        await StartSession(session, data.connection.id, null, data.connection.webhook);
    }
};

exports.SessionAdd = async (req, res) => {
    const { session } = req.body;
    if (!session || session.includes(':')) {
        return res.status(200).json({
            message: 'Parametros incorretos'
        });
    }
    logger.debug(req.body, 'Criando sessão');
    const uniqkey = crypto.randomUUID();

    const token = jwt.sign({ session, uniqkey }, JWT_SECRET);
    if (Store.has(session)) {
        logger.error(req.body, 'Não foi possíecl criar... Sessão já existe');
        return res.status(406).json({
            status: false,
            error: 'A sessão já existe'
        });
    }
    Store.set(session, {
        uniqkey,
        token
    });
    logger.debug(req.body, 'Sessão criada');
    return res.status(200).json({
        status: true,
        session,
        token
    });
};

exports.SessionStart = async (req, res) => {
    const { session } = req.params;
    console.log('session', session);
    const { webhook } = req.body;

    if (!session || session.includes(':')) {
        logger.debug({ session, webhook }, 'Erro ao iniciar: requisição incompleta');
        return res.status(400).json({ error: 'Requisição incompleta' });
    }

    if (!Store.has(req.decoded.session)) {
        logger.debug({ session, webhook }, 'Erro ao iniciar: A sessão não existe');
        return res.status(406).json({
            error: 'A sessão não existe'
        });
    }
    const sessionData = await Store.get(req.decoded.session);

    if (onlineSessions.get(sessionData.uniqkey)) {
        logger.debug({ session, webhook }, 'Erro ao iniciar: A sessão já está conectada');
        return res.status(406).json({
            error: 'A sessão já está conectada',
            connection: sessionData.connection
        });
    }
    /* onlineSessions
    inConnection */
    StartSession(session, sessionData.uniqkey, res, webhook);
};

exports.SessionDelete = async (req, res) => {
    const { session } = req.params;

    if (!session || session.includes(':')) {
        return res.status(400).json({ error: 'Requisição incompleta' });
    }

    if (!Store.has(req.decoded.session)) {
        return res.status(406).json({
            error: 'A sessão não existe'
        });
    }
    const sessionData = await Store.get(req.decoded.session);

    if (sessionData.uniqkey !== req.decoded.uniqkey) {
        return res.status(403).json({ error: 'A autorização é inválida para esta sessão, por favor atualize o token' });
    }

    const online = onlineSessions.get(sessionData.uniqkey);
    if (online && online !== 'undefined') {
        await online.exclude();
    }

    const exclude = Store.exclude(req.decoded.session);
    if (exclude) {
        return res.status(200).json({ status: true, message: 'Sessão excluída' });
    }
    return res.status(500).json({ status: false, message: 'Não foi possível excluir a sessão' });
};

exports.SessionDesconnect = async (req, res) => {
    const { session } = req.params;

    if (!session || session.includes(':')) {
        return res.status(400).json({ error: 'Requisição incompleta' });
    }

    if (!Store.has(req.decoded.session)) {
        return res.status(406).json({
            error: 'A sessão não existe'
        });
    }
    const sessionData = await Store.get(req.decoded.session);

    if (sessionData.uniqkey !== req.decoded.uniqkey) {
        return res.status(403).json({ error: 'A autorização é inválida para esta sessão, por favor atualize o token' });
    }

    const online = onlineSessions.get(sessionData.uniqkey);
    if (online) {
        await online.destroy();
        return res.status(200).json({ statu: true, message: 'Sessão desconectada' });
    }

    return res.status(200).json({ statu: false, message: 'A sessão não está conectada' });
};

exports.SessionStatus = async (req, res) => {
    const { session } = req.params;

    if (!session || session.includes(':')) {
        return res.status(400).json({ error: 'Requisição incompleta' });
    }

    if (!Store.has(req.decoded.session)) {
        return res.status(406).json({
            error: 'A sessão não existe'
        });
    }
    const sessionData = await Store.get(req.decoded.session);

    if (onlineSessions.get(sessionData.uniqkey)) {
        return res.status(200).json({
            status: true,
            message: 'A sessão está conectada',
            connection: sessionData.connection
        });
    }
    return res.status(200).json({
        status: false,
        message: 'A sessão não está conectada'
    });
};

exports.SendText = async (req, res) => {
    const { session } = req.params;
    const { number, body, simulation } = req.body;

    if (!session || !number || !body) {
        return res.status(400).json({ error: 'Requisição incompleta', status: false });
    }

    if (simulation) simulation.type = 'text';
    const verify = await verifyRequestToSendMessage(req.decoded, number);
    if (!verify.process) return res.status(verify.code).json({ error: verify.msg, status: false });

    try {
        const send = await PrepareAndSendMessage(
            verify.auth.uniqkey,
            verify.data.jid,
            {
                message: {
                    text: body
                }
            },
            simulation
        );

        if (!send) {
            return res.status(406).json({ error: 'Não foi possível enviar a mensagem' });
        }
        return res.status(200).json({ message: 'Mensagem enviada', status: true });
    } catch (error) {
        console.log(error);
        return res.status(500).json({ error: 'Não foi possível enviar a mensagem', status: false });
    }
};

exports.SendImage = async (req, res) => {
    const { session } = req.params;
    const { number, body } = req.body;
    let { simulation } = req.body;

    if (!session || !number || !body || !req.file) {
        return res.status(400).json({ error: 'Requisição incompleta', status: false });
    }
    const verify = await verifyRequestToSendMessage(req.decoded, number);
    if (!verify.process) return res.status(verify.code).json({ error: verify.msg, status: false });

    if (simulation) {
        simulation = JSON.parse(simulation);
        simulation.type = 'image';
    }
    const msgObj = {
        caption: body,
        message: {
            mimetype: req.file.mimetype,
            fileName: req.file.originalname,
            image: req.file.path
        }
    };

    try {
        const send = await PrepareAndSendMessage(verify.auth.uniqkey, verify.data.jid, msgObj, simulation);
        if (!send) {
            return res.status(406).json({ error: 'Não foi possível enviar a mensagem' });
        }
        return res.status(200).json({ message: 'Mensagem enviada', status: true });
    } catch (error) {
        return res.status(500).json({ error: 'Não foi possível enviar a mensagem', status: false });
    }
};

exports.SendAudio = async (req, res) => {
    const { session } = req.params;
    const { number, recorded } = req.body;
    let { simulation } = req.body;

    if (!session || !number || !req.file) {
        return res.status(400).json({ error: 'Requisição incompleta', status: false });
    }
    const ptt = !!(recorded && recorded == 'true');
    const verify = await verifyRequestToSendMessage(req.decoded, number);
    if (!verify.process) return res.status(verify.code).json({ error: verify.msg, status: false });

    if (simulation) {
        simulation = JSON.parse(simulation);
        simulation.type = 'audio';
    }

    const msgObj = {
        message: {
            mimetype: req.file.mimetype,
            fileName: req.file.originalname,
            audio: req.file.path,
            ptt
        }
    };

    try {
        const send = await PrepareAndSendMessage(verify.auth.uniqkey, verify.data.jid, msgObj, simulation);
        if (!send) {
            return res.status(406).json({ error: 'Não foi possível enviar a mensagem' });
        }
        return res.status(200).json({ message: 'Mensagem enviada', status: true });
    } catch (error) {
        return res.status(500).json({ error: 'Não foi possível enviar a mensagem', status: false });
    }
};

exports.ValidateNumber = async (req, res) => {
    const { session, number } = req.params;

    if (!session || !number) {
        return res.status(400).json({ error: 'Requisição incompleta' });
    }

    if (!Store.has(req.decoded.session)) {
        return res.status(406).json({
            error: 'A sessão não existe'
        });
    }

    const sessionData = await Store.get(req.decoded.session);
    if (sessionData.uniqkey !== req.decoded.uniqkey) {
        return res.status(403).json({ error: 'A autorização é inválida para esta sessão, por favor atualize o token' });
    }

    const connection = onlineSessions.get(req.decoded.uniqkey);
    if (!connection) {
        return res.status(406).json({ error: 'Esta sessão não está conectada' });
    }

    const inProcess = inConnection.get(req.decoded.uniqkey);
    if (inProcess) {
        return res.status(406).json({ error: 'Esta conexão ainda não está pronta', status: false });
    }

    /* filter */
    let n = String(number);
    n.replace(/[^0-9]/g, '');
    if (!n.startsWith('55')) n = '55' + n; /* replicar ok */

    /* TO-DO */
    try {
        const [result] = await connection.sock.onWhatsApp(n);
        if (!result?.exists) {
            return res.status(200).json({ exists: false, jid: 'unknow' });
        }
        return res.status(200).json({ exists: true, jid: result.jid });
    } catch (error) {
        console.log(error);
        return res.status(200).json({ exists: false, jid: 'unknow' });
    }
};

exports.ValidateToken = async (req, res, next) => {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    const { session } = req.params;
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        if (!decoded) {
            logger.debug({ session }, 'Erro ao iniciar: Autorização inválida');
            return res.status(401).json({ error: 'Autorização inválida' });
        }
        req.decoded = decoded;
        next();
    } catch (error) {
        logger.error({ session, token }, 'Erro ao iniciar: Autorização inválida');
        return res.status(401).json({ error: 'O token e invalido' });
    }
};

/**
 * Cria o objeto de mensagem com padrão da @baileys e posteriormente envia para o JID
 * @date 20/03/2023 17:19:45
 * @param { string } chat_id Maskeid do usuário da conexão
 * @param { number } conn_id ID da conexão
 * @param { string } jid JID do numero para o qual será enviado a mensagem
 * @param { object } msg Objeto de mensagem à ser enviado
 * @param { boolean | Array<String> } simulation Para siumlar o evento Typing (HUMANIZAR)
 */
async function PrepareAndSendMessage(uniqkey, jid, msg, simulation = false) {
    /* let msg = {
       type: 'text',
       title: '',
       forward: {},
       caption:'',
       footer: '',
       message: {
 
          image: '',
          audio: '',
          video: '',
          document: '',
          ptt:false,

          mimetype: '',
          fileName: '',

          text: '',
          quoted: '',
 
          mentions: [],
          react: {
             text: '',
             key: 0,
          },
          location: {
             latitude: 0,
             longitude: 0
          },
          vcard: {
             
             contacts: [{ displayName, vcard }],
          },
          buttons: [],
          templateButtons: [
             {
                type: 'urlButton',
                text: '',
                data: ''
             }
          ],
          section: {
             button: '',
             sections: [
                {
                   title: '',
                   rows: [
                      {
                         title: '',
                         description: ''
                      }
                   ]
                },
                {
                   title: '',
                   rows: [
                      {
                         title: '',
                         description: ''
                      }
                   ]
                }
             ]
          },
          listMessage: {},
          headerType
       },
    } */
    const createSections = async (section) => {
        return new Promise((resolve) => {
            let result = [];

            for (const sec of Object.values(section.sections)) {
                const title = sec.title;
                let options = [];
                for (const [i, row] of Object.entries(sec.rows)) {
                    options.push({ title: row.title, rowId: i, description: row.description ? row.description : '' });
                }

                result.push({
                    title: title,
                    rows: options
                });
            }
            resolve(result);
        });
    };
    const createButtons = async (buttonList) => {
        let buttons = [];
        for (let index = 0; index < buttonList.length; index++) {
            const element = buttonList[index];
            buttons.push({ buttonId: index, buttonText: { displayText: element }, type: 1 });
        }
        return buttons;
    };
    const createTemplateButtons = async (buttonList) => {
        let buttons = [];
        for (let index = 0; index < buttonList.length; index++) {
            const button = buttonList[index];

            switch (button.type) {
                case 'urlButton':
                    buttons.push({ index: index, urlButton: { displayText: button.text, url: button.data } });
                    break;
                case 'callButton':
                    buttons.push({ index: index, callButton: { displayText: button.text, phoneNumber: button.data } });
                    break;
                case 'quickReplyButton':
                    buttons.push({ index: index, quickReplyButton: { displayText: button.text, id: button.data } });
                    break;
            }
        }
        return buttons;
    };
    let quoted;
    let msg_send = {};
    if (msg.forward) msg_send.forward = msg.forward;
    if (msg.title) msg_send.title = msg.title;
    if (msg.message?.headerType) msg_send.headerType = msg.message.headerType;
    if (msg.footer) msg_send.footer = msg.footer;
    if (msg.caption) msg_send.caption = msg.caption;
    if (msg.message?.quoted) quoted = msg.message.quoted;
    if (msg.message?.text) msg_send.text = msg.message.text;
    if (msg.message?.image) msg_send.image = { url: msg.message.image };
    if (msg.message?.audio) msg_send.audio = { url: msg.message.audio };
    if (msg.message?.video) msg_send.video = { url: msg.message.video };
    if (msg.message?.document) msg_send.document = { url: msg.message.document };
    if (msg.message?.mimetype) msg_send.mimetype = msg.message.mimetype;
    if (msg.message?.ptt) msg_send.ptt = msg.message.ptt;
    if (msg.message?.fileName) msg_send.fileName = msg.message.fileName;
    if (msg.message?.mentions) msg_send.mentions = msg.message.mentions;
    if (msg.message?.react) msg_send.react = { text: msg.message.react.text, key: msg.message.react.key };
    if (msg.message?.location)
        msg_send.location = { degreesLatitude: msg.message.location.latitude, degreesLongitude: msg.message.location.longitude };
    if (msg.message?.vcard) msg_send.contacts = { contacts: msg.message.vcard.contacts };
    if (msg.message?.buttons) msg_send.buttons = await createButtons(msg.message.buttons);
    if (msg.message?.templateButtons) msg_send.templateButtons = await createTemplateButtons(msg.message.templateButtons);
    if (msg.message?.section) {
        msg_send.sections = await createSections(msg.message.section);
        msg_send.buttonText = msg.message.section.button;
    }

    const connection = onlineSessions.get(uniqkey);
    if (!connection) {
        logger.error({ uniqkey, jid }, 'erro ao enviar a mensagem. A sessao nao esta disponivel');
        return false;
    }

    logger.info({ msg_send, jid, quoted }, 'enviando mensagem');
    try {
        if (simulation && simulation.ActivateHumanizedSimulation) {
            await connection.utils.sendMessageWTyping(simulation, jid, msg_send, { quoted });
        } else {
            await connection.sock.sendMessage(jid, msg_send, { quoted });
        }
        return true;
    } catch (error) {
        logger.error({ msg_send, jid, quoted, error }, 'erro ao enviar a mensagem');
        console.log(error);
        return false;
    }
}

const verifyAuthentication = async (token) => {
    let response = {
        code: 0,
        msg: '',
        process: false,
        data: {}
    };
    if (!token) {
        response.code = 403;
        response.msg = 'Nenhuma credencial encontrada';
        return response;
    }

    const decoded = jwt.verify(token, JWT_SECRET);

    if (!decoded) {
        response.code = 403;
        response.msg = 'Autorização inválida';
        return response;
    }
    if (!Store.has(decoded.session)) {
        response.code = 406;
        response.msg = 'A sessão não existe';
        return response;
    }

    const sessionData = await Store.get(decoded.session);
    if (sessionData.uniqkey !== decoded.uniqkey) {
        response.code = 403;
        response.msg = 'A autorização é inválida para esta sessão, por favor atualize o token';
        return response;
    }
    response.data = decoded;
    response.process = true;
    return response;
};
const verifyRequestToSendMessage = async (auth, phone) => {
    let response = {
        code: 0,
        msg: '',
        process: false,
        auth: auth,
        data: {}
    };

    const connection = onlineSessions.get(auth.uniqkey);
    if (!connection) {
        response.code = 406;
        response.msg = 'Esta sessão não está conectada';
        return response;
    }

    const inProcess = inConnection.get(auth.uniqkey);
    if (inProcess) {
        response.code = 406;
        response.msg = 'Esta conexão ainda não está pronta';
        return response;
    }

    /* filter */
    let n = String(phone);
    n.replace(/[^0-9]/g, '');
    if (!n.startsWith('55')) n = '55' + n; /* replicar ok */

    const [result] = await connection.sock.onWhatsApp(n);
    if (!result?.exists) {
        response.code = 203;
        response.msg = 'O numero deste contato não foi encontrado';
        return response;
    }

    response.data = { jid: result.jid, connection: connection };
    response.process = true;
    return response;
};

(async () => {
    await Store.init();
    global.Store = Store;
    AutoReconnect();
})();
