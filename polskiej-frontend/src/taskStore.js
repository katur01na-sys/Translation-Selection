// 全局后台任务状态中心（无框架依赖，pub/sub 模式）
// task shape: { id, label, done, total, completed, completedLabel }

let tasks = []
let listeners = []

function notify() {
  const snapshot = [...tasks]
  listeners.forEach(fn => fn(snapshot))
}

export const taskStore = {
  subscribe(fn) {
    listeners.push(fn)
    fn([...tasks]) // 立即同步当前状态
    return () => { listeners = listeners.filter(l => l !== fn) }
  },

  // 添加或重置一个任务
  add(id, label, total = 0) {
    tasks = [...tasks.filter(t => t.id !== id), { id, label, done: 0, total, completed: false }]
    notify()
  },

  // 更新进度
  update(id, done, total) {
    tasks = tasks.map(t => t.id === id ? { ...t, done, total } : t)
    notify()
  },

  // 标记完成
  complete(id, completedLabel) {
    tasks = tasks.map(t =>
      t.id === id ? { ...t, completed: true, completedLabel: completedLabel || t.label + '完成' } : t
    )
    notify()
  },

  // 移除（用户点击关闭 或 手动清除）
  remove(id) {
    tasks = tasks.filter(t => t.id !== id)
    notify()
  },
}
