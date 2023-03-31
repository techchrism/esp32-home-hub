import * as dotenv from 'dotenv'
dotenv.config()
import WebSocket from 'ws'
import {Buffer} from 'node:buffer'
import winston from 'winston'
import 'winston-daily-rotate-file'
import Koa from 'koa'
import cors from '@koa/cors'
import websockify from 'koa-websocket'
import Router from '@koa/router'
import bodyParser from 'koa-bodyparser'

interface SensorData {
    co2PPM: number
    temperature: number
    humidity: number
    from: number
}

interface TemperatureData {
    sensorID: number
    temperature: number
    humidity: number
    battery: number
    batteryVoltage: number
    from: number
}

interface WOLRequest {
    mac: string
}

const incomingPacketTypes = {
    'HTTP_RESPONSE_DATA_END': 0x01,
    'HTTP_RESPONSE_DATA': 0x02,
    'SENSOR_DATA': 0x03,
    'TEMP_UPDATE': 0x04
}
const outgoingPacketTypes = {
    'HTTP_REQUEST': 0x01,
    'WOL_REQUEST': 0x02
}

let requestNumber = 0

async function proxyRequest(ws: WebSocket, url: string, timeout: number | undefined): Promise<string> {
    return new Promise<string>((resolve, reject) => {
        const requestID = (requestNumber++) % 65536
        const urlBuffer = Buffer.from(url, 'ascii')
        const buffer = Buffer.alloc(3 + urlBuffer.length + 1)
        buffer.writeUint8(outgoingPacketTypes.HTTP_REQUEST, 0)
        buffer.writeUint16LE(requestID, 1)
        urlBuffer.copy(buffer, 3)
        buffer.writeUint8(0x00, 3 + url.length)
        ws.send(buffer)

        const timeoutHandle = timeout ? setTimeout(() => {
            reject(new Error('Request timed out'))
        }, timeout) : undefined

        let incoming: undefined | Buffer = undefined

        const messageHandler = (data: WebSocket.RawData, isBinary: boolean) => {
            if(isBinary && data instanceof Buffer && data.length >= 5) {
                const type = data.readUInt8(0)
                if(type !== incomingPacketTypes.HTTP_RESPONSE_DATA && type !== incomingPacketTypes.HTTP_RESPONSE_DATA_END) return
                const responseRequestID = data.readUInt16LE(1)
                const responsePart = data.readUInt16LE(3)
                if(responseRequestID !== requestID) return

                if(type === incomingPacketTypes.HTTP_RESPONSE_DATA_END) {
                    if (timeoutHandle) clearTimeout(timeoutHandle)
                    ws.off('message', messageHandler)
                    if (incoming !== undefined) {
                        resolve(incoming.toString('utf-8'))
                    } else {
                        resolve('')
                    }
                } else {
                    if (incoming === undefined) {
                        incoming = data.slice(5)
                    } else {
                        incoming = Buffer.concat([incoming, data.slice(5)])
                    }
                }
            }
        }

        ws.on('message', messageHandler)
    })
}

function sendWakeOnLan(ws: WebSocket, mac: string) {
    const macBuffer = Buffer.from(mac, 'ascii')
    const buffer = Buffer.alloc(1 + macBuffer.length + 1)
    buffer.writeUint8(outgoingPacketTypes.WOL_REQUEST, 0)
    macBuffer.copy(buffer, 1)
    buffer.writeUint8(0x00, 1 + macBuffer.length)
    ws.send(buffer)
}

const logger = winston.createLogger({
    level: 'silly',
    transports: [
        new winston.transports.Console({
            level: 'info',
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.padLevels(),
                winston.format.simple()
            )
        }),
        new winston.transports.DailyRotateFile({
            level: 'silly',
            dirname: 'logs',
            filename: 'log-%DATE%.log',
            zippedArchive: true,
            format: winston.format.combine(
                winston.format.timestamp(),
                winston.format.json()
            )
        })
    ]
})
logger.info('Starting...')

const app = websockify(new Koa())
app.use(cors())
app.use(bodyParser())

let latestSensorData: undefined | SensorData = undefined
let latestTemperatureData = new Map<number, TemperatureData>()

let idCounter = 0
let latestConnected: WebSocket | undefined = undefined
app.ws.use(async (ctx, next) => {
    const id = idCounter++
    latestConnected = ctx.websocket
    logger.info('Connection', {id})

    ctx.websocket.on('error', err => logger.error(err.toString(), {id}))
    ctx.websocket.on('close', () => logger.info('Connection closed', {id}))

    ctx.websocket.on('message', (data, isBinary) => {
        if(isBinary && data instanceof Buffer && data.length >= 1) {
            const type = data.readUInt8(0)
            if(type === incomingPacketTypes.SENSOR_DATA) {
                const co2PPM = data.readUInt16LE(1)
                const temperature = data.readFloatLE(3)
                const humidity = data.readFloatLE(7)
                latestSensorData = {co2PPM, temperature, humidity, from: Date.now()}

                logger.info('Sensor data', {id, co2PPM, temperature, humidity});
            } else if(type === incomingPacketTypes.TEMP_UPDATE) {
                const sensorID = data.readUInt8(1)
                const temp = data.readInt16LE(2) / 10.0
                const humidity = data.readUInt8(4)
                const battery = data.readUInt8(5)
                const batteryVoltage = data.readUInt16LE(6) / 1000.0
                latestTemperatureData.set(sensorID, {sensorID, temperature: temp, humidity, battery, batteryVoltage, from: Date.now()})

                logger.info('Temperature update', {id, sensorID, temp, humidity, battery, batteryVoltage})
            }
        }
    })
})

const router = new Router()
router.get('/', async ctx => {
    ctx.set('Content-Type', 'application/json')
    ctx.body = JSON.stringify({sensor: latestSensorData, temperature: Array.from(latestTemperatureData.values())})
})

router.post('/wol', async ctx => {
    if(latestConnected && latestConnected.readyState === WebSocket.OPEN) {
        sendWakeOnLan(latestConnected, (ctx.request.body as WOLRequest).mac)
        ctx.status = 200
    } else {
        ctx.status = 503
    }
})
app.use(router.routes())
app.use(router.allowedMethods())

app.listen(Number(process.env.PORT || 8080), process.env.HOST)