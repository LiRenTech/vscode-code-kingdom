import * as vscode from 'vscode';

export class CodeKingdomTreeDataProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
	private _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined | null | void> = new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
	readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

	refresh(): void {
		this._onDidChangeTreeData.fire();
	}

	getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
		return element;
	}

	getChildren(element?: vscode.TreeItem): Thenable<vscode.TreeItem[]> {
		// 返回一个按钮项
		const buttonItem = new vscode.TreeItem('显示文件树', vscode.TreeItemCollapsibleState.None);
		buttonItem.command = {
			command: 'code-kingdom.showFileTree',
			title: '显示文件树',
			tooltip: '点击打开文件树视图'
		};
		buttonItem.iconPath = new vscode.ThemeIcon('list-tree');
		buttonItem.tooltip = '点击打开文件树视图';

		return Promise.resolve([buttonItem]);
	}
}
