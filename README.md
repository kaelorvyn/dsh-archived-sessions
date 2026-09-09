# dsh-archived-sessions

[![dsh-plugin](https://img.shields.io/badge/dsh-plugin-blue)](https://github.com/topics/dsh-plugin)

设置面板新增一页「已归档会话」：列出全部已归档会话，每条可一键恢复（取消归档）。

Adds an **Archived sessions** page to the DSH settings panel: it lists every archived session and restores one with a single click.

## 功能 / Features

- 在 设置 → 已归档会话 中列出全部已归档会话，显示标题、工作目录与最近活动时间。
- 每条带「恢复」按钮；恢复后该条立即从列表消失，会话重新出现在它原来的分组中。
- 实时生效：恢复后无需刷新页面，侧边栏与列表同步更新。
- 归档数据持久化在 DSH 自己的工作区注册表里，重启后不反弹。

- Lists every archived session (title, working directory, last activity) under **Settings → Archived sessions**.
- One **Restore** button per row; the row disappears and the session reappears in its original group.
- Live update: no page refresh needed after a restore.
- The archive set lives in DSH's own workspace registry, so a restore survives a restart.

## 安装 / Install

```sh
dsh plugin --profile <profile> add github:<owner>/dsh-archived-sessions
```

或从本仓库本地安装 / or from a local checkout:

```sh
dsh plugin --profile <profile> add file:<path-to-this-repo>
```

安装后重启 DSH，打开 设置 → 已归档会话。  
Restart DSH after installing, then open **Settings → Archived sessions**.

## 使用 / Usage

1. 打开任意会话（恢复动作通过宿主命令执行，需要当前会话存在）。
2. 进入 设置 → 已归档会话。
3. 点某条的「恢复」。

1. Open any session (the restore action runs a host command inside the current session).
2. Go to **Settings → Archived sessions**.
3. Click **Restore** on a row.

命令方式 / Command form（等效）:

```
/unarchive <session-id>
```

## 实现说明 / How it works

DSH 0.1.2-rc.1 没有公开的「取消归档」API —— 归档集合是工作区注册表的持久状态
（`storages/workspace.json` 的 `global.archivedSessionIds`），只有 `archiveSession()`
一个写入口，没有反向方法。本插件的宿主半部注册命令 `/unarchive`，在
`WorkspaceRegistry.enqueueOperation()` 内用 `setState()` 把目标 id 从该集合中移除；
域变更会经工作区控制器的 feed 广播为 `archived` 增量，前端随即实时更新。

`setState` / `requireState` / `enqueueOperation` 是服务实例上的方法而非公开契约，
因此宿主半部在写入前用 `typeof` 守卫：若未来版本改变了这些内部接口，插件只返回
明确错误，不会修改任何数据。浏览器半部只用官方 `remote.commands` 通道，不含
自定义 Remote 清单。

DSH 0.1.2-rc.1 exposes no public "unarchive" API: the archive set is durable workspace
registry state (`global.archivedSessionIds` in `storages/workspace.json`) with a single
write path, `archiveSession()`, and no inverse. This plugin's host half registers the
`/unarchive` command and, inside `WorkspaceRegistry.enqueueOperation()`, removes the
target id with `setState()`. The workspace controller broadcasts the resulting domain
change as an `archived` increment, so the browser updates live.

`setState` / `requireState` / `enqueueOperation` are service-instance methods rather
than a public contract, so the host half guards them with `typeof` checks: if a future
DSH version changes them, the plugin reports a clear error instead of touching data.
The browser half only uses the official `remote.commands` channel and ships no custom
Remote manifest.

## 结构 / Layout

```
cordis.patch.yml   # 挂载宿主行的 bundle patch
lib/index.js       # 宿主半部：注册 /unarchive
lib/client.js      # 浏览器半部：设置页 + 一键恢复
```

## 兼容性 / Compatibility

在 DSH `0.1.2-rc.1` 上开发与验证（`dsh-plugin-desktop` 2.0.5）。  
Developed and verified on DSH `0.1.2-rc.1` (`dsh-plugin-desktop` 2.0.5).

## 许可 / License

MIT
