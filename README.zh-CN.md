# Mermaid Zoom

[English](README.md) | [简体中文](README.zh-CN.md)

为 Obsidian 中的 Mermaid 图表添加缩放和平移功能的插件。

## 功能

- **鼠标滚轮缩放** - 在 Mermaid 图表上滚动鼠标滚轮即可缩放
- **拖拽平移** - 按住鼠标左键拖动可以移动图表
- **触摸手势** - 支持双指捏合缩放和单指拖动
- **控制按钮** - 快捷的放大、缩小、重置按钮
- **缩放比例显示** - 实时显示当前缩放比例
- **全屏模式** - 在模态框中查看图表，获得更好的视野

## 安装

### 方式一：从 GitHub Release 下载（推荐）

1. 访问 [Releases 页面](https://github.com/xiaozhuang0433/mermaid-zoom/releases)
2. 下载最新版本的 `mermaid-zoom.zip`
3. 解压到你的库的 plugins 目录：
   ```
   <你的库>/.obsidian/plugins/mermaid-zoom
   ```
4. 在 Obsidian 中启用插件：
   - 打开 设置 → 社区插件
   - 找到 "Mermaid Zoom" 并启用

### 方式二：手动安装

1. 克隆此仓库到你的库的 plugins 目录：
   ```
   <你的库>/.obsidian/plugins/mermaid-zoom
   ```
2. 安装依赖并构建：
   ```bash
   cd <你的库>/.obsidian/plugins/mermaid-zoom
   npm install
   npm run build
   ```
3. 在 Obsidian 中启用插件

## 使用方法

### 鼠标操作

| 操作 | 说明 |
|------|------|
| **缩放** | 将鼠标悬停在 Mermaid 图表上，滚动滚轮 |
| **平移** | 按住鼠标左键拖动 |
| **全屏** | 点击全屏按钮在模态框中查看 |

### 触摸操作（移动设备）

| 操作 | 说明 |
|------|------|
| **缩放** | 双指捏合手势 |
| **平移** | 单指拖动 |

### 控制按钮

位于每个图表的右下角：

- **`+`** - 放大
- **`-`** - 缩小
- **`⟲`** - 重置为适配大小
- **`⛶`** - 切换全屏

## 开发

```bash
# 安装依赖
npm install

# 开发模式（监听文件变化）
npm run dev

# 生产构建
npm run build
```

## 工作原理

插件会自动检测 Obsidian 渲染的所有 Mermaid 图表，并为每个图表添加可缩放容器。缩放范围为 10% 到 500%。

原始 SVG 尺寸会被缓存，以确保重置或调整大小时缩放行为一致。

## 许可证

[MIT](LICENSE) © [Wang Xiao Zhuang](https://github.com/xiaozhuang0433)

## 支持

- 问题反馈：[GitHub Issues](https://github.com/xiaozhuang0433/mermaid-zoom/issues)
- 讨论交流：[GitHub Discussions](https://github.com/xiaozhuang0433/mermaid-zoom/discussions)
