import Debug from './Debug.js'
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

import { TkObject, TkService } from '@hrimthurs/tackle'

const TIMEOUT_WORKER_CONNECT = 1000

const workerMode = typeof Window === 'undefined'
const mainContext = workerMode ? self : window

// DBG
var f = false

export default class Mediator {

    static #active = true
    static #threadId = TkService.generateHashUID(mainContext.location.href)

    // static #defferedEvents = []
    static #workers = {}
    static #events = {}

    /**
     * Current context is a webworker
     * @return {boolean}
     */
    static get isWorker() {
        return workerMode
    }

    /**
     * Get/set current activity of Mediator
     * @return {boolean}
     */
    static get active() {
        return this.#active
    }

    static set active(val) {
        this.#actionAllSystems('actionSetActive', val)
    }

    /**
     * Availability registered event
     * @param {string} eventName    - event name
     * @return {boolean}
     */
    static isExistEvent(eventName) {
        return eventName in this.#events
    }

    /**
     * Asynchronous connection system
     * @param {object} options
     * @param {string} options.name                                 - name system
     * @param {Worker} [options.worker]                             - worker instance of system
     * @param {function(string, string):void} [options.logError]    - errors handler
     *      - arg0 - error message
     *      - arg1 - name of the system where the error occurred
     * @param {object} [options.config]                             - configuration settings for this system
     * @return {Promise}
     */
    static connect({ name, worker = null, logError = (err, sysName) => {}, config = {} }) {
        return new Promise((resolve, reject) => {
            (this.#importWorker(worker, config, logError) || import(`./${name}/${name}.js`))
                .then(exported => {
                    const classInst = exported?.default
                    if (classInst && this.active) new classInst(config)
                    resolve()
                })
                .catch(error => {
                    const err = error?.message
                    if (err) logError(err, name)
                    reject(err)
                })
        })
    }

    /**
     * Set handler function to event
     * @param {string} eventName        - name event
     * @param {function} handlerFunc    - handler function
     * @param {object} [options]
     * @param {string} [options.id]     - force set handler id
     * @param {boolean} [options.once]  - remove handler after once execution
     * @param {number} [options.sleep]  - pause between handler calls (ms)
     * @return {string} handler id
     */
    static subscribe(eventName, handlerFunc, options = {}) {
        if (!f) {
            f = true
            console.log(this.isWorker, mainContext.location.pathname.replace(/\/js\//, ''), this.#threadId, this.#events)
        }

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
     * @param {string} handlerId        - handler id
     * @param {string} [eventName]      - name event (if not set, removes this handler from all existing events)
     */
    static removeHandler(handlerId, eventName = null) {
        this.#actionAllSystems('actionRemoveHandler', { handlerId, eventName })
    }

    /**
     *
     */
    static broadcast(eventName, ...args) {
    }

    /**
     *
     */
    static broadcastPromise(eventName, ...args) {
    }

    /**
     *
     */
    static exportWorker(...classesInstantiate) {
        if (this.isWorker) {
            self.addEventListener('message', ({ data: msg }) => {
                if (this.#active) {
                    switch (msg.name) {
                        case 'wrkInstall':
                            classesInstantiate.forEach(classInst => new classInst(msg.config))

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

    static #importWorker(worker, config, logError) {
        if (worker) {
            let promise = new Promise((resolve, reject) => {
                const throwError = (message) => {
                    this.active = false
                    clearTimeout(connectTimeOut)
                    logError(message)
                    worker.terminate()
                    reject()
                }

                let connectTimeOut = setTimeout(() => {
                    throwError('Timeout connect as worker. Check module for call Mediator.exportWorker()')
                }, TIMEOUT_WORKER_CONNECT)

                worker.addEventListener('error', event => {
                    event.preventDefault()
                    throwError(event.message)
                })

                worker.addEventListener('message', ({ data: msg }) => {
                    switch (msg.name) {
                        case 'wrkInstalled':
                            clearTimeout(connectTimeOut)
                            this.#workers[msg.workerId] = worker

                            let initEvents = TkObject.enumeration(this.#events, event => ({
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
                            event.callWorkers = event.callWorkers.filter(id => id !== msg.workerId)

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

            event.handlers = event.handlers.filter(rec => {
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
            ? event.callWorkers.filter(id => id !== ignoreWorkerId)
            : event.callWorkers

        return (event.handlers.length === 0) && (callWorkers.length === 0)
    }

}