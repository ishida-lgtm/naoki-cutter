const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getPathForFile: (file) => webUtils.getPathForFile(file),
  selectFiles: () => ipcRenderer.invoke('select-files'),
  selectOutput: (defaultName) => ipcRenderer.invoke('select-output', defaultName),
  probeInfo: (filePath) => ipcRenderer.invoke('probe-info', filePath),
  exportVideo: (payload) => ipcRenderer.invoke('export-video', payload),
  exportComparison: (payload) => ipcRenderer.invoke('export-comparison', payload),
  analyzeExportedVideo: (filePath) => ipcRenderer.invoke('analyze-exported-video', filePath),
  saveExportedAsReference: (payload) => ipcRenderer.invoke('save-exported-as-reference', payload),
  cancelExport: () => ipcRenderer.invoke('cancel-export'),
  trackSubject: (payload) => ipcRenderer.invoke('track-subject', payload),
  listProjects: () => ipcRenderer.invoke('list-projects'),
  saveProject: (payload) => ipcRenderer.invoke('save-project', payload),
  loadProject: (id) => ipcRenderer.invoke('load-project', id),
  deleteProjectsAndCache: () => ipcRenderer.invoke('delete-projects-and-cache'),
  clearCache: () => ipcRenderer.invoke('clear-cache'),
  moveCursor: (position) => ipcRenderer.invoke('move-cursor', position),
  setFullScreen: (enabled) => ipcRenderer.invoke('set-full-screen', enabled),
  audioWaveform: (payload) => ipcRenderer.invoke('audio-waveform', payload),
  startReviewRecording: (outputPath) => ipcRenderer.invoke('start-review-recording', outputPath),
  appendReviewRecording: (payload) => ipcRenderer.invoke('append-review-recording', payload),
  finishReviewRecording: (id) => ipcRenderer.invoke('finish-review-recording', id),
  cancelReviewRecording: (id) => ipcRenderer.invoke('cancel-review-recording', id),
  checkForUpdate: () => ipcRenderer.invoke('check-for-update'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  onUpdateProgress: (callback) => {
    ipcRenderer.removeAllListeners('update-progress');
    ipcRenderer.on('update-progress', (event, data) => callback(data));
  },
  onProgress: (callback) => {
    ipcRenderer.removeAllListeners('export-progress');
    ipcRenderer.on('export-progress', (event, data) => callback(data));
  },
});
