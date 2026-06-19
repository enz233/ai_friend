import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('companion', {
  sendCursorMove: (data: { x: number; y: number }) => {
    ipcRenderer.send('cursor-move', data);
  },
  sendDragStart: () => {
    ipcRenderer.send('drag-start');
  },
  sendDragEnd: () => {
    ipcRenderer.send('drag-end');
  },
  sendClick: () => {
    ipcRenderer.send('user-click');
  },
  sendWindowMoveBy: (data: { deltaX: number; deltaY: number }) => {
    ipcRenderer.send('window-move-by', data);
  },
  sendMouseEnter: () => {
    ipcRenderer.send('mouse-enter');
  },
  sendMouseLeave: () => {
    ipcRenderer.send('mouse-leave');
  },
  sendLonelyAction: (active: boolean) => {
    ipcRenderer.send('lonely-action', active);
  },
  sendStateFinished: () => {
    ipcRenderer.send('state-finished');
  },
  sendUserMessage: (text: string) => {
    ipcRenderer.send('user-message', text);
  },
  openSettings: () => {
    ipcRenderer.send('open-settings');
  },
  loadAIConfig: (): Promise<any> => {
    return ipcRenderer.invoke('load-ai-config');
  },
  saveAIConfig: (config: any) => {
    ipcRenderer.send('save-ai-config', config);
  },
  testAIConnection: (): Promise<any> => {
    return ipcRenderer.invoke('test-ai-connection');
  },
  log: (level: string, message: string) => {
    ipcRenderer.send('renderer-log', level, message);
  },
  getLogPath: (): Promise<string> => {
    return ipcRenderer.invoke('get-log-path');
  },
  openLogFile: () => {
    ipcRenderer.send('open-log-file');
  },
  clearChatHistory: () => {
    ipcRenderer.send('clear-chat-history');
  },
  getChatInfo: (): Promise<any> => {
    return ipcRenderer.invoke('get-chat-info');
  },
  loadAppearanceConfig: (): Promise<any> => {
    return ipcRenderer.invoke('load-appearance-config');
  },
  saveAppearanceConfig: (config: any) => {
    ipcRenderer.send('save-appearance-config', config);
  },
  applyAppearance: (config: any) => {
    ipcRenderer.send('apply-appearance', config);
  },
  testScreenAnalysis: (): Promise<any> => {
    return ipcRenderer.invoke('test-screen-analysis');
  },
  onUpdatePetSize: (callback: (size: number) => void) => {
    ipcRenderer.on('update-pet-size', (_event, size) => callback(size));
  },
  onTtsPlay: (callback: (base64: string, text: string) => void) => {
    ipcRenderer.on('tts-play', (_event, base64, text) => callback(base64, text));
  },
  onTtsStop: (callback: () => void) => {
    ipcRenderer.on('tts-stop', () => callback());
  },
  sendTtsPlaybackDone: () => {
    ipcRenderer.send('tts-playback-done');
  },
  loadTTSConfig: (): Promise<any> => {
    return ipcRenderer.invoke('load-tts-config');
  },
  saveTTSConfig: (config: any) => {
    ipcRenderer.send('save-tts-config', config);
  },
  testTTS: (): Promise<any> => {
    return ipcRenderer.invoke('test-tts');
  },
  onLog: (callback: (data: any) => void) => {
    ipcRenderer.on('debug-log', (_event, data) => callback(data));
  },
  onStateChanged: (callback: (event: any) => void) => {
    ipcRenderer.on('state-changed', (_event, data) => callback(data));
  },
  onStateUpdate: (callback: (data: any) => void) => {
    ipcRenderer.on('state-update', (_event, data) => callback(data));
  },
  onSpritesPath: (callback: (path: string) => void) => {
    ipcRenderer.on('sprites-path', (_event, path) => callback(path));
  },
  onShowBubble: (callback: (text: string) => void) => {
    ipcRenderer.on('show-bubble', (_event, text) => callback(text));
  },
});
