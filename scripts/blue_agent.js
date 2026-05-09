#!/usr/bin/env node
/**
 * scripts/blue_agent.js — Layer 1: Blue Agent（OOV 术语提取器）
 *
 * 用法：
 *   node scripts/blue_agent.js --input data/red_emails.jsonl --apiKey sk-xxx [--dbPath path/to/lqa.db]
 *
 * 流程：
 *  1. 读取 Red Agent 生成的 JSONL 邮件
 *  2. 加载现有 SQLite 术语表作为"已知词库"
 *  3. 每批 5 封邮件，调用 LLM 提取 OOV 新术语 + 推荐中文翻译
 *  4. 写入 pending_glossary 表（供应用内审核）
 *  5. 同时输出 data/blue_oov.json 供人工查看
 */

const https   = require('https')
const fs      = require('fs')
const path    = require('path')
const os      = require('os')

// ── CLI 参数 ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2)
function getArg(flag, def) { const i = args.indexOf(flag); return i !== -1 && args[i+1] ? args[i+1] : def }

const INPUT   = getArg('--input',   path.join(__dirname, '../data/red_emails.jsonl'))
const API_KEY = getArg('--apiKey',  process.env.DEEPSEEK_API_KEY || '')
const OUTPUT  = getArg('--output',  path.join(__dirname, '../data/blue_oov.json'))
const MODEL   = getArg('--model',   'deepseek-chat')
// macOS 应用的 SQLite 路径（用户可覆盖）
const DEFAULT_DB = path.join(os.homedir(), 'Library/Application Support/polish-chiny/ch-pl-lqa/lqa.db')
const DB_PATH  = getArg('--dbPath', DEFAULT_DB)

if (!API_KEY) { console.error('❌ 请提供 --apiKey'); process.exit(1) }
if (!fs.existsSync(INPUT)) { console.error(`❌ 找不到输入文件: ${INPUT}\n  先运行: node scripts/red_agent.js`); process.exit(1) }

// ── 读取现有术语库（用于 OOV 对比）────────────────────────────────────────────
let knownTerms = new Set()
try {
  const Database = require(path.join(__dirname, '../polskiej-chinese-src/node_modules/better-sqlite3'))
  const db = new Database(DB_PATH, { readonly: true })
  const rows = db.prepare("SELECT source_term FROM glossary_items").all()
  rows.forEach(r => knownTerms.add(r.source_term.toLowerCase()))
  console.log(`📚 已加载 ${knownTerms.size} 条现有术语\n`)
} catch (e) {
  console.warn(`⚠ 无法读取现有术语库 (${e.message})，将提取所有术语`)
}

// ── 读取邮件 ──────────────────────────────────────────────────────────────────
const emails = fs.readFileSync(INPUT, 'utf8')
  .split('\n')
  .filter(l => l.trim())
  .map(l => { try { return JSON.parse(l) } catch { return null } })
  .filter(Boolean)

console.log(`🔵 Blue Agent 启动 — 分析 ${emails.length} 封邮件`)

// ── 共用工具 ──────────────────────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms))

// 安全 JSON 提取：兼容 markdown 代码块包裹
function safeParseJSON(raw, key) {
  try { const j = JSON.parse(raw); return key ? (j[key] || []) : j } catch (_) {}
  const m = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (m) try { const j = JSON.parse(m[1]); return key ? (j[key] || []) : j } catch (_) {}
  return key ? [] : null
}

// ── System Prompt ─────────────────────────────────────────────────────────────
const knownList = [...knownTerms].slice(0, 200).join(', ') // 防止 prompt 过长

const SYSTEM_PROMPT = `Jesteś ekspertem ds. lokalizacji języka polskiego i chińskiego w branży urządzeń AGD.
Twoje zadanie: z podanych e-maili klientów wyodrębnij NOWE terminy techniczne, które NIE ZNAJDUJĄ SIĘ w bazie terminologicznej.

Istniejące znane terminy (IGNORUJ TE): ${knownList || '(brak)'}

Wyodrębnij tylko:
1. Nazwy części sprzętowych odkurzacza (np. nazwy potoczne, skróty, regionalizmy)
2. Kody błędów lub komunikaty aplikacji
3. Specyficzne polskie określenia/slangi branżowe

Odpowiedz TYLKO w formacie JSON:
{
  "terms": [
    {
      "pl_term": "polskie słowo/fraza",
      "zh_suggestion": "推测的中文翻译",
      "context": "zdanie z e-maila, gdzie to słowo wystąpiło",
      "confidence": 0.0-1.0
    }
  ]
}`

// 指数退避重试（最多 3 次，1s / 2s / 4s）
async function callLLM(messages, attempt = 0) {
  const MAX = 3
  const payload = JSON.stringify({ model: MODEL, messages, temperature: 0.2, response_format: { type: 'json_object' } })
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.deepseek.com', path: '/v1/chat/completions', method: 'POST',
      timeout: 60000,
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${API_KEY}`, 'Content-Length': Buffer.byteLength(payload) }
    }, (res) => {
      let data = ''
      res.on('data', c => data += c)
      res.on('end', async () => {
        if (res.statusCode === 429 && attempt < MAX) {
          const wait = Math.pow(2, attempt) * 1000
          console.warn(`  [429] 限流，${wait/1000}s 后重试...`)
          await sleep(wait); resolve(await callLLM(messages, attempt + 1)); return
        }
        try {
          const j = JSON.parse(data)
          if (j.error) throw new Error(j.error.message)
          resolve(j.choices?.[0]?.message?.content || '{}')
        } catch (e) {
          if (attempt < MAX) { await sleep(Math.pow(2, attempt) * 1000); resolve(await callLLM(messages, attempt + 1)) }
          else reject(e)
        }
      })
    })
    req.on('error', async (err) => {
      if (attempt < MAX) {
        console.warn(`  [网络错误] ${err.message}，${Math.pow(2,attempt)}s 后重试...`)
        await sleep(Math.pow(2, attempt) * 1000); resolve(await callLLM(messages, attempt + 1))
      } else reject(err)
    })
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
    req.write(payload); req.end()
  })
}

// ── 写入 pending_glossary（防重复）──────────────────────────────────────────────────────
function saveToDb(terms, sourceEmail) {
  try {
    const Database = require(path.join(__dirname, '../polskiej-chinese-src/node_modules/better-sqlite3'))
    const db = new Database(DB_PATH)
    db.prepare(`CREATE TABLE IF NOT EXISTS pending_glossary (
      id INTEGER PRIMARY KEY AUTOINCREMENT, pl_term TEXT NOT NULL UNIQUE,
      zh_suggestion TEXT DEFAULT '', context TEXT DEFAULT '',
      source_email TEXT DEFAULT '', confidence REAL DEFAULT 0,
      verdict TEXT DEFAULT 'pending', created_at TEXT DEFAULT (datetime('now'))
    )`).run()
    // INSERT OR IGNORE: pl_term 加 UNIQUE 约束，自动干除重复入库
    const stmt = db.prepare(
      "INSERT OR IGNORE INTO pending_glossary (pl_term, zh_suggestion, context, source_email, confidence) VALUES (?, ?, ?, ?, ?)"
    )
    const batch = db.transaction((rows) => {
      for (const t of rows) {
        if (knownTerms.has(t.pl_term?.toLowerCase())) continue
        stmt.run(t.pl_term, t.zh_suggestion || '', t.context || '', sourceEmail || '', t.confidence ?? 0.5)
      }
    })
    batch(terms)
  } catch (e) { console.warn(`  ⚠ 写入 DB 失败: ${e.message}`) }
}

// ── 主流程 ────────────────────────────────────────────────────────────────────
async function main() {
  const BATCH = 5
  const allTerms = []

  for (let i = 0; i < emails.length; i += BATCH) {
    const batch = emails.slice(i, i + BATCH)
    const emailText = batch.map((e, n) =>
      `=== EMAIL ${i+n+1} ===\n${e.body}`
    ).join('\n\n')

    process.stdout.write(`[${i}/${emails.length}] 分析第 ${i+1}~${Math.min(i+BATCH, emails.length)} 封...`)
    try {
      const raw = await callLLM([
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: emailText }
      ])
      const terms = safeParseJSON(raw, 'terms')
      const valid = terms.filter(t => t.pl_term && (t.confidence ?? 0.5) >= 0.4)
      allTerms.push(...valid)
      saveToDb(valid, batch[0]?.subject || '')
      console.log(` ✓ 提取 ${valid.length} 个 OOV 新词`)
    } catch (e) {
      console.log(` ⚠ 失败: ${e.message}，跳过`)
    }

    if (i + BATCH < emails.length) await sleep(2000)
  }

  // 去重（按 pl_term 合并，保留最高 confidence）
  const deduped = Object.values(
    allTerms.reduce((acc, t) => {
      const key = t.pl_term.toLowerCase()
      if (!acc[key] || acc[key].confidence < t.confidence) acc[key] = t
      return acc
    }, {})
  )

  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true })
  fs.writeFileSync(OUTPUT, JSON.stringify(deduped, null, 2), 'utf8')

  console.log(`\n✅ Blue Agent 完成！`)
  console.log(`   提取 OOV 术语: ${deduped.length} 个（去重后）`)
  console.log(`   已写入 pending_glossary 表 → 请在应用「对抗训练」→「待审术语」中审核`)
  console.log(`   JSON 报告: ${OUTPUT}`)
}

main().catch(e => { console.error('❌', e.message); process.exit(1) })
