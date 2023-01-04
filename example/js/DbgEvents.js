export class DbgEvents {

    #origin
    #subscribe
    #broadcast
    #removeHandler

    #handlers = []

    constructor ({ origin, subscribe, broadcast, removeHandler }) {
        this.#origin = origin
        this.#subscribe = subscribe
        this.#broadcast = broadcast
        this.#removeHandler = removeHandler
    }

    subscribeBase() {
        ['event' + this.#origin, 'eventTotal'].forEach((eventName) => {
            this.subscribe(eventName)
            this.subscribe(eventName + 'Custom', { id: this.#makeEventId(eventName, 'Custom'), sleep: 100 })
            this.subscribe(eventName + 'Late', {}, 500)
            this.subscribe(eventName + 'CustomLate', { id: this.#makeEventId(eventName, 'CustomLate'), once: true }, 500)
        })

        const prefixEventName = 'ev' + this.#origin + '-'

        this.subscribe(prefixEventName + '000')
        this.subscribe(prefixEventName + '001', {}, 0, 500)
        this.subscribe(prefixEventName + '002', {}, 0, 1500)
        this.subscribe(prefixEventName + '100', { once: true })
        this.subscribe(prefixEventName + '101', { once: true }, 0, 500)
        this.subscribe(prefixEventName + '102', { once: true }, 0, 1500)
        this.subscribe(prefixEventName + '010', { sleep: 300 })
        this.subscribe(prefixEventName + '011', { sleep: 300 }, 0, 500)
        this.subscribe(prefixEventName + '012', { sleep: 300 }, 0, 1500)
        this.subscribe(prefixEventName + '110', { once: true, sleep: 300 })
        this.subscribe(prefixEventName + '111', { once: true, sleep: 300 }, 0, 500)
        this.subscribe(prefixEventName + '112', { once: true, sleep: 300 }, 0, 1500)

        // console.log(`${this.#origin} handlers (x${this.#handlers.length}):`, this.#handlers)
    }

    subscribe(eventName, options = {}, late = 0, workTime = 0) {
        this.#call(() => {
            const handler = workTime === 0
                ? (origin) => console.log(`EVENT: ${eventName}, FROM: ${origin}, HANDLER: ${this.#origin}`)
                : (origin) => setTimeout(() => console.log(`EVENT: ${eventName}, FROM: ${origin}, HANDLER: ${this.#origin}`), workTime)

            const id = this.#subscribe(eventName, (origin) => handler(origin), options)

            this.#handlers.push(id)
        }, late)
    }

    selfBroadcast(callIntervals) {
        const prefixEventName = 'ev' + this.#origin + '-'

        callIntervals.forEach((interval, indCall) => {
            const callOrigin = this.#origin + '-' + (indCall + 1)

            setTimeout(() => {
                this.#broadcast(prefixEventName + '000', callOrigin)
                this.#broadcast(prefixEventName + '001', callOrigin)
                this.#broadcast(prefixEventName + '002', callOrigin)
                this.#broadcast(prefixEventName + '100', callOrigin)
                this.#broadcast(prefixEventName + '101', callOrigin)
                this.#broadcast(prefixEventName + '102', callOrigin)
                this.#broadcast(prefixEventName + '010', callOrigin)
                this.#broadcast(prefixEventName + '011', callOrigin)
                this.#broadcast(prefixEventName + '012', callOrigin)
                this.#broadcast(prefixEventName + '110', callOrigin)
                this.#broadcast(prefixEventName + '111', callOrigin)
                this.#broadcast(prefixEventName + '112', callOrigin)
            }, interval)
        })
    }

    removeHandler(handlerId, eventName, late = 0) {
        this.#call(() => {
            this.#removeHandler(handlerId, eventName)
            this.#handlers = this.#handlers.filter((id) => id !== handlerId)
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