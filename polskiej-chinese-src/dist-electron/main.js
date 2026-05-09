"use strict";
const { app, BrowserWindow, ipcMain, dialog, safeStorage } = require("electron");
const path = require("path");
const https = require("https");
const fs = require("fs");
const Database = require("better-sqlite3");

// ─── Database ────────────────────────────────────────────────────────────────
let db;

const MIGRATIONS = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY);
      INSERT OR IGNORE INTO schema_version VALUES (0);

      CREATE TABLE IF NOT EXISTS projects (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        file_path      TEXT UNIQUE NOT NULL,
        guideline_text TEXT DEFAULT '',
        global_context TEXT DEFAULT '',
        created_at     TEXT DEFAULT (datetime('now')),
        updated_at     TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS segments (
        id              INTEGER PRIMARY KEY,
        project_id      INTEGER NOT NULL,
        source          TEXT NOT NULL,
        target          TEXT NOT NULL,
        original_target TEXT NOT NULL,
        status          TEXT NOT NULL DEFAULT 'pending',
        score           INTEGER,
        errors          TEXT DEFAULT '[]',
        dimensions      TEXT DEFAULT '{}',
        fixed_target    TEXT DEFAULT '',
        fixed           INTEGER DEFAULT 0,
        FOREIGN KEY (project_id) REFERENCES projects(id)
      );

      CREATE TABLE IF NOT EXISTS segment_history (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        segment_id  INTEGER NOT NULL,
        project_id  INTEGER NOT NULL,
        target      TEXT,
        score       INTEGER,
        errors      TEXT,
        fixed_target TEXT,
        saved_at    TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS glossary (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id  INTEGER,
        source_term TEXT NOT NULL,
        target_term TEXT NOT NULL,
        notes       TEXT DEFAULT ''
      );

      CREATE TABLE IF NOT EXISTS memory_segments (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        source      TEXT NOT NULL,
        target      TEXT NOT NULL,
        project_id  INTEGER,
        score       INTEGER,
        saved_at    TEXT DEFAULT (datetime('now'))
      );
    `
  }
];

function initDb() {
  const dir = path.join(app.getPath("userData"), "ch-pl-lqa");
  const dbPath = path.join(dir, "lqa.db");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");

  // 版本迁移管理
  try {
    db.exec("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY); INSERT OR IGNORE INTO schema_version VALUES (0);");
  } catch {}
  const currentVersion = (db.prepare("SELECT version FROM schema_version").get() || { version: 0 }).version;

  for (const m of MIGRATIONS) {
    if (m.version > currentVersion) {
      // 在事务中执行
      const runMigration = db.transaction(() => {
        db.exec(m.sql);
        db.exec("DELETE FROM schema_version;");
        db.prepare("INSERT INTO schema_version VALUES (?)").run(m.version);
      });
      try {
        runMigration();
      } catch (e) {
        // 忽略已存在的表/约束冲突
        if (!e.message.includes("already exists") && !e.message.includes("UNIQUE constraint")) {
          throw e;
        }
        db.exec("DELETE FROM schema_version;");
        db.prepare("INSERT INTO schema_version VALUES (?)").run(m.version);
      }
    }
  }

  // 兼容旧库字段
  const tryAlter = (sql) => { try { db.exec(sql); } catch {} };
  tryAlter("ALTER TABLE segments ADD COLUMN dimensions TEXT DEFAULT '{}'");
  tryAlter("ALTER TABLE projects ADD COLUMN global_context TEXT DEFAULT ''");
  tryAlter("ALTER TABLE segments ADD COLUMN gender TEXT DEFAULT 'male'");
  tryAlter("ALTER TABLE projects ADD COLUMN project_name TEXT DEFAULT ''");

  // 性能索引
  tryAlter("CREATE INDEX IF NOT EXISTS idx_segments_project_status ON segments(project_id, status)");
  tryAlter("CREATE INDEX IF NOT EXISTS idx_memory_source ON memory_segments(source, project_id)");
  tryAlter("CREATE INDEX IF NOT EXISTS idx_glossary_project ON glossary(project_id)");
  tryAlter("CREATE INDEX IF NOT EXISTS idx_segment_history_seg ON segment_history(segment_id, project_id)");

  // 一次性修复 Blue Agent 导入的字段对调问题
  // 旧数据：source_term=波兰语, target_term=中文 → 修正为 source_term='', target_term=波兰语
  try {
    const badRows = db.prepare("SELECT id, source_term, target_term FROM glossary WHERE notes='Blue Agent 提取'").all();
    if (badRows.length > 0) {
      const fix = db.prepare("UPDATE glossary SET source_term='', target_term=?, notes='idiom · Blue Agent' WHERE id=?");
      const fixAll = db.transaction(() => { for (const r of badRows) fix.run(r.source_term, r.id); });
      fixAll();
      console.log(`[migration] 修复 ${badRows.length} 条 Blue Agent 术语字段对调`);
    }
  } catch (e) { console.log('[migration] Blue Agent fix skipped:', e.message); }

  // AGAN: 对抗测试池
  tryAlter(`CREATE TABLE IF NOT EXISTS agan_pool (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    target TEXT NOT NULL,
    error_type TEXT DEFAULT '',
    domain TEXT DEFAULT '',
    score_a INTEGER,
    score_b INTEGER,
    divergence INTEGER DEFAULT 0,
    human_verdict TEXT DEFAULT 'pending',
    accepted_target TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  )`);
  tryAlter("CREATE INDEX IF NOT EXISTS idx_agan_verdict ON agan_pool(human_verdict)");
  tryAlter("ALTER TABLE agan_pool ADD COLUMN source_type TEXT DEFAULT 'adversarial'");

  tryAlter(`CREATE TABLE IF NOT EXISTS pending_glossary (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pl_term TEXT NOT NULL,
    zh_suggestion TEXT NOT NULL DEFAULT '',
    context TEXT DEFAULT '',
    source_email TEXT DEFAULT '',
    confidence REAL DEFAULT 0,
    verdict TEXT DEFAULT 'pending',
    created_at TEXT DEFAULT (datetime('now'))
  )`);
  tryAlter("CREATE INDEX IF NOT EXISTS idx_pg_verdict ON pending_glossary(verdict)");
  tryAlter("ALTER TABLE pending_glossary ADD COLUMN source_type TEXT DEFAULT 'adversarial'");
  tryAlter("ALTER TABLE projects ADD COLUMN custom_prompt TEXT DEFAULT ''");
  tryAlter("ALTER TABLE projects ADD COLUMN speaker_gender TEXT DEFAULT 'auto'");

  tryAlter(`CREATE TABLE IF NOT EXISTS pg_stopwords (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pl_term TEXT NOT NULL UNIQUE,
    reason TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  // 使用习惯埋点表（L2 学习层）
  tryAlter(`CREATE TABLE IF NOT EXISTS usage_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL,
    segment_id INTEGER,
    project_id INTEGER,
    metadata TEXT DEFAULT '{}',
    ts TEXT DEFAULT (datetime('now'))
  )`);
  // G1: 自动备份——每日备份一次 lqa.db → lqa.db.bak
  try {
    const bakPath = path.join(dir, "lqa.db.bak");
    const needBak = !fs.existsSync(bakPath) ||
      (Date.now() - fs.statSync(bakPath).mtimeMs) > 24 * 60 * 60 * 1000;
    if (needBak) {
      db.exec(`VACUUM INTO '${bakPath.replace(/'/g, "''")}';`);
    }
  } catch (e) {
    // 备份失败不阻断启动
    console.warn('[DB Backup] failed:', e.message);
  }
}

function getDb() {
  if (!db) throw new Error("DB not initialised");
  return db;
}

// ─── Project helpers ─────────────────────────────────────────────────────────
function upsertProject(filePath, guidelineText = "", globalContext = "") {
  const d = getDb();
  const row = d.prepare("SELECT id FROM projects WHERE file_path = ?").get(filePath);
  if (row) {
    let sql = "UPDATE projects SET updated_at = datetime('now')";
    const args = [];
    if (guidelineText !== undefined) { sql += ", guideline_text = ?"; args.push(guidelineText); }
    if (globalContext !== undefined)  { sql += ", global_context = ?";  args.push(globalContext); }
    sql += " WHERE id = ?"; args.push(row.id);
    d.prepare(sql).run(...args);
    return row.id;
  }
  return d.prepare("INSERT INTO projects (file_path, guideline_text, global_context) VALUES (?, ?, ?)").run(filePath, guidelineText, globalContext).lastInsertRowid;
}

function getProject(filePath) {
  return getDb().prepare("SELECT * FROM projects WHERE file_path = ?").get(filePath);
}

function insertSegments(projectId, rows) {
  const stmt = getDb().prepare("INSERT OR IGNORE INTO segments (id, project_id, source, target, original_target, status, gender) VALUES (@id, @projectId, @source, @target, @originalTarget, 'pending', @gender)");
  getDb().transaction(rs => { for (const r of rs) stmt.run(r); })(rows.map(r => ({ ...r, projectId, gender: r.gender || 'male' })));
}

function getSegments(projectId) {
  return getDb().prepare("SELECT * FROM segments WHERE project_id = ? ORDER BY id").all(projectId);
}

function saveSegment(seg) {
  const d = getDb();
  d.transaction(() => {
    d.prepare(`
      UPDATE segments SET
        target = @target, status = @status, score = @score,
        errors = @errors, dimensions = @dimensions,
        fixed_target = @fixedTarget, fixed = @fixed,
        gender = @gender
      WHERE id = @id AND project_id = @projectId
    `).run({
      ...seg,
      errors: JSON.stringify(seg.errors ?? []),
      dimensions: JSON.stringify(seg.dimensions ?? {}),
      fixedTarget: seg.fixedTarget ?? "",
      fixed: seg.fixed ? 1 : 0,
      score: seg.score ?? null,
      gender: seg.gender || 'male'
    });

    // 保存历史版本
    d.prepare(`
      INSERT INTO segment_history (segment_id, project_id, target, score, errors, fixed_target)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(seg.id, seg.projectId, seg.target, seg.score ?? null, JSON.stringify(seg.errors ?? []), seg.fixedTarget ?? "");

    // 更新翻译记忆库（去重：同一源文+项目只保留最新版本）
    if (seg.status === 'done') {
      const existing = d.prepare("SELECT id FROM memory_segments WHERE source = ? AND project_id = ?").get(seg.source, seg.projectId);
      if (existing) {
        d.prepare("UPDATE memory_segments SET target = ?, score = ?, saved_at = datetime('now') WHERE id = ?").run(seg.fixedTarget || seg.target, seg.score ?? null, existing.id);
      } else {
        d.prepare(`
          INSERT INTO memory_segments (source, target, project_id, score)
          VALUES (?, ?, ?, ?)
        `).run(seg.source, seg.fixedTarget || seg.target, seg.projectId, seg.score ?? null);
      }
    }
  })();
}

function resetProject(projectId) {
  getDb().prepare("UPDATE segments SET target = original_target, status = 'pending', score = NULL, errors = '[]', dimensions = '{}', fixed_target = '', fixed = 0 WHERE project_id = ?").run(projectId);
}

// ─── Glossary helpers ─────────────────────────────────────────────────────────
function getGlossary(projectId) {
  const db = getDb();
  if (projectId === null || projectId === undefined)
    return db.prepare("SELECT * FROM glossary ORDER BY id").all();
  return db.prepare("SELECT * FROM glossary WHERE project_id IS NULL OR project_id = ? ORDER BY id").all(projectId);
}
function addGlossaryEntry(projectId, sourceTerm, targetTerm, chineseMeaning = "", notes = "") {
  return getDb().prepare("INSERT INTO glossary (project_id, source_term, target_term, chinese_meaning, notes) VALUES (?, ?, ?, ?, ?)").run(projectId, sourceTerm, targetTerm, chineseMeaning || "", notes).lastInsertRowid;
}
function deleteGlossaryEntry(id) {
  getDb().prepare("DELETE FROM glossary WHERE id = ?").run(id);
}

// ─── Window ──────────────────────────────────────────────────────────────────
let win = null;
let appReady = false;

function findPreload() {
  for (const f of ["preload.mjs", "preload.js"]) {
    const p = path.join(__dirname, f);
    if (fs.existsSync(p)) return p;
  }
  return path.join(__dirname, "preload.js");
}

function createWindow() {
  win = new BrowserWindow({
    width: 1400, height: 900,
    minWidth: 1024, minHeight: 680,
    titleBarStyle: "hidden",
    title: "中波翻译审核Pro",
    titleBarOverlay: { color: "#f9f9fb", symbolColor: "#5F6368", height: 48 },
    webPreferences: {
      preload: findPreload(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: false   // 允许 file:// 加载 ES module
    }
  });
  process.env.VITE_DEV_SERVER_URL
    ? win.loadURL(process.env.VITE_DEV_SERVER_URL)
    : win.loadFile(path.join(__dirname, "../dist/index.html"));
}

// ─── S5: 简易日志工具 ─────────────────────────────────────────────────────────
const LOG_DIR = path.join(app.getPath("userData"), "ch-pl-lqa", "logs");
function logToFile(level, msg) {
  try {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
    const today = new Date().toISOString().slice(0, 10);
    const logPath = path.join(LOG_DIR, `app-${today}.log`);
    const line = `[${new Date().toISOString()}] [${level}] ${msg}\n`;
    fs.appendFileSync(logPath, line);
    // 清理7天前的日志
    try {
      for (const f of fs.readdirSync(LOG_DIR)) {
        const fp = path.join(LOG_DIR, f);
        if (Date.now() - fs.statSync(fp).mtimeMs > 7 * 86400000) fs.unlinkSync(fp);
      }
    } catch {}
  } catch {}
}

// ─── S7: 版本号 ───────────────────────────────────────────────────────────────
const APP_VERSION = "2.3.0";

app.whenReady().then(() => {
  appReady = true;
  logToFile('INFO', `应用启动 v${APP_VERSION}`);
  try {
    initDb();
    logToFile('INFO', '数据库初始化完成');
    // v2.1.0 数据迁移：修复 pgVerdict 导入时 source_term 为空的历史数据
    try {
      const d = getDb();
      d.prepare("UPDATE glossary SET source_term = chinese_meaning WHERE (source_term IS NULL OR source_term = '') AND chinese_meaning IS NOT NULL AND chinese_meaning != ''").run();
      d.prepare("UPDATE glossary SET target_term = (SELECT pg.pl_term FROM pending_glossary pg WHERE pg.zh_suggestion = glossary.chinese_meaning AND pg.verdict = 'approve' AND pg.pl_term IS NOT NULL AND pg.pl_term != '' ORDER BY pg.id DESC LIMIT 1) WHERE (target_term IS NULL OR target_term = '') AND chinese_meaning IS NOT NULL AND chinese_meaning != ''").run();
    } catch {}
  } catch (e) {
    logToFile('ERROR', `数据库初始化失败: ${e?.message}`);
    dialog.showErrorBox("数据库初始化失败", e?.message ?? String(e));
  }
  createWindow();
});

// S3: graceful shutdown — 停止后台队列并保存进度
app.on("before-quit", () => {
  logToFile('INFO', '应用即将退出，执行 graceful shutdown');
  if (bgState.running) { bgState.stopFlag = true; bgState.pauseFlag = false; }
  if (termState.running) { termState.stopFlag = true; }
});

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("activate", () => { if (appReady && BrowserWindow.getAllWindows().length === 0) createWindow(); });

// S7: 版本号 IPC
ipcMain.handle("get-app-version", () => ({ success: true, version: APP_VERSION }));

// S5: 日志导出
ipcMain.handle("export-diagnostic-log", async () => {
  if (!win) return { success: false };
  try {
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      defaultPath: `diagnostic_log_${new Date().toISOString().slice(0,10)}.txt`,
      filters: [{ name: "Text", extensions: ["txt"] }]
    });
    if (canceled || !filePath) return { success: false, error: "Cancelled" };
    let combined = '';
    if (fs.existsSync(LOG_DIR)) {
      for (const f of fs.readdirSync(LOG_DIR).sort()) {
        combined += `\n=== ${f} ===\n` + fs.readFileSync(path.join(LOG_DIR, f), 'utf8');
      }
    }
    fs.writeFileSync(filePath, combined || '无日志');
    return { success: true, filePath };
  } catch (e) { return { success: false, error: e.message }; }
});

// ─── API Key 安全存储 ─────────────────────────────────────────────────────────
function getKeyStorePath() {
  return path.join(app.getPath("userData"), "ch-pl-lqa", "keys.json");
}

function readKeyStore() {
  try { return JSON.parse(fs.readFileSync(getKeyStorePath(), "utf8")); } catch { return {}; }
}
function writeKeyStore(data) {
  const p = getKeyStorePath();
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data), "utf8");
}

ipcMain.handle("store-api-key", (_, { provider, key }) => {
  try {
    const cleanKey = (key || '').trim();   // 去除换行/空格，防止 HTTP 头报错
    const store = readKeyStore();
    if (safeStorage.isEncryptionAvailable()) {
      store[provider] = safeStorage.encryptString(cleanKey).toString("base64");
    } else {
      store[provider] = Buffer.from(cleanKey).toString("base64"); // fallback
    }
    writeKeyStore(store);
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
});

// 后端复用：解密已存储的 API Key
function decryptStoredKey(provider) {
  const store = readKeyStore();
  const raw = store[provider];
  if (!raw) return '';
  const buf = Buffer.from(raw, 'base64');
  if (safeStorage.isEncryptionAvailable()) {
    try { return safeStorage.decryptString(buf).trim(); } catch {}
  }
  // fallback：base64 明文（外部写入或 safeStorage 不可用时）
  return buf.toString('utf8').trim();
}

// 后端复用：读取用户偏好
function readStoredPref(key) {
  const store = readKeyStore();
  return store["__pref__" + key] ?? null;
}

ipcMain.handle("get-api-key", (_, provider) => {
  try {
    return { success: true, key: decryptStoredKey(provider) };
  } catch (e) { return { success: false, error: e.message }; }
});

// 持久化用户偏好（供应商 / 子模型 / 源语言等）
ipcMain.handle("get-app-pref", (_, key) => {
  try {
    const store = readKeyStore();
    return { success: true, value: store["__pref__" + key] ?? null };
  } catch (e) { return { success: false, error: e.message }; }
});
ipcMain.handle("set-app-pref", (_, { key, value }) => {
  try {
    const store = readKeyStore();
    store["__pref__" + key] = value;
    writeKeyStore(store);
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
});


// ─── File dialogs ─────────────────────────────────────────────────────────────
ipcMain.handle("open-file-dialog", async (_, type) => {
  if (!win) return null;
  const filters = type === "guideline"
    ? [{ name: "Documents", extensions: ["pdf", "docx", "doc"] }]
    : [{ name: "Spreadsheet", extensions: ["xls", "xlsx", "csv"] }];
  const { canceled, filePaths } = await dialog.showOpenDialog(win, { properties: ["openFile"], filters });
  return canceled || !filePaths.length ? null : filePaths[0];
});

// ─── Excel 读取（支持多 Sheet） ────────────────────────────────────────────────
function parseSheet(xlsx, wb, sheetName) {
  const ws = wb.Sheets[sheetName] || wb.Sheets[wb.SheetNames[0]];
  const rows = xlsx.utils.sheet_to_json(ws, { header: 1 });
  if (!rows || rows.length < 2) return { success: false, error: "表格为空或无数据行" };

  const header = rows[0].map(c => String(c ?? "").trim());

  // 优先按固定列名 Source/Target 识别
  const findCol = (...names) => {
    for (const n of names) {
      const nl = n.toLowerCase();
      const idx = header.findIndex(h => h.toLowerCase() === nl || h.toLowerCase().includes(nl));
      if (idx !== -1) return idx;
    }
    return -1;
  };
  let sourceCol = findCol('Source', 'source', '源文', '原文', 'Text', 'text');
  let targetCol = findCol('Target', 'target', '译文', '波兰语', 'Polish', 'polish');
  const genderCol = findCol('Gender', 'gender', '性别', 'sex');

  // 如果列名匹配失败，回退到内容检测
  if (sourceCol === -1 || targetCol === -1) {
    const isZH = s => /[\u4e00-\u9fff]/.test(s);
    const isPL = s => /[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/.test(s);
    const isEN = s => /[a-zA-Z]{3,}/.test(s) && !isPL(s) && !isZH(s);
    const scores = header.map((_, ci) => {
      let zh = 0, en = 0, pl = 0;
      for (let ri = 1; ri < Math.min(rows.length, 15); ri++) {
        const cell = String(rows[ri]?.[ci] ?? "");
        if (isZH(cell)) zh++; else if (isPL(cell)) pl++; else if (isEN(cell)) en++;
      }
      return { zh, en, pl };
    });
    const maxZH = Math.max(...scores.map(s => s.zh));
    const maxEN = Math.max(...scores.map(s => s.en));
    const maxPL = Math.max(...scores.map(s => s.pl));
    const zhCol = maxZH > 0 ? scores.findIndex(s => s.zh === maxZH) : -1;
    const enCol = maxEN > 0 ? scores.findIndex(s => s.en === maxEN && s.zh < s.en) : -1;
    const plCol = maxPL > 0 ? scores.findIndex(s => s.pl === maxPL) : -1;
    if (sourceCol === -1) sourceCol = zhCol !== -1 ? zhCol : enCol !== -1 ? enCol : 0;
    if (targetCol === -1) targetCol = plCol !== -1 ? plCol : sourceCol === 0 ? 1 : 0;
  }

  return { success: true, data: rows, header, sourceCol, targetCol, genderCol, sheetNames: wb.SheetNames };
}

ipcMain.handle("read-excel", async (_, { filePath, sheetName }) => {
  try {
    const xlsx = await Promise.resolve().then(() => require("./xlsx-qn1xoUuv.js"));
    const buf = fs.readFileSync(filePath);
    const wb = xlsx.read(buf, { type: "buffer" });

    if (!sheetName) {
      // 多 Sheet：让前端弹出选择器；单 Sheet：直接解析并返回完整数据
      if (wb.SheetNames.length > 1) {
        return { success: true, sheetNames: wb.SheetNames, needSheetSelect: true, defaultSheet: wb.SheetNames[0] };
      }
      // 单 Sheet，直接解析
      const result = parseSheet(xlsx, wb, wb.SheetNames[0]);
      return result;
    }

    return parseSheet(xlsx, wb, sheetName);
  } catch (e) { return { success: false, error: e.message }; }
});

// ─── Excel 导出 ───────────────────────────────────────────────────────────────
ipcMain.handle("export-excel", async (_, rows) => {
  if (!win) return { success: false };
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    defaultPath: "reviewed_translation.xlsx",
    filters: [{ name: "Excel", extensions: ["xlsx"] }]
  });
  if (canceled || !filePath) return { success: false, error: "Cancelled" };
  try {
    const xlsx = await Promise.resolve().then(() => require("./xlsx-qn1xoUuv.js"));
    const ws = xlsx.utils.aoa_to_sheet(rows);
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, "Reviewed");
    const buf = xlsx.write(wb, { type: "buffer", bookType: "xlsx" });
    try {
      fs.writeFileSync(filePath, buf);
      return { success: true, filePath };
    } catch {
      const ext = path.extname(filePath);
      const alt = path.join(path.dirname(filePath), `${path.basename(filePath, ext)}_${Date.now()}${ext}`);
      fs.writeFileSync(alt, buf);
      return { success: true, filePath: alt };
    }
  } catch (e) { return { success: false, error: e.message }; }
});

// ─── 批量应用审核修复建议 ──────────────────────────────────────────────────────
ipcMain.handle("batch-apply-fixes", (_, { projectId }) => {
  try {
    const db = getDb();
    // 找到所有有 fixedTarget 且尚未 fixed 的已审核句段
    const segs = db.prepare(
      "SELECT id, fixed_target FROM segments WHERE project_id = ? AND status = 'done' AND fixed = 0 AND fixed_target IS NOT NULL AND fixed_target != '' AND fixed_target != target"
    ).all(projectId);
    if (!segs.length) return { success: true, count: 0 };
    const stmt = db.prepare("UPDATE segments SET target = fixed_target, fixed = 1 WHERE id = ? AND project_id = ?");
    db.transaction(() => { for (const s of segs) stmt.run(s.id, projectId); })();
    return { success: true, count: segs.length };
  } catch (e) { return { success: false, error: e.message }; }
});

// ─── 项目导出（带选项）────────────────────────────────────────────────────────
// opts: { useFixed, includeSource, includeTarget, includeScore, includeErrors, sheetName }
ipcMain.handle("export-project-excel", async (_, { projectId, opts = {} }) => {
  if (!win) return { success: false };
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    defaultPath: `export_${Date.now()}.xlsx`,
    filters: [{ name: "Excel", extensions: ["xlsx"] }]
  });
  if (canceled || !filePath) return { success: false, error: "Cancelled" };
  try {
    const db = getDb();
    const segs = db.prepare("SELECT * FROM segments WHERE project_id = ? ORDER BY id").all(projectId);
    const {
      useFixed = true,
      includeSource = true,
      includeTarget = true,
      includeScore = false,
      includeErrors = false,
      sheetName = "Translation"
    } = opts;

    // 构建表头
    const header = [];
    if (includeSource) header.push("Source");
    if (includeTarget) header.push("Target");
    if (includeScore)  header.push("Score");
    if (includeErrors) header.push("Errors");

    const rows = [header];
    for (const s of segs) {
      const targetVal = useFixed && s.fixed && s.fixed_target ? s.fixed_target : (s.target || "");
      const row = [];
      if (includeSource) row.push(s.source || "");
      if (includeTarget) row.push(targetVal);
      if (includeScore)  row.push(s.score ?? "");
      if (includeErrors) {
        let errs = "";
        try { errs = JSON.parse(s.errors || "[]").map(e => e.type).join("; "); } catch {}
        row.push(errs);
      }
      rows.push(row);
    }

    const xlsx = await Promise.resolve().then(() => require("./xlsx-qn1xoUuv.js"));
    const ws = xlsx.utils.aoa_to_sheet(rows);
    // 自动列宽
    ws["!cols"] = header.map(() => ({ wch: 40 }));
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
    const buf = xlsx.write(wb, { type: "buffer", bookType: "xlsx" });
    fs.writeFileSync(filePath, buf);
    return { success: true, filePath, count: segs.length };
  } catch (e) { return { success: false, error: e.message }; }
});

// ─── 规范文件解析 ──────────────────────────────────────────────────────────────
ipcMain.handle("parse-guideline-file", async (_, filePath) => {
  try {
    const ext = path.extname(filePath).toLowerCase();
    let text = "";
    if (ext === ".pdf") {
      const pdfParse = await Promise.resolve().then(() => require("./index-Cc63CglF.js"));
      const fn = pdfParse.default ?? pdfParse;
      text = (await fn(fs.readFileSync(filePath))).text.trim();
    } else if (ext === ".docx" || ext === ".doc") {
      const mammoth = await Promise.resolve().then(() => require("./index-icaa3wXz.js")).then(m => m.index);
      text = (await mammoth.extractRawText({ path: filePath })).value.trim();
    } else {
      return { success: false, error: "不支持的格式，请上传 PDF 或 Word (.docx)" };
    }
    return text ? { success: true, text, fileName: path.basename(filePath) } : { success: false, error: "文件解析后内容为空" };
  } catch (e) { return { success: false, error: e.message }; }
});

// ─── DB IPC ───────────────────────────────────────────────────────────────────
function detectGender(hint) {
  if (hint == null) return null;
  const s = String(hint).trim().toLowerCase();
  if (['女','female','f','kobieta','♀','阴','yin'].includes(s)) return 'female';
  if (['男','male','m','mężczyzna','♂','阳','yang'].includes(s)) return 'male';
  return null;
}

ipcMain.handle("db-load-project", async (_, { filePath, rows, sourceCol, targetCol, genderCol }) => {
  try {
    const projectId = upsertProject(filePath);
    const base = projectId * 100000; // 每个项目最多10万句段，避免跨项目 id 碰撞
    const parsed = rows.slice(1).filter(r => r[sourceCol]).map((r, i) => ({
      id: base + i + 1,
      source: String(r[sourceCol] ?? ""),
      target: String(r[targetCol] ?? ""),
      originalTarget: String(r[targetCol] ?? ""),
      gender: (genderCol != null && genderCol >= 0) ? (detectGender(r[genderCol]) || 'male') : 'male'
    }));
    insertSegments(projectId, parsed);
    const dbSegs = getSegments(projectId);
    const proj = getProject(filePath);
    const segments = parsed.map(p => {
      const s = dbSegs.find(d => d.id === p.id);
      return s ? {
        id: s.id, source: s.source, target: s.target,
        originalTarget: s.original_target, status: s.status,
        score: s.score ?? undefined,
        errors: s.errors ? JSON.parse(s.errors) : [],
        dimensions: s.dimensions ? JSON.parse(s.dimensions) : {},
        fixedTarget: s.fixed_target || undefined,
        fixed: !!s.fixed,
        gender: s.gender || 'male'
      } : { ...p, status: "pending", errors: [], dimensions: {}, gender: 'male' };
    });
    return { success: true, projectId, segments, guidelineText: proj?.guideline_text ?? "", globalContext: proj?.global_context ?? "", projectName: proj?.project_name || "" };
  } catch (e) { return { success: false, error: e.message }; }
});

// 项目库：列举所有项目
ipcMain.handle("db-list-projects", () => {
  try {
    const rows = getDb().prepare(`
      SELECT p.id, p.file_path, p.project_name, p.created_at, p.updated_at,
        COUNT(s.id) as segment_count,
        SUM(CASE WHEN s.status = 'done' THEN 1 ELSE 0 END) as done_count
      FROM projects p LEFT JOIN segments s ON s.project_id = p.id
      GROUP BY p.id ORDER BY p.updated_at DESC
    `).all();
    return { success: true, projects: rows };
  } catch (e) { return { success: false, error: e.message }; }
});

// 项目库：按 ID 加载项目
ipcMain.handle("db-load-project-by-id", (_, projectId) => {
  try {
    const proj = getDb().prepare("SELECT * FROM projects WHERE id = ?").get(projectId);
    if (!proj) return { success: false, error: "项目不存在" };
    const segs = getSegments(projectId);
    const segments = segs.map(s => ({
      id: s.id, source: s.source, target: s.target,
      originalTarget: s.original_target, status: s.status,
      score: s.score ?? undefined,
      errors: s.errors ? JSON.parse(s.errors) : [],
      dimensions: s.dimensions ? JSON.parse(s.dimensions) : {},
      fixedTarget: s.fixed_target || undefined,
      fixed: !!s.fixed,
      gender: s.gender || 'male'
    }));
    return { success: true, projectId, segments, guidelineText: proj.guideline_text ?? "", globalContext: proj.global_context ?? "", filePath: proj.file_path, projectName: proj.project_name || proj.file_path.split('/').pop() };
  } catch (e) { return { success: false, error: e.message }; }
});

// 项目库：保存项目名称
ipcMain.handle("db-save-project-name", (_, { projectId, name }) => {
  try { getDb().prepare("UPDATE projects SET project_name = ?, updated_at = datetime('now') WHERE id = ?").run(name, projectId); return { success: true }; }
  catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle("db-save-project-settings", (_, { projectId, globalContext, customPrompt, speakerGender, guidelineText }) => {
  try {
    const sets = []; const args = [];
    if (globalContext !== undefined) { sets.push('global_context = ?'); args.push(globalContext); }
    if (customPrompt !== undefined) { sets.push('custom_prompt = ?'); args.push(customPrompt); }
    if (speakerGender !== undefined) { sets.push('speaker_gender = ?'); args.push(speakerGender); }
    if (guidelineText !== undefined) { sets.push('guideline_text = ?'); args.push(guidelineText); }
    if (sets.length) { args.push(projectId); getDb().prepare(`UPDATE projects SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(...args); }
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle("db-get-project-settings", (_, projectId) => {
  try {
    const p = getDb().prepare('SELECT global_context, custom_prompt, speaker_gender, guideline_text FROM projects WHERE id = ?').get(projectId);
    if (!p) return { success: false, error: '项目不存在' };
    return { success: true, globalContext: p.global_context || '', customPrompt: p.custom_prompt || '', speakerGender: p.speaker_gender || 'auto', guidelineText: p.guideline_text || '' };
  } catch (e) { return { success: false, error: e.message }; }
});

// 项目库：删除项目
ipcMain.handle("db-delete-project", (_, projectId) => {
  try {
    const d = getDb();
    d.transaction(() => {
      d.prepare("DELETE FROM segment_history WHERE project_id = ?").run(projectId);
      d.prepare("DELETE FROM segments WHERE project_id = ?").run(projectId);
      d.prepare("DELETE FROM memory_segments WHERE project_id = ?").run(projectId);
      d.prepare("DELETE FROM projects WHERE id = ?").run(projectId);
    })();
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
});

// 性别级联更新（从当前行往后批量设置）
ipcMain.handle("db-batch-update-gender", (_, { projectId, fromId, gender }) => {
  try { getDb().prepare("UPDATE segments SET gender = ? WHERE project_id = ? AND id >= ?").run(gender, projectId, fromId); return { success: true }; }
  catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle("db-save-segment", (_, seg) => {
  try { saveSegment(seg); return { success: true }; } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle("db-reset-project", (_, projectId) => {
  try { resetProject(projectId); return { success: true }; } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle("db-save-guideline", (_, { filePath, text }) => {
  try { getDb().prepare("UPDATE projects SET guideline_text = ?, updated_at = datetime('now') WHERE file_path = ?").run(text, filePath); return { success: true }; }
  catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle("db-save-global-context", (_, { filePath, text }) => {
  try { getDb().prepare("UPDATE projects SET global_context = ?, updated_at = datetime('now') WHERE file_path = ?").run(text, filePath); return { success: true }; }
  catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle("db-get-segment-history", (_, { segmentId, projectId }) => {
  try {
    const rows = getDb().prepare("SELECT * FROM segment_history WHERE segment_id = ? AND project_id = ? ORDER BY saved_at DESC LIMIT 20").all(segmentId, projectId);
    return { success: true, history: rows };
  } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle("db-get-project-stats", (_, projectId) => {
  try {
    const d = getDb();
    const total = d.prepare("SELECT COUNT(*) as n FROM segments WHERE project_id = ?").get(projectId).n;
    const done = d.prepare("SELECT COUNT(*) as n FROM segments WHERE project_id = ? AND status = 'done'").get(projectId).n;
    const avgScore = d.prepare("SELECT AVG(score) as s FROM segments WHERE project_id = ? AND score IS NOT NULL").get(projectId).s;
    const lowScore = d.prepare("SELECT * FROM segments WHERE project_id = ? AND score < 70 ORDER BY score ASC LIMIT 20").all(projectId);
    const allErrors = d.prepare("SELECT errors FROM segments WHERE project_id = ? AND errors != '[]'").all(projectId)
      .flatMap(r => { try { return JSON.parse(r.errors); } catch { return []; } });
    const errorTypes = {};
    for (const e of allErrors) { errorTypes[e.type] = (errorTypes[e.type] || 0) + 1; }

    // 修改前/后对比
    const fixedCount     = d.prepare("SELECT COUNT(*) as n FROM segments WHERE project_id = ? AND fixed = 1").get(projectId).n;
    const unfixedAvgScore = d.prepare("SELECT AVG(score) as s FROM segments WHERE project_id = ? AND fixed = 0 AND score IS NOT NULL").get(projectId).s;
    const fixedAvgScore   = d.prepare("SELECT AVG(score) as s FROM segments WHERE project_id = ? AND fixed = 1 AND score IS NOT NULL").get(projectId).s;

    return { success: true, total, done, pending: total - done, avgScore: avgScore ? Math.round(avgScore) : null, lowScore, errorTypes, fixedCount, unfixedAvgScore: unfixedAvgScore ? Math.round(unfixedAvgScore) : null, fixedAvgScore: fixedAvgScore ? Math.round(fixedAvgScore) : null };
  } catch (e) { return { success: false, error: e.message }; }
});

// 全部项目汇总（字段与单项目一致）
ipcMain.handle("db-get-all-stats", () => {
  try {
    const d = getDb();
    const total = d.prepare("SELECT COUNT(*) as n FROM segments").get().n;
    const done  = d.prepare("SELECT COUNT(*) as n FROM segments WHERE status = 'done'").get().n;
    const avgScore = d.prepare("SELECT AVG(score) as s FROM segments WHERE score IS NOT NULL").get().s;
    const lowScore = d.prepare("SELECT * FROM segments WHERE score < 70 ORDER BY score ASC LIMIT 20").all();
    const allErrors = d.prepare("SELECT errors FROM segments WHERE errors != '[]'").all()
      .flatMap(r => { try { return JSON.parse(r.errors); } catch { return []; } });
    const errorTypes = {};
    for (const e of allErrors) { errorTypes[e.type] = (errorTypes[e.type] || 0) + 1; }
    const fixedCount      = d.prepare("SELECT COUNT(*) as n FROM segments WHERE fixed = 1").get().n;
    const unfixedAvgScore = d.prepare("SELECT AVG(score) as s FROM segments WHERE fixed = 0 AND score IS NOT NULL").get().s;
    const fixedAvgScore   = d.prepare("SELECT AVG(score) as s FROM segments WHERE fixed = 1 AND score IS NOT NULL").get().s;
    return { success: true, total, done, pending: total - done, avgScore: avgScore ? Math.round(avgScore) : null, lowScore, errorTypes, fixedCount, unfixedAvgScore: unfixedAvgScore ? Math.round(unfixedAvgScore) : null, fixedAvgScore: fixedAvgScore ? Math.round(fixedAvgScore) : null };
  } catch (e) { return { success: false, error: e.message }; }
});

// ─── 术语表 IPC ───────────────────────────────────────────────────────────────
ipcMain.handle("glossary-get", (_, projectId) => {
  try { return { success: true, items: getGlossary(projectId) }; } catch (e) { return { success: false, error: e.message }; }
});
ipcMain.handle("glossary-add", (_, { projectId, sourceTerm, targetTerm, chineseMeaning = '', notes }) => {
  try { const id = addGlossaryEntry(projectId, sourceTerm, targetTerm, chineseMeaning, notes); return { success: true, id }; }
  catch (e) { return { success: false, error: e.message }; }
});
ipcMain.handle("glossary-delete", (_, id) => {
  try { deleteGlossaryEntry(id); return { success: true }; } catch (e) { return { success: false, error: e.message }; }
});
ipcMain.handle("glossary-update", (_, { id, sourceTerm, targetTerm, chineseMeaning, notes }) => {
  try {
    getDb().prepare("UPDATE glossary SET source_term = ?, target_term = ?, chinese_meaning = ?, notes = ? WHERE id = ?").run(sourceTerm, targetTerm, chineseMeaning || '', notes || '', id);
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
});

// 术语表批量导入（Excel/CSV：第1列=源词，第2列=译词，第3列=备注可选）
ipcMain.handle("glossary-import", async (_, { projectId }) => {
  if (!win) return { success: false, error: "窗口不可用" };
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: "选择术语表文件",
    filters: [{ name: "Excel/CSV", extensions: ["xlsx", "xls", "csv"] }],
    properties: ["openFile"]
  });
  if (canceled || !filePaths.length) return { success: false, error: "已取消" };
  try {
    const xlsx = await Promise.resolve().then(() => require("./xlsx-qn1xoUuv.js"));
    const buf = fs.readFileSync(filePaths[0]);
    const wb = xlsx.read(buf, { type: "buffer" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = xlsx.utils.sheet_to_json(ws, { header: 1 });
    const db = getDb();
    const stmt = db.prepare("INSERT INTO glossary (project_id, source_term, target_term, chinese_meaning, notes) VALUES (?, ?, ?, ?, ?)");
    let added = 0;
    for (const row of rows) {
      const src = String(row[0] || '').trim();
      const tgt = String(row[1] || '').trim();
      if (!src || !tgt) continue;
      const chineseMeaning = row[2] ? String(row[2]).trim() : '';
      const notes = row[3] ? String(row[3]).trim() : '';
      stmt.run(projectId ?? null, src, tgt, chineseMeaning, notes);
      added++;
    }
    return { success: true, added, fileName: path.basename(filePaths[0]) };
  } catch (e) { return { success: false, error: e.message }; }
});

// 术语表导出
ipcMain.handle("glossary-export", async (_, { projectId }) => {
  if (!win) return { success: false };
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    defaultPath: `glossary_${Date.now()}.xlsx`,
    filters: [{ name: "Excel", extensions: ["xlsx"] }]
  });
  if (canceled || !filePath) return { success: false, error: "已取消" };
  try {
    const items = getGlossary(projectId);
    const xlsx = await Promise.resolve().then(() => require("./xlsx-qn1xoUuv.js"));
    const rows = [["源词", "波兰语译词", "中文解释", "备注"]];
    for (const item of items) {
      rows.push([item.source_term, item.target_term, item.chinese_meaning || '', item.notes || '']);
    }
    const ws = xlsx.utils.aoa_to_sheet(rows);
    ws["!cols"] = [{ wch: 25 }, { wch: 25 }, { wch: 20 }, { wch: 30 }];
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, "Glossary");
    const buf = xlsx.write(wb, { type: "buffer", bookType: "xlsx" });
    fs.writeFileSync(filePath, buf);
    return { success: true, filePath, count: items.length };
  } catch (e) { return { success: false, error: e.message }; }
});

// ─── API 连接测试 ──────────────────────────────────────────────────────────────
ipcMain.handle("test-api-connection", async (_, { apiModel, modelName }) => {
  try {
    const store = readKeyStore();
    const raw = store[apiModel];
    if (!raw) return { success: false, error: `未找到 ${apiModel} 的密钥，请先在设置中保存` };
    const buf = Buffer.from(raw, "base64");
    const apiKey = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buf) : buf.toString("utf8");

    const isMinimax = apiModel === "minimax";
    const isQwen    = apiModel === "qwen";
    const hostname  = isMinimax ? "api.minimax.chat" : isQwen ? "dashscope.aliyuncs.com" : "api.deepseek.com";
    const urlPath   = isMinimax ? "/v1/chat/completions" : isQwen ? "/compatible-mode/v1/chat/completions" : "/v1/chat/completions";
    const model     = isMinimax ? (modelName || "MiniMax-Text-01") : isQwen ? "qwen-max" : (modelName || "deepseek-v4-flash");

    const t0 = Date.now();
    // 用 Promise.race 实现 15 秒超时
    const testReq = new Promise((resolve, reject) => {
      const payload = JSON.stringify({
        model,
        messages: [{ role: "user", content: "Translate 'Hello' to Polish. Reply with ONLY the translation, nothing else." }],
        max_tokens: 30,
        temperature: 0
        // 注意：不加 response_format，MiniMax 不支持 json_object 会导致挂起
      });
      const req = https.request({
        hostname, path: urlPath, method: "POST", timeout: 15000,
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
          "Content-Length": Buffer.byteLength(payload)
        }
      }, res => {
        let data = "";
        res.on("data", c => data += c);
        res.on("end", () => {
          try {
            const json = JSON.parse(data);
            if (res.statusCode >= 400) {
              const msg = json.error?.message || json.message || json.code || `HTTP ${res.statusCode}`;
              reject(new Error(`HTTP ${res.statusCode}: ${msg}`)); return;
            }
            resolve({ json, statusCode: res.statusCode });
          } catch(e) { reject(new Error(`响应解析失败(${res.statusCode}): ${data.slice(0,100)}`)); }
        });
      });
      req.on("timeout", () => req.destroy(new Error("请求超时(15s)，请检查网络或 API Key")));
      req.on("error", reject);
      req.write(payload);
      req.end();
    });

    const { json } = await testReq;
    const translation = json.choices?.[0]?.message?.content?.trim() || "";
    const elapsed = Date.now() - t0;
    return {
      success: true, translation, elapsed, model,
      message: `连接正常，响应 ${elapsed}ms，翻译: "${translation}"`
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
});



// ─── 记忆库 IPC ────────────────────────────────────────────────────────────────
ipcMain.handle("db-search-memory", (_, query) => {
  try {
    const q = `%${query}%`;
    // L3: 个性化排序：该记忆被应用次数(accept_count) × 0.5 + 分数(score) × 0.3 + 时间新鲜度 × 0.2
    const rows = getDb().prepare(`
      SELECT m.*,
        COALESCE(e.accept_count, 0) as accept_count
      FROM memory_segments m
      LEFT JOIN (
        SELECT metadata, COUNT(*) as accept_count
        FROM usage_events
        WHERE event_type = 'memory_applied'
        GROUP BY metadata
      ) e ON e.metadata = CAST(m.id AS TEXT)
      WHERE m.source LIKE ? OR m.target LIKE ?
      ORDER BY
        (COALESCE(e.accept_count, 0) * 0.5 +
         COALESCE(m.score, 70) * 0.3 +
         CASE WHEN (julianday('now') - julianday(m.saved_at)) < 30 THEN 4 ELSE 0 END) DESC,
        m.saved_at DESC
      LIMIT 5
    `).all(q, q);
    return { success: true, items: rows };
  } catch (e) { return { success: false, error: e.message }; }
});
ipcMain.handle("db-get-memory-stats", () => {
  try {
    const total = getDb().prepare("SELECT COUNT(*) as n FROM memory_segments").get().n;
    const avgScore = getDb().prepare("SELECT AVG(score) as s FROM memory_segments WHERE score IS NOT NULL").get().s;
    const items = getDb().prepare("SELECT * FROM memory_segments ORDER BY saved_at DESC LIMIT 10").all();
    return { success: true, stats: { total, avgScore: avgScore ? Math.round(avgScore) : null, recent: items } };
  } catch (e) { return { success: false, error: e.message }; }
});

// L2: 使用习惯埋点日志
ipcMain.handle("log-usage-event", (_, { eventType, segmentId, projectId, metadata }) => {
  try {
    getDb().prepare("INSERT INTO usage_events (event_type, segment_id, project_id, metadata) VALUES (?, ?, ?, ?)"
    ).run(eventType, segmentId ?? null, projectId ?? null, JSON.stringify(metadata ?? {}));
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
});

// ─── AI 请求工具（含超时 + 重试） ─────────────────────────────────────────────
function aiRequest(hostname, urlPath, body, attempt = 0) {
  const MAX_ATTEMPTS = 4;
  return new Promise((resolve, reject) => {
    const apiKey = (body._apiKey || '').trim();
    const sendBody = { ...body }; delete sendBody._apiKey;
    const payload = JSON.stringify(sendBody);
    const req = https.request({
      hostname, path: urlPath, method: "POST",
      timeout: 60000,
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
        "Content-Length": Buffer.byteLength(payload)
      }
    }, res => {
      let data = "";
      res.on("data", c => { data += c; });
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          // 429 Rate Limit: 指数退避重试
          if (res.statusCode === 429 && attempt < MAX_ATTEMPTS - 1) {
            const retryAfter = parseInt(res.headers['retry-after'] || '0', 10);
            const delay = retryAfter > 0 ? retryAfter * 1000 : Math.pow(2, attempt) * 1000;
            logToFile('WARN', `429 Rate Limit on ${hostname}, retry in ${delay}ms (attempt ${attempt + 1})`);
            setTimeout(() => aiRequest(hostname, urlPath, body, attempt + 1).then(resolve).catch(reject), delay);
            return;
          }
          if (res.statusCode >= 400) {
            const msg = json.error?.message || json.message || json.code || `HTTP ${res.statusCode}`;
            const friendlyMsg = res.statusCode === 429
              ? `请求频率超限 (429)，请稍后再试。${msg}`
              : res.statusCode === 401 ? `API 密钥无效或已过期 (401)` : `API错误 ${res.statusCode}: ${msg}`;
            logToFile('ERROR', `API ${hostname} HTTP ${res.statusCode}: ${msg}`);
            reject(new Error(friendlyMsg)); return;
          }
          if (json.error) { reject(new Error(json.error.message || JSON.stringify(json.error))); return; }
          resolve(json);
        } catch (e) { reject(new Error(`响应解析失败(${res.statusCode}): ${data.slice(0,120)}`)); }
      });
    });
    req.on("timeout", () => {
      logToFile('ERROR', `AI请求超时 ${hostname}${urlPath}`);
      req.destroy(new Error("请求超时（60s），请检查网络或代理连接"));
    });
    req.on("error", err => {
      // 网络错误（含 Clash 断开）：指数退避重试
      if (attempt < MAX_ATTEMPTS - 1) {
        const delay = Math.pow(2, attempt) * 1000; // 1s/2s/4s
        logToFile('WARN', `网络错误 ${hostname}: ${err.message}, retry in ${delay}ms`);
        setTimeout(() => aiRequest(hostname, urlPath, body, attempt + 1).then(resolve).catch(reject), delay);
      } else {
        logToFile('ERROR', `AI请求最终失败 ${hostname}: ${err.message} (${MAX_ATTEMPTS} attempts)`);
        const finalErr = err.code === 'ECONNREFUSED'
          ? new Error(`代理连接失败，已重试 ${MAX_ATTEMPTS} 次。请检查 Clash 代理设置。`)
          : err;
        reject(finalErr);
      }
    });
    req.write(payload);
    req.end();
  });
}

// ─── C2: 模型回退机制 ────────────────────────────────────────────────────────
// 当主模型连续失败时，自动切换到备用模型
const FALLBACK_MODELS = {
  deepseek: { hostname: 'dashscope.aliyuncs.com', urlPath: '/compatible-mode/v1/chat/completions', model: 'qwen-max', provider: 'qwen' },
  qwen:     { hostname: 'api.deepseek.com', urlPath: '/v1/chat/completions', model: 'deepseek-v4-flash', provider: 'deepseek' },
  minimax:  { hostname: 'api.deepseek.com', urlPath: '/v1/chat/completions', model: 'deepseek-v4-flash', provider: 'deepseek' }
};

async function aiRequestWithFallback(hostname, urlPath, body) {
  try {
    return await aiRequest(hostname, urlPath, body);
  } catch (primaryErr) {
    // 只在非401（密钥错误）时尝试回退
    if (primaryErr.message.includes('401')) throw primaryErr;
    // 尝试识别当前 provider 并找到回退
    const currentProvider = hostname.includes('deepseek') ? 'deepseek' : hostname.includes('dashscope') ? 'qwen' : hostname.includes('minimax') ? 'minimax' : null;
    const fallback = currentProvider && FALLBACK_MODELS[currentProvider];
    if (!fallback) throw primaryErr;
    // 检查回退模型是否有 API key
    const fallbackKey = decryptStoredKey(fallback.provider);
    if (!fallbackKey) throw primaryErr;
    logToFile('WARN', `主模型 ${currentProvider} 失败，回退到 ${fallback.provider}: ${primaryErr.message}`);
    const fallbackBody = { ...body, _apiKey: fallbackKey, model: fallback.model };
    return await aiRequest(fallback.hostname, fallback.urlPath, fallbackBody);
  }
}

// ─── AI 审核核心函数（IPC + 后台队列共用）──────────────────────────────────────
function callReview(r) {
  const { apiModel, apiKey, source, target, sourceLang = "Chinese", targetLang = "Polish", extraSource,
    guidelineText, globalContext, contextBefore, contextAfter, glossaryItems,
    speakerGender = "auto", customPrompt = "" } = r;

  const guidelineBlock = guidelineText ? `\n\n=== TRANSLATION GUIDELINES (MANDATORY) ===\n${guidelineText.slice(0, 3000)}\n=== END ===` : "";
  const globalBlock = globalContext ? `\n\n=== GLOBAL SCRIPT OUTLINE ===\n${globalContext}\n=== END ===` : "";
  const contextBlock = (contextBefore || contextAfter) ? `\n\n=== LOCAL DIALOGUE CONTEXT (前后各7条) ===\n[上文 PRECEDING]\n${contextBefore || "None"}\n[下文 SUCCEEDING]\n${contextAfter || "None"}\n=== END ===` : "";
  const glossaryBlock = glossaryItems?.length ? `\n\n=== GLOSSARY (MUST follow) ===\n${glossaryItems.map(g => `${g.source_term} ${g.chinese_meaning ? `(${g.chinese_meaning})` : ''} → ${g.target_term}`).join("\n")}\n=== END ===` : "";

  const genderMap = {
    male: `The speaker is MALE. Every Polish form referring to the speaker MUST use masculine grammatical agreement — any feminine form is a CRITICAL ERROR. Required masculine forms: past tense (zrobiłem, byłem, poszedłem, powiedziałem, chciałem, mogłem), predicative adjectives (zmęczony, szczęśliwy, gotowy, pewien, zadowolony), titles (aktor, dyrektor, przyjaciel). FORBIDDEN: any -am/-łam/-a endings for the speaker.`,
    female: `The speaker is FEMALE. Every Polish form referring to the speaker MUST use feminine grammatical agreement — any masculine form is a CRITICAL ERROR. Required feminine forms: past tense (zrobiłam, byłam, poszłam, powiedziałam, chciałam, mogłam), predicative adjectives (zmęczona, szczęśliwa, gotowa, pewna, zadowolona), titles (aktorka, dyrektorka, przyjaciółka). FORBIDDEN: any -em/-łem/-y endings for the speaker.`,
    auto: ""
  };
  const genderBlock = genderMap[speakerGender] ? `\n\n=== SPEAKER GENDER ===\n${genderMap[speakerGender]}\n=== END ===` : "";
  const customBlock = customPrompt?.trim() ? `\n\n=== ADDITIONAL INSTRUCTIONS ===\n${customPrompt.trim()}\n=== END ===` : "";

  const system = `You are a professional Polish translation quality auditor (LQA specialist).${guidelineBlock}${globalBlock}${genderBlock}${contextBlock}${glossaryBlock}${customBlock}

Evaluate the QUALITY of the Polish translation. Focus on:
1. Consistency  2. Slang  3. Internet Slang  4. Tense  5. Accuracy  6. Declension/Conjugation  7. Grammar${speakerGender !== "auto" ? "  8. Speaker gender agreement" : ""}

CRITICAL GENDER RULES:
- 2nd person verbs MUST match the LISTENER's gender, not the speaker's (e.g. male listener → -łeś, female listener → -łaś).
- Narration/stage directions MUST use 3rd person (on/ona), NEVER 1st person.
- Female characters should use feminine job titles (prawniczka, dyrektorka) and be addressed with "pani" (not "pan").
- "原告" = powód (plaintiff), "被告" = pozwany (defendant) — do NOT confuse.

Respond ONLY in valid JSON:
{
  "score": <0-100>,
  "dimensions": { "consistency":"","slang":"","internetSlang":"","tense":"","accuracy":"","declension":"","grammar":"" },
  "errors": [{ "type":"","original":"","suggested":"","explanation":"" }],
  "fixedTarget": "<corrected Polish>"
}
The "dimensions" MUST always be filled in Chinese.`;

  let user = `[TARGET LINE]\n${sourceLang} source: ${source}`;
  if (extraSource?.trim()) user += `\n${sourceLang === "Chinese" ? "English" : "Chinese"} reference: ${extraSource}`;
  user += `\nPolish translation to review: ${target}`;

  const isMinimax = apiModel === "minimax";
  const isQwen = apiModel === "qwen";
  const hostname = isMinimax ? "api.minimax.chat" : isQwen ? "dashscope.aliyuncs.com" : "api.deepseek.com";
  const urlPath = isMinimax ? "/v1/chat/completions" : isQwen ? "/compatible-mode/v1/chat/completions" : "/v1/chat/completions";
  // model 字段由调用方传入（minimax 有多种型号）
  const model = isMinimax ? (r.modelName || "MiniMax-Text-01") : isQwen ? "qwen-max" : (r.modelName || "deepseek-v4-flash");

  const body = {
    _apiKey: apiKey, model, max_tokens: 8192,
    messages: [{ role: "system", content: system }, { role: "user", content: user }],
    ...(isMinimax ? {} : { response_format: { type: "json_object" } }),
    temperature: 0.1
  };

  return aiRequest(hostname, urlPath, body)
    .then(json => {
      const content = json.choices?.[0]?.message?.content || "{}";
      return { success: true, result: JSON.parse(content) };
    })
    .catch(e => ({ success: false, error: e.message }));
}

ipcMain.handle("deepseek-review", (_, r) => callReview(r));

// ─── AI 批量审核（每次最多7条，共享上下文）───────────────────────────────────────
function callReviewBatch(r) {
  const { apiModel, apiKey, modelName, segments, sourceLang = "Chinese", targetLang = "Polish",
    guidelineText, globalContext, glossaryItems, customPrompt = "" } = r;

  const n = segments.length;
  const guidelineBlock = guidelineText ? `\n\n=== TRANSLATION GUIDELINES (MANDATORY) ===\n${guidelineText.slice(0, 2000)}\n=== END ===` : "";
  const globalBlock = globalContext ? `\n\n=== GLOBAL SCRIPT OUTLINE ===\n${globalContext}\n=== END ===` : "";
  const glossaryBlock = glossaryItems?.length ? `\n\n=== GLOSSARY (MUST follow) ===\n${glossaryItems.map(g => `${g.source_term} ${g.chinese_meaning ? `(${g.chinese_meaning})` : ''} → ${g.target_term}`).join("\n")}\n=== END ===` : "";
  const customBlock = customPrompt?.trim() ? `\n\n=== ADDITIONAL INSTRUCTIONS ===\n${customPrompt.trim()}\n=== END ===` : "";

  const system = `You are a professional Polish translation quality auditor (LQA specialist).${guidelineBlock}${globalBlock}${glossaryBlock}${customBlock}

You will receive ${n} subtitle lines to audit simultaneously. For EACH line evaluate:
1. Consistency  2. Slang  3. Internet Slang  4. Tense  5. Accuracy  6. Declension/Conjugation  7. Grammar  8. Speaker gender agreement

Respond ONLY in valid JSON (no markdown):
{
  "reviews": [
    {
      "index": 1,
      "score": <0-100>,
      "dimensions": { "consistency":"","slang":"","internetSlang":"","tense":"","accuracy":"","declension":"","grammar":"" },
      "errors": [{ "type":"","original":"","suggested":"","explanation":"" }],
      "fixedTarget": "<corrected Polish or same if correct>"
    }
  ]
}
The array MUST contain exactly ${n} entries with index 1..${n}.
All "dimensions" values MUST be filled in Chinese.`;

  const userLines = segments.map((seg, i) => {
    const genderNote = seg.gender === "female"
      ? "[FEMALE speaker — use -łam/-am/-a forms]"
      : "[MALE speaker — use -łem/-em/-y forms]";
    return `Line ${i + 1} ${genderNote}\n  ${sourceLang} source: ${seg.source}\n  Polish translation: ${seg.target}`;
  }).join("\n\n");

  const user = `Audit the following ${n} subtitle translations:\n\n${userLines}`;

  const isMinimax = apiModel === "minimax";
  const isQwen = apiModel === "qwen";
  const hostname = isMinimax ? "api.minimax.chat" : isQwen ? "dashscope.aliyuncs.com" : "api.deepseek.com";
  const urlPath = isMinimax ? "/v1/chat/completions" : isQwen ? "/compatible-mode/v1/chat/completions" : "/v1/chat/completions";
  const model = isMinimax ? (modelName || "MiniMax-Text-01") : isQwen ? "qwen-max" : (modelName || "deepseek-v4-flash");

  const body = {
    _apiKey: apiKey, model, max_tokens: 8192,
    messages: [{ role: "system", content: system }, { role: "user", content: user }],
    ...(isMinimax ? {} : { response_format: { type: "json_object" } }),
    temperature: 0.1
  };

  return aiRequest(hostname, urlPath, body)
    .then(json => {
      const content = json.choices?.[0]?.message?.content || "{}";
      let parsed;
      try { parsed = JSON.parse(content); } catch { return { success: false, error: "批量审核JSON解析失败: " + content.slice(0, 80) }; }
      const arr = parsed.reviews || [];
      const results = segments.map((seg, i) => {
        const found = arr.find(x => x.index === i + 1) || arr[i];
        if (!found) return { id: seg.id, ok: false };
        return {
          id: seg.id, ok: true,
          score: found.score ?? null,
          dimensions: found.dimensions || {},
          errors: found.errors || [],
          fixedTarget: found.fixedTarget || seg.target
        };
      });
      return { success: true, results };
    })
    .catch(e => ({ success: false, error: e.message }));
}


// ─── AI 批量翻译（每次最多7条，保证上下文一致性）────────────────────────────────
function callTranslateBatch(r) {
  const { apiModel, apiKey, modelName, segments, sourceLang = "Chinese", targetLang = "Polish",
    guidelineText, globalContext, glossaryItems, customPrompt = "",
    contextBefore = [], contextAfter = [] } = r;

  const n = segments.length;
  const guidelineBlock = guidelineText ? `\n\n=== TRANSLATION GUIDELINES (MANDATORY) ===\n${guidelineText.slice(0, 2000)}\n=== END ===` : "";
  const globalBlock = globalContext ? `\n\n=== GLOBAL SCRIPT OUTLINE ===\n${globalContext}\n=== END ===` : "";
  const glossaryBlock = glossaryItems?.length ? `\n\n=== GLOSSARY (MUST follow) ===\n${glossaryItems.map(g => `${g.source_term} ${g.chinese_meaning ? `(${g.chinese_meaning})` : ''} → ${g.target_term}`).join("\n")}\n=== END ===` : "";
  const customBlock = customPrompt?.trim() ? `\n\n=== ADDITIONAL INSTRUCTIONS ===\n${customPrompt.trim()}\n=== END ===` : "";

  // 滑动上下文窗口：前几句已译 + 后几句源文，作为参考
  const ctxBeforeBlock = contextBefore.length ? `\n\n=== PRECEDING CONTEXT (already translated, for reference only – do NOT re-translate) ===\n${contextBefore.map(c => `${c.source} → ${c.target}`).join("\n")}\n=== END ===` : "";
  const ctxAfterBlock = contextAfter.length ? `\n\n=== UPCOMING LINES (for context only – do NOT translate these) ===\n${contextAfter.map(c => c.source).join("\n")}\n=== END ===` : "";

  const system = `You are a professional ${sourceLang}-to-Polish subtitle translator for short drama series.${guidelineBlock}${globalBlock}${glossaryBlock}${ctxBeforeBlock}${ctxAfterBlock}${customBlock}

Rules:
1. Translate ALL ${n} source lines below. Each line has a gender tag for the speaker.
2. Keep each translation natural, concise, suitable for subtitles.
3. Strictly follow Polish grammatical gender for the tagged speaker.
4. Use the preceding/upcoming context to maintain consistency in terminology and tone.
5. Respond ONLY in valid JSON (no markdown, no explanation):
{
  "translations": [
    {"index": 1, "translation": "<Polish>"},
    {"index": 2, "translation": "<Polish>"}
  ]
}
The array MUST contain exactly ${n} entries with index 1..${n}.`;

  const userLines = segments.map((seg, i) => {
    const g = seg.gender === "female"
      ? "[FEMALE speaker: use -łam/-am/-a forms]"
      : "[MALE speaker: use -łem/-em/-y forms]";
    return `Line ${i + 1} ${g}: ${seg.source}`;
  }).join("\n");

  const user = `Translate the following ${n} subtitle lines:\n\n${userLines}`;

  const isMinimax = apiModel === "minimax";
  const isQwen = apiModel === "qwen";
  const hostname = isMinimax ? "api.minimax.chat" : isQwen ? "dashscope.aliyuncs.com" : "api.deepseek.com";
  const urlPath = isMinimax ? "/v1/chat/completions" : isQwen ? "/compatible-mode/v1/chat/completions" : "/v1/chat/completions";
  const model = isMinimax ? (modelName || "MiniMax-Text-01") : isQwen ? "qwen-max" : (modelName || "deepseek-v4-flash");

  const body = {
    _apiKey: apiKey, model, max_tokens: 8192,
    messages: [{ role: "system", content: system }, { role: "user", content: user }],
    ...(isMinimax ? {} : { response_format: { type: "json_object" } }),
    temperature: 0.3
  };

  return aiRequest(hostname, urlPath, body)
    .then(json => {
      const content = json.choices?.[0]?.message?.content || "{}";
      let parsed;
      try { parsed = JSON.parse(content); } catch { return { success: false, error: "批量翻译JSON解析失败: " + content.slice(0, 80) }; }
      const arr = parsed.translations || [];
      const results = segments.map((seg, i) => {
        const found = arr.find(x => x.index === i + 1) || arr[i];
        const translation = (found?.translation || "").trim();
        return { id: seg.id, translation, ok: !!translation };
      });
      return { success: true, results };
    })
    .catch(e => ({ success: false, error: e.message }));
}

// ─── 保留单条翻译作为降级备用 ─────────────────────────────────────────────────
function callTranslate(r) {
  const { apiModel, apiKey, source, sourceLang = "English", targetLang = "Polish",
    guidelineText, globalContext, contextBefore, contextAfter, glossaryItems,
    speakerGender = "auto", customPrompt = "", modelName } = r;

  const guidelineBlock = guidelineText ? `\n\n=== TRANSLATION GUIDELINES (MANDATORY) ===\n${guidelineText.slice(0, 3000)}\n=== END ===` : "";
  const globalBlock = globalContext ? `\n\n=== GLOBAL SCRIPT OUTLINE ===\n${globalContext}\n=== END ===` : "";
  const contextBlock = (contextBefore || contextAfter)
    ? `\n\n=== DIALOGUE CONTEXT (前后各7条) ===\n[上文]\n${contextBefore || "None"}\n[下文]\n${contextAfter || "None"}\n=== END ===` : "";
  const glossaryBlock = glossaryItems?.length
    ? `\n\n=== GLOSSARY (MUST follow) ===\n${glossaryItems.map(g => `${g.source_term} ${g.chinese_meaning ? `(${g.chinese_meaning})` : ''} → ${g.target_term}`).join("\n")}\n=== END ===` : "";
  const genderMap = {
    male: "Speaker is MALE — use masculine Polish forms: past tense (-łem/-em), adjectives (-y/-i). FORBIDDEN: -łam/-am/-a endings for speaker.",
    female: "Speaker is FEMALE — use feminine Polish forms: past tense (-łam/-am), adjectives (-a). FORBIDDEN: -łem/-em/-y endings for speaker.",
    auto: ""
  };
  const genderBlock = genderMap[speakerGender] ? `\n\n=== SPEAKER GENDER ===\n${genderMap[speakerGender]}\n=== END ===` : "";
  const customBlock = customPrompt?.trim() ? `\n\n=== ADDITIONAL INSTRUCTIONS ===\n${customPrompt.trim()}\n=== END ===` : "";

  const system = `You are a professional ${sourceLang}-to-Polish subtitle translator for short drama series.${guidelineBlock}${globalBlock}${genderBlock}${contextBlock}${glossaryBlock}${customBlock}

Rules:
1. Translate ONLY the [TARGET LINE]. Keep it natural, concise, and suitable for subtitles.
2. Preserve tone, emotion, slang, and character voice.
3. Strictly follow Polish gender-number-case agreement (性数格).
4. CROSS-CHARACTER GENDER: When character A speaks TO character B using 2nd person, verb forms MUST match B's gender (e.g. male listener → -łeś/-eś, female listener → -łaś/-aś). Do NOT use the speaker's own gender for 2nd person.
5. NARRATOR: Narration/stage directions MUST use 3rd person (on/ona/oni), NEVER 1st person (ja/my).
6. FEMININE VOCABULARY: Use feminine forms for female characters — kostium (not garnitur), prawniczka (not prawnik), dyrektorka (not dyrektor). Use pani (not pan) when addressing females.
7. Respond ONLY in valid JSON (no markdown):
{
  "translation": "<Polish translation>",
  "score": <self-assessment 0-100>,
  "dimensions": { "consistency":"","slang":"","internetSlang":"","tense":"","accuracy":"","declension":"","grammar":"" },
  "errors": [],
  "fixedTarget": "<same as translation>"
}
The "dimensions" MUST be filled in Chinese.`;

  const user = `[TARGET LINE]\n${sourceLang} source: ${source}`;

  const isMinimax = apiModel === "minimax";
  const isQwen = apiModel === "qwen";
  const hostname = isMinimax ? "api.minimax.chat" : isQwen ? "dashscope.aliyuncs.com" : "api.deepseek.com";
  const urlPath = isMinimax ? "/v1/chat/completions" : isQwen ? "/compatible-mode/v1/chat/completions" : "/v1/chat/completions";
  const model = isMinimax ? (modelName || "MiniMax-Text-01") : isQwen ? "qwen-max" : (modelName || "deepseek-v4-flash");

  const body = {
    _apiKey: apiKey, model, max_tokens: 8192,
    messages: [{ role: "system", content: system }, { role: "user", content: user }],
    ...(isMinimax ? {} : { response_format: { type: "json_object" } }),
    temperature: 0.3
  };

  return aiRequest(hostname, urlPath, body)
    .then(json => {
      const content = json.choices?.[0]?.message?.content || "{}";
      const parsed = JSON.parse(content);
      // 兼容不同字段名
      const translation = parsed.translation || parsed.fixedTarget || parsed.target || "";
      return {
        success: true,
        result: {
          translation,
          score: parsed.score ?? null,
          errors: parsed.errors || [],
          dimensions: parsed.dimensions || {},
          fixedTarget: translation
        }
      };
    })
    .catch(e => ({ success: false, error: e.message }));
}


// ─── 两阶段队列系统 ──────────────────────────────────────────────────────────────
const bgState = {
  running: false, stopFlag: false, pauseFlag: false,
  phase: "idle", // "idle" | "translate" | "review"
  projectId: null, apiKey: null, apiModel: "deepseek", modelName: "deepseek-v4-flash",
  sourceLang: "Chinese", targetLang: "Polish", customPrompt: "", guidelineText: "", globalContext: "",
  progress: { done: 0, total: 0, currentId: null, error: null, paused: false, phase: "idle" }
};

function broadcastProgress(updatedSegments) {
  const payload = { ...bgState.progress, running: bgState.running, paused: bgState.pauseFlag, phase: bgState.phase, projectId: bgState.projectId };
  if (updatedSegments?.length) payload.updatedSegments = updatedSegments;
  BrowserWindow.getAllWindows().forEach(w => {
    try { w.webContents.send("review-progress", payload); } catch {}
  });
}

function broadcastPhaseComplete(phase) {
  BrowserWindow.getAllWindows().forEach(w => {
    try { w.webContents.send("phase-complete", { phase }); } catch {}
  });
}

// ─── Phase 1：批量翻译队列 ────────────────────────────────────────────────────
async function runTranslateQueue() {
  if (bgState.running) return;
  bgState.running = true;
  bgState.stopFlag = false;
  bgState.pauseFlag = false;
  bgState.phase = "translate";

  try {
    const db = getDb();
    const toTranslate = db.prepare(
      "SELECT * FROM segments WHERE project_id = ? AND status = 'pending' AND (target IS NULL OR target = '') ORDER BY id"
    ).all(bgState.projectId);

    const total = toTranslate.length;
    bgState.progress = { done: 0, total, currentId: null, error: null, paused: false, phase: "translate" };
    broadcastProgress();

    const proj = db.prepare("SELECT * FROM projects WHERE id = ?").get(bgState.projectId);
    const glossaryItems = getGlossary(bgState.projectId);

    for (let i = 0; i < toTranslate.length && !bgState.stopFlag; i += 7) {
      // 暂停轮询
      while (bgState.pauseFlag && !bgState.stopFlag) {
        bgState.progress.paused = true; broadcastProgress();
        await new Promise(r => setTimeout(r, 500));
      }
      if (bgState.stopFlag) break;
      bgState.progress.paused = false;

      const batch = toTranslate.slice(i, i + 7);
      bgState.progress.currentId = batch[0].id;
      broadcastProgress();

      // 构建滑动上下文窗口：前3条已译 + 后3条源文
      const contextBefore = [];
      for (let k = Math.max(0, i - 3); k < i; k++) {
        const seg = toTranslate[k];
        if (seg.target) contextBefore.push({ source: seg.source, target: seg.target });
      }
      const contextAfter = [];
      for (let k = i + 7; k < Math.min(toTranslate.length, i + 10); k++) {
        contextAfter.push({ source: toTranslate[k].source });
      }

      let batchOk = false, lastErr = null;
      for (let attempt = 1; attempt <= 3 && !bgState.stopFlag; attempt++) {
        if (attempt > 1) {
          bgState.progress.error = `批次${Math.floor(i / 7) + 1} 第${attempt}次重试...`;
          broadcastProgress();
          await new Promise(r => setTimeout(r, attempt * 3000));
        }
        try {
          const res = await callTranslateBatch({
            apiModel: bgState.apiModel, apiKey: bgState.apiKey, modelName: bgState.modelName,
            segments: batch.map(s => ({ id: s.id, source: s.source, gender: s.gender || "male" })),
            sourceLang: bgState.sourceLang, targetLang: bgState.targetLang,
            guidelineText: bgState.guidelineText || proj?.guideline_text || "",
            globalContext: bgState.globalContext || proj?.global_context || "",
            glossaryItems, customPrompt: bgState.customPrompt,
            contextBefore, contextAfter
          });
          if (res.success) {
            const updateStmt = db.prepare("UPDATE segments SET target=?, original_target=?, status='translated', fixed=0 WHERE id=? AND project_id=?");
            const errStmt = db.prepare("UPDATE segments SET status='error', errors=? WHERE id=? AND project_id=?");
            db.transaction(() => {
              for (const item of res.results) {
                if (item.ok && item.translation) {
                  updateStmt.run(item.translation, item.translation, item.id, bgState.projectId);
                  // 回写到 toTranslate 数组，供下一批上下文窗口使用
                  const seg = toTranslate.find(s => s.id === item.id);
                  if (seg) seg.target = item.translation;
                } else {
                  errStmt.run(JSON.stringify([{ type: "翻译失败", original: "", suggested: "", explanation: "AI未返回有效译文" }]), item.id, bgState.projectId);
                }
              }
            })();
            bgState.progress.error = null;
            batchOk = true;
            // 获取更新后的 segments 发送给前端
            const updatedIds = res.results.map(r => r.id);
            const updatedSegs = db.prepare(`SELECT * FROM segments WHERE project_id = ? AND id IN (${updatedIds.map(() => '?').join(',')})`).all(bgState.projectId, ...updatedIds);
            bgState.progress.done = Math.min(i + 7, total);
            broadcastProgress(updatedSegs);
            break;
          } else { lastErr = res.error; }
        } catch (e) { lastErr = e.message; }
      }

      if (!batchOk) {
        const errStmt = db.prepare("UPDATE segments SET status='error', errors=? WHERE id=? AND project_id=?");
        for (const seg of batch) {
          errStmt.run(JSON.stringify([{ type: "翻译失败", original: "", suggested: "", explanation: lastErr }]), seg.id, bgState.projectId);
        }
        bgState.progress.error = lastErr;
        bgState.progress.done = Math.min(i + 7, total);
      }

      broadcastProgress();
    }
  } catch (e) {
    bgState.progress.error = e.message;
  }

  const completed = !bgState.stopFlag;
  bgState.running = false;
  bgState.pauseFlag = false;
  bgState.phase = "idle";
  bgState.progress.currentId = null;
  bgState.progress.paused = false;
  bgState.progress.phase = "idle";
  broadcastProgress();
  if (completed) broadcastPhaseComplete("translate");
}

// ─── Phase 2：七维度审核队列（并发滑动窗口，最多3批同时飞出）────────────────
async function runReviewQueue() {
  if (bgState.running) return;
  bgState.running = true;
  bgState.stopFlag = false;
  bgState.pauseFlag = false;
  bgState.phase = "review";

  // 信号量：控制最大并发批次数
  const MAX_CONCURRENT = 3;
  let activeTasks = 0;
  // 用 Set 存储所有等待的 resolve，避免多个任务同时完成时丢失通知
  const slotWaiters = new Set();
  const waitForSlot = () => new Promise(r => slotWaiters.add(r));
  const releaseSlot = () => { activeTasks--; slotWaiters.forEach(r => r()); slotWaiters.clear(); };

  // 处理单个批次（含重试+降级）并写库，完成后释放槽位
  const processBatch = async (batch, proj, glossaryItems) => {
    const db = getDb();
    let batchOk = false, lastErr = null;

    for (let attempt = 1; attempt <= 3 && !bgState.stopFlag; attempt++) {
      if (attempt > 1) {
        // 遇到限流(429)多等一会儿，其他错误常规退避
        const delay = lastErr?.includes("429") ? 10000 : attempt * 3000;
        await new Promise(r => setTimeout(r, delay));
      }
      try {
        const res = await callReviewBatch({
          apiModel: bgState.apiModel, apiKey: bgState.apiKey, modelName: bgState.modelName,
          segments: batch.map(s => ({ id: s.id, source: s.source, target: s.target, gender: s.gender || "male" })),
          sourceLang: bgState.sourceLang,
          guidelineText: bgState.guidelineText || proj?.guideline_text || "",
          globalContext: bgState.globalContext || proj?.global_context || "",
          glossaryItems, customPrompt: bgState.customPrompt
        });
        if (res.success) {
          const updateStmt = db.prepare("UPDATE segments SET status='done', score=?, errors=?, dimensions=?, fixed_target=?, fixed=0 WHERE id=? AND project_id=?");
          const histStmt  = db.prepare("INSERT INTO segment_history (segment_id, project_id, target, score, errors, fixed_target) VALUES (?,?,?,?,?,?)");
          const memStmt   = db.prepare("INSERT INTO memory_segments (source, target, project_id, score) VALUES (?,?,?,?)");
          const errStmt   = db.prepare("UPDATE segments SET status='error' WHERE id=? AND project_id=?");
          db.transaction(() => {
            for (const item of res.results) {
              const origSeg = batch.find(s => s.id === item.id);
              if (item.ok) {
                updateStmt.run(item.score ?? null, JSON.stringify(item.errors || []), JSON.stringify(item.dimensions || {}), item.fixedTarget || "", item.id, bgState.projectId);
                histStmt.run(item.id, bgState.projectId, origSeg?.target || "", item.score ?? null, JSON.stringify(item.errors || []), item.fixedTarget || "");
                if (item.score) memStmt.run(origSeg?.source || "", item.fixedTarget || origSeg?.target || "", bgState.projectId, item.score);
              } else {
                errStmt.run(item.id, bgState.projectId);
              }
            }
          })();
          batchOk = true;
          break;
        } else { lastErr = res.error; }
      } catch (e) { lastErr = e.message; }
    }

    // 批量失败降级为逐条
    if (!batchOk) {
      for (const seg of batch) {
        if (bgState.stopFlag) break;
        try {
          const res = await callReview({
            apiModel: bgState.apiModel, apiKey: bgState.apiKey, modelName: bgState.modelName,
            source: seg.source, target: seg.target, sourceLang: bgState.sourceLang, targetLang: bgState.targetLang,
            speakerGender: seg.gender || "male",
            guidelineText: bgState.guidelineText || proj?.guideline_text || "",
            globalContext: bgState.globalContext || proj?.global_context || "",
            glossaryItems, customPrompt: bgState.customPrompt
          });
          const db2 = getDb();
          if (res.success) {
            const rv = res.result;
            db2.prepare("UPDATE segments SET status='done', score=?, errors=?, dimensions=?, fixed_target=?, fixed=0 WHERE id=? AND project_id=?")
              .run(rv.score ?? null, JSON.stringify(rv.errors || []), JSON.stringify(rv.dimensions || {}), rv.fixedTarget || "", seg.id, bgState.projectId);
            db2.prepare("INSERT INTO segment_history (segment_id, project_id, target, score, errors, fixed_target) VALUES (?,?,?,?,?,?)")
              .run(seg.id, bgState.projectId, seg.target, rv.score ?? null, JSON.stringify(rv.errors || []), rv.fixedTarget || "");
          } else {
            db2.prepare("UPDATE segments SET status='error' WHERE id=? AND project_id=?").run(seg.id, bgState.projectId);
          }
        } catch {
          getDb().prepare("UPDATE segments SET status='error' WHERE id=? AND project_id=?").run(seg.id, bgState.projectId);
        }
      }
      bgState.progress.error = lastErr;
    }

    // P2: 完成后读取已更新的句段增量数据，减少前端全量刷新
    bgState.progress.done += batch.length;
    const remaining = getDb().prepare("SELECT COUNT(*) as n FROM segments WHERE project_id = ? AND status = 'translated'").get(bgState.projectId)?.n || 0;
    bgState.progress.total = bgState.progress.done + remaining;
    bgState.progress.error = batchOk ? null : lastErr;
    // 附带增量 segments
    const updatedIds = batch.map(s => s.id);
    const updatedSegs = getDb().prepare(
      "SELECT * FROM segments WHERE id IN (" + updatedIds.map(() => "?").join(",") + ")"
    ).all(...updatedIds);
    const payload = { ...bgState.progress, running: bgState.running, paused: bgState.pauseFlag, phase: bgState.phase, projectId: bgState.projectId, updatedSegments: updatedSegs };
    BrowserWindow.getAllWindows().forEach(w => {
      try { w.webContents.send("review-progress", payload); } catch {}
    });
    releaseSlot();
  };

  try {
    const db = getDb();
    const total = db.prepare("SELECT COUNT(*) as n FROM segments WHERE project_id = ? AND status = 'translated'").get(bgState.projectId)?.n || 0;
    bgState.progress = { done: 0, total, currentId: null, error: null, paused: false, phase: "review" };
    broadcastProgress();

    // 调度循环：持续取批次、等槽位、派发任务
    while (!bgState.stopFlag) {
      // 暂停处理
      while (bgState.pauseFlag && !bgState.stopFlag) {
        bgState.progress.paused = true; broadcastProgress();
        await new Promise(r => setTimeout(r, 500));
      }
      if (bgState.stopFlag) break;
      bgState.progress.paused = false;

      // 等待并发槽空闲
      if (activeTasks >= MAX_CONCURRENT) {
        await waitForSlot();
        continue; // 重新从头检查 stopFlag/pauseFlag
      }

      // 取下一批（每批7条，锁定状态避免重复取）
      const batch = db.prepare("SELECT * FROM segments WHERE project_id = ? AND status = 'translated' ORDER BY id LIMIT 7").all(bgState.projectId);
      if (!batch.length) {
        // 没有新任务了，等所有飞出的批次落地再退出
        if (activeTasks === 0) break;
        await waitForSlot();
        continue;
      }

      // 立即将这批状态标记为 processing（用 'in_review' 虚拟态防止重复取）
      // 实际上 SQLite 无此状态列，用临时更新 status 规避重复取：
      db.prepare("UPDATE segments SET status='in_review' WHERE id IN (" + batch.map(() => "?").join(",") + ")")
        .run(...batch.map(s => s.id));

      bgState.progress.currentId = batch[0].id;
      broadcastProgress();

      const proj = db.prepare("SELECT * FROM projects WHERE id = ?").get(bgState.projectId);
      const glossaryItems = getGlossary(bgState.projectId);

      activeTasks++;
      // 不 await，让任务在后台并发执行
      processBatch(batch, proj, glossaryItems);
    }

    // 等待所有飞出任务完成
    while (activeTasks > 0) {
      await waitForSlot();
    }

    // 将所有 in_review 状态（因 stopFlag 中断而未完成的）回退为 translated
    if (bgState.stopFlag) {
      db.prepare("UPDATE segments SET status='translated' WHERE project_id = ? AND status = 'in_review'").run(bgState.projectId);
    }

  } catch (e) {
    bgState.progress.error = e.message;
  }

  const completed = !bgState.stopFlag;
  bgState.running = false;
  bgState.pauseFlag = false;
  bgState.phase = "idle";
  bgState.progress.currentId = null;
  bgState.progress.paused = false;
  bgState.progress.phase = "idle";
  broadcastProgress();
  if (completed) broadcastPhaseComplete("review");
}

// ─── IPC 处理器 ──────────────────────────────────────────────────────────────
ipcMain.handle("start-translate-queue", (_, config) => {
  if (bgState.running) return { success: false, error: "已在运行中" };
  Object.assign(bgState, config);
  runTranslateQueue();
  return { success: true };
});

ipcMain.handle("start-review-queue", (_, config) => {
  if (bgState.running) return { success: false, error: "已在运行中" };
  Object.assign(bgState, config);
  // 将遗留的 in_review 句段回退为 translated，使其能被队列重新捡起
  try { getDb().prepare("UPDATE segments SET status='translated' WHERE project_id = ? AND status = 'in_review'").run(bgState.projectId); } catch {}
  runReviewQueue();
  return { success: true };
});

// 向后兼容：旧的 start-background-review 调用 runReviewQueue
ipcMain.handle("start-background-review", (_, config) => {
  if (bgState.running) return { success: false, error: "已在运行中" };
  Object.assign(bgState, config);
  runReviewQueue();
  return { success: true };
});

ipcMain.handle("stop-background-review", () => {
  bgState.stopFlag = true; bgState.pauseFlag = false;
  return { success: true };
});

ipcMain.handle("pause-background-review", () => {
  bgState.pauseFlag = true; bgState.progress.paused = true;
  broadcastProgress(); return { success: true };
});

ipcMain.handle("resume-background-review", () => {
  bgState.pauseFlag = false; bgState.progress.paused = false;
  broadcastProgress(); return { success: true };
});

ipcMain.handle("reset-project-full", (_, projectId) => {
  try {
    if (bgState.running && bgState.projectId === projectId) {
      bgState.stopFlag = true; bgState.pauseFlag = false;
    }
    resetProject(projectId);
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle("get-review-status", () => ({
  success: true, ...bgState.progress, running: bgState.running, paused: bgState.pauseFlag, phase: bgState.phase
}));

ipcMain.handle("sync-review-status", () => {
  broadcastProgress();
  return { success: true, ...bgState.progress, running: bgState.running, paused: bgState.pauseFlag, phase: bgState.phase };
});



// ─── AI 全局摘要 ──────────────────────────────────────────────────────────────
ipcMain.handle("deepseek-summarize", (_, { apiModel, apiKey, modelName, sourceTextChunk }) => {
  const isMinimax = apiModel === "minimax";
  const isQwen = apiModel === "qwen";
  const hostname = isMinimax ? "api.minimax.chat" : isQwen ? "dashscope.aliyuncs.com" : "api.deepseek.com";
  const urlPath = isMinimax ? "/v1/chat/completions" : isQwen ? "/compatible-mode/v1/chat/completions" : "/v1/chat/completions";
  const model = isMinimax ? "MiniMax-Text-01" : isQwen ? "qwen-max" : (modelName || "deepseek-v4-flash");

  const body = {
    _apiKey: apiKey,
    model,
    messages: [
      { role: "system", content: "You are an expert script analyst. Analyze the excerpt and summarize: 1. Overall plot/narrative. 2. Character relationships (genders if apparent). 3. Tone and register. Be extremely concise (1-2 paragraphs)." },
      { role: "user", content: `Script excerpt:\n\n${sourceTextChunk}` }
    ],
    temperature: 0.1
  };

  return aiRequest(hostname, urlPath, body)
    .then(json => ({ success: true, result: json.choices?.[0]?.message?.content || "" }))
    .catch(e => ({ success: false, error: e.message }));
});

// ─── 术语挖掘（双模型交叉验证）─────────────────────────────────────────────────
const termState = { running: false, stopFlag: false, done: 0, total: 0, terms: [], batchRows: [], projectId: null };

function broadcastTermProgress(payload) {
  // 同步到 termState，以便前端重新挂载时可查询
  if (payload.done    !== undefined) termState.done    = payload.done;
  if (payload.total   !== undefined) termState.total   = payload.total;
  if (payload.terms   !== undefined) termState.terms   = payload.terms;
  if (payload.batchRows !== undefined) termState.batchRows = payload.batchRows;
  if (payload.running !== undefined) termState.running  = payload.running;
  if (payload.projectId !== undefined) termState.projectId = payload.projectId;
  BrowserWindow.getAllWindows().forEach(w => {
    try { w.webContents.send("term-progress", payload); } catch {}
  });
}

// 返回 { terms: [], error: null|string }，不再吞错误
function callTermExtraction({ hostname, urlPath, model, apiKey, segments }) {
  const n = segments.length;
  const lines = segments.map((s, i) =>
    `[${i + 1}] 原文: ${s.source.slice(0, 150)}\n    译文: ${(s.fixed_target || s.target).slice(0, 150)}`
  ).join("\n\n");

  const system = `你是中文→波兰语翻译语言学家，专研汉语俚语、影视术语和文化负载词。

任务：对比以下${n}条翻译对，找出【原文中字面意思与实际含义不同】的词汇。

【核心规则】
1. 对比中文原文和波兰语译文，若某词的波兰语译法「不是」其字面直译，说明译者识别出了特殊含义→这是候选词。
2. 若波兰语是字面直译（如：走→iść），则不需要标注。
3. 重点关注：感叹词、网络用语、行业黑话、双关语、文化隐喻。
4. 若无特殊词汇，返回空数组[]。

【返回格式】只返回JSON数组，不要markdown代码块：
[{"sourceTerm":"sleep with","targetTerm":"spać z","type":"slang","explanation":"和某人上床，委婉语","confidence":0.95}]

【严格要求】
- explanation 字段必须全部使用中文！格式：「中文对应翻译，词性或简短说明」
- 示例：「看，动词」「朋友、哥们，俚语」「打破僵局，习语」「竖屏短剧，行业术语」
- 保持简短，不超过15个汉字
- type只能是：slang/terminology/culture/proper_noun`;

  const body = {
    _apiKey: apiKey, model,
    messages: [{ role: "system", content: system }, { role: "user", content: `句段数据：\n\n${lines}` }],
    temperature: 0.1
  };

  return aiRequest(hostname, urlPath, body)
    .then(json => {
      const raw = json.choices?.[0]?.message?.content || "[]";
      const cleaned = raw.replace(/```[\w]*\n?/g, "").trim();
      const s = cleaned.indexOf("["), e = cleaned.lastIndexOf("]");
      if (s === -1 || e === -1) return { terms: [], error: null };
      const arr = JSON.parse(cleaned.slice(s, e + 1));
      const terms = Array.isArray(arr) ? arr.filter(t => t.sourceTerm && t.type) : [];
      return { terms, error: null };
    })
    .catch(err => {
      console.error(`[术语挖掘] ${hostname} ${model} 失败:`, err.message);
      return { terms: [], error: err.message };
    });
}

ipcMain.handle("analyze-terms", async (_, { projectId, maxSegments = 200 }) => {
  if (termState.running) return { success: false, error: "分析已在进行中" };

  // 从 keystore 读取已保存的 API Key（与设置页共用同一份）
  const dsKey = decryptStoredKey('deepseek');
  const mmKey = decryptStoredKey('minimax');
  if (!dsKey) return { success: false, error: "请先在设置页配置 DeepSeek API Key" };
  if (!mmKey) return { success: false, error: "请先在设置页配置 MiniMax API Key" };

  termState.running = true;
  termState.stopFlag = false;
  termState.projectId = projectId;

  try {
    const db = getDb();
    const segs = db.prepare(
      "SELECT source, target, fixed_target FROM segments WHERE project_id = ? AND status = 'done' ORDER BY id LIMIT ?"
    ).all(projectId, maxSegments);

    if (!segs.length) {
      termState.running = false;
      broadcastTermProgress({ running: false, done: 0, total: 0, terms: [], batchRows: [], projectId });
      return { success: true };
    }

    const BATCH = 10;
    const batches = [];
    for (let i = 0; i < segs.length; i += BATCH) batches.push(segs.slice(i, i + BATCH));
    const total = batches.length;
    const termCountMap = new Map();

    // 初始化批次状态行
    const batchRows = batches.map((_, idx) => ({
      idx: idx + 1, status: 'waiting', count: 0, dsError: null, mmError: null
    }));

    broadcastTermProgress({ running: true, done: 0, total, termCount: 0, batchRows: [...batchRows], projectId });

    for (let i = 0; i < batches.length; i++) {
      if (termState.stopFlag) break;

      // 标记当前批次为运行中
      batchRows[i].status = 'running';
      broadcastTermProgress({ running: true, done: i, total, termCount: termCountMap.size, batchRows: [...batchRows], projectId });

      const [dsResult, mmResult] = await Promise.all([
        callTermExtraction({ hostname: "api.deepseek.com", urlPath: "/v1/chat/completions", model: (readStoredPref('modelName') || "deepseek-v4-flash"), apiKey: dsKey, segments: batches[i] }),
        callTermExtraction({ hostname: "api.minimax.chat", urlPath: "/v1/chat/completions", model: "MiniMax-Text-01",  apiKey: mmKey, segments: batches[i] })
      ]);

      const dsTerms = dsResult.terms;
      const mmTerms = mmResult.terms;
      batchRows[i].dsError = dsResult.error;
      batchRows[i].mmError = mmResult.error;

      const dsMap = new Map(dsTerms.map(t => [t.sourceTerm, t]));
      const mmMap = new Map(mmTerms.map(t => [t.sourceTerm, t]));
      const batchResults = [];

      for (const [key, dt] of dsMap) {
        if (mmMap.has(key)) {
          const mt = mmMap.get(key);
          batchResults.push({ ...dt, confidence: Math.max(dt.confidence || 0.8, mt.confidence || 0.8), modelCount: 2 });
        } else {
          batchResults.push({ ...dt, modelCount: 1 });
        }
      }
      for (const [key, mt] of mmMap) {
        if (!dsMap.has(key)) batchResults.push({ ...mt, modelCount: 1 });
      }

      let batchNewCount = 0;
      for (const t of batchResults) {
        const ex = termCountMap.get(t.sourceTerm);
        if (ex) {
          ex.count++;
          ex.confidence = Math.max(ex.confidence, t.confidence || 0);
          ex.modelCount = Math.max(ex.modelCount, t.modelCount);
        } else {
          termCountMap.set(t.sourceTerm, { ...t, count: 1 });
          batchNewCount++;
        }
      }

      // 批次完成
      batchRows[i].status = (dsResult.error && mmResult.error) ? 'error' : 'done';
      batchRows[i].count = batchNewCount;

      broadcastTermProgress({ running: true, done: i + 1, total, termCount: termCountMap.size, batchRows: [...batchRows], projectId });
      if (i < batches.length - 1) await new Promise(r => setTimeout(r, 300));
    }

    const finalTerms = Array.from(termCountMap.values());
    broadcastTermProgress({ running: false, done: total, total, terms: finalTerms, batchRows: [...batchRows], projectId });
    termState.running = false;

    // macOS 系统通知
    try {
      const { Notification: N } = require("electron");
      if (N.isSupported()) {
        new N({ title: "术语挖掘完成", body: `发现 ${finalTerms.length} 条候选术语，请前往「术语挖掘」页面审核入库` }).show();
      }
    } catch {}

    return { success: true };
  } catch (e) {
    termState.running = false;
    broadcastTermProgress({ running: false, done: 0, total: 0, terms: [], batchRows: [], error: e.message });
    return { success: false, error: e.message };
  }
});

ipcMain.handle("stop-term-analysis", () => {
  termState.stopFlag = true;
  termState.running = false;
  termState.done = 0;
  termState.total = 0;
  termState.terms = [];
  termState.batchRows = [];
  return { success: true };
});

// 前端重新挂载时恢复状态
ipcMain.handle("get-term-state", () => ({
  success: true,
  running:   termState.running,
  done:      termState.done,
  total:     termState.total,
  terms:     termState.terms,
  batchRows: termState.batchRows,
  projectId: termState.projectId,
}));
// ─── A4: 统计报告 Excel 导出 ────────────────────────────────────────────────────
ipcMain.handle("export-stats-report", async () => {
  if (!win) return { success: false, error: "窗口未初始化" };
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    defaultPath: `翻译质量报告_${new Date().toISOString().slice(0,10)}.xlsx`,
    filters: [{ name: "Excel", extensions: ["xlsx"] }]
  });
  if (canceled || !filePath) return { success: false, error: "Cancelled" };

  const xlsx = require("xlsx");
  const db = getDb();

  // Sheet1: 项目汇总
  const projects = db.prepare("SELECT id, file_path, project_name FROM projects ORDER BY id DESC").all();
  const summaryRows = [["项目名称", "文件路径", "总句段", "完成数", "完成率%", "平均分", "错误数"]];
  for (const p of projects) {
    const total = db.prepare("SELECT COUNT(*) as n FROM segments WHERE project_id=?").get(p.id)?.n || 0;
    const done  = db.prepare("SELECT COUNT(*) as n FROM segments WHERE project_id=? AND status='done'").get(p.id)?.n || 0;
    const avgRow = db.prepare("SELECT AVG(score) as avg FROM segments WHERE project_id=? AND score IS NOT NULL").get(p.id);
    const errN  = db.prepare("SELECT COUNT(*) as n FROM segments WHERE project_id=? AND errors != '[]'").get(p.id)?.n || 0;
    summaryRows.push([p.project_name||p.file_path.split("/").pop(), p.file_path, total, done, total>0?Math.round(done/total*100):0, avgRow?.avg?Math.round(avgRow.avg):null, errN]);
  }

  // Sheet2: 错误维度分布（跨所有项目汇总）
  const allSegs = db.prepare("SELECT errors FROM segments WHERE errors != '[]' AND errors IS NOT NULL").all();
  const dimCount = {};
  for (const seg of allSegs) {
    try {
      const errs = JSON.parse(seg.errors);
      for (const e of errs) {
        const t = e.type || "其他";
        dimCount[t] = (dimCount[t] || 0) + 1;
      }
    } catch {}
  }
  const dimRows = [["错误类型", "出现次数"]];
  for (const [k,v] of Object.entries(dimCount).sort((a,b)=>b[1]-a[1])) dimRows.push([k, v]);

  // Sheet3: 低分句段（<60）
  const lowSegs = db.prepare(`
    SELECT p.project_name, p.file_path, s.id, s.source, s.target, s.fixed_target, s.score, s.errors
    FROM segments s JOIN projects p ON s.project_id=p.id
    WHERE s.score IS NOT NULL AND s.score < 60 ORDER BY s.score ASC LIMIT 500
  `).all();
  const lowRows = [["项目", "句段ID", "源文", "译文", "AI建议", "评分", "错误数"]];
  for (const s of lowSegs) {
    let errN = 0;
    try { errN = JSON.parse(s.errors).length; } catch {}
    lowRows.push([s.project_name||s.file_path?.split("/").pop(), s.id, s.source, s.target, s.fixed_target, s.score, errN]);
  }

  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, xlsx.utils.aoa_to_sheet(summaryRows), "项目汇总");
  xlsx.utils.book_append_sheet(wb, xlsx.utils.aoa_to_sheet(dimRows), "错误维度分布");
  xlsx.utils.book_append_sheet(wb, xlsx.utils.aoa_to_sheet(lowRows), "低分句段");
  xlsx.writeFile(wb, filePath);

  return { success: true, filePath };
});

// ─── A5: 术语表批量导入 Excel ────────────────────────────────────────────────────
ipcMain.handle("glossary-batch-import", async (_, { projectId, rows }) => {
  try {
    const db = getDb();
    const stmt = db.prepare("INSERT OR IGNORE INTO glossary (project_id, source_term, target_term, notes) VALUES (?, ?, ?, ?)");
    const run = db.transaction(() => {
      let count = 0;
      for (const r of rows) {
        if (!r.source || !r.target) continue;
        stmt.run(projectId ?? null, String(r.source).trim(), String(r.target).trim(), String(r.notes||"").trim());
        count++;
      }
      return count;
    });
    const count = run();
    return { success: true, count };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ─── AGAN: 对抗式术语扩展 IPC ─────────────────────────────────────────────────

// 生成测试批次（调用 AI 生成带故意错误的句段）
ipcMain.handle("agan-generate", async (_, { apiModel, apiKey, modelName, domain, errorType, count, glossaryItems, sourceType }) => {
  // ── 配额检查 ─────────────────────────────────────────────────────────────────
  const db = getDb();
  const store = readKeyStore();
  const dailyLimit = parseInt(store["__pref__aganDailyLimit"] ?? 20, 10);
  const today = new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'
  const todayUsage = db.prepare(
    "SELECT COUNT(*) as n FROM usage_events WHERE event_type='agan_generate' AND ts >= ?"
  ).get(today + ' 00:00:00').n;
  if (todayUsage >= dailyLimit) {
    return { success: false, error: `今日配额已用完（${todayUsage}/${dailyLimit}）。请明天再试，或在设置中调整每日上限。`, quotaExceeded: true };
  }

  const DOMAINS     = ['general', 'game', 'legal', 'emotion', 'idiom'];
  const ERROR_TYPES = ['gender', 'tense', 'declension', 'vocab'];
  const domainMap   = { general: '日常对话', game: '游戏/动作', legal: '法律/合同', emotion: '情感/心理', idiom: '成语/俚语/梗' };
  const errorMap    = { gender: '性别格变化错误', tense: '时态混淆', declension: '名词格变化错误', vocab: '词汇选择偏差' };
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];
  const shuffle = arr => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

  const n = count || 10;
  // 为每条 item 预分配领域+错误类型（random 则每条各取随机组合）
  const assignments = Array.from({ length: n }, (_, i) => ({
    domain:    domain    === 'random' ? pick(DOMAINS)     : (domain    || 'general'),
    errorType: sourceType === 'normal' ? 'none' : (errorType === 'random' ? pick(ERROR_TYPES) : (errorType || 'gender')),
  }));

  const glossaryBlock = glossaryItems?.length
    ? `\n已有术语参考（生成时请引用这些词汇）：\n${glossaryItems.slice(0, 30).map(g => `${g.source_term} → ${g.target_term}`).join('\n')}`
    : '';

  // ── 去重：拉取已有中文表达，防止重复生成 ─────────────────────────────────────
  const existingZh = new Set();
  try {
    db.prepare("SELECT chinese_meaning FROM glossary WHERE chinese_meaning IS NOT NULL AND chinese_meaning != ''").all()
      .forEach(r => existingZh.add(r.chinese_meaning.trim()));
    db.prepare("SELECT zh_suggestion FROM pending_glossary WHERE zh_suggestion IS NOT NULL AND zh_suggestion != ''").all()
      .forEach(r => existingZh.add(r.zh_suggestion.trim()));
    // 还要排除 agan_pool 中已有的 source
    db.prepare("SELECT source FROM agan_pool WHERE source IS NOT NULL AND source != ''").all()
      .forEach(r => existingZh.add(r.source.trim()));
  } catch {}
  const existingList = [...existingZh];

  // ── 非对抗生成多样性：随机场景提示 + 打乱种子 ────────────────────────────────
  const SCENARIO_HINTS = [
    '职场同事间的闲聊', '旅行途中与当地人的对话', '餐厅点餐和美食讨论',
    '学生宿舍里的日常', '情侣之间的争吵与和好', '网购退货的客服沟通',
    '体育赛事的激情评论', '医院就诊时的描述症状', '租房签合同的协商',
    '朋友聚会上的玩笑话', '家长会上老师与家长的对话', '面试官与应聘者的对话',
    '深夜加班时的自言自语', '宠物主人对宠物的碎碎念', '社交媒体上的评论互动',
    '游戏队友之间的战术沟通', '超市购物时的价格比较', '健身房里的运动建议',
    '电影院散场后的影评讨论', '火车站台上焦急等待的人',
  ];
  const randomScenes = shuffle(SCENARIO_HINTS).slice(0, 3);
  const diversitySalt = `[batch-${Date.now()}-${Math.random().toString(36).slice(2,8)}]`;

  // 成语/俚语/梗种子池（动态去除已收录的）
  const filterPool = (line) => {
    const items = line.split('、').filter(w => !existingZh.has(w.replace(/[\(（].*$/, '').trim()));
    return items.length > 0 ? shuffle(items).join('、') : null;
  };
  const poolLines = [
    filterPool('画龙点睛、走马观花、对牛弹琴、半途而废、马到成功、一石二鸟、火上浇油、亡羊补牢、破釜沉舟、杯水车薪、叶公好龙、按图索骥、起死回生、设身处地、画蛇添足、刻舟求剑、守株待兔、掩耳盗铃、鹤立鸡群、纸上谈兵、塞翁失马、班门弄斧、胸有成竹、狐假虎威、井底之蛙、朝三暮四、望梅止渴'),
    filterPool('绝了、芭比Q了、yyds、躺平、内卷、打工人、摸鱼、社恐、破防了、整活、绷不住、草、遥遥领先、拿捏了、打摆子、u1s1、比比皆知、6到飞起、老六、xswl、集美、伤害不大侮辱性极强'),
    filterPool('我去、哇塞、牛批、秀、下头、上头、硬控、抽象、典中典、抄作业、火辣辣、集大成者、淦、无语子、离谱、有点东西'),
    filterPool('三个臭皮匠顶个诸葛亮、半路杀出个程咬金、竹篮打水一场空、姜太公钓鱼愿者上钩、吃不了兜着走、骑虎难下、杀鸡儆猴、狗咬吕洞宾不识好人心'),
  ].filter(Boolean);

  const IDIOM_POOL = poolLines.length > 0
    ? `【可选的中文高难度表达（从中选取未覆盖的）】\n成语：${poolLines[0] || '（已全部收录）'}\n网络梗/俚语：${poolLines[1] || '（已全部收录）'}\n口语/感叹：${poolLines[2] || '（已全部收录）'}\n歇后语/俗语：${poolLines[3] || '（已全部收录）'}`
    : '【种子池已全部收录，请自由发挥生成新的成语/俚语/梗/歇后语/口语，但不要与排除名单重复】';

  const excludeBlock = existingList.length > 0
    ? `\n⚠️ 以下表达已收录，严禁重复生成：${existingList.slice(0, 80).join('、')}\n`
    : '';

  const hasIdiom = assignments.some(a => a.domain === 'idiom');

  // 构建包含每条具体要求的 prompt
  const itemList = assignments.map((a, i) =>
    a.domain === 'idiom'
      ? `${i+1}. 领域:【成语/俚语/梗】 错误要求:【将成语/俚语直译，丢失文化含义】`
      : `${i+1}. 领域:【${domainMap[a.domain]}】 错误类型:【${a.errorType === 'none' ? '无错误(标准准确翻译)' : errorMap[a.errorType]}】`
  ).join('\n');

  const isCleanIdiom = sourceType === 'normal' && hasIdiom;

  // 非对抗模式的场景提示
  const scenarioHint = sourceType === 'normal'
    ? `\n请围绕以下场景方向生成多样化内容（不必严格限定）：${randomScenes.join('、')}\n要求内容风格多样，长短句混合，避免模板化。${diversitySalt}\n`
    : '';

  // X2 释义层指令（Phase 1 验证：嵌入 prompt 内的单次调用链式推理）
  const x2Instruction = `
【X2 释义层规则】翻译前，必须先用直白中文解释 source 的真实含义，填入 x2_paraphrase 字段。
释义必须保留原文的语气强度和情感色彩，不能过度解释或弱化。

示例：
| source | x2_paraphrase | 说明 |
|--------|---------------|------|
| 太秀了 | 表现极其出色，令人惊叹 | 俚语→直白赞叹 |
| 芭比Q了 | 完蛋了，彻底没救了 | 网络梗→口语 |
| 画龙点睛 | 在关键处加上精妙一笔使整体完美 | 成语→语义展开 |
| 你搁这搁这呢 | 你在反复做同样无意义的事(不满语气) | 省略+语气标注 |
| 这也太离谱了吧 | 这件事超出常理，令人难以置信 | 口语→显化 |
| 他可真行 | 他的行为令人无语/不可理喻(反讽) | 反讽→标注 |
| 格局打开 | 思维视野变得开阔大气 | 网络用语→释义 |
| 拿捏了 | 完美掌控，表现得恰到好处 | 俚语→直白 |
| 我直接一个破防 | 我的心理防线被击破，非常感动/震惊 | 省略+补全 |
| 属实有点东西 | 确实有水平/有实力 | 口语→标准 |

规则：
- 释义长度控制在 5-20 字，不要写成百科解释
- 必须保留语气：赞叹就赞叹，不满就不满，反讽必须标注

【X3 翻译层规则】基于 x2_paraphrase 的显化语义来翻译，填入 target 字段。保持语体与原文一致。

【X4 校准层规则】对 target 进行母语级打磨，填入 x4_final 字段：
- 去除翻译腔（如过度使用 bardzo、jest to）
- 压缩冗余，使表达简洁自然
- 确保波兰语性数格一致
- x4_final 是最终输出，必须是母语者会自然使用的表达
示例：target:"Bardzo imponujące, godne podziwu" → x4_final:"Imponujące!"

【唯一性约束】每条 source 必须完全不同，禁止生成重复或近义的 source。`;

  const system = isCleanIdiom
    ? `你是中波双语术语表采集工具，专注于中文成语、俚语、网络梗、口语的波兰语文化等价词组。只输出词组/短语对，不要生成完整句子。${x2Instruction}`
    : hasIdiom
    ? `你是中波双语语料采集工具，专注于中文成语、俚语、网络梗和口语的波兰语文化等价表达。${x2Instruction}`
    : `你是一个专业的中波翻译测试数据生成工具。${x2Instruction}`;

  const idiomNote = hasIdiom ? `
${IDIOM_POOL}
${isCleanIdiom ? `
【词组采集模式】规则：
1. 从上方表达池中选取成语/俚语/梗/口语
2. source 字段填中文词组原词（如"走马观花"、"yyds"、"我去"），不要写完整句子
3. target 字段填波兰语文化等价词组/短语（词根形式），不要写完整句子
4. 示例：
   - source:"画龙点睛" → target:"dodać ostatni szlif"
   - source:"yyds" → target:"absolutny mistrz"
   - source:"走马观花" → target:"powierzchownie zapoznać się z czymś"
   - source:"对牛弹琴" → target:"mówić do ściany"
   - source:"破防了" → target:"trafiło mnie"
   - source:"我去" → target:"o rany!"
5. pl_term = target, zh_term = source
6. error_type 填 "vocab"，domain 填 "idiom"
` : `
【成语/俚语/梗】条目采集规则（语料采集模式，不是对抗训练）：
1. 从上方表达池选取成语/俚语/梗，自然嵌入中文句子
2. 波兰语译文必须是地道的「文化等价表达」，绝对不要直译字面：
   - 「画龙点睛」→ "dodać ostatni szlif"（不是 "malować smoka i zaznaczać oko"）
   - 「走马观花」→ "powierzchownie zapoznać się z czymś"
   - 「对牛弹琴」→ "mówić do ściany"
   - 「绝了」→ "niesamowite!" / "to jest arcydzieło!"
   - 「yyds」→ "absolutny mistrz" / "nie ma równych"
   - 「躺平」→ "odpuszczać sobie" / "rezygnować z wyścigu szczurów"
   - 「破防了」→ "trafiło mnie" / "moja obrona jest złamana"
   - 「我去了」（惊叹）→ "o rany!" / "nie do wiary!"
3. 额外输出 pl_term（波兰语等价词/短语，词根形式）和 zh_term（中文成语/俚语原词）
4. error_type 填 "vocab"，domain 填 "idiom"
`}` : '';

  const user = isCleanIdiom
    ? `请生成 ${n} 组中波词组/短语对（不要完整句子），每组包含一个中文成语/俚语/网络梗/口语及其波兰语文化等价表达。
${excludeBlock}${glossaryBlock}${idiomNote}${scenarioHint}
严格按照以下 JSON 数组格式输出，不要有任何其他文字：
[{"source":"中文词组","x2_paraphrase":"直白中文释义","target":"波兰语初译","x4_final":"母语级精炼波兰语","error_type":"vocab","domain":"idiom","pl_term":"波兰语等价词组","zh_term":"中文词组"}]`
    : `请严格按照下方清单，逐条生成 ${n} 条测试句段，每条的领域和错误类型必须与清单一致：

${itemList}
${excludeBlock}${glossaryBlock}${idiomNote}${scenarioHint}
${hasIdiom ? '「成语/俚语/梗」条目：含该表达的中文原句 + 地道波兰语文化等价翻译（不是错误翻译）+ pl_term + zh_term\n其他领域条目：中文原句 + 根据错误类型生成波兰语译文（若为"无错误(标准准确翻译)"则生成标准干净译文，否则故意引入错误）。' : '每条包含：1个中文原文，1个根据错误类型生成波兰语译文（若为"无错误(标准准确翻译)"则生成标准干净译文，否则故意引入错误）。'}
严格按照以下 JSON 数组格式输出，不要有任何其他文字，数量必须与清单一致：
[{"source":"中文原文","x2_paraphrase":"直白中文释义","target":"波兰语初译","x4_final":"母语级精炼波兰语","error_type":"key","domain":"key","pl_term":"(仅idiom)波兰语等价词","zh_term":"(仅idiom)中文成语/俚语原词"}]

error_type: gender/tense/declension/vocab，domain: general/game/legal/emotion/idiom
pl_term 和 zh_term 仅在 domain=idiom 时输出，其他条目省略。`;

  try {
    const isMinimax = apiModel === 'minimax';
    const isQwen = apiModel === 'qwen';
    const hostname = isMinimax ? 'api.minimax.chat' : isQwen ? 'dashscope.aliyuncs.com' : 'api.deepseek.com';
    const urlPath = isMinimax ? '/v1/chat/completions' : isQwen ? '/compatible-mode/v1/chat/completions' : '/v1/chat/completions';
    const model = isMinimax ? (modelName || 'MiniMax-Text-01') : isQwen ? 'qwen-max' : (modelName || readStoredPref('modelName') || 'deepseek-v4-flash');
    const resolvedKey = decryptStoredKey(apiModel) || apiKey;
    const useTemp = sourceType === 'normal' ? 0.95 : 0.8;
    const body = { _apiKey: resolvedKey, model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], temperature: useTemp };
    const json = await aiRequest(hostname, urlPath, body);
    const raw = json.choices?.[0]?.message?.content || '[]';
    const match = raw.match(/\[[\s\S]*\]/);
    const items = match ? JSON.parse(match[0]) : [];

    // ── 批内去重 + 跨批去重 ────────────────────────────────────────────────────
    const batchSeen = new Set();
    const uniqueItems = items.filter(item => {
      if (!item.source || !item.target) return false;
      const key = String(item.source).trim();
      if (batchSeen.has(key) || existingZh.has(key)) return false;
      batchSeen.add(key);
      existingZh.add(key); // 防止后续批次再生成
      return true;
    });

    const stmt = db.prepare("INSERT INTO agan_pool (source, target, error_type, domain, source_type) VALUES (?, ?, ?, ?, ?)");
    const pgStmt = db.prepare("INSERT OR IGNORE INTO pending_glossary (pl_term, zh_suggestion, context, confidence, source_type) VALUES (?,?,?,?,?)");
    const newPgItems = [];
    const insertAll = db.transaction(() => {
      for (const item of uniqueItems) {
        const itemDomain = String(item.domain || domain || 'general');
        if (itemDomain === 'idiom') {
          // idiom 语料采集模式：跳过 agan_pool，直接写入 pending_glossary（正确文化等价翻译）
          const finalPl = item.x4_final || item.pl_term || item.target;
          if (finalPl) {
            const pgRes = pgStmt.run(finalPl, item.zh_term || item.source, item.source, 0.95, sourceType === 'normal' ? 'normal' : 'adversarial');
            if (pgRes.changes > 0) {
              newPgItems.push({ id: pgRes.lastInsertRowid, pl_term: finalPl, zh_suggestion: item.zh_term || item.source, context: item.source, confidence: 0.95, verdict: 'pending', created_at: new Date().toISOString(), x2_paraphrase: item.x2_paraphrase || '', x4_final: item.x4_final || '', x3_target: item.target || '' });
            }
          }
        } else {
          // 其他领域：写入 agan_pool（对抗训练），target 用 x4_final
          const finalTarget = item.x4_final || item.target;
          stmt.run(String(item.source), String(finalTarget), String(item.error_type || errorType || ''), itemDomain, sourceType === 'normal' ? 'normal' : 'adversarial');
        }
      }
    });
    insertAll();

    // 记录用量
    db.prepare("INSERT INTO usage_events (event_type, metadata) VALUES ('agan_generate', ?)").run(
      JSON.stringify({ domain, errorType, count: items.length })
    );

    // 推送实时进度给渲染进程 —— 后端主动 push，前端一次 setState 更新所有状态
    const aganPending = db.prepare("SELECT COUNT(*) as n FROM agan_pool WHERE human_verdict='pending'").get().n;
    const pgCount = db.prepare("SELECT COUNT(*) as n FROM pending_glossary WHERE verdict='pending'").get().n;
    if (win && !win.isDestroyed()) {
      win.webContents.send('agan-progress', { aganPending, pendingGlossaryCount: pgCount, newPgItems });
    }

    return { success: true, count: uniqueItems.length, items: uniqueItems, todayUsage: todayUsage + 1, dailyLimit, newPgItems, deduped: items.length - uniqueItems.length };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// MiniMax 双模型交叉验证 idiom 术语（独立调用，结果仅返回前端展示）
ipcMain.handle("agan-verify-idiom", async (_, { items, auditProvider, auditModelName }) => {
  try {
    const mmKey = decryptStoredKey('minimax');
    console.log(`[verify-idiom] mmKey prefix: ${mmKey.slice(0,10)}... items count: ${items.length}`);
    if (!mmKey) return { success: false, error: '未配置 MiniMax 密钥，请在设置中保存 MiniMax 接口密钥' };

    const results = [];
    for (const item of items) {
      if (!item.zh_suggestion || !item.pl_term) { results.push({ id: item.id, match: null, minimaxSuggestion: '' }); continue; }
      try {
        const sysPrompt = '你是波兰语文化翻译评审专家。严格按JSON格式返回（无其他文字）：{"mmSuggestion":"<最地道波兰语等价，不超过8词>","score":<0-100语义相似度>,"explanation":"<一句中文说明两者关系>","advice":"<若score<90说明原译不足并给出改进建议，否则留空字符串>"}';
        const userPrompt = `中文：「${item.zh_suggestion}」\n待评审译文：「${item.pl_term}」\n请给出最地道的波兰语等价、与待评审译文的语义相似度评分（0-100）、解释，以及改进建议（若分低于90）。`;
        const verifyIsMinimax = !auditProvider || auditProvider === 'minimax';
        const verifyIsQwen = auditProvider === 'qwen';
        const verifyKey = verifyIsMinimax ? mmKey : (auditProvider === 'deepseek' ? decryptStoredKey('deepseek') : decryptStoredKey(auditProvider));
        if (!verifyKey) { results.push({ id: item.id, match: null, minimaxSuggestion: '', error: `未配置 ${auditProvider} 密钥` }); continue; }
        const verifyHostname = verifyIsMinimax ? 'api.minimax.chat' : verifyIsQwen ? 'dashscope.aliyuncs.com' : 'api.deepseek.com';
        const verifyUrlPath = verifyIsQwen ? '/compatible-mode/v1/chat/completions' : '/v1/chat/completions';
        const verifyModel = verifyIsMinimax ? (auditModelName || 'MiniMax-Text-01') : verifyIsQwen ? 'qwen-max' : (auditModelName || 'deepseek-v4-flash');
        const body = {
          _apiKey: verifyKey, model: verifyModel,
          messages: [
            { role: 'system', content: sysPrompt },
            { role: 'user', content: userPrompt }
          ],
          temperature: 0.1
        };
        const json = await aiRequest(verifyHostname, verifyUrlPath, body);
        const raw = (json.choices?.[0]?.message?.content || '').trim();
        let parsed = {};
        try {
          const jsonStr = raw.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
          parsed = JSON.parse(jsonStr);
        } catch(_) {
          parsed = { mmSuggestion: '', score: 0, explanation: raw.slice(0, 60), advice: '' };
        }
        const score = Math.min(100, Math.max(0, Number(parsed.score) || 0));
        const pass = score >= 90;
        console.log(`[verify] zh="${item.zh_suggestion}" pl="${item.pl_term}" mm="${parsed.mmSuggestion}" score=${score} pass=${pass}`);
        results.push({ id: item.id, pass, score, minimaxSuggestion: parsed.mmSuggestion || '', explanation: parsed.explanation || '', advice: parsed.advice || '' });
      } catch (e) {
        console.error(`[verify-idiom] error for id=${item.id}: ${e.message}`);
        results.push({ id: item.id, match: null, minimaxSuggestion: '', error: e.message });
      }
    }
    return { success: true, results };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// 列出待确认条目（含双引擎分数，前端展示分歧）
ipcMain.handle("agan-list", async (_, { verdict = 'pending', limit = 50 }) => {
  try {
    const db = getDb();
    const rows = db.prepare(
      "SELECT * FROM agan_pool WHERE human_verdict = ? ORDER BY ABS(COALESCE(score_a,0) - COALESCE(score_b,0)) DESC, created_at DESC LIMIT ?"
    ).all(verdict, limit);
    return { success: true, items: rows };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// 对单条 agan_pool 进行双引擎审核评分
ipcMain.handle("agan-score-item", async (_, { id, apiModel, apiKey, apiModel2, apiKey2, modelName, source, target }) => {
  try {
    const scoreOne = async (provider, key, mName) => {
      const resolvedKey = decryptStoredKey(provider) || key;
      const r = await callReview({ apiModel: provider, apiKey: resolvedKey, modelName: mName, source, target, sourceLang: 'Chinese', targetLang: 'Polish' });
      return r.success ? (r.result.score ?? null) : null;
    };
    const [scoreA, scoreB] = await Promise.all([
      scoreOne(apiModel, apiKey, modelName),
      scoreOne(apiModel2 || apiModel, apiKey2 || apiKey, modelName)
    ]);
    const divergence = (scoreA != null && scoreB != null) ? Math.abs(scoreA - scoreB) : 0;
    const db = getDb();
    db.prepare("UPDATE agan_pool SET score_a=?, score_b=?, divergence=? WHERE id=?").run(scoreA, scoreB, divergence, id);
    return { success: true, scoreA, scoreB, divergence };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// B4: 人工判决 — accept/reject/modify
ipcMain.handle("agan-verdict", async (_, { id, verdict, acceptedTarget, addToGlossary, addToMemory, glossaryProjectId }) => {
  try {
    const db = getDb();
    db.prepare("UPDATE agan_pool SET human_verdict=?, accepted_target=? WHERE id=?")
      .run(verdict, acceptedTarget || '', id);

    if (verdict === 'accept' || verdict === 'modify') {
      const item = db.prepare("SELECT * FROM agan_pool WHERE id=?").get(id);
      if (!item) return { success: false, error: '条目不存在' };
      const finalTarget = acceptedTarget || item.target;

      // 可选：加入翻译记忆
      if (addToMemory) {
        db.prepare("INSERT INTO memory_segments (source, target, project_id, score) VALUES (?, ?, ?, ?)")
          .run(item.source, finalTarget, glossaryProjectId ?? null, item.score_a ?? 80);
      }
      // 可选：加入术语表（将句段中核心词汇提炼，此处直接存原文/译文）
      if (addToGlossary && item.source && finalTarget) {
        const exists = db.prepare("SELECT id FROM glossary WHERE source_term=? AND target_term=?").get(item.source, finalTarget);
        if (!exists) {
          db.prepare("INSERT INTO glossary (project_id, source_term, target_term, notes) VALUES (?, ?, ?, ?)")
            .run(glossaryProjectId ?? null, item.source, finalTarget, `AGAN自动扩充 · ${item.domain}`);
        }
      }
    }

    // 使用习惯埋点
    db.prepare("INSERT INTO usage_events (event_type, segment_id, metadata) VALUES (?, ?, ?)")
      .run('agan_verdict', id, JSON.stringify({ verdict, addToGlossary, addToMemory }));

    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// AGAN 统计摘要
ipcMain.handle("agan-stats", async () => {
  try {
    const db = getDb();
    const pending = db.prepare("SELECT COUNT(*) as n FROM agan_pool WHERE human_verdict='pending'").get().n;
    const accepted = db.prepare("SELECT COUNT(*) as n FROM agan_pool WHERE human_verdict IN ('accept','modify')").get().n;
    const rejected = db.prepare("SELECT COUNT(*) as n FROM agan_pool WHERE human_verdict='reject'").get().n;
    const highDiv = db.prepare("SELECT COUNT(*) as n FROM agan_pool WHERE divergence>=20 AND human_verdict='pending'").get().n;
    const pendingGlossary = db.prepare("SELECT COUNT(*) as n FROM pending_glossary WHERE verdict='pending'").get()?.n ?? 0;
    // 今日配额用量
    const today = new Date().toISOString().slice(0, 10);
    const todayUsage = db.prepare(
      "SELECT COUNT(*) as n FROM usage_events WHERE event_type='agan_generate' AND ts >= ?"
    ).get(today + ' 00:00:00').n;
    const store = readKeyStore();
    const dailyLimit = parseInt(store["__pref__aganDailyLimit"] ?? 20, 10);
    return { success: true, pending, accepted, rejected, highDiv, pendingGlossary, todayUsage, dailyLimit };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// AGAN 一键重置（清空对抗池 + 当日 usage 记录）
ipcMain.handle("agan-reset", async () => {
  try {
    const db = getDb();
    const deleted = db.prepare("DELETE FROM agan_pool").run().changes;
    const pgDeleted = db.prepare("DELETE FROM pending_glossary WHERE verdict='pending'").run().changes;
    db.prepare("DELETE FROM usage_events WHERE event_type='agan_generate'").run();
    return { success: true, deleted: deleted + pgDeleted };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ─── AGAN: AI 自动提取有价值术语 ──────────────────────────────────────────────
ipcMain.handle("agan-extract-terms", async (_, { apiModel, apiKey, modelName }) => {
  try {
    const db = getDb();
    const items = db.prepare(
      "SELECT * FROM agan_pool WHERE human_verdict='pending' AND score_a IS NOT NULL ORDER BY created_at DESC LIMIT 50"
    ).all();
    if (!items.length) { console.log('[agan-extract-terms] 无已评分的 pending 条目'); return { success: true, count: 0 }; }

    const lines = items.map((it, i) =>
      `[${i+1}] 中文: ${it.source}\n     波兰语: ${it.target}\n     领域: ${it.domain}\n     AI评分: ${it.score_a}`
    ).join('\n\n');

    const system = `你是中波翻译术语审核专家。从以下对抗训练样本中，提取有价值的术语对。
【强制要求】
**你必须提取至少样本总数 60% 数量的术语对！** (例如提供10个样本，你必须至少提取6个术语对)。如果没有极其完美的术语，请提取最核心的词汇凑够数量。
【筛选标准】
1. 必须是专业词汇、行业术语、文化负载词或常用短语
2. 排除普通日常词汇和整句话
3. 优先选择翻译中容易出错的词汇
4. 每个术语应该是1-4个词的短语或单词
【返回格式】只返回JSON数组，不要markdown代码块：
[{"pl_term":"波兰语术语","zh_suggestion":"中文含义","confidence":0.85,"context":"出处上下文片段"}]`;

    const isMinimax = apiModel === 'minimax';
    const isQwen = apiModel === 'qwen';
    const hostname = isMinimax ? 'api.minimax.chat' : isQwen ? 'dashscope.aliyuncs.com' : 'api.deepseek.com';
    const urlPath = isMinimax ? '/v1/chat/completions' : isQwen ? '/compatible-mode/v1/chat/completions' : '/v1/chat/completions';
    const model = isMinimax ? (modelName || 'MiniMax-Text-01') : isQwen ? 'qwen-max' : (modelName || readStoredPref('modelName') || 'deepseek-v4-flash');
    const resolvedKey = decryptStoredKey(apiModel) || apiKey;
    const body = {
      _apiKey: resolvedKey, model,
      messages: [{ role: 'system', content: system }, { role: 'user', content: `对抗样本数据：\n\n${lines}` }],
      temperature: 0.1
    };

    const json = await aiRequest(hostname, urlPath, body);
    const raw = json.choices?.[0]?.message?.content || '[]';
    console.log('[agan-extract-terms] AI返回原始内容:', raw.slice(0, 300));
    const match = raw.match(/\[[\s\S]*\]/);
    const terms = match ? JSON.parse(match[0]) : [];
    console.log(`[agan-extract-terms] 解析出 ${terms.length} 条术语`);
    if (!terms.length) return { success: true, count: 0 };

    const existStmt = db.prepare("SELECT id FROM pending_glossary WHERE pl_term=? AND verdict='pending'");
    const insertStmt = db.prepare(
      "INSERT INTO pending_glossary (pl_term, zh_suggestion, context, confidence) VALUES (?, ?, ?, ?)"
    );
    let added = 0;
    db.transaction(() => {
      for (const t of terms) {
        if (!t.pl_term) continue;
        if (!existStmt.get(t.pl_term)) {
          insertStmt.run(t.pl_term, t.zh_suggestion || '', t.context || '', t.confidence ?? 0.5);
          added++;
        }
      }
    })();

    return { success: true, count: added };
  } catch (e) {
    console.error('[agan-extract-terms] 错误:', e.message);
    return { success: false, error: e.message };
  }
});

// ─── Blue Agent: 待审术语池 ────────────────────────────────────────────────────

// 列出待审术语
ipcMain.handle("pg-list", (_, { verdict = 'pending', limit = 100 } = {}) => {
  try {
    const rows = getDb().prepare(
      "SELECT * FROM pending_glossary WHERE verdict=? ORDER BY confidence DESC, created_at DESC LIMIT ?"
    ).all(verdict, limit);
    return { success: true, items: rows };
  } catch (e) { return { success: false, error: e.message }; }
});


// 编辑保存：更新 pending_glossary 中的 pl_term / zh_suggestion
ipcMain.handle("pg-update", (_, { id, pl_term, zh_suggestion }) => {
  try {
    const db = getDb();
    db.prepare("UPDATE pending_glossary SET pl_term=?, zh_suggestion=? WHERE id=?").run(pl_term, zh_suggestion, id);
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
});

// 编辑保存：更新 agan_pool 中的 source / target
ipcMain.handle("agan-update", (_, { id, source, target }) => {
  try {
    const db = getDb();
    db.prepare("UPDATE agan_pool SET source=?, target=? WHERE id=?").run(source, target, id);
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
});

// 人工裁决：approve → 加入正式术语表；reject → 忽略；stopword → 加入黑名单
ipcMain.handle("pg-verdict", (_, { id, verdict, zhFinal, plFinal, projectId, domain }) => {
  try {
    const db = getDb();
    const item = db.prepare("SELECT * FROM pending_glossary WHERE id=?").get(id);
    if (!item) return { success: false, error: '记录不存在' };
    db.prepare("UPDATE pending_glossary SET verdict=? WHERE id=?").run(verdict, id);
    if (verdict === 'approve') {
      const finalPl = plFinal || item.pl_term;
      const finalZh = zhFinal || item.zh_suggestion;
      const exists = db.prepare("SELECT id FROM glossary WHERE target_term=? AND chinese_meaning=?").get(finalPl, finalZh);
      if (!exists) {
        const notesStr = domain ? `idiom · ${domain}` : 'Blue Agent 提取';
        db.prepare(
          "INSERT INTO glossary (project_id, source_term, target_term, chinese_meaning, notes) VALUES (?, ?, ?, ?, ?)"
        ).run(projectId ?? null, finalZh, finalPl, finalZh, notesStr);
      }
    } else if (verdict === 'stopword') {
      // 将该词加入黑名单，防止下次重复提取
      db.prepare("INSERT OR IGNORE INTO pg_stopwords (pl_term, reason) VALUES (?, ?)").run(
        item.pl_term.toLowerCase(), '人工标记为噪音'
      );
    }
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
});

// 查询黑名单
 ipcMain.handle("pg-stopwords", () => {
  try {
    const rows = getDb().prepare("SELECT pl_term FROM pg_stopwords").all();
    return { success: true, terms: rows.map(r => r.pl_term) };
  } catch (e) { return { success: false, terms: [] }; }
});

// 批量导入（Blue Agent 脚本调用此路由写入结果）
ipcMain.handle("pg-import", (_, { items }) => {
  try {
    const db = getDb();
    const stmt = db.prepare(
      "INSERT INTO pending_glossary (pl_term, zh_suggestion, context, source_email, confidence) VALUES (?, ?, ?, ?, ?)"
    );
    const insert = db.transaction((rows) => {
      for (const r of rows) stmt.run(r.pl_term, r.zh_suggestion, r.context || '', r.source_email || '', r.confidence ?? 0.5);
    });
    insert(items);
    return { success: true, count: items.length };
  } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle("agan-clear-row", (_, { isAdv }) => {
  try {
    const db = getDb();
    const sourceType = isAdv ? 'adversarial' : 'normal';
    db.prepare("UPDATE agan_pool SET human_verdict = 'ignore' WHERE human_verdict = 'pending' AND source_type = ?").run(sourceType);
    db.prepare("UPDATE pending_glossary SET verdict = 'ignore' WHERE verdict = 'pending' AND source_type = ?").run(sourceType);
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
});

