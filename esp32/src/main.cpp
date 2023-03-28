#include <Arduino.h>
#include <WiFi.h>
#include <esp_wifi.h>
#include "connection-details.h"
#include <WebSocketsClient.h>
#include <HTTPClient.h>
#include <WiFiUdp.h>
#include <WakeOnLan.h>

WebSocketsClient webSocket;
WiFiUDP UDP;
WakeOnLan WOL(UDP);

#define RES_BUFFER_SIZE 1024

enum IncomingBinaryPacketType : uint8_t {
    HTTP_REQUEST = 1,
    WOL_REQUEST
};

enum OutgoingBinaryPacketType : uint8_t {
    HTTP_RESPONSE_DATA_END = 1,
    HTTP_RESPONSE_DATA
};

struct __attribute__((packed)) ProxyResponseDataHeader {
    OutgoingBinaryPacketType type;
    uint16_t requestID;
    uint16_t responsePart;
};

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
}