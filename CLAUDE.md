# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

这是一个 Obsidian 插件，为 Mermaid 图表添加缩放和平移功能。支持鼠标滚轮缩放、拖拽平移和触摸手势操作。

## 常用命令

```bash
# 安装依赖
npm install

# 开发模式（监听文件变化，自动重新构建）
npm run dev

# 生产构建（包含类型检查）
npm run build
```

## 架构说明

### 入口文件
- `main.ts` - 插件的唯一源文件，包含所有逻辑

### 核心类
- `MermaidZoomPlugin` - 主插件类，继承自 Obsidian 的 `Plugin`
- `MermaidZoomChild` - 继承自 `MarkdownRenderChild`，管理单个 Mermaid 图表的生命周期

### 关键机制
1. **图表检测**: 使用 `registerMarkdownCodeBlockProcessor` 注册 mermaid 代码块处理器，同时使用 `MutationObserver` 监听 DOM 变化来捕获动态渲染的图表
2. **缩放状态管理**: 使用 `Map<HTMLElement, ZoomState>` 存储每个图表的缩放状态（scale、translateX/Y、isDragging 等）
3. **已处理元素追踪**: 使用 `WeakSet<SVGSVGElement>` 避免重复处理同一个 SVG

### 构建系统
- 使用 esbuild 打包（配置在 `esbuild.config.mjs`）
- 输出为 CommonJS 格式的 `main.js`
- Obsidian API 和 CodeMirror 相关模块标记为 external

## Obsidian 插件规范

- `manifest.json` - 插件元数据，包含 id、版本、最低 Obsidian 版本要求
- 插件最终需要 `main.js` 和 `manifest.json` 两个文件才能在 Obsidian 中加载
