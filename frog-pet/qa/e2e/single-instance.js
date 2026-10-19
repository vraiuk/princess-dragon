const H = require('./harness');
// Первый экземпляр прячет окно и ждёт; run.js по метке [ready] запускает второй экземпляр с тем же HOME.
// Второй должен разбудить первый (second-instance → окно снова видно) и сразу выйти.
module.exports = async (api) => {
  let got = 0;
  require('electron').app.on('second-instance', () => { got++; });
  await H.sleep(1000);
  api.win.hide();
  await H.sleep(300);
  H.ok(!api.win.isVisible(), 'frog window hidden before second launch');
  console.log('[ready]');
  await H.until(() => got >= 1, 30000);
  await H.sleep(500);
  H.ok(got >= 1, 'first got second-instance ' + got);
  H.ok(api.win.isVisible() && !api.hidden, 'second launch shows the frog');
  H.done();
};
