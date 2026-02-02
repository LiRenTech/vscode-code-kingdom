import * as vscode from 'vscode';
import { buildFileTree, isGitRepository } from './fileTree';
import { getWebviewContent } from './webviewContent';
import { CodeKingdomTreeDataProvider } from './treeDataProvider';

export function activate(context: vscode.ExtensionContext) {
	console.log('Code Kingdom extension is now active!');

	// 注册 TreeDataProvider
	const treeDataProvider = new CodeKingdomTreeDataProvider();
	vscode.window.createTreeView('code-kingdom-view', {
		treeDataProvider: treeDataProvider
	});

	// 注册显示文件树命令
	let disposable = vscode.commands.registerCommand('code-kingdom.showFileTree', async () => {
		// 获取当前工作区
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
		if (!workspaceFolder) {
			vscode.window.showWarningMessage('请先打开一个工作区文件夹');
			return;
		}

		// 检查是否是 git 仓库
		const isGit = await isGitRepository(workspaceFolder);
		if (!isGit) {
			vscode.window.showWarningMessage('当前项目不是 git 仓库，无法显示文件树');
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

		// 显示加载消息
		panel.webview.html = getLoadingHtml();

		// 构建文件树
		try {
			const fileTree = await buildFileTree(workspaceFolder);
			if (!fileTree) {
				panel.webview.html = getErrorHtml('无法构建文件树');
				return;
			}

			// 更新 webview 内容
			panel.webview.html = getWebviewContent(fileTree);

			// 处理 webview 消息
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
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : '未知错误';
			panel.webview.html = getErrorHtml(`构建文件树时出错: ${errorMessage}`);
		}
	});

	context.subscriptions.push(disposable);
}

export function deactivate() {}

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
