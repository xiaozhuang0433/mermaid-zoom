import { Platform, Plugin, setIcon } from 'obsidian';
import { MermaidZoomSettings, DEFAULT_SETTINGS, MermaidZoomSettingTab } from './settings';
import { ZoomState, updateTransform, zoom, addWheelZoom, addDragPan, addTouchGestures } from './gestures';
import { t } from './i18n';
import { exportDiagramPng } from './export';

export default class MermaidZoomPlugin extends Plugin {
	private readonly defaultMinScale = 0.1;
	private readonly defaultMaxScale = 5;
	private mutationObserver?: MutationObserver;
	settings: MermaidZoomSettings = DEFAULT_SETTINGS;

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<MermaidZoomSettings>);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new MermaidZoomSettingTab(this.app, this));

		console.debug('Loading Mermaid Zoom plugin');

		// Set up observers
		this.setupMutationObserver();

		// Initial processing of existing content
		this.app.workspace.onLayoutReady(() => {
			this.decorateAllMermaidBlocks();
		});

		// Re-process when layout changes
		this.registerEvent(this.app.workspace.on('layout-change', () => {
			this.decorateAllMermaidBlocks();
		}));

		// Also listen for active leaf changes
		this.registerEvent(this.app.workspace.on('active-leaf-change', () => {
			this.decorateAllMermaidBlocks();
		}));

		// Listen for file open
		this.registerEvent(this.app.workspace.on('file-open', () => {
			// Delay to allow mermaid to render
			window.setTimeout(() => this.decorateAllMermaidBlocks(), 200);
		}));
	}

	private setupMutationObserver() {
		this.mutationObserver = new MutationObserver((mutations) => {
			for (const mutation of Array.from(mutations)) {
				for (const node of Array.from(mutation.addedNodes)) {
					if (node.instanceOf(HTMLElement)) {
						this.decorateMermaidBlocksIn(node);
					}
				}
			}
		});

		// Start observing the document body
		this.mutationObserver.observe(document.body, {
			childList: true,
			subtree: true
		});
	}

	// Obsidian structure: <div class="mermaid"><svg id="mermaid-xxx">...</svg></div>.
	// A bare .mermaid div may be added before its svg renders, and a rendered
	// svg may be injected into an existing div — catch both shapes.
	private decorateMermaidBlocksIn(root: HTMLElement) {
		const blocks = Array.from(root.querySelectorAll<HTMLElement>('.mermaid'));
		if (root.classList.contains('mermaid')) {
			blocks.push(root);
		} else {
			for (const svg of Array.from(root.querySelectorAll('.mermaid svg'))) {
				const host = svg.closest('.mermaid');
				if (host) blocks.push(host as HTMLElement);
			}
		}
		for (const block of blocks) {
			this.decorateMermaidBlock(block);
		}
	}

	/** Decorate every mermaid block in the document; also re-syncs appearance
	 * classes (used after settings change). */
	decorateAllMermaidBlocks() {
		const blocks = document.querySelectorAll<HTMLElement>('.mermaid');
		for (const block of Array.from(blocks)) {
			this.decorateMermaidBlock(block);
		}
	}

	// Appearance classes are re-applied on every visit — the operation is
	// idempotent, and it keeps re-attached blocks in sync: live preview
	// detaches far embeds and re-attaches the SAME cached node when you
	// scroll back, so a node that missed a settings change must catch up the
	// moment it reappears. The mermaid-zoom-ready marker only guards the
	// one-time button insert.
	private decorateMermaidBlock(block: HTMLElement) {
		// Skip blocks whose svg hasn't rendered yet (e.g. syntax-error blocks
		// never get one) — the MutationObserver re-visits when it appears.
		if (!block.querySelector('svg')) return;

		block.removeClass('mermaid-zoom-align-left', 'mermaid-zoom-align-center', 'mermaid-zoom-align-right');
		block.addClass(`mermaid-zoom-align-${this.settings.alignment}`);
		block.toggleClass('mermaid-zoom-bordered', this.settings.showContainerBorder);

		if (!block.hasClass('mermaid-zoom-ready')) {
			block.addClass('mermaid-zoom-ready');
			this.addFullscreenButton(block);
		}
	}

	private addFullscreenButton(block: HTMLElement) {
		const fullscreenBtn = block.createEl('button', {
			cls: 'mermaid-zoom-icon-btn mermaid-zoom-fullscreen-btn'
		});

		// Create SVG icon
		const svgNS = 'http://www.w3.org/2000/svg';
		const svg = document.createElementNS(svgNS, 'svg');
		svg.setAttribute('width', '18');
		svg.setAttribute('height', '18');
		svg.setAttribute('viewBox', '0 0 16 16');
		svg.setAttribute('fill', 'none');
		svg.setAttribute('stroke', 'currentColor');
		svg.setAttribute('stroke-width', '1');
		svg.setAttribute('stroke-linecap', 'round');
		svg.setAttribute('stroke-linejoin', 'round');

		const polyline1 = document.createElementNS(svgNS, 'polyline');
		polyline1.setAttribute('points', '1,10 1,15 6,15');
		svg.appendChild(polyline1);

		const polyline2 = document.createElementNS(svgNS, 'polyline');
		polyline2.setAttribute('points', '15,10 15,15 10,15');
		svg.appendChild(polyline2);

		const polyline3 = document.createElementNS(svgNS, 'polyline');
		polyline3.setAttribute('points', '1,6 1,1 6,1');
		svg.appendChild(polyline3);

		const polyline4 = document.createElementNS(svgNS, 'polyline');
		polyline4.setAttribute('points', '15,6 15,1 10,1');
		svg.appendChild(polyline4);

		fullscreenBtn.appendChild(svg);
		fullscreenBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			// Resolve the svg at click time: live preview may re-render the
			// diagram, replacing the node captured at decoration time.
			const currentSvg = block.querySelector('svg');
			if (currentSvg) {
				this.openFullscreenModal(currentSvg);
			}
		});
		// No cleanup registration needed: the button lives inside the .mermaid
		// block and dies with it (live preview unrender removes the whole block).
	}

	private openFullscreenModal(sourceSvg: SVGSVGElement) {
		const controlsRight = Platform.isMobile ? '20px' : '15px';
		const controlsBottom = Platform.isMobile ? '28px' : '15px';

		// Create modal overlay
		const modal = createDiv();
		modal.className = 'mermaid-zoom-modal';
		modal.style.cssText = `
			position: fixed;
			inset: 0;
			background: var(--background-primary);
			z-index: 9999;
			display: flex;
			flex-direction: column;
			box-sizing: border-box;
		`;

		// Create content area
		const content = createDiv();
		content.className = 'mermaid-zoom-modal-content';
		content.style.cssText = `
			flex: 1;
			overflow: hidden;
			position: relative;
			display: flex;
			align-items: center;
			justify-content: center;
		`;

		// Create zoom container inside modal
		const modalZoomContainer = createDiv();
		modalZoomContainer.className = 'mermaid-zoom-modal-zoom-container';
		modalZoomContainer.style.cssText = `
			width: 100%;
			height: 100%;
			overflow: hidden;
			position: relative;
		`;

		// Create content wrapper for transformations
		const modalContentWrapper = createDiv();
		modalContentWrapper.className = 'mermaid-zoom-modal-wrapper';
		modalContentWrapper.style.cssText = `
			transform-origin: 0 0;
			transition: transform 0.1s ease-out;
			width: fit-content;
			position: absolute;
		`;

		// Clone the SVG
		const svgClone = sourceSvg.cloneNode(true) as SVGSVGElement;
		modalContentWrapper.appendChild(svgClone);
		modalZoomContainer.appendChild(modalContentWrapper);
		content.appendChild(modalZoomContainer);

		// Measure the clone here, inside the fit-content wrapper — the same
		// conditions the old wrap-time measurement used, but taken at open
		// time so it always reflects the diagram's final rendered state.
		const cloneRect = svgClone.getBoundingClientRect();
		const viewBox = svgClone.viewBox?.baseVal;
		const svgOriginalWidth = cloneRect.width || viewBox?.width || parseFloat(svgClone.getAttribute('width') || '') || 300;
		const svgOriginalHeight = cloneRect.height || viewBox?.height || parseFloat(svgClone.getAttribute('height') || '') || 200;

		// Modal zoom state
		const modalState: ZoomState = {
			scale: 1,
			minScale: this.defaultMinScale,
			maxScale: this.defaultMaxScale,
			isDragging: false,
			startX: 0,
			startY: 0,
			translateX: 0,
			translateY: 0,
			svg: svgClone,
			container: modalZoomContainer,
			svgOriginalWidth: svgOriginalWidth,
			svgOriginalHeight: svgOriginalHeight
		};

		// Bottom-right control bar: zoom in/out, reset, scale readout, PNG
		// export and close — same 26px ghost icon-button style as the inline
		// fullscreen trigger. Gestures (wheel/pinch/drag) remain the primary
		// interaction; these buttons cover precision and keyboard/AT users.
		const controls = createDiv();
		controls.className = 'mermaid-zoom-modal-controls';
		controls.style.cssText = `
			position: absolute;
			bottom: ${controlsBottom};
			right: ${controlsRight};
			z-index: 1;
			display: flex;
			align-items: center;
			gap: 2px;
		`;

		const makeIconButton = (iconId: string, label: string, onClick: () => void) => {
			const btn = createEl('button', { cls: 'mermaid-zoom-icon-btn' });
			setIcon(btn, iconId);
			btn.setAttribute('aria-label', label);
			btn.title = label;
			btn.addEventListener('click', (e) => {
				e.stopPropagation();
				onClick();
			});
			controls.appendChild(btn);
		};

		makeIconButton('plus', t('modal.zoomIn'), () => zoom(modalContentWrapper, modalState, 1.2));
		makeIconButton('minus', t('modal.zoomOut'), () => zoom(modalContentWrapper, modalState, 0.8));
		makeIconButton('rotate-ccw', t('modal.reset'), () => {
			this.fitToContainerModal(modalZoomContainer, modalContentWrapper, modalState);
		});

		// Scale readout, kept in sync by updateTransform on every change.
		const scaleIndicator = createSpan({ cls: 'mermaid-zoom-scale' });
		scaleIndicator.style.cssText = `
			min-width: 38px;
			text-align: center;
			font-size: 12px;
			font-family: var(--font-ui-medium);
			color: var(--text-muted);
		`;
		modalState.scaleIndicator = scaleIndicator;
		controls.appendChild(scaleIndicator);

		makeIconButton('download', t('export.buttonTitle'), () => {
			void exportDiagramPng(this.app, svgClone, svgOriginalWidth, svgOriginalHeight, this.settings.exportDestination);
		});

		// Close button ends the bar; hover gets a destructive tint via CSS.
		const closeBtn = createEl('button', { cls: 'mermaid-zoom-icon-btn mermaid-zoom-modal-close' });
		setIcon(closeBtn, 'x');
		closeBtn.setAttribute('aria-label', t('modal.close'));
		closeBtn.title = t('modal.close');
		controls.appendChild(closeBtn);

		modal.appendChild(controls);
		modal.appendChild(content);

		// 注册模态框交互，收集清理函数以便关闭时移除
		const modalCleanupFns: (() => void)[] = [];
		modalCleanupFns.push(addWheelZoom(modalZoomContainer, modalContentWrapper, modalState, this.settings.zoomSensitivity));
		modalCleanupFns.push(addDragPan(modalZoomContainer, modalContentWrapper, modalState));
		modalCleanupFns.push(addTouchGestures(modalZoomContainer, modalContentWrapper, modalState, this.settings.zoomSensitivity));

		// Hardware Back button (Android) closes the modal. The only way to
		// intercept it is to push a history entry and treat the resulting
		// popstate as a close.
		//
		// CRITICAL: this history dance is MOBILE-ONLY, and we NEVER call
		// history.back() ourselves.
		// - Obsidian wires its back/forward navigation (desktop title-bar
		//   arrows, and the mobile hardware Back button) to the History API.
		//   A programmatic history.back() is therefore read as "go back in the
		//   active leaf", which navigates away from / closes the currently
		//   open file. That was the bug: clicking ✕ called history.back() to
		//   "balance" the pushed entry, and the note vanished with the modal.
		// - So the pushed entry is consumed only by the hardware Back button
		//   itself, via the popstate handler below. Closing via ✕/ESC leaves
		//   the entry, which is harmless: popping it returns to the current
		//   note's own history entry, so no leaf navigation occurs.
		// - Desktop has no hardware Back button, so we skip the whole thing
		//   there and rely on ✕/ESC.
		const popstateHandler = () => closeModal();

		const closeModal = () => {
			window.removeEventListener('popstate', popstateHandler);
			for (const cleanup of modalCleanupFns) {
				cleanup();
			}
			modal.remove();
			document.removeEventListener('keydown', handleKeydown);
		};

		const handleKeydown = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				closeModal();
			} else if (e.key === '+' || e.key === '=') {
				zoom(modalContentWrapper, modalState, 1.2);
			} else if (e.key === '-' || e.key === '_') {
				zoom(modalContentWrapper, modalState, 0.8);
			} else if (e.key === '0') {
				this.fitToContainerModal(modalZoomContainer, modalContentWrapper, modalState);
			}
		};
		document.addEventListener('keydown', handleKeydown);

		// Only intercept the hardware Back button on mobile.
		if (Platform.isMobile) {
			history.pushState(null, '');
			window.addEventListener('popstate', popstateHandler);
		}

		closeBtn.addEventListener('click', closeModal);

		// Add the modal to the document.
		document.body.appendChild(modal);

		// Fit the container once the modal is visible.
		window.requestAnimationFrame(() => {
			this.fitToContainerModal(modalZoomContainer, modalContentWrapper, modalState);
		});
	}

	private fitToContainerModal(container: HTMLElement, contentWrapper: HTMLElement, state: ZoomState) {
		// 零值保护：模态框容器或 SVG 尺寸为零时跳过
		if (container.clientWidth <= 0 || container.clientHeight <= 0) return;
		if (state.svgOriginalWidth <= 0 || state.svgOriginalHeight <= 0) return;

		// 计算可用空间
		const padding = 40;
		const availableWidth = container.clientWidth - padding * 2;
		const availableHeight = container.clientHeight - padding * 2;

		// Use saved original SVG dimensions
		const svgWidth = state.svgOriginalWidth;
		const svgHeight = state.svgOriginalHeight;

		// Calculate scale to fit
		const scaleX = availableWidth / svgWidth;
		const scaleY = availableHeight / svgHeight;
		const fitScale = Math.min(scaleX, scaleY, 2); // Allow up to 200% in modal

		// Center the SVG
		const scaledWidth = svgWidth * fitScale;
		const scaledHeight = svgHeight * fitScale;
		const centerX = (container.clientWidth - scaledWidth) / 2;
		const centerY = (container.clientHeight - scaledHeight) / 2;

		// Apply the scale and center
		state.scale = fitScale;
		state.translateX = centerX;
		state.translateY = centerY;
		updateTransform(contentWrapper, state);
	}

	onunload() {
		console.debug('Unloading Mermaid Zoom plugin');

		this.mutationObserver?.disconnect();

		// Strip decoration so a reloaded plugin starts clean.
		const decorated = document.querySelectorAll('.mermaid-zoom-ready');
		for (const block of Array.from(decorated) as HTMLElement[]) {
			block.removeClass('mermaid-zoom-ready', 'mermaid-zoom-bordered',
				'mermaid-zoom-align-left', 'mermaid-zoom-align-center', 'mermaid-zoom-align-right');
			for (const btn of Array.from(block.querySelectorAll('.mermaid-zoom-fullscreen-btn'))) {
				btn.remove();
			}
		}
	}
}
