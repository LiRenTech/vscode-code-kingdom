import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { performance } from 'perf_hooks';
import { fileURLToPath } from 'url';
import Module from 'module';
import ts from 'typescript';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const baselineRef = process.argv[2] || 'upstream/main';

function runGit(cwd, args, env = {}) {
	return execFileSync('git', args, {
		cwd,
		encoding: 'utf8',
		env: { ...process.env, ...env }
	});
}

function loadFileTreeModule(sourceText, label) {
	const patchedSource = sourceText.replace(
		/import\s+\*\s+as\s+vscode\s+from\s+['"]vscode['"];?/,
		'const vscode = {};'
	);
	const transpiled = ts.transpileModule(patchedSource, {
		compilerOptions: {
			module: ts.ModuleKind.CommonJS,
			target: ts.ScriptTarget.ES2020,
			esModuleInterop: true
		},
		fileName: `${label}.ts`
	});

	const outputPath = path.join(repoRoot, '.bench-temp', `${label}.cjs`);
	const mod = new Module(outputPath);
	mod.filename = outputPath;
	mod.paths = Module._nodeModulePaths(repoRoot);
	mod._compile(transpiled.outputText, outputPath);
	return mod.exports;
}

async function prepareModuleSources() {
	const currentSource = await fs.readFile(path.join(repoRoot, 'src', 'fileTree.ts'), 'utf8');
	const baselineSource = runGit(repoRoot, ['show', `${baselineRef}:src/fileTree.ts`]);
	return {
		current: loadFileTreeModule(currentSource, 'current-fileTree'),
		baseline: loadFileTreeModule(baselineSource, 'baseline-fileTree')
	};
}

async function ensureBenchTempDir() {
	await fs.mkdir(path.join(repoRoot, '.bench-temp'), { recursive: true });
}

function makeFileLines(fileIndex, lineCount) {
	return Array.from({ length: lineCount }, (_, lineIndex) => {
		const lineNo = lineIndex + 1;
		return `export const value_${fileIndex}_${lineNo} = '${fileIndex}:${lineNo}:seed';`;
	});
}

async function writeRepoFiles(repoPath, files) {
	await Promise.all(
		files.map(file =>
			fs
				.mkdir(path.dirname(path.join(repoPath, file.relativePath)), { recursive: true })
				.then(() =>
					fs.writeFile(path.join(repoPath, file.relativePath), `${file.lines.join('\n')}\n`, 'utf8')
				)
		)
	);
}

async function createSyntheticRepo() {
	const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'code-kingdom-bench-'));
	const repoPath = path.join(tempRoot, 'target-repo');
	await fs.mkdir(repoPath, { recursive: true });

	runGit(repoPath, ['init', '-b', 'main']);

	const fileCount = 120;
	const lineCount = 240;
	const files = Array.from({ length: fileCount }, (_, index) => ({
		relativePath: path.join('packages', `pkg-${index % 8}`, `module-${index}.ts`),
		lines: makeFileLines(index, lineCount)
	}));

	await writeRepoFiles(repoPath, files);
	runGit(repoPath, ['add', '.']);
	runGit(repoPath, ['commit', '-m', 'initial import'], {
		GIT_AUTHOR_NAME: 'Alice',
		GIT_AUTHOR_EMAIL: 'alice@example.com',
		GIT_COMMITTER_NAME: 'Alice',
		GIT_COMMITTER_EMAIL: 'alice@example.com'
	});

	for (const file of files) {
		for (let i = 0; i < 40; i++) {
			file.lines[i] = `export const value_bob_${i} = '${file.relativePath}:${i}:bob';`;
		}
	}
	await writeRepoFiles(repoPath, files);
	runGit(repoPath, ['add', '.']);
	runGit(repoPath, ['commit', '-m', 'bob touches headers'], {
		GIT_AUTHOR_NAME: 'Bob',
		GIT_AUTHOR_EMAIL: 'bob@example.com',
		GIT_COMMITTER_NAME: 'Bob',
		GIT_COMMITTER_EMAIL: 'bob@example.com'
	});

	for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
		if (fileIndex % 2 !== 0) {
			continue;
		}
		for (let i = 100; i < 150; i++) {
			files[fileIndex].lines[i] = `export const value_carol_${i} = '${files[fileIndex].relativePath}:${i}:carol';`;
		}
	}
	await writeRepoFiles(repoPath, files);
	runGit(repoPath, ['add', '.']);
	runGit(repoPath, ['commit', '-m', 'carol refactors middle sections'], {
		GIT_AUTHOR_NAME: 'Carol',
		GIT_AUTHOR_EMAIL: 'carol@example.com',
		GIT_COMMITTER_NAME: 'Carol',
		GIT_COMMITTER_EMAIL: 'carol@example.com'
	});

	for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
		if (fileIndex % 3 !== 0) {
			continue;
		}
		for (let i = 180; i < 220; i++) {
			files[fileIndex].lines[i] = `export const value_dave_${i} = '${files[fileIndex].relativePath}:${i}:dave';`;
		}
	}
	await writeRepoFiles(repoPath, files);
	runGit(repoPath, ['add', '.']);
	runGit(repoPath, ['commit', '-m', 'dave edits tail sections'], {
		GIT_AUTHOR_NAME: 'Dave',
		GIT_AUTHOR_EMAIL: 'dave@example.com',
		GIT_COMMITTER_NAME: 'Dave',
		GIT_COMMITTER_EMAIL: 'dave@example.com'
	});

	return { repoPath, files };
}

async function analyze(moduleApi, repoPath, cache) {
	const workspaceFolder = {
		uri: { fsPath: repoPath },
		name: path.basename(repoPath)
	};

	const buildStart = performance.now();
	const tree = await moduleApi.buildFileTree(workspaceFolder);
	const buildMs = performance.now() - buildStart;
	if (!tree) {
		throw new Error('buildFileTree returned null');
	}

	const blameStart = performance.now();
	let nextCache = cache || {};
	if (typeof moduleApi.getGitFileInventory === 'function') {
		const inventory = await moduleApi.getGitFileInventory(repoPath);
		nextCache = await moduleApi.addBlameInfo(tree, repoPath, {
			fileCache: cache || {},
			trackedBlobHashes: inventory.trackedBlobHashes,
			dirtyPaths: inventory.dirtyPaths
		});
	} else {
		await moduleApi.addBlameInfo(tree, repoPath);
	}
	const blameMs = performance.now() - blameStart;

	return {
		cache: nextCache,
		buildMs,
		blameMs,
		totalMs: buildMs + blameMs
	};
}

async function dirtySmallSubset(repoPath, files) {
	const dirtyTargets = files.slice(0, 3);
	for (const file of dirtyTargets) {
		for (let i = 10; i < 20; i++) {
			file.lines[i] = `export const dirty_${i} = '${file.relativePath}:${i}:dirty';`;
		}
	}
	await writeRepoFiles(repoPath, dirtyTargets);
}

function formatMs(ms) {
	return `${ms.toFixed(1)} ms`;
}

function speedup(before, after) {
	return `${(before / after).toFixed(2)}x`;
}

async function main() {
	await ensureBenchTempDir();
	const modules = await prepareModuleSources();
	const baselineColdTarget = await createSyntheticRepo();
	const currentColdTarget = await createSyntheticRepo();
	const baselineDirtyTarget = await createSyntheticRepo();
	const currentDirtyTarget = await createSyntheticRepo();

	const baselineCold = await analyze(modules.baseline, baselineColdTarget.repoPath);
	const currentCold = await analyze(modules.current, currentColdTarget.repoPath, {});

	await analyze(modules.baseline, baselineDirtyTarget.repoPath);
	await dirtySmallSubset(baselineDirtyTarget.repoPath, baselineDirtyTarget.files);
	const baselineDirty = await analyze(modules.baseline, baselineDirtyTarget.repoPath);

	const currentPrime = await analyze(modules.current, currentDirtyTarget.repoPath, {});
	await dirtySmallSubset(currentDirtyTarget.repoPath, currentDirtyTarget.files);
	const currentDirty = await analyze(modules.current, currentDirtyTarget.repoPath, currentPrime.cache);

	console.log(`Synthetic repo example: ${currentColdTarget.repoPath}`);
	console.log(`Baseline ref: ${baselineRef}`);
	console.log('');
	console.log('Cold run');
	console.log(`  baseline total: ${formatMs(baselineCold.totalMs)} (build ${formatMs(baselineCold.buildMs)}, blame ${formatMs(baselineCold.blameMs)})`);
	console.log(`  current  total: ${formatMs(currentCold.totalMs)} (build ${formatMs(currentCold.buildMs)}, blame ${formatMs(currentCold.blameMs)})`);
	console.log(`  speedup: ${speedup(baselineCold.totalMs, currentCold.totalMs)}`);
	console.log('');
	console.log('Dirty rerun after editing 3 tracked files');
	console.log(`  baseline total: ${formatMs(baselineDirty.totalMs)} (build ${formatMs(baselineDirty.buildMs)}, blame ${formatMs(baselineDirty.blameMs)})`);
	console.log(`  current  total: ${formatMs(currentDirty.totalMs)} (build ${formatMs(currentDirty.buildMs)}, blame ${formatMs(currentDirty.blameMs)})`);
	console.log(`  speedup: ${speedup(baselineDirty.totalMs, currentDirty.totalMs)}`);
}

main().catch(error => {
	console.error(error);
	process.exitCode = 1;
});
