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
  onStateChanged: (callback: (event: any) => void) => {
    ipcRenderer.on('state-changed', (_event, data) => callback(data));
  },
  onStateUpdate: (callback: (data: any) => void) => {
    ipcRenderer.on('state-update', (_event, data) => callback(data));
  },
  onSpritesPath: (callback: (path: string) => void) => {
    ipcRenderer.on('sprites-path', (_event, path) => callback(path));
  },
});
