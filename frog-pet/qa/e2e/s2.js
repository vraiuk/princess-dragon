const H = require('./h');
module.exports = async (api) => {
  await H.sleep(2500);
  const v = api.pet.view(Date.now());
  console.log('life', v.life, 'water', v.waterRatio.toFixed(2), 'totals', JSON.stringify(v.totals), 'settings', JSON.stringify(api.settings));
  H.ok(v.life === 'alive', 'alive after migration');
  H.ok(api.settings.waterEvery === 40 && api.settings.scale === 1.25 && api.settings.deathEnabled === true, 'settings kept + deathEnabled default');
  H.ok(v.totals.drinks === 15, 'totals from history ' + v.totals.drinks);
  H.ok(JSON.stringify(api.win.getSize()) === JSON.stringify([325, 400]), 'scaled size ' + api.win.getSize());
  H.ok(!!api.appWins.welcome, 'welcome shown to v1 user (onboarded missing)');
  api.save();
  const f = H.file(api);
  H.ok(f.pet.history.length === 2 && f.pet.day.drinks === 3 && f.pet.totals && f.achievements, 'saved v2 format');
  H.done();
};
