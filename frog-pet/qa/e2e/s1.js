const H = require('./h');
module.exports = async (api) => {
  await H.sleep(2000);
  const first = !require('fs').existsSync(api.storePath()) || !H.file(api).onboarded;
  console.log('storePath', api.storePath(), 'onboarded', api.onboarded);
  const w = api.appWins.welcome;
  if (process.env.EXPECT_WELCOME === '0') { H.ok(!w, 'no welcome on 2nd run'); return H.done(); }
  H.ok(w && !w.isDestroyed(), 'welcome opened');
  H.ok(api.win && api.win.isVisible(), 'frog window visible');
  const d = await H.exec(w, 'frogApp.getData()');
  H.ok(d && d.settings && d.view && d.state && Array.isArray(d.achievements) && Array.isArray(d.graveyard) && d.version, 'getData fields ' + Object.keys(d));
  await H.exec(w, 'frogApp.finishOnboarding()');
  await H.sleep(800);
  H.ok(w.isDestroyed(), 'welcome closed after finishOnboarding');
  H.ok(H.file(api).onboarded === true, 'onboarded in frog.json');
  H.done();
};
