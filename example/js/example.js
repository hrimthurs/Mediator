import Mediator from '../../src/Mediator.js'

const supportWorker = typeof Worker === 'function'

const cfgSystems = {
    Sys1: {
        worker: supportWorker && new Worker(new URL('./Sys1/Sys1.js', import.meta.url)),
        config: {
            cfgVal: 'valSys'
        }
    },

    // Sys2: {
    //     worker: supportWorker && new Worker(new URL('./Sys2/Sys2.js', import.meta.url))
    // },

    // Sys3: {
    //     worker: supportWorker && new Worker(new URL('./Sys3/Sys3.js', import.meta.url))
    // }
}

const trans = new ArrayBuffer(16)
console.log('src:', trans)

Mediator.supplementSysCfg({
    'noSys': { val: 123 },
    // 'Sys1': { trans }
    'Sys1': new Promise ((resolve) => setTimeout(() => resolve({ trans }), 500))
    // 'Sys1': (isWorker) => ({ trans: isWorker ? trans : 'str' })
})

const systems = Object.keys(cfgSystems).map((name) => ({
    name,
    instance: cfgSystems[name].worker ?? import(`./${name}/${name}.js`),
    config: cfgSystems[name].config
}))

// OR:
// const systems = [
//     {
//         name: 'Sys1',
//         instance: supportWorker
//             ? new Worker(new URL('./Sys1/Sys1.js', import.meta.url))
//             : import('./Sys1/Sys1.js'),
//         config: {
//             cfgVal: 'valSys'
//         }
//     },
//     {
//         name: 'Sys2',
//         instance: supportWorker
//             ? new Worker(new URL('./Sys2/Sys2.js', import.meta.url))
//             : import('./Sys2/Sys2.js')
//     },
//     {
//         name: 'Sys3',
//         instance: supportWorker
//             ? new Worker(new URL('./Sys3/Sys3.js', import.meta.url))
//             : import('./Sys3/Sys3.js')
//     }
// ]

Mediator.connect(systems)
    .then(() => console.log('[APPLICATION] Complete connect systems'))
    .catch((rec) => console.log(`[APPLICATION] Fail connect systems: ${rec.sysName} - ${rec.error.message}`))

/////////////////////////////////////////////////   DEBUG   /////////////////////////////////////////////////

import('./DbgEvents.js').then(async (instance) => {
    const origin = 'App'

    let dbgEvents = new instance.DbgEvents({
        origin,
        subscribe: (eventName, handlerFunc, options) => Mediator.subscribe(eventName, handlerFunc, options),
        broadcast: (eventName, ...args) => Mediator.broadcast(eventName, ...args),
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

    // self broadcast:
    dbgEvents.selfBroadcast([200, 400])

    // Mediator.broadcast('evApp-000', origin) // 001, 002
    // setInterval(() => {
    //     Mediator.broadcast('evSys1-100', origin)
    //     Mediator.broadcast('evSubSys1_2-111', origin)
    //     Mediator.broadcast('evSys3-102', origin)

    //     Mediator.broadcast('evSubSys1_1-110', origin)
    //     Mediator.broadcast('evSys2-101', origin)
    //     Mediator.broadcast('evSubSys2_1-112', origin)

    //     Mediator.broadcast('evApp-010', origin) // 011, 012
    // }, 0)

    // broadcast promises:
    // Mediator.subscribe('evPromise', (base) => {
    //     console.log('handler evPromise ' + origin)

    //     return new Promise((resolve) => {
    //         setTimeout(() => resolve([base + '-' + origin, 4, 5]), 100)
    //     })
    // }, { once: true })

    // setTimeout(async () => {
    //     console.log(`RES CALL from ${origin}:`, await Mediator.broadcastPromise('evPromise', 111))
    // }, 2500)

    // ...
})