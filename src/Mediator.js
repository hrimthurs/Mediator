import { TkArray, TkObject, TkService } from '@hrimthurs/tackle'

const TIMEOUT_WORKER_CONNECT = 30000
const TIMEOUT_PROMISE_RESOLVE = 1000
const GLOBAL_RESOLVE_RESULT = 'MediatorGlobalResolveResult'

const workerMode = typeof Window === 'undefined'
const mainContext = workerMode ? self : window

/**
 * @typedef {import('@hrimthurs/tackle').TObjectJS} TObjectJS
 *
 * @typedef {object} TSystem                Record of System
 * @property {string} name                  Name system
 * @property {Promise|Worker} instance      Instance system: promise of dynamic import module or webworker instance
 * @property {TObjectJS} [config]           Configuration system. Can contain transferable objects (default: {})
 *
 * @typedef {object} THandlerOptions        Options of handler
 * @property {string} [options.id]          Force set handler id (if not set: auto generate)
 * @property {boolean} [options.once]       Remove handler after once execution (default: false)
 * @property {number} [options.sleep]       Pause between handler calls in ms (default: 0)
 * @property {number} [options.limResolve]  Limit in ms for wait resolve handler (0 → unlimit) (default: TIMEOUT_PROMISE_RESOLVE)
 */

export default class Mediator {

    static #active = true
    static #threadId = TkService.generateHashUID(mainContext.location.href)

    static #workers = {}
    static #events = {}
    static #supplementCfg = {}

    static #resolves = {}
    static #indResolve = 0

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
     * @param {string} eventName Event name
     * @returns {boolean}
     */
    static isExistEvent(eventName) {
        return eventName in this.#events
    }

    /**
     * Supplementing values to config records of systems.
     * Applied immediately before connecting a specific system
     * @param {Object<string,(TObjectJS|function(boolean,TObjectJS):(TObjectJS|Promise<TObjectJS>))>} supplement Supplement to config (key → system name, val → values)
     *      - arg0 - system running in web worker
     *      - arg1 - current system configuration
     */
    static supplementSysCfg(supplement) {
        this.#supplementCfg = supplement
    }

    /**
     * Asynchronous connection systems
     * @param {TSystem|TSystem[]} systems   Records of systems to connect
     * @returns {Promise}                   Promise connected all systems
     */
    static connect(systems) {
        let connectPromises = TkArray.getArray(systems)
            .map((rec) => {
                return new Promise(async (resolve, reject) => {
                    const isWorker = rec.instance instanceof Worker
                    const cfg = await this.#applySupplementCfg(rec.name, isWorker, rec.config)

                    const promise = isWorker
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
     * @param {string} eventName            Event name
     * @param {function} handlerFunc        Handler function
     * @param {THandlerOptions} [options]   Options of handler
     * @returns {string}                    Handler id
     */
    static subscribe(eventName, handlerFunc, options = {}) {
        let handlerId = options.id ?? TkService.generateHashUID(handlerFunc.toString())

        this.#distributeEvent(eventName, {
            handlers: {
                id: handlerId,
                handler: handlerFunc,
                timePrevCall: 0,
                once: options.once ?? false,
                sleep: options.sleep ?? 0,
                limResolve: options.limResolve ?? TIMEOUT_PROMISE_RESOLVE
            }
        })

        return handlerId
    }

    /**
     * Remove exist handler from event
     * @param {string} handlerId            Handler id
     * @param {string} [eventName]          Name event (if not set: removes this handler from all existing events)
     */
    static removeHandler(handlerId, eventName = null) {
        this.#actionAllSystems('actionRemoveHandler', { handlerId, eventName })
    }

    /**
     * Broadcast event
     * @param {string} eventName            Event name
     * @param {any} args                    Arguments of event
     */
    static broadcast(eventName, ...args) {
        this.#execEvent(eventName, args)
    }

    /**
     * Broadcast event and return promise results handlers
     * @param {string} eventName            Event name
     * @param {any} args                    Arguments of event
     * @returns {Promise}                   Promise results of all event handlers
     */
    static broadcastPromise(eventName, ...args) {
        return this.#execEventPromise(eventName, args)
    }

    /**
     * Export system for worker mode
     * @param {object[]} [classesInstantiate] Classes of system for which the constructor is called after connection
     */
    static exportWorker(...classesInstantiate) {
        if (this.isWorker) {
            self.addEventListener('message', ({ data: msg }) => {
                if (this.#active) {
                    switch (msg.name) {
                        case 'wrkInstall':
                            this.#postMessageToParent({
                                name: 'wrkInstalled',
                                workerId: this.#threadId
                            })
                            break

                        case 'wrkInit':
                            TkObject.traverse(msg.initEvents, (fields, eventName) => {
                                this.#setEvent(eventName, fields)
                            })

                            classesInstantiate.forEach((classInst) => new classInst(msg.config))

                            this.#postMessageToParent({
                                name: 'wrkInitComplete',
                                resolveId: msg.resolveId
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

                        case 'wrkExecEvent':
                            this.#execEvent(msg.eventName, msg.args, this.#threadId)
                            break

                        case 'wrkExecEventPromise':
                            this.#execEventPromise(msg.eventName, msg.args, msg.resolveId, this.#threadId)
                            break

                        case 'wrkResolveEventPromise':
                            this.#fulfillGlobalResolve(msg.resolveId, msg.result)
                            break
                    }
                }
            })
        }
    }

    static #applySupplementCfg(sysName, isWorker, config = {}) {
        return new Promise(async (resolve) => {
            const srcSupplement = this.#supplementCfg[sysName]
            if (srcSupplement) {

                const supplement = typeof srcSupplement === 'function'
                    ? await srcSupplement(isWorker, config)
                    : srcSupplement instanceof Promise
                        ? await srcSupplement
                        : srcSupplement

                if (typeof supplement === 'object') {
                    config = TkObject.merge(config, supplement)
                }
            }

            resolve(config)
        })
    }

    static #importWorker(worker, config) {
        let promise = new Promise((resolve, reject) => {
            const throwError = (message) => {
                clearTimeout(connectTimeOut)
                worker.terminate()
                reject({ message })
            }

            let connectTimeOut = setTimeout(() => {
                throwError('Timeout connect as worker. Check module for call Mediator.exportWorker()')
            }, TIMEOUT_WORKER_CONNECT)

            worker.addEventListener('error', (event) => {
                throwError(event.message)
            })

            worker.addEventListener('message', ({ data: msg }) => {
                switch (msg.name) {
                    case 'wrkInstalled':
                        clearTimeout(connectTimeOut)
                        this.#workers[msg.workerId] = worker

                        const initEvents = TkObject.traverse(this.#events, (event) => ({
                            callParent: event.callParent || !this.#isEmptyEvent(event, msg.workerId)
                        }))

                        worker.postMessage({
                            name: 'wrkInit',
                            resolveId: this.#addGlobalResolve(resolve),
                            initEvents, config
                        }, TkObject.getArrayTransferable(config))

                        break

                    case 'wrkInitComplete':
                        this.#fulfillGlobalResolve(msg.resolveId)
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

                    case 'wrkExecEvent':
                        this.#execEvent(msg.eventName, msg.args, msg.thread)
                        break

                    case 'wrkExecEventPromise':
                        this.#execEventPromise(msg.eventName, msg.args, msg.resolveId, msg.thread)
                        break

                    case 'wrkResolveEventPromise':
                        this.#fulfillGlobalResolve(msg.resolveId, msg.result)
                        break
                }
            })

            worker.postMessage({ name: 'wrkInstall' })
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
                    const handlersIds = [param.handlerId]

                    if (!param.eventName) {
                        TkObject.traverse(this.#events, (event, eventName) => {
                           this.#removeEventHandler(eventName, handlersIds)
                        })
                    } else this.#removeEventHandler(param.eventName, handlersIds)
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

    static #distributeEvent(eventName, eventData, thread = null) {
        this.#setEvent(eventName, eventData)
        this.#setChildrenCallParent(eventName, true, true, thread)

        this.#postMessageToParent({
            name: 'wrkDistributeEvent',
            workerId: this.#threadId,
            eventName
        })
    }

    static #execEvent(eventName, args, thread = null) {
        if (this.#active) {
            const event = this.#events[eventName]
            if (event) {
                this.#callHandlers(eventName, event, args)

                event.callWorkers.forEach((workerId) => {
                    if (workerId !== thread) {
                        this.#workers[workerId]?.postMessage({
                            name: 'wrkExecEvent',
                            eventName, args
                        })
                    }
                })

                if (event.callParent && (this.#threadId !== thread)) {
                    this.#postMessageToParent({
                        name: 'wrkExecEvent',
                        thread: this.#threadId,
                        eventName, args
                    })
                }
            }
        }
    }

    static #execEventPromise(eventName, args, resolveId = null, thread = null) {
        let promises = []

        if (this.#active) {
            const event = this.#events[eventName]
            if (event) {
                this.#callHandlers(eventName, event, args, promises)

                event.callWorkers.forEach((workerId) => {
                    if (workerId !== thread) {
                        this.#workers[workerId]?.postMessage({
                            name: 'wrkExecEventPromise',
                            resolveId: this.#createGlobalResolve(promises),
                            eventName, args
                        })
                    }
                })

                if (event.callParent && (this.#threadId !== thread)) {
                    this.#postMessageToParent({
                        name: 'wrkExecEventPromise',
                        thread: this.#threadId,
                        resolveId: this.#createGlobalResolve(promises),
                        eventName, args
                    })
                }
            }
        }

        return Promise.allSettled(promises).then((resPromises) => {
            let result = this.#processingResultsPromises(resPromises)

            if (thread) {
                this.#postMessageToThread(thread, {
                    name: 'wrkResolveEventPromise',
                    resolveId, result
                })
            } else {
                return result.length > 0
                    ? result.length === 1 ? result[0] : result
                    : undefined
            }
        })
    }

    static #callHandlers(eventName, event, args, promises = null) {
        const now = Date.now()
        let removeHandlers = []

        event.handlers.forEach((rec) => {
            if (!rec.sleep || (now - rec.timePrevCall > rec.sleep)) {
                rec.timePrevCall = now
                if (rec.once) removeHandlers.push(rec.id)

                if (promises) {
                    const limTimeout = rec.limResolve

                    const promise = limTimeout
                        ? this.#createPromiseTimeout(limTimeout, rec.handler, args)
                        : new Promise((resolve) => resolve(rec.handler(...args)))

                    promises.push(promise)
                } else rec.handler(...args)
            }
        })

        if (removeHandlers.length > 0) this.#removeEventHandler(eventName, removeHandlers)
    }

    static #processingResultsPromises(resultsPromises) {
        let result = []

        resultsPromises.forEach((rec) => {
            if ((rec.status === 'fulfilled') && (rec.value !== undefined)) {
                const isGlobalPromiseResult = (rec.value !== null)
                    && (typeof rec.value === 'object')
                    && (GLOBAL_RESOLVE_RESULT in rec.value)

                if (isGlobalPromiseResult) {
                    result.push(...rec.value[GLOBAL_RESOLVE_RESULT])
                } else result.push(rec.value)
            }
        })

        return result
    }

    static #removeEventHandler(eventName, handlersIds) {
        const event = this.#events[eventName]
        if (event) {
            let isRemove = false

            event.handlers = event.handlers.filter((rec) => {
                let isFound = handlersIds.includes(rec.id)
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

    static #postMessageToThread(thread, message) {
        if (thread === this.#threadId) this.#postMessageToParent(message)
        else this.#workers[thread]?.postMessage(message)
    }

    static #postMessageToParent(message) {
        if (this.isWorker) self.postMessage(message)
    }

    static #postMessageToChildren(message, ignoreWorkerId = null) {
        TkObject.traverse(this.#workers, (worker, workerId) => {
            if (worker && (!ignoreWorkerId || (workerId !== ignoreWorkerId))) worker.postMessage(message)
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

        TkObject.traverse(fields, (val, key) => {
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

    static #createPromiseTimeout(limTimeout, func, args) {
        return new Promise(async (resolve) => {
            const idTimeout = setTimeout(() => resolve(), limTimeout)

            if (func) {
                const result = await func(...args)
                clearTimeout(idTimeout)
                resolve(result)
            }
        })
    }

    static #createGlobalResolve(promises) {
        let resolveId

        promises.push(new Promise((resolve) => {
            resolveId = this.#addGlobalResolve(resolve)
        }))

        return resolveId
    }

    static #addGlobalResolve(resolve) {
        const resolveId = ++this.#indResolve
        this.#resolves[resolveId] = resolve

        return resolveId
    }

    static #fulfillGlobalResolve(resolveId, result) {
        this.#resolves[resolveId]({ [GLOBAL_RESOLVE_RESULT]: result })
        delete this.#resolves[resolveId]
    }

}