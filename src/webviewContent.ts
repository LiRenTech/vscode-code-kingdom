import { FileNode } from './fileTree';

/**
 * 生成 webview 的 HTML 内容
 */
export function getWebviewContent(fileTree: FileNode): string {
	const treeHtml = renderTree(fileTree, 0);
	
	return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Code Kingdom - 文件树</title>
	<style>
		* {
			margin: 0;
			padding: 0;
			box-sizing: border-box;
		}
		
		body {
			font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
			background: var(--vscode-editor-background);
			color: var(--vscode-editor-foreground);
			padding: 20px;
			overflow-x: auto;
		}
		
		.container {
			display: flex;
			flex-direction: column;
			gap: 10px;
		}
		
		.folder {
			display: flex;
			flex-direction: column;
			gap: 8px;
		}
		
		.folder-header {
			display: flex;
			align-items: center;
			cursor: pointer;
			user-select: none;
			padding: 4px 0;
		}
		
		.folder-icon {
			margin-right: 6px;
			font-size: 14px;
		}
		
		.folder-name {
			font-weight: 500;
			color: var(--vscode-textLink-foreground);
		}
		
		.folder-children {
			margin-left: 20px;
			border-left: 1px solid var(--vscode-panel-border);
			padding-left: 10px;
		}
		
		.file {
			display: inline-block;
			width: 120px;
			height: 200px;
			margin: 8px;
			padding: 12px;
			background: var(--vscode-editor-inactiveSelectionBackground);
			border: 1px solid var(--vscode-panel-border);
			border-radius: 4px;
			vertical-align: top;
			overflow: hidden;
			position: relative;
			cursor: pointer;
			transition: all 0.2s ease;
		}
		
		.file:hover {
			background: var(--vscode-list-hoverBackground);
			border-color: var(--vscode-textLink-foreground);
			transform: translateY(-2px);
			box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
		}
		
		.file-icon {
			font-size: 32px;
			margin-bottom: 8px;
			text-align: center;
		}
		
		.file-name {
			font-size: 12px;
			word-break: break-all;
			overflow: hidden;
			text-overflow: ellipsis;
			display: -webkit-box;
			-webkit-line-clamp: 3;
			-webkit-box-orient: vertical;
			line-height: 1.4;
		}
		
		.collapsed .folder-children {
			display: none;
		}
		
		.empty-folder {
			color: var(--vscode-descriptionForeground);
			font-style: italic;
			margin-left: 20px;
			padding: 4px 0;
		}
	</style>
</head>
<body>
	<div class="container">
		${treeHtml}
	</div>
	
	<script>
		const vscode = acquireVsCodeApi();
		
		// 文件夹折叠/展开功能
		document.querySelectorAll('.folder-header').forEach(header => {
			header.addEventListener('click', () => {
				const folder = header.parentElement;
				folder.classList.toggle('collapsed');
			});
		});
		
		// 文件点击事件
		document.querySelectorAll('.file').forEach(file => {
			file.addEventListener('click', () => {
				const filePath = file.getAttribute('data-path');
				if (filePath) {
					vscode.postMessage({
						command: 'openFile',
						path: filePath
					});
				}
			});
		});
	</script>
</body>
</html>`;
}

/**
 * 递归渲染文件树
 */
function renderTree(node: FileNode, depth: number): string {
	if (node.type === 'folder') {
		const hasChildren = node.children && node.children.length > 0;
		const childrenHtml = hasChildren
			? node.children!.map(child => renderTree(child, depth + 1)).join('')
			: '<div class="empty-folder">（空文件夹）</div>';
		
		return `
			<div class="folder">
				<div class="folder-header">
					<span class="folder-icon">📁</span>
					<span class="folder-name">${escapeHtml(node.name)}</span>
				</div>
				<div class="folder-children">
					${childrenHtml}
				</div>
			</div>
		`;
	} else {
		// 文件：显示为竖长的长方形
		const fileIcon = getFileIcon(node.name);
		return `
			<div class="file" data-path="${escapeHtml(node.path)}">
				<div class="file-icon">${fileIcon}</div>
				<div class="file-name">${escapeHtml(node.name)}</div>
			</div>
		`;
	}
}

/**
 * 根据文件扩展名获取图标
 */
function getFileIcon(fileName: string): string {
	const ext = fileName.split('.').pop()?.toLowerCase();
	const iconMap: { [key: string]: string } = {
		'js': '📜',
		'ts': '📘',
		'jsx': '⚛️',
		'tsx': '⚛️',
		'json': '📋',
		'html': '🌐',
		'css': '🎨',
		'scss': '🎨',
		'less': '🎨',
		'py': '🐍',
		'java': '☕',
		'cpp': '⚙️',
		'c': '⚙️',
		'go': '🐹',
		'rs': '🦀',
		'php': '🐘',
		'rb': '💎',
		'swift': '🐦',
		'kt': '🔷',
		'md': '📝',
		'txt': '📄',
		'xml': '📄',
		'yaml': '⚙️',
		'yml': '⚙️',
		'sh': '💻',
		'bat': '💻',
		'png': '🖼️',
		'jpg': '🖼️',
		'jpeg': '🖼️',
		'gif': '🖼️',
		'svg': '🎨',
		'pdf': '📕',
		'zip': '📦',
		'tar': '📦',
		'gz': '📦'
	};
	return iconMap[ext || ''] || '📄';
}

/**
 * HTML 转义
 */
function escapeHtml(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#039;');
}
