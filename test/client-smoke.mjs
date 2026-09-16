/**
 * 浏览器半部的可运行检查。
 *
 * stub 掉 window.__ModuleLoader__ 与 react，真求值 bundle、跑 factory、调 apply，
 * 并把组件**真正渲染一遍**，确认多选工具条与批量按钮都在。
 *
 * 技巧：stub 的 useState 对布尔初值返回 true —— 组件里唯一的布尔状态就是
 * 「是否处于多选模式」，所以这样能直接把多选模式渲染出来。
 *
 * 运行：node test/client-smoke.mjs
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(here, '..', 'lib', 'client.js'), 'utf8')

let loaded = null
globalThis.window = { __ModuleLoader__: { load: (def) => { loaded = def } } }

const nodes = []
const react = {
  createElement: (type, props, children) => {
    nodes.push({ type, props, children })
    return { type, props, children }
  },
  useState: (initial) => [typeof initial === 'boolean' ? true : initial, () => {}],
  useMemo: (fn) => fn(),
  Fragment: 'Fragment',
}
const requireShim = (name) => {
  if (name === 'react') return react
  throw new Error('未预期的模块：' + name)
}

let pass = 0
let fail = 0
function check(label, cond, extra = '') {
  if (cond) { pass += 1; console.log('  ✅ ' + label) }
  else { fail += 1; console.log('  ❌ ' + label + (extra ? '  → ' + extra : '')) }
}

/** 渲染结果里所有按钮的可见文字。 */
function buttonLabels() {
  const out = []
  for (const node of nodes) {
    if (node.type !== 'button') continue
    const kids = node.children
    if (typeof kids === 'string') out.push(kids)
    else if (Array.isArray(kids)) for (const k of kids) if (typeof k === 'string') out.push(k)
  }
  return out
}

const boxes = () => nodes.filter((n) => n.type === 'input' && n.props !== undefined && n.props.type === 'checkbox')
const spans = () => nodes.filter((n) => n.type === 'span').map((n) => n.children).filter((c) => typeof c === 'string')

console.log('=== ① bundle 求值与导出 ===')
try {
  new Function('window', 'require', src)(globalThis.window, requireShim)
  check('bundle 能求值', true)
} catch (e) { check('bundle 能求值', false, e.message) }

check('注册了插件 id', loaded !== null && loaded.id === 'dsh-archived-sessions', loaded ? loaded.id : 'null')
check('factory 存在', loaded !== null && typeof loaded.factory === 'function')

let exp = null
try {
  exp = loaded.factory(requireShim)
  check('factory 执行成功', true)
} catch (e) { check('factory 执行成功', false, e.message) }

check('导出 apply', exp !== null && typeof exp.apply === 'function')
check('inject 含 slots/remote/remote.commands',
  exp !== null && ['slots', 'remote', 'remote.commands'].every((k) => exp.inject.includes(k)),
  exp ? JSON.stringify(exp.inject) : '')

console.log('=== ② apply 注册设置页 ===')
let section = null
try {
  exp.apply({
    slots: {
      inject: (name, fn) => fn(),
      register: (def, comp) => { section = { def, comp } },
    },
    remote: { commands: { execute: () => Promise.resolve(null) } },
  })
  check('apply 不抛错', true)
} catch (e) { check('apply 不抛错', false, e.message) }

check('注册到 settings.section', section !== null && section.def.name === 'settings.section', section ? section.def.name : 'null')
check('页面标签为「已归档会话」', section !== null && section.def.label === '已归档会话', section ? section.def.label : '')
check('有 order 排序', section !== null && typeof section.def.order === 'number')

console.log('=== ③ 渲染多选模式（useState 布尔初值 → true）===')
const byId = {
  'session-1': { displayTitle: '第一个会话', cwd: 'D:\\a', updatedAt: 1757000000000 },
  'session-2': { displayTitle: '第二个会话', cwd: 'D:\\b', updatedAt: 1757000001000 },
}
try {
  nodes.length = 0
  section.comp({
    useWorkspaces: (sel) => sel({ archivedSessionIds: ['session-1', 'session-2', 'session-current'] }),
    useSessions: (sel) => sel({ current: 'session-current', byId }),
  })
  check('渲染不抛错', true)
} catch (e) { check('渲染不抛错', false, e.message) }

const labels = buttonLabels()
check('处于多选模式（按钮为「退出多选」）', labels.includes('退出多选'), JSON.stringify(labels))
check('有「全选」', labels.includes('全选'), JSON.stringify(labels))
check('有「批量恢复」', labels.includes('批量恢复'), JSON.stringify(labels))
check('有「永久删除」', labels.includes('永久删除'), JSON.stringify(labels))
check('显示已选数量', spans().some((t) => /已选 \d+ 个/.test(t)), JSON.stringify(spans()))
check('每行一个复选框', boxes().length === 3, '实际 ' + boxes().length + ' 个')
check('当前会话的复选框被禁用',
  boxes().filter((b) => b.props.disabled === true).length === 1,
  '实际 ' + boxes().filter((b) => b.props.disabled === true).length + ' 个')
check('多选模式下不渲染单行动作按钮', !labels.includes('恢复'), JSON.stringify(labels))
check('当前会话有「当前会话」标记', spans().includes('当前会话'), JSON.stringify(spans()))

console.log('=== ④ 空列表不崩 ===')
try {
  nodes.length = 0
  section.comp({
    useWorkspaces: (sel) => sel({ archivedSessionIds: [] }),
    useSessions: (sel) => sel({ current: 'x', byId: {} }),
  })
  check('空列表能渲染', nodes.length > 0)
  check('空列表无复选框', boxes().length === 0)
} catch (e) { check('空列表能渲染', false, e.message) }

console.log('=== ⑤ 源码特征 ===')
check('批量用一条命令带多个 id', src.includes('ids.join(" ")'))
check('含批量恢复', src.includes('批量恢复'))
check('含确认删除数量', src.includes('确认删除 " + pickedIds.length'))
check('含全选', src.includes('全选'))
check('含 /unarchive', src.includes('unarchive'))
check('含 /purge', src.includes('purge'))
check('当前会话不参与多选', src.includes('selectableIds'))

console.log('')
console.log(fail === 0 ? '全部通过：' + pass + ' 项' : '失败 ' + fail + ' 项 / 共 ' + (pass + fail) + ' 项')
process.exit(fail === 0 ? 0 : 1)
