const assert = require('assert');

function buildPrompt(n, domain, sourceType, hasIdiom) {
  const isCleanIdiom = sourceType === 'normal' && hasIdiom;

  const system = isCleanIdiom
    ? `你是中波双语术语表采集工具，专注于中文成语、俚语、网络梗、口语的波兰语文化等价词组。只输出词组/短语对，不要生成完整句子。`
    : hasIdiom
    ? `你是中波双语语料采集工具，专注于中文成语、俚语、网络梗和口语的波兰语文化等价表达。`
    : `你是一个专业的中波翻译测试数据生成工具。`;

  const idiomNote = hasIdiom ? `
【词组采集模式】规则：
1. 从上方表达池中选取成语/俚语/梗/口语
2. source 字段填中文词组原词（如"走马观花"、"yyds"、"我去"），不要写完整句子
3. target 字段填波兰语文化等价词组/短语（词根形式），不要写完整句子
4. 示例：
   - source:"画龙点睛" → target:"dodać ostatni szlif"
   - source:"yyds" → target:"absolutny mistrz"
   - source:"走马观花" → target:"powierzchownie zapoznać się z czymś"
   - source:"对牛弹琴" → target:"mówić do ściany"
   - source:"破防了" → target:"trafiło mnie"
   - source:"我去" → target:"o rany!"
5. pl_term = target, zh_term = source
6. error_type 填 "vocab"，domain 填 "idiom"
` : '';

  const user = isCleanIdiom
    ? `请生成 ${n} 组中波词组/短语对（不要完整句子），每组包含一个中文成语/俚语/网络梗/口语及其波兰语文化等价表达。
${idiomNote}
严格按照以下 JSON 数组格式输出，不要有任何其他文字：
[{"source":"中文词组","target":"波兰语等价词组","error_type":"vocab","domain":"idiom","pl_term":"波兰语等价词组","zh_term":"中文词组"}]`
    : `请严格按照下方清单，逐条生成 ${n} 条测试句段`;

  return { system, user };
}

console.log("测试 1: 非对抗行 (sourceType='normal') + 成语/俚语 (hasIdiom=true)");
const prompt1 = buildPrompt(10, 'idiom', 'normal', true);
console.log("System Prompt:");
console.log(prompt1.system);
console.log("User Prompt:");
console.log(prompt1.user);
assert.ok(prompt1.system.includes("不要生成完整句子"));
assert.ok(prompt1.user.includes("中文词组"));
console.log("-> 测试 1 通过！\n");

console.log("测试 2: 对抗行 (sourceType='adversarial') + 成语/俚语 (hasIdiom=true)");
const prompt2 = buildPrompt(10, 'idiom', 'adversarial', true);
console.log("System Prompt:");
console.log(prompt2.system);
assert.ok(prompt2.system.includes("文化等价表达"));
assert.ok(prompt2.user.includes("测试句段"));
console.log("-> 测试 2 通过！\n");

console.log("所有 Prompt 逻辑测试均通过。");
