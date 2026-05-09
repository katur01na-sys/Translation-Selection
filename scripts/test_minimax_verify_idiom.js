/**
 * test_minimax_verify_idiom.js
 * 测试目标：验证 aganVerifyIdiom 流程对 pgItems 格式的词组数据是否能正确调用 MiniMax 并做模糊匹配
 *
 * 使用方法：
 *   MINIMAX_KEY="你的密钥" node test_minimax_verify_idiom.js
 */

const https = require('https');
const assert = require('assert');

const MINIMAX_KEY = process.env.MINIMAX_KEY || '';
if (!MINIMAX_KEY) {
  console.error('错误: 请设置环境变量 MINIMAX_KEY');
  console.error('示例: MINIMAX_KEY="sk-xxx" node test_minimax_verify_idiom.js');
  process.exit(1);
}

// pgItems 格式的模拟数据（和 pending_glossary 字段一致）
const pgItems = [
  { id: 1, zh_suggestion: '画龙点睛', pl_term: 'dodać ostatni szlif' },
  { id: 2, zh_suggestion: 'yyds',     pl_term: 'absolutny mistrz' },
  { id: 3, zh_suggestion: '走马观花', pl_term: 'powierzchownie zapoznać się z czymś' },
  { id: 4, zh_suggestion: '对牛弹琴', pl_term: 'mówić do ściany' },
  { id: 5, zh_suggestion: '破防了',   pl_term: 'trafiło mnie' },
];

function aiRequest(hostname, urlPath, body) {
  return new Promise((resolve, reject) => {
    const apiKey = (body._apiKey || '').trim();
    const sendBody = { ...body };
    delete sendBody._apiKey;
    const data = JSON.stringify(sendBody);
    const options = {
      hostname, path: urlPath, method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(data)
      }
    };
    const req = https.request(options, res => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => { try { resolve(JSON.parse(buf)); } catch (e) { reject(new Error('JSON parse failed: ' + buf.slice(0, 200))); } });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// 完全复制 main.js 里的 aganVerifyIdiom 逻辑
async function verifyIdiom(items) {
  const results = [];
  for (const item of items) {
    if (!item.zh_suggestion || !item.pl_term) {
      results.push({ id: item.id, match: null, minimaxSuggestion: '' });
      continue;
    }
    try {
      const body = {
        _apiKey: MINIMAX_KEY,
        model: 'MiniMax-M2.5-lightning',
        messages: [
          { role: 'system', content: '你是波兰语文化等价表达专家。只输出最地道的波兰语表达，不超过8个词，不要解释。' },
          { role: 'user', content: `中文成语/俚语「${item.zh_suggestion}」在波兰语中最地道的文化等价表达是什么？` }
        ],
        temperature: 0.2
      };
      const json = await aiRequest('api.minimax.chat', '/v1/chat/completions', body);
      const suggestion = (json.choices?.[0]?.message?.content || '').trim().replace(/[\"'。，.]/g, '');
      const a = suggestion.toLowerCase(), b = item.pl_term.toLowerCase();
      const match = a.includes(b) || b.includes(a) || a.split(' ').some(w => w.length > 3 && b.includes(w));
      results.push({ id: item.id, match, minimaxSuggestion: suggestion });
      console.log(`[${match ? '✅一致' : '⚠️ 不同'}] ZH:「${item.zh_suggestion}」 我们的PL:「${item.pl_term}」 MiniMax建议:「${suggestion}」`);
    } catch (e) {
      results.push({ id: item.id, match: null, minimaxSuggestion: '', error: e.message });
      console.error(`[❌错误] id=${item.id} ${e.message}`);
    }
  }
  return { success: true, results };
}

async function run() {
  console.log(`\n=== MiniMax 词组验证测试 (${pgItems.length} 条) ===\n`);
  const res = await verifyIdiom(pgItems);

  console.log('\n--- 汇总 ---');
  const matched = res.results.filter(r => r.match === true).length;
  const mismatched = res.results.filter(r => r.match === false).length;
  const failed = res.results.filter(r => r.match === null).length;
  console.log(`一致: ${matched} / 不同: ${mismatched} / 失败: ${failed} / 共: ${pgItems.length}`);

  // 断言：所有请求都应该成功返回（不崩溃）
  assert.strictEqual(failed, 0, `有 ${failed} 条请求失败，检查网络或 API key`);
  assert.ok(matched > 0, '至少应有 1 条匹配');
  console.log('\n✅ 测试通过：MiniMax 验证流程可正常工作');
}

run().catch(e => { console.error('\n测试运行失败:', e); process.exit(1); });
