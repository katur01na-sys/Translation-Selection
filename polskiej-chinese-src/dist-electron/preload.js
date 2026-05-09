"use strict";
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  // 文件操作
  openFileDialog: (type) => ipcRenderer.invoke("open-file-dialog", type),
  readExcel: (args) => ipcRenderer.invoke("read-excel", args),
  exportExcel: (rows) => ipcRenderer.invoke("export-excel", rows),
  parseGuidelineFile: (path) => ipcRenderer.invoke("parse-guideline-file", path),

  // API Key 安全存储
  storeApiKey: (args) => ipcRenderer.invoke("store-api-key", args),
  getApiKey: (provider) => ipcRenderer.invoke("get-api-key", provider),

  // 数据库操作
  dbLoadProject: (args) => ipcRenderer.invoke("db-load-project", args),
  dbSaveSegment: (seg) => ipcRenderer.invoke("db-save-segment", seg),
  dbResetProject: (projectId) => ipcRenderer.invoke("db-reset-project", projectId),
  dbSaveGuideline: (args) => ipcRenderer.invoke("db-save-guideline", args),
  dbSaveGlobalContext: (args) => ipcRenderer.invoke("db-save-global-context", args),
  dbGetSegmentHistory: (args) => ipcRenderer.invoke("db-get-segment-history", args),
  dbGetProjectStats: (projectId) => ipcRenderer.invoke("db-get-project-stats", projectId),
  dbSearchMemory: (query) => ipcRenderer.invoke("db-search-memory", query),
  dbGetMemoryStats: () => ipcRenderer.invoke("db-get-memory-stats"),

  // 项目库
  dbListProjects: () => ipcRenderer.invoke("db-list-projects"),
  dbLoadProjectById: (projectId) => ipcRenderer.invoke("db-load-project-by-id", projectId),
  dbSaveProjectName: (args) => ipcRenderer.invoke("db-save-project-name", args),
  dbDeleteProject: (projectId) => ipcRenderer.invoke("db-delete-project", projectId),
  dbBatchUpdateGender: (args) => ipcRenderer.invoke("db-batch-update-gender", args),
  dbSaveProjectSettings: (args) => ipcRenderer.invoke("db-save-project-settings", args),
  dbGetProjectSettings: (projectId) => ipcRenderer.invoke("db-get-project-settings", projectId),

  // 术语表
  glossaryGet: (projectId) => ipcRenderer.invoke("glossary-get", projectId),
  glossaryAdd: (args) => ipcRenderer.invoke("glossary-add", args),
  glossaryDelete: (id) => ipcRenderer.invoke("glossary-delete", id),
  glossaryUpdate: (args) => ipcRenderer.invoke("glossary-update", args),
  glossaryImport: (args) => ipcRenderer.invoke("glossary-import", args),
  glossaryExport: (args) => ipcRenderer.invoke("glossary-export", args),

  // AI 服务
  deepseekReview: (args) => ipcRenderer.invoke("deepseek-review", args),
  deepseekSummarize: (args) => ipcRenderer.invoke("deepseek-summarize", args),
  testApiConnection: (args) => ipcRenderer.invoke("test-api-connection", args),

  // 后台翻译队列
  startTranslateQueue: (config) => ipcRenderer.invoke("start-translate-queue", config),
  startReviewQueue: (config) => ipcRenderer.invoke("start-review-queue", config),
  startBackgroundReview: (config) => ipcRenderer.invoke("start-background-review", config),
  stopBackgroundReview: () => ipcRenderer.invoke("stop-background-review"),
  pauseBackgroundReview: () => ipcRenderer.invoke("pause-background-review"),
  resumeBackgroundReview: () => ipcRenderer.invoke("resume-background-review"),
  getReviewStatus: () => ipcRenderer.invoke("get-review-status"),
  syncReviewStatus: () => ipcRenderer.invoke("sync-review-status"),
  resetProjectFull: (projectId) => ipcRenderer.invoke("reset-project-full", projectId),
  batchApplyFixes: (projectId) => ipcRenderer.invoke("batch-apply-fixes", { projectId }),
  exportProjectExcel: (projectId, opts) => ipcRenderer.invoke("export-project-excel", { projectId, opts }),
  exportExcel: (rows) => ipcRenderer.invoke("export-excel", rows),

  // 阶段完成事件监听
  onPhaseComplete: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on("phase-complete", handler);
    return () => ipcRenderer.removeListener("phase-complete", handler);
  },

  // 持久化用户偏好
  getAppPref: (key) => ipcRenderer.invoke("get-app-pref", key),
  setAppPref: (key, value) => ipcRenderer.invoke("set-app-pref", { key, value }),

  // 进度事件监听（批量审核推送）
  onReviewProgress: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on("review-progress", handler);
    return () => ipcRenderer.removeListener("review-progress", handler);
  },

  // 术语挖掘
  analyzeTerms: (args) => ipcRenderer.invoke("analyze-terms", args),
  stopTermAnalysis: () => ipcRenderer.invoke("stop-term-analysis"),
  onTermProgress: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on("term-progress", handler);
    return () => ipcRenderer.removeListener("term-progress", handler);
  },

  // 全部项目汇总统计
  dbGetAllStats: () => ipcRenderer.invoke("db-get-all-stats"),

  // 查询当前术语挖掘状态（用于组件重新挂载时恢复）
  getTermState: () => ipcRenderer.invoke("get-term-state"),

  // A4: 统计报告导出
  exportStatsReport: () => ipcRenderer.invoke("export-stats-report"),

  // A5: 术语批量导入
  glossaryBatchImport: (args) => ipcRenderer.invoke("glossary-batch-import", args),

  // AGAN: 对抗式术语扩展
  aganGenerate:   (args) => ipcRenderer.invoke("agan-generate", args),
  aganList:       (args) => ipcRenderer.invoke("agan-list", args),
  aganScoreItem:  (args) => ipcRenderer.invoke("agan-score-item", args),
  aganVerdict:    (args) => ipcRenderer.invoke("agan-verdict", args),
  aganStats:      ()     => ipcRenderer.invoke("agan-stats"),
  aganReset:      ()     => ipcRenderer.invoke("agan-reset"),
  aganExtractTerms: (args) => ipcRenderer.invoke("agan-extract-terms", args),
  aganVerifyIdiom:  (args) => ipcRenderer.invoke("agan-verify-idiom", args),
  aganClearRow:     (args) => ipcRenderer.invoke("agan-clear-row", args),

  // L2: 使用习惯埋点
  logUsageEvent: (args) => ipcRenderer.invoke("log-usage-event", args),

  // Blue Agent: 待审术语池
  pgList:       (args) => ipcRenderer.invoke("pg-list", args),
  pgVerdict:    (args) => ipcRenderer.invoke("pg-verdict", args),
  pgImport:     (args) => ipcRenderer.invoke("pg-import", args),
  pgUpdate:     (args) => ipcRenderer.invoke("pg-update", args),
  aganUpdate:   (args) => ipcRenderer.invoke("agan-update", args),
  pgStopwords:  ()     => ipcRenderer.invoke("pg-stopwords"),

  // 后端主动推送：每个 batch 生成完成后实时推送计数和新词条
  onAganProgress: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('agan-progress', handler);
    return () => ipcRenderer.removeListener('agan-progress', handler);
  },

  // S7: 版本号
  getAppVersion: () => ipcRenderer.invoke("get-app-version"),
  // S5: 日志导出
  exportDiagnosticLog: () => ipcRenderer.invoke("export-diagnostic-log"),
});
