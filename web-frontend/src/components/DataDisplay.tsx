import type {Component} from 'solid-js'
import {HubAPIResponse} from '../api'
import {For} from 'solid-js'

interface DataDisplayProps {
    data: HubAPIResponse
}

const DataDisplay: Component<DataDisplayProps> = (props) => {
    function cToF(celsius: number) {
        return Math.round(((celsius * 9) / 5 + 32) * 10) / 10
    }

    // From https://stackoverflow.com/a/69122877
    function timeAgo(input) {
        const date = (input instanceof Date) ? input : new Date(input);
        const formatter = new Intl.RelativeTimeFormat('en');
        const ranges = {
            years: 3600 * 24 * 365,
            months: 3600 * 24 * 30,
            weeks: 3600 * 24 * 7,
            days: 3600 * 24,
            hours: 3600,
            minutes: 60,
            seconds: 1
        };
        const secondsElapsed = (date.getTime() - Date.now()) / 1000;
        for (let key in ranges) {
            if (ranges[key] < Math.abs(secondsElapsed)) {
                const delta = secondsElapsed / ranges[key];
                return formatter.format(Math.round(delta), key as Intl.RelativeTimeFormatUnit);
            }
        }
    }

    return (
        <>
            <div class="card w-96 bg-base-300 shadow-xl">
                <div class="card-body">
                    <h2 class="card-title justify-center">ESP32</h2>
                    <div class="stats stats-vertical shadow">
                        <div class="stat">
                            <div class="stat-title">CO2</div>
                            <div class="stat-value">{props.data.sensor.co2PPM} PPM</div>
                        </div>
                        {props.data.sensor.temperature !== null && <div class="stat">
                            <div class="stat-title">Temperature</div>
                            <div class="stat-value">{cToF(props.data.sensor.temperature)} °F</div>
                        </div>}
                        {props.data.sensor.humidity !== null && <div class="stat">
                            <div class="stat-title">Humidity</div>
                            <div class="stat-value">{props.data.sensor.humidity}%</div>
                        </div>}
                        <div class="stat">
                            <div class="stat-desc">{timeAgo(props.data.sensor.from) ?? 'Now'}</div>
                        </div>
                    </div>
                </div>
            </div>

            <div class="flex flex-row gap-5 flex-wrap justify-center">
                <For each={props.data.temperature.sort((a,b)=>a.sensorID-b.sensorID)}>{(temp, index) => ( <>
                    <div class="card w-96 bg-base-300 shadow-xl">
                        <div class="card-body">
                            <h2 class="card-title justify-center">Sensor {temp.sensorID + 1}</h2>
                            <div class="stats stats-vertical shadow">
                                <div class="stat">
                                    <div class="stat-title">Temperature</div>
                                    <div class="stat-value">{cToF(temp.temperature)} °F</div>
                                </div>
                                <div class="stat">
                                    <div class="stat-title">Humidity</div>
                                    <div class="stat-value">{temp.humidity}%</div>
                                </div>
                                <div class="stat">
                                    <div class="stat-title">Battery</div>
                                    <div class="stat-value">{temp.battery}%</div>
                                </div>
                                <div class="stat">
                                    <div class="stat-desc">{timeAgo(temp.from) ?? 'Now'}</div>
                                </div>
                            </div>
                        </div>
                    </div>
                </>)}</For>
            </div>
        </>
    )
}

export default DataDisplay