/**
 * /purge 与 /unarchive 的可运行检查（含批量）。
 *
 * 这里不 mock 文件系统：用一个临时 DSH_HOME 造出与真实 DSH 相同的会话树结构
 * （sessions/<分组>/<会话 id>/session.v3.jsonl.zstd），再真跑一遍命令，
 * 断言最终的磁盘状态与归档集合。
 *
 * 运行：node test/purge.test.mjs
 */
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const tmp = join(here, 'fakehome')
process.env.DSH_HOME = tmp

/** 每个用例都用一个全新的 ctx，只共享磁盘上的会话树。 */
function makeCtx(initialArchived) {
  let archived = initialArchived.slice()
  const registered = {}
  return {
    registered,
    archived: () => archived,
    ctx: {
      effect: (fn) => { fn() },
      commands: { register: (def) => { registered[def.name] = def } },
      get: () => ({
        enqueueOperation: async (fn) => fn(),
        requireState: () => ({ archivedSessionIds: archived }),
        setState: async (s) => { archived = s.archivedSessionIds },
      }),
    },
  }
}

function makeSession(group, id, bytes) {
  const d = join(tmp, 'sessions', group, id)
  mkdirSync(d, { recursive: true })
  writeFileSync(join(d, 'session.v3.jsonl.zstd'), Buffer.alloc(bytes, 7))
  return d
}

let pass = 0
let fail = 0
function check(label, cond, extra = '') {
  if (cond) { pass += 1; console.log('  ✅ ' + label) }
  else { fail += 1; console.log('  ❌ ' + label + (extra ? '  → ' + extra : '')) }
}

rmSync(tmp, { recursive: true, force: true })
const mod = await import(pathToFileURL(join(here, '..', 'lib', 'index.js')).href)

// 造会话树：session-a 在两个分组下各有一份（会话移动过分组时真实存在）
const dA1 = makeSession('groupA', 'session-a', 100 * 1024)
const dA2 = makeSession('groupB', 'session-a', 100 * 1024)
const dB = makeSession('groupA', 'session-b', 50 * 1024)
const dC = makeSession('groupA', 'session-c', 25 * 1024)
const dKeep = makeSession('groupA', 'session-keep', 10 * 1024)

console.log('=== ① 单条删除：同一 id 的多份副本都要删掉 ===')
{
  const h = makeCtx(['session-a', 'session-keep'])
  mod.apply(h.ctx)
  const r = await h.registered['purge'].handler({ rawInput: 'session-a' })
  check('返回 success', r.kind === 'success', JSON.stringify(r))
  check('体积合计两份（200.0 KB）', /释放 200\.0 KB/.test(r.text), r.text)
  check('分组 A 副本已删', !existsSync(dA1))
  check('分组 B 副本已删', !existsSync(dA2))
  check('归档集合已移除', !h.archived().includes('session-a'), JSON.stringify(h.archived()))
  check('其他会话未受影响', existsSync(dKeep))
}

console.log('=== ② 批量删除：一条命令删多个，体积汇总 ===')
{
  const h = makeCtx(['session-b', 'session-c', 'session-keep'])
  mod.apply(h.ctx)
  const r = await h.registered['purge'].handler({ rawInput: 'session-b session-c' })
  check('返回 success', r.kind === 'success', JSON.stringify(r))
  check('报告删了 2 个', /已永久删除 2 个会话/.test(r.text), r.text)
  check('体积合计（75.0 KB）', /释放 75\.0 KB/.test(r.text), r.text)
  check('session-b 已删', !existsSync(dB))
  check('session-c 已删', !existsSync(dC))
  check('两者都已移出归档', !h.archived().includes('session-b') && !h.archived().includes('session-c'), JSON.stringify(h.archived()))
  check('未选中的仍在归档', h.archived().includes('session-keep'))
}

console.log('=== ③ 原子性：批次里有一个非法 id 就一个都不删 ===')
{
  makeSession('groupA', 'session-b', 50 * 1024)
  makeSession('groupA', 'session-c', 25 * 1024)
  const h = makeCtx(['session-b', 'session-c'])
  mod.apply(h.ctx)
  const r = await h.registered['purge'].handler({ rawInput: 'session-b ../../boom session-c' })
  check('整批被拒绝', r.kind === 'error', JSON.stringify(r))
  check('session-b 文件仍在', existsSync(dB))
  check('session-c 文件仍在', existsSync(dC))
  check('归档集合未被改动', h.archived().length === 2, JSON.stringify(h.archived()))
}

console.log('=== ④ 去重：同一个 id 写三遍只删一次、只计一次体积 ===')
{
  const dDup = makeSession('groupA', 'session-dup', 40 * 1024)
  const h = makeCtx(['session-dup'])
  mod.apply(h.ctx)
  const r = await h.registered['purge'].handler({ rawInput: 'session-dup  session-dup\nsession-dup' })
  check('返回 success', r.kind === 'success', JSON.stringify(r))
  check('只计一次体积（40.0 KB）', /释放 40\.0 KB/.test(r.text), r.text)
  check('目录已删', !existsSync(dDup))
}

console.log('=== ⑤ 幽灵条目：磁盘上没有的，也要移出归档列表 ===')
{
  const h = makeCtx(['session-ghost', 'session-keep'])
  mod.apply(h.ctx)
  const r = await h.registered['purge'].handler({ rawInput: 'session-ghost' })
  check('返回 success 并说明是幽灵', r.kind === 'success' && /移出列表/.test(r.text), JSON.stringify(r))
  check('幽灵条目已清除', !h.archived().includes('session-ghost'), JSON.stringify(h.archived()))
  check('真会话仍在归档', h.archived().includes('session-keep'))
}

console.log('=== ⑥ 只允许删归档集合里的会话 ===')
{
  const h = makeCtx([])
  mod.apply(h.ctx)
  const r = await h.registered['purge'].handler({ rawInput: 'session-keep' })
  check('拒绝删除未归档会话', r.kind === 'error', r.text)
  check('文件确实还在', existsSync(dKeep))
}

console.log('=== ⑦ 目录穿越防护 ===')
{
  const h = makeCtx(['session-x'])
  mod.apply(h.ctx)
  for (const bad of ['../../etc/passwd', 'session-../..', '/abs/path', 'session-x/../../../..']) {
    const r = await h.registered['purge'].handler({ rawInput: bad })
    check('拒绝 ' + JSON.stringify(bad), r.kind === 'error', JSON.stringify(r))
  }
  check('沙盒之外没有被触碰', existsSync(join(tmp, 'sessions')))
}

console.log('=== ⑧ 批量恢复 ===')
{
  const h = makeCtx(['session-r1', 'session-r2', 'session-r3'])
  mod.apply(h.ctx)
  const r = await h.registered['unarchive'].handler({ rawInput: 'session-r1 session-r2' })
  check('返回 success', r.kind === 'success', JSON.stringify(r))
  check('提示恢复 2 个', /已恢复 2 个会话/.test(r.text), r.text)
  check('只剩未被选中的那个', JSON.stringify(h.archived()) === '["session-r3"]', JSON.stringify(h.archived()))
}

console.log('=== ⑨ 参数防护 ===')
{
  const h = makeCtx(['session-y'])
  mod.apply(h.ctx)
  const empty = await h.registered['purge'].handler({ rawInput: '   ' })
  check('空参数给用法提示', empty.kind === 'error' && /用法/.test(empty.text), JSON.stringify(empty))
  const emptyU = await h.registered['unarchive'].handler({ rawInput: '' })
  check('unarchive 空参数也给提示', emptyU.kind === 'error' && /用法/.test(emptyU.text), JSON.stringify(emptyU))
  const huge = await h.registered['purge'].handler({
    rawInput: Array.from({ length: 1001 }, (_, i) => 'session-h' + i).join(' '),
  })
  check('超过上限被拒', huge.kind === 'error' && /最多处理/.test(huge.text), huge.text)
}

rmSync(tmp, { recursive: true, force: true })
console.log('')
console.log(fail === 0 ? '全部通过：' + pass + ' 项' : '失败 ' + fail + ' 项 / 共 ' + (pass + fail) + ' 项')
process.exit(fail === 0 ? 0 : 1)
