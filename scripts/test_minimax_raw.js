const https = require('https');

const MINIMAX_KEY = process.env.MINIMAX_KEY || '';

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
      res.on('end', () => { try { resolve(JSON.parse(buf)); } catch (e) { reject(new Error('JSON parse failed: ' + buf.slice(0, 500))); } });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function run() {
  const body = {
    _apiKey: MINIMAX_KEY,
    model: 'MiniMax-Text-01',
    messages: [
      { role: 'system', content: '你是波兰语文化等价表达专家。只输出最地道的波兰语表达，不超过8个词，不要解释。' },
      { role: 'user', content: '中文成语/俚语「画龙点睛」在波兰语中最地道的文化等价表达是什么？' }
    ],
    temperature: 0.2
  };
  console.log('发送请求...');
  const json = await aiRequest('api.minimax.chat', '/v1/chat/completions', body);
  console.log('原始响应:');
  console.log(JSON.stringify(json, null, 2));
  console.log('\nchoices[0].message.content:', json.choices?.[0]?.message?.content);
}

run().catch(e => { console.error('失败:', e); });
