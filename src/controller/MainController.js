const { StartSession, onlineSessions, inConnection } = require('../service/baileys/baileys');
const AppStore = require('../service/AppMemory/memory').default
const crypto = require('crypto');
const Store = AppStore();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const JWT_SECRET = 'RDA36fçssa1'


const AutoReconnect = async () => {
    const sessions = Store.getall();
    for (const [session, data] of sessions) {
        if (!data.connection) continue;
        console.log('Iniciando Auto Conexão para: ', data.uniqkey);
        await StartSession(session, data.connection.id)
    }
}




exports.SessionAdd = async (req, res, next) => {
    const { session } = req.body;

    if (!session) {
        return res.status(200).json({
            message: 'Parametros incorretos'
        });
    }

    const uniqkey = crypto.randomUUID();

    const token = jwt.sign({ session, uniqkey }, JWT_SECRET);
    if (Store.has(session)) {
        return res.status(406).json({
            error: 'A sessão já existe'
        });
    }
    Store.set(session, {
        uniqkey,
        token
    });
    return res.status(200).json({
        token
    });

}


exports.SessionStart = async (req, res, next) => {
    const { session } = req.params;
    const token = req.header('Authorization')?.replace('Bearer ', '');

    if (!session) {
        return res.status(400).json({ error: 'Requisição incompleta' });
    }
    if (!token) {
        return res.status(403).json({ error: 'Nenhuma credencial encontrada' });
    }

    const decoded = jwt.verify(
        token,
        JWT_SECRET
    );

    if (!decoded) {
        return res.status(403).json({ error: 'Autorização inválida' });
    }
    if (!Store.has(decoded.session)) {
        return res.status(406).json({
            error: 'A sessão não existe'
        });
    }
    const sessionData = await Store.get(decoded.session);

    if (onlineSessions.get(sessionData.uniqkey)) {
        return res.status(406).json({
            error: 'A sessão já está conectada',
            connection: sessionData.connection
        });
    }
    onlineSessions
    inConnection
    StartSession(session, sessionData.uniqkey, res)

}

exports.SessionDelete = async () => {

}

exports.SendText = async (req, res, next) => {
    const { session } = req.params;
    const { number, body } = req.body;
    const token = req.header('Authorization')?.replace('Bearer ', '');

    if (!session || !number || !body) {
        return res.status(400).json({ error: 'Requisição incompleta' });
    }
    if (!token) {
        return res.status(403).json({ error: 'Nenhuma credencial encontrada' });
    }

    const decoded = jwt.verify(
        token,
        JWT_SECRET
    );

    if (!decoded) {
        return res.status(403).json({ error: 'Autorização inválida' });
    }
    if (!Store.has(decoded.session)) {
        return res.status(406).json({
            error: 'A sessão não existe'
        });
    }

    const connection = onlineSessions.get(decoded.uniqkey);
    if (!connection) {
        return res.status(406).json({ error: 'Esta sessão não está conectada' });
    }
    try {
        const send = await PrepareAndSendMessage(decoded.uniqkey, number + '@s.whatsapp.net', {
            message: {
                text: body
            }
        })

        if (!send) {
            return res.status(406).json({ error: 'Não foi possível enviar a mensagem' });
        }
        return res.status(200).json({ error: 'mensagem enviada' });
    } catch (error) {
        console.log(error);
        return res.status(500).json({ error: 'Não foi possível enviar a mensagem' });
    }
}

exports.ValidateNumber = async (req, res, next) => {
    const { session, number } = req.params;
    const token = req.header('Authorization')?.replace('Bearer ', '');

    if (!session || !number) {
        return res.status(400).json({ error: 'Requisição incompleta' });
    }
    if (!token) {
        return res.status(403).json({ error: 'Nenhuma credencial encontrada' });
    }

    const decoded = jwt.verify(
        token,
        JWT_SECRET
    );

    if (!decoded) {
        return res.status(403).json({ error: 'Autorização inválida' });
    }
    if (!Store.has(decoded.session)) {
        return res.status(406).json({
            error: 'A sessão não existe'
        });
    }

    const connection = onlineSessions.get(decoded.uniqkey);
    if (!connection) {
        return res.status(406).json({ error: 'Esta sessão não está conectada' });
    }

    /* TO-DO */

    try {
        const [result] = await connection.sock.onWhatsApp(number)
        if (result.exists) {
            return res.status(200).json({ exists: true, jid: result.jid });
        }
       
    } catch (error) {
        console.log(error);
        return res.status(200).json({ exists: false, jid: 'unknow' });
    }
}


/**
 * Cria o objeto de mensagem com padrão da @baileys e posteriormente envia para o JID
 * @date 20/03/2023 17:19:45
 * @param { string } chat_id Maskeid do usuário da conexão
 * @param { number } conn_id ID da conexão
 * @param { string } jid JID do numero para o qual será enviado a mensagem
 * @param { object } msg Objeto de mensagem à ser enviado
 * @param { boolean } simulate Para siumlar o evento Typing (HUMANIZAR)
 */
async function PrepareAndSendMessage(uniqkey, jid, msg, simulate = false) {

    /* let msg = {
       type: 'text',
       title: '',
       forward: {},
       caption:'',
       footer: '',
       message: {
 
          image: '',
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
        return new Promise((resolve, reject) => {
            let result = [];

            for (const [key, sec] of Object.entries(section.sections)) {
                /* const sec = section.sections[index]; */
                const title = sec.title;
                let options = [];
                for (const [i, row] of Object.entries(sec.rows)) {
                    /*  const row = sec.rows[index]; */
                    options.push({ title: row.title, rowId: i, description: row.description ? row.description : '' })

                }

                result.push({
                    title: title,
                    rows: options
                })
            }
            resolve(result);

        })

    }
    const createButtons = async (buttonList) => {
        let buttons = [];
        for (let index = 0; index < buttonList.length; index++) {
            const element = buttonList[index];
            buttons.push({ buttonId: index, buttonText: { displayText: element }, type: 1 })
        }
        return buttons;
    }
    const createTemplateButtons = async (buttonList) => {
        let buttons = [];
        for (let index = 0; index < buttonList.length; index++) {
            const button = buttonList[index];

            switch (button.type) {
                case 'urlButton':
                    buttons.push({ index: index, urlButton: { displayText: button.text, url: button.data } })
                    break;
                case 'callButton':
                    buttons.push({ index: index, callButton: { displayText: button.text, phoneNumber: button.data } })
                    break;
                case 'quickReplyButton':
                    buttons.push({ index: index, quickReplyButton: { displayText: button.text, id: button.data } })
                    break;
            }
        }
        return buttons;
    }
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
    if (msg.message?.mentions) msg_send.mentions = msg.message.mentions;
    if (msg.message?.react) msg_send.react = { text: msg.message.react.text, key: msg.message.react.key };
    if (msg.message?.location) msg_send.location = { degreesLatitude: msg.message.location.latitude, degreesLongitude: msg.message.location.longitude };
    if (msg.message?.vcard) msg_send.contacts = { contacts: msg.message.vcard.contacts };
    if (msg.message?.buttons) msg_send.buttons = await createButtons(msg.message.buttons);
    if (msg.message?.templateButtons) msg_send.templateButtons = await createTemplateButtons(msg.message.templateButtons);
    if (msg.message?.section) { msg_send.sections = await createSections(msg.message.section); msg_send.buttonText = msg.message.section.button }

    const connection = onlineSessions.get(uniqkey);
    if (!connection) {
        return false;
    }

    try {
        if (simulate) {
            await connection.utils.sendMessageWTyping(jid, msg_send, { quoted })
        } else {
            await connection.sock.sendMessage(jid, msg_send, { quoted })
        }
        return true;
    } catch (error) {
        console.error(error);
        return false
    }


}



(async () => {
    await Store.init();
    global.Store = Store;
    AutoReconnect();
})()

