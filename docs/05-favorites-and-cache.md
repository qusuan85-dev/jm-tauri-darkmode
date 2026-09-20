# 收藏夹指定 / 已缓存列表 / 移除本地收藏

第三批真机反馈的三项改动。前两项是新增能力，第三项是删除功能。

---

## 一、收藏时可以指定收藏夹

### 现状与问题

详情页的「收藏」按钮只调 `api_favorite_toggle`，它只会把本子扔进**默认收藏夹**；收藏列表页虽然能按收藏夹筛选、能新建/删除收藏夹，但**没有任何地方能把某个本子放进指定收藏夹**。后端其实早就有一个 `api_favorite_folder_move`（`/favorite_folder` type=move），上游从头到尾没接到界面上。

### 为什么不是"收藏时直接带 folder_id"

移动端 API 的收藏接口不接受收藏夹参数 —— 参考实现 [JMComic-Crawler-Python](https://github.com/hect0x7/JMComic-Crawler-Python) 里对这个参数的处理就是一句注释：

```python
def toggle_favorite_album(self, album_id, folder_id='0', ...):
    :param folder_id: 移动端没有提供 folder_id 参数，保留参数兼容
```

网页端倒是有 `/ajax/favorite_album`（带 `fid`），但在 App 的 API 上下文里被服务端直接拒绝。这两点我都对真实服务端探过（未登录也能区分"路由不存在"和"需要登录"）：

| 请求 | 响应 | 结论 |
| --- | --- | --- |
| `POST /favorite_folder` | **401 需要登录** | 路由存在 ✓ |
| `POST /favorite_folder_xyz` | 200 `"Not legal.favorite_folder_xyz"` | 服务端会显式拒绝不存在的路由 |
| `POST /favorite_folder2` | 200 `"Not legal.favorite_folder2"` | 同上（对照） |
| `POST /ajax/favorite_album` | 200 `"Not legal.ajax"` | 网页接口在此上下文不可用 |

也就是说：**该有的接口都在，只是上游没接**。

### 实现

- 未收藏 → 点「收藏」弹出面板，列出所有收藏夹（含「默认收藏夹」）+ 新建入口；选中后：先 `api_favorite_toggle` 添加，再 `api_favorite_folder_move` 移动到位。
- 已收藏 → 按钮变成「已收藏 · 移动」，面板里可以移动到别的收藏夹，也可以「取消收藏」（此时**不会**重复 toggle，避免把收藏误取消）。
- 面板里能直接新建收藏夹（`api_favorite_folder_add`），建完自动刷新列表。

截图：`screenshots/favorite-folder-picker.png`

---

## 二、直观看到缓存了哪些本子

### 现状与问题

「一键缓存」下的本子只能在**设置 → 缓存详情**里看到，而且那里**只有 AID**——没有封面、没有标题，完全不知道自己缓存了啥。

### 实现

**新增独立页面「已缓存」**（占用了原「本地收藏」在导航里的位置；手机端在底部「阅读」菜单里）：

- 每行：封面、标题、作者、占用大小、文件数、已存话数、最近缓存时间
- 操作：**阅读**（离线可用，优先接着上次的章节/页码）、点标题或封面进详情、**删除**（`api_read_cache_remove`）
- 支持按标题/AID 筛选、按「最近缓存 / 占用大小 / 标题」排序、列表/卡片两种视图（与其它页面一致并记住选择）

数据来源是纯本地的：`api_read_cache_list` 给出有哪些本子，再用 `api_read_offline_cache_get` 取出当初缓存时一并存下的**本子元数据**（标题/作者/章节列表），所以**断网也能看**。如果某个本子没有存过元数据（比如只是阅读时自动缓存了几页），会去接口补一次标题，补不到就显示「本子 <AID>」。

**封面角标**：首页/搜索/收藏/浏览记录/分类排行/详情页的封面上，只要是已缓存的就会叠一个「已缓存」小角标。为此加了一个极小的共享状态（`src/cache/cachedAlbums.ts`）：整个 App 只读一次缓存列表并订阅刷新，缓存或删除之后自动更新，避免每个封面各查一次后端。

截图：`screenshots/cached-page.png`、`screenshots/nav-cached-entry.png`

---

## 三、删掉「本地收藏」

「本地收藏」是独立于在线收藏的一套本地清单（自带"扫描更新"），占着导航一个位置。按你的要求整条删除：

- **前端**：删除 `LocalFavoritesPage.tsx`（714 行）、路由、侧边栏与底部「阅读」菜单入口、详情页与阅读页菜单里的「本地收藏」按钮
- **后端**：删除 5 个命令（`api_local_favorites_list` / `api_local_favorites_scan_latest` / `api_local_favorites_scan_cancel` / `api_local_favorite_has` / `api_local_favorite_toggle`）与 `api_follow_state_list`，以及它们用到的结构体、收藏夹 sled 存储、启动时的扫描线程、事件常量与注册项（`lib.rs` 5580 → 4905 行）
- **磁盘数据保留**：`local-favorites.sled` 不删（不占什么空间，也不影响任何功能），只是不再有代码去读写它
- **保留**：`api_album` 仍在写"最新章节"索引（`read_latest`），`parse_series_latest` 等纯逻辑也保留；所以它带来的 4 个孤儿函数（`read_follow_tree`/`read_update_tree`/`read_latest_seen_tree`/`stored_session_cookies`）加了 `#[allow(dead_code)]` 而不是删掉，保持行为零变化

> 注：`bincode` 这个依赖现在整个 crate 都没人用了，只是 Cargo.toml 里还留着声明（无害）。

---

## 验证

| 项 | 结果 |
| --- | --- |
| e2e（Playwright） | **28 个用例全绿**（删掉 4 个本地收藏用例，新增 5 个：导航入口、已缓存页列表与删除、收藏到指定收藏夹、已收藏移动、封面角标） |
| Rust | `cargo check --package jm` 零错误零警告 |
| 类型检查 | `tsc --noEmit` 通过 |
| 前端残留引用 | `api_local_favorite*` / `LocalFavoritesPage` / `local_favorites` 全库 0 处 |

> 「移动到收藏夹」这一步的上游接口是**存在但从未被上游使用**过的，所以我只能从服务端行为上确认路由存在；实际点击的效果需要你在真机上确认一次。如果移动失败，界面会弹出具体错误，把那行发我即可。
