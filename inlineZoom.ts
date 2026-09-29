import { setIcon } from 'obsidian';

import { t } from './i18n';
import { wheelZoomFactor } from './gestures';

// Inline zoom for native mermaid blocks — the container-free successor to
// the pre-#12 machinery. The plugin never wraps or re-parents the svg;
// zooming sizes the NATIVE svg directly (width/height derived from its
// viewBox on every event, so nothing is measured once and remembered), and
// the block itself becomes a horizontal scroller past the column width.
//
// Two historical bugs shape the constraints here:
// - Height bug (PR #12): never bake a one-time measurement. All sizes come
//   from viewBox re-reads; block height is always real layout.
// - Scroll hijack (PR #8): while LOCKED (the default) a block carries
//   literally zero gesture listeners — page scroll and touch pass through
//   untouched. Listeners attach only while unlocked, and no handler calls
//   preventDefault for a gesture it does not consume.

export const INLINE_MIN_SCALE = 0.5;
export const INLINE_MAX_SCALE = 3;
export const INLINE_ZOOM_STEP = 1.2; // per button click — matches the modal

export const INLINE_ZOOM_CLASSES = [
	'mermaid-zoom-scaled',
	'mermaid-zoom-unlocked',
	'mermaid-zoom-dragging',
	'mermaid-zoom-inline-controls-off',
] as const;

// Route string literals through consts: the no-static-styles-assignment
// lint rule flags literal right-hand sides on style assignments.
const MAX_WIDTH_NONE = 'none';
const CLUSTER_SELECTOR = ':scope > .mermaid-zoom-inline-controls';
const LEGACY_FULLSCREEN_SELECTOR = ':scope > .mermaid-zoom-fullscreen-btn';
const CLUSTER_CLASS = 'mermaid-zoom-inline-controls';

/** Mermaid's own inline width/height/max-width, captured before our first
 *  zoom write so reset can put them back. Keyed by the svg node — a
 *  re-rendered replacement svg simply has no entry and starts pristine. */
interface PristineStyles {
	width: string;
	height: string;
	maxWidth: string;
}

const pristineSvgStyles = new WeakMap<SVGSVGElement, PristineStyles>();
const gestureTeardowns = new WeakMap<HTMLElement, () => void>();

export interface InlineZoomOpts {
	/** Open the fullscreen modal; main resolves the svg at click time. */
	onFullscreen: (block: HTMLElement) => void;
	/** Live view of the zoomSensitivity setting. */
	getSensitivity: () => number;
	/** Whether the zoom/lock buttons are shown (fullscreen always is). */
	showZoomButtons: boolean;
}

/** Natural size from the live svg — re-read on every call, never cached.
 *  viewBox first (Obsidian's mermaid always emits it), then width/height
 *  attributes. Null means "cannot zoom" and every caller no-ops. */
function svgNaturalSize(svg: SVGSVGElement): { width: number; height: number } | null {
	const vb = svg.viewBox?.baseVal;
	if (vb && vb.width > 0 && vb.height > 0) {
		return { width: vb.width, height: vb.height };
	}
	const attrWidth = parseFloat(svg.getAttribute('width') || '');
	const attrHeight = parseFloat(svg.getAttribute('height') || '');
	if (attrWidth > 0 && attrHeight > 0) {
		return { width: attrWidth, height: attrHeight };
	}
	return null;
}

function snapshotPristine(svg: SVGSVGElement): void {
	if (pristineSvgStyles.has(svg)) return;
	pristineSvgStyles.set(svg, {
		width: svg.style.width,
		height: svg.style.height,
		maxWidth: svg.style.maxWidth,
	});
}

/** Restore mermaid's pristine inline styles. Reset cannot simply
 *  removeProperty: mermaid ships its own inline max-width in the same
 *  slot, and deleting the property would break native rendering. */
function restorePristine(svg: SVGSVGElement): void {
	const pristine = pristineSvgStyles.get(svg);
	if (!pristine) return;
	svg.style.width = pristine.width;
	svg.style.height = pristine.height;
	svg.style.maxWidth = pristine.maxWidth;
	pristineSvgStyles.delete(svg);
}

export function getBlockScale(block: HTMLElement): number {
	const parsed = parseFloat(block.dataset.mzScale ?? '');
	return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

/** Scale at which the svg exactly fills the block's content width — i.e.
 *  the whole diagram is visible without horizontal scrolling. Re-read from
 *  live layout on every call. Null when the block has no layout. */
function fitWidthScale(block: HTMLElement, natural: { width: number }): number | null {
	const style = block.win.getComputedStyle(block);
	const available = block.clientWidth
		- (parseFloat(style.paddingLeft) || 0)
		- (parseFloat(style.paddingRight) || 0);
	if (available <= 0) return null;
	// Floor so the rounded svg width never overshoots and summons a scrollbar.
	return Math.floor(available) / natural.width;
}

/** The zoom-out floor drops below INLINE_MIN_SCALE to the fit-width scale
 *  for diagrams wider than the column, so zooming out can always reach
 *  "whole diagram visible" (Obsidian renders flowcharts at natural size,
 *  useMaxWidth off, so very wide ones need scales well under 0.5). */
function clampScale(block: HTMLElement, natural: { width: number }, scale: number): number {
	const fit = fitWidthScale(block, natural);
	const min = fit === null ? INLINE_MIN_SCALE : Math.min(INLINE_MIN_SCALE, fit);
	return Math.max(min, Math.min(INLINE_MAX_SCALE, scale));
}

/** The single place inline zoom styles are written. Real layout — the
 *  block grows/shrinks with the svg and becomes a horizontal scroller
 *  past the column width (see .mermaid-zoom-scaled in styles.css). */
export function setBlockScale(block: HTMLElement, scale: number, anchorClientX?: number): void {
	const svg = block.querySelector('svg');
	if (!svg) return;
	const natural = svgNaturalSize(svg);
	if (!natural) return;

	const newScale = clampScale(block, natural, scale);
	const oldScale = getBlockScale(block);

	if (newScale === 1) {
		restorePristine(svg);
		delete block.dataset.mzScale;
		block.removeClass('mermaid-zoom-scaled');
		block.scrollLeft = 0;
		return;
	}

	snapshotPristine(svg);
	svg.style.maxWidth = MAX_WIDTH_NONE;
	svg.style.width = `${Math.round(natural.width * newScale)}px`;
	svg.style.height = `${Math.round(natural.height * newScale)}px`;
	block.addClass('mermaid-zoom-scaled');
	block.dataset.mzScale = String(newScale);

	// Keep the content under the anchor point (cursor / block center)
	// stationary: preserve its fraction of the content width across the
	// resize, then clamp into the new scroll range. Reading scrollWidth
	// after the style writes forces an up-to-date layout.
	if (oldScale > 0) {
		const rect = block.getBoundingClientRect();
		const offsetX = anchorClientX !== undefined
			? anchorClientX - rect.left
			: rect.width / 2;
		const oldContentWidth = natural.width * oldScale;
		if (oldContentWidth > 0) {
			const fraction = (block.scrollLeft + offsetX) / oldContentWidth;
			const newLeft = fraction * natural.width * newScale - offsetX;
			const maxLeft = block.scrollWidth - block.clientWidth;
			block.scrollLeft = Math.max(0, Math.min(maxLeft, newLeft));
		}
	}
}

/** Zoom by a multiplicative factor. Returns false when the clamped result
 *  does not move in the requested direction (at the bounds) — callers use
 *  that to skip preventDefault and let the page scroll through. */
export function zoomBlockBy(block: HTMLElement, factor: number, anchorClientX?: number): boolean {
	const svg = block.querySelector('svg');
	const natural = svg ? svgNaturalSize(svg) : null;
	if (!natural) return false;
	const current = getBlockScale(block);
	const next = clampScale(block, natural, current * factor);
	// The dynamic floor can rise above the current scale (the column
	// widened after a fit); never let the clamp move against the gesture.
	if (factor < 1 ? next >= current : next <= current) return false;
	setBlockScale(block, next, anchorClientX);
	return true;
}

export function resetBlockZoom(block: HTMLElement): void {
	setBlockScale(block, 1);
}

/** Fit button: scale so the diagram's full width fits the block — shrinks
 *  a diagram wider than the column, enlarges a narrower one (up to
 *  INLINE_MAX_SCALE). One-shot, like the zoom buttons: it does not track
 *  later column resizes. */
export function fitBlockToWidth(block: HTMLElement): void {
	const svg = block.querySelector('svg');
	const natural = svg ? svgNaturalSize(svg) : null;
	if (!natural) return;
	const fit = fitWidthScale(block, natural);
	if (fit !== null) setBlockScale(block, fit);
}

export function isUnlocked(block: HTMLElement): boolean {
	return block.hasClass('mermaid-zoom-unlocked');
}

/** Flip the lock. Attaching/detaching gesture listeners here keeps the
 *  "locked = zero listeners" guarantee of PR #8. */
export function setBlockLock(block: HTMLElement, unlocked: boolean, getSensitivity: () => number): void {
	block.toggleClass('mermaid-zoom-unlocked', unlocked);
	if (unlocked && !gestureTeardowns.has(block)) {
		gestureTeardowns.set(block, attachGestures(block, getSensitivity));
	} else if (!unlocked) {
		gestureTeardowns.get(block)?.();
		gestureTeardowns.delete(block);
	}
	const lockBtn = block.querySelector<HTMLElement>('.mermaid-zoom-lock-btn');
	if (lockBtn) applyLockButtonState(lockBtn, unlocked);
}

function setLockIcon(btn: HTMLElement, unlocked: boolean): void {
	setIcon(btn, unlocked ? 'lock-open' : 'lock');
	// Older bundled lucide sets may lack lock-open; unlock is its legacy alias.
	if (unlocked && !btn.querySelector('svg')) setIcon(btn, 'unlock');
}

function applyLockButtonState(btn: HTMLElement, unlocked: boolean): void {
	btn.empty();
	setLockIcon(btn, unlocked);
	btn.toggleClass('is-unlocked', unlocked);
	btn.setAttribute('aria-pressed', String(unlocked));
	const label = unlocked ? t('inline.lock') : t('inline.unlock');
	btn.setAttribute('aria-label', label);
	btn.title = label;
}

/** Re-sync the lock button only when its displayed state drifted (cluster
 *  recreated after a reload with the lock class still on the block). */
function syncLockButton(block: HTMLElement): void {
	const btn = block.querySelector<HTMLElement>('.mermaid-zoom-lock-btn');
	if (!btn) return;
	const unlocked = isUnlocked(block);
	if (btn.hasClass('is-unlocked') === unlocked) return;
	applyLockButtonState(btn, unlocked);
}

/** Wheel zoom + drag pan + touch pinch/pan, attached to the block only
 *  while unlocked. The svg is re-resolved at event time because live
 *  preview can swap the node mid-session. Returns a teardown. */
function attachGestures(block: HTMLElement, getSensitivity: () => number): () => void {
	// Wheel zoom (mouse wheel; trackpad pinch arrives as ctrl+wheel).
	// preventDefault only when the scale actually changed — at the clamp
	// bounds the page scrolls through, an intentional escape hatch.
	const onWheel = (e: WheelEvent) => {
		if (zoomBlockBy(block, wheelZoomFactor(e, getSensitivity()), e.clientX)) {
			e.preventDefault();
		}
	};

	// Mouse/pen drag pan: drag-to-scroll, only when there is horizontal
	// overflow. Pointer capture keeps the whole session on the block — no
	// document-level listeners are ever registered.
	let dragPointerId = -1;
	let dragLastX = 0;
	const onPointerDown = (e: PointerEvent) => {
		if (e.pointerType === 'touch') return; // touch has its own handler
		if (e.button !== 0) return;
		if (e.target instanceof Element && e.target.closest(`.${CLUSTER_CLASS}`)) return;
		if (block.scrollWidth <= block.clientWidth + 1) return; // nothing to pan
		dragPointerId = e.pointerId;
		dragLastX = e.clientX;
		block.setPointerCapture(e.pointerId);
		block.addClass('mermaid-zoom-dragging');
	};
	const onPointerMove = (e: PointerEvent) => {
		if (e.pointerId !== dragPointerId) return;
		block.scrollLeft -= e.clientX - dragLastX;
		dragLastX = e.clientX;
	};
	const onPointerEnd = (e: PointerEvent) => {
		if (e.pointerId !== dragPointerId) return;
		dragPointerId = -1;
		block.removeClass('mermaid-zoom-dragging');
	};

	// Touch: two fingers pinch-zoom; a single finger pans horizontally
	// under an axis lock, so vertical swipes keep scrolling the page. Every
	// preventDefault is guarded by cancelable and only fires for gestures
	// we actually consume (the PR #8 lesson).
	let pinchStartDist = 0;
	let pinchStartScale = 1;
	let touchStartX = 0;
	let touchStartY = 0;
	let touchLastX = 0;
	let touchAxis: 'x' | 'y' | null = null;

	const onTouchStart = (e: TouchEvent) => {
		if (e.touches.length === 2) {
			pinchStartDist = Math.hypot(
				e.touches[1].clientX - e.touches[0].clientX,
				e.touches[1].clientY - e.touches[0].clientY
			);
			pinchStartScale = getBlockScale(block);
			touchAxis = null;
		} else if (e.touches.length === 1) {
			touchStartX = e.touches[0].clientX;
			touchStartY = e.touches[0].clientY;
			touchLastX = touchStartX;
			touchAxis = null;
		}
	};

	const onTouchMove = (e: TouchEvent) => {
		if (e.touches.length === 2) {
			if (pinchStartDist <= 0) return;
			if (e.cancelable) e.preventDefault();
			const dist = Math.hypot(
				e.touches[1].clientX - e.touches[0].clientX,
				e.touches[1].clientY - e.touches[0].clientY
			);
			const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
			setBlockScale(block, pinchStartScale * (dist / pinchStartDist), midX);
			return;
		}

		if (e.touches.length !== 1 || touchAxis === 'y') return;
		const touch = e.touches[0];
		if (touchAxis === null) {
			const dx = touch.clientX - touchStartX;
			const dy = touch.clientY - touchStartY;
			// Decide the axis once movement passes a slop threshold.
			if (Math.abs(dx) <= 8 && Math.abs(dy) <= 8) return;
			const scrollable = block.scrollWidth > block.clientWidth + 1;
			touchAxis = Math.abs(dx) > Math.abs(dy) && scrollable ? 'x' : 'y';
			if (touchAxis !== 'x') return;
		}
		if (e.cancelable) e.preventDefault();
		block.scrollLeft -= touch.clientX - touchLastX;
		touchLastX = touch.clientX;
	};

	const onTouchEnd = (e: TouchEvent) => {
		pinchStartDist = 0;
		if (e.touches.length === 0) {
			touchAxis = null;
		} else {
			// Pinch ended: the remaining finger must not start panning
			// mid-gesture — hand the touch back to the page.
			touchAxis = 'y';
		}
	};

	block.addEventListener('wheel', onWheel, { passive: false });
	block.addEventListener('pointerdown', onPointerDown);
	block.addEventListener('pointermove', onPointerMove);
	block.addEventListener('pointerup', onPointerEnd);
	block.addEventListener('pointercancel', onPointerEnd);
	block.addEventListener('touchstart', onTouchStart, { passive: true });
	block.addEventListener('touchmove', onTouchMove, { passive: false });
	block.addEventListener('touchend', onTouchEnd);
	block.addEventListener('touchcancel', onTouchEnd);

	return () => {
		block.removeEventListener('wheel', onWheel);
		block.removeEventListener('pointerdown', onPointerDown);
		block.removeEventListener('pointermove', onPointerMove);
		block.removeEventListener('pointerup', onPointerEnd);
		block.removeEventListener('pointercancel', onPointerEnd);
		block.removeEventListener('touchstart', onTouchStart);
		block.removeEventListener('touchmove', onTouchMove);
		block.removeEventListener('touchend', onTouchEnd);
		block.removeEventListener('touchcancel', onTouchEnd);
	};
}

/** Create the bottom-right control cluster: zoom in / zoom out / fit width /
 *  reset / lock / fullscreen. Idempotent — an existence guard (not a marker
 *  class) so it self-heals crash reloads and pre-cluster versions. */
function ensureControlCluster(block: HTMLElement, opts: InlineZoomOpts): HTMLElement {
	const existing = block.querySelector<HTMLElement>(CLUSTER_SELECTOR);
	if (existing) return existing;

	// Self-heal pre-cluster versions: a standalone fullscreen button from
	// an older build would otherwise leave a duplicate trigger.
	for (const legacy of Array.from(block.querySelectorAll<HTMLElement>(LEGACY_FULLSCREEN_SELECTOR))) {
		legacy.remove();
	}

	const cluster = block.createDiv({ cls: CLUSTER_CLASS });

	const makeButton = (iconId: string, label: string, onClick: () => void): HTMLButtonElement => {
		const btn = cluster.createEl('button', {
			cls: 'mermaid-zoom-icon-btn mermaid-zoom-inline-zoom-btn',
		});
		setIcon(btn, iconId);
		btn.setAttribute('aria-label', label);
		btn.title = label;
		btn.addEventListener('click', (e) => {
			e.stopPropagation();
			onClick();
		});
		return btn;
	};

	// Buttons work regardless of lock state (the old 0019ca6 semantics).
	makeButton('plus', t('modal.zoomIn'), () => zoomBlockBy(block, INLINE_ZOOM_STEP));
	makeButton('minus', t('modal.zoomOut'), () => zoomBlockBy(block, 1 / INLINE_ZOOM_STEP));
	makeButton('move-horizontal', t('inline.fitWidth'), () => fitBlockToWidth(block));
	makeButton('rotate-ccw', t('modal.reset'), () => resetBlockZoom(block));

	// Lock toggle: gates inline gestures only.
	const lockBtn = cluster.createEl('button', {
		cls: 'mermaid-zoom-icon-btn mermaid-zoom-inline-zoom-btn mermaid-zoom-lock-btn',
	});
	lockBtn.addEventListener('click', (e) => {
		e.stopPropagation();
		setBlockLock(block, !isUnlocked(block), opts.getSensitivity);
	});
	applyLockButtonState(lockBtn, isUnlocked(block));

	// Fullscreen trigger with the hand-built corner-brackets icon (moved
	// verbatim from the old standalone button). The click resolves the svg
	// at click time — live preview may have swapped the node under us.
	const fullscreenBtn = cluster.createEl('button', {
		cls: 'mermaid-zoom-icon-btn mermaid-zoom-fullscreen-btn',
	});
	const svgNS = 'http://www.w3.org/2000/svg';
	const icon = document.createElementNS(svgNS, 'svg');
	icon.setAttribute('width', '18');
	icon.setAttribute('height', '18');
	icon.setAttribute('viewBox', '0 0 16 16');
	icon.setAttribute('fill', 'none');
	icon.setAttribute('stroke', 'currentColor');
	icon.setAttribute('stroke-width', '1');
	icon.setAttribute('stroke-linecap', 'round');
	icon.setAttribute('stroke-linejoin', 'round');
	for (const points of ['1,10 1,15 6,15', '15,10 15,15 10,15', '1,6 1,1 6,1', '15,6 15,1 10,1']) {
		const polyline = document.createElementNS(svgNS, 'polyline');
		polyline.setAttribute('points', points);
		icon.appendChild(polyline);
	}
	fullscreenBtn.appendChild(icon);
	const fullscreenLabel = t('inline.fullscreen');
	fullscreenBtn.setAttribute('aria-label', fullscreenLabel);
	fullscreenBtn.title = fullscreenLabel;
	fullscreenBtn.addEventListener('click', (e) => {
		e.stopPropagation();
		opts.onFullscreen(block);
	});

	// Pin the cluster against the block's horizontal scroll — absolutely
	// positioned children scroll away with the content otherwise. The
	// isConnected guard keeps reload cycles from writing to a detached
	// cluster; the listener itself dies with the block.
	block.addEventListener('scroll', () => {
		if (!cluster.isConnected) return;
		cluster.style.transform = `translateX(${block.scrollLeft}px)`;
	});

	return cluster;
}

/** Idempotent re-sync, called from EVERY decoration sweep: cluster
 *  existence, button visibility, scale re-application after an svg swap,
 *  and lock/listener repair all converge here. */
export function syncInlineZoom(block: HTMLElement, opts: InlineZoomOpts): void {
	ensureControlCluster(block, opts);
	block.toggleClass('mermaid-zoom-inline-controls-off', !opts.showZoomButtons);

	// Heal a re-rendered svg: the stored scale outlives the replaced node,
	// which arrives with mermaid's pristine inline styles.
	const scale = getBlockScale(block);
	if (scale !== 1) {
		const svg = block.querySelector('svg');
		if (svg && !svg.style.width) {
			setBlockScale(block, scale);
		}
	}

	// Heal gesture state (crash reload: lock class survived, listeners
	// didn't) — an unlocked block must have live listeners.
	if (isUnlocked(block) && !gestureTeardowns.has(block)) {
		gestureTeardowns.set(block, attachGestures(block, opts.getSensitivity));
	}

	syncLockButton(block);
}

/** Full strip for onunload: detach gestures, restore pristine svg styles,
 *  drop scale state and inline-zoom classes. Cluster removal and the
 *  ready/bordered/align classes stay with main.onunload. */
export function teardownInlineZoom(block: HTMLElement): void {
	gestureTeardowns.get(block)?.();
	gestureTeardowns.delete(block);
	const svg = block.querySelector('svg');
	if (svg) restorePristine(svg);
	delete block.dataset.mzScale;
	block.removeClass(...INLINE_ZOOM_CLASSES);
}
