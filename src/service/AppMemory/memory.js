const logger = require('../logger').default;
const { writeFileSync, existsSync, readFileSync } = require('fs');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');


exports.default = () => {
    const Sessions = new Map([])
    const StorePath = path.join(__dirname, 'store')
    const FileStore = path.resolve(StorePath, 'store.json')

    const init = async () => {
        logger.debug({ FileStore }, 'Iniciando Appstore');
        !fs.existsSync(StorePath) && fs.mkdirSync(StorePath, { recursive: true, force: true });
        await reader();
        return true
    }

    const reader = async () => {
        if (existsSync(FileStore)) {
            logger.debug({ FileStore }, 'reading from file');
            const jsonStr = readFileSync(FileStore, { encoding: 'utf-8' });
            const json = JSON.parse(jsonStr);
            for (const [key, data] of Object.entries(json)) {
                Sessions.set(key, data);
            }
        } else {
            writeFileSync(FileStore, JSON.stringify([]));
        }

    }

    const updateFile = async () => {
        const values = await Sessions.entries();
        const json = JSON.stringify(Object.fromEntries(values));
        writeFileSync(FileStore, json);
    }

    const update = (key, data) => {
        const old = get(key);
        data.key = old.key;
        Sessions.set(key, data);
        return true

    }
    const set = (key, data) => {
        Sessions.set(key, data);
        updateFile();
        return data
    }
    const exclude = (key) => {
        Sessions.delete(key);
        updateFile();
    }

    const get = async (key) => {
        return await Sessions.get(key);
    }

    const getall = (key) => {
        return Sessions.entries();
    }

    const has = (key) => {
        return Sessions.has(key);
    }


    return {
        init: init,
        reader,
        set,
        exclude,
        update: updateFile,
        getall,
        has,
        get
    }
}