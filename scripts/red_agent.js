#!/usr/bin/env node
/**
 * scripts/red_agent.js — Layer 1: Red Agent（波兰客诉邮件生成器）
 *
 * 用法：
 *   node scripts/red_agent.js --count 20 --apiKey sk-xxx
 *   node scripts/red_agent.js --count 100 --maxBatches 5 --batchDelay 5 --apiKey sk-xxx
 *
 * 参数：
 *   --count        目标邮件总数（默认 20）
 *   --maxBatches   单次最多 API 调用次数（默认 20，防止费用失控）
 *   --batchDelay   每批调用间隔秒数（默认 3，防止 429）
 *   --output       输出文件路径
 * 输出：JSONL 格式，每行一封邮件。
 */

const https = require('https')
const fs    = require('fs')
const path  = require('path')

// ── CLI 参数解析 ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2)
function getArg(flag, def) {
  const i = args.indexOf(flag)
  return i !== -1 && args[i+1] ? args[i+1] : def
}
const COUNT       = parseInt(getArg('--count', '20'), 10)
const API_KEY     = getArg('--apiKey', process.env.DEEPSEEK_API_KEY || '')
const OUTPUT      = getArg('--output', path.join(__dirname, '../data/red_emails.jsonl'))
const MODEL       = getArg('--model', 'deepseek-chat')
const DOMAIN_ARG  = getArg('--domain', 'random')      // random | general | game | legal | emotion
const ERROR_ARG   = getArg('--errorType', 'random')   // random | 具体类型
const BATCH_DELAY = parseInt(getArg('--batchDelay', '3'), 10) * 1000
const MAX_BATCHES = parseInt(getArg('--maxBatches', '20'), 10)

if (!API_KEY) { console.error('❌ 请提供 --apiKey 或设置 DEEPSEEK_API_KEY 环境变量'); process.exit(1) }

// 确保输出目录存在
fs.mkdirSync(path.dirname(OUTPUT), { recursive: true })
const out = fs.createWriteStream(OUTPUT, { flags: 'a' })

// ── 领域、错误类型池（随机模式使用）──────────────────────────────────────
const DOMAINS = [
  { key: 'general', label: '日常生活', context: 'codzienne życie, zakupy, dom' },
  { key: 'game',    label: '游戏动作', context: 'gry, sport, wakacje' },
  { key: 'legal',   label: '法律合同', context: 'reklamacja formalna, prawo konsumenckie' },
  { key: 'emotion', label: '情感心理', context: 'frustracja emocjonalna, stres, rozczarowanie' },
]
const pick = arr => arr[Math.floor(Math.random() * arr.length)]
const pickDomain = () => DOMAIN_ARG === 'random' ? pick(DOMAINS) : (DOMAINS.find(d => d.key === DOMAIN_ARG) || DOMAINS[0])

// ── 客户情绪和硬件部件池 ───────────────────────────────────────────
const PERSONAS = [
  { mood: 'wściekły i wulgary',        plaint: 'odkurzacz nie jeździ, kable zawinięte' },
  { mood: 'sfrustrowany i sarkastyczny', plaint: 'mop nie myje, zostawia smugi' },
  { mood: 'zdenerwowany ale grzeczny',  plaint: 'Lidar nie widzi przeszkód, wpadł w schody' },
  { mood: 'zdesperoowany',              plaint: 'aplikacja ciągle się wylogowuje, brak połączenia' },
  { mood: 'ironiczny, pisze bardzo kolokwialnie', plaint: 'stacja dokładująca nie ładuje, miga na czerwono' },
]
const PARTS = ['Lidar', 'Mop', 'Stacja dokująca', 'Aplikacja', 'Ssanie', 'Filtr HEPA', 'Szczotka boczna']

const SYSTEM_PROMPT = `Jesteś generatorem realistycznych listów reklamacyjnych po polsku.
Generuj WYŁĄCZNIE w formacie JSON: {"emails": [ {"subject":"...","body":"...","domain":"...","error_type":"..."}, ... ]}
Każdy list MUSI:
- Być napisany naturalnym, potocznym językiem polskim z regionalnymi kolokwializmami
- Zawierać litówki i błędy ortograficzne (symulacja prawdziwego klienta)
- Być długi na 150-250 słów
- Dotyczyć odkurzacza robotycznego Dreame X50 Ultra
- Wskazać konkretny uszkodzony element sprzętowy`

function buildUserPrompt(batch) {
  return batch.map((p, i) => {
    const part   = PARTS[i % PARTS.length]
    const domain = pickDomain()
    return `Email ${i+1}: Klient jest ${p.mood}. Problem: ${p.plaint}. Uszkodzona część: ${part}. Kontekst: ${domain.context}. domain_key:${domain.key}.`
  }).join('\n')
}

// ── 共用工具 ──────────────────────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms))

// 安全 JSON 提取：兼容 markdown 代码块包裹
function safeParseJSON(raw, key) {
  try {
    const j = JSON.parse(raw)
    return key ? (j[key] || []) : j
  } catch (_) {
    // 尝试从 ```json...``` 中提取
    const m = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (m) try { const j = JSON.parse(m[1]); return key ? (j[key] || []) : j } catch (_) {}
    return key ? [] : null
  }
}

// 指数退避重试（最多 3 次，1s / 2s / 4s）
async function callLLM(messages, attempt = 0) {
  const MAX = 3
  const payload = JSON.stringify({
    model: MODEL, messages, temperature: 0.9,
    response_format: { type: 'json_object' }
  })
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.deepseek.com', path: '/v1/chat/completions', method: 'POST',
      timeout: 60000,
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${API_KEY}`, 'Content-Length': Buffer.byteLength(payload) }
    }, (res) => {
      let data = ''
      res.on('data', c => data += c)
      res.on('end', async () => {
        // 429: 退避重试
        if (res.statusCode === 429 && attempt < MAX) {
          const wait = Math.pow(2, attempt) * 1000
          console.warn(`  [429] 限流，${wait/1000}s 后重试 (${attempt+1}/${MAX})...`)
          await sleep(wait); resolve(await callLLM(messages, attempt + 1)); return
        }
        try {
          const j = JSON.parse(data)
          if (j.error) throw new Error(j.error.message)
          resolve(j.choices?.[0]?.message?.content || '')
        } catch (e) {
          if (attempt < MAX) {
            await sleep(Math.pow(2, attempt) * 1000)
            resolve(await callLLM(messages, attempt + 1))
          } else reject(e)
        }
      })
    })
    req.on('error', async (err) => {
      if (attempt < MAX) {
        const wait = Math.pow(2, attempt) * 1000
        console.warn(`  [网络错误] ${err.message}，${wait/1000}s 后重试...`)
        await sleep(wait); resolve(await callLLM(messages, attempt + 1))
      } else reject(err)
    })
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
    req.write(payload); req.end()
  })
}

// ── 断点续跑（Checkpoint）──────────────────────────────────────────────────────
const CHECKPOINT_FILE = OUTPUT + '.checkpoint.json'

function loadCheckpoint() {
  try { return JSON.parse(fs.readFileSync(CHECKPOINT_FILE, 'utf8')) } catch (_) { return { generated: 0 } }
}
function saveCheckpoint(generated) {
  fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify({ generated, ts: new Date().toISOString() }))
}
function clearCheckpoint() {
  try { fs.unlinkSync(CHECKPOINT_FILE) } catch (_) {}
}

// ── 主流程 ───────────────────────────────────────────────────────────────────
async function main() {
  const BATCH = 5
  const ckpt = loadCheckpoint()
  let generated = ckpt.generated
  let batchCount = 0

  if (generated > 0) console.log(`📌 从断点恢复：已有 ${generated} 封，继续生成...\n`)
  else console.log(`🔴 Red Agent 启动 — 目标 ${COUNT} 封 · 最大批数 ${MAX_BATCHES} · 间隔 ${BATCH_DELAY/1000}s\n`)

  while (generated < COUNT) {
    if (batchCount >= MAX_BATCHES) {
      console.log(`\n⛔ 已达单次最大批数 (${MAX_BATCHES})，停止。已生成 ${generated} 封。`)
      console.log(`   如需更多，增大 --maxBatches 或分次运行。`)
      break
    }
    const remaining = COUNT - generated
    const batchSize = Math.min(BATCH, remaining)
    const batch = PERSONAS.slice(0, batchSize)

    process.stdout.write(`[${generated}/${COUNT}] 生成第 ${generated+1}~${generated+batchSize} 封...`)
    try {
      const raw = await callLLM([
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: buildUserPrompt(batch) }
      ])
      const emails = safeParseJSON(raw, 'emails')
      if (!emails.length) throw new Error('LLM 返回空数组')

      for (const [i, e] of emails.entries()) {
        out.write(JSON.stringify({
          id: generated + i + 1,
          subject: e.subject || '',
          body: e.body || '',
          persona: batch[i]?.mood || '',
          part: PARTS[(generated + i) % PARTS.length],
          generated_at: new Date().toISOString()
        }) + '\n')
      }
      generated += emails.length
      saveCheckpoint(generated)   // ← 每批成功后保存断点
      console.log(` ✓ (${emails.length} 封，累计 ${generated})`)
    } catch (e) {
      console.log(` ⚠ 本批失败: ${e.message}，跳过`)
      generated += batchSize      // 跳过本批，继续下一批
      saveCheckpoint(generated)
    }
    batchCount++
    if (generated < COUNT && batchCount < MAX_BATCHES) await sleep(BATCH_DELAY)
  }

  out.end()
  clearCheckpoint()               // 完成后清除断点文件
  console.log(`\n✅ Red Agent 完成！共 ${generated} 封邮件写入: ${OUTPUT}`)
  console.log(`📌 下一步: node scripts/blue_agent.js --input ${OUTPUT} --apiKey <key>`)
}

main().catch(e => { console.error('❌', e.message); process.exit(1) })
