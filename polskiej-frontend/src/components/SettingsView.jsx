import { useState, useEffect } from 'react'

const S = {
  card: { background: 'var(--surface-container-lowest)', borderRadius: '16px', border: '1px solid var(--surface-container)', overflow: 'hidden', marginBottom: 20 },
  cardHeader: { padding: '18px 28px', borderBottom: '1px solid var(--surface-container)', fontSize: '14px', fontWeight: 700, color: 'var(--on-surface)', display: 'flex', alignItems: 'center', gap: 10, background: 'var(--surface-container-low)' },
  row: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 28px', borderBottom: '1px solid var(--surface-container)' },
  rowLabel: { fontSize: '14px', fontWeight: 600, color: 'var(--on-surface)', marginBottom: 3 },
  rowDesc: { fontSize: '12px', color: 'var(--on-surface-variant)' },
  input: { background: 'var(--surface-container-low)', border: 'none', borderRadius: '8px', color: 'var(--on-surface)', padding: '10px 14px', fontSize: '13px', outline: 'none', transition: 'all 0.2s' },
}

function ProjectSettingsCard({ api, toast }) {
  const [projects, setProjects] = useState([])
  const [selId, setSelId] = useState(null)
  const [cfg, setCfg] = useState({ speakerGender: 'auto', globalContext: '', customPrompt: '' })
  const [dirty, setDirty] = useState(false)

  useEffect(() => { api.dbListProjects().then(r => { if (r.success && r.projects?.length) { setProjects(r.projects); setSelId(r.projects[0].id) } }) }, [])

  useEffect(() => {
    if (!selId) return
    api.dbGetProjectSettings(selId).then(r => { if (r.success) { setCfg({ speakerGender: r.speakerGender, globalContext: r.globalContext, customPrompt: r.customPrompt }); setDirty(false) } })
  }, [selId])

  function update(key, val) { setCfg(c => ({ ...c, [key]: val })); setDirty(true) }

  async function save() {
    if (!selId) return
    const r = await api.dbSaveProjectSettings({ projectId: selId, ...cfg })
    if (r.success) { toast('项目设置已保存', 'success'); setDirty(false) } else toast(r.error, 'error')
  }

  const selProject = projects.find(p => p.id === selId)

  return (
    <div style={S.card}>
      <div style={{ ...S.cardHeader, justifyContent: 'space-between' }}>
        <span>项目翻译配置</span>
        {dirty && <button onClick={save} style={{ background: 'var(--tertiary)', color: '#fff', border: 'none', borderRadius: 8, padding: '6px 18px', fontWeight: 700, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>保存</button>}
      </div>

      {/* 项目选择器 */}
      <div style={S.row}>
        <div>
          <div style={S.rowLabel}>选择项目</div>
          <div style={S.rowDesc}>每个项目可独立配置性别、背景和审核指令</div>
        </div>
        <select style={{ ...S.input, width: 280 }} value={selId || ''} onChange={e => setSelId(Number(e.target.value))}>
          {projects.map(p => <option key={p.id} value={p.id}>{p.project_name || p.file_path?.split('/').pop() || `项目 #${p.id}`}</option>)}
        </select>
      </div>

      {selId && <>
        {/* 性别 */}
        <div style={S.row}>
          <div>
            <div style={S.rowLabel}>主讲人性别</div>
            <div style={S.rowDesc}>波兰语动词和形容词的变格与性别相关（如：zrobiłem vs zrobiłam）</div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {[{ v: 'auto', l: '自动推断' }, { v: 'male', l: '男性（阳性）' }, { v: 'female', l: '女性（阴性）' }].map(({ v, l }) => (
              <button key={v} onClick={() => update('speakerGender', v)} style={{
                background: cfg.speakerGender === v ? 'var(--on-surface)' : 'var(--surface-container-low)',
                color: cfg.speakerGender === v ? '#fff' : 'var(--on-surface-variant)',
                border: 'none', borderRadius: 8, padding: '10px 18px', fontWeight: 600, fontSize: 13, cursor: 'pointer', transition: 'all 0.2s', fontFamily: 'inherit'
              }}>{l}</button>
            ))}
          </div>
        </div>

        {/* 背景 */}
        <div style={{ ...S.row, flexDirection: 'column', alignItems: 'flex-start', gap: 12 }}>
          <div>
            <div style={S.rowLabel}>全局剧本背景（注入 AI 提示词）</div>
            <div style={S.rowDesc}>填写剧情简介、角色关系、人名表等信息，AI 审核时将自动参考</div>
          </div>
          <textarea value={cfg.globalContext} onChange={e => update('globalContext', e.target.value)}
            placeholder="例如：本剧为现代都市言情短剧，主角为林晓薇（女，21岁）和顾瑜晨（男，28岁）..."
            style={{ ...S.input, width: '100%', minHeight: 120, resize: 'vertical', lineHeight: 1.7, fontSize: 13 }} />
        </div>

        {/* 提示词 */}
        <div style={{ ...S.row, borderBottom: 'none', flexDirection: 'column', alignItems: 'flex-start', gap: 12 }}>
          <div>
            <div style={S.rowLabel}>附加审核指令（高级）</div>
            <div style={S.rowDesc}>追加到 AI 系统提示词末尾，精细控制审核侧重点（留空使用默认指令）</div>
          </div>
          <textarea value={cfg.customPrompt} onChange={e => update('customPrompt', e.target.value)}
            placeholder="例如：请特别关注网络流行语的本地化是否得当，以及波兰语惯用表达是否自然..."
            style={{ ...S.input, width: '100%', minHeight: 100, resize: 'vertical', lineHeight: 1.7, fontSize: 13 }} />
        </div>
      </>}

      {!projects.length && (
        <div style={{ padding: '24px 28px', color: 'var(--outline)', fontSize: 13, textAlign: 'center' }}>
          暂无项目，请先在「项目资料库」导入文件
        </div>
      )}
    </div>
  )
}

export default function SettingsView({ api, toast, settings, setSettings, theme, setTheme, projects: parentProjects }) {
  const [keyInput, setKeyInput] = useState('')
  const [keyLoaded, setKeyLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null)
  const [guidelinePath, setGuidelinePath] = useState('')
  const [guidelineText, setGuidelineText] = useState('')

  useEffect(() => {
    api.getApiKey(settings.apiModel).then(r => {
      if (r?.success && r.key) { setKeyInput(r.key); setKeyLoaded(true) }
    })
  }, [settings.apiModel])

  async function saveKey() {
    if (!keyInput.trim()) { toast('请输入有效的接口密钥', 'error'); return }
    setSaving(true)
    const res = await api.storeApiKey({ provider: settings.apiModel, key: keyInput.trim() })
    // 同步保存供应商偏好，确保重启后恢复
    await api.setAppPref('apiModel', settings.apiModel)
    await api.setAppPref('modelName', settings.modelName || '')
    await api.setAppPref('sourceLang', settings.sourceLang || 'Chinese')
    await api.setAppPref('targetLang', settings.targetLang || 'Polish')
    setSaving(false)
    if (res.success) {
      setSettings(s => ({ ...s, apiKey: keyInput.trim() }))
      toast('接口密钥已加密安全保存', 'success')
    } else toast(res.error, 'error')
  }

  async function pickGuideline() {
    const path = await api.openFileDialog('guideline')
    if (!path) return
    setGuidelinePath(path)
    const res = await api.parseGuidelineFile(path)
    if (res.success) { setGuidelineText(res.text); toast(`已解析规范文档：${res.fileName}`, 'success') }
    else toast(res.error, 'error')
  }

  const MODEL_OPTIONS = [
    { value: 'deepseek', label: '深度求索（推荐）', host: 'api.deepseek.com' },
    { value: 'qwen',     label: '通义千问（阿里云）', host: 'dashscope.aliyuncs.com' },
    { value: 'minimax',  label: 'MiniMax（弦鸣科技）', host: 'api.minimax.chat' },
  ]
  const DEEPSEEK_MODELS = [
    { value: 'deepseek-v4-flash', label: 'DeepSeek-V4-Flash（快速版）' },
    { value: 'deepseek-v4-pro',   label: 'DeepSeek-V4-Pro（旗舰版）' },
    { value: 'deepseek-chat',     label: 'deepseek-chat（旧版兼容）' },
  ]
  const MINIMAX_MODELS = [
    { value: 'MiniMax-Text-01', label: 'MiniMax-Text-01（旗舰版）' },
    { value: 'MiniMax-M1',     label: 'MiniMax-M1（推理增强）' },
    { value: 'abab6.5s-chat',  label: 'abab6.5s（快速版）' },
    { value: 'abab5.5s-chat',  label: 'abab5.5s（经济版）' },
  ]
  const LANG_OPTIONS = [
    { value: 'Chinese',  label: '中文 → 波兰语' },
    { value: 'English',  label: '英文 → 波兰语' },
  ]

  return (
    <div style={{ overflowY: "auto", padding: "40px 48px 80px", flex: 1 }}>
    <div style={{ maxWidth: 720, margin: '0 auto', paddingBottom: 80 }}>
      <div style={{ textAlign: 'center', padding: '24px 0 40px' }}>
        <h1 style={{ fontSize: '2.2rem', fontWeight: 800, color: 'var(--on-surface)', marginBottom: 8 }}>系统设置</h1>
        <p style={{ fontSize: '1rem', color: 'var(--on-surface-variant)' }}>配置审核模型、接口密钥及翻译规范文档</p>
      </div>

      {/* AI 模型配置 */}
      <div style={S.card}>
        <div style={S.cardHeader}>智能模型配置</div>

        <div style={S.row}>
          <div>
            <div style={S.rowLabel}>智能服务商</div>
            <div style={S.rowDesc}>选择用于翻译质量审核的大语言模型</div>
          </div>
          <select style={{ ...S.input, width: 240 }} value={settings.apiModel}
            onChange={e => { setSettings(s => ({ ...s, apiModel: e.target.value, apiKey: '', modelName: '' })); setKeyInput(''); setKeyLoaded(false) }}>
            {MODEL_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>

        {settings.apiModel === 'deepseek' && (
          <div style={S.row}>
            <div>
              <div style={S.rowLabel}>DeepSeek 模型版本</div>
              <div style={S.rowDesc}>V4-Flash 性价比高（0.2元/百万输入），V4-Pro 旗舰推理（1元/百万输入）</div>
            </div>
            <select style={{ ...S.input, width: 240 }}
              value={settings.modelName || 'deepseek-v4-flash'}
              onChange={e => setSettings(s => ({ ...s, modelName: e.target.value }))}>
              {DEEPSEEK_MODELS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        )}

        {settings.apiModel === 'minimax' && (
          <div style={S.row}>
            <div>
              <div style={S.rowLabel}>MiniMax 模型版本</div>
              <div style={S.rowDesc}>选择具体的 MiniMax 模型（旗舰版对应 Text-01，推理增强对应 M1）</div>
            </div>
            <select style={{ ...S.input, width: 240 }}
              value={settings.modelName || 'MiniMax-Text-01'}
              onChange={e => setSettings(s => ({ ...s, modelName: e.target.value }))}>
              {MINIMAX_MODELS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        )}

        <div style={S.row}>
          <div>
            <div style={S.rowLabel}>接口密钥</div>
            <div style={S.rowDesc}>密钥使用系统级加密存储，不会明文保存</div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="password"
              placeholder={keyLoaded ? '已保存（点击可修改）' : '请输入接口密钥...'}
              value={keyInput} onChange={e => setKeyInput(e.target.value)}
              style={{ ...S.input, width: 260 }}
            />
            <button onClick={saveKey} disabled={saving} style={{
              background: 'var(--tertiary)', color: '#fff', border: 'none', borderRadius: '8px',
              padding: '10px 20px', fontWeight: 700, fontSize: '13px', cursor: saving ? 'not-allowed' : 'pointer', fontFamily: 'inherit'
            }}>
              {saving ? '保存中...' : '保存'}
            </button>
            <button onClick={async () => {
              setTesting(true); setTestResult(null)
              const r = await api.testApiConnection({ apiModel: settings.apiModel, modelName: settings.modelName || '' })
              setTestResult(r); setTesting(false)
            }} disabled={testing} style={{
              background: testing ? 'var(--surface-container)' : 'var(--surface-container-low)',
              color: testing ? 'var(--outline)' : 'var(--on-surface)', border: '1px solid var(--surface-container)',
              borderRadius: '8px', padding: '10px 16px', fontWeight: 600, fontSize: '13px',
              cursor: testing ? 'not-allowed' : 'pointer', fontFamily: 'inherit'
            }}>
              {testing ? '测试中...' : '测试连接'}
            </button>
          </div>
          {testResult && (
            <div style={{ marginTop: 10, padding: '10px 14px', borderRadius: 8, fontSize: 12, lineHeight: 1.7, fontFamily: 'var(--font-mono)',
              background: testResult.success ? 'rgba(0,93,187,0.06)' : 'rgba(159,64,61,0.06)',
              border: `1px solid ${testResult.success ? 'rgba(0,93,187,0.2)' : 'rgba(159,64,61,0.2)'}`,
              color: testResult.success ? 'var(--tertiary)' : 'var(--error)'
            }}>
              {testResult.success
                ? `✓ ${testResult.message}`
                : `✗ ${testResult.error}`
              }
            </div>
          )}
        </div>

        <div style={{ ...S.row }}>
          <div>
            <div style={S.rowLabel}>AGAN 每日生成上限</div>
            <div style={S.rowDesc}>对抗训练每天最多调用 AI 生成接口的次数（防止 API 费用超支）</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="number" min={1} max={200} style={{ ...S.input, width: 80, textAlign: 'center' }}
              value={settings.aganDailyLimit ?? 20}
              onChange={e => setSettings(s => ({ ...s, aganDailyLimit: Number(e.target.value) }))}
            />
            <button onClick={async () => {
              await api.setAppPref('aganDailyLimit', String(settings.aganDailyLimit ?? 20))
              toast(`已设置每日上限为 ${settings.aganDailyLimit} 次`, 'success')
            }} style={{ background: 'var(--tertiary)', color: '#fff', border: 'none', borderRadius: '8px', padding: '10px 16px', fontWeight: 700, fontSize: '13px', cursor: 'pointer', fontFamily: 'inherit' }}>
              保存
            </button>
          </div>
        </div>

        <div style={{ ...S.row, borderBottom: 'none' }}>
          <div>
            <div style={S.rowLabel}>源语言</div>
            <div style={S.rowDesc}>翻译文件中原文所使用的语言</div>
          </div>
          <select style={{ ...S.input, width: 200 }} value={settings.sourceLang}
            onChange={e => setSettings(s => ({ ...s, sourceLang: e.target.value }))}
          >
            {LANG_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      </div>

      {/* 🔑 项目级翻译配置（性别+背景+提示词） */}
      <ProjectSettingsCard api={api} toast={toast} settings={settings} setSettings={setSettings} />

      {/* 翻译规范文档 */}
      <div style={S.card}>
        <div style={S.cardHeader}>翻译规范文档</div>

        <div style={{ ...S.row, borderBottom: guidelinePath ? '1px solid var(--surface-container)' : 'none' }}>
          <div>
            <div style={S.rowLabel}>上传规范文件</div>
            <div style={S.rowDesc}>支持 PDF、Word (.docx)，内容将注入 AI 审核 Prompt，约束审核标准</div>
          </div>
          <button onClick={pickGuideline} style={{
            background: 'var(--surface-container)', color: 'var(--on-surface)', border: 'none',
            borderRadius: '8px', padding: '10px 20px', fontWeight: 600, fontSize: '13px', cursor: 'pointer', fontFamily: 'inherit'
          }}>
            选择文件
          </button>
        </div>

        {guidelinePath && (
          <div style={{ padding: '20px 28px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: '12px', color: 'var(--outline)', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{guidelinePath}</div>
            <textarea
              value={guidelineText} onChange={e => setGuidelineText(e.target.value)}
              style={{ ...S.input, minHeight: 140, fontSize: 12, resize: 'vertical', lineHeight: 1.65 }}
              placeholder="规范文档内容将在此显示..."
            />
          </div>
        )}
      </div>

      {/* B1: 界面主题 */}
      <div style={S.card}>
        <div style={S.cardHeader}>界面主题</div>
        <div style={S.row}>
          <div>
            <div style={S.rowLabel}>显示模式</div>
            <div style={S.rowDesc}>选择亮色、暗色或跟随系统设置</div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {[['light', '亮色'], ['dark', '暗色'], ['system', '跟随系统']].map(([v, l]) => (
              <button key={v} onClick={() => setTheme(v)} style={{
                border: 'none', borderRadius: 8, padding: '7px 16px', fontSize: 12, fontWeight: 700,
                cursor: 'pointer', fontFamily: 'inherit',
                background: theme === v ? 'var(--tertiary)' : 'var(--surface-container-low)',
                color: theme === v ? '#fff' : 'var(--on-surface-variant)'
              }}>{l}</button>
            ))}
          </div>
        </div>
      </div>

      {/* 关于 */}
      <div style={S.card}>
        <div style={S.cardHeader}>关于本软件</div>
        <div style={S.row}>
          <div>
            <div style={S.rowLabel}>中波 LQA Pro</div>
            <div style={S.rowDesc}>中文 → 波兰语 智能翻译质量审核桌面工具</div>
          </div>
        </div>
        <div style={S.row}>
          <div>
            <div style={S.rowLabel}>核心功能</div>
            <div style={S.rowDesc}>接口密钥加密存储 · 批量并发审核 · 多维度质量分析 · 术语表管理 · 翻译记忆库 · 审核历史 · 表格导出</div>
          </div>
        </div>
        <div style={{ ...S.row, borderBottom: 'none' }}>
          <div>
            <div style={S.rowLabel}>诊断日志</div>
            <div style={S.rowDesc}>导出最近 7 天的应用日志文件，用于排查问题</div>
          </div>
          <button onClick={async () => {
            const r = await api.exportDiagnosticLog?.()
            if (r?.success) toast(`日志已导出到 ${r.filePath.split('/').pop()}`, 'success')
            else if (r?.error !== 'Cancelled') toast(r?.error || '导出失败', 'error')
          }} style={{
            background: 'var(--surface-container)', color: 'var(--on-surface)', border: 'none',
            borderRadius: '8px', padding: '10px 20px', fontWeight: 600, fontSize: '13px', cursor: 'pointer', fontFamily: 'inherit'
          }}>
            导出日志
          </button>
        </div>
      </div>
    </div>
    </div>
  )
}
