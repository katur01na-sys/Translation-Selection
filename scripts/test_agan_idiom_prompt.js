const https = require('https');

// 请替换为你的真实 API Key (这里可以从配置读取，或者直接贴入测试用)
const fs = require('fs');
let apiKey = '';
try {
  const settingsStr = fs.readFileSync('/Users/wangyijun/Desktop/波兰语助手/polskiej-chinese-src/db/settings.json', 'utf8');
  const settings = JSON.parse(settingsStr);
  apiKey = settings.apiKey;
} catch (e) {
  console.error('无法读取 apiKey:', e);
  process.exit(1);
}

function aiRequest(hostname, urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const options = {
      hostname,
      path: urlPath,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${body._apiKey}`
      }
    };
    delete body._apiKey;

    const req = https.request(options, res => {
      let resData = '';
      res.on('data', chunk => resData += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(resData));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.write(JSON.stringify(body));
    req.end();
  });
}

async function testIdiomPrompt() {
  const n = 5;
  const hasIdiom = true;
  const isCleanIdiom = true; // sourceType === 'normal' && hasIdiom

  const IDIOM_POOL = `【可选的中文高难度表达】
成语：画龙点睛、走马观花、对牛弹琴、半途而废、马到成功、一石二鸟、火上浇油、亡羊补牢、破釜沉舟、杯水车薪、叶公好龙、按图索骥、起死回生、设身处地
网络梗/俚语：绝了、芭比Q了、yyds（永远的神）、躺平、内卷、打工人、摸鱼、社恐、破防了、整活、绷不住、草、遥遥领先、拿捏了、打摆子、u1、证明了、比比皆知
口语/感叹：我去了（惊讶语气词）、哇塞、牛批、秀、下头、上头、硬控、抽象、典中典、抄作业、火辣辣、集大成者
歇后语/俗语：三个臭皮匠顶个诸葛亮、半路杀出个程咬金、竹篮打水一场空、姜太公钓鱼愿者上钩`;

  const system = `你是中波双语术语表采集工具，专注于中文成语、俚语、网络梗、口语的波兰语文化等价词组。只输出词组/短语对，不要生成完整句子。`;

  const idiomNote = `
${IDIOM_POOL}

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
`;

  const user = `请生成 ${n} 组中波词组/短语对（不要完整句子），每组包含一个中文成语/俚语/网络梗/口语及其波兰语文化等价表达。
${idiomNote}
严格按照以下 JSON 数组格式输出，不要有任何其他文字：
[{"source":"中文词组","target":"波兰语等价词组","error_type":"vocab","domain":"idiom","pl_term":"波兰语等价词组","zh_term":"中文词组"}]`;

  console.log("正在发送请求到 DeepSeek...");
  try {
    const json = await aiRequest('api.deepseek.com', '/v1/chat/completions', {
      _apiKey: apiKey,
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ],
      temperature: 0.8
    });

    const raw = json.choices?.[0]?.message?.content || '[]';
    console.log("\n--- AI 原始返回 ---");
    console.log(raw);
    
    const match = raw.match(/\[[\s\S]*\]/);
    if (match) {
      const items = JSON.parse(match[0]);
      console.log("\n--- 解析成功，共", items.length, "条 ---");
      console.table(items.map(item => ({ source: item.source, target: item.target })));
    } else {
      console.error("\n无法从返回中解析 JSON 数组");
    }
  } catch (e) {
    console.error("请求失败:", e);
  }
}

testIdiomPrompt();
