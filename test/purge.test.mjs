/**
 * /archive、/unarchive、/purge 的可运行检查。
 *
 * 不 mock 文件系统：用一个临时 DSH_HOME + 临时 CODEX_HOME 造出与真实环境相同的
 * 目录结构（DSH 的 sessions/<分组>/<会话 id>/，以及 Codex 的
 * sessions/<年>/<月>/<日>/rollout-<时间>-<uuid>.jsonl 与 archived_sessions/ 平铺），
 * 再真跑命令，断言最终的磁盘状态与归档集合。
 *
 * 运行：node test/purge.test.mjs
 */
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const tmp = join(here, 'fakehome')
const codexTmp = join(here, 'fakecodex')
process.env.DSH_HOME = tmp
process.env.CODEX_HOME = codexTmp

/** 每个用例一个全新的 ctx，只共享磁盘上的目录树。 */
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

/** 造一个 Codex 源文件：sessions/<年>/<月>/<日>/rollout-<时间>-<uuid>.jsonl */
function makeCodexSource(uuid, bytes, where = 'sessions') {
  const d = where === 'sessions'
    ? join(codexTmp, 'sessions', '2026', '08', '05')
    : join(codexTmp, 'archived_sessions')
  mkdirSync(d, { recursive: true })
  const f = join(d, 'rollout-2026-08-05T01-46-28-' + uuid + '.jsonl')
  writeFileSync(f, Buffer.alloc(bytes, 3))
  return f
}

let pass = 0
let fail = 0
function check(label, cond, extra = '') {
  if (cond) { pass += 1; console.log('  ✅ ' + label) }
  else { fail += 1; console.log('  ❌ ' + label + (extra ? '  → ' + extra : '')) }
}

rmSync(tmp, { recursive: true, force: true })
rmSync(codexTmp, { recursive: true, force: true })
const mod = await import(pathToFileURL(join(here, '..', 'lib', 'index.js')).href)

// ── 固定装置 ──────────────────────────────────────────────────────────
const dA1 = makeSession('groupA', 'session-a', 100 * 1024)   // 双副本
const dA2 = makeSession('groupB', 'session-a', 100 * 1024)
const dB = makeSession('groupA', 'session-b', 50 * 1024)
const dC = makeSession('groupA', 'session-c', 25 * 1024)
const dKeep = makeSession('groupA', 'session-keep', 10 * 1024)
const uuid = '019fcd7f-b06f-73d3-beaf-f2ddec6dea52'
const codexId = 'session-codex-' + uuid
const dCodex = makeSession('groupA', codexId, 80 * 1024)
const srcNested = makeCodexSource(uuid, 300 * 1024, 'sessions')
const srcArchived = makeCodexSource(uuid, 200 * 1024, 'archived_sessions')

console.log('=== ① 单条删除：同一 id 的多份副本都要删掉 ===')
{
  const h = makeCtx(['session-a', 'session-keep'])
  mod.apply(h.ctx)
  const r = await h.registered['purge'].handler({ rawInput: 'session-a' })
  check('返回 success', r.kind === 'success', JSON.stringify(r))
  check('体积合计两份（200.0 KB）', /释放 200\.0 KB/.test(r.text), r.text)
  check('分组 A 副本已删', !existsSync(dA1))
  check('分组 B 副本已删', !existsSync(dA2))
  check('其他会话未受影响', existsSync(dKeep))
}

console.log('=== ② 【回归】删除后必须仍然归档 —— 否则会话会全部回到侧边栏 ===')
{
  const h = makeCtx(['session-b', 'session-keep'])
  mod.apply(h.ctx)
  await h.registered['purge'].handler({ rawInput: 'session-b' })
  check('session-b 仍留在归档集合里', h.archived().includes('session-b'), JSON.stringify(h.archived()))
  check('文件确实已被删除', !existsSync(dB))
  check('其他归档条目未受影响', h.archived().includes('session-keep'))

  // 这正是当初出事的写法：移出归档 = 取消隐藏
  const h2 = makeCtx(['session-keep'])
  mod.apply(h2.ctx)
  const before = h2.archived().length
  await h2.registered['purge'].handler({ rawInput: 'session-keep' })
  check('删除不在归档里的会话被拒绝（集合长度不变）', h2.archived().length === before, JSON.stringify(h2.archived()))
}

console.log('=== ③ Codex 导入的会话：源文件必须一起删 ===')
{
  makeSession('groupA', codexId, 80 * 1024)
  const h = makeCtx([codexId])
  mod.apply(h.ctx)
  const r = await h.registered['purge'].handler({ rawInput: codexId })
  check('返回 success', r.kind === 'success', JSON.stringify(r))
  check('DSH 副本已删', !existsSync(dCodex))
  check('Codex 源文件（sessions 嵌套）已删', !existsSync(srcNested))
  check('Codex 源文件（archived_sessions）已删', !existsSync(srcArchived))
  check('提示了源文件也一并删掉', /源文件也一并删掉/.test(r.text), r.text)
  check('体积含源文件（580.0 KB）', /释放 580\.0 KB/.test(r.text), r.text)
  check('仍保持归档', h.archived().includes(codexId))
}

console.log('=== ④ 批量删除：一条命令删多个，体积汇总 ===')
{
  makeSession('groupA', 'session-b', 50 * 1024)
  makeSession('groupA', 'session-c', 25 * 1024)
  const h = makeCtx(['session-b', 'session-c'])
  mod.apply(h.ctx)
  const r = await h.registered['purge'].handler({ rawInput: 'session-b session-c' })
  check('返回 success', r.kind === 'success', JSON.stringify(r))
  check('报告删了 2 个', /已永久删除 2 个会话/.test(r.text), r.text)
  check('体积合计（75.0 KB）', /释放 75\.0 KB/.test(r.text), r.text)
  check('两者仍保持归档', h.archived().includes('session-b') && h.archived().includes('session-c'), JSON.stringify(h.archived()))
}

console.log('=== ⑤ 原子性：批次里有一个非法 id 就一个都不删 ===')
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

console.log('=== ⑥ 去重：同一个 id 写三遍只删一次 ===')
{
  const dDup = makeSession('groupA', 'session-dup', 40 * 1024)
  const h = makeCtx(['session-dup'])
  mod.apply(h.ctx)
  const r = await h.registered['purge'].handler({ rawInput: 'session-dup  session-dup\nsession-dup' })
  check('只计一次体积（40.0 KB）', /释放 40\.0 KB/.test(r.text), r.text)
  check('目录已删', !existsSync(dDup))
}

console.log('=== ⑦ 磁盘上没有文件的条目，保持归档而不是被放出来 ===')
{
  const h = makeCtx(['session-ghost', 'session-keep'])
  mod.apply(h.ctx)
  const r = await h.registered['purge'].handler({ rawInput: 'session-ghost' })
  check('返回 success 并说明情况', r.kind === 'success' && /保持归档/.test(r.text), JSON.stringify(r))
  check('幽灵条目仍在归档（没有被放回列表）', h.archived().includes('session-ghost'), JSON.stringify(h.archived()))
}

console.log('=== ⑧ /archive：把会话加进归档集合 ===')
{
  const h = makeCtx(['session-x'])
  mod.apply(h.ctx)
  const r = await h.registered['archive'].handler({ rawInput: 'session-y session-z' })
  check('返回 success', r.kind === 'success', JSON.stringify(r))
  check('提示归档 2 个', /已归档 2 个会话/.test(r.text), r.text)
  check('两个都在集合里了', h.archived().includes('session-y') && h.archived().includes('session-z'), JSON.stringify(h.archived()))
  check('原有的没被挤掉', h.archived().includes('session-x'))
  const again = await h.registered['archive'].handler({ rawInput: 'session-y' })
  check('重复归档不报错也不重复添加', again.kind === 'success' && h.archived().filter((x) => x === 'session-y').length === 1, JSON.stringify(h.archived()))
}

console.log('=== ⑨ /unarchive 与批量恢复 ===')
{
  const h = makeCtx(['session-r1', 'session-r2', 'session-r3'])
  mod.apply(h.ctx)
  const r = await h.registered['unarchive'].handler({ rawInput: 'session-r1 session-r2' })
  check('返回 success', r.kind === 'success', JSON.stringify(r))
  check('提示恢复 2 个', /已恢复 2 个会话/.test(r.text), r.text)
  check('只剩未被选中的那个', JSON.stringify(h.archived()) === '["session-r3"]', JSON.stringify(h.archived()))
}

console.log('=== ⑩ 目录穿越防护（DSH 侧与 Codex 侧）===')
{
  const h = makeCtx(['session-x'])
  mod.apply(h.ctx)
  for (const bad of ['../../etc/passwd', 'session-../..', '/abs/path', 'session-x/../../../..', 'session-codex-../../x']) {
    const r = await h.registered['purge'].handler({ rawInput: bad })
    check('拒绝 ' + JSON.stringify(bad), r.kind === 'error', JSON.stringify(r))
  }
  const weird = await h.registered['purge'].handler({ rawInput: 'session-codex-..' })
  check('拒绝带点的 codex uuid', weird.kind === 'error', JSON.stringify(weird))
  check('沙盒之外没有被触碰', existsSync(join(tmp, 'sessions')) && existsSync(join(codexTmp, 'sessions')))
}

console.log('=== ⑪ 参数防护 ===')
{
  const h = makeCtx(['session-y'])
  mod.apply(h.ctx)
  const empty = await h.registered['purge'].handler({ rawInput: '   ' })
  check('purge 空参数给用法提示', empty.kind === 'error' && /用法/.test(empty.text), JSON.stringify(empty))
  const emptyA = await h.registered['archive'].handler({ rawInput: '' })
  check('archive 空参数给用法提示', emptyA.kind === 'error' && /用法/.test(emptyA.text), JSON.stringify(emptyA))
  const huge = await h.registered['purge'].handler({
    rawInput: Array.from({ length: 1001 }, (_, i) => 'session-h' + i).join(' '),
  })
  check('超过上限被拒', huge.kind === 'error' && /最多处理/.test(huge.text), huge.text)
}

rmSync(tmp, { recursive: true, force: true })
rmSync(codexTmp, { recursive: true, force: true })
console.log('')
console.log(fail === 0 ? '全部通过：' + pass + ' 项' : '失败 ' + fail + ' 项 / 共 ' + (pass + fail) + ' 项')
process.exit(fail === 0 ? 0 : 1)
