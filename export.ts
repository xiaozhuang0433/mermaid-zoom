import { App, Notice } from 'obsidian';
import { t } from './i18n';

export type ExportDestination = 'vault' | 'download';

/**
 * Rasterize an SVG element to a PNG Blob at the given scale. The live SVG
 * (which may sit inside a zoomed/panned wrapper) is cloned so the export is
 * always the full, untransformed diagram.
 */
async function svgToPngBlob(svg: SVGSVGElement, width: number, height: number, scale = 2): Promise<Blob> {
	const clone = svg.cloneNode(true) as SVGSVGElement;
	clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
	clone.setAttribute('width', String(width));
	clone.setAttribute('height', String(height));
	clone.style.transform = '';

	const svgDataUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(clone));

	const img = new Image();
	const loaded = new Promise<void>((resolve, reject) => {
		img.onload = () => resolve();
		img.onerror = () => reject(new Error('SVG image failed to load'));
	});
	img.src = svgDataUrl;
	await loaded;

	const canvas = document.createElement('canvas');
	canvas.width = Math.max(1, Math.round(width * scale));
	canvas.height = Math.max(1, Math.round(height * scale));
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('Canvas 2D context unavailable');
	ctx.scale(scale, scale);
	ctx.drawImage(img, 0, 0, width, height);

	const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
	if (!blob) throw new Error('Canvas failed to produce a PNG');
	return blob;
}

function downloadBlob(blob: Blob, filename: string): void {
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	a.remove();
	URL.revokeObjectURL(url);
}

/**
 * Export a diagram SVG as a PNG. With destination 'vault' the image is written
 * into the user's attachment folder (path resolved + de-duplicated by Obsidian);
 * with 'download' it is saved via the browser. Background is transparent and
 * the diagram's original colors are used (the dark-mode invert filter is on the
 * container, not inside the SVG, so it is not baked into the export).
 */
export async function exportDiagramPng(
	app: App,
	svg: SVGSVGElement,
	width: number,
	height: number,
	destination: ExportDestination,
): Promise<void> {
	try {
		const blob = await svgToPngBlob(svg, width, height, 2);
		const active = app.workspace.getActiveFile();
		const filename = (active?.basename ?? 'diagram') + '.png';

		if (destination === 'download') {
			downloadBlob(blob, filename);
			new Notice(t('export.downloadedNotice').replace('{name}', filename));
		} else {
			const path = await app.fileManager.getAvailablePathForAttachment(filename, active?.path);
			await app.vault.createBinary(path, await blob.arrayBuffer());
			new Notice(t('export.savedNotice').replace('{path}', path));
		}
	} catch (err) {
		console.error('Mermaid Zoom: PNG export failed', err);
		new Notice(t('export.failedNotice'));
	}
}
