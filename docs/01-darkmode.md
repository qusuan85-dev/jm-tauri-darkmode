# JM(Tauri) 暗色模式 + UI 优化

基于 [alexsunxl/jm-tauri](https://github.com/alexsunxl/jm-tauri) `v0.1.25` 源码（即本次提供的 `jm.apk`）实现。

---

## 一、产物

产物清单、校验值、安装方式与构建配方统一放在 [`README.md`](./README.md)，这里只记实现本身。

本轮（暗色模式 + 搜索 + 圆角/玻璃/主题色/导出）的完整改动都与产物同源，重建方式见 `README.md`。

---

## 二、暗色模式是怎么做的

### 1. 单点 token 层，而不是逐处加 `dark:`

原项目所有颜色都走 Tailwind 的 `zinc` 中性色阶（全量清点后共 **56 个颜色工具类**、约 900 处调用）。因此没有采用“逐个组件加 `dark:`”的写法，而是在两层做一次性重映射：

**`jm/tailwind.config.cjs`** — 打开 `darkMode: "class"`，并把整个 `zinc` 色阶改为由 CSS 变量承载：

```js
const zinc = (step) => `rgb(var(--jm-zinc-${step}) / <alpha-value>)`;
// colors.zinc = { 50: zinc(50), …, 950: zinc(950) }
```

**`jm/src/index.css`** — `:root` 定义浅色通道值，`.dark` 覆盖为深色通道值。这样 `bg-zinc-50`、`text-zinc-900`、`border-zinc-200`、`hover:bg-zinc-50`（88 处）、`divide-zinc-100` 等**连同所有变体**一起翻转，不会漏项。

深色色阶按“语义对位”设计，而不是简单反相：

| token | 浅色 | 深色 | 语义 |
| --- | --- | --- | --- |
| `zinc-50` | `#fafafa` | `#131316` | 卡片内嵌面板 / hover 反馈（比卡片更“退后”） |
| `zinc-100` | `#f4f4f5` | `#09090b` | 窗口底色 |
| `zinc-200` | `#e4e4e7` | `#2d2d33` | 描边、分隔线 |
| `zinc-400/500/600` | 中性灰 | 逐级提亮 | 占位符 → 次要文字 |
| `zinc-700/800/900` | 深灰 | `#d4d4d8` / `#e4e4e7` / `#f4f4f5` | 正文 → 主文字 |
| `surface`（`bg-white`） | `#ffffff` | `#18181b` | 卡片 / 弹层 / 工具条 |

个别无法由色阶推导的语义，在 `@layer components` 里显式覆盖（放在 components 层是为了让 `hover:bg-zinc-50` 这类变体仍能覆盖基础背景，同时靠优先级压过 `bg-white` 基础值）：

- `bg-white` / `bg-white/95` / `border-t-white`（气泡箭头）→ surface token
- `bg-zinc-900 text-white`（主按钮、选中态胶囊）→ 深色下翻转为**亮底深字**，保持最高对比度
- `border-zinc-100` / `divide-zinc-100` → 专用 `--jm-hairline`，避免细线在深色下变成突兀的暗线
- 红/琥珀/翠绿/蓝等提示色：文字提亮、浅底转半透明暗底（`rgb(127 29 29 / .25)` 一类），实心色块（toast、徽标）保持不变

### 2. 主题模式与持久化

新增 `jm/src/settings/theme.ts`：

- 三种模式：`light` / `dark` / `system`，存 `localStorage["jm_theme_mode"]`（`system` 时**删除**该键，保持"未设置"语义）
- 解析结果落到 `<html class="dark">` + `color-scheme` + 窗口背景色，并同步 `<meta name="theme-color">`
- `system` 模式下用 `matchMedia("(prefers-color-scheme: dark)")` 监听系统切换，**应用运行中也会实时跟随**
- 监听 `storage` 事件，多窗口/多标签保持一致

**防白闪**：`jm/index.html` 里放了一段极小的内联脚本，在首帧渲染前就把 `dark` 类和背景色设好；否则冷启动时会先闪一下浅色窗口（尤其深色模式下从桌面点开 App 时非常明显）。

### 3. 设置页新增「外观」卡片

`jm/src/pages/SettingsPage.tsx` 顶部新增，含「浅色 / 深色 / 跟随系统」分段控件、当前生效主题提示，并跟随 `subscribeTheme` 更新。

### 4. 原生控件与系统栏

- **表单控件**：checkbox / radio / range 统一 `accent-color` 为主题中性色（原先是平台蓝色），浅深两套一致。
- **Android 状态栏 / 导航栏图标**：`tauri-plugin-edge-to-edge@0.3.3` 只在插件加载时**按系统夜间模式设定一次**栏图标明暗，且**没有**任何可调用的命令（调研确认：它只注册 `get_safe_area_insets`/`get_keyboard_info`/`enable`/`disable`/`show_keyboard`/`hide_keyboard`）。所以当用户在应用内手选一个与系统相反的主题时，状态栏图标会反色（深底深图标，等于看不见）。
  处理方式：在 `MainActivity.onWebViewCreate`（`WryActivity` 暴露的 open 方法）挂一个 `@JavascriptInterface` 桥 `window.JMShell.setDarkSystemBars(dark)`，网页层在主题变化时调用它，用 `WindowCompat.getInsetsController(...).isAppearanceLightStatusBars/NavigationBars` 同步图标明暗。配套在 `app/proguard-rules.pro` 加了 `@android.webkit.JavascriptInterface` 的 keep 规则，避免 R8 把方法名混淆掉（已在产物 `classes.dex` 中确认 `JMShell` / `setDarkSystemBars` 仍然存在）。

### 5. 顺带的 UI 优化

- 修正 `<html>`/`<body>` 窗口底色跟随主题（此前橡皮筋回弹 / 过滚动区域可能出现突兀色块）
- `color-scheme` 正确声明，滚动条、原生控件、输入光标在深色下不再是亮色
- 页面标题从模板遗留的 `Tauri + React + Typescript` 改为 `JM`；`lang` 改为 `zh-CN`
- 深色下卡片与描边保留层次，主按钮翻转为亮底深字，选中态对比度不降级

---

## 三、验证

### 自动化回归测试（`jm/e2e/theme.spec.ts`，3 个用例，全部通过）

1. **切换与持久化**：默认浅色 → 点「深色」→ `<html>` 带 `dark`、`color-scheme: dark`、窗口底 `rgb(9,9,11)`、卡片 `rgb(24,24,27)`、描边 `rgb(45,45,51)`、主文字 `rgb(244,244,245)`；刷新后仍为深色；再切回浅色恢复 `rgb(244,244,245)`。
2. **无浅色残留**：遍历 DOM 中所有可见元素，断言**没有任何大块浅色背景**（刻意排除 `bg-zinc-900 text-white` 这种本就该翻转为亮底的主按钮）。覆盖首页 / 搜索 / 分类排行 / 在线收藏 / 设置五个页面。
3. **跟随系统**：`prefers-color-scheme` 为深色时自动深色；系统切浅色则跟随；一旦用户手选主题即停止跟随；选回「跟随系统」后 local storage 键被清除且重新跟随。

运行方式：

```bash
cd jm
node ./node_modules/@playwright/test/cli.js test e2e/theme.spec.ts
# 需要看截图时：设置 JM_SHOT_DIR 环境变量，会在该目录输出浅/深两套整页截图
```

### 产物静态校验

| 检查项 | 结果 |
| --- | --- |
| `apksigner verify` | `Verifies`，v2 方案通过 |
| 证书 SHA-256 与原 APK 比对 | 完全一致（可直接覆盖升级） |
| `aapt2 dump badging` | `com.aa.jm`，versionCode `1784900000`，minSdk 24 / targetSdk 36 |
| ABI | universal 含 4 个；arm64 包为 `arm64-v8a` |
| 前端是否真的进包 | 在 `libjm_lib.so` 内找到本次构建的哈希文件名（`index-WpjTEs7h.css` 等，4 个 ABI 各 4/4 命中）——前端资源由 `tauri-codegen` 嵌入 `.so`，并非放在 APK `assets/`；资源内容为压缩存储，所以用哈希文件名而非明文来断言 |
| 状态栏桥是否被 R8 剥掉 | `classes.dex` 中仍含 `JMShell` / `setDarkSystemBars` / `SystemBarsBridge` |

---

## 四、如何复现构建

上游 CI（`.github/workflows/*.yml`）在 Ubuntu 上构建，工具链为：Node 24 + pnpm 9、Rust stable（4 个 Android target）、JDK 17、`platforms;android-36` + `build-tools;35.0.0` + `ndk;29.0.13846066`、`cargo install tauri-cli --locked`，最后 `cargo tauri android build`。

本机（Windows）复现时踩到的几个坑与对应处理，供参考：

```powershell
cd jm
# 前端
node .\node_modules\typescript\bin\tsc
node .\node_modules\vite\bin\vite.js build

# 环境
$env:JAVA_HOME   = "<JDK17>"
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:NDK_HOME     = "$env:ANDROID_HOME\ndk\29.0.13846066"

# 打包（tauri.override.json 提供版本号与 beforeBuildCommand 覆盖）
node .\node_modules\@tauri-apps\cli\tauri.js android build --apk true --aab false --config tauri.override.json
# 只要 arm64：追加 --target aarch64
```

1. **Rust 宿主链接器**：Windows 默认 `stable-x86_64-pc-windows-msvc` 需要 MSVC 工具链（`link.exe` + Windows SDK），本机未安装。改用 MinGW-w64（winget `BrechtSanders.WinLibs.POSIX.UCRT`）+ `stable-x86_64-pc-windows-gnu` 作为默认工具链即可（Android 目标本身由 NDK clang 链接，不受影响）。如果你的机器有 VS Build Tools，用默认 MSVC 工具链更省事。
2. **cargo / crates.io 与 rustup 镜像**：直连 `static.rust-lang.org`、`crates.io` 会卡住，改用 `RUSTUP_DIST_SERVER=https://rsproxy.cn` 与 `~/.cargo/config.toml` 的 `replace-with = "rsproxy-sparse"`。
3. **Gradle 发行包**：`services.gradle.org` 会 302 到被墙的 `gradle-dn.com`，表现为下载 0 字节卡死。可预先从镜像取 `gradle-8.14.3-bin.zip` 放进 `~/.gradle/wrapper/dists/gradle-8.14.3-bin/<hash>/`。
4. **`cargo tauri` 子命令**：Android 的 Gradle 插件（`BuildTask.kt`）会回调 `cargo tauri android android-studio-script`。官方做法是 `cargo install tauri-cli --locked`；本机为省编译时间放了一个等价的小 shim（转发到 npm 版 CLI）。
5. **pnpm 11 的构建脚本策略**：会因 `esbuild` 的 postinstall 被忽略而让 `pnpm build` 退出 1。`tauri.override.json` 里把 `beforeBuildCommand` 改成直接调用 `tsc` / `vite` 绕开；上游用 pnpm 9，不受影响。

> `jm/tauri.override.json` 只是本地构建覆盖（版本号 / versionCode / beforeBuildCommand），不参与应用运行逻辑，删除后改用 `--config '{...}'` 或上游的 pnpm 9 流程同样可行。

---

## 五、已知限制

- 未在真机/模拟器上实机验证（本机没有 Android 模拟器镜像）。已做的是：前端部分在 Chromium 中以 412×915 手机视口跑真实渲染 + 自动化断言 + 截图目视；原生部分用产物静态校验（签名、DEX 中桥接方法、ABI、前端是否入包）。
- 状态栏图标同步依赖 `MainActivity` 的 JS 桥；若上游后续升级 `tauri-plugin-edge-to-edge` 到提供 `set_system_bars_style` 的版本，可把桥换成插件命令。
- 阅读器内的大图、封面图来自网络，深色下的观感取决于图片本身；应用只保证容器背景、工具条、进度条等界面元素随主题变化。
