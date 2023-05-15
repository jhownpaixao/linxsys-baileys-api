'use strict';
var __importDefault =
    (this && this.__importDefault) ||
    function (mod) {
        return mod && mod.__esModule ? mod : { default: mod };
    };
Object.defineProperty(exports, '__esModule', { value: true });
exports.waMessageID = exports.waChatKey = void 0;
const {
    WAProto,
    DEFAULT_CONNECTION_CONFIG,
    jidNormalizedUser,
    toNumber,
    updateMessageWithReceipt,
    updateMessageWithReaction
} = require('@whiskeysockets/baileys');
const make_ordered_dictionary_1 = __importDefault(require('./make-ordered-dictionary'));
const waChatKey = (pin) => ({
    key: (c) =>
        (pin ? (c.pinned ? '1' : '0') : '') +
        (c.archived ? '0' : '1') +
        (c.conversationTimestamp ? c.conversationTimestamp.toString(16).padStart(8, '0') : '') +
        c.id,
    compare: (k1, k2) => k2.localeCompare(k1)
});
exports.waChatKey = waChatKey;
const waMessageID = (m) => m.key.id || '';
exports.waMessageID = waMessageID;
const makeMessagesDictionary = () => (0, make_ordered_dictionary_1.default)(exports.waMessageID);
exports.default = ({ logger: _logger, chatKey }) => {
    const logger = _logger || DEFAULT_CONNECTION_CONFIG.logger.child({ stream: 'in-mem-store' });
    chatKey = chatKey || (0, exports.waChatKey)(true);
    const KeyedDB = require('@adiwajshing/keyed-db').default;
    const chats = new KeyedDB(chatKey, (c) => c.id);
    const messages = {};
    const contacts = {};
    const phoneContacts = {};
    const groupMetadata = {};
    const presences = {};
    const state = { connection: 'close' };
    const assertMessageList = (jid) => {
        if (!messages[jid]) {
            messages[jid] = makeMessagesDictionary();
        }
        return messages[jid];
    };
    const contactsUpsert = (newContacts) => {
        const oldContacts = new Set(Object.keys(contacts));
        for (const contact of newContacts) {
            oldContacts.delete(contact.id);
            contacts[contact.id] = Object.assign(contacts[contact.id] || {}, contact);
        }
        return oldContacts;
    };
    const PhonecontactsUpsert = (newContacts) => {
        const oldContacts = new Set(Object.keys(phoneContacts));
        for (const contact of newContacts) {
            oldContacts.delete(contact.id);
            phoneContacts[contact.id] = Object.assign(phoneContacts[contact.id] || {}, contact);
        }
        return oldContacts;
    };
    /**
     * binds to a BaileysEventEmitter.
     * It listens to all events and constructs a state that you can query accurate data from.
     * Eg. can use the store to fetch chats, contacts, messages etc.
     * @param ev typically the event emitter from the socket connection
     */
    const bind = (ev) => {
        ev.on('connection.update', (update) => {
            Object.assign(state, update);
        });
        ev.on('messaging-history.set', ({ chats: newChats, contacts: newContacts, messages: newMessages, isLatest }) => {
            if (isLatest) {
                chats.clear();
                for (const id in messages) {
                    delete messages[id];
                }
            }
            const chatsAdded = chats.insertIfAbsent(...newChats).length;
            logger.debug({ chatsAdded }, 'synced chats');

            const oldContacts = contactsUpsert(newContacts);
            logger.debug({ deletedContacts: oldContacts.size, contacts }, 'synced contacts');

            for (const msg of newMessages) {
                const jid = msg.key.remoteJid;
                const list = assertMessageList(jid);
                list.upsert(msg, 'prepend');
            }
            logger.debug({ messages: newMessages.length }, 'synced messages');
        });
        ev.on('contacts.upsert', (contacts) => {
            const oldContacts = PhonecontactsUpsert(contacts);
            logger.debug({ deletedContacts: oldContacts.size, contacts }, 'synced phone contacts');
        });
        ev.on('contacts.update', (updates) => {
            for (const update of updates) {
                if (contacts[update.id]) {
                    Object.assign(contacts[update.id], update);
                } else if (phoneContacts[update.id]) {
                    Object.assign(phoneContacts[update.id], update);
                } else {
                    logger.debug({ update }, 'got update for non-existant contact');
                }
            }
        });
        ev.on('chats.upsert', (newChats) => {
            chats.upsert(...newChats);
        });
        ev.on('chats.update', (updates) => {
            for (let update of updates) {
                const result = chats.update(update.id, (chat) => {
                    if (update.unreadCount > 0) {
                        update = { ...update };
                        update.unreadCount = (chat.unreadCount || 0) + update.unreadCount;
                    }
                    Object.assign(chat, update);
                });
                if (!result) {
                    logger.debug({ update }, 'got update for non-existant chat');
                }
            }
        });
        ev.on('presence.update', ({ id, presences: update }) => {
            presences[id] = presences[id] || {};
            Object.assign(presences[id], update);
        });
        ev.on('chats.delete', (deletions) => {
            for (const item of deletions) {
                if (chats.get(item)) {
                    chats.deleteById(item);
                } else {
                    console.log('chat for deletebyID Not Exists:', item);
                }
            }
        });
        ev.on('messages.upsert', ({ messages: newMessages, type }) => {
            switch (type) {
                case 'append':
                case 'notify':
                    for (const msg of newMessages) {
                        const jid = (0, jidNormalizedUser)(msg.key.remoteJid);
                        const list = assertMessageList(jid);
                        list.upsert(msg, 'append');
                        if (type === 'notify') {
                            if (!chats.get(jid)) {
                                ev.emit('chats.upsert', [
                                    {
                                        id: jid,
                                        conversationTimestamp: (0, toNumber)(msg.messageTimestamp),
                                        unreadCount: 1
                                    }
                                ]);
                            }
                        }
                    }
                    break;
            }
        });
        ev.on('messages.update', (updates) => {
            for (const { update, key } of updates) {
                const list = assertMessageList(key.remoteJid);
                const result = list.updateAssign(key.id, update);
                if (!result) {
                    logger.debug({ update }, 'got update for non-existent message');
                }
            }
        });
        ev.on('messages.delete', (item) => {
            if ('all' in item) {
                const list = messages[item.jid];
                list === null || list === void 0 ? void 0 : list.clear();
            } else {
                const jid = item.keys[0].remoteJid;
                const list = messages[jid];
                if (list) {
                    const idSet = new Set(item.keys.map((k) => k.id));
                    list.filter((m) => !idSet.has(m.key.id));
                }
            }
        });
        ev.on('groups.update', (updates) => {
            for (const update of updates) {
                const id = update.id;
                if (groupMetadata[id]) {
                    Object.assign(groupMetadata[id], update);
                } else {
                    logger.debug({ update }, 'got update for non-existant group metadata');
                }
            }
        });
        ev.on('group-participants.update', ({ id, participants, action }) => {
            const metadata = groupMetadata[id];
            if (metadata) {
                switch (action) {
                    case 'add':
                        metadata.participants.push(...participants.map((id) => ({ id, isAdmin: false, isSuperAdmin: false })));
                        break;
                    case 'demote':
                    case 'promote':
                        for (const participant of metadata.participants) {
                            if (participants.includes(participant.id)) {
                                participant.isAdmin = action === 'promote';
                            }
                        }
                        break;
                    case 'remove':
                        metadata.participants = metadata.participants.filter((p) => !participants.includes(p.id));
                        break;
                }
            }
        });
        ev.on('message-receipt.update', (updates) => {
            for (const { key, receipt } of updates) {
                const obj = messages[key.remoteJid];
                const msg = obj === null || obj === void 0 ? void 0 : obj.get(key.id);
                if (msg) {
                    (0, updateMessageWithReceipt)(msg, receipt);
                }
            }
        });
        ev.on('messages.reaction', (reactions) => {
            for (const { key, reaction } of reactions) {
                const obj = messages[key.remoteJid];
                const msg = obj === null || obj === void 0 ? void 0 : obj.get(key.id);
                if (msg) {
                    (0, updateMessageWithReaction)(msg, reaction);
                }
            }
        });
    };
    const toJSON = () => ({
        chats,
        contacts,
        phoneContacts,
        messages
    });
    const fromJSON = (json) => {
        chats.upsert(...json.chats);
        contactsUpsert(Object.values(json.contacts));
        PhonecontactsUpsert(Object.values(json.phoneContacts));
        for (const jid in json.messages) {
            const list = assertMessageList(jid);
            for (const msg of json.messages[jid]) {
                list.upsert(WAProto.WebMessageInfo.fromObject(msg), 'append');
            }
        }
    };
    return {
        chats,
        contacts,
        phoneContacts,
        messages,
        groupMetadata,
        state,
        presences,
        bind,
        /** loads messages from the store, if not found -- uses the legacy connection */
        loadMessages: async (jid, count, cursor) => {
            const list = assertMessageList(jid);
            const mode = !cursor || 'before' in cursor ? 'before' : 'after';
            const cursorKey = cursor ? ('before' in cursor ? cursor.before : cursor.after) : undefined;
            const cursorValue = cursorKey ? list.get(cursorKey.id) : undefined;
            let messages;
            if (list && mode === 'before' && (!cursorKey || cursorValue)) {
                if (cursorValue) {
                    const msgIdx = list.array.findIndex(
                        (m) => m.key.id === (cursorKey === null || cursorKey === void 0 ? void 0 : cursorKey.id)
                    );
                    messages = list.array.slice(0, msgIdx);
                } else {
                    messages = list.array;
                }
                const diff = count - messages.length;
                if (diff < 0) {
                    messages = messages.slice(-count); // get the last X messages
                }
            } else {
                messages = [];
            }
            return messages;
        },
        loadMessage: async (jid, id) => {
            var _a;
            return (_a = messages[jid]) === null || _a === void 0 ? void 0 : _a.get(id);
        },
        mostRecentMessage: async (jid) => {
            var _a;
            const message = (_a = messages[jid]) === null || _a === void 0 ? void 0 : _a.array.slice(-1)[0];
            return message;
        },
        fetchImageUrl: async (jid, sock) => {
            const contact = contacts[jid] || phoneContacts[jid];
            if (!contact) {
                return sock === null || sock === void 0 ? void 0 : sock.profilePictureUrl(jid);
            }
            if (typeof contact.imgUrl === 'undefined') {
                contact.imgUrl = await (sock === null || sock === void 0 ? void 0 : sock.profilePictureUrl(jid));
            }
            return contact.imgUrl;
        },
        fetchGroupMetadata: async (jid, sock) => {
            if (!groupMetadata[jid]) {
                const metadata = await (sock === null || sock === void 0 ? void 0 : sock.groupMetadata(jid));
                if (metadata) {
                    groupMetadata[jid] = metadata;
                }
            }
            return groupMetadata[jid];
        },
        // fetchBroadcastListInfo: async(jid: string, sock: WASocket | undefined) => {
        // 	if(!groupMetadata[jid]) {
        // 		const metadata = await sock?.getBroadcastListInfo(jid)
        // 		if(metadata) {
        // 			groupMetadata[jid] = metadata
        // 		}
        // 	}
        // 	return groupMetadata[jid]
        // },
        fetchMessageReceipts: async ({ remoteJid, id }) => {
            const list = messages[remoteJid];
            const msg = list === null || list === void 0 ? void 0 : list.get(id);
            return msg === null || msg === void 0 ? void 0 : msg.userReceipt;
        },
        toJSON,
        fromJSON,
        writeToFile: (path) => {
            // require fs here so that in case "fs" is not available -- the app does not crash
            const { writeFileSync } = require('fs');
            writeFileSync(path, JSON.stringify(toJSON()));
        },
        readFromFile: (path) => {
            // require fs here so that in case "fs" is not available -- the app does not crash
            const { readFileSync, existsSync } = require('fs');
            if (existsSync(path)) {
                logger.debug({ path }, 'reading from file');
                const jsonStr = readFileSync(path, { encoding: 'utf-8' });
                const json = JSON.parse(jsonStr);
                fromJSON(json);
            }
        }
    };
};
