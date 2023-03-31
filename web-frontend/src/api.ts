export interface HubAPIResponse {
    sensor: {
        co2PPM: number
        temperature: number | null
        humidity: number | null
        from: number
    }
    temperature: {
        sensorID: number
        temperature: number
        humidity: number
        battery: number
        batteryVoltage: number
        from: number
    }[]
}

export async function fetchAPIData(): Promise<HubAPIResponse> {
    return (await fetch(import.meta.env.VITE_API_BASE ?? 'api')).json()
}