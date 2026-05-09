import { useEffect, useState } from 'react'
import { taskStore } from '../taskStore'

export default function TaskPanel() {
  const [tasks, setTasks] = useState([])

  useEffect(() => {
    const unsub = taskStore.subscribe(setTasks)
    return unsub
  }, [])

  const visible = tasks.filter(t => !t.completed || true) // 全部显示，完成态也显示直到用户关闭

  if (visible.length === 0) return null

  return (
    <div style={{
      position: 'fixed', bottom: 20, left: 16, zIndex: 9999,
      display: 'flex', flexDirection: 'column', gap: 6,
      maxWidth: 280,
    }}>
      {visible.map(task => {
        const pct = task.total > 0 ? Math.round((task.done / task.total) * 100) : (task.completed ? 100 : 0)
        const isRunning = !task.completed && task.total > 0
        const isDone = task.completed

        return (
          <div key={task.id} style={{
            background: 'var(--surface-container)',
            border: '1px solid var(--surface-container-high)',
            borderRadius: 10,
            padding: '9px 12px',
            backdropFilter: 'blur(12px)',
            boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
            minWidth: 220,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
              {/* 状态点 + 任务名 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{
                  width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                  background: isDone ? 'var(--tertiary)' : '#f59e0b',
                  boxShadow: isRunning ? '0 0 0 3px rgba(245,158,11,0.2)' : 'none',
                  animation: isRunning ? 'pulse 1.4s ease infinite' : 'none',
                }} />
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--on-surface)', lineHeight: 1.3 }}>
                  {isDone ? (task.completedLabel || task.label) : task.label}
                </span>
              </div>
              {/* 关闭按钮 */}
              <button
                onClick={() => taskStore.remove(task.id)}
                title="关闭"
                style={{
                  border: 'none', background: 'none', cursor: 'pointer',
                  color: 'var(--outline)', fontSize: 14, lineHeight: 1,
                  padding: '0 2px', borderRadius: 4,
                  display: 'flex', alignItems: 'center',
                  fontFamily: 'inherit',
                }}>
                ×
              </button>
            </div>

            {/* 进度条 */}
            <div style={{ height: 3, borderRadius: 2, background: 'var(--surface-container-high)', overflow: 'hidden' }}>
              <div style={{
                height: '100%', borderRadius: 2,
                width: isRunning ? `${pct}%` : '100%',
                background: isDone ? 'var(--tertiary)' : '#f59e0b',
                transition: 'width 0.3s ease',
                animation: isRunning && task.total === 0 ? 'indeterminate 1.5s ease infinite' : 'none',
              }} />
            </div>

            {/* 进度文字 */}
            {task.total > 0 && (
              <div style={{ fontSize: 10, color: 'var(--outline)', marginTop: 4, textAlign: 'right' }}>
                {isDone ? `完成 ${task.total} 条` : `${task.done} / ${task.total} · ${pct}%`}
              </div>
            )}
          </div>
        )
      })}

      <style>{`
        @keyframes indeterminate {
          0% { transform: translateX(-100%); width: 40%; }
          100% { transform: translateX(300%); width: 40%; }
        }
      `}</style>
    </div>
  )
}
