import { useState, useEffect, useCallback, useRef } from 'react'
import { taskStore } from '../taskStore'
import { emit } from '../eventBus'

const api = window.electronAPI

const DOMAINS = [
  { value: 'random', label: '随机' }, { value: 'general', label: '日常' },
  { value: 'game', label: '游戏' }, { value: 'legal', label: '法律' },
  { value: 'emotion', label: '情感' }, { value: 'idiom', label: '成语/俚语' },
]
const ERROR_TYPES = [
  { value: 'random', label: '随机' }, { value: 'gender', label: '性别格' },
  { value: 'tense', label: '时态' }, { value: 'declension', label: '名词格' },
  { value: 'vocab', label: '词汇偏差' },
]

function PreviewCard({ item, auditResult, auditProviderLabel, onDelete, onImport, onEditChange }) {
  const ds = auditResult?.ds
  const mm = auditResult?.mm
  const dsColor = ds == null ? 'var(--outline)' : ds >= 80 ? '#10b981' : ds >= 60 ? '#f59e0b' : '#ef4444'
  const [editing, setEditing] = useState(false)
  const [editZh, setEditZh] = useState(item.source)
  const [editPl, setEditPl] = useState(item.x4_final || item.target)
  const handleZhChange = (e) => { setEditZh(e.target.value); onEditChange?.(item.id, e.target.value, editPl) }
  const handlePlChange = (e) => { setEditPl(e.target.value); onEditChange?.(item.id, editZh, e.target.value) }
  const handleDone = async () => {
    setEditing(false)
    onEditChange?.(item.id, editZh, editPl)
    if (item.isPg) {
      await api.pgUpdate?.({ id: item.originalId, pl_term: editPl, zh_suggestion: editZh })
    } else {
      await api.aganUpdate?.({ id: item.id, source: editZh, target: editPl })
    }
  }
  const [showDetail, setShowDetail] = useState(false)

  // 评审结果解析：新格式 { pass, score, explanation, advice, minimaxSuggestion }
  // 兼容旧格式 { match, minimaxSuggestion, divergeReason }
  const hasReview = mm != null
  const score = mm?.score != null ? mm.score : (mm?.match === true ? 95 : mm?.match === false ? 50 : null)
  const pass = mm?.pass != null ? mm.pass : mm?.match === true
  const scoreColor = score == null ? 'var(--outline)' : score >= 90 ? '#10b981' : score >= 70 ? '#f59e0b' : '#ef4444'
  const scoreLabel = score == null ? '' : score >= 90 ? '通过' : '建议改进'

  return (
    <div style={{ background: 'var(--surface-container-lowest)', border: '1px solid var(--surface-container)', borderRadius: 10, padding: '10px 12px', marginBottom: 6, fontSize: 12 }}>
      <div style={{ display: 'flex', gap: 5, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 10, color: 'var(--outline)' }}>#{item.id}</span>
        {item.domain && <span style={{ fontSize: 9, background: 'rgba(168,85,247,0.1)', color: '#a855f7', borderRadius: 20, padding: '1px 6px', fontWeight: 700 }}>{item.domain}</span>}
        {item.error_type && item.error_type !== 'none' && <span style={{ fontSize: 9, background: 'var(--surface-container)', color: 'var(--on-surface-variant)', borderRadius: 20, padding: '1px 6px' }}>{item.error_type}</span>}
        {item.isPg && <span style={{ fontSize: 9, background: 'rgba(16,185,129,0.1)', color: '#10b981', borderRadius: 20, padding: '1px 6px', fontWeight: 700 }}>术语</span>}
        {ds != null && <span style={{ fontSize: 9, fontWeight: 700, color: dsColor, background: 'var(--surface-container-low)', borderRadius: 20, padding: '1px 6px' }}>DS {ds}</span>}
        {hasReview && score != null && (
          <span
            onClick={() => setShowDetail(v => !v)}
            style={{ fontSize: 9, fontWeight: 700, color: scoreColor, background: scoreColor + '18', borderRadius: 20, padding: '1px 8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3 }}
          >
            {scoreLabel} {score}分 {showDetail ? '▲' : '▼'}
          </span>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 4, alignItems: 'center' }}>
          <button onClick={editing ? handleDone : () => setEditing(true)} style={{ background: editing ? 'rgba(59,130,246,0.1)' : 'transparent', border: '1px solid ' + (editing ? '#3b82f6' : 'var(--surface-container-high)'), color: editing ? '#3b82f6' : 'var(--outline)', borderRadius: 6, padding: '1px 7px', fontSize: 10, cursor: 'pointer', fontWeight: 700 }}>{editing ? '完成' : '编辑'}</button>
          {item.isPg && <button onClick={() => onImport(item, editZh, editPl)} style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)', color: '#10b981', borderRadius: 6, padding: '1px 7px', fontSize: 10, cursor: 'pointer', fontWeight: 700 }}>导入</button>}
          <button onClick={() => onDelete(item.id, item.isPg)} style={{ background: 'transparent', border: 'none', color: 'var(--outline)', cursor: 'pointer', fontSize: 12, padding: '0 3px', lineHeight: 1 }}>✕</button>
        </div>
      </div>

      {showDetail && hasReview && (
        <div style={{ marginBottom: 8, padding: '8px 10px', background: 'var(--surface-container-low)', border: `1px solid ${scoreColor}30`, borderRadius: 8, fontSize: 10, lineHeight: 1.8 }}>
          {mm.explanation && (
            <div style={{ marginBottom: 4 }}>
              <span style={{ fontWeight: 800, color: 'var(--on-surface-variant)' }}>📝 评审：</span>
              <span style={{ color: 'var(--on-surface)' }}>{mm.explanation}</span>
            </div>
          )}
          {mm.minimaxSuggestion && (
            <div style={{ marginBottom: 4 }}>
              <span style={{ fontWeight: 800, color: '#3b82f6' }}>{auditProviderLabel || '审核'} 建议：</span>
              <code style={{ background: 'rgba(59,130,246,0.08)', padding: '1px 5px', borderRadius: 4, color: '#3b82f6', fontSize: 10 }}>{mm.minimaxSuggestion}</code>
            </div>
          )}
          {!pass && mm.advice && (
            <div>
              <span style={{ fontWeight: 800, color: '#f59e0b' }}>⚠️ 改进建议：</span>
              <span style={{ color: 'var(--on-surface)' }}>{mm.advice}</span>
            </div>
          )}
          {pass && !mm.advice && (
            <div style={{ color: '#10b981', fontWeight: 700 }}>✅ 语义等价，原译可接受</div>
          )}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        <div style={{ background: 'rgba(239,68,68,0.04)', border: '1px solid rgba(239,68,68,0.1)', borderRadius: 6, padding: '6px 8px', fontSize: 11, lineHeight: 1.5 }}>
          <div style={{ fontSize: 9, fontWeight: 800, color: '#ef4444', marginBottom: 3, textTransform: 'uppercase' }}>ZH</div>
          {editing ? <input value={editZh} onChange={handleZhChange} style={{ width: '100%', background: 'transparent', border: 'none', borderBottom: '1px solid rgba(239,68,68,0.3)', outline: 'none', fontSize: 11, color: 'var(--on-surface)', fontFamily: 'inherit', padding: '1px 0' }} /> : editZh}
        </div>
        <div style={{ background: 'rgba(59,130,246,0.04)', border: '1px solid rgba(59,130,246,0.1)', borderRadius: 6, padding: '6px 8px', fontSize: 11, lineHeight: 1.5, fontFamily: 'var(--font-mono)' }}>
          <div style={{ fontSize: 9, fontWeight: 800, color: '#3b82f6', marginBottom: 3, textTransform: 'uppercase' }}>PL</div>
          {editing ? <input value={editPl} onChange={handlePlChange} style={{ width: '100%', background: 'transparent', border: 'none', borderBottom: '1px solid rgba(59,130,246,0.3)', outline: 'none', fontSize: 11, color: 'var(--on-surface)', fontFamily: 'var(--font-mono)', padding: '1px 0' }} /> : (item.x4_final || editPl)}
        </div>
      </div>
    </div>
  )
}

const MODEL_PROVIDERS = [
  { value: 'deepseek', label: '深度求索' },
  { value: 'minimax',  label: 'MiniMax' },
  { value: 'qwen',     label: '通义千问' },
]
const SUB_MODELS = {
  deepseek: [
    { value: 'deepseek-v4-flash', label: 'DeepSeek-V4-Flash' },
    { value: 'deepseek-v4-pro',   label: 'DeepSeek-V4-Pro' },
    { value: 'deepseek-chat',     label: 'deepseek-chat' },
  ],
  minimax: [
    { value: 'MiniMax-Text-01', label: 'MiniMax-Text-01' },
    { value: 'MiniMax-M1',     label: 'MiniMax-M1' },
    { value: 'abab6.5s-chat',  label: 'abab6.5s' },
    { value: 'abab5.5s-chat',  label: 'abab5.5s' },
  ],
  qwen: [
    { value: 'qwen-max', label: 'Qwen-Max' },
  ],
}

export default function AganView({ toast, settings, isVisible }) {
  const [advOpts, setAdvOpts] = useState({ domain: 'random', errorType: 'random', count: 10 })
  const [norOpts, setNorOpts] = useState({ domain: 'random', count: 10 })
  const [generatingAdv, setGeneratingAdv] = useState(false)
  const [generatingNor, setGeneratingNor] = useState(false)
  const [advProgress, setAdvProgress] = useState({ done: 0, total: 0 })
  const [norProgress, setNorProgress] = useState({ done: 0, total: 0 })
  const stopAdvRef = useRef(false)
  const stopNorRef = useRef(false)
  const mountedRef = useRef(true)

  const [advItems, setAdvItems] = useState([])
  const [advAudit, setAdvAudit] = useState({ on: false, pct: 0, results: {} })
  const [advPgItems, setAdvPgItems] = useState([])
  const [norItems, setNorItems] = useState([])
  const [norAudit, setNorAudit] = useState({ on: false, pct: 0, results: {} })
  const [norPgItems, setNorPgItems] = useState([])
  const [stats, setStats] = useState(null)
  const [glossaryCache, setGlossaryCache] = useState([])
  const extractingRef = useRef(false)
  const editsMapRef = useRef({})
  const x2x4MapRef = useRef({})

  // 页面级模型配置（独立于全局设置）
  const [genProvider, setGenProvider] = useState('deepseek')
  const [genModelName, setGenModelName] = useState('deepseek-v4-flash')
  const [auditProvider, setAuditProvider] = useState('deepseek')
  const [auditModelName, setAuditModelName] = useState('deepseek-v4-flash')

  // 加载持久化的模型偏好（校验旧值是否仍在可选列表内）
  useEffect(() => {
    Promise.all([
      api.getAppPref?.('aganGenProvider'),
      api.getAppPref?.('aganGenModelName'),
      api.getAppPref?.('aganAuditProvider'),
      api.getAppPref?.('aganAuditModelName'),
    ]).then(([gp, gm, ap, am]) => {
      const validGP = gp && SUB_MODELS[gp] ? gp : 'deepseek'
      const validAP = ap && SUB_MODELS[ap] ? ap : 'deepseek'
      const validGM = gm && SUB_MODELS[validGP]?.some(m => m.value === gm) ? gm : SUB_MODELS[validGP][0]?.value
      const validAM = am && SUB_MODELS[validAP]?.some(m => m.value === am) ? am : SUB_MODELS[validAP][0]?.value
      setGenProvider(validGP)
      setGenModelName(validGM)
      setAuditProvider(validAP)
      setAuditModelName(validAM)
    })
  }, [])

  const updateGenProvider = (v) => {
    setGenProvider(v)
    const defaultModel = SUB_MODELS[v]?.[0]?.value || ''
    setGenModelName(defaultModel)
    api.setAppPref?.('aganGenProvider', v)
    api.setAppPref?.('aganGenModelName', defaultModel)
  }
  const updateGenModelName = (v) => { setGenModelName(v); api.setAppPref?.('aganGenModelName', v) }
  const updateAuditProvider = (v) => {
    setAuditProvider(v)
    const defaultModel = SUB_MODELS[v]?.[0]?.value || ''
    setAuditModelName(defaultModel)
    api.setAppPref?.('aganAuditProvider', v)
    api.setAppPref?.('aganAuditModelName', defaultModel)
  }
  const updateAuditModelName = (v) => { setAuditModelName(v); api.setAppPref?.('aganAuditModelName', v) }

  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false } }, [])
  const safeSet = (setter) => (...args) => { if (mountedRef.current) setter(...args) }

  const loadStats = useCallback(async () => {
    const r = await api.aganStats(); if (r.success) safeSet(setStats)(r)
  }, [])

  const refreshLists = useCallback(() => {
    api.aganList({ verdict: 'pending', limit: 200 }).then(r => {
      if (!r.success || !mountedRef.current) return
      safeSet(setAdvItems)(r.items.filter(x => x.source_type !== 'normal'))
      safeSet(setNorItems)(r.items.filter(x => x.source_type === 'normal'))
    })
    api.pgList({ verdict: 'pending', limit: 200 }).then(r => {
      if (!r.success || !mountedRef.current) return
      safeSet(setAdvPgItems)(r.items.filter(x => x.source_type !== 'normal'))
      safeSet(setNorPgItems)(r.items.filter(x => x.source_type === 'normal'))
    })
  }, [])

  const refreshRow = useCallback((isAdv) => {
    api.aganList({ verdict: 'pending', limit: 200 }).then(r => {
      if (!r.success || !mountedRef.current) return
      if (isAdv) safeSet(setAdvItems)(r.items.filter(x => x.source_type !== 'normal'))
      else       safeSet(setNorItems)(r.items.filter(x => x.source_type === 'normal'))
    })
    api.pgList({ verdict: 'pending', limit: 200 }).then(r => {
      if (!r.success || !mountedRef.current) return
      if (isAdv) safeSet(setAdvPgItems)(r.items.filter(x => x.source_type !== 'normal'))
      else       safeSet(setNorPgItems)(r.items.filter(x => x.source_type === 'normal'))
    })
  }, [])

  useEffect(() => { loadStats(); refreshLists(); api.dbGetGlossary?.({ projectId: null, page: 0, pageSize: 30 }).then(r => { if (r?.items) safeSet(setGlossaryCache)(r.items) }) }, [])
  useEffect(() => { if (isVisible) loadStats() }, [isVisible])

  const buildDisplay = (aganList, pgList) => [
    ...aganList.map(a => ({ ...a, x2_paraphrase: x2x4MapRef.current[a.source]?.x2 || '', x4_final: x2x4MapRef.current[a.source]?.x4 || '', x3_target: x2x4MapRef.current[a.source]?.x3 || '' })),
    ...pgList.map(p => ({ id: 'pg_' + p.id, isPg: true, domain: 'idiom', error_type: 'none', source: p.context || p.zh_suggestion, target: p.pl_term, originalId: p.id, x2_paraphrase: p.x2_paraphrase || x2x4MapRef.current[p.context || p.zh_suggestion]?.x2 || '', x4_final: p.x4_final || x2x4MapRef.current[p.context || p.zh_suggestion]?.x4 || '', x3_target: p.x3_target || x2x4MapRef.current[p.context || p.zh_suggestion]?.x3 || '' }))
  ]

  async function handleGenerate(isAdv) {
    if (!settings.apiKey) { toast('请先配置接口密钥', 'error'); return }
    const opts = isAdv ? advOpts : norOpts
    const total = opts.count
    const stopRef = isAdv ? stopAdvRef : stopNorRef
    stopRef.current = false
    safeSet(isAdv ? setGeneratingAdv : setGeneratingNor)(true)
    safeSet(isAdv ? setAdvProgress : setNorProgress)({ done: 0, total })
    const tid = isAdv ? 'agan-gen-adv' : 'agan-gen-nor'
    taskStore.add(tid, isAdv ? '对抗生成' : '非对抗生成', total)
    let done = 0, done_deduped = 0
    while (done < total) {
      if (stopRef.current || !mountedRef.current) break
      const batch = Math.min(5, total - done)
      const r = await api.aganGenerate({ apiModel: genProvider, apiKey: settings.apiKey, modelName: genModelName, domain: opts.domain, errorType: isAdv ? opts.errorType : 'none', count: batch, glossaryItems: glossaryCache, sourceType: isAdv ? 'adversarial' : 'normal' })
      if (!r.success) { toast(r.error || '生成失败', 'error'); break }
      done += r.count
      if (r.deduped) done_deduped = (done_deduped || 0) + r.deduped
      // 缓存 x2/x4 数据
      if (r.items) r.items.forEach(it => { if (it.source) x2x4MapRef.current[it.source.trim()] = { x2: it.x2_paraphrase || '', x3: it.target || '', x4: it.x4_final || '' } })
      if (r.newPgItems) r.newPgItems.forEach(pg => { const key = (pg.context || pg.zh_suggestion || '').trim(); if (key) x2x4MapRef.current[key] = { x2: pg.x2_paraphrase || '', x3: pg.x3_target || '', x4: pg.x4_final || '' } })
      if (!mountedRef.current) break
      safeSet(isAdv ? setAdvProgress : setNorProgress)({ done, total })
      taskStore.update(tid, done, total)
      refreshRow(isAdv)
    }
    taskStore.complete(tid, `完成 ${done} 条`)
    safeSet(isAdv ? setGeneratingAdv : setGeneratingNor)(false)
    safeSet(isAdv ? setAdvProgress : setNorProgress)({ done: 0, total: 0 })
    loadStats()
    if (!stopRef.current) toast(`${isAdv ? '对抗' : '非对抗'}生成完成 ${done} 条${done_deduped ? `，去重 ${done_deduped} 条` : ''}`, 'success')
  }

  async function handleAudit(isAdv) {
    const items = isAdv ? advItems : norItems
    const pgItems = isAdv ? advPgItems : norPgItems
    if (!items.length && !pgItems.length) { toast('无样本可审核', 'info'); return }
    const setAudit = isAdv ? setAdvAudit : setNorAudit
    safeSet(setAudit)({ on: true, pct: 0, results: {} })

    // 成语/词组模式：agan_pool 为空，跳过 DeepSeek 打分，直接用 pgItems 做 MiniMax 验证
    if (!items.length && pgItems.length > 0) {
      safeSet(setAudit)(prev => ({ ...prev, pct: 50 }))
      const mmRes = await api.aganVerifyIdiom({ items: pgItems })
      if (mmRes.success && mountedRef.current) {
        const mmMap = {}
        mmRes.results.forEach(r => { mmMap[r.id] = r })
        safeSet(setAudit)(prev => {
          const next = { ...prev.results }
          pgItems.forEach(item => { if (mmMap[item.id]) next[item.id] = { mm: mmMap[item.id] } })
          return { ...prev, pct: 100, results: next }
        })
        const matched = mmRes.results.filter(r => r.pass !== false && (r.pass === true || r.match === true)).length
        toast(`MiniMax 验证完成：${matched}/${pgItems.length} 条一致`, matched === pgItems.length ? 'success' : 'info')
      } else if (!mmRes.success) {
        toast(mmRes.error || 'MiniMax 验证失败', 'error')
      }
      safeSet(setAudit)(prev => ({ ...prev, on: false, pct: 0 }))
      loadStats()
      return
    }

    // 普通对抗模式：审核模型打分 → 验证 → 提取术语
    let scored = 0
    for (let i = 0; i < items.length; i += 3) {
      if (!mountedRef.current) break
      const chunk = items.slice(i, i + 3)
      const results = await Promise.allSettled(chunk.map(item => api.aganScoreItem({ id: item.id, apiModel: auditProvider, apiKey: settings.apiKey, modelName: auditModelName, source: item.source, target: item.target })))
      results.forEach((res, idx) => { if (res.status === 'fulfilled' && res.value.success) { scored++; const id = chunk[idx].id; safeSet(setAudit)(prev => ({ ...prev, results: { ...prev.results, [id]: { ...(prev.results[id] || {}), ds: res.value.scoreA } } })) } })
      safeSet(setAudit)(prev => ({ ...prev, pct: Math.round((scored / items.length) * 60) }))
    }
    if (mountedRef.current) {
      const mmRes = await api.aganVerifyIdiom({ items, auditProvider, auditModelName })
      if (mmRes.success) { const mmMap = {}; mmRes.results.forEach(r => { mmMap[r.id] = r }); safeSet(setAudit)(prev => { const next = { ...prev.results }; items.forEach(item => { if (mmMap[item.id]) next[item.id] = { ...(next[item.id] || {}), mm: mmMap[item.id] } }); return { ...prev, pct: 80, results: next } }) }
    }
    if (mountedRef.current && !extractingRef.current) {
      extractingRef.current = true
      const extractR = await api.aganExtractTerms({ apiModel: auditProvider, apiKey: settings.apiKey, modelName: auditModelName })
      extractingRef.current = false
      if (extractR.success && extractR.count > 0 && mountedRef.current) { refreshRow(isAdv); toast(`提取 ${extractR.count} 条术语`, 'success') }
    }
    safeSet(setAudit)(prev => ({ ...prev, on: false, pct: 0 }))
    loadStats()
  }

  async function handleImport(isAdv) {
    const pgItems = isAdv ? advPgItems : norPgItems
    if (!pgItems.length) return
    let ok = 0
    for (const it of pgItems) {
      const edits = editsMapRef.current['pg_' + it.id]
      const zhVal = edits?.zh ?? it.zh_suggestion ?? it.pl_term
      const plVal = edits?.pl ?? it.pl_term
      const r = await api.pgVerdict({ id: it.id, verdict: 'approve', zhFinal: zhVal, plFinal: plVal, projectId: null })
      if (r.success) ok++
    }
    toast(`已导入 ${ok} 条术语`, 'success')
    refreshRow(isAdv); loadStats()
    if (ok > 0) emit('glossary:updated')
  }

  function handleDelete(id, isPg) {
    if (isPg) { api.pgVerdict({ id, verdict: 'ignore', projectId: null }).then(() => { refreshRow(true); refreshRow(false) }) }
    else { setAdvItems(p => p.filter(x => x.id !== id)); setNorItems(p => p.filter(x => x.id !== id)) }
  }

  async function handleImportOne(item, editZh, editPl) {
    if (!item.isPg) return
    const id = item.originalId
    const r = await api.pgVerdict({ id, verdict: 'approve', zhFinal: editZh || item.source, plFinal: editPl || item.target, projectId: null, domain: item.domain || 'idiom' })
    if (r.success) { toast('已导入 1 条术语', 'success'); refreshRow(true); refreshRow(false); loadStats(); emit('glossary:updated') }
    else toast('导入失败: ' + r.error, 'error')
  }

  async function handleReset(isAdv) {
    const res = await api.aganClearRow({ isAdv })
    if (res.success) {
      if (isAdv) {
        safeSet(setAdvItems)([])
        safeSet(setAdvPgItems)([])
        safeSet(setAdvAudit)({ on: false, pct: 0, results: {} })
      } else {
        safeSet(setNorItems)([])
        safeSet(setNorPgItems)([])
        safeSet(setNorAudit)({ on: false, pct: 0, results: {} })
      }
      toast(`${isAdv ? '对抗行' : '非对抗行'}数据已清除`, 'info')
      loadStats()
    } else {
      toast('清除数据失败: ' + res.error, 'error')
    }
  }

  const selS = { background: 'var(--surface-container)', border: '1px solid var(--surface-container-high)', borderRadius: 8, padding: '5px 8px', fontSize: 12, color: 'var(--on-surface)', outline: 'none', fontFamily: 'inherit' }
  const quotaFull = stats && (stats.todayUsage ?? 0) >= (stats.dailyLimit ?? 20)
  const advDisplay = buildDisplay(advItems, advPgItems)
  const norDisplay = buildDisplay(norItems, norPgItems)

  const RowPanel = ({ isAdv, opts, setOpts, items, displayItems, generating, progress, stopRef, audit, pgItems, onReset }) => {
    const accent = isAdv ? '#ef4444' : 'var(--tertiary)'
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, borderBottom: isAdv ? '1px solid var(--surface-container)' : 'none' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 16px', background: isAdv ? 'rgba(239,68,68,0.03)' : 'rgba(0,93,187,0.03)', borderBottom: '1px solid var(--surface-container)', flexShrink: 0, flexWrap: 'wrap' }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: accent, flexShrink: 0 }} />
          <div style={{ marginRight: 4 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--on-surface)' }}>{isAdv ? '对抗生成' : '非对抗生成'}</div>
            <div style={{ fontSize: 10, color: 'var(--outline)' }}>{isAdv ? '注入语法错误，检验纠错能力' : '标准干净译文，建立基准语料'}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <label style={{ fontSize: 9, color: 'var(--outline)', fontWeight: 700 }}>条数</label>
            <input type="number" value={opts.count} min={5} max={30} onChange={e => setOpts(p => ({ ...p, count: Number(e.target.value) }))} style={{ ...selS, width: 50 }} />
            <label style={{ fontSize: 9, color: 'var(--outline)', fontWeight: 700 }}>主题</label>
            <select value={opts.domain} onChange={e => setOpts(p => ({ ...p, domain: e.target.value }))} style={selS}>
              {DOMAINS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
            </select>
            {isAdv && (<>
              <label style={{ fontSize: 9, color: 'var(--outline)', fontWeight: 700 }}>错误</label>
              <select value={opts.errorType} onChange={e => setOpts(p => ({ ...p, errorType: e.target.value }))} style={selS}>
                {ERROR_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </>)}
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: 'var(--outline)', background: 'var(--surface-container)', borderRadius: 20, padding: '2px 8px', fontWeight: 700 }}>{displayItems.length} 条</span>
            {generating ? (
              <button onClick={() => { stopRef.current = true; toast('正在停止，等待当前批次完成…', 'info') }} style={{ border: '1px solid var(--error)', borderRadius: 8, padding: '6px 12px', fontSize: 11, fontWeight: 700, cursor: 'pointer', background: stopRef.current ? 'var(--surface-container)' : 'transparent', color: stopRef.current ? 'var(--outline)' : 'var(--error)', fontFamily: 'inherit' }}>{stopRef.current ? '正在停止…' : `停止 ${progress.done}/${progress.total}`}</button>
            ) : (
              <button onClick={() => handleGenerate(isAdv)} disabled={quotaFull} style={{ border: 'none', borderRadius: 8, padding: '6px 14px', fontSize: 11, fontWeight: 800, cursor: quotaFull ? 'not-allowed' : 'pointer', background: quotaFull ? 'var(--surface-container)' : accent, color: quotaFull ? 'var(--outline)' : '#fff', fontFamily: 'inherit' }}>生成</button>
            )}
            <button onClick={() => handleAudit(isAdv)} disabled={audit.on || displayItems.length === 0} style={{ border: 'none', borderRadius: 8, padding: '6px 14px', fontSize: 11, fontWeight: 700, cursor: (audit.on || displayItems.length === 0) ? 'not-allowed' : 'pointer', background: audit.on ? 'var(--surface-container)' : 'var(--surface-container-high)', color: audit.on ? 'var(--outline)' : 'var(--on-surface)', opacity: displayItems.length === 0 ? 0.4 : 1, fontFamily: 'inherit' }}>
              {audit.on ? `审核 ${audit.pct}%` : '双重审核'}
            </button>
            <button onClick={() => handleImport(isAdv)} disabled={pgItems.length === 0} style={{ border: 'none', borderRadius: 8, padding: '6px 14px', fontSize: 11, fontWeight: 700, cursor: pgItems.length === 0 ? 'not-allowed' : 'pointer', background: pgItems.length > 0 ? 'var(--tertiary)' : 'var(--surface-container)', color: pgItems.length > 0 ? '#fff' : 'var(--outline)', fontFamily: 'inherit' }}>导入 ({pgItems.length})</button>
            <button onClick={onReset} disabled={generating || audit.on} style={{ border: '1px solid var(--surface-container-high)', borderRadius: 8, padding: '6px 10px', fontSize: 11, fontWeight: 700, cursor: (generating || audit.on) ? 'not-allowed' : 'pointer', background: 'transparent', color: 'var(--on-surface-variant)', fontFamily: 'inherit', opacity: (generating || audit.on) ? 0.4 : 1 }}>重置</button>
          </div>
        </div>
        {(audit.on || generating) && (
          <div style={{ height: 3, background: 'var(--surface-container)', flexShrink: 0 }}>
            <div style={{ height: '100%', width: audit.on ? `${audit.pct}%` : (progress.total > 0 ? `${(progress.done / progress.total) * 100}%` : '0%'), background: accent, transition: 'width 0.4s ease' }} />
          </div>
        )}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 16px' }}>
          {displayItems.length === 0 && !generating && <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--outline)', fontSize: 12 }}>暂无数据，点击生成开始</div>}
          {displayItems.map(item => <PreviewCard key={item.id} item={item} auditResult={audit.results[item.originalId || item.id]} auditProviderLabel={MODEL_PROVIDERS.find(p => p.value === auditProvider)?.label || auditProvider} onDelete={(id, isPg) => handleDelete(item.originalId || id, isPg)} onImport={handleImportOne} onEditChange={(id, zh, pl) => { editsMapRef.current[id] = { zh, pl } }} />)}
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden', background: 'var(--surface-container-lowest)' }}>
      <div style={{ width: 220, flexShrink: 0, background: 'var(--surface-container-low)', padding: '20px 16px', display: 'flex', flexDirection: 'column', gap: 16, borderRight: '1px solid var(--surface-container)', overflowY: 'auto' }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--on-surface)' }}>统计看板</div>
        {stats ? (<>
          <div style={{ background: 'var(--surface-container)', borderRadius: 10, padding: '14px', position: 'relative', overflow: 'hidden' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--outline)', marginBottom: 6 }}>今日配额</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
              <span style={{ fontSize: 24, fontWeight: 900, color: quotaFull ? '#ef4444' : 'var(--on-surface)', fontFamily: 'var(--font-mono)' }}>{stats.todayUsage ?? 0}</span>
              <span style={{ fontSize: 12, color: 'var(--outline)', fontFamily: 'var(--font-mono)' }}>/ {stats.dailyLimit ?? 20}</span>
            </div>
            <div style={{ position: 'absolute', bottom: 0, left: 0, height: 3, width: `${Math.min(((stats.todayUsage ?? 0) / (stats.dailyLimit ?? 20)) * 100, 100)}%`, background: quotaFull ? '#ef4444' : 'var(--tertiary)' }} />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1, background: 'var(--surface-container)', borderRadius: 10, padding: '10px' }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--outline)', marginBottom: 3 }}>已批准</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: '#10b981', fontFamily: 'var(--font-mono)' }}>{stats.accepted ?? 0}</div>
            </div>
            <div style={{ flex: 1, background: 'var(--surface-container)', borderRadius: 10, padding: '10px' }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--outline)', marginBottom: 3 }}>待审词</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--tertiary)', fontFamily: 'var(--font-mono)' }}>{advPgItems.length + norPgItems.length}</div>
            </div>
          </div>
          <div style={{ background: 'var(--surface-container)', borderRadius: 10, padding: '10px' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--outline)', marginBottom: 3 }}>高分歧</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: '#f59e0b', fontFamily: 'var(--font-mono)' }}>{stats.divergent ?? 0}</div>
          </div>
        </>) : <div style={{ fontSize: 12, color: 'var(--outline)' }}>加载中...</div>}

        {/* 模型配置面板 */}
        <div style={{ background: 'var(--surface-container)', borderRadius: 10, padding: '12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--on-surface)' }}>模型配置</div>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--outline)', marginBottom: 4 }}>生成模型</div>
            <select value={genProvider} onChange={e => updateGenProvider(e.target.value)} style={{ background: 'var(--surface-container-lowest)', border: '1px solid var(--surface-container-high)', borderRadius: 8, padding: '5px 8px', fontSize: 12, color: 'var(--on-surface)', outline: 'none', fontFamily: 'inherit', width: '100%', marginBottom: 4 }}>
              {MODEL_PROVIDERS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
            <select value={genModelName} onChange={e => updateGenModelName(e.target.value)} style={{ background: 'var(--surface-container-lowest)', border: '1px solid var(--surface-container-high)', borderRadius: 8, padding: '5px 8px', fontSize: 12, color: 'var(--on-surface)', outline: 'none', fontFamily: 'inherit', width: '100%' }}>
              {(SUB_MODELS[genProvider] || []).map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>
          <div style={{ borderTop: '1px solid var(--surface-container-high)', paddingTop: 8 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--outline)', marginBottom: 4 }}>审核模型</div>
            <select value={auditProvider} onChange={e => updateAuditProvider(e.target.value)} style={{ background: 'var(--surface-container-lowest)', border: '1px solid var(--surface-container-high)', borderRadius: 8, padding: '5px 8px', fontSize: 12, color: 'var(--on-surface)', outline: 'none', fontFamily: 'inherit', width: '100%', marginBottom: 4 }}>
              {MODEL_PROVIDERS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
            <select value={auditModelName} onChange={e => updateAuditModelName(e.target.value)} style={{ background: 'var(--surface-container-lowest)', border: '1px solid var(--surface-container-high)', borderRadius: 8, padding: '5px 8px', fontSize: 12, color: 'var(--on-surface)', outline: 'none', fontFamily: 'inherit', width: '100%' }}>
              {(SUB_MODELS[auditProvider] || []).map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>
        </div>

        <div style={{ marginTop: 'auto', fontSize: 10, color: 'var(--outline)', lineHeight: 1.5, background: 'var(--surface-container)', borderRadius: 8, padding: '10px' }}>
          <div style={{ fontWeight: 800, marginBottom: 4 }}>提示</div>
          对抗行注入错误训练纠错能力；非对抗行生成干净基准语料。审核后自动提取术语。
        </div>
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
        <RowPanel isAdv={true} opts={advOpts} setOpts={setAdvOpts} items={advItems} displayItems={advDisplay} generating={generatingAdv} progress={advProgress} stopRef={stopAdvRef} audit={advAudit} pgItems={advPgItems} onReset={() => handleReset(true)} />
        <RowPanel isAdv={false} opts={norOpts} setOpts={setNorOpts} items={norItems} displayItems={norDisplay} generating={generatingNor} progress={norProgress} stopRef={stopNorRef} audit={norAudit} pgItems={norPgItems} onReset={() => handleReset(false)} />
      </div>
    </div>
  )
}
