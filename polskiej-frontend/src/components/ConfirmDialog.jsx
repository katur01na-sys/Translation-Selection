import { useState } from 'react'

// 通用确认对话框 Hook
export function useConfirm() {
  const [state, setState] = useState({ open: false, msg: '', resolve: null })

  function confirm(msg) {
    return new Promise(resolve => {
      setState({ open: true, msg, resolve })
    })
  }

  function handleYes() { state.resolve?.(true); setState({ open: false, msg: '', resolve: null }) }
  function handleNo() { state.resolve?.(false); setState({ open: false, msg: '', resolve: null }) }

  const ConfirmDialog = state.open ? (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.35)', backdropFilter: 'blur(4px)' }}
      onClick={handleNo}>
      <div onClick={e => e.stopPropagation()} style={{
        background: 'var(--surface-container-lowest, #fff)', borderRadius: 16, padding: '28px 32px', minWidth: 320, maxWidth: 420,
        boxShadow: '0 20px 60px rgba(0,0,0,0.18)', border: '1px solid var(--surface-container, #e5e5e5)',
      }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--on-surface, #1a1a1a)', marginBottom: 8 }}>确认操作</div>
        <div style={{ fontSize: 13, color: 'var(--on-surface-variant, #666)', marginBottom: 20, lineHeight: 1.6 }}>{state.msg}</div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={handleNo} style={{ background: 'var(--surface-container, #f0f0f0)', border: 'none', borderRadius: 8, padding: '8px 18px', fontSize: 13, fontWeight: 700, cursor: 'pointer', color: 'var(--on-surface-variant, #666)', fontFamily: 'inherit' }}>取消</button>
          <button onClick={handleYes} style={{ background: 'var(--error, #ef4444)', border: 'none', borderRadius: 8, padding: '8px 18px', fontSize: 13, fontWeight: 700, cursor: 'pointer', color: '#fff', fontFamily: 'inherit' }}>确认</button>
        </div>
      </div>
    </div>
  ) : null

  return { confirm, ConfirmDialog }
}
