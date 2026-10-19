const H = require('./h');
module.exports = async (api) => {
  let got = 0; require('electron').app.on('second-instance', () => { got++; });
  api.win.hide(); 
  await H.sleep(12000);
  H.ok(got >= 1, 'first got second-instance ' + got);
  H.done();
};
