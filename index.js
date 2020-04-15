require('dotenv').config();

'use strict';
const readline = require('readline');
const {spawn} = require('child_process');
const websocket = require('websocket-stream');
const {
  PassThrough
} = require('stream');

///////////// env /////////////

// Debug option
const DEBUG                = JSON.parse(process.env.DEBUG);

const RETRY_INTERVAL       = JSON.parse(process.env.RETRY_INTERVAL);

// App's input stream
const STREAM_INPUT         = process.env.STREAM_INPUT;

// Final broadcast stream
const ENABLE_STREAM        = JSON.parse(process.env.ENABLE_STREAM);
const STREAM_OUTPUT_URL    = process.env.STREAM_OUTPUT_URL;
const STREAM_OUTPUT_FORMAT = process.env.STREAM_OUTPUT_FORMAT;

// vspeech
const ENABLE_VSPEECH       = JSON.parse(process.env.ENABLE_VSPEECH);
const VSPEECH_TIMEOUT      = JSON.parse(process.env.VSPEECH_TIMEOUT);
const VSPEECH_HOST         = process.env.VSPEECH_HOST;
const VSPEECH_PORT         = parseInt(process.env.VSPEECH_PORT);

// vdetection
const ENABLE_VDETECTION    = JSON.parse(process.env.ENABLE_VDETECTION);
const VDETECTION_TIMEOUT   = JSON.parse(process.env.VDETECTION_TIMEOUT);
const VDETECTION_HOST      = process.env.VDETECTION_HOST;
const VDETECTION_PORT      = parseInt(process.env.VDETECTION_PORT);
const VDETECTION_WIDTH     = parseInt(process.env.VDETECTION_RESIZE_WIDTH);
const VDETECTION_FPS       = parseInt(process.env.VDETECTION_FPS);

/////////// Debug ////////////

const log = DEBUG ? console.log : ()=>{};

///////////// WS /////////////

function createStream(host, port) {
  return websocket('ws://' + host + ':' + port, {
    perMessageDeflate: false,
    binary: true
  });
}

///////////// ffmpeg /////////////

let ffmpegIngress = null;
let ffmpegAudio   = null;
let ffmpegImage   = null;
let ffmpegVideo   = null;

let init_ts = null;
let dtStreamAudio = null;
let ptStreamAudio = null;
let wsStreamAudio = null;
let dtStreamImage = null;
let ptStreamImage = null;
let wsStreamImage = null;

const args = {
  ingress: [
    '-loglevel', 'quiet',
    // '-re',
    '-stats',
    '-i', STREAM_INPUT,
    '-c', 'copy',
    '-f', 'mpegts',
    'pipe:1'
  ],
  audio: [
    '-loglevel', 'quiet',
    '-stats',
    '-i', 'pipe:0',
    '-vn',
    '-acodec', 'pcm_s16le',
    '-ac', '1',
    '-ar', '16000',
    '-f', 's16le',
    'pipe:3'
  ],
  image: [
    '-loglevel', 'info',
    '-stats',
    '-i', 'pipe:0',
    '-vf', 'fps=' + VDETECTION_FPS + ',scale=' + VDETECTION_WIDTH + ':-1,showinfo',
    '-f', 'image2pipe',
    'pipe:4'
  ],
  video: [
    '-loglevel', 'quiet',
    '-stats',
    '-i', 'pipe:0',
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-tune', 'zerolatency',
    '-crf', '10',
    '-maxrate', '5000k',
    '-bufsize', '2500k',
    '-pix_fmt', 'yuv420p',
    '-g', '25',
    // '-intra-refresh', '1',
    '-c:a', 'libfdk_aac',
    '-ar', '44100',
    '-flush_packets', '0',
    '-f', STREAM_OUTPUT_FORMAT,
    STREAM_OUTPUT_URL
  ]

};
const opts = {
  ingress: {stdio: ['inherit', 'pipe', 'pipe']},
  audio: {stdio: ['pipe', 'inherit', 'pipe', 'pipe']},
  image: {stdio: ['pipe', 'inherit', 'pipe', 'inherit', 'pipe']},
  video: {stdio: ['pipe', 'inherit', 'pipe']},
};

function createFFmpegStatsLog(iface, stream) {
  if (!DEBUG) return;
  readline.createInterface(stream.stdio[2]).on('line', (text) => {
    log('[' + iface + ']', text);
  });
}

function spawnFFmpegIngress() {
  log('[INGRESS] ffmpeg is starting...');
  ffmpegIngress = spawn('ffmpeg', args.ingress, opts.ingress)
    .once('close', () => {
      log('[INGRESS] ffmpeg closes.');
      setTimeout(spawnFFmpegIngress, 5000);
    });
  createFFmpegStatsLog('INGRESS', ffmpegIngress);
}

function spawnFFmpegAudio() {
  log('[AUDIO] ffmpeg is starting...');
  ffmpegAudio = spawn('ffmpeg', args.audio, opts.audio)
    .once('close', () => {
      log('[AUDIO] ffmpeg closes.');
      // setTimeout(spawnFFmpegAudio, 5000);
    });
  createFFmpegStatsLog('AUDIO', ffmpegAudio);
  ffmpegIngress.stdio[1].pipe(ffmpegAudio.stdio[0]);
  // ffmpegAudio.stdio[3].pipe(createStream(VSPEECH_HOST, VSPEECH_PORT));
  ffmpegAudio.stdio[3].pipe(wsStreamAudio);
  // ffmpegAudio.stdio[3].on('data', (buffer) => {
  //   log('[AUDIO BUFFER]', buffer);
  //   const message = {
  //     timestamp: Date.now(),
  //     metadata: null,
  //     buffer,
  //   }
  //   if (
  //     ptStreamAudio
  //   ) {
  //     ptStreamAudio.write(JSON.stringify(message));
  //   }
  // })
  // if (
  //   ptStreamAudio &&
  //   wsStreamAudio
  // ) {
  //   ptStreamAudio.pipe(wsStreamAudio);
  // }
}

function spawnFFmpegImage() {
  log('[IMAGE] ffmpeg is starting...');
  let metadata = null;
  let video_width = 0;
  let video_height = 0;
  ffmpegImage = spawn('ffmpeg', args.image, opts.image)
    .once('close', () => {
      log('[IMAGE] ffmpeg closes.');
      // setTimeout(spawnFFmpegImage, 5000);
    });
  readline.createInterface(ffmpegImage.stdio[2])
    .on('line', (text) => {
      log('[IMAGE TEXT]', text);
      if (
        video_width === 0 &&
        video_height === 0 &&
        text.indexOf('Stream') > -1 &&
        text.indexOf('Video') > -1
      ) {
        let sizes = text.match(/\d{2,}x\d+/g);
        if (sizes.length > 0) {
          video_width = parseInt(sizes[0].split('x')[0]);
          video_height = parseInt(sizes[0].split('x')[1]);
        }
      }
      if (text.indexOf('pts_time') > -1) {
        let pts_time = parseFloat(text.split('pts_time:')[1].split(' ')[0]);
        let id = parseInt(pts_time * 1000);
        let image_width = parseInt(text.split(' s:')[1].split(' ')[0].split('x')[0]);
        let image_height = parseInt(text.split(' s:')[1].split(' ')[0].split('x')[1]);
        metadata = {
          id,
          fps: VDETECTION_FPS,
          pts_time,
          image_width,
          image_height,
          video_width,
          video_height
        }
      }
    });
  ffmpegIngress.stdio[1].pipe(ffmpegImage.stdio[0]);
  // ffmpegImage.stdio[4].pipe(createStream(VDETECTION_HOST, VDETECTION_PORT));
  ffmpegImage.stdio[4].on('data', (buffer) => {
    log('[IMAGE BUFFER]', buffer);
    if (
      metadata &&
      buffer
    ) {
      const message = {
        timestamp: Date.now(),
        metadata,
        buffer,
      }
      if (
        ptStreamImage
      ) {
        ptStreamImage.write(JSON.stringify(message));
      }
    }
  })
  if (
    ptStreamImage &&
    wsStreamImage
  ) {
    ptStreamImage.pipe(wsStreamImage);
  }
}

function spawnFFmpegVideo() {
  log('[VIDEO] ffmpeg is starting...');
  ffmpegVideo = spawn('ffmpeg', args.video, opts.video)
    .once('close', () => {
      log('[VIDEO] ffmpeg closes.');
      setTimeout(spawnFFmpegVideo, 5000);
    });
  createFFmpegStatsLog('VIDEO', ffmpegVideo);
  ffmpegIngress.stdio[1].pipe(ffmpegVideo.stdio[0]);
  ffmpegIngress.stdio[1].once('data', (data) => {
    log('[VIDEO DATA]', data);
    if (
      !init_ts
    ) {
      init_ts = Date.now()
      log('[VIDEO DATA] set init_ts', init_ts);
      const message = {
        timestamp: init_ts,
        metadata: null,
        buffer: null,
      }
      if (
        ptStreamAudio &&
        wsStreamAudio
      ) {
        ptStreamAudio.write(JSON.stringify(message));
        ptStreamAudio.pipe(wsStreamAudio);
      }
      if (
        ptStreamImage &&
        wsStreamImage
      ) {
        ptStreamImage.write(JSON.stringify(message));
        ptStreamImage.pipe(wsStreamImage);
      }
    }
  })
}

function spawnVspeech() {
  ptStreamAudio = new PassThrough();
  wsStreamAudio = createStream(VSPEECH_HOST, VSPEECH_PORT);
  wsStreamAudio.on('error', ()=> {
    if (!dtStreamAudio) { dtStreamAudio = Date.now(); }
    if ((Date.now() - dtStreamAudio) <= VSPEECH_TIMEOUT) {
      log('[AUDIO] failed. Retry in ' + (RETRY_INTERVAL/1000) + ' seconds.');
      setTimeout(spawnVspeech, RETRY_INTERVAL);
    }
    else {
      log('[AUDIO] failed forever. Please check if vSpeech is currently running and restart the splitter.');
    }
    ffmpegAudio.kill();
  });
  spawnFFmpegAudio();
}

function spawnVdetection() {
  ptStreamImage = new PassThrough();
  wsStreamImage = createStream(VDETECTION_HOST, VDETECTION_PORT);
  wsStreamImage.on('error', ()=> {
    if (!dtStreamImage) { dtStreamImage = Date.now(); }
    if ((Date.now() - dtStreamImage) <= VDETECTION_TIMEOUT) {
      log('[IMAGE] failed. Retry in ' + (RETRY_INTERVAL/1000) + ' seconds.');
      setTimeout(spawnVdetection, RETRY_INTERVAL);
    }
    else {
      log('[IMAGE] failed forever. Please check if vDetection is currently running and restart the splitter.');
    }
    ffmpegImage.kill();
  });
  spawnFFmpegImage();
}

function initialize() {
  if (ENABLE_VSPEECH || ENABLE_VDETECTION || ENABLE_STREAM) {
    spawnFFmpegIngress();
  }
  if (ENABLE_VSPEECH) {
    spawnVspeech();
  }
  if (ENABLE_VDETECTION) {
    spawnVdetection();
  }
  if (ENABLE_STREAM) {
    spawnFFmpegVideo();
  }
}

initialize();
