import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'

// 构建后修复 index.html：移除 crossorigin 属性（在 file:// 协议下会阻止资源加载）
function fixElectronHtml() {
  return {
    name: 'fix-electron-html',
    closeBundle() {
      const htmlPath = path.resolve(__dirname, '../polskiej-chinese-src/dist/index.html')
      if (fs.existsSync(htmlPath)) {
        let html = fs.readFileSync(htmlPath, 'utf-8')
        // 移除所有 crossorigin 属性
        html = html.replace(/ crossorigin(="[^"]*")?/g, '')
        // 移除 Google Fonts（在 Electron file:// 协议下无法访问）
        html = html.replace(/<link[^>]*fonts\.googleapis\.com[^>]*>/g, '')
        html = html.replace(/<link[^>]*fonts\.gstatic\.com[^>]*>/g, '')
        fs.writeFileSync(htmlPath, html)
        console.log('✅ Electron HTML fixed: removed crossorigin and Google Fonts')
      }
    }
  }
}

export default defineConfig({
  plugins: [react(), fixElectronHtml()],
  base: './',
  build: {
    outDir: '../polskiej-chinese-src/dist',
    emptyOutDir: true,
  }
})
