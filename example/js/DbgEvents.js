export class DbgEvents {

    #origin
    #subscribe
    #removeHandler

    #handlers = []

    constructor ({ origin, subscribe, removeHandler }) {
        this.#origin = origin
        this.#subscribe = subscribe
        this.#removeHandler = removeHandler
    }

    subscribeBase() {
        ['event' + this.#origin, 'eventTotal'].forEach(eventName => {
            this.subscribe(eventName)
            this.subscribe(eventName + 'Custom', { id: this.#makeEventId(eventName, 'Custom'), sleep: 100 })
            this.subscribe(eventName + 'Late', {}, 500)
            this.subscribe(eventName + 'CustomLate', { id: this.#makeEventId(eventName, 'CustomLate'), once: true }, 500)
        })

        // console.log(`${this.#origin} handlers (x${this.#handlers.length}):`, this.#handlers)
    }

    subscribe(eventName, options = {}, late = 0) {
        this.#call(() => {
            let id = this.#subscribe(eventName, (origin) => {
                console.log(eventName + 'from -', origin)
            }, options)

            this.#handlers.push(id)
        }, late)
    }

    removeHandler(handlerId, eventName, late = 0) {
        this.#call(() => {
            this.#removeHandler(handlerId, eventName)
            this.#handlers = this.#handlers.filter(id => id !== handlerId)
        }, late)
    }

    #call(func, late) {
        if (late) setTimeout(func, late)
        else func()
    }

    #makeEventId(eventName, postfix) {
        return `id_handler_${eventName}_${postfix}`
    }

}