# 第三方依赖与许可证说明

本项目的构建产物包含以下第三方开源软件。各项目的版权归其作者所有，使用须遵守对应许可证。

| 依赖 | 版本 | 许可证 | 用途 |
| --- | --- | --- | --- |
| @applemusic-like-lyrics/core | 0.5.2 | AGPL-3.0-only | AMLL 歌词渲染核心、背景渲染器 |
| @applemusic-like-lyrics/vue | 0.5.2 | AGPL-3.0-only | Vue 版 AMLL 歌词播放器 |
| @applemusic-like-lyrics/lyric | 1.0.2 | AGPL-3.0-only | LRC/TTML/QRC/YRC/KRC 歌词解析与序列化 |
| vue | 3.5.42 | MIT | UI 框架 |
| pako | 2.1.0 | MIT AND Zlib | KRC 数据解压 |
| vite | 8.2.2 | MIT | 构建工具（开发依赖） |
| typescript | 7.0.2 | Apache-2.0 | 类型检查（开发依赖） |
| @vitejs/plugin-vue | 6.0.8 | MIT | Vue SFC 支持（开发依赖） |

由于核心依赖 Apple Music-like Lyrics 采用 AGPL-3.0-only，本项目整体采用 AGPL-3.0-only 发布。完整许可证文本见仓库根目录 `LICENSE`。

本项目未内置任何字体文件；PingFang、Microsoft YaHei、Noto Sans CJK 等字体由用户操作系统提供，需遵守对应字体的许可条款。
