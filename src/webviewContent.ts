import { FileNode } from './fileTree';

/**
 * 生成 webview 的 HTML 内容
 */
export function getWebviewContent(fileTree: FileNode, authorColors: Record<string, string> = {}): string {
	const treeJson = JSON.stringify(fileTree).replace(/</g, '\\u003c');
	const colorJson = JSON.stringify(authorColors).replace(/</g, '\\u003c');

	return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Code Kingdom - 文件布局</title>
	<style>
		* {
			margin: 0;
			padding: 0;
			box-sizing: border-box;
		}

		html, body {
			width: 100%;
			height: 100%;
			overflow: hidden;
			background: var(--vscode-editor-background);
			color: var(--vscode-editor-foreground);
			font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
		}

		#canvas {
			width: 100%;
			height: 100%;
			display: block;
		}

		.hint {
			position: absolute;
			top: 12px;
			left: 12px;
			background: rgba(0, 0, 0, 0.35);
			color: #fff;
			padding: 6px 10px;
			border-radius: 6px;
			font-size: 12px;
			user-select: none;
		}
	</style>
</head>
<body>
	<canvas id="canvas"></canvas>
	<div class="hint">拖拽平移 · 滚轮缩放 · 双击重置</div>
	<script>
		const treeData = ${treeJson};
		const authorColors = ${colorJson};

		const CONFIG = {
			fileWidth: 80,
			gap: 4,
			padding: 8,
			headerHeight: 16,
			labelFontSize: 12,
			minHeight: 12,
			folderStroke: 'rgba(255, 255, 255, 0.25)',
			fileFill: 'rgba(100, 149, 237, 0.35)',
			fileStroke: 'rgba(255, 255, 255, 0.35)',
			textColor: 'rgba(255, 255, 255, 0.7)'
		};

		const canvas = document.getElementById('canvas');
		const ctx = canvas.getContext('2d');
		const dpr = window.devicePixelRatio || 1;

		let layoutRoot = null;
		let scale = 1;
		let offsetX = 0;
		let offsetY = 0;
		let isPanning = false;
		let panStart = { x: 0, y: 0 };

		function resizeCanvas() {
			const rect = canvas.getBoundingClientRect();
			canvas.width = rect.width * dpr;
			canvas.height = rect.height * dpr;
			ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
			render();
		}

		function computeFileSize(node) {
			if (!node.isText) {
				return { width: CONFIG.fileWidth, height: CONFIG.fileWidth };
			}
			const lines = Math.max(CONFIG.minHeight, node.lineCount || 1);
			return { width: CONFIG.fileWidth, height: lines };
		}

		function packMaxRects(rects, targetWidth) {
			const totalHeight = rects.reduce((sum, r) => sum + r.height, 0) + rects.length * CONFIG.gap;
			const freeRects = [{ x: 0, y: 0, width: targetWidth, height: totalHeight }];
			const placed = [];

			const sorted = rects.slice().sort((a, b) => {
				const aMax = Math.max(a.width, a.height);
				const bMax = Math.max(b.width, b.height);
				return bMax - aMax;
			});

			for (const rect of sorted) {
				let bestIndex = -1;
				let bestScore = Infinity;
				for (let i = 0; i < freeRects.length; i++) {
					const fr = freeRects[i];
					if (rect.width <= fr.width && rect.height <= fr.height) {
						const leftoverX = fr.width - rect.width;
						const leftoverY = fr.height - rect.height;
						const score = Math.min(leftoverX, leftoverY);
						if (score < bestScore) {
							bestScore = score;
							bestIndex = i;
						}
					}
				}

				if (bestIndex === -1) {
					// 放不下时扩展高度
					const extendRect = { x: 0, y: totalHeight, width: targetWidth, height: rect.height + CONFIG.gap };
					freeRects.push(extendRect);
					bestIndex = freeRects.length - 1;
				}

				const target = freeRects[bestIndex];
				const placedRect = { ...rect, x: target.x, y: target.y };
				placed.push(placedRect);

				freeRects.splice(bestIndex, 1);

				const right = {
					x: target.x + rect.width + CONFIG.gap,
					y: target.y,
					width: target.width - rect.width - CONFIG.gap,
					height: rect.height
				};
				const bottom = {
					x: target.x,
					y: target.y + rect.height + CONFIG.gap,
					width: target.width,
					height: target.height - rect.height - CONFIG.gap
				};

				if (right.width > 0 && right.height > 0) {
					freeRects.push(right);
				}
				if (bottom.width > 0 && bottom.height > 0) {
					freeRects.push(bottom);
				}

				pruneFreeRects(freeRects);
			}

			let maxX = 0;
			let maxY = 0;
			for (const rect of placed) {
				maxX = Math.max(maxX, rect.x + rect.width);
				maxY = Math.max(maxY, rect.y + rect.height);
			}

			return { width: maxX, height: maxY, children: placed };
		}

		function pruneFreeRects(freeRects) {
			for (let i = freeRects.length - 1; i >= 0; i--) {
				const a = freeRects[i];
				for (let j = 0; j < freeRects.length; j++) {
					if (i === j) continue;
					const b = freeRects[j];
					if (a.x >= b.x &&
						a.y >= b.y &&
						a.x + a.width <= b.x + b.width &&
						a.y + a.height <= b.y + b.height) {
						freeRects.splice(i, 1);
						break;
					}
				}
			}
		}

		function pickBestPacking(rects) {
			const totalArea = rects.reduce((sum, r) => sum + r.width * r.height, 0);
			const maxWidth = Math.max(...rects.map(r => r.width));
			const base = Math.max(maxWidth, Math.sqrt(totalArea) || maxWidth);
			const candidates = [0.7, 0.85, 1, 1.2, 1.5, 2].map(f => base * f);

			let best = null;
			for (const target of candidates) {
				const packed = packMaxRects(rects, target);
				const area = packed.width * packed.height;
				const score = Math.abs(packed.width - packed.height) + 0.02 * (area - totalArea);
				if (!best || score < best.score) {
					best = { ...packed, score };
				}
			}

			return best || packMaxRects(rects, base);
		}

		function computeLayout(node) {
			if (node.type === 'file') {
				const size = computeFileSize(node);
				return { ...node, ...size, children: [] };
			}

			const childNodes = (node.children || []).map(computeLayout);
			if (childNodes.length === 0) {
				const size = computeFileSize({ isText: false });
				return { ...node, width: size.width, height: size.height, children: [] };
			}

			const packed = pickBestPacking(childNodes);
			const width = packed.width + CONFIG.padding * 2;
			const height = packed.height + CONFIG.padding * 2 + CONFIG.headerHeight;
			const children = packed.children.map(child => ({
				...child,
				x: child.x + CONFIG.padding,
				y: child.y + CONFIG.padding + CONFIG.headerHeight
			}));

			return { ...node, width, height, children };
		}

		function drawNode(node, x, y) {
			if (node.type === 'folder') {
				ctx.strokeStyle = CONFIG.folderStroke;
				ctx.strokeRect(x, y, node.width, node.height);

				ctx.fillStyle = CONFIG.textColor;
				ctx.font = CONFIG.labelFontSize + 'px sans-serif';
				ctx.fillText(node.name, x + 4, y + CONFIG.headerHeight - 4);

				for (const child of node.children || []) {
					drawNode(child, x + child.x, y + child.y);
				}
			} else {
				if (node.blameSegments && node.blameSegments.length > 0) {
					drawBlameSegments(node, x, y);
				} else {
					ctx.fillStyle = CONFIG.fileFill;
					ctx.fillRect(x, y, node.width, node.height);
				}
				ctx.strokeStyle = CONFIG.fileStroke;
				ctx.strokeRect(x, y, node.width, node.height);

				drawFileLabel(node.name, x, y, node.width, node.height);
			}
		}

		function drawBlameSegments(node, x, y) {
			const segments = node.blameSegments || [];
			const totalLines = segments.reduce((sum, seg) => sum + seg.lines, 0) || 1;
			let offsetY = y;
			for (const seg of segments) {
				const height = (seg.lines / totalLines) * node.height;
				ctx.fillStyle = colorForAuthor(seg.author);
				ctx.fillRect(x, offsetY, node.width, height);
				offsetY += height;
			}
		}

		function colorForAuthor(author) {
			if (authorColors && authorColors[author]) {
				return authorColors[author];
			}
			let hash = 0;
			for (let i = 0; i < author.length; i++) {
				hash = (hash * 31 + author.charCodeAt(i)) | 0;
			}
			const hue = Math.abs(hash) % 360;
			return 'hsl(' + hue + ', 55%, 45%)';
		}

		function drawFileLabel(name, x, y, width, height) {
			const padding = 2;
			const fontSize = Math.max(6, Math.min(10, width / 3));
			const lineHeight = fontSize + 2;
			const maxLines = Math.max(1, Math.floor((height - padding * 2) / lineHeight));

			ctx.save();
			ctx.beginPath();
			ctx.rect(x, y, width, height);
			ctx.clip();

			ctx.fillStyle = CONFIG.textColor;
			ctx.font = fontSize + 'px sans-serif';

			const words = name.split(/([._-])/).filter(Boolean);
			const lines = [];
			let current = '';

			for (const word of words) {
				const test = current ? current + word : word;
				if (ctx.measureText(test).width <= width - padding * 2) {
					current = test;
				} else {
					if (current) lines.push(current);
					current = word;
				}
				if (lines.length >= maxLines) break;
			}
			if (lines.length < maxLines && current) lines.push(current);

			for (let i = 0; i < Math.min(lines.length, maxLines); i++) {
				let text = lines[i];
				const maxWidth = width - padding * 2;
				if (ctx.measureText(text).width > maxWidth) {
					while (text.length > 0 && ctx.measureText(text + '…').width > maxWidth) {
						text = text.slice(0, -1);
					}
					text = text + '…';
				}
				ctx.fillText(text, x + padding, y + padding + (i + 1) * lineHeight - 2);
			}

			ctx.restore();
		}

		function render() {
			if (!layoutRoot) {
				return;
			}
			ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
			ctx.save();
			ctx.translate(offsetX, offsetY);
			ctx.scale(scale, scale);
			drawNode(layoutRoot, 0, 0);
			ctx.restore();
		}

		function resetView() {
			if (!layoutRoot) return;
			const rect = canvas.getBoundingClientRect();
			const viewWidth = rect.width;
			const viewHeight = rect.height;
			const scaleX = (viewWidth - 40) / layoutRoot.width;
			const scaleY = (viewHeight - 40) / layoutRoot.height;
			scale = Math.max(0.05, Math.min(scaleX, scaleY, 2));
			offsetX = (viewWidth - layoutRoot.width * scale) / 2;
			offsetY = (viewHeight - layoutRoot.height * scale) / 2;
			render();
		}

		function init() {
			layoutRoot = computeLayout(treeData);
			resizeCanvas();
			resetView();
		}

		canvas.addEventListener('wheel', (event) => {
			event.preventDefault();
			const rect = canvas.getBoundingClientRect();
			const mouseX = event.clientX - rect.left;
			const mouseY = event.clientY - rect.top;
			const beforeX = (mouseX - offsetX) / scale;
			const beforeY = (mouseY - offsetY) / scale;

			const delta = event.deltaY < 0 ? 1.1 : 0.9;
			scale = Math.min(20, Math.max(0.05, scale * delta));
			offsetX = mouseX - beforeX * scale;
			offsetY = mouseY - beforeY * scale;
			render();
		}, { passive: false });

		canvas.addEventListener('mousedown', (event) => {
			isPanning = true;
			panStart = { x: event.clientX - offsetX, y: event.clientY - offsetY };
		});

		window.addEventListener('mousemove', (event) => {
			if (!isPanning) return;
			offsetX = event.clientX - panStart.x;
			offsetY = event.clientY - panStart.y;
			render();
		});

		window.addEventListener('mouseup', () => {
			isPanning = false;
		});

		canvas.addEventListener('dblclick', () => {
			resetView();
		});

		window.addEventListener('resize', resizeCanvas);

		init();
	</script>
</body>
</html>`;
}
