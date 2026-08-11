const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getPathForFile: (file) => webUtils.getPathForFile(file),
  selectFiles: () => ipcRenderer.invoke('select-files'),
  selectOutput: (defaultName) => ipcRenderer.invoke('select-output', defaultName),
  probeInfo: (filePath) => ipcRenderer.invoke('probe-info', filePath),
  exportVideo: (payload) => ipcRenderer.invoke('export-video', payload),
  cancelExport: () => ipcRenderer.invoke('cancel-export'),
  trackSubject: (payload) => ipcRenderer.invoke('track-subject', payload),
  clearCache: () => ipcRenderer.invoke('clear-cache'),
  onProgress: (callback) => {
    ipcRenderer.removeAllListeners('export-progress');
    ipcRenderer.on('export-progress', (event, data) => callback(data));
  },
});
