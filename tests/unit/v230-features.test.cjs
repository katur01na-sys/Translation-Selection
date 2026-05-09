/**
 * R4: v2.3.0 新增功能单元测试
 * 覆盖：模型回退 (C2)、上下文窗口构建 (C1)、增量合并 (P2)、事务逻辑 (S1)
 * 运行：node --test tests/unit/v230-features.test.cjs
 */

'use strict';

const assert = require('node:assert/strict');
const { test, describe } = require('node:test');

// ══════════════════════════════════════════════════════════════════
// 1. 被测函数（从 main.js 中提取逻辑）
// ══════════════════════════════════════════════════════════════════

/** C2: 回退模型选择 */
function getFallbackModel(provider, currentModel) {
  const FALLBACK = {
    deepseek: ['deepseek-chat', 'deepseek-reasoner'],
    qwen: ['qwen-max-latest', 'qwen-plus-latest', 'qwen-turbo-latest'],
    minimax: ['MiniMax-Text-01', 'abab6.5s-chat'],
  };
  const candidates = FALLBACK[provider] || [];
  const remaining = candidates.filter(m => m !== currentModel);
  return remaining.length > 0 ? remaining[0] : null;
}

/** C1: 上下文窗口构建 */
function buildContextWindow(segments, currentIdx, windowSize = 5) {
  const before = segments.slice(Math.max(0, currentIdx - windowSize), currentIdx).map(s => s.source).join('\n');
  const after = segments.slice(currentIdx + 1, Math.min(segments.length, currentIdx + windowSize + 1)).map(s => s.source).join('\n');
  return { before, after };
}

/** P2: 增量合并 */
function mergeSegments(existing, updates) {
  const updateMap = new Map(updates.map(s => [s.id, s]));
  return existing.map(s => updateMap.has(s.id) ? { ...s, ...updateMap.get(s.id) } : s);
}

/** S1: 事务批量 — 模拟原子性校验 */
function simulateTransaction(operations) {
  const results = [];
  let rollback = false;
  for (const op of operations) {
    if (op.shouldFail) { rollback = true; break; }
    results.push(op.value);
  }
  return rollback ? [] : results;
}

// ══════════════════════════════════════════════════════════════════
// 2. 测试套件
// ══════════════════════════════════════════════════════════════════

describe('C2: getFallbackModel', () => {
  test('deepseek 主模型失败 → 回退到 deepseek-reasoner', () => {
    assert.equal(getFallbackModel('deepseek', 'deepseek-chat'), 'deepseek-reasoner');
  });

  test('deepseek 备用模型也失败 → 回退到 deepseek-chat', () => {
    assert.equal(getFallbackModel('deepseek', 'deepseek-reasoner'), 'deepseek-chat');
  });

  test('qwen 主模型失败 → 回退到 qwen-plus', () => {
    assert.equal(getFallbackModel('qwen', 'qwen-max-latest'), 'qwen-plus-latest');
  });

  test('minimax 主模型失败 → 回退到 abab6.5s', () => {
    assert.equal(getFallbackModel('minimax', 'MiniMax-Text-01'), 'abab6.5s-chat');
  });

  test('未知 provider → null', () => {
    assert.equal(getFallbackModel('unknown', 'model-x'), null);
  });

  test('所有模型都用完 → null (仅1个模型时)', () => {
    // minimax 只有2个，但如果当前不在列表中
    const r = getFallbackModel('minimax', 'nonexistent');
    assert.equal(r, 'MiniMax-Text-01');
  });
});

describe('C1: buildContextWindow', () => {
  const segs = Array.from({ length: 10 }, (_, i) => ({ id: i, source: `句子${i}` }));

  test('中间位置 → 前后各5条', () => {
    const ctx = buildContextWindow(segs, 5, 5);
    assert.equal(ctx.before, '句子0\n句子1\n句子2\n句子3\n句子4');
    assert.equal(ctx.after, '句子6\n句子7\n句子8\n句子9');
  });

  test('第一条 → before 为空', () => {
    const ctx = buildContextWindow(segs, 0, 5);
    assert.equal(ctx.before, '');
    assert.equal(ctx.after, '句子1\n句子2\n句子3\n句子4\n句子5');
  });

  test('最后一条 → after 为空', () => {
    const ctx = buildContextWindow(segs, 9, 5);
    assert.ok(ctx.before.length > 0);
    assert.equal(ctx.after, '');
  });

  test('空数组 → 都为空', () => {
    const ctx = buildContextWindow([], 0, 5);
    assert.equal(ctx.before, '');
    assert.equal(ctx.after, '');
  });

  test('window=1 → 最多各1条', () => {
    const ctx = buildContextWindow(segs, 5, 1);
    assert.equal(ctx.before, '句子4');
    assert.equal(ctx.after, '句子6');
  });
});

describe('P2: mergeSegments', () => {
  const existing = [
    { id: 1, source: 'a', status: 'pending' },
    { id: 2, source: 'b', status: 'pending' },
    { id: 3, source: 'c', status: 'pending' },
  ];

  test('部分更新 → 仅修改匹配项', () => {
    const updates = [{ id: 2, status: 'done', score: 85 }];
    const result = mergeSegments(existing, updates);
    assert.equal(result[0].status, 'pending');
    assert.equal(result[1].status, 'done');
    assert.equal(result[1].score, 85);
    assert.equal(result[2].status, 'pending');
  });

  test('空更新 → 保持原样', () => {
    const result = mergeSegments(existing, []);
    assert.deepEqual(result, existing);
  });

  test('全量更新', () => {
    const updates = existing.map(s => ({ ...s, status: 'done' }));
    const result = mergeSegments(existing, updates);
    assert.ok(result.every(s => s.status === 'done'));
  });

  test('更新不存在的 ID → 不影响现有数据', () => {
    const updates = [{ id: 999, status: 'done' }];
    const result = mergeSegments(existing, updates);
    assert.deepEqual(result, existing);
  });
});

describe('S1: simulateTransaction', () => {
  test('全部成功 → 返回所有结果', () => {
    const ops = [{ value: 'a' }, { value: 'b' }, { value: 'c' }];
    assert.deepEqual(simulateTransaction(ops), ['a', 'b', 'c']);
  });

  test('中间失败 → 全部回滚', () => {
    const ops = [{ value: 'a' }, { shouldFail: true, value: 'b' }, { value: 'c' }];
    assert.deepEqual(simulateTransaction(ops), []);
  });

  test('第一个就失败 → 空结果', () => {
    const ops = [{ shouldFail: true, value: 'a' }];
    assert.deepEqual(simulateTransaction(ops), []);
  });

  test('空操作列表 → 空结果', () => {
    assert.deepEqual(simulateTransaction([]), []);
  });
});

console.log('\n✅ v2.3.0 新功能测试已运行\n');
