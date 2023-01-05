import { TkArray, TkObject, TkService } from '@hrimthurs/tackle'

const TIMEOUT_WORKER_CONNECT = 1000
const TIMEOUT_PROMISE_RESOLVE = 1000
const GLOBAL_RESOLVE_RESULT = 'MediatorGlobalResolveResult'

const workerMode = typeof Window === 'undefined'
const mainContext = workerMode ? self : window

export default class Mediator {

    static #active = true
    static #threadId = TkService.generateHashUID(mainContext.location.href)

    static #workers = {}
    static #events = {}

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
     * @property {Promise|Worker} instance  - instance system: promise of dynamic import module or webworker instance
     * @property {object} [config]          - configuration system (default: {})
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
     * @param {boolean} [options.once]      - remove handler after once execution (default: false)
     * @param {number} [options.sleep]      - pause between handler calls in ms (default: 0)
     * @param {number} [options.limResolve] - limit in ms for wait resolve handler (0 → unlimit) (default: TIMEOUT_PROMISE_RESOLVE)
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
                sleep: options.sleep ?? 0,
                limResolve: options.limResolve ?? TIMEOUT_PROMISE_RESOLVE
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
        this.#execEvent(eventName, args)
    }

    /**
     * Broadcast event and return promise results handlers
     * @param {string} eventName            - event name
     * @param {any} args                    - arguments of event
     * @returns {Promise} promise results of all event handlers
     */
    static broadcastPromise(eventName, ...args) {
        return this.#execEventPromise(eventName, args)
    }

    /**
     * Export system for worker mode
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
                event.preventDefault()
                throwError(event.message.replace(/^Uncaught Error:\s*/, ''))
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
                    const handlersIds = [param.handlerId]

                    if (!param.eventName) {
                        TkObject.enumeration(this.#events, (event, eventName) => {
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
        TkObject.enumeration(this.#workers, (worker, workerId) => {
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
        const resolveId = ++this.#indResolve

        promises.push(new Promise((resolve) => {
            this.#resolves[resolveId] = resolve
        }))

        return resolveId
    }

    static #fulfillGlobalResolve(resolveId, result) {
        this.#resolves[resolveId]({ [GLOBAL_RESOLVE_RESULT]: result })
        delete this.#resolves[resolveId]
    }

}