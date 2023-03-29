import WebSocket, {WebSocketServer} from 'ws'
import {Buffer} from 'node:buffer'

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

const wss = new WebSocketServer({port: 8080})
wss.on('connection', ws => {
    console.log('Connection!');

    ws.on('error', console.error)

    ws.on('message', (data, isBinary) => {
        if(isBinary) {
            if(Array.isArray(data)) {
                console.log('Unhandled array of binary data')
                return
            }

            if(data instanceof Buffer && data.length >= 1) {
                const type = data.readUInt8(0)
                if(type === incomingPacketTypes.SENSOR_DATA) {
                    const co2PPM = data.readUInt16LE(1)
                    const temperature = data.readFloatLE(3)
                    const humidity = data.readFloatLE(7)
                    console.log(`CO2: ${co2PPM} ppm, Temperature: ${temperature} °C, Humidity: ${humidity} %`)
                } else if(type === incomingPacketTypes.TEMP_UPDATE) {
                    const id = data.readUInt8(1)
                    const temp = data.readInt16LE(2) / 10.0
                    const humidity = data.readUInt8(4)
                    const battery = data.readUInt8(5)
                    const batteryVoltage = data.readUInt16LE(6) / 1000.0
                    const tempf = temp * 1.8 + 32

                    console.log(`Sensor ${id}: Temperature: ${temp} °C (${tempf}) °F, Humidity: ${humidity} %, Battery: ${battery} %, Voltage: ${batteryVoltage} V`)
                }
            }
        } else {
            console.log('received: %s', data)
        }
    })
    ws.on('close', () => {
        console.log('Connection closed')
    });
});