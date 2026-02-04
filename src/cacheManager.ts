import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { FileNode } from "./fileTree";

export class CacheManager {
  private storageUri: vscode.Uri;

  constructor(context: vscode.ExtensionContext) {
    if (!context.storageUri) {
      throw new Error("Workspace storage is not available");
    }
    this.storageUri = context.storageUri;
    this.ensureStorageDir();
  }

  private async ensureStorageDir() {
    try {
      await fs.promises.mkdir(this.storageUri.fsPath, { recursive: true });
    } catch (error) {
      console.error("Failed to create storage directory:", error);
    }
  }

  private getCacheFilePath(hash: string): string {
    return path.join(this.storageUri.fsPath, `blame_cache_${hash}.json`);
  }

  async getBlameCache(hash: string): Promise<FileNode | null> {
    const filePath = this.getCacheFilePath(hash);
    try {
      const content = await fs.promises.readFile(filePath, "utf-8");
      return JSON.parse(content) as FileNode;
    } catch {
      return null;
    }
  }

  async saveBlameCache(hash: string, data: FileNode): Promise<void> {
    const filePath = this.getCacheFilePath(hash);
    try {
      await fs.promises.writeFile(filePath, JSON.stringify(data), "utf-8");
    } catch (error) {
      console.error("Failed to save blame cache:", error);
    }
  }
}
