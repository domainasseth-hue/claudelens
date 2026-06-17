const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('claudeLens', {
  readProjects: () => ipcRenderer.invoke('read-projects'),
  readSessions: () => ipcRenderer.invoke('read-sessions'),
  readActiveSession: () => ipcRenderer.invoke('read-active-session'),
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),
  onActiveSessionUpdate: (callback) => {
    ipcRenderer.on('active-session-update', (_event, data) => {
      callback(data);
    });
  }
});