# FnMusic AMLL lyrics

[![License: AGPL-3.0-only](https://img.shields.io/badge/License-AGPL--3.0--only-blue.svg)](./LICENSE)

将 [Apple Music-like Lyrics](https://github.com/Steve-xmh/applemusic-like-lyrics) 播放器嵌入 FnMusic（飞牛音乐）网页播放页的浏览器扩展。

## 项目用途

- 在 FnMusic 播放页显示 AMLL 风格的逐字/逐行歌词。
- 支持翻译、音译、字体、背景渲染、歌词偏移、自动跟随滚动等设置。
- 依次尝试：AMLL 逐字歌词 → 酷狗 KRC 逐字歌词 → 网易云 LRC 逐行歌词 → FnMusic 自带歌词。
- 通过标题、歌手、时长综合匹配，尽量避免串词。

## 支持的 FnMusic 版本

本项目面向 FnMusic Web 端 `/music` 路由开发，基于当前主流版本 DOM 编写，未锁定最低版本。FnMusic 前端如果大幅调整播放页 DOM 结构，可能需要更新 `src/content.ts` 中的选择器。欢迎提交 issue 或 PR 适配。

## 安装

### 方式一：下载 Release 构建

1. 打开 [Releases](https://github.com/qihe114514/FnMusic-AMLL-lyrics/releases)。
2. 下载 `FnMusic-AMLL-lyrics-v*.zip` 并解压。
3. 在 Chrome/Edge 打开 `chrome://extensions/`。
4. 开启“开发者模式”，选择“加载已解压的扩展程序”，指向解压后的目录。
5. 打开 FnMusic 播放页，确认扩展已启用。

### 方式二：从源码构建

```bash
npm install
npm run typecheck
npm test
npm run build
npm run package
```

构建产物位于 `dist/`，发布压缩包位于仓库根目录 `FnMusic-AMLL-lyrics-v*.zip`。

## 配置

点击扩展图标打开设置页：

- **歌词内容**：翻译、音译、交换翻译/音译、歌词偏移。
- **歌词样式**：字体、字号、字重、字符间距、模糊/缩放/弹簧动画、逐词渐变。
- **歌词背景**：网格渐变/Pixi 渲染器、帧率、渲染倍率、静态模式、音频频域。
- **歌词来源**：启用外部歌词源，以及 AMLL、酷狗、网易云开关。
- **工具**：刷新歌词、清空缓存、手动搜索并应用歌词、查看调试信息。
- **关于**：开发者、仓库、版本、匹配规则、致谢与免责声明。

### 自定义 Host 权限

`public/manifest.json` 默认包含以下 FnMusic 地址：

- `http://192.168.1.11:5666/*`
- `https://www.qihe0507.top:5667/*`

如果你使用其他 FnMusic 地址，请修改 `public/manifest.json` 的 `host_permissions`，并在构建后重新加载扩展。

## 歌词来源与匹配优先级

固定优先级，命中高优先级后不再使用低优先级结果：

1. **AMLL 仓库**：优先获取逐字 TTML 歌词。
2. **酷狗音乐**：AMLL 没有可用结果时，匹配 KRC 逐字歌词。
3. **网易云音乐**：酷狗结果与当前歌曲相差过大时，使用 LRC 逐行歌词。
4. **FnMusic 自带歌词**：以上都不可用时回退。

### 匹配规则

标题与歌手通过归一化和模糊相似度比较，时长使用绝对值误差：

- 标题相似度 ≥ **75%**。
- 双方都有有效时长时，误差 ≤ **±5 秒**。
- 歌手允许顺序不同、分隔符不同、数量多/少 1–2 位；超过 2 位无法对应时判定为不匹配。
- 综合相似度 ≥ **75%** 才视为命中。
- AMLL 结果必须是逐字 TTML；不符合时按无结果处理。

### 性能策略

- 多源查询并发发起，不串行等待。
- 每个外部来源独立超时 `1500ms`。
- 首个合格结果先渲染；更高优先级结果到达时静默替换。
- 缓存 key 使用“标题 + 歌手 + 时长”，重复歌曲不重复请求。
- 缓存命中时目标为切歌后 `≤300ms` 显示首行歌词；冷启动受网络环境影响。

## 已知限制

- 第三方接口为非官方公开接口，可能变更、限流或失效。
- 网易云来源为逐行歌词，不提供逐字动画。
- 歌手别名、冷门合作歌手覆盖有限，极端情况可能匹配失败。
- FnMusic 页面 DOM 变化可能导致歌词容器或滚轮接管失效。
- 不内置字体，默认使用系统黑体；不同系统的字形会有差异。
- 歌词版权归各平台及原作者所有，本项目不存储、不分发歌词文件。

## 开发与测试

```bash
npm run typecheck
npm test
npm run build
npm run package
```

手工验收：

1. 打开 FnMusic 播放页，确认扩展被识别并加载。
2. 分别验证 AMLL、酷狗、网易云、FnMusic 自带歌词命中场景。
3. 快速切歌，确认无旧歌词残留、无长时间空白。
4. 鼠标滚轮上下滚动歌词，滚到顶部/底部不跳动；停止操作 5 秒后恢复自动跟随。
5. 打开设置页“关于”，确认链接、版本与说明正确。

## 开源仓库

https://github.com/qihe114514/FnMusic-AMLL-lyrics

## 许可证

本项目采用 **AGPL-3.0-only**。由于构建产物包含 AGPL-3.0-only 的 Apple Music-like Lyrics 依赖，整体按 AGPL-3.0-only 发布。详见 [LICENSE](./LICENSE) 与 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。

## 致谢与第三方依赖

- [Apple Music-like Lyrics](https://github.com/Steve-xmh/applemusic-like-lyrics)（AGPL-3.0-only）：歌词播放器、核心渲染器与歌词解析。
- [Vue](https://github.com/vuejs/core)（MIT）：UI 框架。
- [Pako](https://github.com/nodeca/pako)（MIT AND Zlib）：KRC 解压。
- 酷狗音乐、网易云音乐公开接口以及所有歌词贡献者。

开发者：[其核](https://github.com/qihe114514) · [B站](https://space.bilibili.com/1049283248) · [抖音](https://www.douyin.com/user/MS4wLjABAAAAuUtKOArTFKTBm4C6o5MwDQuGMNZ9-0CWZfUay6U9wUI)

## 免责声明

本项目仅供学习与个人使用。歌词版权归各音乐平台及原作者所有；插件不存储、不分发歌词文件。第三方接口可能随时失效或被调整，使用本项目产生的任何后果由使用者自行承担。

## 歌词获取架构（v2.1.0）

歌词获取核心位于 `src/lyrics/`：

- `types.ts`：领域类型
- `normalize.ts`：标题/歌手/专辑/版本/繁简归一化
- `matcher.ts`：标题、歌手、时长、专辑、版本综合评分
- `query-plan.ts`：AMLL 多查询变体
- `sources.registry.ts`：来源能力、优先级与限流配置

获取流程：

```text
切歌 → bridge 提供真实歌曲元数据
→ AMLL/酷狗/网易云并发搜索
→ 查询变体去重
→ 严格本地匹配
→ 按 AMLL → 酷狗 → 网易云 选择
→ 拉取并解析歌词
→ 缓存 → 展示
→ 全部失败时使用 FnMusic 自带歌词
```

匹配阈值：

- 标题相似度 ≥ 75%
- 时长误差 ≤ 5 秒
- 歌手允许顺序不同、数量差 1–2 位
- 伴奏/纯音乐/Instrumental/live/remix/cover 版本不一致时不匹配
- 综合相似度 ≥ 75%

缓存与重试：

- 正向缓存 TTL 7 天
- 失败负缓存 10 分钟
- FnMusic 自带歌词不写持久缓存
- 网络恢复后自动清理负缓存并重新匹配
