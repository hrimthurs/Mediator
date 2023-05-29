import Mediator from '../../../src/Mediator.js'

// DBG
import('../DbgEvents.js').then((instance) => {
    const origin = 'Sys3'
    console.log('CONNECT SYSTEM:', origin)

    let dbgEvents = new instance.DbgEvents({
        origin,
        subscribe: (eventName, handlerFunc, options) => Mediator.subscribe(eventName, handlerFunc, options),
        broadcast: (eventName, ...args) => Mediator.broadcast(eventName, ...args),
        removeHandler: (handlerId, eventName) => Mediator.removeHandler(handlerId, eventName)
    })

    // subscribe base:
    dbgEvents.subscribeBase()                               // eventSysName, eventTotal

    // subscribe cross:
    dbgEvents.subscribe('eventSys3')                        // self exist
    dbgEvents.subscribe('eventSys3CustomLate')              // self late
    dbgEvents.subscribe('eventSys2')                        // other sys exist
    dbgEvents.subscribe('eventEngineCustomLate')            // other sys late
    dbgEvents.subscribe('eventSubSys1_2')                   // other subsys exist
    dbgEvents.subscribe('eventSubSys2_1Late')               // other subsys late

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

    // Mediator.broadcast('evApp-001', origin) // 000, 001, 002
    // setInterval(() => {
    //     Mediator.broadcast('evSys1-100', origin)
    //     Mediator.broadcast('evSubSys1_2-111', origin)
    //     Mediator.broadcast('evSys3-102', origin)

    //     Mediator.broadcast('evSubSys1_1-110', origin)
    //     Mediator.broadcast('evSys2-101', origin)
    //     Mediator.broadcast('evSubSys2_1-112', origin)

    //     Mediator.broadcast('evApp-012', origin) // 010, 011, 012
    // }, 0)

    // broadcast promises:
    // Mediator.subscribe('evPromise', (base) => {
    //     console.log('handler evPromise ' + origin)
    //     return null
    // })

    // setTimeout(async () => {
    //     console.log(`RES CALL from ${origin}:`, await Mediator.broadcastPromise('evPromise', 777))
    // }, 500)

    // ...
})
// DBG

Mediator.exportWorker()