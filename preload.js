const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getPathForFile: (file) => webUtils.getPathForFile(file),
  selectFiles: () => ipcRenderer.invoke('select-files'),
  selectOutput: (defaultName) => ipcRenderer.invoke('select-output', defaultName),
  probeInfo: (filePath) => ipcRenderer.invoke('probe-info', filePath),
  ensurePreviewProxy: (filePath) => ipcRenderer.invoke('ensure-preview-proxy', filePath),
  exportVideo: (payload) => ipcRenderer.invoke('export-video', payload),
  exportComparison: (payload) => ipcRenderer.invoke('export-comparison', payload),
  autoSyncComparison: (payload) => ipcRenderer.invoke('auto-sync-comparison', payload),
  detectAutoCutSegments: (payload) => ipcRenderer.invoke('detect-auto-cut-segments', payload),
  analyzeFormLocal: (payload) => ipcRenderer.invoke('analyze-form-local', payload),
  analyzeFormCloud: (payload) => ipcRenderer.invoke('analyze-form-cloud', payload),
  createLessonVideo: (payload) => ipcRenderer.invoke('create-lesson-video', payload),
  listTrainingData: () => ipcRenderer.invoke('list-training-data'),
  saveTrainingExample: (payload) => ipcRenderer.invoke('save-training-example', payload),
  saveTrainingSegment: (payload) => ipcRenderer.invoke('save-training-segment', payload),
  saveTrainingFeedback: (payload) => ipcRenderer.invoke('save-training-feedback', payload),
  deleteTrainingExample: (id) => ipcRenderer.invoke('delete-training-example', id),
  listAnalysisHistory: () => ipcRenderer.invoke('list-analysis-history'),
  saveAnalysisHistory: (payload) => ipcRenderer.invoke('save-analysis-history', payload),
  deleteAnalysisHistory: (id) => ipcRenderer.invoke('delete-analysis-history', id),
  exportAiDataBackup: () => ipcRenderer.invoke('export-ai-data-backup'),
  importAiDataBackup: () => ipcRenderer.invoke('import-ai-data-backup'),
  analyzeExportedVideo: (filePath) => ipcRenderer.invoke('analyze-exported-video', filePath),
  saveExportedAsReference: (payload) => ipcRenderer.invoke('save-exported-as-reference', payload),
  listReferenceVideos: () => ipcRenderer.invoke('list-reference-videos'),
  saveReferenceTags: (payload) => ipcRenderer.invoke('save-reference-tags', payload),
  deleteReferenceVideo: (id) => ipcRenderer.invoke('delete-reference-video', id),
  surfAnalyzerStatus: () => ipcRenderer.invoke('surf-analyzer-status'),
  restartSurfAnalyzer: () => ipcRenderer.invoke('restart-surf-analyzer'),
  cancelExport: () => ipcRenderer.invoke('cancel-export'),
  trackSubject: (payload) => ipcRenderer.invoke('track-subject', payload),
  listProjects: () => ipcRenderer.invoke('list-projects'),
  saveProject: (payload) => ipcRenderer.invoke('save-project', payload),
  loadProject: (id) => ipcRenderer.invoke('load-project', id),
  saveAutosave: (payload) => ipcRenderer.invoke('save-autosave', payload),
  loadLatestAutosave: () => ipcRenderer.invoke('load-latest-autosave'),
  deleteProject: (id) => ipcRenderer.invoke('delete-project', id),
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
  onAutoCutProgress: (callback) => {
    ipcRenderer.removeAllListeners('auto-cut-progress');
    ipcRenderer.on('auto-cut-progress', (event, data) => callback(data));
  },
  onSurfAnalyzerStatus: (callback) => {
    ipcRenderer.removeAllListeners('surf-analyzer-status');
    ipcRenderer.on('surf-analyzer-status', (event, data) => callback(data));
  },
});
