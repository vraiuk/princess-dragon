const H = require('./h');
const { BrowserWindow } = require('electron');
module.exports = async (api) => {
  await H.sleep(1000);
  for (const name of ['trophies', 'settings', 'welcome']) {
    const w1 = api.openWindow(name), w2 = api.openWindow(name);
    H.ok(w1 && w1 === w2, name + ' single instance');
    await H.sleep(1500);
    H.ok(w1.isVisible(), name + ' visible, size ' + w1.getSize());
    const d = await H.exec(w1, 'frogApp.getData()');
    H.ok(['settings', 'view', 'state', 'achievements', 'graveyard', 'version'].every((k) => k in d) && d.achievements.length >= 30, name + ' getData ' + d.achievements.length);
    const got = await H.exec(w1, 'new Promise((r) => { const off = frogApp.onUpdate((x) => { off(); r(!!(x && x.view)); }); setTimeout(() => r(false), 3000); })');
    H.ok(got, name + ' onUpdate');
    const bodyLen = await H.exec(w1, 'document.body.innerText.length');
    H.ok(bodyLen > 50, name + ' rendered text ' + bodyLen);
  }
  // open from app window
  await H.exec(api.appWins.trophies, "frogApp.open('settings')"); await H.sleep(300);
  H.ok(BrowserWindow.getAllWindows().length === 4, 'open from window does not duplicate');
  // action from app window
  const dr = api.pet.view(Date.now()).day.drinks;
  await H.exec(api.appWins.trophies, "frogApp.action('drink')"); await H.sleep(300);
  H.ok(api.pet.view(Date.now()).day.drinks === dr + 1, 'app:action drink');
  // close each
  for (const name of ['trophies', 'settings', 'welcome']) {
    const w = api.appWins[name];
    await H.exec(w, 'frogApp.close()').catch(() => {}); await H.sleep(500);
    H.ok(w.isDestroyed() && !api.appWins[name], name + ' closed');
  }
  // reopen after close
  const w = api.openWindow('trophies'); await H.sleep(1200);
  H.ok(w && !w.isDestroyed(), 'reopen trophies');
  // frog window cannot be closed via frogApp.close (not exposed) and Cmd+W just hides
  api.win.close(); await H.sleep(300);
  H.ok(api.win && !api.win.isDestroyed() && api.hidden, 'frog window close -> hidden');
  api.act('drink'); // no crash while hidden
  H.done();
};
