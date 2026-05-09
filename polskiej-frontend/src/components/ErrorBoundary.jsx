import { Component } from 'react'

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', padding: 40, gap: 16 }}>
          <div style={{ fontSize: 40 }}>⚠️</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--on-surface, #1a1a1a)' }}>该模块遇到了问题</div>
          <div style={{ fontSize: 12, color: 'var(--on-surface-variant, #666)', maxWidth: 400, textAlign: 'center', lineHeight: 1.6 }}>
            {this.state.error?.message || '未知错误'}
          </div>
          <button onClick={() => this.setState({ hasError: false, error: null })}
            style={{ background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 20px', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
            重试
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
