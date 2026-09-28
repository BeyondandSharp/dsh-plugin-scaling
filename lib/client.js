window.__ModuleLoader__.load({
	id: "@beyondandsharp/dsh-plugin-scaling",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		//#region \0dsh-css:src/client/scaling.module.css.mjs
		const css = "body[data-dsh-plugin-scaling] [data-pane-scaling-target=left]{--pane-scaling-own:var(--pane-scaling-left);--pane-scaling-counter:var(--pane-scaling-counter-left);--pane-scaling-origin-x:var(--pane-scaling-origin-x-left);--pane-scaling-origin-y:var(--pane-scaling-origin-y-left);zoom:var(--pane-scaling-left)}body[data-dsh-plugin-scaling] [data-pane-scaling-target=center]{--pane-scaling-own:var(--pane-scaling-center);--pane-scaling-counter:var(--pane-scaling-counter-center);--pane-scaling-origin-x:var(--pane-scaling-origin-x-center);--pane-scaling-origin-y:var(--pane-scaling-origin-y-center);zoom:var(--pane-scaling-center)}body[data-dsh-plugin-scaling] [data-pane-scaling-target=right]{--pane-scaling-own:var(--pane-scaling-right);--pane-scaling-counter:var(--pane-scaling-counter-right);--pane-scaling-origin-x:var(--pane-scaling-origin-x-right);--pane-scaling-origin-y:var(--pane-scaling-origin-y-right);zoom:var(--pane-scaling-right)}body[data-dsh-plugin-scaling][data-pane-scaling-fill=compensated] [data-pane-scaling-target]{width:calc(100% / var(--pane-scaling-own));height:calc(100% / var(--pane-scaling-own))}body[data-dsh-plugin-scaling][data-pane-scaling-fill-left=compensated] [data-pane-scaling-target=left]{width:var(--pane-scaling-fill-width-left)!important}body[data-dsh-plugin-scaling][data-pane-scaling-fill-center=compensated] [data-pane-scaling-target=center]{width:var(--pane-scaling-fill-width-center)!important}body[data-dsh-plugin-scaling][data-pane-scaling-fill-right=compensated] [data-pane-scaling-target=right]{width:var(--pane-scaling-fill-width-right)!important}body[data-dsh-plugin-scaling][data-pane-scaling-fixed=scaled] [data-pane-scaling-target] :is([role=tooltip],[data-pane-scaling-fixed-overlay]),body[data-dsh-plugin-scaling][data-pane-scaling-fixed=contained] [data-pane-scaling-target] :is([role=tooltip],[data-pane-scaling-fixed-overlay]){zoom:var(--pane-scaling-counter)}body[data-dsh-plugin-scaling][data-pane-scaling-fixed=contained] [data-pane-scaling-target] :is([role=tooltip],[data-pane-scaling-fixed-overlay]){translate:calc(-1 * var(--pane-scaling-origin-x)) calc(-1 * var(--pane-scaling-origin-y))}body[data-dsh-plugin-scaling] [data-pane-scaling-badge]{z-index:900;pointer-events:none;opacity:0;border:1px solid var(--dsw-alias-border-l2,#0000001f);border-radius:var(--dsw-radius-lg,10px);background:var(--dsw-alias-bg-layer-2,#fff);box-shadow:var(--dsw-elevation-panel,0 8px 24px #00000026);color:var(--dsw-alias-label-primary,#1a1a1a);padding:6px 10px;font:500 12px/16px system-ui,sans-serif;transition:opacity .12s ease-out;position:fixed;inset-block-end:24px;inset-inline-end:24px}body[data-dsh-plugin-scaling] [data-pane-scaling-badge][data-pane-scaling-badge-visible]{opacity:1}";
		const tagId = "@beyondandsharp/dsh-plugin-scaling/scaling.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@beyondandsharp/dsh-plugin-scaling";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		//#endregion
		//#region src/client/badge.ts
		/** Attribute identifying the badge element. */
		const BADGE_ATTRIBUTE = "data-pane-scaling-badge";
		/** Attribute gating the badge's visible styles. */
		const BADGE_VISIBLE_ATTRIBUTE = "data-pane-scaling-badge-visible";
		/** How long the badge stays visible after a change. */
		const BADGE_VISIBLE_MS = 1200;
		/**
		* Create the lazily-mounted badge.
		* @param doc - the product document (the badge lives on `body`, outside every pane).
		* @param copy - localized strings.
		* @returns the badge handle.
		*/
		function createBadge(doc, copy) {
			let element;
			let timer;
			let hinted = false;
			const ensure = () => {
				if (element !== void 0) return element;
				element = doc.createElement("div");
				element.setAttribute(BADGE_ATTRIBUTE, "");
				element.setAttribute("role", "status");
				element.setAttribute("aria-live", "polite");
				doc.body.append(element);
				return element;
			};
			const hide = () => {
				timer = void 0;
				element?.removeAttribute(BADGE_VISIBLE_ATTRIBUTE);
			};
			return {
				show(pane, zoom) {
					const node = ensure();
					const text = `${copy.pane(pane)} ${copy.percent(zoom)}`;
					node.textContent = hinted ? text : `${text} · ${copy.resetHint}`;
					hinted = true;
					node.setAttribute(BADGE_VISIBLE_ATTRIBUTE, "");
					if (timer !== void 0) clearTimeout(timer);
					timer = setTimeout(hide, BADGE_VISIBLE_MS);
				},
				dispose() {
					if (timer !== void 0) clearTimeout(timer);
					timer = void 0;
					element?.remove();
					element = void 0;
				}
			};
		}
		//#endregion
		//#region src/client/targets.ts
		/**
		* Pane identity, DOM resolution, and the incremental mark lease.
		*
		* The three grid columns are never scaled themselves: each carries an inline
		* width (and the center track is `minmax(...)`), so zooming a column would
		* resize the track and push its neighbours around. Every target here is a
		* content root *inside* a column.
		*/
		/** The three independently scalable panes, in DOM order. */
		const PANE_IDS = [
			"left",
			"center",
			"right"
		];
		/** Attribute stamped on each resolved pane content root. */
		const TARGET_ATTRIBUTE = "data-pane-scaling-target";
		/** Marks an in-pane `position: fixed` overlay that needs counter-scaling. */
		const FIXED_OVERLAY_ATTRIBUTE = "data-pane-scaling-fixed-overlay";
		/**
		* CSS-module class names keep their local name (`[hash]_sidebarCol`), so a
		* class-substring selector is stable across hashes; the shell's own e2e tests
		* rely on the same convention.
		*/
		const COLUMN_SELECTORS = {
			left: "[class*='sidebarCol']",
			center: "[class*='centerCol']",
			right: "[class*='rightbarCol']"
		};
		/** Slot-tree anchors, most specific first; the first present one wins. */
		const ANCHORS = {
			left: [
				"[data-slot='sidebar']",
				"[data-slot='sidebar.settings']",
				"[role='tree']",
				"[class*='newSession']"
			],
			center: ["[data-conversation-scroll]"]
		};
		/** Docked right-sidebar compartments; `hidden` cells are unselected panes. */
		const DOCK_PANE_SELECTOR = "[data-dockkit-host='dock']:not([hidden]) > section";
		const DOCK_PANE_FALLBACK = "[data-sidebar-right-panel] [data-dockkit-pane]";
		/** Subtrees that own their own Ctrl+wheel gesture and are never a target. */
		const EXCLUDED_SELECTOR = ".xterm, [data-dockkit-float]";
		/** Terminal screens keep their own wheel handling and never reflow for zoom. */
		const TERMINAL_SELECTOR = ".xterm";
		/** Element nodes only; avoids cross-realm `instanceof` checks. */
		function asElement(node) {
			return node !== null && node.nodeType === 1 ? node : void 0;
		}
		/** Read the used `display` value, tolerating a missing `getComputedStyle`. */
		function displayOf(element) {
			const inline = element.style?.display;
			if (inline === "contents") return "contents";
			return element.ownerDocument.defaultView?.getComputedStyle(element).display ?? inline ?? "";
		}
		/**
		* A slot seam is `display: contents`: it has no box, so it cannot be a zoom
		* target and must be stepped through.
		* @param element - candidate node.
		* @returns whether the node lays out a box of its own.
		*/
		function hasLayoutBox(element) {
			const display = displayOf(element);
			return display !== "contents" && display !== "none" && display !== "";
		}
		/**
		* The element's own inline width when it is an explicit px length.
		*
		* The left sidebar root freezes its expanded width inline
		* (`SidebarRoot.tsx`: `style={{ width }}`) so the collapse slide does not
		* reflow its content. An explicit px width is scaled by `zoom` under every
		* engine's semantics — unlike a percentage or `auto` width — so such a root
		* always needs its width compensation, and the compensation has to follow that
		* frozen value (not the column's box) to keep the host's own layout intent.
		* @param element - candidate zoom target.
		* @returns the width in px, or undefined when the inline width is absent or not px.
		*/
		function inlinePixelWidth(element) {
			const width = element.style?.getPropertyValue("width").trim() ?? "";
			if (!/^\d+(?:\.\d+)?px$/u.test(width)) return void 0;
			const value = Number.parseFloat(width);
			return Number.isFinite(value) ? value : void 0;
		}
		/**
		* Descend through `display: contents` seams to the first node with a real box.
		* @param element - start node (usually a column's direct child).
		* @returns the first boxed element, or undefined when the subtree is empty.
		*/
		function firstBoxedDescendant(element) {
			let current = element;
			while (current !== void 0 && !hasLayoutBox(current)) current = asElement(current.firstElementChild);
			return current;
		}
		/**
		* Climb from an anchor to the anchor's ancestor that is a direct child of the column.
		* @param column - one of the three grid columns.
		* @param anchor - matched anchor inside the column.
		* @returns the column's own child on the anchor's path, excluding the column itself.
		*/
		function climbToColumnChild(column, anchor) {
			let current = anchor;
			while (current.parentElement !== null && current.parentElement !== column) current = current.parentElement;
			if (current === column || current.parentElement !== column) return void 0;
			return current;
		}
		/** Resolve one left/center pane through its anchors. */
		function resolveAnchored(column, anchors) {
			for (const selector of anchors) {
				const anchor = asElement(column.querySelector(selector));
				if (anchor === void 0) continue;
				if (anchor.closest(EXCLUDED_SELECTOR) !== null) continue;
				const seated = climbToColumnChild(column, anchor);
				if (seated === void 0) continue;
				const boxed = firstBoxedDescendant(seated);
				if (boxed === void 0 || !(boxed instanceof (boxed.ownerDocument.defaultView?.HTMLElement ?? HTMLElement))) continue;
				return boxed;
			}
		}
		/**
		* Resolve the visible docked compartments of the right column. Floating cells
		* are siblings of the dock cells, so they are excluded by construction, and
		* the column's own `.panel` (which carries an inline width) is never returned.
		*/
		function resolveDockedSections(column) {
			const docked = [...column.querySelectorAll(DOCK_PANE_SELECTOR)];
			const candidates = docked.length > 0 ? docked : [...column.querySelectorAll(DOCK_PANE_FALLBACK)];
			const resolved = [];
			for (const candidate of candidates) {
				if (!hasLayoutBox(candidate)) continue;
				if (candidate.closest(EXCLUDED_SELECTOR) !== null) continue;
				if (candidate.matches(TERMINAL_SELECTOR) || candidate.querySelector(TERMINAL_SELECTOR) !== null) continue;
				if (!(candidate instanceof (candidate.ownerDocument.defaultView?.HTMLElement ?? HTMLElement))) continue;
				resolved.push(candidate);
			}
			return resolved;
		}
		/**
		* Resolve every pane content root currently present. Read-only: the caller owns
		* marking. Missing columns (collapsed sidebar, closed right bar) are simply absent.
		* @param doc - the product document.
		* @returns the resolved targets, in pane order.
		*/
		function resolvePaneTargets(doc) {
			const targets = [];
			for (const pane of PANE_IDS) {
				const column = asElement(doc.querySelector(COLUMN_SELECTORS[pane]));
				if (column === void 0) continue;
				if (pane === "right") {
					for (const element of resolveDockedSections(column)) targets.push({
						pane,
						element
					});
					continue;
				}
				const element = resolveAnchored(column, ANCHORS[pane]);
				if (element !== void 0) targets.push({
					pane,
					element
				});
			}
			return targets;
		}
		/**
		* Apply the desired marks as a difference, leaving foreign attribute values alone.
		* Same-value marks are not rewritten, and an attribute is only cleared or taken
		* over while it carries the value this owner previously wrote (lease semantics
		* for co-existing owners).
		* @param owned - the marks written by the previous sync.
		* @param desired - the freshly resolved targets.
		* @returns the marks this owner now holds.
		*/
		function syncTargetMarks(owned, desired) {
			const desiredMap = /* @__PURE__ */ new Map();
			for (const { pane, element } of desired) desiredMap.set(element, pane);
			for (const [element, pane] of owned) {
				if (desiredMap.get(element) === pane) continue;
				if (element.getAttribute("data-pane-scaling-target") === pane) element.removeAttribute(TARGET_ATTRIBUTE);
			}
			const claimed = /* @__PURE__ */ new Map();
			for (const [element, pane] of desiredMap) {
				const current = element.getAttribute(TARGET_ATTRIBUTE);
				if (current === pane) {
					claimed.set(element, pane);
					continue;
				}
				if (current !== null && current !== owned.get(element)) continue;
				element.setAttribute(TARGET_ATTRIBUTE, pane);
				claimed.set(element, pane);
			}
			return claimed;
		}
		/**
		* Clear every mark this owner holds.
		* @param owned - the marks written by the previous sync.
		*/
		function clearTargetMarks(owned) {
			for (const [element, pane] of owned) if (element.getAttribute("data-pane-scaling-target") === pane) element.removeAttribute(TARGET_ATTRIBUTE);
		}
		/**
		* Whether a mutation batch can change pane resolution. Deliberately narrow:
		* chat output appends thousands of nodes into the center pane's subtree, and a
		* full re-resolve per append would be wasted work.
		* @param records - the observer's pending records.
		* @returns true when a column, slot seam, scroll root, or dock host appeared, left, or changed.
		*/
		function isPaneStructureChange(records) {
			for (const record of records) {
				if (record.target.nodeType === 1) {
					const element = record.target;
					if (element === element.ownerDocument.body || element.matches(STRUCTURE_SELECTOR)) return true;
				}
				for (const node of [...record.addedNodes, ...record.removedNodes]) {
					if (node.nodeType !== 1) continue;
					const element = node;
					if (element.matches(STRUCTURE_SELECTOR) || element.querySelector(STRUCTURE_SELECTOR) !== null) return true;
				}
			}
			return false;
		}
		/** Structural elements whose appearance or removal invalidates resolution. */
		const STRUCTURE_SELECTOR = "[class*='sidebarCol'], [class*='centerCol'], [class*='rightbarCol'], [data-slot='sidebar'], [data-conversation-scroll], [data-dockkit-host]";
		/**
		* Nearest marked pane ancestor of a node, skipping excluded subtrees.
		* @param node - an event target or the active element.
		* @returns the pane whose target encloses the node, or null.
		*/
		function paneOfNode(node) {
			if (node === null) return null;
			const marked = node.closest(`[${TARGET_ATTRIBUTE}]`);
			if (marked === null) return null;
			const value = marked.getAttribute(TARGET_ATTRIBUTE);
			return value === "left" || value === "center" || value === "right" ? value : null;
		}
		/**
		* Whether a node sits in a surface that owns Ctrl+wheel itself (document
		* preview, terminal) or in a floating panel.
		* @param node - an event target or the active element.
		* @returns whether the plugin must leave the gesture alone.
		*/
		function isExcludedSurface(node) {
			if (node === null) return false;
			return node.closest(`[data-document-zoom-surface], [data-document-zoom-frame], [data-document-zoom-scrollport], ${EXCLUDED_SELECTOR}`) !== null;
		}
		//#endregion
		//#region src/client/calibration.ts
		/**
		* Runtime self-calibration: the browser decides the compensation branches, so the
		* plugin never guesses engine behaviour.
		*
		* Two questions are measured in-page, once, while the pane is already zoomed:
		*  - fill: does the content root keep filling its column, or does its own box
		*    grow with the zoom (then `width: calc(100% / zoom)` restores it)?
		*  - fixed: are in-pane `position: fixed` descendants untouched (`native`),
		*    size-scaled only (`scaled`), or also re-anchored to the zoomed ancestor
		*    (`contained`, which additionally needs an origin translate)?
		*
		* Classifiers are pure functions over measurements; the surrounding routine only
		* inserts and removes a hidden probe. jsdom reports zero-size rects, which lands
		* on `fluid` + `native`: exactly the "no compensation" default.
		*/
		/** Body attribute carrying the fill branch. */
		const FILL_ATTRIBUTE = "data-pane-scaling-fill";
		/** Body attribute carrying the fixed-positioning branch. */
		const FIXED_ATTRIBUTE = "data-pane-scaling-fixed";
		/**
		* Per-pane fill gate forced by an explicit inline px width on that pane's root.
		* It is an element property, not an engine one, so it is written per pane and
		* only when it applies.
		* @param subject - the pane whose root carries the px width.
		* @returns the body attribute name.
		*/
		const fillPaneAttribute = (subject) => `data-pane-scaling-fill-${subject}`;
		/**
		* Inline variable holding the compensated width for a pane whose root freezes
		* its width in px: the frozen value divided by the pane's current zoom, so the
		* rendered width stays exactly the host's own width.
		* @param subject - the pane.
		* @returns the variable name.
		*/
		const fillWidthVariable = (subject) => `--pane-scaling-fill-width-${subject}`;
		/** Relative geometry tolerance. */
		const TOLERANCE_RATIO = .02;
		/** Candidate in-pane fixed overlays: the host tooltip plus desktop-shell chrome. */
		const OVERLAY_CANDIDATES = "[role='tooltip'], [class*='toggle'], [class*='newSession']";
		/** Compare two lengths with an absolute floor and a relative allowance. */
		function near(actual, expected) {
			return Math.abs(actual - expected) <= Math.max(1, Math.abs(expected) * TOLERANCE_RATIO);
		}
		/**
		* Decide the fill branch by trying the compensation and keeping the closer box.
		* @param sample - measured geometry.
		* @returns `compensated` when the inline width moves the root closer to its column.
		*/
		function classifyFillProbe(sample) {
			if (!(sample.column.width > 0)) return "fluid";
			const plain = Math.abs(sample.root.width - sample.column.width);
			return Math.abs(sample.compensated.width - sample.column.width) < plain - 1 ? "compensated" : "fluid";
		}
		/**
		* Classify how fixed descendants behave inside the zoomed pane.
		* @param sample - measured geometry.
		* @returns the compensation branch; unusable measurements mean `native`.
		*/
		function classifyFixedProbe(sample) {
			if (!(sample.zoom > 0) || !(sample.root.width > 0)) return "native";
			if (near(sample.scaled.width, 10)) return "native";
			if (!near(sample.countered.width, 10)) return "native";
			if (near(sample.scaled.x, 20) && near(sample.scaled.y, 20)) return "scaled";
			return "contained";
		}
		/**
		* The real-DOM probe environment.
		* @param doc - the product document.
		* @returns an environment that creates real, invisible probe nodes.
		*/
		function domProbeEnvironment(doc) {
			return {
				create: (tag) => doc.createElement(tag),
				attach: (parent, probe) => {
					parent.append(probe);
				},
				detach: (probe) => {
					probe.remove();
				},
				rect: (element) => {
					const rect = element.getBoundingClientRect();
					return {
						x: rect.x,
						y: rect.y,
						width: rect.width,
						height: rect.height
					};
				},
				readStyle: (element, property) => element.style.getPropertyValue(property),
				setStyle: (element, property, value) => {
					if (value === "") element.style.removeProperty(property);
					else element.style.setProperty(property, value);
				}
			};
		}
		/** Nearest ancestor with a real layout box; slot seams (`display: contents`) are skipped. */
		function boxedAncestor(element) {
			let current = element.parentElement;
			while (current !== null) {
				if (hasLayoutBox(current)) return current;
				current = current.parentElement;
			}
		}
		/**
		* Measure both branches inside an already-zoomed pane root.
		* @param root - the marked pane content root.
		* @param zoom - the zoom currently applied to `root`.
		* @param env - probe environment (real DOM by default).
		* @returns the decided branches, the origin values, and the raw measurements.
		*/
		function calibrate(root, zoom, env) {
			const column = boxedAncestor(root) ?? root;
			const columnRect = env.rect(column);
			const rootRect = env.rect(root);
			const previousWidth = env.readStyle(root, "width");
			let compensatedRect = rootRect;
			try {
				env.setStyle(root, "width", `calc(100% / ${zoom})`);
				compensatedRect = env.rect(root);
			} finally {
				env.setStyle(root, "width", previousWidth);
			}
			const fill = classifyFillProbe({
				column: columnRect,
				root: rootRect,
				compensated: compensatedRect
			});
			const probe = env.create("div");
			env.setStyle(probe, "position", "fixed");
			env.setStyle(probe, "left", `20px`);
			env.setStyle(probe, "top", `20px`);
			env.setStyle(probe, "width", `10px`);
			env.setStyle(probe, "height", `10px`);
			env.setStyle(probe, "visibility", "hidden");
			env.setStyle(probe, "pointer-events", "none");
			env.attach(root, probe);
			let scaled;
			let countered;
			try {
				scaled = env.rect(probe);
				env.setStyle(probe, "zoom", String(1 / zoom));
				countered = env.rect(probe);
			} finally {
				env.detach(probe);
			}
			const measuredRoot = env.rect(root);
			const fixed = classifyFixedProbe({
				zoom,
				scaled,
				countered,
				root: measuredRoot
			});
			return {
				fill,
				fixed,
				origin: {
					x: measuredRoot.x,
					y: measuredRoot.y
				},
				payload: {
					zoom,
					column: columnRect,
					root: measuredRoot,
					compensated: compensatedRect,
					scaled,
					countered,
					fill,
					fixed
				}
			};
		}
		/**
		* Re-apply the in-pane fixed-overlay marks. Only elements that really compute to
		* `position: fixed` are marked, so class-name candidates that happen to be
		* ordinary flow buttons are never counter-scaled.
		* @param owned - marks written by the previous call.
		* @param roots - the marked pane roots to scan.
		* @param view - the window used for computed styles.
		* @returns the marks now held.
		*/
		function syncFixedOverlays(owned, roots, view) {
			const next = /* @__PURE__ */ new Set();
			for (const root of roots) for (const candidate of root.querySelectorAll(OVERLAY_CANDIDATES)) {
				if (!(candidate instanceof HTMLElement)) continue;
				if ((view?.getComputedStyle(candidate).position ?? candidate.style.position) !== "fixed") continue;
				if (!candidate.hasAttribute("data-pane-scaling-fixed-overlay")) candidate.setAttribute(FIXED_OVERLAY_ATTRIBUTE, "");
				next.add(candidate);
			}
			for (const element of owned) {
				if (next.has(element)) continue;
				if (element.getAttribute("data-pane-scaling-fixed-overlay") === "") element.removeAttribute(FIXED_OVERLAY_ATTRIBUTE);
			}
			return next;
		}
		/**
		* Drop every fixed-overlay mark this owner holds.
		* @param owned - marks written by the previous call.
		*/
		function clearFixedOverlays(owned) {
			for (const element of owned) if (element.getAttribute("data-pane-scaling-fixed-overlay") === "") element.removeAttribute(FIXED_OVERLAY_ATTRIBUTE);
		}
		//#endregion
		//#region src/client/copy.ts
		const ZH = {
			pane: (pane) => ({
				left: "左栏",
				center: "中栏",
				right: "右栏"
			})[pane],
			percent: (zoom) => `${String(Math.round(zoom * 100))}%`,
			resetHint: "Ctrl+0 复位",
			commands: {
				in: "放当前栏",
				out: "缩当前栏",
				reset: "当前栏复位到 100%",
				alias: "缩放"
			}
		};
		const EN = {
			pane: (pane) => ({
				left: "Left",
				center: "Center",
				right: "Right"
			})[pane],
			percent: (zoom) => `${String(Math.round(zoom * 100))}%`,
			resetHint: "Ctrl+0 resets",
			commands: {
				in: "Zoom the current pane in",
				out: "Zoom the current pane out",
				reset: "Reset the current pane to 100%",
				alias: "pane zoom"
			}
		};
		/**
		* Pick the dictionary from `<html lang>`; no host locale service is consulted so
		* the plugin stays usable in any shell and under any skin.
		* @param doc - the product document.
		* @returns the resolved copy.
		*/
		function copyFor(doc) {
			return (doc.documentElement.lang ?? "").trim().toLowerCase().startsWith("zh") ? ZH : EN;
		}
		/**
		* Create the initial gesture state.
		* @returns a state with no remembered pointer pane.
		*/
		function createGestureState() {
			return { pointerPane: null };
		}
		/** Normalize a wheel delta to "up is positive" device-independent units. */
		function normalizeDelta(event) {
			const factor = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 100 : 1;
			return -event.deltaY * factor;
		}
		/**
		* Install the wheel and pointerdown listeners.
		* @param doc - the product document.
		* @param host - step sink.
		* @param state - pointer cache shared with the keyboard path.
		* @returns the disposer removing both listeners and any pending idle timer.
		*/
		function installGestures(doc, host, state) {
			const view = doc.defaultView;
			if (view === null) return () => {};
			let residual = 0;
			let lastPane = null;
			let idle;
			const clearResidual = () => {
				residual = 0;
				lastPane = null;
				idle = void 0;
			};
			const onWheel = (event) => {
				if (!event.ctrlKey && !event.metaKey) return;
				const target = event.target instanceof Element ? event.target : null;
				if (target === null || isExcludedSurface(target)) return;
				const pane = paneOfNode(target);
				if (pane === null) return;
				event.preventDefault();
				state.pointerPane = pane;
				if (lastPane !== pane) residual = 0;
				lastPane = pane;
				residual += normalizeDelta(event);
				if (idle !== void 0) clearTimeout(idle);
				idle = setTimeout(clearResidual, 200);
				const steps = Math.trunc(residual / 100);
				if (steps === 0) return;
				residual -= steps * 100;
				const direction = steps > 0 ? 1 : -1;
				for (let index = 0; index < Math.abs(steps); index += 1) host.step(pane, direction);
			};
			const onPointerDown = (event) => {
				const target = event.target instanceof Element ? event.target : null;
				if (target === null) return;
				const pane = paneOfNode(target);
				if (pane !== null) state.pointerPane = pane;
			};
			view.addEventListener("wheel", onWheel, {
				capture: true,
				passive: false
			});
			view.addEventListener("pointerdown", onPointerDown, {
				capture: true,
				passive: true
			});
			return () => {
				if (idle !== void 0) clearTimeout(idle);
				idle = void 0;
				view.removeEventListener("wheel", onWheel, { capture: true });
				view.removeEventListener("pointerdown", onPointerDown, { capture: true });
			};
		}
		//#endregion
		//#region src/client/host.ts
		/**
		* Duck-type `ctx.get('shortcuts')` without importing a host package.
		* @param ctx - the plugin's cordis context (unknown on purpose).
		* @returns the service when it looks usable, otherwise undefined.
		*/
		function readShortcutService(ctx) {
			const get = ctx?.get;
			if (typeof get !== "function") return void 0;
			let service;
			try {
				service = get.call(ctx, "shortcuts");
			} catch (_error) {
				return;
			}
			if (typeof service !== "object" || service === null) return void 0;
			const candidate = service;
			if (typeof candidate.register !== "function") return void 0;
			return candidate;
		}
		//#endregion
		//#region src/client/shortcuts.ts
		/**
		* Keyboard access: the host `shortcuts` service when it can own the keys, and a
		* private capture listener otherwise.
		*
		* The host validates every declared default for all six shell/platform profiles
		* and rejects `Ctrl+Equal` under `web:*` as `unsupported-browser` — and its
		* physical-code whitelist has no `Numpad*` codes at all — so the web shell has
		* to use the private path, and the two paths must never run together (the host
		* dispatches keydown in the bubble phase, a second handler would step twice).
		*/
		/** Command ids; they satisfy the host's `commandPattern` and are user-editable. */
		const COMMAND_IDS = {
			in: "pane-scaling.in",
			out: "pane-scaling.out",
			reset: "pane-scaling.reset"
		};
		/** Which code maps to which zoom direction. */
		const DIRECTION_BY_CODE = {
			Equal: 1,
			NumpadAdd: 1,
			Minus: -1,
			NumpadSubtract: -1,
			Digit0: 0,
			Numpad0: 0
		};
		/** Zoom direction for a physical key code, or undefined when unrelated. */
		function directionOfCode(code) {
			return Object.hasOwn(DIRECTION_BY_CODE, code) ? DIRECTION_BY_CODE[code] : void 0;
		}
		/** Build the three host command definitions (desktop profiles only). */
		function commands(copy, targets) {
			const make = (id, label, alias, code, direction) => {
				const binding = {
					code,
					modifiers: ["primary"]
				};
				return {
					id,
					label: () => label,
					aliases: [alias, copy.commands.alias],
					defaults: {
						"desktop:macos": binding,
						"desktop:windows": binding,
						"desktop:linux": binding
					},
					regions: ["page", "editable"],
					modals: [],
					resolve: (context) => {
						const pane = targets.paneFor(context.target);
						if (pane === null) return { status: "pass" };
						return {
							status: "handled",
							run: () => {
								targets.step(pane, direction);
							}
						};
					}
				};
			};
			return [
				make(COMMAND_IDS.in, copy.commands.in, "zoom in", "Equal", 1),
				make(COMMAND_IDS.out, copy.commands.out, "zoom out", "Minus", -1),
				make(COMMAND_IDS.reset, copy.commands.reset, "reset zoom", "Digit0", 0)
			];
		}
		/**
		* Install keyboard access.
		* @param doc - the product document.
		* @param ctx - the plugin's cordis context (read for the optional service).
		* @param targets - pane resolution and stepping.
		* @param warn - one-time diagnostic sink.
		* @param copyOverride - localized copy override (tests only).
		* @returns the install handle; `dispose` releases whichever path was taken.
		*/
		function installShortcuts(doc, ctx, targets, warn = (message, error) => {
			console.warn(message, error);
		}, copyOverride) {
			const copy = copyOverride ?? copyFor(doc);
			const service = readShortcutService(ctx);
			if (service !== void 0 && service.runtime === "desktop") {
				const disposers = [];
				try {
					for (const command of commands(copy, targets)) disposers.push(service.register(command));
					return {
						mode: "host",
						dispose: () => {
							for (const dispose of disposers.splice(0)) dispose();
						}
					};
				} catch (error) {
					for (const dispose of disposers.splice(0)) dispose();
					warn("pane scaling: the host rejected the shortcut registration; falling back to built-in keys", error);
				}
			} else if (service !== void 0) warn("pane scaling: the web shell cannot bind Ctrl+±/0 through the shortcut service (browser-reserved); built-in keys are used and stay fixed");
			const onKeyDown = (event) => {
				if (event.defaultPrevented || event.altKey) return;
				if (!event.ctrlKey && !event.metaKey) return;
				const direction = directionOfCode(event.code);
				if (direction === void 0) return;
				const target = doc.activeElement;
				if (isExcludedSurface(target)) return;
				const pane = targets.paneFor(target);
				if (pane === null) return;
				event.preventDefault();
				if (event.repeat) return;
				targets.step(pane, direction);
			};
			const view = doc.defaultView;
			view?.addEventListener("keydown", onKeyDown, true);
			return {
				mode: "private",
				dispose: () => {
					view?.removeEventListener("keydown", onKeyDown, true);
				}
			};
		}
		//#endregion
		//#region src/client/storage.ts
		/** Zoom persistence: one integer step index per pane, validated and clamped. */
		/** localStorage key owned by this plugin. */
		const STORE_KEY = "dsh.plugin-scaling.v1";
		/** Steps per unit of zoom: 1 step = 5%. */
		const STEPS_PER_UNIT = 20;
		/**
		* Clamp and round a step index into the supported range.
		* @param value - candidate step index.
		* @returns an integer step in [MIN_STEP, MAX_STEP]; non-finite input yields 100%.
		*/
		function clampStep(value) {
			if (!Number.isFinite(value)) return 20;
			return Math.min(30, Math.max(15, Math.round(value)));
		}
		/**
		* Convert a step index into the CSS `zoom` factor. `21 / 20` stringifies to
		* exactly `"1.05"`, so repeated same-value writes stay detectable.
		* @param step - integer step index.
		* @returns the zoom factor as a number.
		*/
		function stepToZoom(step) {
			return clampStep(step) / STEPS_PER_UNIT;
		}
		/**
		* Convert a zoom factor into a clamped step index.
		* @param zoom - zoom factor in CSS `zoom` units.
		* @returns the nearest supported step index.
		*/
		function zoomToStep(zoom) {
			return clampStep(zoom * STEPS_PER_UNIT);
		}
		/**
		* A fresh 100% state.
		* @returns one default step per pane.
		*/
		function defaultSteps() {
			return {
				left: 20,
				center: 20,
				right: 20
			};
		}
		/**
		* Decode a stored document, falling back per pane on any malformed field.
		* Invalid JSON, a non-object root, missing panes, non-numbers, and
		* out-of-range values all degrade to 100% or a clamped step.
		* @param raw - the stored string, or null.
		* @returns decoded steps.
		*/
		function decodeZoom(raw) {
			const steps = defaultSteps();
			if (raw === null) return steps;
			let parsed;
			try {
				parsed = JSON.parse(raw);
			} catch (_error) {
				return steps;
			}
			if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return steps;
			const record = parsed;
			for (const pane of PANE_IDS) {
				const value = record[pane];
				if (typeof value !== "number" || !Number.isFinite(value)) continue;
				steps[pane] = zoomToStep(value);
			}
			return steps;
		}
		/**
		* Encode the state as zoom factors with a fixed key order, so the stored
		* document matches the documented schema (`{"left":1.05,...}`) and equal
		* states produce equal strings.
		* @param steps - the current state.
		* @returns the stored document.
		*/
		function encodeZoom(steps) {
			return JSON.stringify({
				left: stepToZoom(steps.left),
				center: stepToZoom(steps.center),
				right: stepToZoom(steps.right)
			});
		}
		/**
		* Read the stored state; a hostile or disabled `localStorage` yields defaults.
		* @param store - the storage implementation, or undefined when unavailable.
		* @returns decoded steps (never throws).
		*/
		function readZoom(store) {
			if (store === void 0) return defaultSteps();
			try {
				return decodeZoom(store.getItem(STORE_KEY));
			} catch (_error) {
				return defaultSteps();
			}
		}
		/**
		* Persist the state; a failing write is ignored so the session stays usable.
		* @param store - the storage implementation, or undefined when unavailable.
		* @param steps - the current state.
		*/
		function writeZoom(store, steps) {
			if (store === void 0) return;
			try {
				store.setItem(STORE_KEY, encodeZoom(steps));
			} catch (_error) {}
		}
		/**
		* The browser's `localStorage`, or undefined when the accessor itself throws
		* (sandboxed iframes) — the caller then keeps state in memory.
		* @param window - the product window.
		* @returns a usable store, or undefined.
		*/
		function localStorageOf(window) {
			if (window === void 0) return void 0;
			try {
				return window.localStorage ?? void 0;
			} catch (_error) {
				return;
			}
		}
		//#endregion
		//#region src/client/scaling.ts
		/**
		* Pane-scaling engine: pane marking, zoom variables, gestures, keyboard access,
		* one-time self-calibration, and a teardown that leaves no trace.
		*
		* Every handle is registered with the disposer at creation time, so a failure
		* halfway through activation still unwinds completely.
		*/
		/** Body attribute marking the plugin as active; scopes every static rule. */
		const ACTIVE_ATTRIBUTE = "data-dsh-plugin-scaling";
		/** Inline zoom factor for one pane, read by the pane rules. */
		const zoomVariable = (pane) => `--pane-scaling-${pane}`;
		/** Numeric reverse zoom for the pane's fixed overlays. */
		const counterVariable = (pane) => `--pane-scaling-counter-${pane}`;
		/** Measured pane origin x, used by the contained-mode translate. */
		const originXVariable = (pane) => `--pane-scaling-origin-x-${pane}`;
		/** Measured pane origin y, used by the contained-mode translate. */
		const originYVariable = (pane) => `--pane-scaling-origin-y-${pane}`;
		/** Reverse zoom, rounded so repeated writes are byte-identical. */
		function counterOf(zoom) {
			return String(Number((1 / zoom).toFixed(6)));
		}
		/**
		* Install the engine.
		* @param target - the element the plugin mounts on (the host passes `document.body`).
		* @param ctx - the plugin's cordis context, read for the optional `shortcuts` service.
		* @param options - test seams and diagnostic overrides.
		* @returns the disposer; calling it restores the document exactly.
		*/
		function installPaneScaling(target, ctx, options = {}) {
			const doc = target.ownerDocument;
			const view = doc.defaultView ?? void 0;
			const warn = options.warn ?? ((message, error) => {
				console.warn(message, error);
			});
			const report = options.report ?? ((message, payload) => {
				console.info(message, payload);
			});
			if (!(options.supportsZoom ?? (typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports("zoom", "1.2")))) {
				warn("pane scaling: this engine does not support CSS zoom, so the plugin stays inactive");
				return () => {};
			}
			const disposers = [];
			const undo = [];
			const sweepStyles = (element, names) => {
				const previous = names.map((name) => element.style.getPropertyValue(name));
				undo.push(() => {
					names.forEach((name, index) => {
						const value = previous[index] ?? "";
						if (value === "") element.style.removeProperty(name);
						else element.style.setProperty(name, value);
					});
				});
			};
			const setStyle = (element, name, value) => {
				if (element.style.getPropertyValue(name) === value) return;
				element.style.setProperty(name, value);
			};
			const clearStyle = (element, name) => {
				if (element.style.getPropertyValue(name) !== "") element.style.removeProperty(name);
			};
			const setAttribute = (element, name, value) => {
				if (element.getAttribute(name) !== value) element.setAttribute(name, value);
			};
			const html = doc.documentElement;
			const zoomNames = PANE_IDS.map((pane) => zoomVariable(pane));
			const counterNames = PANE_IDS.map((pane) => counterVariable(pane));
			const originNames = [...PANE_IDS.map((pane) => originXVariable(pane)), ...PANE_IDS.map((pane) => originYVariable(pane))];
			const fillWidthNames = PANE_IDS.map((pane) => fillWidthVariable(pane));
			sweepStyles(html, [
				...zoomNames,
				...counterNames,
				...originNames,
				...fillWidthNames
			]);
			const store = localStorageOf(view);
			const steps = readZoom(store);
			const apply = (pane, step) => {
				const zoom = stepToZoom(step);
				setStyle(html, zoomVariable(pane), String(zoom));
				setStyle(html, counterVariable(pane), counterOf(zoom));
			};
			for (const pane of PANE_IDS) apply(pane, steps[pane]);
			setAttribute(target, ACTIVE_ATTRIBUTE, "");
			undo.push(() => {
				if (target.getAttribute("data-dsh-plugin-scaling") === "") target.removeAttribute(ACTIVE_ATTRIBUTE);
			});
			let fill = "fluid";
			let fixed = "native";
			let calibrated = false;
			setAttribute(target, FILL_ATTRIBUTE, fill);
			setAttribute(target, FIXED_ATTRIBUTE, fixed);
			undo.push(() => {
				target.removeAttribute(FILL_ATTRIBUTE);
				target.removeAttribute(FIXED_ATTRIBUTE);
			});
			let marks = /* @__PURE__ */ new Map();
			let overlays = /* @__PURE__ */ new Set();
			/**
			* Compensate the width of a pane whose root carries an explicit inline px
			* width (the left sidebar freezes its expanded width that way, and the value
			* is the host's own layout intent — it can differ from the column box during
			* the collapse slide). A px width is scaled by `zoom` under every engine's
			* semantics, so this is an element fact rather than the engine-wide `fill`
			* verdict the probe measures: the compensation follows the frozen value
			* (`frozen / zoom`) instead of a percentage of the containing block.
			*/
			const forcedFill = /* @__PURE__ */ new Set();
			const refreshForcedFill = () => {
				for (const pane of PANE_IDS) {
					const root = [...marks].find(([, value]) => value === pane)?.[0];
					const frozen = root === void 0 ? void 0 : inlinePixelWidth(root);
					const name = fillPaneAttribute(pane);
					if (frozen === void 0) {
						forcedFill.delete(pane);
						if (target.getAttribute(name) !== null) target.removeAttribute(name);
						clearStyle(html, fillWidthVariable(pane));
						continue;
					}
					forcedFill.add(pane);
					setAttribute(target, name, "compensated");
					setStyle(html, fillWidthVariable(pane), `${Number((frozen / stepToZoom(steps[pane])).toFixed(3))}px`);
				}
			};
			undo.push(() => {
				for (const pane of PANE_IDS) target.removeAttribute(fillPaneAttribute(pane));
			});
			const resizeObserver = typeof ResizeObserver === "undefined" ? void 0 : new ResizeObserver(() => {
				scheduleSync();
			});
			const observer = typeof MutationObserver === "undefined" ? void 0 : new MutationObserver((records) => {
				if (isPaneStructureChange(records)) scheduleSync();
			});
			/**
			* Watches only the marked roots' inline styles. The sidebar rewrite of its
			* frozen width — a resize drag, the collapse slide, a layout restore — is an
			* attribute change, not a childList one, and the compensation has to follow
			* it live. Scoped to the three roots so the rest of the document's style
			* churn never reaches this callback.
			*/
			const rootStyleObserver = typeof MutationObserver === "undefined" ? void 0 : new MutationObserver(() => {
				scheduleSync();
			});
			const refreshOrigins = () => {
				if (fixed !== "contained") return;
				for (const [element, pane] of marks) {
					const rect = element.getBoundingClientRect();
					setStyle(html, originXVariable(pane), `${rect.x}px`);
					setStyle(html, originYVariable(pane), `${rect.y}px`);
				}
			};
			const observeRoots = () => {
				resizeObserver?.disconnect();
				rootStyleObserver?.disconnect();
				for (const element of marks.keys()) {
					resizeObserver?.observe(element);
					rootStyleObserver?.observe(element, {
						attributes: true,
						attributeFilter: ["style"]
					});
				}
			};
			const sync = () => {
				marks = syncTargetMarks(marks, resolvePaneTargets(doc));
				overlays = fixed === "native" ? overlays : syncFixedOverlays(overlays, [...marks.keys()], view);
				refreshForcedFill();
				observeRoots();
			};
			const schedule = options.schedule ?? ((callback) => {
				if (view?.requestAnimationFrame !== void 0) view.requestAnimationFrame(() => {
					callback();
				});
				else setTimeout(callback, 0);
			});
			let scheduled = false;
			const scheduleSync = () => {
				if (scheduled) return;
				scheduled = true;
				schedule(() => {
					scheduled = false;
					sync();
					if (fixed === "contained") refreshOrigins();
				});
			};
			observer?.observe(target, {
				childList: true,
				subtree: true
			});
			view?.addEventListener("resize", scheduleSync);
			disposers.push(() => {
				observer?.disconnect();
				resizeObserver?.disconnect();
				rootStyleObserver?.disconnect();
				view?.removeEventListener("resize", scheduleSync);
			});
			const runCalibration = (pane) => {
				const root = [...marks].find(([, value]) => value === pane)?.[0];
				if (root === void 0) return;
				try {
					const result = calibrate(root, stepToZoom(steps[pane]), options.probe ?? domProbeEnvironment(doc));
					fill = result.fill;
					fixed = result.fixed;
					calibrated = true;
					setAttribute(target, FILL_ATTRIBUTE, fill);
					setAttribute(target, FIXED_ATTRIBUTE, fixed);
					sync();
					if (fixed === "contained") refreshOrigins();
					report("pane scaling: calibration result", result.payload);
				} catch (error) {
					calibrated = true;
					warn("pane scaling: calibration failed, continuing without compensation", error);
				}
			};
			const badge = createBadge(doc, copyFor(doc));
			disposers.push(() => {
				badge.dispose();
			});
			const step = (pane, direction) => {
				const next = clampTarget(steps[pane], direction);
				if (next === steps[pane]) return;
				steps[pane] = next;
				apply(pane, next);
				refreshForcedFill();
				writeZoom(store, steps);
				badge.show(pane, stepToZoom(next));
				if (!calibrated && next !== 20) runCalibration(pane);
				if (fixed === "contained") refreshOrigins();
			};
			const gestureState = createGestureState();
			disposers.push(installGestures(doc, { step }, gestureState));
			const shortcuts = installShortcuts(doc, ctx, {
				paneFor: (node) => {
					if (isExcludedSurface(node)) return null;
					return paneOfNode(node) ?? gestureState.pointerPane ?? "center";
				},
				step
			}, warn);
			disposers.push(() => {
				shortcuts.dispose();
			});
			sync();
			return () => {
				for (const dispose of disposers.splice(0).reverse()) dispose();
				clearTargetMarks(marks);
				marks.clear();
				clearFixedOverlays(overlays);
				overlays.clear();
				for (const restore of undo.splice(0).reverse()) restore();
			};
		}
		/** Clamp one step of movement; 0 always means "back to 100%". */
		function clampTarget(current, direction) {
			return direction === 0 ? 20 : clampStep(current + direction);
		}
		//#endregion
		//#region src/client/index.ts
		/**
		* The browser half declares no service dependency on purpose: `shortcuts` is read
		* optionally so the private keydown fallback stays reachable.
		*/
		const inject = [];
		/**
		* Activate the pane-scaling engine for as long as the plugin is enabled.
		* @param ctx - plugin-owned client context.
		*/
		function apply(ctx) {
			ctx.effect(() => installPaneScaling(document.body, ctx), "ui-plugin-scaling: pane scaling");
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map