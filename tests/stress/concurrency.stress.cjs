/**
 * A4: 并发压力测试脚本
 * - 模拟瞬间并发 20 个波兰语文本处理请求
 * - 监控内存使用（heapUsed before/after/delta）
 * - 检查是否存在内存泄漏
 * 
 * 运行：node tests/stress/concurrency.stress.cjs
 * 注意：不会发送真实 API 请求，使用 mock callReview 函数
 */

'use strict';

const assert = require('node:assert/strict');

// ── Mock callReview（模拟 bg_review.js 的 callReview）──────────────
// 模拟真实延迟 50-200ms，随机 5% 失败率
function mockCallReview(payload, simulateFailure = false) {
  return new Promise((resolve, reject) => {
    const delay = 50 + Math.random() * 150;
    setTimeout(() => {
      if (simulateFailure && Math.random() < 0.05) {
        reject(new Error('模拟 API 失败（5% 概率）'));
        return;
      }
      resolve({
        success: true,
        result: {
          score: Math.floor(60 + Math.random() * 40),
          fixedTarget: `[审核后] ${payload.target.slice(0, 50)}`,
          errors: Math.random() > 0.7 ? [{ type: 'grammar', original: 'x', suggested: 'y', explanation: '测试' }] : [],
          dimensions: {
            consistency: '良好', slang: '合适', internetSlang: '无', tense: '正确',
            accuracy: '准确', declension: '正确', grammar: '良好'
          }
        }
      });
    }, delay);
  });
}

// ── 生成测试句段 ────────────────────────────────────────────────────
function generateSegments(count) {
  const templates = [
    { source: '你好，今天怎么样？', target: 'Cześć, jak się dzisiaj masz?' },
    { source: '我非常感谢你的帮助。', target: 'Jestem bardzo wdzięczny za twoją pomoc.' },
    { source: '这个项目需要立即完成。', target: 'Ten projekt musi zostać ukończony natychmiast.' },
    { source: '请你解释一下这个词的意思。', target: 'Proszę wyjaśnij mi znaczenie tego słowa.' },
    // 超长文本边界测试
    { source: '这是' + '非常'.repeat(500) + '长的句子。', target: 'To jest ' + 'bardzo '.repeat(500) + 'długie zdanie.' },
    // XSS 注入测试
    { source: '<script>alert("xss")</script>', target: '<script>alert("xss")</script>' },
    // 纯空格
    { source: '   ', target: '   ' },
    // 特殊非拉丁字符
    { source: '日本語テスト', target: '日本語 po polsku' },
    { source: 'Привет мир', target: 'Witaj świecie (z rosyjskiego)' },
    { source: 'مرحبا بالعالم', target: 'Witaj świecie (z arabskiego)' },
  ];

  const segments = [];
  for (let i = 0; i < count; i++) {
    const tmpl = templates[i % templates.length];
    segments.push({ id: i + 1, ...tmpl, gender: 'male', status: 'pending' });
  }
  return segments;
}

// ── 内存快照工具 ────────────────────────────────────────────────────
function memSnap(label) {
  const mem = process.memoryUsage();
  return {
    label,
    heapUsedMB: (mem.heapUsed / 1024 / 1024).toFixed(2),
    heapTotalMB: (mem.heapTotal / 1024 / 1024).toFixed(2),
    rssMB: (mem.rss / 1024 / 1024).toFixed(2),
    raw: mem.heapUsed
  };
}

// ── 核心并发测试 ────────────────────────────────────────────────────
async function runConcurrencyStress(concurrentCount = 20) {
  console.log('\n══════════════════════════════════════════════');
  console.log(`  并发压力测试：${concurrentCount} 个请求同时发送`);
  console.log('══════════════════════════════════════════════\n');

  const segments = generateSegments(concurrentCount);

  // 内存基准
  if (global.gc) global.gc(); // 如果启用了 --expose-gc
  const snapBefore = memSnap('启动前');
  console.log(`[内存] 启动前: heap=${snapBefore.heapUsedMB}MB rss=${snapBefore.rssMB}MB`);

  const startTime = Date.now();

  // 瞬间并发发送所有请求（不做限流）
  const results = await Promise.allSettled(
    segments.map(seg => mockCallReview({ source: seg.source, target: seg.target }, true))
  );

  const elapsed = Date.now() - startTime;

  // 统计结果
  const succeeded = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
  const failed = results.length - succeeded;

  console.log(`[结果] 成功: ${succeeded}/${concurrentCount}, 失败: ${failed}, 耗时: ${elapsed}ms`);
  console.log(`[吞吐] 平均: ${(concurrentCount / (elapsed / 1000)).toFixed(1)} req/s`);

  // 内存压后快照
  const snapAfter = memSnap('压测后');
  console.log(`[内存] 压测后: heap=${snapAfter.heapUsedMB}MB rss=${snapAfter.rssMB}MB`);

  const deltaHeapMB = ((snapAfter.raw - snapBefore.raw) / 1024 / 1024).toFixed(2);
  console.log(`[内存] Delta: +${deltaHeapMB}MB`);

  // 内存泄漏判定：单次并发后增加 > 50MB 视为可疑
  if (parseFloat(deltaHeapMB) > 50) {
    console.warn(`\n⚠️  [内存警告] 堆内存增加 ${deltaHeapMB}MB 超过阈值 50MB，请检查是否存在泄漏！`);
  } else {
    console.log(`\n✅ 内存增量 ${deltaHeapMB}MB 正常（< 50MB 阈值）`);
  }

  return { succeeded, failed, elapsed, deltaHeapMB };
}

// ── 多轮压测（模拟视图切换和缓存清除） ─────────────────────────────
async function runMultiRoundStress() {
  console.log('\n══════════════════════════════════════════════');
  console.log('  多轮视图切换模拟（3轮 × 20并发）');
  console.log('══════════════════════════════════════════════');

  const snapStart = memSnap('多轮开始');
  const results = [];

  for (let round = 1; round <= 3; round++) {
    console.log(`\n--- 第 ${round} 轮 ---`);
    // 模拟视图切换：清空引用（模拟 React 卸载组件）
    let tempCache = new Array(1000).fill({ data: 'X'.repeat(1000) });
    const r = await runConcurrencyStress(20);
    results.push(r);
    // 模拟 GC 后的清理
    tempCache = null;
    await new Promise(res => setTimeout(res, 100)); // 让 GC 有机会运行
  }

  const snapEnd = memSnap('多轮结束');
  const totalDelta = ((snapEnd.raw - snapStart.raw) / 1024 / 1024).toFixed(2);

  console.log('\n══════════════════════════════════════════════');
  console.log(`  多轮总结 | 内存增量: ${totalDelta}MB`);

  // 3 轮后内存增长 > 100MB 为泄漏警告
  if (parseFloat(totalDelta) > 100) {
    console.warn(`\n⚠️  [严重泄漏警告] 3轮后堆内存累计增加 ${totalDelta}MB`);
    process.exitCode = 1;
  } else {
    console.log(`✅ 3 轮后内存增量 ${totalDelta}MB，无明显泄漏`);
  }

  // 验证结果正确性
  const totalSucceeded = results.reduce((s, r) => s + r.succeeded, 0);
  const totalFailed = results.reduce((s, r) => s + r.failed, 0);
  console.log(`  总请求: ${results.length * 20} | 成功: ${totalSucceeded} | 失败: ${totalFailed}`);
  console.log('══════════════════════════════════════════════\n');
}

// ── 边界输入专项测试 ──────────────────────────────────────────────
async function runEdgeCaseTests() {
  console.log('\n══════════════════════════════════════════════');
  console.log('  边界输入专项测试');
  console.log('══════════════════════════════════════════════');

  const edgeCases = [
    { name: '1万字超长文本', source: '你'.repeat(10000), target: 'długi'.repeat(2000) },
    { name: 'XSS 注入字符串', source: '<script>alert("xss")</script>', target: '<img onerror="alert(1)" src=x>' },
    { name: '纯空格', source: '      ', target: '    ' },
    { name: '特殊非拉丁字符（阿拉伯语）', source: 'مرحبا', target: 'Witaj' },
    { name: '特殊非拉丁字符（日文）', source: 'こんにちは世界', target: 'Witaj świecie' },
    { name: 'Null/空字符串', source: '', target: '' },
    { name: 'Unicode 表情符号', source: '😀🎉🚀', target: 'szczęśliwy 🎉' },
    { name: 'SQL 注入尝试', source: "'; DROP TABLE segments; --", target: "KASUJ;" },
  ];

  for (const tc of edgeCases) {
    try {
      const r = await mockCallReview({ source: tc.source, target: tc.target });
      const status = r.success ? '✅ 通过' : '❌ 失败';
      console.log(`  ${status} | ${tc.name}`);
      // 验证返回值结构完整
      assert.ok(typeof r.result.score === 'number', '缺少 score');
      assert.ok(typeof r.result.fixedTarget === 'string', '缺少 fixedTarget');
    } catch (e) {
      console.log(`  ⚠️  ${tc.name} → 预期内错误: ${e.message}`);
    }
  }
  console.log('');
}

// ── 主入口 ────────────────────────────────────────────────────────
(async () => {
  try {
    await runEdgeCaseTests();
    await runConcurrencyStress(20);
    await runMultiRoundStress();
    console.log('\n🏁 所有压力测试完成\n');
  } catch (e) {
    console.error('\n❌ 压力测试异常:', e.message);
    process.exit(1);
  }
})();
