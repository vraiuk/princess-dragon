const H = require('./h');
const strip = (f) => { const p = JSON.parse(JSON.stringify(f)); delete p.pet.lastTick; delete p.pet.idleSec; p.pet.day.codingMs = 0; p.pet.totals.codingMs = 0; return p; };
module.exports = async (api) => {
  H.trayTitle(api);
  await H.sleep(1500);
  api.act('drink'); api.save();
  const before = strip(H.file(api));
  const tw = api.openWindow('trophies'); await H.sleep(1000);
  api.startFilm('short');
  H.ok(api.film && api.film.name === 'short', 'film started');
  await H.sleep(1500); api.updateTray();
  H.ok(api.tray.__title === ' 🎬', 'tray 🎬');
  const d = await H.exec(tw, 'frogApp.getData()');
  H.ok(d.filming === 'short', 'app data filming');
  // во время съёмки: тык из окна жабы, setSetting, drink с app окна идёт в film pet
  await H.exec(api.win, "frog.action('poke')");
  await H.sleep(12000);
  const fv = api.film.pet.view(api.film.now);
  console.log('film pet life', fv.life, 'gen', fv.generation, 'notes', H.notes.length);
  H.ok(H.notes.length === 0, 'no notifications during film');
  H.ok(JSON.stringify(strip(H.file(api)).pet) === JSON.stringify(before.pet), 'file untouched during film');
  api.stopFilm();
  await H.sleep(1500);
  H.ok(!api.film, 'stopped');
  api.updateTray();
  H.ok(api.tray.__title !== ' 🎬', 'tray restored ' + JSON.stringify(api.tray.__title));
  api.save();
  const after = strip(H.file(api));
  H.ok(JSON.stringify(after.pet) === JSON.stringify(before.pet), 'pet state equal after film');
  H.ok(JSON.stringify(after.achievements) === JSON.stringify(before.achievements), 'achievements equal after film');
  H.ok(JSON.stringify(after.settings) === JSON.stringify(before.settings), 'settings equal');
  if (JSON.stringify(after.pet) !== JSON.stringify(before.pet)) { console.log(JSON.stringify(before.pet)); console.log(JSON.stringify(after.pet)); }
  // полный сценарий до конца сам
  api.startFilm('water');
  const dur = require('/home/user/princess-dragon/frog-pet/app/showcase').SCRIPTS.water.duration;
  console.log('water dur', dur);
  await H.sleep((dur + 3) * 1000);
  H.ok(!api.film, 'film auto-ended');
  H.done();
};
