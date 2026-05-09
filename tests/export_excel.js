const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');
const fs = require('fs');

const dbPath = path.join(os.homedir(), 'Library/Application Support/polish-chiny/ch-pl-lqa/lqa.db');
const db = new Database(dbPath, { readonly: true });

const rows = db.prepare('SELECT id, source, target, fixed_target, score, status, gender, errors, dimensions FROM segments ORDER BY id').all();

// 生成 CSV (Excel 兼容 UTF-8 BOM)
const BOM = '\uFEFF';
const header = ['序号', '源文(中文)', '翻译(波兰语)', 'AI修正译文', '质量评分', '状态', '性别', '问题类型', '问题详情', '一致性', '俚语', '网络用语', '时态', '准确性', '变位', '语法'];

const csvRows = rows.map((r, i) => {
  let errors = [];
  try { errors = typeof r.errors === 'string' ? JSON.parse(r.errors) : (r.errors || []); } catch {}
  let dims = {};
  try { dims = typeof r.dimensions === 'string' ? JSON.parse(r.dimensions) : (r.dimensions || {}); } catch {}

  const errTypes = errors.map(e => e.type).join('; ');
  const errDetails = errors.map(e => `${e.original} → ${e.suggested} (${e.explanation})`).join('; ');

  return [
    i + 1,
    r.source,
    r.target,
    r.fixed_target || '',
    r.score ?? '',
    r.status,
    r.gender === 'female' ? '女' : '男',
    errTypes,
    errDetails,
    dims.consistency || '',
    dims.slang || '',
    dims.internetSlang || '',
    dims.tense || '',
    dims.accuracy || '',
    dims.declension || '',
    dims.grammar || ''
  ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',');
});

const csv = BOM + header.join(',') + '\n' + csvRows.join('\n');
const outPath = path.join(os.homedir(), 'Desktop', '暗流涌动_200条翻译审核结果.csv');
fs.writeFileSync(outPath, csv, 'utf8');
console.log(`✅ 已导出到: ${outPath}`);
console.log(`   共 ${rows.length} 条`);
console.log(`   平均分: ${(rows.reduce((a, r) => a + (r.score || 0), 0) / rows.length).toFixed(1)}`);
console.log(`   满分(100): ${rows.filter(r => r.score === 100).length} 条`);
console.log(`   低分(<80): ${rows.filter(r => r.score < 80).length} 条`);

db.close();
