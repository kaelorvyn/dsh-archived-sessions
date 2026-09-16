/**
 * dsh-archived-sessions — 宿主半部。
 *
 * 注册两个人类命令：
 *   /unarchive <会话 id>  把会话从归档集合移除，使其重新可见（恢复 = 取消归档）
 *   /purge     <会话 id>  永久删除：把会话文件从磁盘上删掉，并移出归档集合
 *
 * 为什么是命令而不是自定义 Remote：
 * DSH 0.1.2-rc.1 没有公开的「取消归档」API（全仓无 unarchive*），也没有删除会话的
 * API。归档集合是工作区域全局状态，唯一写入点是 WorkspaceRegistry.setState()：
 *     await this.global.set(state)   // 持久化到 storages/workspace.json
 *     this.state = state             // 更新内存缓存
 * 域变更会被 api-workspace-controller 的 feed 广播为 archived 增量，前端随即实时
 * 更新，无需刷新页面。写入前用 typeof 守卫内部方法：接口变化时只报错、不改数据。
 *
 * 浏览器半部因此可以只用官方 `remote.commands` 通道，不必手写客户端 Typert 清单，
 * 加载失败的风险最低。
 *
 * 关于 /purge 的安全性（不可逆操作，底线不简化）：
 *   1. id 必须匹配 `^session-[A-Za-z0-9._-]+$` —— 从根上杜绝把 id 当路径用（目录穿越）；
 *   2. 解析后的绝对路径必须仍在会话根目录之内（二次防线，防符号链接等意外）；
 *   3. 只允许删除**已在归档集合里**的会话 —— 正在使用的会话不会被误伤；
 *   4. 删除后把 id 移出归档集合，避免界面留下一个指向空目录的幽灵条目。
 * 删除目标是会话自己的目录（内含 session.v3.jsonl.zstd 等），整目录删除。
 * DSH 没有会话索引数据库（列表是扫磁盘来的），所以删掉目录即彻底消失。
 */

import { existsSync, readdirSync, rmSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve, sep } from 'node:path'

/** 插件名（Loader 行 id 使用 archived-sessions）。 */
const name = 'archived-sessions'

/** 硬依赖：人类命令注册表。 */
const inject = ['commands']

/** 命令用法提示。 */
const USAGE = '用法：/unarchive <会话 id> [更多 id…]（会话 id 可在设置 → 已归档会话 中看到）'
const PURGE_USAGE = '用法：/purge <会话 id> [更多 id…]（会话 id 可在设置 → 已归档会话 中看到）'

/** 单次批量操作的 id 上限：防止畸形输入一次带走整库。 */
const MAX_BATCH = 1000

/** DSH 主目录：与启动器保持一致，允许 DSH_HOME 覆盖。 */
function dshHome() {
  const fromEnv = process.env.DSH_HOME
  return typeof fromEnv === 'string' && fromEnv.trim() !== '' ? fromEnv : join(homedir(), '.dsh')
}

/** 会话根目录（每个分组一个子目录，分组下每个会话一个以 id 命名的目录）。 */
function sessionsRoot() {
  return join(dshHome(), 'sessions')
}

/** 会话 id 白名单：必须是会话目录名，且不含路径分隔符 / 上跳 / 盘符。 */
const ID_PATTERN = /^session-[A-Za-z0-9._-]+$/

/**
 * 解析命令参数里的会话 id 列表（空白分隔，去重，保持输入顺序）。
 * 批量操作用一条命令而不是循环 N 次：一次校验、一次事务、一个总体积。
 * @returns {{ ids: string[] } | { error: string }}
 */
function parseIds(raw) {
  const parts = raw.split(/\s+/).filter((s) => s !== '')
  if (parts.length === 0) return { ids: [] }
  if (parts.length > MAX_BATCH) {
    return { error: '一次最多处理 ' + MAX_BATCH + ' 个会话，你给了 ' + parts.length + ' 个。' }
  }
  const seen = new Set()
  const ids = []
  for (const part of parts) {
    // 任何一个 id 不合法就整批拒绝：不做「删一半」这种事
    if (!ID_PATTERN.test(part)) {
      return { error: '会话 id 不合法：' + part + '（应形如 session-xxxxxxxx-...），未做任何修改。' }
    }
    if (seen.has(part)) continue
    seen.add(part)
    ids.push(part)
  }
  return { ids }
}

/** 把工作区服务取出来并确认内部接口齐全。 */
function requireRegistry(ctx) {
  const reg = ctx.get('workspaceRegistry')
  if (reg === undefined) return { error: '工作区服务不可用，未做任何修改。' }
  const usable = typeof reg.enqueueOperation === 'function'
    && typeof reg.requireState === 'function'
    && typeof reg.setState === 'function'
  if (!usable) return { error: '当前 DSH 版本的工作区服务内部接口已变化，为安全计未做任何修改。' }
  return { reg }
}

/** 从归档集合移除若干 id（一次事务写回）。 */
async function removeFromArchive(reg, ids) {
  const drop = new Set(ids)
  return reg.enqueueOperation(async () => {
    const state = reg.requireState()
    const before = state.archivedSessionIds
    const next = before.filter((id) => !drop.has(String(id)))
    if (next.length === before.length) return false
    await reg.setState({ ...state, archivedSessionIds: next })
    return true
  })
}

/**
 * 把目标会话从归档集合中移除（支持一次多个）。
 * @returns 命令结果（成功/失败文本）。
 */
async function unarchive(ctx, invocation) {
  const parsed = parseIds(invocation.rawInput)
  if (parsed.error !== undefined) return { kind: 'error', text: parsed.error }
  if (parsed.ids.length === 0) return { kind: 'error', text: USAGE }

  const looked = requireRegistry(ctx)
  if (looked.error !== undefined) return { kind: 'error', text: looked.error }

  try {
    const changed = await removeFromArchive(looked.reg, parsed.ids)
    if (changed !== true) return { kind: 'success', text: '这些会话不在归档集合中，无需恢复。' }
    return {
      kind: 'success',
      text: parsed.ids.length === 1
        ? '已恢复会话 ' + parsed.ids[0] + '，它已重新出现在原来的分组中。'
        : '已恢复 ' + parsed.ids.length + ' 个会话，它们已重新出现在原来的分组中。',
    }
  } catch (error) {
    return { kind: 'error', text: '恢复失败：' + messageOf(error) }
  }
}

function messageOf(error) {
  return error !== null && error !== undefined && error.message ? String(error.message) : String(error)
}

/** 人类可读的体积。 */
function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

/** 递归求和目录体积（失败按 0 计，不影响删除本身）。 */
function dirSize(dir) {
  let total = 0
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return 0
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    try {
      if (entry.isDirectory()) total += dirSize(full)
      else total += statSync(full).size
    } catch {
      // 单个文件读不到就跳过，不因为统计失败而中断删除
    }
  }
  return total
}

/**
 * 在会话根目录下找出所有名为 id 的会话目录。
 *
 * 同一个会话 id 可能在多个分组目录下各有一份（例如会话被移动过分组），
 * 所以这里返回数组，删除时必须**全部删掉**，否则会有残留。
 * 每个分组目录名只做一次浅扫描（分组是一级，会话是二级），不做全树递归。
 */
function findSessionDirs(id) {
  const root = resolve(sessionsRoot())
  const hits = []
  let groups
  try {
    groups = readdirSync(root, { withFileTypes: true })
  } catch {
    return hits
  }
  for (const group of groups) {
    if (!group.isDirectory()) continue
    const candidate = resolve(join(root, group.name, id))
    // 二次防线：必须仍在会话根目录之内，且确实是目录
    if (candidate !== root && !candidate.startsWith(root + sep)) continue
    if (!existsSync(candidate)) continue
    let isDir = false
    try {
      isDir = statSync(candidate).isDirectory()
    } catch {
      continue
    }
    if (isDir) hits.push(candidate)
  }
  return hits
}

/**
 * 永久删除若干个已归档会话：删磁盘目录 + 移出归档集合（支持一次多个）。
 * @returns 命令结果（成功/失败文本）。
 */
async function purge(ctx, invocation) {
  const parsed = parseIds(invocation.rawInput)
  if (parsed.error !== undefined) return { kind: 'error', text: parsed.error }
  if (parsed.ids.length === 0) return { kind: 'error', text: PURGE_USAGE }

  const looked = requireRegistry(ctx)
  if (looked.error !== undefined) return { kind: 'error', text: looked.error }

  // 只允许删除归档集合里的会话：正在用的会话不会被误删。
  let state
  try {
    state = looked.reg.requireState()
  } catch (error) {
    return { kind: 'error', text: '读取工作区状态失败：' + messageOf(error) }
  }
  const archived = Array.isArray(state.archivedSessionIds) ? state.archivedSessionIds.map(String) : []
  const inArchive = new Set(archived)
  const targets = parsed.ids.filter((id) => inArchive.has(id))
  const skipped = parsed.ids.filter((id) => !inArchive.has(id))
  if (targets.length === 0) {
    return { kind: 'error', text: '选中的会话都不在归档列表中，为安全计不做删除。' }
  }

  // 先把每个 id 对应的目录都找出来，再统一删：找不到的按「幽灵条目」处理
  const jobs = []
  const ghosts = []
  for (const id of targets) {
    const dirs = findSessionDirs(id)
    if (dirs.length === 0) ghosts.push(id)
    else jobs.push({ id, dirs })
  }

  let freed = 0
  let deleted = 0
  const failed = []
  for (const job of jobs) {
    let anyOk = false
    for (const dir of job.dirs) {
      freed += dirSize(dir)
      try {
        rmSync(dir, { recursive: true, force: true })
        anyOk = true
      } catch (error) {
        failed.push(job.id + '：' + messageOf(error))
      }
    }
    if (anyOk) deleted += 1
  }
  if (deleted === 0 && ghosts.length === 0) {
    return { kind: 'error', text: '删除失败（可能文件仍被占用）：' + (failed[0] !== undefined ? failed[0] : '未知原因') }
  }

  // 删成功的 + 磁盘上本来就没有的，一起移出归档集合，免得留下幽灵条目
  const clear = targets.filter((id) => !failed.some((f) => f.startsWith(id + '：')))
  try {
    await removeFromArchive(looked.reg, clear)
  } catch (error) {
    return {
      kind: 'error',
      text: '文件已删除（释放 ' + formatSize(freed) + '），但移出归档列表失败：' + messageOf(error)
        + '。可在列表里再点一次删除来清掉这些条目。',
    }
  }

  const bits = []
  bits.push('已永久删除 ' + deleted + ' 个会话，释放 ' + formatSize(freed) + '。')
  if (ghosts.length > 0) bits.push('另有 ' + ghosts.length + ' 个在磁盘上已经没有文件，已把它们移出列表。')
  if (skipped.length > 0) bits.push('跳过 ' + skipped.length + ' 个不在归档列表中的。')
  if (failed.length > 0) bits.push('有 ' + failed.length + ' 处删除失败：' + failed[0])
  return { kind: 'success', text: bits.join(' ') }
}

/** 宿主插件主体：注册 /unarchive 与 /purge。 */
function apply(ctx) {
  ctx.effect(() => ctx.commands.register({
    name: 'unarchive',
    description: '恢复（取消归档）一个已归档会话，使其重新可见',
    input: { hint: '会话 id' },
    handler: (invocation) => unarchive(ctx, invocation),
  }), 'archived-sessions: /unarchive')

  ctx.effect(() => ctx.commands.register({
    name: 'purge',
    description: '永久删除一个已归档会话（从磁盘上删掉会话文件，不可恢复）',
    input: { hint: '会话 id' },
    handler: (invocation) => purge(ctx, invocation),
  }), 'archived-sessions: /purge')
}

export { apply, inject, name }
