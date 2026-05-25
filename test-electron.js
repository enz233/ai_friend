const { app, BrowserWindow } = require('electron');

app.whenReady().then(() => {
  console.log('Electron app is ready!');
  const win = new BrowserWindow({ width: 400, height: 300 });
  win.loadURL('data:text/html,<h1>Hello from Electron!</h1>');

  setTimeout(() => {
    console.log('Closing...');
    app.quit();
  }, 3000);
});
