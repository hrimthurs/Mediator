import { TkArray, TkObject, TkService } from '@hrimthurs/tackle'

const TIMEOUT_WORKER_CONNECT = 1000
const TIMEOUT_EVENTS_RESOLVE = 1000

const workerMode = typeof Window === 'undefined'
const mainContext = workerMode ? self : window

export default class Mediator {

    static #active = true
    static #threadId = TkService.generateHashUID(mainContext.location.href)

    static #workers = {}
    static #events = {}
    // static #defferedEvents = []

    /**
     * Current context is a webworker
     * @returns {boolean}
     */
    static get isWorker() {
        return workerMode
    }

    /**
     * Get/set current activity of Mediator
     * @returns {boolean}
     */
    static get active() {
        return this.#active
    }

    static set active(val) {
        this.#actionAllSystems('actionSetActive', val)
    }

    /**
     * Availability registered event
     * @param {string} eventName            - event name
     * @returns {boolean}
     */
    static isExistEvent(eventName) {
        return eventName in this.#events
    }

    /**
     * Asynchronous connection systems
     * @param {TSystem|TSystem[]} systems   - records of systems to connect
     *
     * @typedef {object} TSystem
     * @property {string} name              - name system
     * @property {string|Worker} instance   - instance system: path to module or worker
     * @property {object} [config]          - configuration system (default = {})
     *
     * @returns {Promise} promise connected all systems
     */
    static connect(systems) {
        let connectPromises = TkArray.getArray(systems)
            .map((rec) => {
                return new Promise((resolve, reject) => {
                    const cfg = rec.config ?? {}

                    const promise = rec.instance instanceof Worker
                        ? this.#importWorker(rec.instance, cfg)
                        : rec.instance

                    promise
                        .then((exported) => {
                            const classInst = exported?.default
                            if (classInst && this.active) new classInst(cfg)
                            resolve()
                        })
                        .catch((error) => {
                            reject({ sysName: rec.name, error })
                        })
                })
            })

        return Promise.all(connectPromises)
    }

    /**
     * Set handler function to event
     * @param {string} eventName            - name event
     * @param {function} handlerFunc        - handler function
     *
     * @param {object} [options]            - options of handler
     * @param {string} [options.id]         - force set handler id (if not set: auto generate)
     * @param {boolean} [options.once]      - remove handler after once execution (default = false)
     * @param {number} [options.sleep]      - pause between handler calls in ms (default = 0)
     *
     * @returns {string} handler id
     */
    static subscribe(eventName, handlerFunc, options = {}) {
        let handlerId = options.id ?? TkService.generateHashUID(handlerFunc.toString())

        this.#distributeEvent(eventName, {
            handlers: {
                id: handlerId,
                handler: handlerFunc,
                timePrevCall: 0,
                once: options.once ?? false,
                sleep: options.sleep ?? 0
            }
        })

        return handlerId
    }

    /**
     * Remove exist handler from event
     * @param {string} handlerId            - handler id
     * @param {string} [eventName]          - name event (if not set: removes this handler from all existing events)
     */
    static removeHandler(handlerId, eventName = null) {
        this.#actionAllSystems('actionRemoveHandler', { handlerId, eventName })
    }

    /**
     * Broadcast event
     * @param {string} eventName            - event name
     * @param {any} args                    - arguments of event
     */
    static broadcast(eventName, ...args) {
        // ...
    }

    /**
     * Broadcast event and return promise results handlers
     * @param {string} eventName            - event name
     * @param {any} args                    - arguments of event
     * @returns {Promise} promise results of all event handlers
     */
    static broadcastPromise(eventName, ...args) {
        // ...
        return new Promise((resolve) => resolve())
    }

    /**
     * Export system in worker mode
     * @param {object} [classesInstantiate] - classes of system for which the constructor is called after connection
     */
    static exportWorker(...classesInstantiate) {
        if (this.isWorker) {
            self.addEventListener('message', ({ data: msg }) => {
                if (this.#active) {
                    switch (msg.name) {
                        case 'wrkInstall':
                            classesInstantiate.forEach((classInst) => new classInst(msg.config))

                            this.#postMessageToParent({
                                name: 'wrkInstalled',
                                workerId: this.#threadId
                            })
                            break

                        case 'wrkInit':
                            TkObject.enumeration(msg.initEvents, (fields, eventName) => {
                                this.#setEvent(eventName, fields)
                            })
                            break

                        case 'wrkActionAllSystems':
                            this.#actionAllSystems(msg.actionName, msg.param, msg.complete)
                            break

                        case 'wrkSetCallParent':
                            const callParent = msg.callParent
                            this.#setEvent(msg.eventName, { callParent })
                            if (msg.deep) this.#setChildrenCallParent(msg.eventName, callParent, msg.deep)
                            break
                    }
                }
            })
        }
    }

    static #importWorker(worker, config) {
        let promise = new Promise((resolve, reject) => {
            const throwError = (message) => {
                this.active = false
                clearTimeout(connectTimeOut)
                worker.terminate()
                reject({ message })
            }

            let connectTimeOut = setTimeout(() => {
                throwError('Timeout connect as worker. Check module for call Mediator.exportWorker()')
            }, TIMEOUT_WORKER_CONNECT)

            worker.addEventListener('error', (event) => {
                event.preventDefault()
                throwError(event.message)
            })

            worker.addEventListener('message', ({ data: msg }) => {
                switch (msg.name) {
                    case 'wrkInstalled':
                        clearTimeout(connectTimeOut)
                        this.#workers[msg.workerId] = worker

                        let initEvents = TkObject.enumeration(this.#events, (event) => ({
                            callParent: event.callParent || !this.#isEmptyEvent(event, msg.workerId)
                        }))

                        worker.postMessage({ name: 'wrkInit', initEvents })

                        resolve()
                        break

                    case 'wrkActionAllSystems':
                        this.#actionAllSystems(msg.actionName, msg.param, msg.complete)
                        break

                    case 'wrkDistributeEvent':
                        this.#distributeEvent(msg.eventName, { callWorkers: msg.workerId }, msg.workerId)
                        break

                    case 'wrkDelCallWorker':
                        const event = this.#events[msg.eventName]
                        event.callWorkers = event.callWorkers.filter((id) => id !== msg.workerId)

                        if (this.#isEmptyEvent(event)) {
                            this.#setChildrenCallParent(msg.eventName, false, false)
                            if (event.callParent) this.#cleanParentCallWorkers(msg.eventName, event)
                        }
                        break
                }
            })

            worker.postMessage({ name: 'wrkInstall', config })
        })

        return promise
    }

    static #actionAllSystems(actionName, param, complete = []) {
        if (!complete.includes(this.#threadId)) {

            switch (actionName) {
                case 'actionSetActive':
                    this.#active = param
                    break

                case 'actionRemoveHandler':
                    if (!param.eventName) {
                        TkObject.enumeration(this.#events, (event, eventName) => {
                           this.#removeEventHandler(eventName, param.handlerId)
                        })
                    } else this.#removeEventHandler(param.eventName, param.handlerId)
                    break
            }

            const message = {
                name: 'wrkActionAllSystems',
                complete: complete.concat(this.#threadId),
                actionName, param
            }

            this.#postMessageToChildren(message)
            this.#postMessageToParent(message)
        }
    }

    static #distributeEvent(eventName, eventData, origin = null) {
        this.#setEvent(eventName, eventData)
        this.#setChildrenCallParent(eventName, true, true, origin)

        this.#postMessageToParent({
            name: 'wrkDistributeEvent',
            workerId: this.#threadId,
            eventName
        })
    }

    static #removeEventHandler(eventName, handlerId) {
        const event = this.#events[eventName]
        if (event) {
            let isRemove = false

            event.handlers = event.handlers.filter((rec) => {
                let isFound = rec.id === handlerId
                if (isFound) isRemove = true
                return !isFound
            })

            if (isRemove) this.#cleanParentCallWorkers(eventName, event)
        }
    }

    static #cleanParentCallWorkers(eventName, event) {
        if (this.#isEmptyEvent(event)) {
            if (this.isWorker) {
                this.#postMessageToParent({
                    name: 'wrkDelCallWorker',
                    workerId: this.#threadId,
                    eventName
                })
            } else this.#setChildrenCallParent(eventName, false, false)
        }
    }

    static #setChildrenCallParent(eventName, callParent, deep, ignoreWorkerId = null) {
        this.#postMessageToChildren({
            name: 'wrkSetCallParent',
            eventName, callParent, deep
        }, ignoreWorkerId)
    }

    static #postMessageToParent(message) {
        if (this.isWorker) self.postMessage(message)
    }

    static #postMessageToChildren(message, ignoreWorkerId = null) {
        TkObject.enumeration(this.#workers, (worker, workerId) => {
            if (!ignoreWorkerId || (ignoreWorkerId !== workerId)) worker.postMessage(message)
        })
    }

    static #setEvent(eventName, fields = {}) {
        if (!this.#events[eventName]) {
            this.#events[eventName] = {
                callParent: false,
                callWorkers: [],
                handlers: []
            }
        }

        const event = this.#events[eventName]

        TkObject.enumeration(fields, (val, key) => {
            if (Array.isArray(event[key])) {
                if ((key === 'handlers') || !event[key].includes(val)) {
                    event[key].push(val)
                }
            } else event[key] = val
        })
    }

    static #isEmptyEvent(event, ignoreWorkerId = null) {
        const callWorkers = ignoreWorkerId
            ? event.callWorkers.filter((id) => id !== ignoreWorkerId)
            : event.callWorkers

        return (event.handlers.length === 0) && (callWorkers.length === 0)
    }

    static _dbg() {
        this.#threadId = TkObject.getHash(mainContext.location.href)
        console.log(this.isWorker, mainContext.location.pathname.replace(/\/js\//, ''), this.#threadId, this.#events)
    }

}

/////////////////////////////////////////////////   DEBUG   /////////////////////////////////////////////////

let debugMode
debugMode = true

if (debugMode) {
    import('./Debug.js').then(({ default: Debug }) => {
        new Debug({
            captureLog: {
                active: false,
                lastSession: {
                    compareWithPrev: {
                        saveDiffRecord: true,
                        saveDiffFile: true,
                        ignoreKeys: ['id']
                    }
                }
            }
        })

        Mediator._dbg()
    })
}