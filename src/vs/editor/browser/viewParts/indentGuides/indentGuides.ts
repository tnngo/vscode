/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./indentGuides';
import { DynamicViewOverlay } from 'vs/editor/browser/view/dynamicViewOverlay';
import { editorActiveIndentGuides, editorIndentGuides } from 'vs/editor/common/view/editorColorRegistry';
import { RenderingContext } from 'vs/editor/common/view/renderingContext';
import { ViewContext } from 'vs/editor/common/view/viewContext';
import * as viewEvents from 'vs/editor/common/view/viewEvents';
import { registerThemingParticipant } from 'vs/platform/theme/common/themeService';
import { EditorOption, InternalBracketPairGuideOptions } from 'vs/editor/common/config/editorOptions';
import { Position } from 'vs/editor/common/core/position';
import { IndentGuide } from 'vs/editor/common/model';
import { ArrayQueue } from 'vs/base/common/arrays';

export class IndentGuidesOverlay extends DynamicViewOverlay {

	private readonly _context: ViewContext;
	private _primaryPosition: Position | null;
	private _lineHeight: number;
	private _spaceWidth: number;
	private _renderResult: string[] | null;
	private _indentGuidesEnabled: boolean;
	private _activeIndentEnabled: boolean;
	private _maxIndentLeft: number;
	private _bracketPairGuideOptions: InternalBracketPairGuideOptions;

	constructor(context: ViewContext) {
		super();
		this._context = context;
		this._primaryPosition = null;

		const options = this._context.configuration.options;
		const wrappingInfo = options.get(EditorOption.wrappingInfo);
		const fontInfo = options.get(EditorOption.fontInfo);

		this._lineHeight = options.get(EditorOption.lineHeight);
		this._spaceWidth = fontInfo.spaceWidth;
		this._indentGuidesEnabled = options.get(EditorOption.renderIndentGuides);
		this._activeIndentEnabled = options.get(EditorOption.highlightActiveIndentGuide);
		this._maxIndentLeft = wrappingInfo.wrappingColumn === -1 ? -1 : (wrappingInfo.wrappingColumn * fontInfo.typicalHalfwidthCharacterWidth);
		this._bracketPairGuideOptions = options.get(EditorOption.bracketPairGuides);

		this._renderResult = null;

		this._context.addEventHandler(this);
	}

	public override dispose(): void {
		this._context.removeEventHandler(this);
		this._renderResult = null;
		super.dispose();
	}

	// --- begin event handlers

	public override onConfigurationChanged(e: viewEvents.ViewConfigurationChangedEvent): boolean {
		const options = this._context.configuration.options;
		const wrappingInfo = options.get(EditorOption.wrappingInfo);
		const fontInfo = options.get(EditorOption.fontInfo);

		this._lineHeight = options.get(EditorOption.lineHeight);
		this._spaceWidth = fontInfo.spaceWidth;
		this._indentGuidesEnabled = options.get(EditorOption.renderIndentGuides);
		this._activeIndentEnabled = options.get(EditorOption.highlightActiveIndentGuide);
		this._maxIndentLeft = wrappingInfo.wrappingColumn === -1 ? -1 : (wrappingInfo.wrappingColumn * fontInfo.typicalHalfwidthCharacterWidth);
		this._bracketPairGuideOptions = options.get(EditorOption.bracketPairGuides);

		return true;
	}
	public override onCursorStateChanged(e: viewEvents.ViewCursorStateChangedEvent): boolean {
		const selection = e.selections[0];
		const newPosition = selection.getStartPosition();
		if (!this._primaryPosition?.equals(newPosition)) {
			this._primaryPosition = newPosition;
			return true;
		}

		return false;
	}
	public override onDecorationsChanged(e: viewEvents.ViewDecorationsChangedEvent): boolean {
		// true for inline decorations
		return true;
	}
	public override onFlushed(e: viewEvents.ViewFlushedEvent): boolean {
		return true;
	}
	public override onLinesChanged(e: viewEvents.ViewLinesChangedEvent): boolean {
		return true;
	}
	public override onLinesDeleted(e: viewEvents.ViewLinesDeletedEvent): boolean {
		return true;
	}
	public override onLinesInserted(e: viewEvents.ViewLinesInsertedEvent): boolean {
		return true;
	}
	public override onScrollChanged(e: viewEvents.ViewScrollChangedEvent): boolean {
		return e.scrollTopChanged;// || e.scrollWidthChanged;
	}
	public override onZonesChanged(e: viewEvents.ViewZonesChangedEvent): boolean {
		return true;
	}
	public override onLanguageConfigurationChanged(e: viewEvents.ViewLanguageConfigurationEvent): boolean {
		return true;
	}

	// --- end event handlers

	public prepareRender(ctx: RenderingContext): void {
		if (!this._indentGuidesEnabled && !this._bracketPairGuideOptions.enabled) {
			this._renderResult = null;
			return;
		}

		const visibleStartLineNumber = ctx.visibleRange.startLineNumber;
		const visibleEndLineNumber = ctx.visibleRange.endLineNumber;
		const scrollWidth = ctx.scrollWidth;
		const lineHeight = this._lineHeight;

		const activeCursorPosition = this._primaryPosition;

		const indents = this.getGuidesByLine(
			visibleStartLineNumber,
			visibleEndLineNumber,
			activeCursorPosition
		);

		const output: string[] = [];
		for (let lineNumber = visibleStartLineNumber; lineNumber <= visibleEndLineNumber; lineNumber++) {
			const lineIndex = lineNumber - visibleStartLineNumber;
			const indent = indents[lineIndex];
			let result = '';
			const leftOffset = ctx.visibleRangeForPosition(new Position(lineNumber, 1))?.left ?? 0;
			for (const guide of indent) {
				const left = leftOffset + (guide.visibleColumn - 1) * this._spaceWidth;
				if (left > scrollWidth || (this._maxIndentLeft > 0 && left > this._maxIndentLeft)) {
					break;
				}
				result += `<div class="core-guide ${guide.className}" style="left:${left}px;height:${lineHeight}px;width:${this._spaceWidth}px"></div>`;
			}
			output[lineIndex] = result;
		}
		this._renderResult = output;
	}

	private getGuidesByLine(
		visibleStartLineNumber: number,
		visibleEndLineNumber: number,
		activeCursorPosition: Position | null
	): IndentGuide[][] {
		const bracketGuides = this._bracketPairGuideOptions.enabled
			? this._context.model.getBracketGuidesInRangeByLine(
				visibleStartLineNumber,
				visibleEndLineNumber,
				activeCursorPosition,
				true,
				true
			)
			: null;

		const indentGuides = this._indentGuidesEnabled
			? this._context.model.getLinesIndentGuides(
				visibleStartLineNumber,
				visibleEndLineNumber
			)
			: null;

		let activeIndentStartLineNumber = 0;
		let activeIndentEndLineNumber = 0;
		let activeIndentLevel = 0;
		if (this._activeIndentEnabled && activeCursorPosition) {
			const activeIndentInfo = this._context.model.getActiveIndentGuide(activeCursorPosition.lineNumber, visibleStartLineNumber, visibleEndLineNumber);
			activeIndentStartLineNumber = activeIndentInfo.startLineNumber;
			activeIndentEndLineNumber = activeIndentInfo.endLineNumber;
			activeIndentLevel = activeIndentInfo.indent;
		}

		const { indentSize } = this._context.model.getTextModelOptions();

		const result: IndentGuide[][] = [];
		for (let lineNumber = visibleStartLineNumber; lineNumber <= visibleEndLineNumber; lineNumber++) {
			const lineGuides = new Array<IndentGuide>();
			result.push(lineGuides);

			const bracketGuidesInLine = bracketGuides ? bracketGuides[lineNumber - visibleStartLineNumber] : [];
			const bracketGuidesInLineQueue = new ArrayQueue(bracketGuidesInLine);

			const indentGuidesInLine = indentGuides ? indentGuides[lineNumber - visibleStartLineNumber] : [];

			for (let indentLvl = 1; indentLvl <= indentGuidesInLine; indentLvl++) {
				const indentGuide = (indentLvl - 1) * indentSize + 1;
				const isActive =
					// Disable active indent guide if there are bracket guides.
					bracketGuidesInLine.length === 0 &&
					activeIndentStartLineNumber <= lineNumber &&
					lineNumber <= activeIndentEndLineNumber &&
					indentLvl === activeIndentLevel;
				lineGuides.push(...bracketGuidesInLineQueue.takeWhile(g => g.visibleColumn < indentGuide) || []);
				if (bracketGuidesInLineQueue.peek()?.visibleColumn !== indentGuide) {
					lineGuides.push(new IndentGuide(indentGuide, isActive ? 'core-guide-indent-active' : 'core-guide-indent'));
				}
			}

			lineGuides.push(...bracketGuidesInLineQueue.takeWhile(g => true) || []);
		}

		return result;
	}

	public render(startLineNumber: number, lineNumber: number): string {
		if (!this._renderResult) {
			return '';
		}
		const lineIndex = lineNumber - startLineNumber;
		if (lineIndex < 0 || lineIndex >= this._renderResult.length) {
			return '';
		}
		return this._renderResult[lineIndex];
	}
}

registerThemingParticipant((theme, collector) => {
	const editorIndentGuidesColor = theme.getColor(editorIndentGuides);
	if (editorIndentGuidesColor) {
		collector.addRule(`.monaco-editor .lines-content .core-guide-indent { box-shadow: 1px 0 0 0 ${editorIndentGuidesColor} inset; }`);
	}
	const editorActiveIndentGuidesColor = theme.getColor(editorActiveIndentGuides) || editorIndentGuidesColor;
	if (editorActiveIndentGuidesColor) {
		collector.addRule(`.monaco-editor .lines-content .core-guide-indent-active { box-shadow: 1px 0 0 0 ${editorActiveIndentGuidesColor} inset; }`);
	}
});
