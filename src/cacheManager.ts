import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import type { BlameSegment, FileNode } from './fileTree';

export type FileBlameCacheEntry = {
	signature: string;
	blameSegments: BlameSegment[] | null;
};

export type FileBlameCacheStore = Record<string, FileBlameCacheEntry>;

export class CacheManager {
	private readonly storageUri: vscode.Uri;
	private readonly storageReady: Promise<void>;

	constructor(context: vscode.ExtensionContext) {
		if (!context.storageUri) {
			throw new Error('Workspace storage is not available');
		}
		this.storageUri = context.storageUri;
		this.storageReady = this.ensureStorageDir();
	}

	private async ensureStorageDir(): Promise<void> {
		try {
			await fs.promises.mkdir(this.storageUri.fsPath, { recursive: true });
		} catch (error) {
			console.error('Failed to create storage directory:', error);
		}
	}

	private getSnapshotCacheFilePath(hash: string): string {
		return path.join(this.storageUri.fsPath, `blame_cache_${hash}.json`);
	}

	private getFileCacheFilePath(): string {
		return path.join(this.storageUri.fsPath, 'blame_file_cache.json');
	}

	async getBlameCache(hash: string): Promise<FileNode | null> {
		await this.storageReady;
		const filePath = this.getSnapshotCacheFilePath(hash);
		try {
			const content = await fs.promises.readFile(filePath, 'utf-8');
			return JSON.parse(content) as FileNode;
		} catch {
			return null;
		}
	}

	async saveBlameCache(hash: string, data: FileNode): Promise<void> {
		await this.storageReady;
		const filePath = this.getSnapshotCacheFilePath(hash);
		try {
			await fs.promises.writeFile(filePath, JSON.stringify(data), 'utf-8');
		} catch (error) {
			console.error('Failed to save blame cache:', error);
		}
	}

	async getFileBlameCache(): Promise<FileBlameCacheStore> {
		await this.storageReady;
		const filePath = this.getFileCacheFilePath();
		try {
			const content = await fs.promises.readFile(filePath, 'utf-8');
			return JSON.parse(content) as FileBlameCacheStore;
		} catch {
			return {};
		}
	}

	async saveFileBlameCache(cache: FileBlameCacheStore): Promise<void> {
		await this.storageReady;
		const filePath = this.getFileCacheFilePath();
		try {
			await fs.promises.writeFile(filePath, JSON.stringify(cache), 'utf-8');
		} catch (error) {
			console.error('Failed to save file blame cache:', error);
		}
	}
}
