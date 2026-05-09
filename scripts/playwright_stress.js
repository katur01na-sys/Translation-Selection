#!/usr/bin/env node
/**
 * scripts/playwright_stress.js — Layer 2: 无头浏览器压测 + 崩溃监控
 *
 * 前置安装：
 *   npm install -D playwright
 *   npx playwright install chromium
 *
 * 用法：
 *   node scripts/playwright_stress.js --input data/red_emails.jsonl [--url http://localhost:5173]
 *
 * 功能：
 *   - 把 Red Agent 生成的邮件逐条粘贴到应用输入框
 *   - 点击"翻译"，等待结果
 *   - 若白屏/报错/超时 → 自动截图 + 记录"毒药邮件"
 *   - 最终输出 data/crash_report.json
 */

const fs   = require('fs')
const path = require('path')

// ── CLI 参数 ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2)
function getArg(f, d) { const i = args.indexOf(f); return i !== -1 && args[i+1] ? args[i+1] : d }

const INPUT  = getArg('--input',  path.join(__dirname, '../data/red_emails.jsonl'))
const URL    = getArg('--url',    'http://localhost:5173')
const SHOTS  = getArg('--shots',  path.join(__dirname, '../data/screenshots'))
const REPORT = path.join(__dirname, '../data/crash_report.json')

// 检查 playwright 是否安装
let playwright
try {
  playwright = require('playwright')
} catch (_) {
  console.error('❌ Playwright 未安装，请先运行：\n   npm install -D playwright && npx playwright install chromium')
  process.exit(1)
}

if (!fs.existsSync(INPUT)) {
  console.error(`❌ 找不到邮件文件: ${INPUT}\n   先运行: node scripts/red_agent.js`)
  process.exit(1)
}

const emails = fs.readFileSync(INPUT, 'utf8')
  .split('\n').filter(l => l.trim()).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)

fs.mkdirSync(SHOTS, { recursive: true })

const crashes = []

async function main() {
  const browser = await playwright.chromium.launch({ headless: true })
  const page    = await browser.newPage()

  // 监听控制台错误
  page.on('console', msg => { if (msg.type() === 'error') console.warn(`  [console.error] ${msg.text()}`) })
  page.on('pageerror', err => console.warn(`  [pageerror] ${err.message}`))

  await page.goto(URL, { timeout: 30000 })
  console.log(`🎭 Playwright 压测启动 — ${emails.length} 封邮件 → ${URL}\n`)

  for (const [i, email] of emails.entries()) {
    process.stdout.write(`[${i+1}/${emails.length}] ID=${email.id} "${email.subject?.slice(0, 30)}..."`)

    try {
      // 1. 找到源文本框（根据实际 UI 调整选择器）
      const textarea = await page.waitForSelector('textarea[placeholder*="源"], textarea[placeholder*="输入"], textarea', { timeout: 5000 })
      await textarea.fill(email.body)

      // 2. 点击翻译按钮
      const btn = await page.waitForSelector('button:has-text("翻译"), button:has-text("开始"), button[id*="translate"]', { timeout: 3000 })
      await btn.click()

      // 3. 等待结果（最多 30s）
      await page.waitForFunction(
        () => !document.querySelector('.loading, [data-loading="true"]'),
        { timeout: 30000 }
      )

      // 4. 检查是否白屏（body 内容为空或出现错误组件）
      const bodyText = await page.evaluate(() => document.body.innerText?.trim() || '')
      if (bodyText.length < 20) throw new Error('白屏检测：body 内容过少')

      console.log(' ✓')
    } catch (e) {
      console.log(` ❌ 崩溃: ${e.message}`)
      const shotFile = path.join(SHOTS, `crash_${i+1}_id${email.id}.png`)
      await page.screenshot({ path: shotFile, fullPage: true })
      crashes.push({ index: i+1, id: email.id, error: e.message, screenshot: shotFile, email_subject: email.subject, email_body: email.body.slice(0, 200) })

      // 尝试恢复（刷新页面）
      try { await page.reload({ timeout: 10000 }) } catch (_) {}
    }

    // 每 10 封暂停一下
    if ((i + 1) % 10 === 0) await new Promise(r => setTimeout(r, 1000))
  }

  await browser.close()

  fs.writeFileSync(REPORT, JSON.stringify({ total: emails.length, crashes: crashes.length, items: crashes }, null, 2))
  console.log(`\n✅ 压测完成`)
  console.log(`   总计: ${emails.length} 封  ·  崩溃: ${crashes.length} 封`)
  if (crashes.length > 0) {
    console.log(`   崩溃报告: ${REPORT}`)
    console.log(`   截图目录: ${SHOTS}`)
    console.log(`   ⚠ 将崩溃邮件交给 Blue Agent 重点分析`)
  }
}

main().catch(e => { console.error('❌', e.message); process.exit(1) })
