import Mediator from '../../src/Mediator.js'

const supportWorker = typeof Worker === 'function'

const systems = [
    {
        name: 'Sys1',
        instance: supportWorker
            ? new Worker(new URL('./Sys1/Sys1.js', import.meta.url))
            : import('./Sys1/Sys1.js'),
        config: {
            cfgVal: 'valSys'
        }
    },
    {
        name: 'Sys2',
        instance: supportWorker
            ? new Worker(new URL('./Sys2/Sys2.js', import.meta.url))
            : import('./Sys2/Sys2.js')
    }
]

let cnt = 0

// V1
Mediator.subscribeSome({
    'evPerf': () => {
        cnt++
        return 555
    },
    'evPerfResult': () => console.log('CALLS SYS0', cnt)
})

// V2
// Mediator.subscribeSome([
//     {
//         name: 'evPerf',
//         handler: () => {
//             cnt++
//             return 555
//         }
//     },
//     {
//         name: 'evPerfResult',
//         handler: () => console.log('CALLS SYS0', cnt),
//         options: {}
//     }
// ])

Mediator.connect(systems)
    .then(() => {
        // DEBUG CALL PERFOMANCE

        let tStart = Date.now()
        let tNow = null
        let res = []

        console.time('Time')

        do {
            tNow = Date.now()
            // Mediator.broadcast('evPerf', tNow)
            res.push(Mediator.broadcastPromise('evPerf', tNow))
        } while (tNow - tStart < 1000)

        console.timeEnd('Time')

        Promise.allSettled(res).then((allRes) => console.log(allRes.length, new Set(allRes.flatMap((rec) => rec['value']))))
        Mediator.broadcast('evPerfResult')
    })