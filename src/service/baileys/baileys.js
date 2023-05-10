const makeWASocket = require('@adiwajshing/baileys').default;
const {
    DisconnectReason,
    isJidBroadcast,
    isJidGroup,
    makeCacheableSignalKeyStore,
    jidNormalizedUser,
    fetchLatestBaileysVersion,
    useMultiFileAuthState,
    Browsers
} = require('@adiwajshing/baileys');
const path = require('path');
const fs = require('fs');
const { toDataURL } = require('qrcode');
const logger = require('../logger').default;
const { makeInMemoryStore } = require('./store');
const { Boom } = require('@hapi/boom');
const msgRetryCounterMap = {};

const storeSaveId = new Map([]);
const storeReadedId = new Map([]);
const sessions = new Map([]);
exports.onlineSessions = sessions;
const retries = new Map([]);
const qrgenerations = new Map([]);
const inConnection = new Map([]);
exports.inConnection = inConnection;

const WA_RECONNECT_INTERVAL = process.env.RECONNECT_INTERVAL || 0;
const WA_MAX_RECONNECT_RETRIES = process.env.MAX_RECONNECT_RETRIES || 3;
const WA_MAX_QR_GENERATION = process.env.SSE_MAX_QR_GENERATION || 3;

// save every 10s
setInterval(async () => {
    let c_conns = 0;
    for (const [uniqkey, session] of sessions.entries()) {
        if (!session.connStore) {
            sessions.delete(uniqkey);
            continue;
        }
        !storeReadedId.get(uniqkey) && ReadStore(session.session, uniqkey, session.connStore);
        UpdateStore(session.session, uniqkey, session.connStore);
        c_conns++;
    }
    console.log(`[LinxSys-Baileys]:: Stores atualizados -> Sessões: ${storeReadedId.size}, Conexões: ${c_conns}`);
}, 10000);

/**
 * Verifica o numero de tentativas da conexão
 * @param chat_id String contendo o id do da conexão
 */
function shouldReconnect(id) {
    let attempts = retries.get(id) || 0;

    if (attempts < WA_MAX_RECONNECT_RETRIES) {
        attempts += 1;
        retries.set(id, attempts);
        return true;
    }
    return false;
}

/**
 * Atualiza o store da conexão
 * @param chat_id String contendo o id do da conexão
 */
async function RemoveStoreSaveID(uniqkey) {
    storeSaveId.delete(uniqkey);
}

/**
 * Atualiza o store da conexão
 * @param chat_id String contendo o id do da conexão
 */
async function UpdateStore(session, uniqkey, userStore) {
    if (!userStore) return false;
    const storepath = path.join(__dirname, `./cache/${uniqkey}/store/`);
    !fs.existsSync(storepath) && fs.mkdirSync(storepath, { recursive: true, force: true });
    userStore.writeToFile(path.resolve(storepath, `store_conn_${session}.json`));
    return true;
}

/**
 * Carrega o store da conexão
 * @param conn_key String contendo o id do da conexão
 * @param userStore String contendo o STORE da conexão
 */
async function ReadStore(session, uniqkey, userStore) {
    if (!userStore) return false;

    const storepath = path.join(__dirname, `./cache/${uniqkey}/store/`);
    !fs.existsSync(storepath) && fs.mkdirSync(storepath, { recursive: true, force: true });

    const storeFile = path.resolve(storepath, `store_conn_${session}.json`);
    fs.existsSync(storeFile) && userStore.readFromFile(storeFile);

    !storeReadedId.get(uniqkey) && storeReadedId.set(uniqkey, storeFile);
    return true;
}

/**
 * Aguarda um determinado tempo em milisegundos
 * @date 03/05/2023 - 18:04:15
 *
 * @param {number} ms
 * @returns {Promisse<void>}
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Envia uma mensagem de forma 'Humanizada' (útil para os bots)
 * @param sock Socket da conexão
 * @param msg Objeto de mensagem
 * @param remoteJid O JID do destinatário
 * @param replay replay da mensagem
 */
async function sendMessageWTyping(simulation, sock, msg, remoteJid, replay) {
    if (!replay) {
        replay = {};
    }
    replay.disappearingMessagesInChat = false;
    const params = await MountSimulationOptions(simulation, msg);
    try {
        sock.presenceSubscribe(remoteJid);
        sock.sendPresenceUpdate('available', remoteJid);
        await sleep(params.startDelay);
        sock.sendPresenceUpdate(params.presenceType, remoteJid);
        await sleep(params.endDelay);

        const result = await sendMessage(sock, remoteJid, msg, replay);
        sock.sendPresenceUpdate('paused', remoteJid);
        return result;
    } catch (error) {
        logger.error(error, 'Erro ao enviar a mensagem');
        return false;
    }
}

/**
 * Envia uma mensagem por vez...
 * @param sock Socket de conexão da baileys
 */
async function sendMessage(sock, remoteJid, msg, reply) {
    if (!sock) return false;
    await sock
        .sendMessage(remoteJid, msg, reply)
        .then(() => {
            return true;
        })
        .catch((erro) => {
            console.log(erro);
            return false;
        });
}

/**
 * Opções padrões da simulação
 * @date 03/05/2023 - 18:03:43
 *
 * @type {{ ActivateHumanizedSimulation: boolean; AudioBasedRecordingSpeed: boolean; TypingSpeed: number; AudioRecordingSpeed: number; }}
 */
const SimulationDefaultOptions = {
    ActivateHumanizedSimulation: false,
    AudioBasedRecordingSpeed: true,
    TypingSpeed: 300,
    AudioRecordingSpeed: 2000
};

/**
 * Constrói os parametros de simulação...
 * @param options Opções para criaçao da simulação
 */
async function MountSimulationOptions(simulation, msg) {
    simulation = Object.assign({}, SimulationDefaultOptions, simulation);
    let params = {
        presenceType: 'composing',
        startDelay: 500,
        endDelay: 2000
    };

    if (simulation) {
        switch (simulation.type) {
            case 'image':
                params.endDelay = msg.caption.length * simulation.TypingSpeed;
                params.presenceType = 'composing';
                break;
            case 'audio':
                params.endDelay = simulation.AudioRecordingSpeed;
                params.presenceType = 'recording';
                break;
            case 'text':
                params.endDelay = msg.text.length * simulation.TypingSpeed;
                params.presenceType = 'composing';
                break;
        }
    }

    return params;
}

/**
 * Localiza o texto da mensagem
 * @param upsert Objeto de mensagem à ser pesquisado
 */
async function FindMsgText(upsert) {
    let objMessage = upsert.messages[0]?.message || {};

    let text =
        objMessage.conversation ||
        objMessage.extendedTextMessage?.text ||
        objMessage.ephemeralMessage?.message?.extendedTextMessage?.text ||
        objMessage.buttonsResponseMessage?.selectedDisplayText ||
        objMessage.listResponseMessage?.title ||
        objMessage.imageMessage?.caption ||
        objMessage.audioMessage?.caption ||
        objMessage.documentMessage?.caption ||
        objMessage.videoMessage?.caption ||
        objMessage.viewOnceMessage?.message?.listMessage?.description ||
        '';
    return text;
}

/**
 * Localiza a resposta de botões da mensagem
 * @param upsert Objeto de mensagem à ser pesquisado
 */
async function FindMsgButtonResponse(upsert) {
    let btnResponse = upsert.messages[0]?.message?.buttonsResponseMessage?.selectedButtonId ?? false;
    return btnResponse;
}

/**
 * Localiza a resposta de listas da mensagem
 * @param upsert Objeto de mensagem à ser pesquisado
 */
async function FindMsgListResponse(upsert) {
    let listResponse = upsert.messages[0]?.message?.listResponseMessage?.singleSelectReply?.selectedRowId ?? false;
    return listResponse;
}

/**
 * Cria uma nova sessão do whatsapp
 * @date 03/05/2023 - 18:06:32
 *
 * @async
 * @param {string|number} session
 * @param {string} uniqkey
 * @param {Response} [res=null]
 * @param {string} [webhook=null]
 * @returns {Promisse<void>}
 */
exports.StartSession = async (session, uniqkey, res = null, webhook = null) => {
    if (webhook) console.log('Session starting with webhook ', webhook);
    logger.info({ session, webhook, uniqkey }, 'Iniciando sessão');
    let connectionState = { connection: 'close' };
    const connStore = makeInMemoryStore({ logger });
    let qr = inConnection.get(uniqkey);

    if (qr) {
        console.log('Esta conexão não pode ser realizada, pois uma instancia ainda está se conectando', session);
        logger.debug({ session, uniqkey }, ' Abortando... conexão já em andamento');
        return res?.status(200).json({
            error: 'Este QR Code já está gerado. Favor realizar a leitura',
            qr
        });
    }

    inConnection.set(uniqkey, true);

    const exclude = async (logout = true) => {
        sock.logout();
        await destroy(logout);
        if (fs.existsSync(tokenpath)) fs.rmdirSync(tokenpath, { recursive: true, force: true });
    };

    const destroy = async (logout = true) => {
        logger.info('destruindo sessão', 'Fechar socket?:' + logout, uniqkey, session);
        try {
            await Promise.all([logout && sock.ws.close(), sock.ev.removeAllListeners(), sock.logout() /* , delete sock, (sock = null) */]);
        } catch (e) {
            logger.error(e, 'Ocorreu um erro durante a destruíção da sessão');
        } finally {
            sessions.delete(uniqkey);
            retries.delete(uniqkey);
            qrgenerations.delete(uniqkey);
            storeReadedId.delete(uniqkey);
            RemoveStoreSaveID(uniqkey);
            inConnection.delete(uniqkey);

            let sessionData = await global.Store.get(session);
            delete sessionData.connection;
            global.Store.set(session, sessionData);
        }
    };
    const handleConnectionClose = async () => {
        logger.info({ uniqkey, session }, ' A conexão foi fechada');

        /* 
        webhook connection close
        
        */

        const code = new Boom(connectionState.lastDisconnect?.error)?.output?.statusCode;
        const restartRequired = code === DisconnectReason.restartRequired;
        const doNotReconnect = !shouldReconnect(session);
        const loggedout = code === DisconnectReason.loggedOut;
        console.log(`[LinxSys-Baileys]:: Conexão fechada-> ${code}|${connectionState}|${doNotReconnect}`);
        if (loggedout || doNotReconnect) {
            res?.status(200).json({
                error: 'A sessão não pode ser reconectada, favor escanear o QRCode novamente'
            });
            console.log('[LinxSys-Baileys]:: A sessão não pode ser reconectada, favor escanear o QRCode novamente');
            logger.error({ code, connectionState, doNotReconnect }, ' A sessão não pode ser reconectada');
            /* 
            webhook QRCode fail
                   
            */

            if (loggedout && fs.existsSync(tokenpath)) fs.rmdirSync(tokenpath, { recursive: true, force: true });
            destroy(loggedout);
            return;
        }

        if (!restartRequired) {
            logger.info({ attempts: retries.get(session) ?? 1, session, uniqkey }, 'Reconectando sessão...');
        }
        console.log('[LinxSys-Baileys]:: Reiniciando a conexão');
        setTimeout(() => this.StartSession(session, uniqkey, res), restartRequired ? 0 : WA_RECONNECT_INTERVAL);
    };
    const handleConnectionUpdate = async () => {
        logger.debug({ uniqkey, session }, ' A conexão foi atualziada');

        const currentGenerations = qrgenerations.get(uniqkey) ?? 0;
        let qr = '';

        if (connectionState.qr?.length) {
            try {
                qr = await toDataURL(connectionState.qr);
            } catch (e) {
                logger.error(e, 'Ocorreu um erro durante a geração do qrcode');
                console.log('[LinxSys-Baileys]:: Houve um erro na geração do QRCode', uniqkey, session);
                /* 
                webhook QRCode fail
                */
                res?.status(500).json({
                    error: 'Houve um erro durante a geração do QR Code'
                });
                return;
            }
            if (qr && currentGenerations >= WA_MAX_QR_GENERATION) {
                console.log('[LinxSys-Baileys]:: Geração máxima de QRCodes atingidas, favor abrir uma nova sessão', uniqkey, session);
                logger.info({ uniqkey, session }, 'Geração máxima de QRCodes atingidas, favor abrir uma nova sessão');
                /* 
               webhook QRCode max generated
               */
                res?.status(200).json({
                    error: 'Numero máximo de QR Codes foi atingido'
                });

                qrgenerations.set(uniqkey, 0);
                destroy();
                return;
            }
            if (qr) qrgenerations.set(uniqkey, currentGenerations + 1);

            res?.status(200).json({
                message: 'Leia o qrcode',
                qr
            });
            /* 
               webhook QRCode send
               */

            inConnection.set(uniqkey, qr);
        } else {
            /* 
               webhook QRCode Read
               */
            inConnection.delete(uniqkey);
        }
    };
    const handleConnectionOpen = async () => {
        logger.info({ uniqkey }, ' A conexão foi está aberta');
        console.log('[LinxSys-Baileys]:: Whatsapp Conectado ->', jidNormalizedUser(sock.user.id));

        let foto;
        try {
            foto = await sock.profilePictureUrl(jidNormalizedUser(sock.user.id));
        } catch (error) {
            foto = '';
        }

        const numero = jidNormalizedUser(sock.user.id).replace('@s.whatsapp.net', '');
        let sessionData = await global.Store.get(session);
        if (webhook) global.webhook.add(uniqkey, webhook);

        sessionData.connection = {
            id: uniqkey,
            nome: sock.user.name,
            numero: numero,
            image: foto,
            webhook: webhook
        };

        global.Store.set(session, sessionData);

        const utils = {
            sendMessage: async (remoteJid, msg, reply) => await sendMessage(sock, remoteJid, msg, reply),
            sendMessageWTyping: async (simulation, remoteJid, msg, replay) =>
                await sendMessageWTyping(simulation, sock, msg, remoteJid, replay)
        };
        sessions.set(uniqkey, { sock, destroy, exclude, connStore, session, utils });

        inConnection.delete(uniqkey);
        console.log('[LinxSys-Baileys]:: A conexão está pronta para o uso');
        logger.info({ uniqkey, session }, 'Conexão pronta para o uso');
        /* 
        webhook Connection Open
        */

        res?.status(200).json({
            message: 'Conectado',
            connection: sessionData.connection
        });
    };

    const tokenpath = path.join(__dirname, `./cache/${uniqkey}/token/conn_${session}`);
    !fs.existsSync(tokenpath) && fs.mkdirSync(tokenpath, { recursive: true, force: true });

    const { version, isLatest } = await fetchLatestBaileysVersion();
    const { state, saveCreds } = await useMultiFileAuthState(tokenpath);

    ReadStore(session, uniqkey, connStore);
    storeSaveId.set(uniqkey, session);

    logger.debug({ uniqkey, session }, `using WA v${version.join('.')}, isLatest: ${isLatest}`);
    logger.info({ uniqkey, session }, ' Carregando store da conexão');

    const sock = makeWASocket({
        version,
        logger,
        printQRInTerminal: true,
        emitOwnEvents: true,
        auth: {
            creds: state.creds,
            /** caching makes the store faster to send/recv messages */
            keys: makeCacheableSignalKeyStore(state.keys, logger)
        },
        msgRetryCounterMap,
        generateHighQualityLinkPreview: true,
        // ignore all broadcast messages -- to receive the same
        // comment the line below out
        shouldIgnoreJid: (jid) => isJidBroadcast(jid),
        browser: Browsers.ubuntu('Desktop'),
        syncFullHistory: true,
        options: {
            headers: {
                'If-Match': '*'
            }
        },
        // implement to handle retries
        getMessage: async (key) => {
            if (connStore) {
                const msg = await connStore.loadMessage(key.remoteJid, key.id);
                return msg?.message || undefined;
            }

            // only if store is present
            return {
                conversation: 'hello'
            };
        },
        patchMessageBeforeSending: (message) => {
            const requiresPatch = !!(message.buttonsMessage || message.templateMessage || message.listMessage);
            if (requiresPatch) {
                message = {
                    viewOnceMessage: {
                        message: {
                            messageContextInfo: {
                                deviceListMetadataVersion: 2,
                                deviceListMetadata: {}
                            },
                            ...message
                        }
                    }
                };
            }
            return message;
        }
    });

    connStore?.bind(sock.ev);
    sessions.set(uniqkey, { ...sock, destroy, connStore, session });

    /* ESCUTA DE EVENTOS */
    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        logger.debug({ update }, ' connection.update');
        const { connection } = update;
        connectionState = update;

        if (connection === 'open') {
            retries.delete(session);
            qrgenerations.delete(session);
            handleConnectionOpen();
        }
        if (connection === 'close') handleConnectionClose();
        handleConnectionUpdate();
    });

    sock.ev.on('messages.upsert', async (upsert) => {
        logger.debug({ upsert }, ' messages.upsert');
        const chat = {
            event: 'onmessage',
            session: session,
            sessionUniqkey: uniqkey,
            notifyName: upsert.messages[0].pushName,
            key: upsert.messages[0].key,
            from: upsert.messages[0].key.remoteJid,
            hasNewMessage: true,
            buttonResponse: await FindMsgButtonResponse(upsert),
            listResponse: await FindMsgListResponse(upsert),
            type: upsert.messages[0] && upsert.messages[0].message ? Object.keys(upsert.messages[0].message)[0] : '',
            body: await FindMsgText(upsert)
        };

        if (chat.key.fromMe || isJidBroadcast(chat.from) || isJidGroup(chat.from)) {
            return;
        }
        if (webhook) global.webhook.trigger(uniqkey, chat);
    });
    /* sock.ev.on('messages.delete', async (update) => {

        io.sockets.emit("messages.delete " + chat_id, { id: update.keys[0].id, jid: update.keys[0].remoteJid }, conn_id)
    })
    sock.ev.on('messages.update', async (update) => {

        for (const up of update) {
            const upmsg = up.update?.message
            if (upmsg === null) {
                io.sockets.emit("messages.delete " + chat_id, { id: update[0].key.id }, conn_id)
            }
        }


    }) */

    /* 
        sock.ev.on('contacts.update', async (update) => {
            for (const contact of update) {
                if (typeof contact.imgUrl !== 'undefined') {
                    const newUrl = contact.imgUrl === null ? null : await sock.profilePictureUrl(contact.id).catch(() => null)
                }
            }
        })
        sock.ev.on('contacts.upsert', async (upsert) => {
            console.log('[LinxSys-Baileys]:: Contatos recebidos: ', Object.keys(upsert).length);
        })
     */
    /*     
        sock.ev.on('chats.update', async (update) => {
            io.sockets.emit("chats.update " + chat_id, update, conn_id)
        })
        sock.ev.on('chats.upsert', async (upsert) => {
            io.sockets.emit("chats.update " + chat_id, upsert, conn_id)
        })
    
        sock.ev.on('presence.update', async (event) => io.sockets.emit("presence " + chat_id, event, conn_id))
    
     */
};

/**
 * Verfica se uma determinada sessão está ativa
 * @date 03/05/2023 - 18:07:05
 *
 * @param {string|number} key
 */
exports.sessionExists = (key) => {
    return global.Store.has(key);
};
