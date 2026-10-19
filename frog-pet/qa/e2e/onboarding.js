const H = require('./harness');
module.exports = async (api) => {
  await H.sleep(2000);
  const first = !require('fs').existsSync(api.storePath()) || !H.file(api).onboarded;
  console.log('storePath', api.storePath(), 'onboarded', api.onboarded);
  const w = api.appWins.welcome;
  if (H.phase === 'second-run') { H.ok(!w, 'no welcome on 2nd run'); return H.done(); }
  H.ok(w && !w.isDestroyed(), 'welcome opened');
  H.ok(api.win && api.win.isVisible(), 'frog window visible');
  const d = await H.exec(w, 'frogApp.getData()');
  H.ok(d && d.settings && d.view && d.state && Array.isArray(d.achievements) && Array.isArray(d.graveyard) && d.version, 'getData fields ' + Object.keys(d));
  // окно приветствия закрывается само — ответа executeJavaScript можно не дождаться
  H.exec(w, 'frogApp.finishOnboarding()').catch(() => {});
  await H.until(() => w.isDestroyed(), 3000); await H.sleep(300);
  H.ok(w.isDestroyed(), 'welcome closed after finishOnboarding');
  H.ok(H.file(api).onboarded === true, 'onboarded in frog.json');
  H.done();
};
