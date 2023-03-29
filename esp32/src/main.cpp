#include <Arduino.h>
#include <WiFi.h>
#include <esp_wifi.h>
#include "connection-details.h"
#include <WebSocketsClient.h>
#include <HTTPClient.h>
#include <WiFiUdp.h>
#include <WakeOnLan.h>

#include <MHZ19.h>
#include "pins.h"
#include <HardwareSerial.h>
#include <Adafruit_Sensor.h>
#include <DHT.h>

#include <BLEDevice.h>
#include <BLEAdvertisedDevice.h>

#define sizeof_array(ARRAY) (sizeof(ARRAY)/sizeof(ARRAY[0]))
#define RES_BUFFER_SIZE 1024
#define SENSOR_READ_INTERVAL 5000
#define BLE_SCAN_TIME_SECS 70


enum IncomingBinaryPacketType : uint8_t {
    HTTP_REQUEST = 1,
    WOL_REQUEST
};

enum OutgoingBinaryPacketType : uint8_t {
    HTTP_RESPONSE_DATA_END = 1,
    HTTP_RESPONSE_DATA,
    SENSOR_DATA,
    TEMP_UPDATE
};

struct __attribute__((packed)) ProxyResponseDataHeader {
    OutgoingBinaryPacketType type;
    uint16_t requestID;
    uint16_t responsePart;
};

struct __attribute__((packed)) SensorData {
    OutgoingBinaryPacketType type;
    uint16_t co2_ppm;
    float temperature;
    float humidity;
};

struct __attribute__((packed)) TempUpdate {
    OutgoingBinaryPacketType type;
    uint8_t id;
    int16_t temperature;
    uint8_t humidity;
    uint8_t battery;
    uint16_t battery_voltage;
};

DHT dht(DHT_DATA_PIN, DHT_TYPE);
MHZ19 myMHZ19;
HardwareSerial mhzSerial(MHZ_SERIAL_NUM);
WebSocketsClient webSocket;
WiFiUDP UDP;
WakeOnLan WOL(UDP);
BLEScan *pBLEScan;

bool found_devices[sizeof_array(deviceNames)];
uint8_t counters[sizeof_array(deviceNames)];
int dataTimer = 0;

// Modified from https://github.com/leCandas/esp32-atc-mithermometer/blob/main/src/atc_custom.h
class CustomAdvertisedDeviceCallbacks: public BLEAdvertisedDeviceCallbacks {
    void onResult(BLEAdvertisedDevice advertisedDevice) {
        uint8_t num_found = 0;
        for(uint8_t i = 0; i < sizeof_array(deviceNames); i++) {
            if(found_devices[i]) {
                num_found++;
                continue;
            }
            if(advertisedDevice.getName() != deviceNames[i]) continue;

            found_devices[i] = true;
            num_found++;

            uint8_t* payload = advertisedDevice.getPayload();
            size_t payloadLength = advertisedDevice.getPayloadLength();

            const int8_t counter = payload[16];
            if(counter == counters[i]) continue;
            counters[i] = counter;
            
            TempUpdate tempUpdate = {
                .type = TEMP_UPDATE,
                .id = i,
                .temperature = uint16_t(payload[11]) | (uint16_t(payload[10]) << 8),
                .humidity = payload[12],
                .battery = payload[13],
                .battery_voltage = uint16_t(payload[15]) | (uint16_t(payload[14]) << 8)
            };
            if(webSocket.isConnected()) {
                webSocket.sendBIN((const uint8_t*)(&tempUpdate), sizeof(TempUpdate));
            }   
        }
        
        if(num_found == sizeof_array(deviceNames)) {
            pBLEScan->stop();
        }
    }
};

void taskScanBleDevices(void* pvParameters) {
    for(uint8_t i = 0; i < sizeof_array(deviceNames); i++) {
        counters[i] = 0;
    }
    while (true) {
        for(uint8_t i = 0; i < sizeof_array(deviceNames); i++) {
            found_devices[i] = false;
        }

        pBLEScan = BLEDevice::getScan();
        pBLEScan->start(BLE_SCAN_TIME_SECS, false);
        pBLEScan->clearResults();
        vTaskDelay(5000 / portTICK_RATE_MS);
    }
}

// Performs an http GET request with the specified id and streams the response data over the websocket connection
void httpRequest(uint16_t requestID, String url) {
    uint8_t buffer[RES_BUFFER_SIZE + sizeof(ProxyResponseDataHeader)];

    HTTPClient http;
    http.begin(url);
    int httpResponseCode = http.GET();

    // Stream the data
    WiFiClient stream = http.getStream();
    uint16_t i = 0;
    for(; stream.available(); i++) {
        size_t bytesRead = stream.readBytes(buffer + sizeof(ProxyResponseDataHeader), RES_BUFFER_SIZE);
        ProxyResponseDataHeader header = {
            .type = HTTP_RESPONSE_DATA,
            .requestID = requestID,
            .responsePart = i
        };
        memcpy(buffer, &header, sizeof(ProxyResponseDataHeader));
        webSocket.sendBIN(buffer, bytesRead + sizeof(ProxyResponseDataHeader));
    }

    // Send end of data
    ProxyResponseDataHeader header = {
        .type = HTTP_RESPONSE_DATA_END,
        .requestID = requestID,
        .responsePart = i
    };
    memcpy(buffer, &header, sizeof(ProxyResponseDataHeader));
    webSocket.sendBIN(buffer, sizeof(ProxyResponseDataHeader));

    http.end();
}

void sendSensorData(int co2_ppm, float temp, float humidity) {
    if(!webSocket.isConnected()) return;

    SensorData data = {
        .type = SENSOR_DATA,
        .co2_ppm = co2_ppm,
        .temperature = temp,
        .humidity = humidity
    };
    webSocket.sendBIN((const uint8_t*)(&data), sizeof(SensorData));
}

void onWebSocketEvent(WStype_t type, uint8_t * payload, size_t length) {
	switch(type) {
		case WStype_DISCONNECTED:
			Serial.println("Disconnected from websocket!");
			break;
		case WStype_CONNECTED:
			Serial.println("Connected to websocket!");
			break;
		case WStype_TEXT: {
			break;
        }
		case WStype_BIN:
            if(length < sizeof(IncomingBinaryPacketType)) return;
            switch(payload[0]) {
                case HTTP_REQUEST: {
                    // Ensure payload is large enough
                    if(length < (sizeof(IncomingBinaryPacketType) + sizeof(uint16_t))) return;
                    // Ensure final byte is null (c string)
                    if(payload[length - 1] != 0x00) return;

                    uint16_t requestNum;
                    memcpy(&requestNum, payload + sizeof(IncomingBinaryPacketType), sizeof(uint16_t));
                    Serial.println(requestNum);

                    httpRequest(requestNum, (const char *)(payload + sizeof(IncomingBinaryPacketType) + sizeof(uint16_t)));
                    break;
                }
                case WOL_REQUEST: {
                    // Ensure final byte is null (c string)
                    if(payload[length - 1] != 0x00) return;
                    WOL.sendMagicPacket((const char *)(payload + sizeof(IncomingBinaryPacketType)));
                    break;
                }
                default: {
                    break;
                }
            }
			break;
		case WStype_ERROR:			
            Serial.println("Websocket error!");
            break;
		case WStype_FRAGMENT_TEXT_START:
		case WStype_FRAGMENT_BIN_START:
		case WStype_FRAGMENT:
		case WStype_FRAGMENT_FIN:
		case WStype_PING:
		case WStype_PONG:
			break;
	}

}

void setup() {
    Serial.begin(115200);
    Serial.println("");

    BLEDevice::init("esp32");
    pBLEScan = BLEDevice::getScan();
    pBLEScan->setAdvertisedDeviceCallbacks(new CustomAdvertisedDeviceCallbacks(), true);
    pBLEScan->setActiveScan(true);
    pBLEScan->setInterval(50);
    pBLEScan->setWindow(40);
    TaskHandle_t bleScanHandle = nullptr;
    xTaskCreate(taskScanBleDevices, "ble-scan", 2048, nullptr, tskIDLE_PRIORITY, &bleScanHandle);

    mhzSerial.begin(9600, SERIAL_8N1, MHZ_SERIAL_RX_PIN, MHZ_SERIAL_TX_PIN);
    myMHZ19.begin(mhzSerial);
    myMHZ19.autoCalibration(false);

    dht.begin();

    esp_wifi_set_ps(WIFI_PS_NONE);
    Serial.print("Connecting to ");
    Serial.println(WIFI_SSID);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    while(WiFi.status() != WL_CONNECTED) {
        Serial.print(".");
        delay(500);
    }
    Serial.println("");
    Serial.print("Connected! IP address: ");
    Serial.println(WiFi.localIP());

    webSocket.onEvent(onWebSocketEvent);
    webSocket.begin(WEBSOCKET_IP, WEBSOCKET_PORT, WEBSOCKET_PATH);

    WOL.setRepeat(3, 100);
    WOL.calculateBroadcastAddress(WiFi.localIP(), WiFi.subnetMask());
}

void loop() {
    webSocket.loop();
    unsigned long now = millis();
    if(now - dataTimer >= SENSOR_READ_INTERVAL) {
        dataTimer = now;
        int co2_ppm = myMHZ19.getCO2(false, true);
        dht.read();
        float temp = dht.readTemperature();
        float humidity = dht.readHumidity();

        sendSensorData(co2_ppm, temp, humidity);
    }
}