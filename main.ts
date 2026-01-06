import { Plugin } from 'obsidian';

interface ZoomState {
	scale: number;
	minScale: number;
	maxScale: number;
	isDragging: boolean;
	startX: number;
	startY: number;
	translateX: number;
	translateY: number;
	scaleIndicator?: HTMLElement;
	svg: SVGSVGElement;
	container: HTMLElement;
	// Original SVG dimensions (saved once)
	svgOriginalWidth: number;
	svgOriginalHeight: number;
}

export default class MermaidZoomPlugin extends Plugin {
	private readonly zoomStates = new Map<HTMLElement, ZoomState>();
	private readonly defaultMinScale = 0.1;
	private readonly defaultMaxScale = 5;
	private readonly defaultScale = 1;
	private mutationObserver?: MutationObserver;
	private processedElements = new WeakSet<SVGSVGElement>();

	onload() {
		console.debug('Loading Mermaid Zoom plugin');

		// Set up MutationObserver to watch for new mermaid diagrams
		this.setupMutationObserver();

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
			setTimeout(() => this.processAllMermaidDiagrams(), 200);
		}));
	}

	private setupMutationObserver() {
		this.mutationObserver = new MutationObserver((mutations) => {
			for (const mutation of Array.from(mutations)) {
				for (const node of Array.from(mutation.addedNodes)) {
					if (node instanceof HTMLElement || node instanceof SVGElement) {
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

		if (element instanceof HTMLElement) {
			// Find SVGs inside .mermaid containers or SVGs with mermaid id
			const svgs = Array.from(element.querySelectorAll('.mermaid svg, svg[id^="mermaid-"]'));
			mermaidSvgs.push(...svgs as SVGSVGElement[]);

			// Also check if element itself is a mermaid container
			if (element.classList.contains('mermaid')) {
				const svg = element.querySelector('svg');
				if (svg) mermaidSvgs.push(svg as SVGSVGElement);
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

		// Get SVG dimensions for initial container sizing
		const initialSvgRect = svg.getBoundingClientRect();
		const initialSvgWidth = initialSvgRect.width || 300;
		const initialSvgHeight = initialSvgRect.height || 200;

		// Calculate initial container size - max height equals width (square)
		const containerWidth = Math.min(initialSvgWidth + 32, targetParent.clientWidth || 600);
		const containerHeight = Math.min(initialSvgHeight + 60, containerWidth); // height <= width

		// Create zoom container
		const container = createDiv('mermaid-zoom-container');
		container.style.cssText = `
			position: relative;
			overflow: hidden;
			width: ${containerWidth}px;
			height: ${containerHeight}px;
			min-width: 150px;
			min-height: 100px;
			background: var(--background-secondary);
			border-radius: 8px;
			border: 1px solid var(--background-modifier-border);
			margin: 1em 0;
			padding: 1em;
			padding-bottom: 2.5em;
			box-sizing: border-box;
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

		// Get SVG original dimensions before any scaling
		const svgRect = svg.getBoundingClientRect();
		const svgOriginalWidth = svgRect.width || svg.clientWidth || 300;
		const svgOriginalHeight = svgRect.height || svg.clientHeight || 200;

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
			svgOriginalHeight: svgOriginalHeight
		};
		this.zoomStates.set(contentWrapper, state);

		// Create controls (includes resize handle)
		this.createControls(container, contentWrapper, state);

		// Add mouse wheel zoom
		this.addWheelZoom(container, contentWrapper, state);

		// Add drag to pan
		this.addDragPan(container, contentWrapper, state);

		// Add touch gesture support
		this.addTouchGestures(container, contentWrapper, state);

		// Fit SVG to container initially
		this.fitToContainer(container, contentWrapper, svg, state);
	}

	private fitToContainer(container: HTMLElement, contentWrapper: HTMLElement, svg: SVGSVGElement, state: ZoomState) {
		// Get available space (account for padding)
		const containerPadding = 16; // 1em padding
		const bottomPadding = 40; // extra padding for controls
		const availableWidth = container.clientWidth - containerPadding * 2;
		const availableHeight = container.clientHeight - containerPadding - bottomPadding;

		// Use saved original SVG dimensions
		const svgWidth = state.svgOriginalWidth;
		const svgHeight = state.svgOriginalHeight;

		// Calculate scale to fit
		const scaleX = availableWidth / svgWidth;
		const scaleY = availableHeight / svgHeight;
		const fitScale = Math.min(scaleX, scaleY, 1); // Don't scale up beyond 100%

		// Apply the scale
		state.scale = fitScale;
		state.translateX = 0;
		state.translateY = 0;
		this.updateTransform(contentWrapper, state);
	}

	private openFullscreenModal(state: ZoomState) {
		// Create modal overlay
		const modal = document.createElement('div');
		modal.className = 'mermaid-zoom-modal';
		modal.style.cssText = `
			position: fixed;
			top: 0;
			left: 0;
			width: 100vw;
			height: 100vh;
			background: var(--background-primary);
			z-index: 9999;
			display: flex;
			flex-direction: column;
		`;

		// Create header with close button
		const header = document.createElement('div');
		header.className = 'mermaid-zoom-modal-header';
		header.style.cssText = `
			display: flex;
			justify-content: flex-end;
			padding: 10px 15px;
			background: var(--background-secondary);
			border-bottom: 1px solid var(--background-modifier-border);
		`;

		// Close button
		const closeBtn = document.createElement('button');
		closeBtn.className = 'mermaid-zoom-modal-close';
		closeBtn.textContent = '✕';
		closeBtn.style.cssText = `
			width: 32px;
			height: 32px;
			border: none;
			background: var(--interactive-normal);
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
		const content = document.createElement('div');
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
		const modalZoomContainer = document.createElement('div');
		modalZoomContainer.className = 'mermaid-zoom-modal-zoom-container';
		modalZoomContainer.style.cssText = `
			width: 100%;
			height: 100%;
			overflow: hidden;
			position: relative;
		`;

		// Create content wrapper for transformations
		const modalContentWrapper = document.createElement('div');
		modalContentWrapper.className = 'mermaid-zoom-modal-wrapper';
		modalContentWrapper.style.cssText = `
			transform-origin: 0 0;
			transition: transform 0.1s ease-out;
			width: fit-content;
			position: absolute;
		`;

		// Clone the SVG
		const svgClone = state.svg.cloneNode(true) as SVGSVGElement;
		svgClone.style.display = 'block';
		modalContentWrapper.appendChild(svgClone);
		modalZoomContainer.appendChild(modalContentWrapper);
		content.appendChild(modalZoomContainer);

		// Create modal controls
		const controls = document.createElement('div');
		controls.className = 'mermaid-zoom-modal-controls';
		controls.style.cssText = `
			position: absolute;
			bottom: 20px;
			right: 20px;
			display: flex;
			gap: 5px;
			background: var(--background-secondary);
			padding: 8px;
			border-radius: 8px;
			box-shadow: 0 4px 12px rgba(0,0,0,0.2);
		`;

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
			svgOriginalHeight: state.svgOriginalHeight
		};

		// Add zoom buttons
		const zoomInBtn = document.createElement('button');
		zoomInBtn.textContent = '+';
		this.styleButton(zoomInBtn);
		zoomInBtn.addEventListener('click', () => this.zoom(modalContentWrapper, modalState, 1.2));

		const zoomOutBtn = document.createElement('button');
		zoomOutBtn.textContent = '-';
		this.styleButton(zoomOutBtn);
		zoomOutBtn.addEventListener('click', () => this.zoom(modalContentWrapper, modalState, 0.8));

		const resetBtn = document.createElement('button');
		resetBtn.textContent = '⟲';
		this.styleButton(resetBtn);
		resetBtn.addEventListener('click', () => {
			this.fitToContainerModal(modalZoomContainer, modalContentWrapper, modalState);
		});

		// Scale indicator
		const scaleIndicator = document.createElement('span');
		scaleIndicator.style.cssText = `
			padding: 4px 8px;
			font-size: 12px;
			font-family: var(--font-ui-medium);
			color: var(--text-muted);
			min-width: 45px;
			text-align: center;
		`;
		modalState.scaleIndicator = scaleIndicator;

		controls.appendChild(zoomInBtn);
		controls.appendChild(zoomOutBtn);
		controls.appendChild(resetBtn);
		controls.appendChild(scaleIndicator);
		content.appendChild(controls);

		modal.appendChild(header);
		modal.appendChild(content);

		// Close modal function
		const closeModal = () => {
			modal.remove();
			document.removeEventListener('keydown', handleKeydown);
		};

		// Handle ESC key
		const handleKeydown = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				closeModal();
			}
		};
		document.addEventListener('keydown', handleKeydown);

		// Close button click
		closeBtn.addEventListener('click', closeModal);

		// Add modal to document
		document.body.appendChild(modal);

		// Add zoom/pan interactions to modal
		this.addWheelZoom(modalZoomContainer, modalContentWrapper, modalState);
		this.addDragPan(modalZoomContainer, modalContentWrapper, modalState);
		this.addTouchGestures(modalZoomContainer, modalContentWrapper, modalState);

		// Fit to container after modal is visible
		requestAnimationFrame(() => {
			this.fitToContainerModal(modalZoomContainer, modalContentWrapper, modalState);
		});
	}

	private fitToContainerModal(container: HTMLElement, contentWrapper: HTMLElement, state: ZoomState) {
		// Get available space
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
		this.updateTransform(contentWrapper, state);
	}

	private createControls(container: HTMLElement, contentWrapper: HTMLElement, state: ZoomState) {
		const controls = container.createDiv('mermaid-zoom-controls');
		controls.style.cssText = `
			position: absolute;
			bottom: 10px;
			right: 10px;
			display: flex;
			gap: 5px;
			z-index: 100;
			background: var(--background-secondary);
			padding: 5px;
			border-radius: 5px;
			box-shadow: 0 2px 8px rgba(0,0,0,0.15);
		`;

		// Zoom in button
		const zoomInBtn = controls.createEl('button', {
			text: '+',
			cls: 'mermaid-zoom-btn'
		});
		this.styleButton(zoomInBtn);
		zoomInBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			this.zoom(contentWrapper, state, 1.2);
		});

		// Zoom out button
		const zoomOutBtn = controls.createEl('button', {
			text: '-',
			cls: 'mermaid-zoom-btn'
		});
		this.styleButton(zoomOutBtn);
		zoomOutBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			this.zoom(contentWrapper, state, 0.8);
		});

		// Reset button
		const resetBtn = controls.createEl('button', {
			text: '⟲',
			cls: 'mermaid-zoom-btn'
		});
		this.styleButton(resetBtn);
		resetBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			this.resetZoom(contentWrapper, state);
		});

		// Scale indicator
		const scaleIndicator = controls.createEl('span', {
			cls: 'mermaid-zoom-scale'
		});
		scaleIndicator.style.cssText = `
			padding: 4px 8px;
			font-size: 12px;
			font-family: var(--font-ui-medium);
			color: var(--text-muted);
			min-width: 45px;
			text-align: center;
		`;
		state.scaleIndicator = scaleIndicator;
		this.updateTransform(contentWrapper, state);

		// Fullscreen toggle button
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

		// Add resize handles to container (4 corners + 4 edges)
		this.addResizeHandles(container, contentWrapper, state);
	}

	private styleButton(btn: HTMLButtonElement) {
		btn.style.cssText = `
			width: 28px;
			height: 28px;
			border: none;
			background: var(--interactive-normal);
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

	private addResizeHandles(container: HTMLElement, contentWrapper: HTMLElement, state: ZoomState) {
		// Define resize handles: 4 corners + 4 edges
		const handles = [
			{ position: 'top-left', cursor: 'nwse-resize', style: 'top: 0; left: 0; width: 12px; height: 12px;' },
			{ position: 'top-right', cursor: 'nesw-resize', style: 'top: 0; right: 0; width: 12px; height: 12px;' },
			{ position: 'bottom-left', cursor: 'nesw-resize', style: 'bottom: 0; left: 0; width: 12px; height: 12px;' },
			{ position: 'bottom-right', cursor: 'nwse-resize', style: 'bottom: 0; right: 0; width: 12px; height: 12px;' },
			{ position: 'top', cursor: 'ns-resize', style: 'top: 0; left: 12px; right: 12px; height: 6px;' },
			{ position: 'bottom', cursor: 'ns-resize', style: 'bottom: 0; left: 12px; right: 12px; height: 6px;' },
			{ position: 'left', cursor: 'ew-resize', style: 'top: 12px; bottom: 12px; left: 0; width: 6px;' },
			{ position: 'right', cursor: 'ew-resize', style: 'top: 12px; bottom: 12px; right: 0; width: 6px;' },
		];

		// Get initial margin values
		let currentMarginLeft = 0;
		let currentMarginTop = 0;

		handles.forEach(({ position, cursor, style }) => {
			const handle = container.createDiv(`mermaid-resize-${position}`);
			handle.style.cssText = `
				position: absolute;
				${style}
				cursor: ${cursor};
				z-index: 50;
			`;

			let isResizing = false;
			let startX = 0;
			let startY = 0;
			let startWidth = 0;
			let startHeight = 0;
			let startMarginLeft = 0;
			let startMarginTop = 0;

			const onMouseDown = (e: MouseEvent) => {
				e.preventDefault();
				e.stopPropagation();
				isResizing = true;
				startX = e.clientX;
				startY = e.clientY;
				startWidth = container.offsetWidth;
				startHeight = container.offsetHeight;
				startMarginLeft = currentMarginLeft;
				startMarginTop = currentMarginTop;
				document.body.style.cursor = cursor;
				document.body.addClass('mermaid-zoom-resizing');
			};

			const onMouseMove = (e: MouseEvent) => {
				if (!isResizing) return;
				e.preventDefault();

				const deltaX = e.clientX - startX;
				const deltaY = e.clientY - startY;

				let newWidth = startWidth;
				let newHeight = startHeight;
				let newMarginLeft = startMarginLeft;
				let newMarginTop = startMarginTop;

				// Handle horizontal resize
				if (position.includes('right')) {
					newWidth = Math.max(150, startWidth + deltaX);
				} else if (position.includes('left')) {
					// Expand to the left using negative margin
					const widthDelta = -deltaX;
					newWidth = Math.max(150, startWidth + widthDelta);
					if (newWidth > 150) {
						newMarginLeft = startMarginLeft + deltaX;
					}
				}

				// Handle vertical resize
				if (position.includes('bottom')) {
					newHeight = Math.max(100, startHeight + deltaY);
				} else if (position.includes('top')) {
					// Expand upward using negative margin
					const heightDelta = -deltaY;
					newHeight = Math.max(100, startHeight + heightDelta);
					if (newHeight > 100) {
						newMarginTop = startMarginTop + deltaY;
					}
				}

				container.style.width = `${newWidth}px`;
				container.style.height = `${newHeight}px`;
				container.style.marginLeft = `${newMarginLeft}px`;
				container.style.marginTop = `${newMarginTop}px`;
				currentMarginLeft = newMarginLeft;
				currentMarginTop = newMarginTop;
			};

			const onMouseUp = () => {
				if (!isResizing) return;
				isResizing = false;
				document.body.style.cursor = '';
				document.body.removeClass('mermaid-zoom-resizing');
				this.resetZoom(contentWrapper, state);
			};

			handle.addEventListener('mousedown', onMouseDown);
			document.addEventListener('mousemove', onMouseMove);
			document.addEventListener('mouseup', onMouseUp);
		});
	}

	private addWheelZoom(container: HTMLElement, contentWrapper: HTMLElement, state: ZoomState) {
		container.addEventListener('wheel', (e) => {
			e.preventDefault();

			const rect = container.getBoundingClientRect();
			const mouseX = e.clientX - rect.left;
			const mouseY = e.clientY - rect.top;

			const delta = e.deltaY > 0 ? 0.9 : 1.1;
			const oldScale = state.scale;
			let newScale = oldScale * delta;
			newScale = Math.max(state.minScale, Math.min(state.maxScale, newScale));

			if (newScale !== oldScale) {
				// Adjust translation to zoom toward mouse position
				const scaleRatio = newScale / oldScale;
				state.translateX = mouseX - (mouseX - state.translateX) * scaleRatio;
				state.translateY = mouseY - (mouseY - state.translateY) * scaleRatio;
				state.scale = newScale;

				this.updateTransform(contentWrapper, state);
			}
		}, { passive: false });
	}

	private addDragPan(container: HTMLElement, contentWrapper: HTMLElement, state: ZoomState) {
		container.addEventListener('mousedown', (e) => {
			if (e.button === 0) { // Left mouse button
				state.isDragging = true;
				state.startX = e.clientX - state.translateX;
				state.startY = e.clientY - state.translateY;
				container.style.cursor = 'grabbing';
			}
		});

		document.addEventListener('mousemove', (e) => {
			if (state.isDragging) {
				e.preventDefault();
				state.translateX = e.clientX - state.startX;
				state.translateY = e.clientY - state.startY;
				this.updateTransform(contentWrapper, state);
			}
		});

		document.addEventListener('mouseup', () => {
			if (state.isDragging) {
				state.isDragging = false;
				container.style.cursor = 'grab';
			}
		});

		container.style.cursor = 'grab';
	}

	private addTouchGestures(container: HTMLElement, contentWrapper: HTMLElement, state: ZoomState) {
		let initialDistance = 0;
		let initialScale = 1;

		container.addEventListener('touchstart', (e) => {
			if (e.touches.length === 2) {
				// Pinch to zoom
				const touch1 = e.touches[0];
				const touch2 = e.touches[1];
				initialDistance = Math.hypot(
					touch2.clientX - touch1.clientX,
					touch2.clientY - touch1.clientY
				);
				initialScale = state.scale;
			} else if (e.touches.length === 1) {
				// Single touch drag
				state.isDragging = true;
				state.startX = e.touches[0].clientX - state.translateX;
				state.startY = e.touches[0].clientY - state.translateY;
			}
		});

		container.addEventListener('touchmove', (e) => {
			e.preventDefault();

			if (e.touches.length === 2) {
				// Pinch to zoom
				const touch1 = e.touches[0];
				const touch2 = e.touches[1];
				const currentDistance = Math.hypot(
					touch2.clientX - touch1.clientX,
					touch2.clientY - touch1.clientY
				);

				const scaleRatio = currentDistance / initialDistance;
				let newScale = initialScale * scaleRatio;
				newScale = Math.max(state.minScale, Math.min(state.maxScale, newScale));

				state.scale = newScale;
				this.updateTransform(contentWrapper, state);
			} else if (e.touches.length === 1 && state.isDragging) {
				// Single touch drag
				state.translateX = e.touches[0].clientX - state.startX;
				state.translateY = e.touches[0].clientY - state.startY;
				this.updateTransform(contentWrapper, state);
			}
		}, { passive: false });

		container.addEventListener('touchend', () => {
			state.isDragging = false;
		});
	}

	private zoom(contentWrapper: HTMLElement, state: ZoomState, factor: number) {
		let newScale = state.scale * factor;
		newScale = Math.max(state.minScale, Math.min(state.maxScale, newScale));

		// Center the zoom
		const container = contentWrapper.parentElement;
		if (container) {
			const rect = container.getBoundingClientRect();
			const centerX = rect.width / 2;
			const centerY = rect.height / 2;
			const scaleRatio = newScale / state.scale;

			state.translateX = centerX - (centerX - state.translateX) * scaleRatio;
			state.translateY = centerY - (centerY - state.translateY) * scaleRatio;
		}

		state.scale = newScale;
		this.updateTransform(contentWrapper, state);
	}

	private resetZoom(contentWrapper: HTMLElement, state: ZoomState) {
		// Fit to container instead of just resetting to 100%
		this.fitToContainer(state.container, contentWrapper, state.svg, state);
	}

	private updateTransform(contentWrapper: HTMLElement, state: ZoomState) {
		contentWrapper.style.transform = `translate(${state.translateX}px, ${state.translateY}px) scale(${state.scale})`;

		// Update scale indicator
		if (state.scaleIndicator) {
			state.scaleIndicator.textContent = `${Math.round(state.scale * 100)}%`;
		}
	}

	onunload() {
		console.debug('Unloading Mermaid Zoom plugin');

		// Disconnect mutation observer
		if (this.mutationObserver) {
			this.mutationObserver.disconnect();
		}

		this.zoomStates.clear();
		this.processedElements = new WeakSet();
	}
}
