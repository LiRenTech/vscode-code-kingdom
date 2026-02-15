import * as vscode from 'vscode';
import { addBlameInfo, buildFileTree, collectAuthors, getCurrentCommitHash, getGitRoot, type AuthorColorMap, type FileNode } from './fileTree';
import { CacheManager } from './cacheManager';
import { getWebviewContent } from './webviewContent';
import { CodeKingdomTreeDataProvider } from './treeDataProvider';

export function activate(context: vscode.ExtensionContext) {
	console.log('Code Kingdom extension is now active!');

	let currentPanel: vscode.WebviewPanel | undefined;
	let lastFileTree: FileNode | null = null;
	let lastAuthors: string[] = context.workspaceState.get<string[]>('code-kingdom.lastAuthors') || [];

	// 注册 TreeDataProvider
	const treeDataProvider = new CodeKingdomTreeDataProvider();
	vscode.window.createTreeView('code-kingdom-view', {
		treeDataProvider: treeDataProvider
	});

	// 注册显示文件树命令
	const disposable = vscode.commands.registerCommand('code-kingdom.showFileTree', async () => {
		// 获取当前工作区
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
		if (!workspaceFolder) {
			vscode.window.showWarningMessage('请先打开一个工作区文件夹');
			return;
		}

		let repoRoot: string | undefined;
		
		// 尝试使用 VS Code 内置 Git 插件获取仓库列表
		const repos = await getGitRepositories();
		
		if (repos.length > 1) {
			// 如果有多个仓库，让用户选择
			const items = repos.map(repo => ({
				label: repo.rootUri.fsPath.split(/[\\/]/).pop() || repo.rootUri.fsPath,
				description: repo.rootUri.fsPath,
				repoRoot: repo.rootUri.fsPath
			}));
			
			const selected = await vscode.window.showQuickPick(items, {
				placeHolder: '检测到多个 Git 仓库，请选择一个以显示文件树'
			});
			
			if (selected) {
				repoRoot = selected.repoRoot;
			} else {
				// 用户取消选择
				return;
			}
		} else if (repos.length === 1) {
			// 只有一个仓库，直接使用
			repoRoot = repos[0].rootUri.fsPath;
		} else {
			// 无法通过 API 获取（可能 Git 插件未激活或未发现），回退到手动检测
			// 检查是否是 git 仓库并获取根目录
			const gitRoot = await getGitRoot(workspaceFolder.uri.fsPath);
			if (gitRoot) {
				repoRoot = gitRoot;
			}
		}

		if (!repoRoot) {
			vscode.window.showWarningMessage('当前项目不是 git 仓库，或无法检测到有效的 Git 仓库');
			return;
		}

		// 创建或显示 webview 面板
		const panel = vscode.window.createWebviewPanel(
			'codeKingdomFileTree',
			'Code Kingdom - 文件树',
			vscode.ViewColumn.One,
			{
				enableScripts: true,
				retainContextWhenHidden: true
			}
		);
		panel.iconPath = vscode.Uri.joinPath(context.extensionUri, 'resources', 'icon.png');

		// 显示加载消息
		panel.webview.html = getLoadingHtml();

		// 初始化缓存管理器
		const cacheManager = new CacheManager(context);
		
		try {
			// 获取当前 commit hash
			const commitHash = await getCurrentCommitHash(repoRoot);
			let fileTree: FileNode | null = null;
			let isCached = false;

			if (commitHash) {
				fileTree = await cacheManager.getBlameCache(commitHash);
				if (fileTree) {
					isCached = true;
					console.log(`Using cached blame data for commit ${commitHash}`);
				}
			}

			if (isCached && fileTree) {
				// 缓存命中，直接渲染
				lastAuthors = collectAuthors(fileTree);
				void context.workspaceState.update('code-kingdom.lastAuthors', lastAuthors);
				lastFileTree = fileTree;
				currentPanel = panel;
				const authorColors = ensureAuthorColors(context, lastAuthors);
				panel.webview.html = getWebviewContent(fileTree, authorColors);
				
				// 仍然需要重新绑定消息监听
				panel.webview.onDidReceiveMessage(
					message => {
						switch (message.command) {
							case 'openFile':
								const fileUri = vscode.Uri.file(message.path);
								vscode.window.showTextDocument(fileUri);
								break;
						}
					},
					undefined,
					context.subscriptions
				);
				return;
			}

			// 缓存未命中或无法获取 commit hash，走完整流程
			await vscode.window.withProgress(
				{
					location: vscode.ProgressLocation.Notification,
					title: 'Code Kingdom',
					cancellable: false
				},
				async progress => {
					progress.report({ message: '正在构建文件树...' });
					
					fileTree = await buildFileTree(workspaceFolder);
					if (!fileTree) {
						panel.webview.html = getErrorHtml('无法构建文件树');
						return;
					}

					progress.report({ message: '正在计算 Git blame...' });
					await addBlameInfo(fileTree, repoRoot!, (done, total, filePath) => {
						const percent = total > 0 ? Math.round((done / total) * 100) : 0;
						const name = filePath.split(/[\\/]/).pop() || filePath;
						progress.report({ message: `Git blame ${percent}% - ${name}` });
					});

					// 存入缓存
					if (commitHash && fileTree) {
						await cacheManager.saveBlameCache(commitHash, fileTree);
					}

					lastAuthors = collectAuthors(fileTree);
					void context.workspaceState.update('code-kingdom.lastAuthors', lastAuthors);
					lastFileTree = fileTree;
					currentPanel = panel;

					// 更新 webview 内容
					const authorColors = ensureAuthorColors(context, lastAuthors);
					panel.webview.html = getWebviewContent(fileTree, authorColors);

					// 处理 webview 消息
					panel.webview.onDidReceiveMessage(
						message => {
							switch (message.command) {
								case 'openFile': {
									const fileUri = vscode.Uri.file(message.path);
									vscode.window.showTextDocument(fileUri);
									break;
								}
							}
						},
						undefined,
						context.subscriptions
					);
				}
			);
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : '未知错误';
			panel.webview.html = getErrorHtml(`构建文件树时出错: ${errorMessage}`);
		}
	});

	// 注册作者颜色配置命令
	const configDisposable = vscode.commands.registerCommand('code-kingdom.configureAuthorColors', async () => {
		const panel = vscode.window.createWebviewPanel(
			'codeKingdomAuthorColors',
			'Code Kingdom - 作者颜色配置',
			vscode.ViewColumn.One,
			{
				enableScripts: true,
				retainContextWhenHidden: true
			}
		);
		panel.iconPath = vscode.Uri.joinPath(context.extensionUri, 'resources', 'icon.png');

		const colors = getAuthorColors(context);
		panel.webview.html = getAuthorColorConfigHtml(lastAuthors, colors);

		panel.webview.onDidReceiveMessage(
			async message => {
				switch (message.command) {
					case 'saveColors': {
						const nextColors = sanitizeColorMap(message.colors);
						await context.globalState.update('code-kingdom.authorColors', nextColors);
						vscode.window.showInformationMessage('作者颜色配置已保存');

						if (currentPanel && lastFileTree) {
							currentPanel.webview.html = getWebviewContent(lastFileTree, nextColors);
						}
						break;
					}
				}
			},
			undefined,
			context.subscriptions
		);
	});

	context.subscriptions.push(disposable);
	context.subscriptions.push(configDisposable);
}

// === Git Extension Helpers ===

interface GitExtension {
	getAPI(version: number): GitAPI;
}

interface GitAPI {
	repositories: GitRepository[];
}

interface GitRepository {
	rootUri: vscode.Uri;
}

async function getGitRepositories(): Promise<GitRepository[]> {
	const extension = vscode.extensions.getExtension<GitExtension>('vscode.git');
	if (!extension) {
		return [];
	}
	
	if (!extension.isActive) {
		await extension.activate();
	}
	
	const api = extension.exports.getAPI(1);
	return api.repositories;
}

export function deactivate() {}

function getAuthorColors(context: vscode.ExtensionContext): AuthorColorMap {
	const value = context.globalState.get<AuthorColorMap>('code-kingdom.authorColors');
	return value || {};
}

function ensureAuthorColors(context: vscode.ExtensionContext, authors: string[]): AuthorColorMap {
	const colors = getAuthorColors(context);
	let changed = false;
	for (const author of authors) {
		if (!colors[author]) {
			colors[author] = colorForAuthorHex(author);
			changed = true;
		}
	}
	if (changed) {
		void context.globalState.update('code-kingdom.authorColors', colors);
	}
	return colors;
}

function colorForAuthorHex(author: string): string {
	let hash = 0;
	for (let i = 0; i < author.length; i++) {
		hash = (hash * 31 + author.charCodeAt(i)) | 0;
	}
	const hue = Math.abs(hash) % 360;
	return hslToHex(hue, 55, 45);
}

function hslToHex(h: number, s: number, l: number): string {
	const sNorm = s / 100;
	const lNorm = l / 100;
	const c = (1 - Math.abs(2 * lNorm - 1)) * sNorm;
	const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
	const m = lNorm - c / 2;
	let r = 0;
	let g = 0;
	let b = 0;

	if (h < 60) {
		r = c;
		g = x;
	} else if (h < 120) {
		r = x;
		g = c;
	} else if (h < 180) {
		g = c;
		b = x;
	} else if (h < 240) {
		g = x;
		b = c;
	} else if (h < 300) {
		r = x;
		b = c;
	} else {
		r = c;
		b = x;
	}

	const toHex = (v: number) => {
		const hex = Math.round((v + m) * 255).toString(16).padStart(2, '0');
		return hex;
	};

	return '#' + toHex(r) + toHex(g) + toHex(b);
}

function sanitizeColorMap(input: unknown): AuthorColorMap {
	if (!input || typeof input !== 'object') {
		return {};
	}
	const result: AuthorColorMap = {};
	for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
		if (typeof key !== 'string') continue;
		if (typeof value !== 'string') continue;
		result[key] = value;
	}
	return result;
}

function getLoadingHtml(): string {
	return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Code Kingdom - 加载中</title>
	<style>
		body {
			font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
			display: flex;
			justify-content: center;
			align-items: center;
			height: 100vh;
			background: var(--vscode-editor-background);
			color: var(--vscode-editor-foreground);
		}
		.loading {
			text-align: center;
		}
	</style>
</head>
<body>
	<div class="loading">
		<p>正在加载文件树...</p>
	</div>
</body>
</html>`;
}

function getErrorHtml(message: string): string {
	return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Code Kingdom - 错误</title>
	<style>
		body {
			font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
			display: flex;
			justify-content: center;
			align-items: center;
			height: 100vh;
			background: var(--vscode-editor-background);
			color: var(--vscode-editor-foreground);
		}
		.error {
			text-align: center;
			color: var(--vscode-errorForeground);
		}
	</style>
</head>
<body>
	<div class="error">
		<p>❌ ${message}</p>
	</div>
</body>
</html>`;
}

function getAuthorColorConfigHtml(authors: string[], colors: AuthorColorMap): string {
	const authorJson = JSON.stringify(authors).replace(/</g, '\\u003c');
	const colorJson = JSON.stringify(colors).replace(/</g, '\\u003c');
	return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Code Kingdom - 作者颜色配置</title>
	<style>
		body {
			font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
			padding: 16px;
			background: var(--vscode-editor-background);
			color: var(--vscode-editor-foreground);
		}
		h2 {
			margin-bottom: 12px;
		}
		.row {
			display: inline-flex;
			align-items: center;
			gap: 4px;
			margin: 4px;
			padding: 4px 8px;
			background: var(--vscode-editor-lineHighlightBackground);
			border-radius: 4px;
		}
		.author-container {
			display: flex;
			flex-wrap: wrap;
			gap: 4px;
		}
		input[type="text"] {
			width: auto;
			min-width: 60px;
			max-width: 200px;
			padding: 2px 4px;
			background: var(--vscode-input-background);
			color: var(--vscode-input-foreground);
			border: 1px solid var(--vscode-input-border);
			border-radius: 4px;
			font-size: 12px;
		}
		.actions {
			margin-top: 12px;
			display: flex;
			gap: 8px;
		}
		button {
			padding: 6px 10px;
			background: var(--vscode-button-background);
			color: var(--vscode-button-foreground);
			border: none;
			border-radius: 4px;
			cursor: pointer;
		}
		button.secondary {
			background: var(--vscode-button-secondaryBackground);
			color: var(--vscode-button-secondaryForeground);
		}
		.empty {
			color: var(--vscode-descriptionForeground);
			margin-bottom: 8px;
		}
	</style>
</head>
<body>
	<h2>作者颜色配置</h2>
	<h3>当前项目作者</h3>
	<div class="unify-row" style="margin-bottom: 16px; padding: 10px; background: var(--vscode-editor-lineHighlightBackground); border-radius: 4px; display: flex; align-items: center; gap: 8px;">
		<span>统一设置当前所有作者颜色：</span>
		<input type="color" id="unifyColor" value="#000000">
		<button id="unifyBtn" class="secondary">一键应用</button>
	</div>
	<div id="current" class="author-container"></div>
	<h3>曾经保存的作者配置信息</h3>
	<div id="history" class="author-container"></div>
	<script>
		const vscode = acquireVsCodeApi();
		const authors = ${authorJson};
		const colors = ${colorJson};

		const currentList = document.getElementById('current');
		const historyList = document.getElementById('history');
		const unifyColorInput = document.getElementById('unifyColor');
		const unifyBtn = document.getElementById('unifyBtn');

		let saveTimer = null;

		function createRow(name, color) {
			const row = document.createElement('div');
			row.className = 'row';
			row.dataset.author = name;

			const nameSpan = document.createElement('span');
			nameSpan.textContent = name || '';
			nameSpan.style.fontSize = '12px';
			nameSpan.style.whiteSpace = 'nowrap';

			// Hidden input to preserve name for saveNow
			const nameInput = document.createElement('input');
			nameInput.type = 'hidden';
			nameInput.value = name || '';

			const colorInput = document.createElement('input');
			colorInput.type = 'color';
			colorInput.className = 'color-input';
			colorInput.value = color || '#4a7bd1';
			colorInput.style.width = '24px';
			colorInput.style.height = '24px';
			colorInput.style.padding = '0';
			colorInput.style.border = 'none';
			colorInput.style.cursor = 'pointer';

			colorInput.addEventListener('input', scheduleSave);

			row.appendChild(nameSpan);
			row.appendChild(nameInput);
			row.appendChild(colorInput);
			return row;
		}

		function renderSection(container, items, emptyText) {
			container.innerHTML = '';
			if (items.length === 0) {
				const empty = document.createElement('div');
				empty.className = 'empty';
				empty.textContent = emptyText;
				container.appendChild(empty);
				return;
			}
			for (const name of items) {
				container.appendChild(createRow(name, colors[name]));
			}
		}

		function render() {
			const currentAuthors = authors.slice().sort();
			const historyAuthors = Object.keys(colors).filter(name => !currentAuthors.includes(name)).sort();
			renderSection(
				currentList,
				currentAuthors,
				'请先关闭此页面，点击生成一次势力图，再来到此页面更改作者信息设置'
			);
			renderSection(historyList, historyAuthors, '暂无历史作者记录。');
		}

		function saveNow() {
			const rows = document.querySelectorAll('.row');
			const result = {};
			rows.forEach(row => {
				const inputs = row.querySelectorAll('input');
				const name = inputs[0].value.trim();
				const color = inputs[1].value;
				if (name) {
					result[name] = color;
				}
			});
			vscode.postMessage({ command: 'saveColors', colors: result });
		}

		function scheduleSave() {
			if (saveTimer) {
				clearTimeout(saveTimer);
			}
			saveTimer = setTimeout(saveNow, 150);
		}

		unifyBtn.addEventListener('click', () => {
			const targetColor = unifyColorInput.value;
			const rows = currentList.querySelectorAll('.row');
			if (rows.length === 0) return;

			rows.forEach(row => {
				const colorInput = row.querySelector('.color-input');
				if (colorInput) {
					colorInput.value = targetColor;
				}
			});
			scheduleSave();
		});

		render();
	</script>
</body>
</html>`;
}
