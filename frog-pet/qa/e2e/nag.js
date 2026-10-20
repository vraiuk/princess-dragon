const H = require('./harness');
const MIN = 60000;
// Круг 2: «ква» и уведомления не чаще nagEvery (r1-02-04), пачка ачивок — одно уведомление (r1-07-08),
// подсказка трея без «через 0 мин» (r1-05-04)
const isNag = (n) => /Пора/.test(n);
const isAch = (n) => /ачивк|🏆|🤡/i.test(n.split(' | ')[0]);

module.exports = async (api) => {
  await H.sleep(1500);
  if (H.phase === 'burst') {
    // r1-07-08: 200 быстрых действий из окна жабы
    await H.exec(api.win, "const t = ['drink', 'stretch', 'poke', 'dragged']; for (let i = 0; i < 200; i++) frog.action(t[i % 4]); for (let i = 0; i < 12; i++) frog.action('snooze', { kind: 'water' })");
    await H.sleep(3000);
    const ach = H.notes.filter(isAch);
    const got = api.achievements.list().filter((a) => a.unlocked).length;
    H.ok(got >= 2, 'several achievements unlocked: ' + got);
    H.ok(ach.length <= 1, 'one notification for a burst of achievements: ' + ach.length + ' ' + ach.join(' / '));
    return H.done();
  }
  H.trayMenu(api);
  const sent = H.spySend(api.win);
  api.win.close(); await H.sleep(300);           // спрятана — напоминания идут и уведомлениями
  const S = api.settings;
  // обе потребности созрели в один тик
  api.pet.state.waterMs = S.waterEvery * MIN * 1.05;
  api.pet.state.sitMs = S.moveEvery * MIN * 1.05;
  api.pet.state.nextNag = { water: 0, move: 0 };
  await H.until(() => sent.filter(([ch, p]) => ch === 'event' && p.type === 'remind').length >= 2, 4000);
  let reminds = sent.filter(([ch, p]) => ch === 'event' && p.type === 'remind').map(([, p]) => p);
  H.ok(reminds.length === 2, 'two reminders in one tick: ' + reminds.map((r) => r.kind));
  H.ok(H.notes.filter(isNag).length === 1, 'one notification for both: ' + H.notes.filter(isNag).join(' / '));
  H.ok(reminds.filter((r) => !r.quiet).length === 1, 'only one loud reminder (ква): ' + JSON.stringify(reminds.map((r) => r.quiet)));
  // через несколько секунд снова повтор по одной потребности (как чередуются 45 и 50 мин) — тихо
  api.pet.state.nextNag.move = 0;
  await H.until(() => sent.filter(([ch, p]) => ch === 'event' && p.type === 'remind').length >= 3, 4000);
  reminds = sent.filter(([ch, p]) => ch === 'event' && p.type === 'remind').map(([, p]) => p);
  H.ok(reminds.length === 3 && reminds[2].quiet === true, 'repeat inside nagEvery is quiet: ' + JSON.stringify(reminds.map((r) => r.quiet)));
  H.ok(H.notes.filter(isNag).length === 1, 'no extra notification inside nagEvery: ' + H.notes.filter(isNag).length);

  // r1-05-04: подсказка трея, когда уже пора
  api.updateTray();
  const tip = api.tray.__tip || '';
  H.ok(/пора/i.test(tip) && !/через 0 мин/.test(tip), 'tray tooltip: ' + tip);
  H.done();
};
