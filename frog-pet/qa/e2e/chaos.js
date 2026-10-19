const H = require('./harness');
const { screen } = require('electron');
// Круг 2 (r1-07, r1-04-02): падения рендера, масштаб у края и во время drag, съёмка поверх спрятанной/мёртвой жабы
const alive = (w) => w && !w.isDestroyed() && !w.webContents.isCrashed();

module.exports = async (api) => {
  H.trayTitle(api); H.trayMenu(api);
  await H.sleep(1500);

  // r1-07-01: упал рендер окна жабы — main сам поднимает его заново
  const W = api.win;
  W.webContents.forcefullyCrashRenderer();
  await H.until(() => alive(W), 8000); await H.sleep(1500);
  const bridge = alive(W) ? await H.within(H.exec(W, 'typeof window.frog + typeof window.__frogDebug'), 3000, 'timeout') : 'crashed';
  H.ok(api.win === W && bridge === 'objectobject', 'frog renderer recovered after crash: ' + bridge);

  // r1-07-05: окно настроек упало — повторное открытие показывает живое окно, а не пустое
  const s1 = api.openWindow('settings'); await H.sleep(1500);
  s1.webContents.forcefullyCrashRenderer(); await H.sleep(200);
  const s2 = api.openWindow('settings');
  await H.until(() => alive(s2), 6000); await H.sleep(1500);
  const len = alive(s2) ? await H.within(H.exec(s2, 'document.body.innerText.length'), 3000, -1) : -1;
  H.ok(len > 50, 'settings reopened alive after crash, text ' + len);
  if (alive(s2)) s2.close();

  // r1-07-02: смена масштаба у левого верхнего края не уводит окно за экран
  const wa = screen.getPrimaryDisplay().workArea;
  api.setSetting('scale', 0.75);
  api.win.setPosition(wa.x, wa.y); await H.sleep(200);
  api.setSetting('scale', 1.5); await H.sleep(200);
  H.ok(H.onScreen(api.win.getBounds()), 'scale 0.75→1.5 at top-left stays on screen ' + JSON.stringify(api.win.getBounds()));
  api.setSetting('scale', 1); await H.sleep(200);
  H.ok(H.onScreen(api.win.getBounds()), 'scale 1.5→1 stays on screen ' + JSON.stringify(api.win.getBounds()));

  // r1-07-03: смена масштаба во время перетаскивания — окно растёт вверх-влево и остаётся на экране
  const [w, h] = api.win.getSize();
  api.win.setPosition(wa.x + wa.width - w, wa.y + wa.height - h); await H.sleep(200);
  await H.exec(api.win, 'frog.dragStart()'); await H.sleep(150);
  api.setSetting('scale', 1.5); await H.sleep(300);
  await H.exec(api.win, 'frog.dragEnd()'); await H.sleep(300);
  H.ok(H.onScreen(api.win.getBounds()), 'scale during drag stays on screen ' + JSON.stringify(api.win.getBounds()));
  H.ok(H.onScreen(Object.assign({ width: 390, height: 480 }, { x: H.file(api).pos[0], y: H.file(api).pos[1] })), 'saved pos on screen ' + JSON.stringify(H.file(api).pos));
  api.setSetting('scale', 1);

  // реальная жаба мертва и спрятана, затем съёмка
  api.pet.state.waterMs = 10 * 3600000;
  await H.until(() => api.pet.view(Date.now()).life === 'dead', 4000);
  H.ok(api.pet.view(Date.now()).life === 'dead', 'real frog dead');
  api.win.close(); await H.sleep(300);
  H.ok(api.hidden, 'hidden before film');
  const sent = H.spySend(api.win);
  api.startFilm('short');
  await H.sleep(2000);
  // r1-07-07: заголовок трея — 🎬 сам, без ручного updateTray
  H.ok(api.tray.__title === ' 🎬', 'tray 🎬 during film ' + JSON.stringify(api.tray.__title));
  // r1-07-04: «Высидеть» во время съёмки выключен (иначе act уходит в съёмочную жабу)
  const items = api.tray.__menu ? api.tray.__menu.items : [];
  const egg = items.find((i) => /Высидеть/.test(i.label));
  H.ok(egg && egg.enabled === false, 'revive item disabled during film: ' + (egg ? egg.enabled : 'no item'));
  // r1-04-02: титры сценария доходят до окна жабы
  const caps = sent.filter(([ch, p]) => ch === 'event' && p && p.type === 'caption');
  H.ok(caps.length >= 1 && /жаба/i.test(caps[0][1].text), 'caption event sent: ' + (caps[0] ? caps[0][1].text : 'none'));
  // r1-07-06: после съёмки жаба снова спрятана, как была
  api.stopFilm(); await H.sleep(500);
  H.ok(api.hidden && !api.win.isVisible(), 'hidden restored after film: hidden=' + api.hidden + ' visible=' + api.win.isVisible());
  api.save();
  H.ok(H.file(api).hidden === true, 'hidden saved after film');
  H.ok(api.tray.__title === ' 💀', 'tray after film ' + JSON.stringify(api.tray.__title));
  H.done();
};
