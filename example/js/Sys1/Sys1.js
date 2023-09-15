import Mediator from '../../../src/Mediator.js'

import SubSys1_1 from './SubSys1_1.js'
import SubSys1_2 from './SubSys1_2.js'

export default class Sys1 {

    constructor (config) {
        throw Error
        console.log('CONNECT SYSTEM:', this.constructor.name, config)

        new SubSys1_1()

        // for (let i = 0; i < 2000000000; i++) {}
        // throw new Error('!!!')

        Mediator.subscribe('evTest', (origin) => console.log('evTest', origin))


        // DEBUG CALL PERFOMANCE
        let cnt = 0

        Mediator.subscribe('evPerf', (origin) => {
            cnt++
            return 123
            // return new Promise((r) => r(123))
        })
        Mediator.subscribe('evPerfResult', () => console.log('CALLS SYS1', cnt))

        // DBG
        import('../DbgEvents.js').then((instance) => {
            const origin = this.constructor.name

            let dbgEvents = new instance.DbgEvents({
                origin,
                subscribe: (eventName, handlerFunc, options) => Mediator.subscribe(eventName, handlerFunc, options),
                broadcast: (eventName, ...args) => Mediator.broadcast(eventName, ...args),
                removeHandler: (handlerId, eventName) => Mediator.removeHandler(handlerId, eventName)
            })

            // subscribe base:
            dbgEvents.subscribeBase()                               // eventSysName, eventTotal

            // subscribe cross:
            dbgEvents.subscribe('eventSys1')                        // self exist
            dbgEvents.subscribe('eventSys1CustomLate')              // self late
            dbgEvents.subscribe('eventEngine')                      // other sys exist
            dbgEvents.subscribe('eventSys3CustomLate')              // other sys late
            dbgEvents.subscribe('eventSubSys2_1')                   // other subsys exist
            dbgEvents.subscribe('eventSubSys2_1Late')               // other subsys late
            dbgEvents.subscribe('eventSubSys1_1')                   // self subsys exist
            dbgEvents.subscribe('eventSubSys1_2Late')               // self subsys late

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

            //     return new Promise((resolve) => {
            //         setTimeout(() => resolve(base + '-' + origin), 1500)
            //     })
            // })

            // setTimeout(async () => {
            //     console.log(`RES CALL from ${origin}:`, await Mediator.broadcastPromise('evPromise', 222))
            // }, 600)

            // ...
        })
        // DBG
    }

}

Mediator.exportWorker(Sys1)