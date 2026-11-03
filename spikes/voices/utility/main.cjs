// Loads sherpa-onnx-node in an Electron utility process, the way the app's
// media worker would, and diarizes one file there.
//
//   npx electron voices/utility/main.cjs <wav> <segmentation.onnx> <embedding.onnx>
const { app, utilityProcess } = require('electron');
const path = require('node:path');

app.whenReady().then(() => {
  const child = utilityProcess.fork(path.join(__dirname, 'child.cjs'), process.argv.slice(-3), { stdio: 'inherit' });
  child.on('message', (m) => {
    console.log(JSON.stringify({ electron: process.versions.electron, ...m }));
    app.quit();
  });
  child.on('exit', (code) => {
    if (code !== 0) console.log(`utility process exited with ${code}`);
    app.quit();
  });
});
