import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import ignore, { type Ignore } from 'ignore';

export interface FileNode {
	name: string;
	path: string;
	type: 'file' | 'folder';
	children?: FileNode[];
}

/**
 * 检查目录是否是 git 仓库
 */
export async function isGitRepository(workspaceFolder: vscode.WorkspaceFolder): Promise<boolean> {
	const gitPath = path.join(workspaceFolder.uri.fsPath, '.git');
	try {
		const stat = await fs.promises.stat(gitPath);
		return stat.isDirectory() || stat.isFile(); // .git 可能是文件（submodule）或目录
	} catch {
		return false;
	}
}

/**
 * 读取 .gitignore 规则
 */
async function loadGitignore(rootPath: string): Promise<Ignore> {
	const gitignorePath = path.join(rootPath, '.gitignore');
	const ig = ignore();
	
	try {
		const content = await fs.promises.readFile(gitignorePath, 'utf-8');
		ig.add(content);
	} catch {
		// 如果没有 .gitignore 文件，返回空的 ignore 实例
	}
	
	// 默认忽略 .git 目录
	ig.add('.git');
	ig.add('node_modules');
	ig.add('.vscode');
	
	return ig;
}

/**
 * 检查路径是否应该被忽略
 */
function shouldIgnore(relativePath: string, ig: Ignore): boolean {
	// 将路径转换为 Unix 风格（ignore 库需要）
	const normalizedPath = relativePath.replace(/\\/g, '/');
	return ig.ignores(normalizedPath);
}

/**
 * 构建文件树结构
 */
export async function buildFileTree(workspaceFolder: vscode.WorkspaceFolder): Promise<FileNode | null> {
	const rootPath = workspaceFolder.uri.fsPath;
	
	// 检查是否是 git 仓库
	const isGit = await isGitRepository(workspaceFolder);
	if (!isGit) {
		return null;
	}
	
	// 加载 .gitignore 规则
	const ig = await loadGitignore(rootPath);
	
	async function buildNode(currentPath: string, relativePath: string = ''): Promise<FileNode | null> {
		let stat: fs.Stats;
		try {
			stat = await fs.promises.stat(currentPath);
		} catch (error) {
			// 跳过无法访问的文件/目录（如损坏的符号链接、权限问题等）
			console.warn(`跳过无法访问的路径: ${currentPath}`, error);
			return null;
		}
		
		if (stat.isDirectory()) {
			// 检查目录是否应该被忽略
			if (relativePath && shouldIgnore(relativePath + '/', ig)) {
				return null;
			}
			
			const children: FileNode[] = [];
			let entries: string[];
			try {
				entries = await fs.promises.readdir(currentPath);
			} catch (error) {
				// 跳过无法读取的目录（如权限问题等）
				console.warn(`跳过无法读取的目录: ${currentPath}`, error);
				return null;
			}
			
			for (const entry of entries) {
				const entryPath = path.join(currentPath, entry);
				const entryRelativePath = relativePath ? path.join(relativePath, entry) : entry;
				
				// 检查是否应该被忽略
				if (shouldIgnore(entryRelativePath, ig)) {
					continue;
				}
				
				const childNode = await buildNode(entryPath, entryRelativePath);
				if (childNode) {
					children.push(childNode);
				}
			}
			
			// 按名称排序：文件夹在前，然后按字母顺序
			children.sort((a, b) => {
				if (a.type !== b.type) {
					return a.type === 'folder' ? -1 : 1;
				}
				return a.name.localeCompare(b.name);
			});
			
			return {
				name: path.basename(currentPath),
				path: currentPath,
				type: 'folder',
				children: children.length > 0 ? children : undefined
			};
		} else {
			// 文件
			if (shouldIgnore(relativePath, ig)) {
				return null;
			}
			
			return {
				name: path.basename(currentPath),
				path: currentPath,
				type: 'file'
			};
		}
	}
	
	const rootNode = await buildNode(rootPath);
	if (rootNode) {
		// 使用工作区文件夹名称作为根节点名称
		rootNode.name = workspaceFolder.name;
	}
	return rootNode;
}
