import { useState, useEffect, useCallback } from 'react'

const api = window.electronAPI

// ─── Levenshtein 相似度（0~1，1=完全相同）──────────────────────────────────────
function similarity(a, b) {
  if (!a || !b) return 0
  a = a.toLowerCase(); b = b.toLowerCase()
  if (a === b) return 1
  const la = a.length, lb = b.length
  const dp = Array.from({ length: la + 1 }, (_, i) =>
    Array.from({ length: lb + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  )
  for (let i = 1; i <= la; i++)
    for (let j = 1; j <= lb; j++)
      dp[i][j] = a[i-1] === b[j-1]
        ? dp[i-1][j-1]
        : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1])
  return 1 - dp[la][lb] / Math.max(la, lb)
}

// ─── 高亮上下文中的待审词 ──────────────────────────────────────────────────────
function HighlightContext({ text, term }) {
  if (!text || !term) return <span style={{ color: 'var(--on-surface-variant)', lineHeight: 1.7 }}>{text || '（无上下文）'}</span>
  const idx = text.toLowerCase().indexOf(term.toLowerCase())
  if (idx === -1) return <span style={{ color: 'var(--on-surface-variant)', lineHeight: 1.7 }}>{text}</span>
  return (
    <span style={{ lineHeight: 1.7, color: 'var(--on-surface-variant)' }}>
      {text.slice(0, idx)}
      <mark style={{ background: '#fbbf24', color: '#1a1a1a', borderRadius: 3, padding: '0 3px', fontWeight: 700 }}>
        {text.slice(idx, idx + term.length)}
      </mark>
      {text.slice(idx + term.length)}
    </span>
  )
}

// ─── 主组件 ────────────────────────────────────────────────────────────────────
export default function TermReviewDashboard({ toast }) {
  const [items, setItems]       = useState([])       // pending_glossary 待审列表
  const [selected, setSelected] = useState(null)     // 当前选中项
  const [glossary, setGlossary] = useState([])       // 主术语库（用于相似度比对）
  const [sortBy, setSortBy]     = useState('confidence') // confidence | alpha
  const [editPl, setEditPl]     = useState('')        // 编辑后的波兰文词根
  const [editZh, setEditZh]     = useState('')        // 编辑后的中文定稿
  const [busy, setBusy]         = useState(false)

  // 加载待审列表
  const loadItems = useCallback(async () => {
    const r = await api.pgList({ verdict: 'pending', limit: 200 })
    if (r.success) setItems(r.items)
  }, [])

  // 加载主术语库供相似度比对（用 glossaryGet 全局读取）
  const loadGlossary = useCallback(async () => {
    const r = await api.glossaryGet(null)  // null = 全局
    if (r && Array.isArray(r)) setGlossary(r)
    else if (r?.items) setGlossary(r.items)
  }, [])

  useEffect(() => { loadItems(); loadGlossary() }, [])

  // 选中一项时重置编辑区
  function selectItem(item) {
    setSelected(item)
    setEditPl(item.pl_term)
    setEditZh(item.zh_suggestion)
  }

  // 计算相似度警告列表（>= 0.75 显示，>= 0.85 标红）
  const conflicts = selected
    ? glossary
        .map(g => ({ term: g.source_term, zh: g.target_term, sim: similarity(selected.pl_term, g.source_term) }))
        .filter(c => c.sim >= 0.75)
        .sort((a, b) => b.sim - a.sim)
        .slice(0, 5)
    : []

  // 操作：批准 / 批准（含修改）/ 丢弃为黑名单
  async function doVerdict(verdict) {
    if (!selected) return
    setBusy(true)
    const r = await api.pgVerdict({
      id: selected.id,
      verdict,
      plFinal: editPl.trim() || selected.pl_term,
      zhFinal: editZh.trim() || selected.zh_suggestion,
      projectId: null
    })
    setBusy(false)
    if (r.success) {
      toast(verdict === 'approve' ? '✅ 已入库' : verdict === 'stopword' ? '🚫 已加入黑名单' : '🗑️ 已丢弃', 'success')
      setSelected(null)
      loadItems()
    } else {
      toast(r.error || '操作失败', 'error')
    }
  }

  // 排序逻辑
  const sorted = [...items].sort((a, b) =>
    sortBy === 'confidence'
      ? (b.confidence ?? 0) - (a.confidence ?? 0)
      : a.pl_term.localeCompare(b.pl_term)
  )

  // ─── 左侧：待审列表 ──────────────────────────────────────────────────────────
  const LeftPanel = (
    <div style={{ width: 280, flexShrink: 0, borderRight: '1px solid var(--surface-container)', display: 'flex', flexDirection: 'column', background: 'var(--surface-container-lowest)', overflow: 'hidden' }}>
      {/* 头部 */}
      <div style={{ padding: '16px 16px 10px', borderBottom: '1px solid var(--surface-container)', flexShrink: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--on-surface)', marginBottom: 8 }}>
          待审术语 <span style={{ fontSize: 11, color: 'var(--outline)', fontWeight: 400 }}>({items.length} 条)</span>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {[['confidence', '按置信度'], ['alpha', '按字母']].map(([v, l]) => (
            <button key={v} onClick={() => setSortBy(v)}
              style={{ flex: 1, border: 'none', borderRadius: 6, padding: '5px 0', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                background: sortBy === v ? 'var(--tertiary)' : 'var(--surface-container)',
                color: sortBy === v ? '#fff' : 'var(--on-surface-variant)' }}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {/* 列表 */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {sorted.length === 0 && (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--outline)', fontSize: 13 }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>🎉</div>
            暂无待审术语
          </div>
        )}
        {sorted.map(item => {
          const isSelected = selected?.id === item.id
          const pct = Math.round((item.confidence ?? 0) * 100)
          return (
            <div key={item.id} onClick={() => selectItem(item)}
              style={{ padding: '10px 14px', cursor: 'pointer', borderBottom: '1px solid var(--surface-container)',
                background: isSelected ? 'rgba(0,93,187,0.08)' : 'transparent',
                borderLeft: isSelected ? '3px solid var(--tertiary)' : '3px solid transparent' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--on-surface)', fontFamily: 'var(--font-mono)' }}>
                  {item.pl_term}
                </span>
                <span style={{ fontSize: 10, fontWeight: 700, color: pct >= 80 ? '#10b981' : pct >= 50 ? '#f59e0b' : '#ef4444',
                  background: 'var(--surface-container)', borderRadius: 4, padding: '1px 5px' }}>
                  {pct}%
                </span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--outline)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {item.zh_suggestion || '无推荐译文'}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )

  // ─── 右侧：溯源审查面板 ───────────────────────────────────────────────────────
  const RightPanel = selected ? (
    <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>

      {/* 词条标题 */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--outline)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
          待审术语
        </div>
        <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--on-surface)', fontFamily: 'var(--font-mono)' }}>
          {selected.pl_term}
        </div>
        <div style={{ fontSize: 12, color: 'var(--outline)', marginTop: 2 }}>
          AI推荐译文：{selected.zh_suggestion || '—'} · 置信度 {Math.round((selected.confidence ?? 0) * 100)}%
        </div>
      </div>

      {/* 相似度警告 */}
      {conflicts.length > 0 && (
        <div style={{ marginBottom: 20, background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 10, padding: '12px 16px' }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: '#f59e0b', textTransform: 'uppercase', marginBottom: 10, letterSpacing: '0.06em' }}>
            ⚠ 相似度警告 — 可能是已有术语的变格
          </div>
          {conflicts.map((c, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6, fontSize: 12 }}>
              <span style={{
                fontSize: 10, fontWeight: 700, borderRadius: 4, padding: '1px 6px',
                background: c.sim >= 0.85 ? 'rgba(239,68,68,0.15)' : 'rgba(245,158,11,0.15)',
                color: c.sim >= 0.85 ? '#ef4444' : '#f59e0b'
              }}>
                {Math.round(c.sim * 100)}% {c.sim >= 0.85 ? '高度相似' : '疑似变格'}
              </span>
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--on-surface)' }}>{c.term}</span>
              <span style={{ color: 'var(--outline)' }}>→</span>
              <span style={{ color: 'var(--on-surface-variant)' }}>{c.zh}</span>
            </div>
          ))}
        </div>
      )}

      {/* 上下文卡片 */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--outline)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
          📄 原始上下文
        </div>
        <div style={{ background: 'var(--surface-container-low)', borderRadius: 10, padding: '12px 16px', fontSize: 13 }}>
          <HighlightContext text={selected.context || selected.source_email} term={selected.pl_term} />
        </div>
      </div>

      {/* 编辑区 */}
      <div style={{ marginBottom: 20, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--outline)', marginBottom: 6 }}>
            波兰语词根（可修正变格）
          </div>
          <input value={editPl} onChange={e => setEditPl(e.target.value)}
            style={{ width: '100%', background: 'var(--surface-container-low)', border: '1px solid var(--surface-container-high)', borderRadius: 8,
              padding: '8px 10px', fontSize: 13, fontFamily: 'var(--font-mono)', color: 'var(--on-surface)', outline: 'none', boxSizing: 'border-box' }}
            placeholder="还原词根（去除格变化后缀）" />
        </div>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--outline)', marginBottom: 6 }}>
            中文定稿翻译
          </div>
          <input value={editZh} onChange={e => setEditZh(e.target.value)}
            style={{ width: '100%', background: 'var(--surface-container-low)', border: '1px solid var(--surface-container-high)', borderRadius: 8,
              padding: '8px 10px', fontSize: 13, color: 'var(--on-surface)', outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' }}
            placeholder="中文最终译文" />
        </div>
      </div>

      {/* 操作区 */}
      <div style={{ display: 'flex', gap: 10 }}>
        <button onClick={() => doVerdict('approve')} disabled={busy}
          style={{ flex: 1, border: 'none', borderRadius: 10, padding: '11px 0', fontSize: 13, fontWeight: 800, cursor: busy ? 'not-allowed' : 'pointer',
            background: 'var(--tertiary)', color: '#fff', fontFamily: 'inherit' }}>
          ✅ 直接入库
        </button>
        <button onClick={() => doVerdict('approve')} disabled={busy || (!editPl.trim() && !editZh.trim())}
          style={{ flex: 1, border: '1px solid var(--tertiary)', borderRadius: 10, padding: '11px 0', fontSize: 13, fontWeight: 800,
            cursor: (busy || (!editPl.trim() && !editZh.trim())) ? 'not-allowed' : 'pointer',
            background: 'transparent', color: 'var(--tertiary)', fontFamily: 'inherit' }}>
          ✏️ 修改后入库
        </button>
        <button onClick={() => doVerdict('stopword')} disabled={busy}
          style={{ flex: '0 0 auto', border: '1px solid var(--error)', borderRadius: 10, padding: '11px 16px', fontSize: 13, fontWeight: 800,
            cursor: busy ? 'not-allowed' : 'pointer', background: 'transparent', color: 'var(--error)', fontFamily: 'inherit' }}>
          🚫 丢弃（黑名单）
        </button>
      </div>
    </div>
  ) : (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', color: 'var(--outline)' }}>
      <div style={{ fontSize: 40, marginBottom: 12 }}>👈</div>
      <div style={{ fontSize: 14, fontWeight: 700 }}>从左侧选择一条待审术语</div>
      <div style={{ fontSize: 12, marginTop: 4 }}>系统会自动检测与已有术语库的相似度</div>
    </div>
  )

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {LeftPanel}
      {RightPanel}
    </div>
  )
}
