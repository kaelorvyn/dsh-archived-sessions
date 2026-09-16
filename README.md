# dsh-archived-sessions

[![dsh-plugin](https://img.shields.io/badge/dsh-plugin-blue)](https://github.com/topics/dsh-plugin)

设置面板新增一页「已归档会话」：列出全部已归档会话，可单条或**批量**恢复（取消归档），
也可以**永久删除** —— 直接从电脑上删掉会话文件，把硬盘空间要回来。

Adds an **Archived sessions** page to the DSH settings panel: it lists every archived session and can restore them (one or many) or **permanently delete** them — removing the session files from disk to reclaim space.

## 功能 / Features

- 在 设置 → 已归档会话 中列出全部已归档会话，显示标题、工作目录与最近活动时间。
- **恢复**：取消归档，该条立即从列表消失，会话重新出现在它原来的分组中。
- **永久删除**：把会话文件从磁盘上删掉，并显示这次释放了多少空间。
- **多选与批量**：点顶部「多选」后每行出现复选框，上方提供「全选 / 批量恢复 / 永久删除」。
- 实时生效：操作后无需刷新页面，侧边栏与列表同步更新。
- 归档数据持久化在 DSH 自己的工作区注册表里，重启后不反弹。

- Lists every archived session (title, working directory, last activity) under **Settings → Archived sessions**.
- **Restore**: unarchives it; the row disappears and the session reappears in its original group.
- **Delete permanently**: removes the session files from disk and reports how much space was freed.
- **Multi-select & batch**: hit **Multi-select** at the top, checkboxes appear on every row, and a bar offers **Select all / Restore selected / Delete permanently**.
- Live update: no page refresh needed.
- The archive set lives in DSH's own workspace registry, so a restore survives a restart.

## 安装 / Install

```sh
dsh plugin --profile <profile> add github:kaelorvyn/dsh-archived-sessions
```

或从本仓库本地安装 / or from a local checkout:

```sh
dsh plugin --profile <profile> add file:<path-to-this-repo>
```

安装后重启 DSH，打开 设置 → 已归档会话。  
Restart DSH after installing, then open **Settings → Archived sessions**.

## 使用 / Usage

1. 打开任意会话（两个动作都通过宿主命令执行，需要当前会话存在）。
2. 进入 设置 → 已归档会话。
3. 单条：点某行的「恢复」或「永久删除」。
   批量：点顶部「多选」→ 勾选若干行（或「全选」）→ 点「批量恢复」或「永久删除」。

1. Open any session (both actions run a host command inside the current session).
2. Go to **Settings → Archived sessions**.
3. One row: click **Restore** or **Delete permanently**.
   Batch: click **Multi-select** at the top → check rows (or **Select all**) → click **Restore selected** or **Delete permanently**.

命令方式 / Command form（等效，可一次给多个 id）:

```
/archive   <session-id> [more-ids…]
/unarchive <session-id> [more-ids…]
/purge     <session-id> [more-ids…]
```

## 永久删除做了什么 / What "delete permanently" does

会话在磁盘上是 `~/.dsh/sessions/<分组编码>/<会话id>/`（内含 `session.v3.jsonl.zstd`）。
会话 id 本身就带 `session-` 前缀，目录名就是 id。

A session lives at `~/.dsh/sessions/<group>/<session-id>/` (containing `session.v3.jsonl.zstd`); the id already carries the `session-` prefix and is the directory name.

- **整目录删除**，并报告释放的体积。
  Removes the whole directory and reports the freed size.
- 同一个 id 可能在**多个分组目录下各有一份**（会话移动过分组时会发生），所以会把**所有**同名目录都删掉，不留残留。
  The same id can exist under **several group directories** (which happens when a session was moved between groups), so **every** matching directory is removed — no leftovers.
- **从 Codex 导入的会话，源文件也一并删掉。** DSH 里那些 `session-codex-<uuid>` 是从
  `~/.codex/` 导入的（`sessions/<年>/<月>/<日>/rollout-<时间>-<uuid>.jsonl`，或
  `archived_sessions/` 下平铺）。只删 DSH 的副本，下一次导入会把会话原样带回来 ——
  用户看到的就是「永久删除了怎么又全回来了」。而且源文件那边通常大得多
  （实测 605MB vs 191MB），不删也谈不上省空间。
  **Sessions imported from Codex have their source file deleted too.** Those
  `session-codex-<uuid>` entries are imported from `~/.codex/`; deleting only DSH's copy
  means the next import brings the session straight back. The source is usually much
  larger anyway (measured: 605 MB vs 191 MB).
- **删除不改变可见性。** 删完会话**仍然留在归档集合里**（否则就等于取消隐藏，
  它们会当场全部回到侧边栏）。想让它重新可见，用「恢复」。
  **Deleting does not change visibility.** A deleted session **stays archived**;
  otherwise the deletion would effectively un-hide it and every one of them would
  reappear in the sidebar at once. Use **Restore** to make it visible again.
- 磁盘上已经没有文件的条目按「幽灵条目」处理：保持归档，不报错。
  Entries with no files on disk are treated as ghosts: they stay archived, without an error.
- DSH 没有会话索引数据库（列表是扫磁盘得来的），所以删掉目录就是彻底消失。
  DSH keeps no session index database (the list is built by scanning the disk), so deleting the directory is enough.

### 安全设计 / Safety

删除不可逆，所以做了这些防护：

Deletion is irreversible, so:

1. 会话 id 必须匹配 `^session-[A-Za-z0-9._-]+$` —— 从根上杜绝把 id 当路径用（目录穿越）。
   The id must match `^session-[A-Za-z0-9._-]+$`, which rules out path traversal at the source.
2. 解析后的绝对路径必须仍在会话根目录之内（二次防线）。
   The resolved absolute path must still be inside the sessions root.
3. **只允许删除归档集合里的会话** —— 正在使用的会话结构上就删不到。
   Only sessions in the archive set can be deleted; the session in use cannot be reached at all.
4. 界面里正在使用的会话不参与多选，也不给删除按钮。
   In the UI, the session in use cannot be selected and gets no delete button.
5. 删除按钮要点两次（「永久删除」→「确认删除」），中途可取消。
   The delete button must be clicked twice, with a cancel in between.
6. 批量时**只要有一个 id 不合法就整批拒绝**，不做「删一半」。
   In a batch, one invalid id rejects the whole batch — no half-done deletes.
7. 单次最多 1000 个 id。
   At most 1000 ids per call.

## 实现说明 / How it works

DSH 0.1.2-rc.1 没有公开的「取消归档」或「删除会话」API —— 归档集合是工作区注册表的持久状态
（`storages/workspace.json` 的 `global.archivedSessionIds`），只有 `archiveSession()`
一个写入口，没有反向方法。本插件的宿主半部注册 `/unarchive` 与 `/purge` 两个命令，
在 `WorkspaceRegistry.enqueueOperation()` 内用 `setState()` 修改该集合；
域变更会经工作区控制器的 feed 广播为 `archived` 增量，前端随即实时更新。

`setState` / `requireState` / `enqueueOperation` 是服务实例上的方法而非公开契约，
因此宿主半部在写入前用 `typeof` 守卫：若未来版本改变了这些内部接口，插件只返回
明确错误，不会修改任何数据。浏览器半部只用官方 `remote.commands` 通道，不含
自定义 Remote 清单。

批量是**一条命令带多个 id**，而不是循环调用：宿主侧一次校验、一次事务、汇总一个总体积。

DSH 0.1.2-rc.1 exposes no public "unarchive" or "delete session" API: the archive set is
durable workspace registry state (`global.archivedSessionIds` in `storages/workspace.json`)
with a single write path, `archiveSession()`, and no inverse. This plugin's host half
registers `/unarchive` and `/purge`; inside `WorkspaceRegistry.enqueueOperation()` it
changes that set with `setState()`. The workspace controller broadcasts the resulting
domain change as an `archived` increment, so the browser updates live.

`setState` / `requireState` / `enqueueOperation` are service-instance methods rather than
a public contract, so the host half guards them with `typeof` checks: if a future DSH
version changes them, the plugin reports a clear error instead of touching data.
The browser half only uses the official `remote.commands` channel and ships no custom
Remote manifest.

A batch is **one command carrying many ids**, not a loop: the host validates once, commits
once, and reports a single total size.

## 结构 / Layout

```
cordis.patch.yml        # 挂载宿主行的 bundle patch
lib/index.js            # 宿主半部：注册 /unarchive 与 /purge
lib/client.js           # 浏览器半部：设置页 + 恢复 / 永久删除 / 多选批量
test/purge.test.mjs     # 宿主半部检查（含原子性、去重、目录穿越防护）
test/client-smoke.mjs   # 浏览器半部检查（真求值 bundle 并渲染多选模式）
```

跑测试 / Run the tests:

```sh
node test/purge.test.mjs
node test/client-smoke.mjs
```

两个脚本都不依赖任何测试框架，只用 Node 标准库；`purge` 那个会在 `test/fakehome/`
下造一个临时的 DSH 主目录来真跑删除，结束后自行清理。

Both scripts are plain Node with no test framework; the purge one builds a throwaway DSH
home under `test/fakehome/`, exercises real deletions, and cleans up afterwards.

## 兼容性 / Compatibility

在 DSH `0.1.2-rc.1` 上开发与验证（`dsh-plugin-desktop` 2.0.5）。  
Developed and verified on DSH `0.1.2-rc.1` (`dsh-plugin-desktop` 2.0.5).

## 许可 / License

MIT
