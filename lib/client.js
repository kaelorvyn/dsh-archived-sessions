/**
 * dsh-archived-sessions — 浏览器半部。
 *
 * 注册设置面板的「已归档会话」页：列出全部已归档会话，可单条或批量「恢复」/「永久删除」。
 * 列表数据全部来自插槽标准 props（useWorkspaces / useSessions）；动作经官方
 * `remote.commands` 通道执行宿主命令（/unarchive、/purge）。
 *
 * 批量是**一条命令带多个 id**，不是循环调 N 次：宿主侧一次校验、一次事务、
 * 汇总一个总体积。135 个会话一条命令搞定。
 *
 * 永久删除不可逆，所以界面上做了三道防误触：
 *   1. 要先点「多选」才出现复选框（平时不误勾）；
 *   2. 删除按钮要点两次（「永久删除」→「确认删除」），中途可「取消」；
 *   3. 当前正在使用的会话不参与多选，也不给删除按钮 —— 宿主侧也只允许删归档集合里的会话。
 *
 * 手写 bundle，格式与官方客户端插件一致（window.__ModuleLoader__.load），
 * 只 require 平台种子模块，不依赖打包工具。
 */

window.__ModuleLoader__.load({
	id: "dsh-archived-sessions",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");

		const S = {
			wrap: { display: "flex", flexDirection: "column", gap: "12px" },
			head: { fontSize: "13px", lineHeight: "20px", color: "var(--dsw-alias-text-secondary, #666)" },
			empty: { fontSize: "13px", lineHeight: "20px", color: "var(--dsw-alias-text-secondary, #666)", padding: "24px 0" },
			err: { fontSize: "12px", lineHeight: "18px", color: "var(--dsw-alias-state-error-primary, #d33)" },
			ok: { fontSize: "12px", lineHeight: "18px", color: "var(--dsw-alias-state-success-primary, #2a7)" },
			bar: { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" },
			count: { fontSize: "12px", lineHeight: "18px", color: "var(--dsw-alias-text-secondary, #666)", marginRight: "auto" },
			row: {
				display: "flex",
				alignItems: "center",
				gap: "12px",
				flexWrap: "wrap",
				padding: "10px 12px",
				border: "1px solid var(--dsw-alias-border-secondary, rgba(0,0,0,.1))",
				borderRadius: "10px",
			},
			rowPicked: {
				display: "flex",
				alignItems: "center",
				gap: "12px",
				flexWrap: "wrap",
				padding: "10px 12px",
				border: "1px solid var(--dsw-alias-border-primary, rgba(0,0,0,.3))",
				borderRadius: "10px",
				background: "var(--dsw-alias-bg-secondary, rgba(0,0,0,.03))",
			},
			box: { flex: "0 0 auto", width: "16px", height: "16px", margin: 0, cursor: "pointer" },
			main: { display: "flex", flexDirection: "column", gap: "2px", minWidth: 0, flex: "1 1 180px" },
			title: { fontSize: "13px", lineHeight: "20px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
			meta: {
				fontSize: "12px",
				lineHeight: "18px",
				color: "var(--dsw-alias-text-secondary, #666)",
				overflow: "hidden",
				textOverflow: "ellipsis",
				whiteSpace: "nowrap",
			},
			actions: { display: "flex", alignItems: "center", gap: "8px", flex: "0 0 auto" },
			btn: {
				flex: "0 0 auto",
				fontSize: "12px",
				lineHeight: "18px",
				padding: "4px 12px",
				borderRadius: "999px",
				border: "1px solid var(--dsw-alias-border-secondary, rgba(0,0,0,.15))",
				background: "transparent",
				color: "inherit",
				cursor: "pointer",
			},
			btnOn: {
				flex: "0 0 auto",
				fontSize: "12px",
				lineHeight: "18px",
				padding: "4px 12px",
				borderRadius: "999px",
				border: "1px solid var(--dsw-alias-border-primary, rgba(0,0,0,.35))",
				background: "var(--dsw-alias-bg-secondary, rgba(0,0,0,.05))",
				color: "inherit",
				cursor: "pointer",
			},
			btnBusy: {
				flex: "0 0 auto",
				fontSize: "12px",
				lineHeight: "18px",
				padding: "4px 12px",
				borderRadius: "999px",
				border: "1px solid var(--dsw-alias-border-secondary, rgba(0,0,0,.15))",
				background: "transparent",
				color: "var(--dsw-alias-text-secondary, #666)",
				cursor: "default",
			},
			// 危险动作：默认克制（只染文字），确认那一刻才填满，避免误点
			btnDanger: {
				flex: "0 0 auto",
				fontSize: "12px",
				lineHeight: "18px",
				padding: "4px 12px",
				borderRadius: "999px",
				border: "1px solid var(--dsw-alias-border-secondary, rgba(0,0,0,.15))",
				background: "transparent",
				color: "var(--dsw-alias-state-error-primary, #d33)",
				cursor: "pointer",
			},
			btnDangerConfirm: {
				flex: "0 0 auto",
				fontSize: "12px",
				lineHeight: "18px",
				padding: "4px 12px",
				borderRadius: "999px",
				border: "1px solid var(--dsw-alias-state-error-primary, #d33)",
				background: "var(--dsw-alias-state-error-primary, #d33)",
				color: "#fff",
				cursor: "pointer",
			},
			current: { flex: "0 0 auto", fontSize: "12px", lineHeight: "18px", color: "var(--dsw-alias-text-secondary, #666)" },
		};

		function formatTime(ts) {
			if (ts === 0) return "";
			try {
				return new Date(ts).toLocaleString();
			} catch (error) {
				return "";
			}
		}

		/** 把 commands.execute 的结果拆成 { ok, text }，供恢复/删除共用。 */
		function runCommand(ctx, sessionId, line, missingHint, onDone) {
			const commands = ctx.remote !== undefined ? ctx.remote.commands : undefined;
			if (commands === undefined || typeof commands.execute !== "function") {
				onDone(false, "命令通道尚未就绪，请稍后重试。");
				return;
			}
			commands.execute(sessionId, line, []).then((result) => {
				if (result === undefined || result === null) {
					onDone(false, "命令未注册：" + missingHint);
					return;
				}
				if (result.ok !== true) {
					onDone(false, result.error !== undefined && result.error !== null && result.error.message ? String(result.error.message) : "执行失败");
					return;
				}
				if (result.value === undefined) {
					onDone(false, "命令未注册：" + missingHint);
					return;
				}
				const outcome = result.value.result;
				const text = outcome !== undefined && outcome !== null && typeof outcome.text === "string" ? outcome.text : "";
				if (outcome !== undefined && outcome !== null && outcome.kind === "error") {
					onDone(false, text !== "" ? text : "执行失败");
					return;
				}
				onDone(true, text);
			}, (reason) => {
				onDone(false, reason !== null && reason !== undefined && reason.message ? String(reason.message) : String(reason));
			});
		}

		function createSection(ctx) {
			return function ArchivedSection(props) {
				const useWorkspaces = props.useWorkspaces;
				const useSessions = props.useSessions;
				const busyState = react.useState("");
				const busy = busyState[0];
				const setBusy = busyState[1];
				const confirmState = react.useState("");
				const confirming = confirmState[0];
				const setConfirming = confirmState[1];
				const selectState = react.useState(false);
				const selecting = selectState[0];
				const setSelecting = selectState[1];
				const pickedState = react.useState({});
				const picked = pickedState[0];
				const setPicked = pickedState[1];
				const errState = react.useState("");
				const error = errState[0];
				const setError = errState[1];
				const noteState = react.useState("");
				const note = noteState[0];
				const setNote = noteState[1];

				if (typeof useWorkspaces !== "function" || typeof useSessions !== "function") {
					return react.createElement("div", { style: S.wrap }, react.createElement("div", { style: S.err }, "当前界面未提供会话数据接口"));
				}

				const archivedIds = useWorkspaces((state) => state.archivedSessionIds);
				const currentSessionId = useSessions((state) => state.current);
				const sessions = useSessions((state) => state);

				const rows = react.useMemo(() => {
					const out = [];
					const ids = archivedIds === undefined || archivedIds === null ? [] : archivedIds;
					for (let i = 0; i < ids.length; i += 1) {
						const id = String(ids[i]);
						const summary = sessions !== undefined && sessions !== null && sessions.byId !== undefined ? sessions.byId[id] : undefined;
						const hasTitle = summary !== undefined && summary.blank !== true && typeof summary.displayTitle === "string" && summary.displayTitle !== "";
						out.push({
							id,
							title: hasTitle ? summary.displayTitle : "",
							cwd: summary !== undefined && typeof summary.cwd === "string" ? summary.cwd : "",
							updatedAt: summary !== undefined && typeof summary.updatedAt === "number" ? summary.updatedAt : 0,
						});
					}
					out.sort((a, b) => b.updatedAt - a.updatedAt);
					return out;
				}, [archivedIds, sessions]);

				// 当前会话不可多选、不可删
				const selectableIds = react.useMemo(() => {
					const out = [];
					for (let i = 0; i < rows.length; i += 1) if (rows[i].id !== currentSessionId) out.push(rows[i].id);
					return out;
				}, [rows, currentSessionId]);

				const pickedIds = react.useMemo(() => {
					const out = [];
					for (let i = 0; i < selectableIds.length; i += 1) if (picked[selectableIds[i]] === true) out.push(selectableIds[i]);
					return out;
				}, [selectableIds, picked]);

				/** 恢复与永久删除都必须在某个会话内执行命令，这里统一要求一个。 */
				const requireSession = () => {
					if (typeof currentSessionId !== "string" || currentSessionId === "") {
						setNote("");
						setError("请先打开任意会话再操作：命令在该会话内执行。");
						return null;
					}
					return currentSessionId;
				};

				/** 执行一条宿主命令，统一收尾（清 busy / 清确认态 / 写提示）。 */
				const exec = (ids, command, hint, doneText) => {
					const sessionId = requireSession();
					if (sessionId === null) return;
					setBusy(ids.length > 1 ? "__batch__" : ids[0]);
					setConfirming("");
					setError("");
					setNote("");
					runCommand(ctx, sessionId, "/" + command + " " + ids.join(" "), "/" + command, (ok, text) => {
						setBusy("");
						if (ok) {
							setNote(text !== "" ? text : doneText);
							// 批量成功后清空勾选并退出多选，免得对着已经消失的条目继续操作
							setPicked({});
							if (ids.length > 1) setSelecting(false);
						} else {
							setError(text);
						}
					});
				};

				const toggleOne = (id) => {
					const next = {};
					for (const k in picked) if (picked[k] === true) next[k] = true;
					if (next[id] === true) delete next[id];
					else next[id] = true;
					setPicked(next);
					setConfirming("");
				};

				const allPicked = selectableIds.length > 0 && pickedIds.length === selectableIds.length;

				const toggleAll = () => {
					if (allPicked) { setPicked({}); return; }
					const next = {};
					for (let i = 0; i < selectableIds.length; i += 1) next[selectableIds[i]] = true;
					setPicked(next);
				};

				const busyBatch = busy === "__batch__";
				const anyBusy = busy !== "";

				const children = [];
				children.push(react.createElement("div", { key: "head", style: S.head }, "共 " + rows.length + " 个已归档会话"));

				// 顶部工具条：平时只有「多选」，进入多选后才出现批量动作
				const bar = [];
				bar.push(react.createElement("button", {
					key: "mode",
					type: "button",
					style: selecting ? S.btnOn : S.btn,
					disabled: anyBusy,
					onClick: () => {
						setSelecting(!selecting);
						setPicked({});
						setConfirming("");
						setNote("");
						setError("");
					},
				}, selecting ? "退出多选" : "多选"));

				if (selecting) {
					bar.push(react.createElement("span", { key: "count", style: S.count }, "已选 " + pickedIds.length + " 个"));
					bar.push(react.createElement("button", {
						key: "all",
						type: "button",
						style: S.btn,
						disabled: anyBusy || selectableIds.length === 0,
						onClick: toggleAll,
					}, allPicked ? "取消全选" : "全选"));
					bar.push(react.createElement("button", {
						key: "restore",
						type: "button",
						style: busyBatch ? S.btnBusy : S.btn,
						disabled: anyBusy || pickedIds.length === 0,
						onClick: () => { if (pickedIds.length > 0) exec(pickedIds, "unarchive", "/unarchive", "已恢复。"); },
					}, busyBatch ? "处理中…" : "批量恢复"));
					bar.push(react.createElement("button", {
						key: "purge",
						type: "button",
						style: confirming === "__batch__" ? S.btnDangerConfirm : S.btnDanger,
						disabled: anyBusy || pickedIds.length === 0,
						title: "从电脑上删掉这些会话文件，不可恢复",
						onClick: () => {
							if (pickedIds.length === 0) return;
							if (confirming === "__batch__") exec(pickedIds, "purge", "/purge", "已永久删除。");
							else { setConfirming("__batch__"); setNote(""); setError(""); }
						},
					}, confirming === "__batch__" ? "确认删除 " + pickedIds.length + " 个" : "永久删除"));
					if (confirming === "__batch__") {
						bar.push(react.createElement("button", {
							key: "cancel",
							type: "button",
							style: S.btn,
							disabled: anyBusy,
							onClick: () => { setConfirming(""); },
						}, "取消"));
					}
				}
				children.push(react.createElement("div", { key: "bar", style: S.bar }, bar));

				if (error !== "") children.push(react.createElement("div", { key: "err", style: S.err }, error));
				if (note !== "") children.push(react.createElement("div", { key: "ok", style: S.ok }, note));
				if (rows.length === 0) {
					children.push(react.createElement("div", { key: "empty", style: S.empty }, "没有已归档的会话"));
				} else {
					const list = rows.map((row) => {
						const busyHere = busy === row.id;
						const confirmingHere = confirming === row.id;
						const isCurrent = typeof currentSessionId === "string" && currentSessionId === row.id;
						const isPicked = picked[row.id] === true;
						const label = row.title !== "" ? row.title : "（无标题会话）";
						const meta = [];
						if (row.cwd !== "") meta.push(row.cwd);
						const time = formatTime(row.updatedAt);
						if (time !== "") meta.push(time);
						if (row.title === "") meta.push(row.id);

						const cells = [];
						if (selecting) {
							cells.push(react.createElement("input", {
								key: "box",
								type: "checkbox",
								style: S.box,
								checked: isPicked,
								disabled: isCurrent || anyBusy,
								title: isCurrent ? "当前会话不能删除" : "",
								onChange: () => { if (!isCurrent) toggleOne(row.id); },
							}));
						}
						cells.push(react.createElement("div", { key: "main", style: S.main }, [
							react.createElement("div", { key: "title", style: S.title, title: label }, label),
							meta.length === 0 ? null : react.createElement("div", { key: "meta", style: S.meta, title: meta.join(" · ") }, meta.join(" · ")),
						]));

						// 多选模式下每行不再放动作按钮，避免和批量按钮抢注意力
						if (!selecting) {
							const actions = [];
							actions.push(react.createElement("button", {
								key: "restore",
								type: "button",
								style: busyHere ? S.btnBusy : S.btn,
								disabled: busyHere || anyBusy,
								onClick: () => { exec([row.id], "unarchive", "/unarchive", "已恢复。"); },
							}, busyHere ? "处理中…" : "恢复"));

							if (isCurrent) {
								// 正在用的会话不给删 —— 删掉它自己会把当前会话连根拔掉
								actions.push(react.createElement("span", { key: "cur", style: S.current }, "当前会话"));
							} else {
								actions.push(react.createElement("button", {
									key: "purge",
									type: "button",
									style: confirmingHere ? S.btnDangerConfirm : S.btnDanger,
									disabled: busyHere || anyBusy,
									title: "从电脑上删掉这个会话文件，不可恢复",
									onClick: () => {
										if (confirmingHere) exec([row.id], "purge", "/purge", "已永久删除。");
										else { setConfirming(row.id); setNote(""); setError(""); }
									},
								}, confirmingHere ? "确认删除" : "永久删除"));
								if (confirmingHere) {
									actions.push(react.createElement("button", {
										key: "cancel",
										type: "button",
										style: S.btn,
										disabled: anyBusy,
										onClick: () => { setConfirming(""); },
									}, "取消"));
								}
							}
							cells.push(react.createElement("div", { key: "actions", style: S.actions }, actions));
						} else if (isCurrent) {
							cells.push(react.createElement("span", { key: "cur", style: S.current }, "当前会话"));
						}

						return react.createElement("div", { key: row.id, style: isPicked ? S.rowPicked : S.row }, cells);
					});
					children.push(react.createElement("div", { key: "list", style: S.wrap }, list));
				}
				return react.createElement("div", { style: S.wrap }, children);
			};
		}

		const inject = ["slots", "remote", "remote.commands"];

		function apply(ctx) {
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "archived-sessions",
				order: 35,
				label: "已归档会话",
			}, createSection(ctx)));
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
