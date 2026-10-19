const H = require('./h');
const fs = require('fs');
module.exports = async (api) => {
  await H.sleep(1500);
  const v = api.pet.view(Date.now());
  H.ok(v && typeof v.waterLeftMin === 'number' && !Number.isNaN(v.waterLeftMin), 'view ok: waterLeftMin ' + v.waterLeftMin + ' gen ' + v.generation);
  H.ok(Number.isFinite(api.settings.scale) && api.settings.waterEvery > 0, 'settings sane ' + JSON.stringify(api.settings));
  api.act('drink'); api.act('stretch'); api.act('poke');
  const d = await H.exec(api.win, 'frog.init()');
  H.ok(d && d.view, 'init ok');
  const tw = api.openWindow('trophies'); await H.sleep(1500);
  const dd = await H.exec(tw, 'frogApp.getData()');
  H.ok(dd && dd.achievements.length > 0, 'trophies data with junk file');
  if (process.env.DRAG) {
    // быстрые drag-start/end
    const p0 = api.win.getPosition();
    await H.exec(api.win, 'for (let i = 0; i < 50; i++) { frog.dragStart(); frog.dragEnd(); } frog.dragStart(); frog.dragStart(); frog.dragEnd(); frog.dragEnd(); frog.dragEnd();');
    await H.sleep(500);
    H.ok(JSON.stringify(api.win.getPosition()) === JSON.stringify(p0), 'position stable after rapid drag ' + api.win.getPosition());
    // ignore during drag
    await H.exec(api.win, 'frog.dragStart(); frog.setIgnore(true);'); await H.sleep(100);
    await H.exec(api.win, 'frog.dragEnd();'); await H.sleep(200);
    H.ok(true, 'drag + ignore no crash');
  }
  const drinks = api.pet.view(Date.now()).day.drinks;
  fs.writeFileSync(__dirname + '/s7.drinks', String(drinks));
  console.log('[result] quitting via app.quit');
  require('electron').app.quit();
};
