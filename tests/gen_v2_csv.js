const fs = require('fs');
const path = require('path');
const rows = require('./gen_v2_data.js');

const BACKGROUND = `# 短剧背景：《血色克拉科夫》(Krwawa Przeszłość Krakowa)
# 故事发生在波兰克拉科夫(Kraków)，讲述华裔女记者苏晓曼(Su Xiaoman / Xiao Su)
# 在波兰主流媒体Gazeta Wyborcza担任调查记者期间，
# 揭露克拉科夫市长科瓦尔奇克(Burmistrz Kowalczyk)的贪腐帝国。
# 涉及波兰黑帮Krakowska Grupa Przestępcza、跨国走私、
# 以及克拉科夫房地产市场洗钱案。
# 主要人物：
# 苏晓曼(女) - 华裔调查记者
# 市长科瓦尔奇克 Burmistrz Kowalczyk(男) - 贪腐主谋
# 副市长马利诺夫斯基 Wiceburmistrz Malinowski(男) - 帮凶
# 警察局长维什涅夫斯基 Komendant Wiśniewski(男) - 墙头草
# 检察官卡明斯基 Prokurator Kamiński(男) - 正义力量
# 法官诺瓦克 Sędzia Nowak(女) - 铁面法官
# 苏晓曼母亲 陈美华(女) - 担心女儿安危
# 线人约瑟夫 Józef(男) - 法院助理
# 助理记者安娜 Anna Kowalska(女)`;

// 验证数据
console.log(`数据行数: ${rows.length}`);
if (rows.length < 200) {
  console.error(`❌ 只有 ${rows.length} 行，需要 200 行！`);
  process.exit(1);
}

const BOM = '\uFEFF';
const header = 'Source,Target,Gender,难点标注';
const csvRows = rows.slice(0, 200).map(([source, gender, note]) => {
  const esc = s => `"${String(s || '').replace(/"/g, '""')}"`;
  return `${esc(source)},,${esc(gender)},${esc(note)}`;
});

const csv = BOM + BACKGROUND.split('\n').join('\n') + '\n' + header + '\n' + csvRows.join('\n') + '\n';
const outPath = path.join(__dirname, '短剧极限测试_血色克拉科夫_200条.csv');
fs.writeFileSync(outPath, csv, 'utf8');
console.log(`✅ 已生成: ${outPath}`);
console.log(`   共 ${rows.slice(0,200).length} 条（纯中文源文 + 空译文 + 性别 + 难点标注）`);
console.log(`   女性: ${rows.slice(0,200).filter(r=>r[1]==='female').length} 条`);
console.log(`   男性: ${rows.slice(0,200).filter(r=>r[1]==='male').length} 条`);
