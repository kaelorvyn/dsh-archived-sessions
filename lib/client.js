/**
 * dsh-archived-sessions — 浏览器半部。
 *
 * 注册设置面板的「已归档会话」页：列出全部已归档会话，每条可一键恢复。
 * 列表数据全部来自插槽标准 props（useWorkspaces / useSessions）；恢复动作经
 * 官方 `remote.commands` 通道执行宿主命令 `/unarchive <会话 id>`。
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
			row: {
				display: "flex",
				alignItems: "center",
				gap: "12px",
				padding: "10px 12px",
				border: "1px solid var(--dsw-alias-border-secondary, rgba(0,0,0,.1))",
				borderRadius: "10px",
			},
			main: { display: "flex", flexDirection: "column", gap: "2px", minWidth: 0, flex: "1 1 auto" },
			title: { fontSize: "13px", lineHeight: "20px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
			meta: {
				fontSize: "12px",
				lineHeight: "18px",
				color: "var(--dsw-alias-text-secondary, #666)",
				overflow: "hidden",
				textOverflow: "ellipsis",
				whiteSpace: "nowrap",
			},
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
		};

		function formatTime(ts) {
			if (ts === 0) return "";
			try {
				return new Date(ts).toLocaleString();
			} catch (error) {
				return "";
			}
		}

		function createSection(ctx) {
			return function ArchivedSection(props) {
				const useWorkspaces = props.useWorkspaces;
				const useSessions = props.useSessions;
				const busyState = react.useState("");
				const busy = busyState[0];
				const setBusy = busyState[1];
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

				const restore = (id) => {
					if (typeof currentSessionId !== "string" || currentSessionId === "") {
						setNote("");
						setError("请先打开任意会话再点恢复：恢复命令在该会话内执行。");
						return;
					}
					setBusy(id);
					setError("");
					setNote("");
					const commands = ctx.remote !== undefined ? ctx.remote.commands : undefined;
					if (commands === undefined || typeof commands.execute !== "function") {
						setBusy("");
						setError("命令通道尚未就绪，请稍后重试。");
						return;
					}
					commands.execute(currentSessionId, "/unarchive " + id, []).then((result) => {
						setBusy("");
						if (result === undefined || result === null) {
							setError("命令未注册：/unarchive");
							return;
						}
						if (result.ok !== true) {
							setError(result.error !== undefined && result.error !== null && result.error.message ? String(result.error.message) : "恢复失败");
							return;
						}
						if (result.value === undefined) {
							setError("命令未注册：/unarchive");
							return;
						}
						const outcome = result.value.result;
						const text = outcome !== undefined && outcome !== null && typeof outcome.text === "string" ? outcome.text : "";
						if (outcome !== undefined && outcome !== null && outcome.kind === "error") {
							setError(text !== "" ? text : "恢复失败");
							return;
						}
						setNote(text !== "" ? text : "已恢复。");
					}, (reason) => {
						setBusy("");
						setError(reason !== null && reason !== undefined && reason.message ? String(reason.message) : String(reason));
					});
				};

				const children = [];
				children.push(react.createElement("div", { key: "head", style: S.head }, "共 " + rows.length + " 个已归档会话"));
				if (error !== "") children.push(react.createElement("div", { key: "err", style: S.err }, error));
				if (note !== "") children.push(react.createElement("div", { key: "ok", style: S.ok }, note));
				if (rows.length === 0) {
					children.push(react.createElement("div", { key: "empty", style: S.empty }, "没有已归档的会话"));
				} else {
					const list = rows.map((row) => {
						const busyHere = busy === row.id;
						const label = row.title !== "" ? row.title : "（无标题会话）";
						const meta = [];
						if (row.cwd !== "") meta.push(row.cwd);
						const time = formatTime(row.updatedAt);
						if (time !== "") meta.push(time);
						if (row.title === "") meta.push(row.id);
						return react.createElement("div", { key: row.id, style: S.row }, [
							react.createElement("div", { key: "main", style: S.main }, [
								react.createElement("div", { key: "title", style: S.title, title: label }, label),
								meta.length === 0 ? null : react.createElement("div", { key: "meta", style: S.meta, title: meta.join(" · ") }, meta.join(" · ")),
							]),
							react.createElement("button", {
								key: "btn",
								type: "button",
								style: busyHere ? S.btnBusy : S.btn,
								disabled: busyHere || busy !== "",
								onClick: () => { restore(row.id); },
							}, busyHere ? "恢复中…" : "恢复"),
						]);
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
