// 跨模块事件总线（无框架依赖）
const bus = new EventTarget()

export const emit = (name, detail) =>
  bus.dispatchEvent(new CustomEvent(name, { detail }))

export const on = (name, fn) => {
  const handler = (e) => fn(e.detail)
  bus.addEventListener(name, handler)
  return () => bus.removeEventListener(name, handler)
}
