import { Config } from '@remotion/cli/config';

// Studio/CLI settings. Programmatic renders (src/factory/render.js in the pipeline) pass the same options.
Config.setVideoImageFormat('jpeg');
Config.setJpegQuality(92);
Config.setOverwriteOutput(true);
Config.setDelayRenderTimeoutInMilliseconds(120000);
if (process.env.REMOTION_BROWSER) Config.setBrowserExecutable(process.env.REMOTION_BROWSER);
