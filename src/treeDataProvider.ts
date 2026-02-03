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
		// 返回按钮项
		const mapItem = new vscode.TreeItem('显示开发人员势力图', vscode.TreeItemCollapsibleState.None);
		mapItem.command = {
			command: 'code-kingdom.showFileTree',
			title: '显示开发人员势力图',
			tooltip: '点击打开开发人员势力图'
		};
		mapItem.iconPath = new vscode.ThemeIcon('graph');
		mapItem.tooltip = '点击打开开发人员势力图';

		const colorItem = new vscode.TreeItem('配置作者颜色', vscode.TreeItemCollapsibleState.None);
		colorItem.command = {
			command: 'code-kingdom.configureAuthorColors',
			title: '配置作者颜色',
			tooltip: '点击配置作者颜色'
		};
		colorItem.iconPath = new vscode.ThemeIcon('color-mode');
		colorItem.tooltip = '点击配置作者颜色';

		return Promise.resolve([mapItem, colorItem]);
	}
}
