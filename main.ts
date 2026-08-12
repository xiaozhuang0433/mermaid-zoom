import { Platform, Plugin } from 'obsidian';
import { MermaidZoomSettings, DEFAULT_SETTINGS, MermaidZoomSettingTab } from './settings';
import { ZoomState, updateTransform, addWheelZoom, addDragPan, addTouchGestures } from './gestures';

export default class MermaidZoomPlugin extends Plugin {
	private readonly zoomStates = new Map<HTMLElement, ZoomState>();
	private readonly defaultMinScale = 0.1;
	private readonly defaultMaxScale = 5;
	private readonly defaultScale = 1;
	private mutationObserver?: MutationObserver;
	private resizeObserver?: ResizeObserver;
	private processedElements = new WeakSet<SVGSVGElement>();
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
		this.setupResizeObserver();

		// Initial processing of existing content
		this.app.workspace.onLayoutReady(() => {
			this.processAllMermaidDiagrams();
		});

		// Re-process when layout changes
		this.registerEvent(this.app.workspace.on('layout-change', () => {
			this.processAllMermaidDiagrams();
		}));

		// Also listen for active leaf changes
		this.registerEvent(this.app.workspace.on('active-leaf-change', () => {
			this.processAllMermaidDiagrams();
		}));

		// Listen for file open
		this.registerEvent(this.app.workspace.on('file-open', () => {
			// Delay to allow mermaid to render
			window.setTimeout(() => this.processAllMermaidDiagrams(), 200);
		}));
	}

	private setupResizeObserver() {
		this.resizeObserver = new ResizeObserver((entries) => {
			for (const entry of entries) {
				const container = entry.target as HTMLElement;
				// 容器已从 DOM 中移除时，停止观察并清理状态
				if (!document.contains(container)) {
					this.resizeObserver?.unobserve(container);
					const contentWrapper = container.querySelector('.mermaid-zoom-content') as HTMLElement;
					if (contentWrapper) {
						this.zoomStates.delete(contentWrapper);
					}
					continue;
				}
				const contentWrapper = container.querySelector('.mermaid-zoom-content') as HTMLElement;
				if (!contentWrapper) continue;
				const state = this.zoomStates.get(contentWrapper);
				if (state) {
					this.fitToContainer(container, contentWrapper, state.svg, state);
				}
			}
		});
	}

	private setupMutationObserver() {
		this.mutationObserver = new MutationObserver((mutations) => {
			for (const mutation of Array.from(mutations)) {
				for (const node of Array.from(mutation.addedNodes)) {
					if (node.instanceOf(HTMLElement) || node.instanceOf(SVGElement)) {
						this.processPotentialMermaidElement(node);
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

	private processPotentialMermaidElement(element: Element) {
		// Check if this element is or contains a mermaid svg
		// Obsidian structure: <div class="mermaid"><svg id="mermaid-xxx">...</svg></div>
		const mermaidSvgs: SVGSVGElement[] = [];

		if (element.instanceOf(HTMLElement)) {
			// Find SVGs inside .mermaid containers or SVGs with mermaid id
			const svgs = Array.from(element.querySelectorAll('.mermaid svg, svg[id^="mermaid-"]'));
			mermaidSvgs.push(...svgs as SVGSVGElement[]);

			// Also check if element itself is a mermaid container
			if (element.classList.contains('mermaid')) {
				const svg = element.querySelector('svg');
				if (svg) mermaidSvgs.push(svg);
			}
		}

		for (const svg of mermaidSvgs) {
			if (!this.processedElements.has(svg) && !this.hasZoomContainer(svg)) {
				this.wrapMermaidWithZoom(svg);
				this.processedElements.add(svg);
			}
		}
	}

	private hasZoomContainer(svg: SVGSVGElement): boolean {
		// Check if SVG or its .mermaid parent is already inside a zoom container
		const mermaidContainer = svg.closest('.mermaid');
		const parent = mermaidContainer?.parentElement || svg.parentElement;
		return parent?.hasClass('mermaid-zoom-content') ?? false;
	}

	private processAllMermaidDiagrams() {
		// Find all mermaid SVGs - Obsidian uses .mermaid container with SVG inside
		const mermaidSvgs = document.querySelectorAll('.mermaid svg, svg[id^="mermaid-"]');
		for (const mermaidSvg of Array.from(mermaidSvgs) as SVGSVGElement[]) {
			if (!this.processedElements.has(mermaidSvg) && !this.hasZoomContainer(mermaidSvg)) {
				this.wrapMermaidWithZoom(mermaidSvg);
				this.processedElements.add(mermaidSvg);
			}
		}
	}

	wrapMermaidWithZoom(svg: SVGSVGElement) {
		if (!svg.parentElement) return;

		// Find the original .mermaid container
		const mermaidContainer = svg.closest('.mermaid') as HTMLElement;
		const targetParent = mermaidContainer?.parentElement || svg.parentElement;
		const targetElement = mermaidContainer || svg;

		if (!targetParent) return;

		// Create zoom container.
		// No border/background/margin of its own: Obsidian already frames the
		// mermaid code block, and adding another box here produced a nested
		// "double border". Stay transparent so the native frame is the only one.
		// Height is intentionally left unset here: the SVG hasn't been moved into
		// contentWrapper yet, so measuring it now can be stale (e.g. if the old
		// parent constrained its rendered width/height). We size the container
		// after the move, once we can measure the SVG's true dimensions.
		const container = createDiv('mermaid-zoom-container');
		container.style.cssText = `
			position: relative;
			overflow: hidden;
			width: 100%;
			min-width: 150px;
			min-height: 100px;
			margin: 0;
			padding: 1em;
			padding-bottom: 2.5em;
			box-sizing: border-box;
			${this.settings.showContainerBorder ? 'border: 1px dashed var(--background-modifier-border); border-radius: 4px;' : ''}
		`;

		// Create content wrapper for transformations
		const contentWrapper = container.createDiv('mermaid-zoom-content');
		contentWrapper.style.cssText = `
			transform-origin: 0 0;
			transition: transform 0.1s ease-out;
			width: fit-content;
		`;

		// Insert container and move content inside
		targetParent.insertBefore(container, targetElement);
		contentWrapper.appendChild(targetElement);

		// Get SVG original dimensions after the move, so measurements reflect its
		// true unconstrained size rather than whatever the old parent forced.
		const svgRect = svg.getBoundingClientRect();
		const svgOriginalWidth = svgRect.width || svg.clientWidth || 300;
		const svgOriginalHeight = svgRect.height || svg.clientHeight || 200;

		// Now that the container is laid out and the SVG's real size is known,
		// compute the container height so the diagram is fully visible at the
		// chosen default zoom (bounded only by available width, never clipped
		// by height) unless maxHeight caps it.
		const computedStyle = getComputedStyle(container);
		const paddingTop = parseFloat(computedStyle.paddingTop) || 0;
		const paddingBottom = parseFloat(computedStyle.paddingBottom) || 0;
		const paddingLeft = parseFloat(computedStyle.paddingLeft) || 0;
		const paddingRight = parseFloat(computedStyle.paddingRight) || 0;
		const availableWidth = container.clientWidth - paddingLeft - paddingRight;
		const defaultZoomScale = this.settings.defaultZoom / 100;
		const effectiveScale = Math.min(availableWidth / svgOriginalWidth, defaultZoomScale);
		const naturalHeight = svgOriginalHeight * effectiveScale + paddingTop + paddingBottom;
		const containerHeight = this.settings.maxHeight > 0
			? Math.min(naturalHeight, this.settings.maxHeight)
			: naturalHeight;
		container.style.height = `${containerHeight}px`;

		// Initialize zoom state
		const state: ZoomState = {
			scale: this.defaultScale,
			minScale: this.defaultMinScale,
			maxScale: this.defaultMaxScale,
			isDragging: false,
			startX: 0,
			startY: 0,
			translateX: 0,
			translateY: 0,
			svg: svg,
			container: container,
			svgOriginalWidth: svgOriginalWidth,
			svgOriginalHeight: svgOriginalHeight,
			locked: false
		};
		this.zoomStates.set(contentWrapper, state);

		// 注册控件和交互，插件卸载时自动清理
		this.register(this.createControls(container, contentWrapper, state));
		this.register(addWheelZoom(container, contentWrapper, state));
		this.register(addDragPan(container, contentWrapper, state));
		this.register(addTouchGestures(container, contentWrapper, state));

		// Fit SVG to container initially
		this.fitToContainer(container, contentWrapper, svg, state);

		// Re-fit on container resize
		this.resizeObserver?.observe(container);
	}

	private fitToContainer(container: HTMLElement, contentWrapper: HTMLElement, svg: SVGSVGElement, state: ZoomState) {
		// 零值保护：容器或 SVG 尺寸为零时跳过，避免产生无效缩放
		if (container.clientWidth <= 0 || container.clientHeight <= 0) return;
		if (state.svgOriginalWidth <= 0 || state.svgOriginalHeight <= 0) return;

		// 从实际渲染样式中获取内边距，避免硬编码 1em=16px 的假设偏差
		const computedStyle = getComputedStyle(container);
		const paddingLeft = parseFloat(computedStyle.paddingLeft) || 0;
		const paddingRight = parseFloat(computedStyle.paddingRight) || 0;
		const paddingTop = parseFloat(computedStyle.paddingTop) || 0;
		const paddingBottom = parseFloat(computedStyle.paddingBottom) || 0;

		// 计算可用空间（基于实际内边距）
		const availableWidth = container.clientWidth - paddingLeft - paddingRight;
		const availableHeight = container.clientHeight - paddingTop - paddingBottom;

		// 使用保存的原始 SVG 尺寸
		const svgWidth = state.svgOriginalWidth;
		const svgHeight = state.svgOriginalHeight;

		// 计算适配缩放比例
		const scaleX = availableWidth / svgWidth;
		const scaleY = availableHeight / svgHeight;
		const fitScale = Math.min(scaleX, scaleY, this.settings.defaultZoom / 100);

		// Calculate horizontal position based on alignment setting
		const scaledWidth = svgWidth * fitScale;
		const scaledHeight = svgHeight * fitScale;
		let offsetX: number;
		switch (this.settings.alignment) {
			case 'left':
				offsetX = 0;
				break;
			case 'right':
				offsetX = availableWidth - scaledWidth;
				break;
			case 'center':
			default:
				offsetX = (availableWidth - scaledWidth) / 2;
				break;
		}
		const centerY = (container.clientHeight - scaledHeight) / 2 - paddingTop;

		// Apply scale and position
		state.scale = fitScale;
		state.translateX = offsetX;
		state.translateY = Math.max(0, centerY);
		updateTransform(contentWrapper, state);
	}

	private openFullscreenModal(state: ZoomState) {
		const mobileHeaderTopPadding = Platform.isMobile ? '44px' : '10px';
		const mobileHeaderRightPadding = Platform.isMobile ? '20px' : '15px';

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
			padding-top: env(safe-area-inset-top, 0px);
			padding-right: env(safe-area-inset-right, 0px);
			padding-bottom: env(safe-area-inset-bottom, 0px);
			padding-left: env(safe-area-inset-left, 0px);
			box-sizing: border-box;
		`;

		// Create header with close button
		const header = createDiv();
		header.className = 'mermaid-zoom-modal-header';
		header.style.cssText = `
			display: flex;
			justify-content: flex-end;
			padding: ${mobileHeaderTopPadding} ${mobileHeaderRightPadding} 10px 15px;
			background: var(--background-secondary);
			border-bottom: 1px solid var(--background-modifier-border);
			flex: 0 0 auto;
		`;

		// Close button
		const closeBtn = createEl('button');
		closeBtn.className = 'mermaid-zoom-modal-close';
		closeBtn.textContent = '✕';
		closeBtn.style.cssText = `
			width: 32px;
			height: 32px;
			border: none;
			color: var(--text-normal);
			border-radius: 4px;
			cursor: pointer;
			font-size: 18px;
			display: flex;
			align-items: center;
			justify-content: center;
			transition: background 0.2s;
		`;
		header.appendChild(closeBtn);

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
		const svgClone = state.svg.cloneNode(true) as SVGSVGElement;
		modalContentWrapper.appendChild(svgClone);
		modalZoomContainer.appendChild(modalContentWrapper);
		content.appendChild(modalZoomContainer);

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
			svgOriginalWidth: state.svgOriginalWidth,
			svgOriginalHeight: state.svgOriginalHeight,
			locked: false
		};

		modal.appendChild(header);
		modal.appendChild(content);

		// 注册模态框交互，收集清理函数以便关闭时移除
		const modalCleanupFns: (() => void)[] = [];
		modalCleanupFns.push(addWheelZoom(modalZoomContainer, modalContentWrapper, modalState));
		modalCleanupFns.push(addDragPan(modalZoomContainer, modalContentWrapper, modalState));
		modalCleanupFns.push(addTouchGestures(modalZoomContainer, modalContentWrapper, modalState));

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

	private createControls(container: HTMLElement, contentWrapper: HTMLElement, state: ZoomState): () => void {
		const controls = container.createDiv('mermaid-zoom-controls');
		controls.style.cssText = `
			position: absolute;
			top: 10px;
			right: 10px;
			display: flex;
			z-index: 100;
			background: var(--background-secondary);
			padding: 5px;
			border-radius: 5px;
			box-shadow: 0 2px 8px rgba(0,0,0,0.15);
		`;

		// Match the cursor class to the default locked state on first render.
		contentWrapper.classList.toggle('locked', state.locked);

		const fullscreenBtn = controls.createEl('button', {
			cls: 'mermaid-zoom-btn mermaid-fullscreen-btn'
		});

		// Create SVG icon
		const svgNS = 'http://www.w3.org/2000/svg';
		const svg = document.createElementNS(svgNS, 'svg');
		svg.setAttribute('width', '24');
		svg.setAttribute('height', '24');
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
		this.styleButton(fullscreenBtn);
		fullscreenBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			this.openFullscreenModal(state);
		});

		return () => {
			fullscreenBtn.remove();
			controls.remove();
		};
	}

	private styleButton(btn: HTMLButtonElement) {
		btn.addClass('mermaid-zoom-btn');
		btn.style.cssText = `
			width: 28px;
			height: 28px;
			border: none;
			color: var(--text-normal);
			border-radius: 4px;
			cursor: pointer;
			font-size: 16px;
			display: flex;
			align-items: center;
			justify-content: center;
			transition: background 0.2s;
		`;
	}

	onunload() {
		console.debug('Unloading Mermaid Zoom plugin');

		// Disconnect observers
		if (this.mutationObserver) {
			this.mutationObserver.disconnect();
		}
		if (this.resizeObserver) {
			this.resizeObserver.disconnect();
		}

		this.zoomStates.clear();
		this.processedElements = new WeakSet();
	}
}
