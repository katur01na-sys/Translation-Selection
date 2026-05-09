import { useState, useCallback, useEffect, lazy, Suspense } from 'react'
import Toast from './components/Toast.jsx'
import LibraryView from './components/LibraryView.jsx'
import ReviewView from './components/ReviewView.jsx'

// P4: 懒加载非首屏组件
const StatsView = lazy(() => import('./components/StatsView.jsx'))
const GlossaryView = lazy(() => import('./components/GlossaryView.jsx'))
const SettingsView = lazy(() => import('./components/SettingsView.jsx'))
const TermMineView = lazy(() => import('./components/TermMineView.jsx'))
const AganView = lazy(() => import('./components/AganView.jsx'))

import TaskPanel from './components/TaskPanel.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'

const api = window.electronAPI

export default function App() {
  const [view, setView] = useState('library')
  const [project, setProject] = useState(null)
  const [settings, setSettings] = useState({
    apiKey: '', apiModel: 'deepseek', modelName: 'deepseek-chat',
    sourceLang: 'Chinese', speakerGender: 'auto', globalContext: '', customPrompt: '',
    aganDailyLimit: 20
  })
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [theme, setTheme] = useState('light') // 'light' | 'dark' | 'system'

  // AGAN 进度状态提升到 App 层，避免切换页面时丢失
  const [aganAuditState, setAganAuditState] = useState({ isAuditing: false, auditPct: 0, isExtracting: false, extractPct: 0 })

  // P0: 全局项目列表，所有模块共享同一份数据
  const [projects, setProjects] = useState([])
  const refreshProjects = useCallback(async () => {
    const r = await api.dbListProjects()
    if (r?.success) setProjects(r.projects)
  }, [])
  useEffect(() => { refreshProjects() }, [refreshProjects])

  // S7: 动态版本号
  const [appVersion, setAppVersion] = useState('2.3.0')
  useEffect(() => { api.getAppVersion?.().then(r => { if (r?.success) setAppVersion(r.version) }) }, [])

  // B1: 应用主题
  useEffect(() => {
    const apply = (t) => {
      if (t === 'dark') document.documentElement.setAttribute('data-theme', 'dark')
      else if (t === 'light') document.documentElement.removeAttribute('data-theme')
      else {
        // system
        const dark = window.matchMedia('(prefers-color-scheme: dark)').matches
        dark ? document.documentElement.setAttribute('data-theme', 'dark') : document.documentElement.removeAttribute('data-theme')
      }
    }
    apply(theme)
    if (theme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)')
      const h = () => apply('system')
      mq.addEventListener('change', h)
      return () => mq.removeEventListener('change', h)
    }
  }, [theme])

  // 启动时：先读偏好供应商，再加载对应 key
  useEffect(() => {
    api.getAppPref('apiModel').then(async r => {
      const savedModel = r?.value || 'deepseek'
      const savedModelName = (await api.getAppPref('modelName'))?.value || ''
      const savedLang = (await api.getAppPref('sourceLang'))?.value || 'Chinese'
      const savedGender = (await api.getAppPref('speakerGender'))?.value || 'auto'
      const savedContext = (await api.getAppPref('globalContext'))?.value || ''
      const savedPrompt = (await api.getAppPref('customPrompt'))?.value || ''
      const keyRes = await api.getApiKey(savedModel)
      if (keyRes?.success && keyRes.key) {
        setSettings(s => ({
          ...s,
          apiKey: keyRes.key,
          apiModel: savedModel,
          modelName: savedModelName,
          sourceLang: savedLang,
          speakerGender: savedGender,
          globalContext: savedContext,
          customPrompt: savedPrompt
        }))
      } else {
        // 偏好的供应商没有 key，fallback 扫描其他供应商
        for (const m of ['deepseek', 'qwen', 'minimax'].filter(x => x !== savedModel)) {
          const res = await api.getApiKey(m)
          if (res?.success && res.key) {
            setSettings(s => ({ ...s, apiKey: res.key, apiModel: m, modelName: '', speakerGender: savedGender, globalContext: savedContext, customPrompt: savedPrompt }))
            break
          }
        }
      }
    })
  }, [])


  // 全局术语挖掘进度（跨页面显示）
  const [mineProgress, setMineProgress] = useState(null)
  useEffect(() => {
    if (!api.onTermProgress) return
    const unsub = api.onTermProgress(d => {
      if (d.done !== undefined && d.total !== undefined) {
        setMineProgress(d.done >= d.total ? null : { done: d.done, total: d.total })
      }
    })
    // 挂载时检查是否有正在运行的任务
    api.getTermState?.().then(s => {
      if (s?.success && s.running && s.total > 0) setMineProgress({ done: s.done, total: s.total })
    })
    return unsub
  }, [])

  const [toasts, setToasts] = useState([])

  const toast = useCallback((msg, type = 'info') => {
    const id = Date.now()
    setToasts(t => [...t, { id, msg, type }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3500)
  }, [])

  const updateSegment = useCallback((seg) => {
    setProject(p => p ? { ...p, segments: p.segments.map(s => s.id === seg.id ? seg : s) } : p)
  }, [])

  const navItems = [
    { id: 'library',    label: '项目资料库' },
    { id: 'review',     label: '翻译审核' },
    { id: 'stats',      label: '统计看板' },
    { id: 'glossary',   label: '术语表' },
    { id: 'termmine',   label: '术语挖掘' },
    { id: 'agan',       label: '对抗训练' },
    { id: 'settings',   label: '设置' },
  ]

  const done = project ? project.segments.filter(s => s.status === 'done').length : 0
  const pct = project && project.segments.length > 0
    ? Math.round((done / project.segments.length) * 100) : 0

  async function handleExport() {
    if (!project) { toast('请先导入项目', 'error'); return }
    const header = ['#', '源文', '原译文', '当前译文', '质量评分', '已纠错', '错误数']
    const rows = [header, ...project.segments.map(s => [
      s.id, s.source, s.originalTarget, s.target,
      s.score ?? '', s.fixed ? '是' : '否', s.errors?.length || 0
    ])]
    const res = await api.exportExcel(rows)
    if (res.success) toast(`已导出：${res.filePath}`, 'success')
    else toast(res.error || '导出失败', 'error')
  }

  function handleLoad(p) {
    setProject(p)
    setView('review')
  }

  // 其他页面删除项目时，若是当前正在审核的项目则清空
  const onProjectDeleted = useCallback((deletedId) => {
    if (project && project.projectId === deletedId) {
      setProject(null)
      api.stopBackgroundReview?.()
    }
    refreshProjects()
  }, [project, refreshProjects])

  return (
    <div className="app-shell">
      <nav className={`sidebar${sidebarCollapsed ? ' collapsed' : ''}`}>
        <div className="sidebar-header">
          <h1>中波翻译工作室</h1>
          <p>专业短剧翻译审核平台</p>
        </div>
        <ul className="nav-list">
          {navItems.map(n => (
            <li key={n.id}>
              <a className={`nav-item${view === n.id ? ' active' : ''}`} onClick={() => setView(n.id)}>
                {n.label}
              </a>
            </li>
          ))}
        </ul>
        {mineProgress && (
          <div onClick={() => setView('termmine')} style={{ margin: '0 12px 8px', padding: '10px 14px', background: 'rgba(59,130,246,0.08)', borderRadius: 10, cursor: 'pointer', transition: 'background 0.15s' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, fontWeight: 700, color: '#3b82f6', marginBottom: 5 }}>
              <span>术语挖掘中</span>
              <span>{mineProgress.done}/{mineProgress.total} 批</span>
            </div>
            <div style={{ height: 5, background: 'rgba(59,130,246,0.12)', borderRadius: 99, overflow: 'hidden' }}>
              <div style={{ width: `${Math.round(mineProgress.done / mineProgress.total * 100)}%`, height: '100%', background: '#3b82f6', borderRadius: 99, transition: 'width 0.35s' }} />
            </div>
          </div>
        )}
        <div className="sidebar-footer">
          <div className="avatar" />
          <div className="user-info"><span>首席译员</span></div>
        </div>
      </nav>
      <button
        className={`sidebar-toggle no-drag${sidebarCollapsed ? ' collapsed' : ''}`}
        onClick={() => setSidebarCollapsed(v => !v)}
        title={sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
      >
        {sidebarCollapsed ? (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
            <line x1="9" y1="3" x2="9" y2="21"/>
            <path d="m14 9 3 3-3 3"/>
          </svg>
        ) : (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
            <line x1="9" y1="3" x2="9" y2="21"/>
            <path d="m16 15-3-3 3-3"/>
          </svg>
        )}
      </button>

      <header className={`topbar drag-region${sidebarCollapsed ? ' sidebar-collapsed' : ''}`}>
        <div className="topbar-left no-drag">
          <h2>中波翻译审核</h2>
          <nav className="topbar-nav">
            <a className="active">{navItems.find(n => n.id === view)?.label || '中波翻译项目'}</a>
            {project && <a>{project.segments.length} 个句段 · {pct}% 完成</a>}
          </nav>
        </div>
        <div className="topbar-right no-drag">
          <div className="topbar-icons">
            <button title={settings.apiKey ? '接口已连接' : '接口未连接'}
              style={{ fontSize: 13, fontWeight: 700, color: settings.apiKey ? 'var(--tertiary)' : 'var(--error)' }}>
              {settings.apiKey ? '已连接' : '未连接'}
            </button>
          </div>
          <button className="btn-export" onClick={handleExport}>导出表格</button>
        </div>
      </header>

      <main className={`main-canvas${sidebarCollapsed ? ' sidebar-collapsed' : ''}`}>
        {view === 'library'  && <ErrorBoundary><LibraryView  api={api} toast={toast} settings={settings} onLoad={handleLoad} projects={projects} refreshProjects={refreshProjects} /></ErrorBoundary>}
        {view === 'review'   && <ErrorBoundary><ReviewView   api={api} toast={toast} project={project} settings={settings} updateSegment={updateSegment} setProject={setProject} /></ErrorBoundary>}
        {view === 'stats'    && <ErrorBoundary><Suspense fallback={<div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100%',color:'var(--outline)'}}>加载中…</div>}><StatsView    api={api} toast={toast} onProjectDeleted={onProjectDeleted} projects={projects} refreshProjects={refreshProjects} isVisible={view === 'stats'} /></Suspense></ErrorBoundary>}

        {view === 'glossary'   && <ErrorBoundary><Suspense fallback={<div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100%',color:'var(--outline)'}}>加载中…</div>}><GlossaryView  api={api} toast={toast} projects={projects} /></Suspense></ErrorBoundary>}
        <div style={{ display: view === 'termmine' ? 'flex' : 'none', height: '100%' }}>
          <ErrorBoundary><Suspense fallback={<div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100%',color:'var(--outline)'}}>加载中…</div>}><TermMineView api={api} toast={toast} onProjectDeleted={onProjectDeleted} projects={projects} refreshProjects={refreshProjects} isVisible={view === 'termmine'} /></Suspense></ErrorBoundary>
        </div>
        <div style={{ display: view === 'agan' ? 'flex' : 'none', height: '100%' }}>
          <ErrorBoundary><Suspense fallback={<div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100%',color:'var(--outline)'}}>加载中…</div>}><AganView api={api} toast={toast} settings={settings} aganAuditState={aganAuditState} setAganAuditState={setAganAuditState} isVisible={view === 'agan'} /></Suspense></ErrorBoundary>
        </div>
        {view === 'settings'   && <ErrorBoundary><Suspense fallback={<div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100%',color:'var(--outline)'}}>加载中…</div>}><SettingsView   api={api} toast={toast} settings={settings} setSettings={setSettings} theme={theme} setTheme={setTheme} /></Suspense></ErrorBoundary>}
      </main>

      <footer className={`app-footer${sidebarCollapsed ? ' sidebar-collapsed' : ''}`}>
        <span>
          <span style={{ display:'inline-block', width:6, height:6, borderRadius:'50%', background: settings.apiKey ? 'var(--tertiary)' : 'var(--error)', marginRight:6, verticalAlign:'middle' }} />
          {settings.apiKey
            ? `接口已连接 · 模型: ${{ deepseek: '深度求索', qwen: '通义千问', minimax: 'MiniMax' }[settings.apiModel] || settings.apiModel}${(settings.apiModel === 'minimax' || settings.apiModel === 'deepseek') && settings.modelName ? ' · ' + settings.modelName : ''}`
            : '接口未连接，请前往设置配置'}
          {project && ` · 已载入 ${project.segments.length} 个句段`}
        </span>
        <div className="footer-links">
          <a>v{appVersion}</a>
        </div>
      </footer>

      <Toast toasts={toasts} />
      <TaskPanel />
    </div>
  )
}
