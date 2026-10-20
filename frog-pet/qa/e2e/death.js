const H = require('./harness');
const fs = require('fs');
module.exports = async (api) => {
  H.trayTitle(api);
  // подготовка: живая жаба на грани, lastTick свежий, onboarded
  if (H.phase === 'die') {
    api.pet.state.waterMs = 5 * 3600000;
    await H.sleep(2500);
    const v = api.pet.view(Date.now());
    H.ok(v.life === 'dead' && v.cause === 'dry', 'died of thirst');
    H.ok(H.notes.some((n) => /засохла/.test(n)), 'death notification: ' + H.notes.join(' / '));
    api.updateTray();
    H.ok(api.tray.__title === ' 💀', 'tray title ' + JSON.stringify(api.tray.__title));
    const ach = api.achievements.list().filter((a) => a.unlocked).map((a) => a.id);
    H.ok(ach.includes('raisin') || ach.some((x) => /rais|dry|изюм/i.test(x)), 'achievements: ' + ach.join(','));
    // tray menu "revive" item exists? use act from tray path
    api.act('revive');
    await H.sleep(300);
    const v2 = api.pet.view(Date.now());
    H.ok(v2.life === 'alive' && v2.generation === 2, 'revived gen2');
    api.updateTray();
    H.ok(api.tray.__title !== ' 💀', 'tray title after revive ' + JSON.stringify(api.tray.__title));
    const ach2 = api.achievements.list().filter((a) => a.unlocked).map((a) => a.id);
    console.log('after revive ach', ach2.join(','));
    // stone death
    api.pet.state.sitMs = 3 * 3600000;
    await H.sleep(2000);
    const v3 = api.pet.view(Date.now());
    H.ok(v3.life === 'dead' && v3.cause === 'stone', 'stone death ' + v3.cause);
    const ach3 = api.achievements.list().filter((a) => a.unlocked).map((a) => a.id);
    fs.writeFileSync(H.side('ach.json'), JSON.stringify(ach3));
    console.log('ach', ach3.join(','));
    return H.done();
  }
  await H.sleep(1500);
  const exp = JSON.parse(fs.readFileSync(H.side('ach.json')));
  const now = api.achievements.list().filter((a) => a.unlocked).map((a) => a.id);
  H.ok(exp.every((x) => now.includes(x)), 'achievements persisted ' + now.length);
  const v = api.pet.view(Date.now());
  H.ok(v.life === 'dead' && v.graveyardCount === 2 && v.totals.deaths === 2, 'dead state + graveyard persisted');
  H.done();
};
