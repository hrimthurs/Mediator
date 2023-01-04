import Mediator from '../../../src/Mediator.js' // (npm) '@hrimthurs/mediator'

// Submodules imports
// They can import Mediator and use methods from there
// They don't need to call Mediator.exportWorker()



// N.B. System can exported by default only non static classes. Or don't export anything

export default class _SystemTemplate {

    // Use methods from Mediator (subscribe/broadcast/broadcastPromise/removeHandler/etc.)

    constructor (config) {
    }

}

// Necessary for run as webworker. Enumeration of classes exported by default (empty for not exported or static classes)
Mediator.exportWorker(_SystemTemplate)



// Config record when connecting this system:
//      'name'      - name of this system
//      'instance'  - instance of this system:
//                          Worker: for run as a webworker (→ Webpack creates a chunk)
//                          or Promise of dynamic import
//      ['config']  - used as a constructor parameter when instantiating default export classes after connection

// {
//     name: '_SystemTemplate',
//     instance: typeof Worker === 'function'
//         ? new Worker(new URL('./_SystemTemplate/_SystemTemplate.js', import.meta.url))
//         : import('./_SystemTemplate/_SystemTemplate.js')
//     config: {
//         ...
//     }
// }