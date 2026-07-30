export interface ZoomState {
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
	// Whether this diagram is locked (inline view only; the modal always
	// sets this to false). Default true: when locked, wheel zoom, drag-pan
	// and touch gestures are all disabled so the page scrolls/touches
	// normally through the diagram. Unlock via the lock button to interact.
	locked: boolean;
}

export function updateTransform(contentWrapper: HTMLElement, state: ZoomState) {
	contentWrapper.style.transform = `translate(${state.translateX}px, ${state.translateY}px) scale(${state.scale})`;

	// Update scale indicator
	if (state.scaleIndicator) {
		state.scaleIndicator.textContent = `${Math.round(state.scale * 100)}%`;
	}
}

export function zoom(contentWrapper: HTMLElement, state: ZoomState, factor: number) {
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
	updateTransform(contentWrapper, state);
}

export function addWheelZoom(container: HTMLElement, contentWrapper: HTMLElement, state: ZoomState): () => void {
	const wheelHandler = (e: WheelEvent) => {
		// Locked diagrams don't zoom on wheel. Returning here before
		// preventDefault() lets the page scroll normally when locked.
		if (state.locked) return;

		e.preventDefault();

		const rect = container.getBoundingClientRect();
		const mouseX = e.clientX - rect.left;
		const mouseY = e.clientY - rect.top;

		const delta = e.deltaY > 0 ? 0.9 : 1.1;
		const oldScale = state.scale;
		let newScale = oldScale * delta;
		newScale = Math.max(state.minScale, Math.min(state.maxScale, newScale));

		if (newScale !== oldScale) {
			// 根据鼠标位置调整缩放平移
			const scaleRatio = newScale / oldScale;
			state.translateX = mouseX - (mouseX - state.translateX) * scaleRatio;
			state.translateY = mouseY - (mouseY - state.translateY) * scaleRatio;
			state.scale = newScale;

			updateTransform(contentWrapper, state);
		}
	};
	container.addEventListener('wheel', wheelHandler, { passive: false });

	return () => container.removeEventListener('wheel', wheelHandler);
}

export function addDragPan(container: HTMLElement, contentWrapper: HTMLElement, state: ZoomState): () => void {
	// 设置初始光标状态
	contentWrapper.classList.add('mermaid-zoom-content');

	container.addEventListener('mousedown', (e) => {
		if (state.locked) return; // Locked diagrams can't be drag-panned.
		if (e.button === 0) { // 左键按下
			state.isDragging = true;
			state.startX = e.clientX - state.translateX;
			state.startY = e.clientY - state.translateY;
			contentWrapper.addClass('dragging');
		}
	});

	const onMouseMove = (e: MouseEvent) => {
		if (state.isDragging) {
			e.preventDefault();
			state.translateX = e.clientX - state.startX;
			state.translateY = e.clientY - state.startY;
			updateTransform(contentWrapper, state);
		}
	};

	const onMouseUp = () => {
		if (state.isDragging) {
			state.isDragging = false;
			contentWrapper.removeClass('dragging');
		}
	};

	document.addEventListener('mousemove', onMouseMove);
	document.addEventListener('mouseup', onMouseUp);

	// 返回清理函数，移除 document 级监听器
	return () => {
		document.removeEventListener('mousemove', onMouseMove);
		document.removeEventListener('mouseup', onMouseUp);
	};
}

export function addTouchGestures(container: HTMLElement, contentWrapper: HTMLElement, state: ZoomState): () => void {
	let initialDistance = 0;
	let initialScale = 1;

	const onTouchStart = (e: TouchEvent) => {
		if (state.locked) return; // Locked diagrams ignore touch gestures.
		if (e.touches.length === 2) {
			// 双指缩放
			const touch1 = e.touches[0];
			const touch2 = e.touches[1];
			initialDistance = Math.hypot(
				touch2.clientX - touch1.clientX,
				touch2.clientY - touch1.clientY
			);
			initialScale = state.scale;
		} else if (e.touches.length === 1) {
			// 单指拖拽
			state.isDragging = true;
			state.startX = e.touches[0].clientX - state.translateX;
			state.startY = e.touches[0].clientY - state.translateY;
		}
	};

	const onTouchMove = (e: TouchEvent) => {
		// Locked diagrams don't handle touch; skip before preventDefault() so
		// the page scrolls/zooms normally under the touch.
		if (state.locked) return;

		e.preventDefault();

		if (e.touches.length === 2) {
			// 双指缩放
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
			updateTransform(contentWrapper, state);
		} else if (e.touches.length === 1 && state.isDragging) {
			// 单指拖拽
			state.translateX = e.touches[0].clientX - state.startX;
			state.translateY = e.touches[0].clientY - state.startY;
			updateTransform(contentWrapper, state);
		}
	};

	const onTouchEnd = () => {
		state.isDragging = false;
	};

	container.addEventListener('touchstart', onTouchStart);
	container.addEventListener('touchmove', onTouchMove, { passive: false });
	container.addEventListener('touchend', onTouchEnd);

	return () => {
		container.removeEventListener('touchstart', onTouchStart);
		container.removeEventListener('touchmove', onTouchMove);
		container.removeEventListener('touchend', onTouchEnd);
	};
}

export function addResizeHandles(container: HTMLElement, contentWrapper: HTMLElement, state: ZoomState, reset: () => void): () => void {
	// 光标类型到 CSS 类名的映射
	const cursorClassMap: Record<string, string> = {
		'nwse-resize': 'mermaid-zoom-resizing-nwse',
		'nesw-resize': 'mermaid-zoom-resizing-nesw',
		'ns-resize': 'mermaid-zoom-resizing-ns',
		'ew-resize': 'mermaid-zoom-resizing-ew'
	};

	// 定义调整大小手柄：4个角 + 4条边
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

	// 收集所有 document 级监听器引用，用于统一清理
	const documentListeners: Array<{ type: string; fn: EventListener }> = [];

	// 获取初始边距值
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

		const resizeClass = cursorClassMap[cursor];
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
			document.body.addClass(resizeClass);
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

			// 水平方向调整
			if (position.includes('right')) {
				newWidth = Math.max(150, startWidth + deltaX);
			} else if (position.includes('left')) {
				// 使用负边距向左扩展
				const widthDelta = -deltaX;
				newWidth = Math.max(150, startWidth + widthDelta);
				if (newWidth > 150) {
					newMarginLeft = startMarginLeft + deltaX;
				}
			}

			// 垂直方向调整
			if (position.includes('bottom')) {
				newHeight = Math.max(100, startHeight + deltaY);
			} else if (position.includes('top')) {
				// 使用负边距向上扩展
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
			document.body.removeClass(resizeClass);
			reset();
		};

		handle.addEventListener('mousedown', onMouseDown);
		document.addEventListener('mousemove', onMouseMove);
		document.addEventListener('mouseup', onMouseUp);
		documentListeners.push(
			{ type: 'mousemove', fn: onMouseMove },
			{ type: 'mouseup', fn: onMouseUp }
		);
	});

	// 返回清理函数，批量移除所有 document 级监听器
	return () => {
		for (const { type, fn } of documentListeners) {
			document.removeEventListener(type, fn);
		}
	};
}
