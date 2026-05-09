// ─── AI 审核核心函数（IPC + 后台队列共用）──────────────────────────────────────
function callReview(r) {
  const { apiModel, apiKey, source, target, sourceLang = "Chinese", targetLang = "Polish", extraSource,
    guidelineText, globalContext, contextBefore, contextAfter, glossaryItems,
    speakerGender = "auto", customPrompt = "" } = r;

  // G2: 防止 Prompt 注入 — 剥离用户控制内容中的指令块分隔符
  const sanitize = (s) => (s || '').replace(/={3}\s*END\s*={3}/gi, '--- end ---');

  const guidelineBlock = guidelineText ? `\n\n=== TRANSLATION GUIDELINES (MANDATORY) ===\n${sanitize(guidelineText).slice(0, 3000)}\n=== END ===` : "";
  const globalBlock = globalContext ? `\n\n=== GLOBAL SCRIPT OUTLINE ===\n${sanitize(globalContext)}\n=== END ===` : "";
  const contextBlock = (contextBefore || contextAfter) ? `\n\n=== LOCAL DIALOGUE CONTEXT (前后各7条) ===\n[上文 PRECEDING]\n${sanitize(contextBefore) || "None"}\n[下文 SUCCEEDING]\n${sanitize(contextAfter) || "None"}\n=== END ===` : "";
  const glossaryBlock = glossaryItems?.length ? `\n\n=== GLOSSARY (MUST follow) ===\n${glossaryItems.map(g => `${sanitize(g.source_term)} → ${sanitize(g.target_term)}`).join("\n")}\n=== END ===` : "";

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

  const isQwen = apiModel === "qwen";
  const hostname = isQwen ? "dashscope.aliyuncs.com" : "api.deepseek.com";
  const urlPath = isQwen ? "/compatible-mode/v1/chat/completions" : "/v1/chat/completions";
  const model = isQwen ? "qwen-max" : "deepseek-chat";

  const body = {
    _apiKey: apiKey, model,
    messages: [{ role: "system", content: system }, { role: "user", content: user }],
    response_format: { type: "json_object" }, temperature: 0.1
  };

  return aiRequest(hostname, urlPath, body)
    .then(json => {
      const content = json.choices?.[0]?.message?.content || "{}";
      return { success: true, result: JSON.parse(content) };
    })
    .catch(e => ({ success: false, error: e.message }));
}

ipcMain.handle("deepseek-review", (_, r) => callReview(r));

// ─── 后台翻译队列系统 ─────────────────────────────────────────────────────────────
const bgState = {
  running: false, stopFlag: false,
  projectId: null, apiKey: null, apiModel: "deepseek",
  sourceLang: "Chinese", targetLang: "Polish", customPrompt: "", guidelineText: "", globalContext: "",
  progress: { done: 0, total: 0, currentId: null, error: null }
};

function broadcastProgress() {
  const payload = { ...bgState.progress, running: bgState.running };
  BrowserWindow.getAllWindows().forEach(w => {
    try { w.webContents.send("review-progress", payload); } catch {}
  });
}

async function runBgQueue() {
  if (bgState.running) return;
  bgState.running = true;
  bgState.stopFlag = false;

  try {
    const db = getDb();
    const total = db.prepare("SELECT COUNT(*) as n FROM segments WHERE project_id = ? AND status = 'pending'").get(bgState.projectId)?.n || 0;
    bgState.progress = { done: 0, total, currentId: null, error: null };
    broadcastProgress();

    while (!bgState.stopFlag) {
      const seg = db.prepare("SELECT * FROM segments WHERE project_id = ? AND status = 'pending' ORDER BY id LIMIT 1").get(bgState.projectId);
      if (!seg) break;

      bgState.progress.currentId = seg.id;
      broadcastProgress();

      // 获取上下文 ±7 条
      const allSegs = db.prepare("SELECT id, source FROM segments WHERE project_id = ? ORDER BY id").all(bgState.projectId);
      const idx = allSegs.findIndex(s => s.id === seg.id);
      const before = allSegs.slice(Math.max(0, idx - 7), idx).map(s => s.source).join("\n");
      const after  = allSegs.slice(idx + 1, Math.min(allSegs.length, idx + 8)).map(s => s.source).join("\n");

      const proj = db.prepare("SELECT * FROM projects WHERE id = ?").get(bgState.projectId);
      const glossaryItems = getGlossary(bgState.projectId);

      try {
        const res = await callReview({
          apiModel: bgState.apiModel, apiKey: bgState.apiKey,
          source: seg.source, target: seg.target,
          sourceLang: bgState.sourceLang, targetLang: bgState.targetLang,
          speakerGender: seg.gender || "male",
          guidelineText: bgState.guidelineText || proj?.guideline_text || "",
          globalContext: bgState.globalContext || proj?.global_context || "",
          contextBefore: before, contextAfter: after,
          glossaryItems, customPrompt: bgState.customPrompt
        });

        if (res.success) {
          const rv = res.result;
          db.prepare(`UPDATE segments SET status='done', score=?, errors=?, dimensions=?, fixed_target=?, fixed=0 WHERE id=? AND project_id=?`)
            .run(rv.score ?? null, JSON.stringify(rv.errors || []), JSON.stringify(rv.dimensions || {}), rv.fixedTarget || "", seg.id, bgState.projectId);
          db.prepare(`INSERT INTO segment_history (segment_id, project_id, target, score, errors, fixed_target) VALUES (?,?,?,?,?,?)`)
            .run(seg.id, bgState.projectId, seg.target, rv.score ?? null, JSON.stringify(rv.errors || []), rv.fixedTarget || "");
          if (rv.score) db.prepare(`INSERT INTO memory_segments (source, target, project_id, score) VALUES (?,?,?,?)`)
            .run(seg.source, rv.fixedTarget || seg.target, bgState.projectId, rv.score);
        } else {
          db.prepare("UPDATE segments SET status='error' WHERE id=? AND project_id=?").run(seg.id, bgState.projectId);
          bgState.progress.error = res.error;
        }
      } catch (e) {
        db.prepare("UPDATE segments SET status='error' WHERE id=? AND project_id=?").run(seg.id, bgState.projectId);
        bgState.progress.error = e.message;
      }

      bgState.progress.done++;
      const remaining = db.prepare("SELECT COUNT(*) as n FROM segments WHERE project_id = ? AND status = 'pending'").get(bgState.projectId)?.n || 0;
      bgState.progress.total = bgState.progress.done + remaining;
      broadcastProgress();
    }
  } catch (e) {
    bgState.progress.error = e.message;
  }

  bgState.running = false;
  bgState.progress.currentId = null;
  // A3: 批量审核完成系统通知
  try {
    const { Notification: N } = require("electron");
    if (N.isSupported()) {
      new N({
        title: "批量审核完成",
        body: `共完成 ${bgState.progress.done} 条句段审核，请前往「翻译审核」页面查看结果`
      }).show();
    }
  } catch {}
  broadcastProgress();
}

ipcMain.handle("start-background-review", (_, config) => {
  if (bgState.running) return { success: false, error: "已在运行中" };
  Object.assign(bgState, config);
  runBgQueue();  // 不 await，后台运行
  return { success: true };
});

ipcMain.handle("stop-background-review", () => {
  bgState.stopFlag = true;
  return { success: true };
});

ipcMain.handle("get-review-status", () => {
  return { success: true, ...bgState.progress, running: bgState.running };
});

ipcMain.handle("sync-review-status", () => {
  broadcastProgress();
  return { success: true, ...bgState.progress, running: bgState.running };
});
