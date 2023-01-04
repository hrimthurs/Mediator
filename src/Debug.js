import { TkObject } from '@hrimthurs/tackle'

export default class Debug {

    #config = {
        captureLog: {
            active: true,

            sessionTime: 1000,
            saveFilesTime: 500,
            supressDefault: true,

            lastSession: {
                outConsole: true,
                compareWithPrev: {
                    active: true,
                    saveDiffRecord: false,
                    saveDiffFile: false,
                    ignoreKeys: []
                }
            },

            IDB: {
                versionBase: 1,
                nameBase: 'Debugger',
                nameStore: 'sessions'
            }
        }
    }

    constructor (config = {}) {
        this.#config = TkObject.merge(this.#config, config)

        if (this.#config.captureLog.active) {
            this.#runCaptureLog(this.#config.captureLog)
        }
    }

    #runCaptureLog(cfg) {
        const idb = new IndexedDb(cfg.IDB.versionBase, cfg.IDB.nameBase, cfg.IDB.nameStore, async function () {
            let session = await this.getRecord(-1)
            if (!session?.active) {
                this.setRecord({
                    active: true,
                    members: 1,
                    saveFile: false,
                    data: []
                })
            } else {
                session.members++
                this.setRecord(session, -1)
            }
        })

        let defaultLog = console.log
        let outLogData = []

        console.log = function(...args) {
            outLogData.push(args)
            if (!cfg.supressDefault) defaultLog.apply(console, args)
        }

        setTimeout(async () => {
            console.log = defaultLog

            let session = await idb.getRecord(-1)
            let isFinish = --session.members === 0

            session.active = !isFinish
            outLogData.forEach((rec) => session.data.push(JSON.stringify(rec)))

            idb.setRecord(session, -1)
            if (isFinish) this.#finishCaptureLog(idb, cfg, session)

            if (typeof Window !== 'undefined') {
                setTimeout(() => this.#saveFilesCaptureLog(idb, cfg), cfg.saveFilesTime)
            }
        }, cfg.sessionTime)
    }

    async #finishCaptureLog(idb, config, session) {
        const cfg = config.lastSession
        let saveRecord = false
        let saveFile = false

        this.#outMessage('Session complete')

        if (cfg.compareWithPrev.active) {
            let prevSession = await idb.getRecord(-2)
            if (prevSession) {
                const ignoreKeys = config.lastSession.compareWithPrev.ignoreKeys

                let isDifferent = this.#stringifySession(session.data, ignoreKeys) !== this.#stringifySession(prevSession.data, ignoreKeys)
                if (isDifferent) {
                    this.#outMessage('This session is DIFFERENT from the previous one')

                    saveRecord = cfg.compareWithPrev.saveDiffRecord
                    saveFile = cfg.compareWithPrev.saveDiffFile

                    if (saveFile) {
                        prevSession.saveFile = true
                        idb.setRecord(prevSession, -2)
                    }
                } else this.#outMessage('This session is the SAME as the previous one')
            } else saveRecord = true
        }

        if (cfg.outConsole) {
            this.#outMessage('Session log:')
            this.#sessionDataToArray(session.data).forEach((rec) => console.log(...rec))
        }

        if (saveFile) {
            session.saveFile = true
            idb.setRecord(session, -1)
        } else if (!saveRecord) idb.delRecord(-1)
    }

    async #saveFilesCaptureLog(idb, config) {
        let saveRecord = true

        await idb.forEachRecords((rec, key) => {
            if (rec.saveFile) {
                saveRecord = config.lastSession.compareWithPrev.saveDiffRecord

                let fileName = window.prompt('Save session to file', 'session_' + key)
                if (fileName) {
                    const ignoreKeys = config.lastSession.compareWithPrev.ignoreKeys
                    this.#saveJsonFile(fileName, this.#stringifySession(rec.data, ignoreKeys, '\t'))
                }

                rec.saveFile = false
                return rec
            }
        })

        if (!saveRecord) idb.delRecord(-1)
    }

    #saveJsonFile(fileName, outData) {
        const elLink = document.createElement('a')
        elLink.download = fileName + '.json'
        elLink.type = 'text/plain'

        const blob = new Blob([outData], { type: 'text/plain' })
        const url = URL.createObjectURL(blob)
        elLink.href = url

        setTimeout(() => URL.revokeObjectURL(url), 10000)
        elLink.click()

        this.#outMessage(`Save file "${fileName}.json"`)
    }

    #stringifySession(sessionData, ignoreKeys, space = '') {
        return this.#stringifySortObj(this.#sessionDataToArray(sessionData), ignoreKeys, space)
    }

    #sessionDataToArray(sessionData) {
        return sessionData.map((rec) => Object.values(JSON.parse(rec)))
    }

    #stringifySortObj(src, ignoreKeys, space = '') {
        return JSON.stringify(src, (key, val) => {
             if (!ignoreKeys.includes(key)) {
                return (typeof val === 'object') && (val !== null)
                    ? Array.isArray(val)
                        ? [...val].sort()
                        : Object.keys(val).sort().reduce((r, k) => (r[k] = val[k], r), {})
                    : val
            }
        }, space)
    }

    #outMessage(message) {
        console.log(`%c[DEBUG] ${message}`, 'color:#0ff')
    }

}

class IndexedDb {

    #dataBase = null
    #transaction = null
    #store = null
    #nameStore = null

    constructor (versionBase, nameBase, nameStore, cbActivate) {
        this.#nameStore = nameStore
        const openRequest = indexedDB.open(nameBase, versionBase)

        openRequest.onupgradeneeded = () => {
            let db = openRequest.result
            if (db.objectStoreNames.contains(nameStore)) db.deleteObjectStore(nameStore)
            db.createObjectStore(nameStore, { autoIncrement: true })
        }

        openRequest.onsuccess = () => {
            this.#dataBase = openRequest.result
            this.#openTransaction()
            cbActivate.apply(this)
        }
    }

    async getRecord(index) {
        let key = await this.#getKeyByIndex(index)

        return key != null
            ? this.#request('get', [key])
            : undefined
    }

    async setRecord(value, index = null) {
        if (index !== null) {

            let key = await this.#getKeyByIndex(index)
            if (key) this.#request('put', [value, key])

        } else this.#request('add', [value])
    }

    async delRecord(index) {
        let key = await this.#getKeyByIndex(index)
        if (key) this.#request('delete', [key])
    }

    async forEachRecords(cbAction) {
        return new Promise(async (resolve) => {
            let allKeys = await this.#request('getAllKeys', [])

            for (const key of allKeys) {
                let val = await this.#request('get', [key])
                let res = cbAction(val, key)
                if (res != null) this.#request('put', [res, key])
            }

            resolve()
        })
    }

    #request(nameRequest, args, resultField = null) {
        return new Promise(async (resolve) => {
            if (this.#store) {
                const request = () => {
                    const request = this.#store[nameRequest](...args)
                    request.onsuccess = () => resolve(resultField ? request.result?.[resultField] : request.result)
                    request.onerror = () => resolve()
                }

                try {
                    request()
                } catch {
                    this.#openTransaction()
                    request()
                }
            } else resolve()
        })
    }

    #openTransaction() {
        this.#transaction = this.#dataBase.transaction(this.#nameStore, 'readwrite')
        this.#store = this.#transaction.objectStore(this.#nameStore)
    }

    #getKeyByIndex(index) {
        return this.#request('getAllKeys', []).then(keys => keys.at(index))
    }

}

/////////////////////////////////////////////////////////////////////////////////////////////////////////////

// TO MEDIATOR MODULE:

// class Mediator:
// static _dbg() {
//     this.#threadId = TkObject.getHash(mainContext.location.href)
//     console.log(this.isWorker, mainContext.location.pathname.replace(/\/js\//, ''), this.#threadId, this.#resolves, this.#events)
// }

/////////////////////////////////////////////////   DEBUG   /////////////////////////////////////////////////

let debugMode
debugMode = true

if (debugMode) {
    import('./Debug.js').then(({ default: Debug }) => {
        new Debug({
            captureLog: {
                // active: false,
                sessionTime: 3000,

                lastSession: {
                    compareWithPrev: {
                        saveDiffRecord: true,
                        saveDiffFile: true,
                        ignoreKeys: ['id']
                    }
                }
            }
        })

        // Mediator._dbg()
    })
}