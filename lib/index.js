/**
 * dsh-archived-sessions — 宿主半部。
 *
 * 注册人类命令 `/unarchive <会话 id>`：把该会话从工作区注册表的归档集合中移除，
 * 使它在界面上重新可见（恢复 = 取消归档）。
 *
 * 为什么这样写：DSH 0.1.2-rc.1 没有公开的「取消归档」API（全仓无 unarchive*）。
 * 归档集合是工作区域全局状态，唯一写入点是 WorkspaceRegistry.setState()：
 *     await this.global.set(state)   // 持久化到 storages/workspace.json
 *     this.state = state             // 更新内存缓存
 * 域变更会被 api-workspace-controller 的 feed 广播为 archived 增量，前端随即实时
 * 更新，无需刷新页面。写入前用 typeof 守卫内部方法：接口变化时只报错、不改数据。
 *
 * 命令而非自定义 Remote：浏览器半部因此可以只用官方 `remote.commands` 通道，
 * 不必手写客户端 Typert 清单，加载失败的风险最低。
 */

/** 插件名（Loader 行 id 使用 archived-sessions）。 */
const name = 'archived-sessions'

/** 硬依赖：人类命令注册表。 */
const inject = ['commands']

/** 命令用法提示。 */
const USAGE = '用法：/unarchive <会话 id>（会话 id 可在设置 → 已归档会话 中看到）'

/**
 * 把目标会话从归档集合中移除。
 * @returns 命令结果（成功/失败文本）。
 */
async function unarchive(ctx, invocation) {
  const target = invocation.rawInput.trim()
  if (target === '') return { kind: 'error', text: USAGE }

  const reg = ctx.get('workspaceRegistry')
  if (reg === undefined) return { kind: 'error', text: '工作区服务不可用，未做任何修改。' }
  const usable = typeof reg.enqueueOperation === 'function'
    && typeof reg.requireState === 'function'
    && typeof reg.setState === 'function'
  if (!usable) return { kind: 'error', text: '当前 DSH 版本的工作区服务内部接口已变化，为安全计未做任何修改。' }

  try {
    const changed = await reg.enqueueOperation(async () => {
      const state = reg.requireState()
      const before = state.archivedSessionIds
      const next = before.filter((id) => String(id) !== target)
      if (next.length === before.length) return false
      await reg.setState({ ...state, archivedSessionIds: next })
      return true
    })
    if (changed !== true) return { kind: 'success', text: '该会话不在归档集合中，无需恢复。' }
    return { kind: 'success', text: '已恢复会话 ' + target + '，它已重新出现在原来的分组中。' }
  } catch (error) {
    const message = error !== null && error !== undefined && error.message ? String(error.message) : String(error)
    return { kind: 'error', text: '恢复失败：' + message }
  }
}

/** 宿主插件主体：注册 /unarchive。 */
function apply(ctx) {
  ctx.effect(() => ctx.commands.register({
    name: 'unarchive',
    description: '恢复（取消归档）一个已归档会话，使其重新可见',
    input: { hint: '会话 id' },
    handler: (invocation) => unarchive(ctx, invocation),
  }), 'archived-sessions: /unarchive')
}

export { apply, inject, name }
