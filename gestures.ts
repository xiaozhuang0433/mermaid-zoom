export interface ZoomState {
	scale: number;
	minScale: number;
	maxScale: number;
	isDragging: boolean;
	startX: number;
	startY: number;
	translateX: number;
	translateY: number;
	// Optional readout showing the current scale as a percentage; updated
	// by updateTransform whenever the transform changes.
	scaleIndicator?: HTMLElement;
	svg: SVGSVGElement;
	container: HTMLElement;
	// Original SVG dimensions (saved once)
	svgOriginalWidth: number;
	svgOriginalHeight: number;
}

export function updateTransform(contentWrapper: HTMLElement, state: ZoomState) {
	contentWrapper.style.transform = `translate(${state.translateX}px, ${state.translateY}px) scale(${state.scale})`;

	// Update scale indicator
	if (state.scaleIndicator) {
		state.scaleIndicator.textContent = `${Math.round(state.scale * 100)}%`;
	}
}

/** Zoom by a multiplicative factor, keeping the container's center fixed. */
export function zoom(contentWrapper: HTMLElement, state: ZoomState, factor: number) {
	let newScale = state.scale * factor;
	newScale = Math.max(state.minScale, Math.min(state.maxScale, newScale));

	// Center the zoom on the middle of the container
	const container = state.container;
	const rect = container.getBoundingClientRect();
	const centerX = rect.width / 2;
	const centerY = rect.height / 2;
	const scaleRatio = newScale / state.scale;

	state.translateX = centerX - (centerX - state.translateX) * scaleRatio;
	state.translateY = centerY - (centerY - state.translateY) * scaleRatio;

	state.scale = newScale;
	updateTransform(contentWrapper, state);
}

export function addWheelZoom(container: HTMLElement, contentWrapper: HTMLElement, state: ZoomState, sensitivity = 1): () => void {
	const wheelHandler = (e: WheelEvent) => {
		e.preventDefault();

		const rect = container.getBoundingClientRect();
		const mouseX = e.clientX - rect.left;
		const mouseY = e.clientY - rect.top;

		// Normalize the delta to pixels: line-mode (deltaMode 1) deltas are
		// line counts, page-mode (2) are page fractions.
		let deltaPx = e.deltaY;
		if (e.deltaMode === 1) deltaPx *= 33;
		else if (e.deltaMode === 2) deltaPx *= 300;

		// Clamp a single event to one notch (~100px) so coarse devices
		// can't skip several zoom steps at once.
		const clamped = Math.max(-100, Math.min(100, deltaPx));

		// Scale the zoom step with the actual scroll amount: a full mouse
		// notch (~100px) zooms ~11% (matching the old fixed step), while
		// the tiny deltas from trackpads and Magic Mouse zoom ~0.5% each,
		// so high-resolution devices no longer feel hair-triggered.
		const factor = Math.exp((-clamped / 100) * 0.12 * sensitivity);
		const oldScale = state.scale;
		let newScale = oldScale * factor;
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
	container.addEventListener('mousedown', (e) => {
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

export function addTouchGestures(container: HTMLElement, contentWrapper: HTMLElement, state: ZoomState, sensitivity = 1): () => void {
	let initialDistance = 0;
	let initialScale = 1;
	let initialTranslateX = 0;
	let initialTranslateY = 0;
	let initialCenterX = 0;
	let initialCenterY = 0;

	const onTouchStart = (e: TouchEvent) => {
		if (e.touches.length === 2) {
			// 双指缩放
			const touch1 = e.touches[0];
			const touch2 = e.touches[1];
			initialDistance = Math.hypot(
				touch2.clientX - touch1.clientX,
				touch2.clientY - touch1.clientY
			);
			initialScale = state.scale;
			initialTranslateX = state.translateX;
			initialTranslateY = state.translateY;

			const rect = container.getBoundingClientRect();
			initialCenterX = (touch1.clientX + touch2.clientX) / 2 - rect.left;
			initialCenterY = (touch1.clientY + touch2.clientY) / 2 - rect.top;
			state.isDragging = false;
		} else if (e.touches.length === 1) {
			// 单指拖拽
			state.isDragging = true;
			state.startX = e.touches[0].clientX - state.translateX;
			state.startY = e.touches[0].clientY - state.translateY;
		}
	};

	const onTouchMove = (e: TouchEvent) => {
		e.preventDefault();

		if (e.touches.length === 2) {
			if (initialDistance === 0) return;

			// 双指缩放
			const touch1 = e.touches[0];
			const touch2 = e.touches[1];
			const currentDistance = Math.hypot(
				touch2.clientX - touch1.clientX,
				touch2.clientY - touch1.clientY
			);

			const scaleRatio = currentDistance / initialDistance;
			// Sensitivity acts as an exponent on the finger-distance ratio:
			// < 1 softens the pinch response, > 1 amplifies it.
			let newScale = initialScale * Math.pow(scaleRatio, sensitivity);
			newScale = Math.max(state.minScale, Math.min(state.maxScale, newScale));

			const rect = container.getBoundingClientRect();
			const currentCenterX = (touch1.clientX + touch2.clientX) / 2 - rect.left;
			const currentCenterY = (touch1.clientY + touch2.clientY) / 2 - rect.top;
			const appliedScaleRatio = newScale / initialScale;

			state.translateX = currentCenterX - (initialCenterX - initialTranslateX) * appliedScaleRatio;
			state.translateY = currentCenterY - (initialCenterY - initialTranslateY) * appliedScaleRatio;
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
	container.addEventListener('touchcancel', onTouchEnd);

	return () => {
		container.removeEventListener('touchstart', onTouchStart);
		container.removeEventListener('touchmove', onTouchMove);
		container.removeEventListener('touchend', onTouchEnd);
		container.removeEventListener('touchcancel', onTouchEnd);
	};
}

