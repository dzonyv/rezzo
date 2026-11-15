import { Config } from '@remotion/cli/config';

// H.264 with a high bitrate: social sites re-encode anyway, so give them a clean start.
Config.setVideoImageFormat('jpeg');
Config.setJpegQuality(95);
Config.setCodec('h264');
Config.setCrf(16);
Config.setOverwriteOutput(true);
