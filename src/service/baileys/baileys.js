const makeWASocket = require('@adiwajshing/baileys').default;
const { WAProto, delay, downloadMediaMessage, DisconnectReason, isJidBroadcast, isJidGroup, makeCacheableSignalKeyStore, jidNormalizedUser, fetchLatestBaileysVersion, useMultiFileAuthState, WA_DEFAULT_EPHEMERAL, downloadContentFromMessage, Browsers } = require('@adiwajshing/baileys')
const path = require('path');
const fs = require('fs');
const { toDataURL } = require('qrcode')
const logger = require('../logger').default;
const { makeInMemoryStore } = require("./store");
const { Boom } = require('@hapi/boom');
const msgRetryCounterMap = {};

const storeSaveId = new Map([]);
const storeReadedId = new Map([]);
const sessions = new Map([]);
exports.onlineSessions = sessions;
const retries = new Map([]);
const qrgenerations = new Map([]);
const inConnection = new Map([]);
const downloadingMedia = new Map([]);
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
}, 10_000)

/**
 * Verifica o numero de tentativas da conexão
 * @param chat_id String contendo o id do da conexão
*/
function shouldReconnect(id) {
    let attempts = retries.get(id) ?? 0;

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
    userStore.writeToFile((path.resolve(storepath, `store_conn_${session}.json`)))
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

    const storeFile = (path.resolve(storepath, `store_conn_${session}.json`));
    fs.existsSync(storeFile) && userStore.readFromFile(storeFile);

    !storeReadedId.get(uniqkey) && storeReadedId.set(uniqkey, storeFile);
    return true;
}

/**
 * Envia uma mensagem de forma 'Humanizada' (útil para os bots)
 * @param sock Socket da conexão
 * @param msg Objeto de mensagem
 * @param remoteJid O JID do destinatário
 * @param replay replay da mensagem
*/
async function sendMessageWTyping(sock, msg, remoteJid, replay) {
    return new Promise(async (resolve) => {
        if (!replay) { replay = {} }
        replay.disappearingMessagesInChat = false;
        await sock.presenceSubscribe(remoteJid)
        await delay(500)
        await sock.sendPresenceUpdate('composing', remoteJid)
        await delay(2000)
        await sock.sendPresenceUpdate('paused', remoteJid)
        const response = await sock.sendMessage(remoteJid, msg, replay);
        resolve(response)
    })
}
/**
 * Envia uma mensagem por vez... 
 * @param sock Socket de conexão da baileys
*/
async function sendMessage(sock, remoteJid, msg, reply) {
    return new Promise(async (resolve) => {
        if (!sock) return false;
        const response = sock.sendMessage(remoteJid, msg, reply)
        await delay(1_000);
        resolve(response);
    })
}
/**
 * Fornece os contatos da lista telefônica do dispositivo da conexão 
 * @param store STORE do usuário da conexão
*/
async function PhoneContacts(store, jid_conn) {
    const phoneContacts = store.phoneContacts;


    const updatedArray = Object.values(phoneContacts).map((contact) => ({
        ...contact,
        jid_conn: jid_conn
    }));
    console.log('contatos da conexão atual: ', !phoneContacts && '0' || Object.values(updatedArray).length);
    return updatedArray;
}

exports.StartSession = async (session, uniqkey, res = null) => {
    let connectionState = { connection: 'close' };
    const connStore = makeInMemoryStore({ logger });
    let qr = inConnection.get(uniqkey);

    if (qr) {
        console.log('Esta conexão não pode ser realizada, pois uma instancia ainda está se conectando');
        logger.debug({ session, uniqkey }, ' Abortando... conexão já em andamento');
        return res?.status(200).json({
            error: 'Este QR Code já está gerado. Favor realizar a leitura',
            qr
        });
    }

    inConnection.set(uniqkey, true);

    const exclude = async (logout = true) => {
        sock.logout()
        await destroy();
        if (fs.existsSync(tokenpath)) fs.rmdirSync(tokenpath, { recursive: true, force: true });
       
        let sessionData = await global.Store.get(session);
        delete (sessionData.connection)
        global.Store.set(session, sessionData);

    };

    const destroy = async (logout = true) => {
        try {
            await Promise.all([
                logout &&
                sock.ws.close(),
                sock.ev.removeAllListeners(),
                sock.logout(),
                delete sock,
                sock = null,
            ]);
        } catch (e) {
            logger.error(e, 'Ocorreu um erro durante a destruíção da sessão');
        } finally {
            sessions.delete(uniqkey);
            retries.delete(uniqkey);
            qrgenerations.delete(uniqkey);
            storeReadedId.delete(uniqkey)
            RemoveStoreSaveID(uniqkey);
            inConnection.delete(uniqkey)
        }
    };
    const handleConnectionClose = async () => {
        logger.debug({ uniqkey, session }, ' A conexão foi fechada');

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
            logger.info({ attempts: retries.get(session) ?? 1, session, uniqkey }, 'Reconnecting...');
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
                logger.error(e, 'An error occured during QR generation');
                console.log('[LinxSys-Baileys]:: Houve um erro na geração do QRCode', uniqkey);
                /* 
                webhook QRCode fail
                */
                res?.status(500).json({
                    error: 'Houve um erro durante a geração do QR Code'
                });
                return
            }
            if ((qr && currentGenerations >= WA_MAX_QR_GENERATION)) {
                console.log('[LinxSys-Baileys]:: Geração máxima de QRCodes atingidas, favor abrir uma nova sessão', uniqkey);
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
        logger.debug({ uniqkey }, ' A conexão foi está aberta');
        console.log('[LinxSys-Baileys]:: Whatsapp Conectado ->', jidNormalizedUser(sock.user.id));

        let foto;
        try {
            foto = await sock.profilePictureUrl(jidNormalizedUser(sock.user.id))
        } catch (error) {
            foto = '';
        }

        const numero = jidNormalizedUser(sock.user.id).replace("@s.whatsapp.net", "");
        let sessionData = await global.Store.get(session);
        sessionData.connection = {
            id: uniqkey,
            nome: sock.user.name,
            numero: numero,
            image: foto
        }

        global.Store.set(session, sessionData);

        const utils = {
            sendMessage: async (remoteJid, msg, reply) => await sendMessage(sock, remoteJid, msg, reply),
            sendMessageWTyping: async (remoteJid, msg, replay) => await sendMessageWTyping(sock, msg, remoteJid, replay),
        }
        sessions.set(uniqkey, { sock, destroy, exclude, connStore, session, utils });

        inConnection.delete(uniqkey);
        console.log('[LinxSys-Baileys]:: A conexão está pronta para o uso');
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

    const { version, isLatest } = await fetchLatestBaileysVersion()
    const { state, saveCreds } = await useMultiFileAuthState(tokenpath);


    ReadStore(session, uniqkey, connStore);
    storeSaveId.set(uniqkey, session);


    logger.debug({ session }, `using WA v${version.join('.')}, isLatest: ${isLatest}`);
    logger.debug({ session }, ' Carregando store da conexão');

    const sock = makeWASocket({
        version,
        logger,
        printQRInTerminal: true,
        emitOwnEvents: true,
        auth: {
            creds: state.creds,
            /** caching makes the store faster to send/recv messages */
            keys: makeCacheableSignalKeyStore(state.keys, logger),
        },
        msgRetryCounterMap,
        generateHighQualityLinkPreview: true,
        // ignore all broadcast messages -- to receive the same
        // comment the line below out
        shouldIgnoreJid: jid => isJidBroadcast(jid),
        browser: Browsers.ubuntu('Desktop'),
        syncFullHistory: true,
        options: {
            headers: {
                'If-Match': '*'
            }
        },
        // implement to handle retries
        getMessage: async key => {
            if (connStore) {
                const msg = await connStore.loadMessage(key.remoteJid, key.id)
                return msg?.message || undefined
            }

            // only if store is present
            return {
                conversation: 'hello'
            }
        },
        patchMessageBeforeSending: (message) => {
            const requiresPatch = !!(
                message.buttonsMessage
                || message.templateMessage
                || message.listMessage
            );
            if (requiresPatch) {
                message = {
                    viewOnceMessage: {
                        message: {
                            messageContextInfo: {
                                deviceListMetadataVersion: 2,
                                deviceListMetadata: {},
                            },
                            ...message,
                        },
                    },
                };
            }
            return message;
        }
    })

    connStore?.bind(sock.ev)
    sessions.set(uniqkey, { ...sock, destroy, connStore, session });

    /* ESCUTA DE EVENTOS */
    sock.ev.on('creds.update', saveCreds)

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        connectionState = update;

        if (connection === 'open') {
            retries.delete(session);
            qrgenerations.delete(session);
            handleConnectionOpen();
        }
        if (connection === 'close') handleConnectionClose();
        handleConnectionUpdate();
    });
    /* 
        sock.ev.on('messages.upsert', async (upsert) => {
    
            var chat = {
                conn: conn_id,
                nick: upsert.messages[0].pushName,
                key: upsert.messages[0].key,
                jid: upsert.messages[0].key.remoteJid,
                hasNewMessage: true,
                buttonResponse: await FindMsgButtonResponse(upsert),
                listResponse: await FindMsgListResponse(upsert),
                messages: upsert.messages,
                info: upsert.messages[0].message,
                type: upsert.messages[0] && upsert.messages[0].message ? Object.keys(upsert.messages[0].message)[0] : '',
                msg: await FindMsgText(upsert)
            }
            io.sockets.emit("atualizar " + chat_id, chat, conn_id);
            Callback(chat);
        })
        sock.ev.on('messages.delete', async (update) => {
    
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

}

exports.sessionExists = (key) => {
    return global.Store.has(key)
}
