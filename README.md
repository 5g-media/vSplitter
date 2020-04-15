## Splitter
This project splits an incoming video stream into separate audio, video and image streams.

## Requirements
- node.js 8.x and higher
- ffmpeg

## Installation
Change directory where the project files are located.
### Local environment
```
npm install
```
### Docker
```
docker build -t splitter .
```
## Usage
Run the following command to start the service.
### Local environment
```
node index.js
```
### Docker
To start the *splitter* run:
```
docker run --name splitter -p 9998:9998/udp --rm splitter
```
To start the *splitter* and change its default configuration run:
```
docker run \
--name splitter \
-e DEBUG=false \
-e STREAM_INPUT=srt://0.0.0.0:9998?pkt_size=1316&mode=listener&transtype=live \
-e ENABLE_STREAM=false \
-e STREAM_OUTPUT_URL=udp://0.0.0.0:5004?pkt_size=1316 \
-e STREAM_OUTPUT_FORMAT=mpegts \
-e ENABLE_VSPEECH=false \
-e VSPEECH_HOST=0.0.0.0 \
-e VSPEECH_PORT=8885 \
-e ENABLE_VDETECTION=false \
-e VDETECTION_HOST=0.0.0.0 \
-e VDETECTION_PORT=9995 \
-e VDETECTION_FPS=10 \
-p 9998:9998/udp \
--rm \
splitter
```
To remove/stop the container run:
```
docker stop splitter
```
## Configuration
The configuration of the service must be done in the *.env* file. The following parameters exist:

`DEBUG` - Enable/disable debugging (default: false)\
`STREAM_INPUT` - Defines the input video stream (default: srt://0.0.0.0:9998?pkt_size=1316&mode=listener&transtype=live)\
`ENABLE_STREAM` - Enable/disable the output video stream (default: false)\
`STREAM_OUTPUT_URL` - Defines the URL to send the output video stream (default: udp://0.0.0.0:5004?pkt_size=1316)\
`STREAM_OUTPUT_FORMAT` - Defines the format of the output video stream (default: mpegts)\
`ENABLE_VSPEECH` - Enable/disable the output audio stream (default: false)\
`VSPEECH_HOST` - Defines the hostname or IP address to send the output audio stream (default: 0.0.0.0)\
`VSPEECH_PORT` - Defines the port to send the output audio stream (default: 8885)\
`ENABLE_VDETECTION` - Enable/disable the output image stream (default: false)\
`VDETECTION_HOST` - Defines the hostname or IP address to send the output image stream (default: 0.0.0.0)\
`VDETECTION_PORT` - Defines the port to send the output image stream (default: 9995)\
`VDETECTION_RESIZE_WIDTH` - Defines the size at which images will be processed (default: 320)\
`VDETECTION_FPS` - Defines the amount of images per seconds (default: 10)