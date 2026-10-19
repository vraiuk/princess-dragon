const H = require('./h');
module.exports = async (api) => {
  await H.sleep(1500);
  const e = JSON.parse(require('fs').readFileSync(__dirname + '/s3.expect', 'utf8'));
  const v = api.pet.view(Date.now());
  H.ok(v.generation === e.gen && v.day.drinks === e.drinks, 'state restored ' + JSON.stringify(e));
  H.ok(api.settings.scale === 1.5 && api.settings.deathEnabled === false && api.settings.waterEvery === 30 && api.settings.sound === false, 'settings restored');
  H.ok(JSON.stringify(api.win.getSize()) === '[390,480]', 'size restored ' + api.win.getSize());
  H.ok(api.win.webContents.getZoomFactor() === 1.5, 'zoom restored');
  H.done();
};
