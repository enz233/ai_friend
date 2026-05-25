console.log('Process type:', process.type);
console.log('Process versions:', JSON.stringify(process.versions, null, 2));

try {
  const electron = require('electron');
  console.log('Electron module type:', typeof electron);
  console.log('Electron keys:', Object.keys(electron).slice(0, 10));
  console.log('Has app:', typeof electron.app);
} catch (e) {
  console.error('Error loading electron:', e.message);
}
