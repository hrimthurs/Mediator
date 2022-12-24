import Mediator from '../../../src/Mediator.js' // (npm) '@hrimthurs/mediator'

// Subsystems imports
// They can import Mediator and use methods from there. They don't need to call Mediator.exportWorker()

export default class _SystemTemplate {

    // Use methods from Mediator

    constructor (config) {
    }

}

Mediator.exportWorker(_SystemTemplate) // Necessary for run as webworker. Enumeration of classes exported by default (empty for not exported or static classes)

// Global config record:
// _SystemTemplate: {
//     worker: availWorker && new Worker(new URL('./_SystemTemplate/_SystemTemplate.js', import.meta.url)), // - to run as a web worker
//     ...
// }