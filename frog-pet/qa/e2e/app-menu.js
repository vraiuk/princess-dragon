const H = require('./harness');
const { Menu } = require('electron');
module.exports = async (api) => {
  await H.sleep(500);
  const m = Menu.getApplicationMenu();
  const roles = []; const walk = (mm) => mm.items.forEach((i) => { if (i.role) roles.push(i.role); if (i.submenu) walk(i.submenu); }); walk(m);
  H.ok(!roles.includes('quit') && roles.includes('paste') && roles.includes('close') && roles.includes('minimize'), 'app menu roles ' + roles.join(','));
  H.done();
};
