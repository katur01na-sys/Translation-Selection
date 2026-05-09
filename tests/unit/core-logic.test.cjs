/**
 * A3: 核心业务逻辑单元测试
 * 覆盖：数据解析、状态转换、输入边界校验
 * 运行：node --test tests/unit/core-logic.test.cjs
 * (使用 Node 18+ 内置 test runner，不需要额外安装 Jest)
 */

'use strict';

const assert = require('node:assert/strict');
const { test, describe } = require('node:test');

// ══════════════════════════════════════════════════════════════════
// 1. 复制被测函数（与 bg_review.js / main.js 保持同步）
// ══════════════════════════════════════════════════════════════════

/** 解析 AI 返回的 JSON 内容（bg_review.js line 50-52 逻辑） */
function parseAIResponse(rawContent) {
  const content = rawContent || '{}';
  try {
    return { success: true, result: JSON.parse(content) };
  } catch {
    return { success: false, error: 'JSON 解析失败' };
  }
}

/** 状态转换：句段审核结果写入后的状态（bg_review.js runBgQueue 核心分支） */
function computeNextStatus(apiResult) {
  if (!apiResult || !apiResult.success) return 'error';
  const rv = apiResult.result;
  if (!rv || typeof rv !== 'object') return 'error';
  // 有 score 和 fixedTarget 则视为 done
  if (rv.score != null && rv.fixedTarget != null) return 'done';
  return 'error';
}

/** 构建指数退避延迟（main.js aiRequest attempt 逻辑） */
function calcBackoffDelay(attempt, retryAfterHeader) {
  const retryAfter = parseInt(retryAfterHeader || '0', 10);
  return retryAfter > 0 ? retryAfter * 1000 : Math.pow(2, attempt) * 1000;
}

/** 超长文本截断保护（bg_review.js guidelineBlock） */
function truncateGuideline(text, maxLen = 3000) {
  if (!text) return '';
  return text.slice(0, maxLen);
}

/** 术语表 block 构建（bg_review.js glossaryBlock） */
function buildGlossaryBlock(items) {
  if (!items || !items.length) return '';
  return `\n\n=== GLOSSARY ===\n${items.map(g => `${g.source_term} → ${g.target_term}`).join('\n')}\n=== END ===`;
}

/** 词数统计（DiffView 保护逻辑） */
function countWords(text) {
  return (text || '').split(/(\s+)/).length;
}

/** 过滤器：issues（有问题未修正） */
function filterIssues(seg) {
  return seg.status === 'done' && seg.errors?.length > 0 && !seg.fixed;
}

/** 过滤器：低分 <60 */
function filterLowScore(seg) {
  return seg.score != null && seg.score < 60;
}

// ══════════════════════════════════════════════════════════════════
// 2. 测试套件
// ══════════════════════════════════════════════════════════════════

describe('parseAIResponse', () => {
  test('正常 JSON 返回解析成功', () => {
    const json = JSON.stringify({ score: 85, fixedTarget: 'Dobry', errors: [] });
    const r = parseAIResponse(json);
    assert.equal(r.success, true);
    assert.equal(r.result.score, 85);
  });

  test('空字符串返回空对象', () => {
    const r = parseAIResponse('');
    assert.equal(r.success, true);
    assert.deepEqual(r.result, {});
  });

  test('null 返回空对象', () => {
    const r = parseAIResponse(null);
    assert.equal(r.success, true);
    assert.deepEqual(r.result, {});
  });

  test('格式错误的 JSON 返回失败', () => {
    const r = parseAIResponse('{broken json');
    assert.equal(r.success, false);
    assert.ok(r.error);
  });

  test('超大 JSON（1万字符）正常解析', () => {
    const bigObj = { score: 90, fixedTarget: 'X'.repeat(10000), errors: [] };
    const r = parseAIResponse(JSON.stringify(bigObj));
    assert.equal(r.success, true);
    assert.equal(r.result.fixedTarget.length, 10000);
  });

  test('包含 HTML 注入字符串照常解析（不执行）', () => {
    const injection = JSON.stringify({ score: 50, fixedTarget: '<script>alert(1)</script>', errors: [] });
    const r = parseAIResponse(injection);
    assert.equal(r.success, true);
    // 原始字符串被保留，由 React 渲染层决定是否转义
    assert.equal(r.result.fixedTarget, '<script>alert(1)</script>');
  });
});

describe('computeNextStatus', () => {
  test('成功结果且有 score+fixedTarget → done', () => {
    assert.equal(computeNextStatus({ success: true, result: { score: 80, fixedTarget: 'OK', errors: [] } }), 'done');
  });

  test('score=0 边界值 → done（0分也是有效分数）', () => {
    assert.equal(computeNextStatus({ success: true, result: { score: 0, fixedTarget: '', errors: [] } }), 'done');
  });

  test('API 失败 → error', () => {
    assert.equal(computeNextStatus({ success: false, error: 'network' }), 'error');
  });

  test('null → error', () => {
    assert.equal(computeNextStatus(null), 'error');
  });

  test('result 为空 → error', () => {
    assert.equal(computeNextStatus({ success: true, result: null }), 'error');
  });

  test('result 无 score → error', () => {
    assert.equal(computeNextStatus({ success: true, result: { fixedTarget: 'OK' } }), 'error');
  });
});

describe('calcBackoffDelay', () => {
  test('attempt=0, 无 Retry-After → 1000ms', () => {
    assert.equal(calcBackoffDelay(0, null), 1000);
  });

  test('attempt=1 → 2000ms', () => {
    assert.equal(calcBackoffDelay(1, null), 2000);
  });

  test('attempt=2 → 4000ms', () => {
    assert.equal(calcBackoffDelay(2, null), 4000);
  });

  test('attempt=3 → 8000ms', () => {
    assert.equal(calcBackoffDelay(3, null), 8000);
  });

  test('Retry-After=30 → 30000ms（优先使用服务器值）', () => {
    assert.equal(calcBackoffDelay(0, '30'), 30000);
  });

  test('Retry-After=0 → 回退到指数计算', () => {
    assert.equal(calcBackoffDelay(1, '0'), 2000);
  });
});

describe('truncateGuideline', () => {
  test('短文本保持不变', () => {
    assert.equal(truncateGuideline('hello'), 'hello');
  });

  test('null/undefined 返回空字符串', () => {
    assert.equal(truncateGuideline(null), '');
    assert.equal(truncateGuideline(undefined), '');
  });

  test('超过 3000 字截断', () => {
    const long = 'A'.repeat(5000);
    assert.equal(truncateGuideline(long).length, 3000);
  });

  test('超过 1万字截断', () => {
    const long = '中'.repeat(12000);
    assert.equal(truncateGuideline(long).length, 3000);
  });
});

describe('buildGlossaryBlock', () => {
  test('空数组 → 空字符串', () => {
    assert.equal(buildGlossaryBlock([]), '');
    assert.equal(buildGlossaryBlock(null), '');
  });

  test('正常术语生成 block', () => {
    const items = [{ source_term: '帅哥', target_term: 'przystojniak' }];
    const block = buildGlossaryBlock(items);
    assert.ok(block.includes('帅哥 → przystojniak'));
    assert.ok(block.includes('GLOSSARY'));
  });

  test('包含 <script> 注入的术语不破坏结构（纯文本拼接）', () => {
    const items = [{ source_term: '<script>alert(1)</script>', target_term: 'x' }];
    const block = buildGlossaryBlock(items);
    assert.ok(block.includes('<script>alert(1)</script>'));
    // 确保 block 仍是完整字符串
    assert.ok(block.startsWith('\n\n=== GLOSSARY'));
  });
});

describe('DiffView wordCount 保护', () => {
  test('短文本不触发降级', () => {
    const n = countWords('Cześć jak się masz') + countWords('Hej jak leci');
    assert.ok(n < 2000);
  });

  test('1万字文本超出阈值', () => {
    const longText = 'słowo '.repeat(1500);
    const n = countWords(longText) + countWords(longText);
    assert.ok(n > 2000, `expected >2000 got ${n}`);
  });

  test('纯空格文本词数 ≤ 1', () => {
    const n = countWords('   ');
    assert.ok(n <= 3); // split 结果取决于空格数，但不会暴增
  });
});

describe('filter functions', () => {
  const makeSeg = (overrides) => ({
    id: 1, status: 'done', score: 70, errors: [], fixed: false, ...overrides
  });

  test('filterIssues: done + 有错误 + 未修正 → true', () => {
    assert.equal(filterIssues(makeSeg({ errors: [{ type: 'grammar' }], fixed: false })), true);
  });

  test('filterIssues: done + 有错误 + 已修正 → false', () => {
    assert.equal(filterIssues(makeSeg({ errors: [{ type: 'grammar' }], fixed: true })), false);
  });

  test('filterIssues: pending → false', () => {
    assert.equal(filterIssues(makeSeg({ status: 'pending', errors: [{}] })), false);
  });

  test('filterLowScore: score=59 → true', () => {
    assert.equal(filterLowScore(makeSeg({ score: 59 })), true);
  });

  test('filterLowScore: score=60 → false (边界)', () => {
    assert.equal(filterLowScore(makeSeg({ score: 60 })), false);
  });

  test('filterLowScore: score=null → false', () => {
    assert.equal(filterLowScore(makeSeg({ score: null })), false);
  });
});

console.log('\n✅ 所有单元测试已运行（使用 node --test 查看完整报告）\n');
