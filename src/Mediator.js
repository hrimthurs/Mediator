import { TkArray, TkObject, TkService } from '@hrimthurs/tackle'

const TIMEOUT_WORKER_CONNECT = 30000
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
 * @property {number} [options.limResolve]  Limit in ms for wait resolve handler (default: 0 → unlimit)
 */

export default class Mediator {

    static #active = true
    static #threadId = TkService.generateHashUID(mainContext.location.href)

    static #workers = {}
    static #events = {}
    static #supplementCfg = {}

    static #connect = {
        names: [],
        promises: null
    }

    static #resolves = {}
    static #indResolve = 0

    static #disableEvents = {}

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
        this.#connect.promises = TkArray.getArray(systems)
            .filter((rec) => rec)
            .map((rec, ind) => {
                this.#connect.names[ind] = rec.name

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
                            reject(error.message)
                        })
                })
            })

        return this.waitConnect()
    }

    /**
     * Waiting connect of specific system or all systems
     * @param {string} [sysName]                            System name (default: null → wait all systems)
     * @param {function(object|string):void} [cbConnected]  Callback on connected waiting system
     * @returns {Promise}                                   Promise connected waiting system
     */
    static waitConnect(sysName = null, cbConnected = () => {}) {
        return new Promise(async (resolve) => {
            let error = null

            if (sysName) {
                const ind = this.#connect.names.findIndex((name) => name === sysName)
                if (ind === -1) error = 'Unknown system'
                else await this.#connect.promises[ind].catch((err) => error = err)
            } else {
                const promises = await Promise.allSettled(this.#connect.promises)
                promises.forEach((rec, ind) => {
                    if (rec.status === 'rejected') {
                        if (!error) error = {}
                        error[this.#connect.names[ind]] = rec.reason
                    }
                })
            }

            cbConnected(error)
            resolve(error)
        })
    }

    /**
     * Set handlers functions to some events
     * @param {(Object.<string,function>)|({name:string,handler:function,options?:THandlerOptions}[])} listEvents List of events description
     * @returns {string[]} Array of handlers ids
     */
    static subscribeSome(listEvents) {
        return Array.isArray(listEvents)
            ? listEvents.map((event) => this.subscribe(event.name, event.handler, event.options))
            : Object.entries(listEvents).map(([name, handler]) => this.subscribe(name, handler))
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
                limResolve: options.limResolve ?? 0
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
     * Set allow handling events (enable/disable)
     * @param {boolean} isAllow             Allow this events
     * @param  {...string} eventsNames      Events names
     */
    static allowEvents(isAllow, ...eventsNames) {
        this.#distributeTotalAction('AllowEvents', { isAllow, eventsNames })
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

                        case 'wrkRunTotalAction':
                            this.#runTotalAction(msg.actionName, msg.params)
                            this.#postMessageToChildren({ name: 'wrkRunTotalAction', ...msg })
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

                        const resolveId = ++this.#indResolve
                        this.#resolves[resolveId] = resolve

                        worker.postMessage({
                            name: 'wrkInit',
                            resolveId, initEvents, config
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

                    case 'wrkDistributeTotalAction':
                        this.#distributeTotalAction(msg.actionName, msg.params, msg.workerId)
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

    static #distributeTotalAction(actionName, params, thread = null) {
        this.#runTotalAction(actionName, params)

        this.#postMessageToChildren({
            name: 'wrkRunTotalAction',
            actionName, params
        }, thread)

        this.#postMessageToParent({
            name: 'wrkDistributeTotalAction',
            workerId: this.#threadId,
            actionName, params
        })
    }

    static #execEvent(eventName, args, thread = null) {
        const event = this.#active && !this.#disableEvents[eventName] && this.#events[eventName]
        if (event) {
            if (event.handlers.length > 0) {
                this.#callHandlers(eventName, event, args)
            }

            if (event.callWorkers.length > 0) {
                for (let ind = 0; ind < event.callWorkers.length; ind++) {
                    let workerId = event.callWorkers[ind]
                    if ((workerId !== thread) && this.#workers[workerId]) {
                        this.#workers[workerId].postMessage({
                            name: 'wrkExecEvent',
                            eventName, args
                        })
                    }
                }
            }

            if (event.callParent && (this.#threadId !== thread)) {
                this.#postMessageToParent({
                    name: 'wrkExecEvent',
                    thread: this.#threadId,
                    eventName, args
                })
            }
        }
    }

    static #execEventPromise(eventName, args, resolveId = null, thread = null) {
        let promises = []

        const event = this.#active && !this.#disableEvents[eventName] && this.#events[eventName]
        if (event) {
            if (event.handlers.length > 0) {
                this.#callHandlersPromises(eventName, event, args, promises)
            }

            if (event.callWorkers.length > 0) {
                for (let ind = 0; ind < event.callWorkers.length; ind++) {
                    let workerId = event.callWorkers[ind]
                    if ((workerId !== thread) && this.#workers[workerId]) {
                        this.#workers[workerId].postMessage({
                            name: 'wrkExecEventPromise',
                            resolveId: this.#createGlobalResolve(promises),
                            eventName, args
                        })
                    }
                }
            }

            if (event.callParent && (this.#threadId !== thread)) {
                this.#postMessageToParent({
                    name: 'wrkExecEventPromise',
                    thread: this.#threadId,
                    resolveId: this.#createGlobalResolve(promises),
                    eventName, args
                })
            }
        }

        if (promises.length > 0) {
            if (promises.length === 1) {
                return promises[0].then((resPromise) => {
                    const result = this.#isGlobalPromiseResult(resPromise)
                        ? resPromise[GLOBAL_RESOLVE_RESULT]
                        : [resPromise]

                    return this.#getResultPromise(result, resolveId, thread)
                })
            } else {
                return Promise.allSettled(promises).then((resPromises) => {
                    const result = this.#processingResultsPromises(resPromises)
                    return this.#getResultPromise(result, resolveId, thread)
                })
            }
        }
    }

    static #callHandlers(eventName, event, args) {
        const now = Date.now()
        let removeHandlers = []

        for (let ind = 0; ind < event.handlers.length; ind++) {
            let rec = event.handlers[ind]
            if (!rec.sleep || (now - rec.timePrevCall > rec.sleep)) {
                if (rec.once) removeHandlers.push(rec.id)
                else rec.timePrevCall = now

                rec.handler(...args)
            }
        }

        if (removeHandlers.length > 0) this.#removeEventHandler(eventName, removeHandlers)
    }

    static #callHandlersPromises(eventName, event, args, promises) {
        const now = Date.now()
        let removeHandlers = []

        for (let ind = 0; ind < event.handlers.length; ind++) {
            let rec = event.handlers[ind]
            if (!rec.sleep || (now - rec.timePrevCall > rec.sleep)) {
                if (rec.once) removeHandlers.push(rec.id)
                else rec.timePrevCall = now

                const promise = rec.limResolve > 0
                    ? this.#createPromiseTimeout(rec.limResolve, rec.handler, args)
                    : new Promise((resolve) => resolve(rec.handler(...args)))

                promises.push(promise)
            }
        }

        if (removeHandlers.length > 0) this.#removeEventHandler(eventName, removeHandlers)
    }

    static #getResultPromise(result, resolveId, thread) {
        if (thread) {
            this.#postMessageToThread(thread, {
                name: 'wrkResolveEventPromise',
                resolveId, result
            })
        } else {
            if (result.length > 1) return result
            else if (result.length === 1) return result[0]
        }
    }

    static #processingResultsPromises(resultsPromises) {
        let result = []

        for (let ind = 0; ind < resultsPromises.length; ind++) {
            let rec = resultsPromises[ind]
            if ((rec.status === 'fulfilled') && (rec.value !== undefined)) {

                if (this.#isGlobalPromiseResult(rec.value)) {
                    result.push(...rec.value[GLOBAL_RESOLVE_RESULT])
                } else result.push(rec.value)
            }
        }

        return result
    }

    static #isGlobalPromiseResult(result) {
        return (result !== null) && (typeof result === 'object') && (GLOBAL_RESOLVE_RESULT in result)
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

    static #runTotalAction(actionName, params) {
        switch (actionName) {
            case 'AllowEvents':
                params.eventsNames.forEach((eventName) => {
                    if (params.isAllow) delete this.#disableEvents[eventName]
                    else this.#disableEvents[eventName] = true
                })
                break
        }
    }

    static #isEmptyEvent(event, ignoreWorkerId = null) {
        const callWorkers = ignoreWorkerId
            ? event.callWorkers.filter((id) => id !== ignoreWorkerId)
            : event.callWorkers

        return (event.handlers.length === 0) && (callWorkers.length === 0)
    }

    static #createPromiseTimeout(limResolve, handler, args) {
        return new Promise((resolve) => {
            const idTimeout = setTimeout(() => resolve(), limResolve)

            const result = handler(...args)
            if (result instanceof Promise) {

                result.finally((res) => {
                    clearTimeout(idTimeout)
                    resolve(res)
                })
            } else resolve(result)
        })
    }

    static #createGlobalResolve(promises) {
        let resolveId

        promises.push(new Promise((resolve) => {
            resolveId = ++this.#indResolve
            this.#resolves[resolveId] = resolve
        }))

        return resolveId
    }

    static #fulfillGlobalResolve(resolveId, result) {
        this.#resolves[resolveId]({ [GLOBAL_RESOLVE_RESULT]: result })
        delete this.#resolves[resolveId]
    }

}