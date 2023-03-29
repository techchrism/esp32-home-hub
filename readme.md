# ESP32 Home Hub

## Xiaomi Thermometer LYWSD03MMC

Using https://atc1441.github.io/TelinkFlasher.html to flash firmware from https://github.com/atc1441/ATC_MiThermometer

Settings:
 - `0xB1` - enable battery display
 - `0xFF` - display temperature in F
 - `0xA3` - smiley as comfort indicator
 - `0xAE` - custom advertising
 - `0xFE` `0x06` - advertise every minute
 - `0xDF` - save settings to flash

Script:
```javascript
['B1','FF','A3','AE','FE06','DF'].forEach((c,i)=>setTimeout(()=>sendCustomSetting(c),i*1000))
```