import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import ignore, { type Ignore } from 'ignore';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export type BlameSegment = {
	author: string;
	lines: number;
};

export type AuthorColorMap = Record<string, string>;

export interface FileNode {
	name: string;
	path: string;
	type: 'file' | 'folder';
	isText?: boolean;
	lineCount?: number;
	blameSegments?: BlameSegment[];
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

type IgnoreEntry = {
	base: string;
	matcher: Ignore;
};

/**
 * 创建根目录的忽略规则（含默认规则与根 .gitignore）
 */
async function loadRootIgnore(rootPath: string): Promise<IgnoreEntry> {
	const gitignorePath = path.join(rootPath, '.gitignore');
	const matcher = ignore();

	// 默认忽略
	matcher.add('.git');
	matcher.add('node_modules');
	matcher.add('.vscode');
	matcher.add('pnpm-lock.yaml');
	matcher.add('yarn.lock');
	matcher.add('package-lock.json');

	try {
		const content = await fs.promises.readFile(gitignorePath, 'utf-8');
		matcher.add(content);
	} catch {
		// 如果没有 .gitignore 文件，返回默认规则
	}

	return { base: rootPath, matcher };
}

/**
 * 读取指定目录下的 .gitignore（若存在）
 */
async function loadLocalIgnore(dirPath: string): Promise<Ignore | null> {
	const gitignorePath = path.join(dirPath, '.gitignore');
	try {
		const content = await fs.promises.readFile(gitignorePath, 'utf-8');
		const matcher = ignore();
		matcher.add(content);
		return matcher;
	} catch {
		return null;
	}
}

/**
 * 检查路径是否应该被忽略（支持多层 .gitignore）
 */
function shouldIgnorePath(absPath: string, isDir: boolean, stack: IgnoreEntry[]): boolean {
	let ignored = false;
	for (const entry of stack) {
		let relativePath = path.relative(entry.base, absPath);
		// 不在该 base 下时跳过
		if (relativePath.startsWith('..')) {
			continue;
		}
		relativePath = relativePath.replace(/\\/g, '/');
		if (isDir && !relativePath.endsWith('/')) {
			relativePath += '/';
		}
		const result = entry.matcher.test(relativePath);
		if (result.ignored) {
			ignored = true;
		}
		if (result.unignored) {
			ignored = false;
		}
	}
	return ignored;
}

/**
 * 判断文件是否为文本文件（通过检测 NUL 字节）
 */
async function isTextFile(filePath: string): Promise<boolean> {
	try {
		const file = await fs.promises.open(filePath, 'r');
		const buffer = Buffer.alloc(8192);
		const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
		await file.close();

		for (let i = 0; i < bytesRead; i++) {
			if (buffer[i] === 0) {
				return false;
			}
		}
		return true;
	} catch {
		return false;
	}
}

/**
 * 统计文本文件行数（按换行符计数）
 */
async function countLines(filePath: string): Promise<number> {
	return new Promise((resolve, reject) => {
		let lineCount = 0;
		let hasData = false;
		let lastByte: number | null = null;

		const stream = fs.createReadStream(filePath);
		stream.on('data', (chunk: Buffer | string) => {
			const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
			hasData = true;
			for (let i = 0; i < buffer.length; i++) {
				if (buffer[i] === 10) {
					lineCount++;
				}
			}
			lastByte = buffer[buffer.length - 1];
		});
		stream.on('end', () => {
			if (hasData && lastByte !== 10) {
				lineCount++;
			}
			resolve(lineCount);
		});
		stream.on('error', reject);
	});
}

/**
 * 获取 git blame 作者段信息（按连续作者分段）
 */
async function getBlameSegments(filePath: string, repoRoot: string): Promise<BlameSegment[] | null> {
	try {
		const { stdout } = await execFileAsync('git', [
			'-C',
			repoRoot,
			'blame',
			'--line-porcelain',
			'--',
			filePath
		]);

		const authors: string[] = [];
		let currentAuthor = '';
		const lines = stdout.split('\n');
		for (const line of lines) {
			if (line.startsWith('author ')) {
				currentAuthor = line.slice('author '.length).trim() || 'Unknown';
			} else if (line.startsWith('\t')) {
				authors.push(currentAuthor || 'Unknown');
			}
		}

		if (authors.length === 0) {
			return null;
		}

		const segments: BlameSegment[] = [];
		let last = authors[0];
		let count = 1;
		for (let i = 1; i < authors.length; i++) {
			const author = authors[i];
			if (author === last) {
				count++;
			} else {
				segments.push({ author: last, lines: count });
				last = author;
				count = 1;
			}
		}
		segments.push({ author: last, lines: count });
		return segments;
	} catch {
		// 未跟踪文件、二进制文件或其他错误时直接跳过
		return null;
	}
}

function collectFileNodes(root: FileNode): FileNode[] {
	const files: FileNode[] = [];
	const stack: FileNode[] = [root];
	while (stack.length > 0) {
		const node = stack.pop();
		if (!node) continue;
		if (node.type === 'file') {
			files.push(node);
		} else if (node.children) {
			for (const child of node.children) {
				stack.push(child);
			}
		}
	}
	return files;
}

export async function addBlameInfo(
	root: FileNode,
	repoRoot: string,
	onProgress?: (done: number, total: number, filePath: string) => void
): Promise<void> {
	const files = collectFileNodes(root);
	const total = files.length;
	let done = 0;

	for (const file of files) {
		done++;
		onProgress?.(done, total, file.path);

		if (!file.isText) {
			continue;
		}
		const segments = await getBlameSegments(file.path, repoRoot);
		if (segments && segments.length > 0) {
			file.blameSegments = segments;
		}
	}
}

export function collectAuthors(root: FileNode): string[] {
	const authors = new Set<string>();
	const stack: FileNode[] = [root];
	while (stack.length > 0) {
		const node = stack.pop();
		if (!node) continue;
		if (node.type === 'file' && node.blameSegments) {
			for (const seg of node.blameSegments) {
				if (seg.author) {
					authors.add(seg.author);
				}
			}
		} else if (node.children) {
			for (const child of node.children) {
				stack.push(child);
			}
		}
	}
	return Array.from(authors).sort((a, b) => a.localeCompare(b));
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
	
	// 加载根目录 .gitignore 规则
	const rootIgnore = await loadRootIgnore(rootPath);
	
	async function buildNode(
		currentPath: string,
		relativePath: string = '',
		ignoreStack: IgnoreEntry[] = [rootIgnore]
	): Promise<FileNode | null> {
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
			if (relativePath && shouldIgnorePath(currentPath, true, ignoreStack)) {
				return null;
			}

			// 读取当前目录的 .gitignore（若存在），并加入栈
			const localIgnore = await loadLocalIgnore(currentPath);
			const nextStack = localIgnore
				? [...ignoreStack, { base: currentPath, matcher: localIgnore }]
				: ignoreStack;

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

				const childNode = await buildNode(entryPath, entryRelativePath, nextStack);
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
			if (shouldIgnorePath(currentPath, false, ignoreStack)) {
				return null;
			}

			const textFile = await isTextFile(currentPath);
			const lineCount = textFile ? await countLines(currentPath) : undefined;

			return {
				name: path.basename(currentPath),
				path: currentPath,
				type: 'file',
				isText: textFile,
				lineCount: lineCount
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

/**
 * 获取当前 git 仓库的 HEAD commit hash
 */
export async function getCurrentCommitHash(repoRoot: string): Promise<string | null> {
	try {
		const { stdout } = await execFileAsync('git', ['-C', repoRoot, 'rev-parse', 'HEAD']);
		return stdout.trim();
	} catch {
		return null;
	}
}
