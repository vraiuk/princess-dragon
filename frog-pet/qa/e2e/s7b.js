const H = require('./h');
module.exports = async (api) => {
  await H.sleep(800);
  const e = Number(require('fs').readFileSync(__dirname + '/s7.drinks', 'utf8'));
  H.ok(api.pet.view(Date.now()).day.drinks === e, 'state saved on quit: drinks ' + e);
  H.done();
};
