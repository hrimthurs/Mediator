import Mediator from '../../src/Mediator.js' // (npm) '@hrimthurs/mediator'

const availWorker = typeof Worker === 'function'

const cfgSystems = {
    // _SystemTemplate: {
    //     worker: availWorker && new Worker(new URL('./Engine/_SystemTemplate/_SystemTemplate.js', import.meta.url))
    // },

    Sys1: {
        worker: availWorker && new Worker(new URL('./Sys1/Sys1.js', import.meta.url)), // - to run as a web worker
        config: {
            cfgVal: 'valSys'
        }
    },

    Sys2: {
        worker: availWorker && new Worker(new URL('./Sys2/Sys2.js', import.meta.url)) // - to run as a web worker
    },

    Sys3: {
        worker: availWorker && new Worker(new URL('./Sys3/Sys3.js', import.meta.url)) // - to run as a web worker
    }
}

const systems = Object.keys(cfgSystems).map(name => ({
    name,
    instance: cfgSystems[name].worker ?? import(`./${name}/${name}.js`),
    config: cfgSystems[name].config
}))

Mediator.connect(systems)
    .then(() => console.log('[APPLICATION] Complete connect systems'))
    .catch(rec => console.log(`[APPLICATION] Fail connect systems: ${rec.sysName} - ${rec.error.message}`))

/////////////////////////////////////////////////   DEBUG   /////////////////////////////////////////////////

import('./DbgEvents.js').then(instance => {
    let dbgEvents = new instance.DbgEvents({
        origin: 'App',
        subscribe: (eventName, handlerFunc, options) => Mediator.subscribe(eventName, handlerFunc, options),
        removeHandler: (handlerId, eventName) => Mediator.removeHandler(handlerId, eventName)
    })

    // subscribe base:
    dbgEvents.subscribeBase()                               // eventSysName, eventTotal

    // subscribe cross:
    dbgEvents.subscribe('eventEngine')                      // self exist
    dbgEvents.subscribe('eventEngineCustomLate')            // self late
    dbgEvents.subscribe('eventSys2')                        // other sys exist
    dbgEvents.subscribe('eventSys3CustomLate')              // other sys late
    dbgEvents.subscribe('eventSubSys2_1')                   // other subsys exist
    dbgEvents.subscribe('eventSubSys1_2Late')               // other subsys late

    // remove handler:
    const late = 200
    dbgEvents.removeHandler('idNoExist', null, late)
    dbgEvents.removeHandler('idNoExist', 'eventNoExist', late)
    dbgEvents.removeHandler('idNoExist', 'eventTotal', late)

    dbgEvents.removeHandler('id_handler_eventSys1_Custom', null, late)                          // ok
    dbgEvents.removeHandler('id_handler_eventTotal_Custom', null, late)                         // ok
    dbgEvents.removeHandler('id_handler_eventSubSys2_1_Custom', 'eventSubSys2_1Custom', late)   // ok
    dbgEvents.removeHandler('id_handler_eventSys3_Custom', 'eventSys3', late)

    dbgEvents.removeHandler('id_handler_eventSubSys1_2_CustomLate', null, late)                 // ok late
    dbgEvents.removeHandler('id_handler_eventSys3_CustomLate', 'eventSys3CustomLate', late)     // ok late
    dbgEvents.removeHandler('id_handler_eventEngine_CustomLate', 'eventApplication', late)

    dbgEvents.removeHandler('id_handler_eventSubSys2_1_Custom', null, late)
    dbgEvents.removeHandler('id_handler_eventSys1_Custom', 'eventSys1Custom', late)
    dbgEvents.removeHandler('id_handler_eventSubSys1_1_Custom', 'eventTotalLate', late)

    // ...
})