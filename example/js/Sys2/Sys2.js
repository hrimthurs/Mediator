import Mediator from '../../../src/Mediator.js' // '@hrimthurs/mediator' (npm)

import SubSys2_1 from './SubSys2_1.js'

class Sys2 {

    method() {
        new SubSys2_1()

        // DBG
        import('../DbgEvents.js').then(instance => {
            let dbgEvents = new instance.DbgEvents({
                origin: this.constructor.name,
                subscribe: (eventName, handlerFunc, options) => Mediator.subscribe(eventName, handlerFunc, options),
                removeHandler: (handlerId, eventName) => Mediator.removeHandler(handlerId, eventName)
            })

            // subscribe base:
            dbgEvents.subscribeBase()                               // eventSysName, eventTotal

            // subscribe cross:
            dbgEvents.subscribe('eventSys2')                        // self exist
            dbgEvents.subscribe('eventSys2CustomLate')              // self late
            dbgEvents.subscribe('eventSys3')                        // other sys exist
            dbgEvents.subscribe('eventSys1CustomLate')              // other sys late
            dbgEvents.subscribe('eventSubSys1_1')                   // other subsys exist
            dbgEvents.subscribe('eventSubSys1_2Late')               // other subsys late
            dbgEvents.subscribe('eventSubSys2_1')                   // self subsys exist
            dbgEvents.subscribe('eventSubSys2_1Late')               // self subsys late

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
        // DBG
    }

}

new Sys2().method()
Mediator.exportWorker()