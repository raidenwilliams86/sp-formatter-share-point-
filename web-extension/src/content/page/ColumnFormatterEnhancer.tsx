import { WebEventEmitter } from '../../common/events/WebEventEmitter';
import { Content } from '../../common/events/Events';
import { IEnabled } from '../../common/data/IEnabled';
import { ContentService } from './services/ContentService';
import { ColumnSchemaUrl, RowSchemaUrl, TileSchemaUrl, ViewSchemaUrl } from '../../common/Consts';
import { DomService, ViewType } from './services/DomService';
import { render, unmountComponentAtNode } from 'react-dom';
import * as React from 'react';
import { FieldSelector } from './components/FieldSelector';
import { IField } from '../../common/data/IField';
import { IViewFormattingSchema } from '../../common/data/IViewFormattingSchema';
import { registerProvider } from './services/ContextCompletionProvider';
import { VscodeService } from './services/VscodeService';
import { Logger } from '../../common/Logger';
import { IFileContent } from '../../common/data/IFileContent';

type MonacoEditor = typeof import('monaco-editor');
type CodeEditor = import('monaco-editor').editor.IStandaloneCodeEditor;

/* eslint-disable-next-line */
const monaco: MonacoEditor = require('../../../app/dist/monaco');

let completionProviderRegistered = false;

export function enableFormatter() {
    const pagePipe = WebEventEmitter.instance;
    const enhancer = new ColumnFormatterEnhancer();

    pagePipe.on<IEnabled>(Content.onToggleEnabledColumngFormatter, async (data) => {
        data.enabled ? enhancer.injectCustomFormatter() : enhancer.destroyFormatter();
    });

    pagePipe.on<IEnabled>(Content.onToggleFullScreenMode, async (data) => {
        enhancer.toggleFullScreen(data.enabled);
    });
}

class ColumnFormatterEnhancer {
    private contentService: ContentService;
    private columnSchema: any;
    private viewSchema: IViewFormattingSchema;
    private schemaProperty = '$schema';
    private spFormatterSchemaUri = 'http://chrome-column-formatting/schema.json';
    private isInFullScreen: boolean;
    private pagePipe: WebEventEmitter;
    private inConnectedMode = false;

    private editor: CodeEditor;
    private resizeObserver: ResizeObserver;

    constructor() {
        this.contentService = new ContentService();
        this.pagePipe = WebEventEmitter.instance;

        this.pagePipe.on<IField>(Content.onSelectField, (field) => {
            this.editor.getModel().applyEdits([{
                range: monaco.Range.fromPositions(this.editor.getPosition()),
                text: `[$${field.InternalName}]`
            }]);

            const container = DomService.getFieldSelector();
            unmountComponentAtNode(container);
            container.remove();
        });

        this.pagePipe.on(Content.onCloseSelectField, () => {
            const container = DomService.getFieldSelector();
            unmountComponentAtNode(container);
            container.remove();
        });

        this.pagePipe.on<IEnabled>(Content.Vscode.onConnected, data => {
            if (!this.editor) return;

            this.inConnectedMode = data.enabled;
            this.editor.updateOptions({ readOnly: data.enabled });
        });

        this.pagePipe.on<IFileContent>(Content.Vscode.onSendFileContent, fileContent => {
            if (!this.editor) return;
            Logger.log('CF: onSendFileContent');
            this.editor.setValue(fileContent.text);
        })
    }

    public destroyFormatter(): void {
        if (!this.editor) return;

        this.editor.onDidDispose(() => {
            this.editor = null;
        });

        this.editor.getModel().dispose();
        this.editor.dispose();
        this.resizeObserver.disconnect();
        VscodeService.instance.disconnect();
    }

    public toggleFullScreen(enable: boolean): void {
        this.isInFullScreen = enable;
        if (!this.editor) return;

        const customizationPaneArea = DomService.getCustomizationPaneArea();
        const monacoElement = DomService.getMonacoEditor();
        const designerArea = DomService.getEditableTextArea();

        if (enable) {

            monacoElement.style.position = 'fixed';
            monacoElement.style.zIndex = '2000';
            monacoElement.style.top = '0';
            monacoElement.style.marginLeft = '-1px';

            this.editor.layout({
                height: window.innerHeight,
                width: customizationPaneArea.offsetWidth
            });
        } else {
            this.editor.layout({
                height: designerArea.offsetHeight - 2,
                width: customizationPaneArea.offsetWidth
            });
            monacoElement.style.position = 'initial';
            monacoElement.style.marginLeft = '0';
        }
    }

    public async injectCustomFormatter(): Promise<void> {
        if (this.editor) return;

        if (!completionProviderRegistered) {
            await registerProvider();
            completionProviderRegistered = true;
        }
        await this.ensureSchemas();

        const designerArea = DomService.getEditableTextArea();
        designerArea.style.position = 'absolute';

        const jsonModel = this.getMonacoJsonValue(designerArea.value);

        const modelUri = monaco.Uri.parse('https://chrome-column-formatting');
        const model = monaco.editor.createModel(jsonModel, 'json', modelUri);
        const schemas = await this.createSchemas(modelUri.toString());

        monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
            validate: true,
            schemas
        });
        const settings = await this.contentService.getExtensionSettings();
        this.editor = monaco.editor.create(designerArea.parentElement, {
            model: model,
            language: 'json',
            theme: settings.useDarkMode ? 'vs-dark' : 'vs',
            folding: true,
            formatOnPaste: true,
            renderIndentGuides: true,
            fixedOverflowWidgets: true,
            lineDecorationsWidth: 0,
            minimap: {
                maxColumn: 80,
                renderCharacters: false
            },
            wordWrap: 'on'
        });

        this.addInsertFieldOption();

        this.editor.getModel().onDidChangeContent(async () => {
            if (this.inConnectedMode) {
                this.dispatchDefaultReactFormatterValue(this.editor.getValue());
            } else {
                await this.syncWithDefaultFormatter();
            }
        });

        const customizationPaneArea = DomService.getCustomizationPaneArea();

        this.resizeObserver = new ResizeObserver(() => {
            if (!this.editor) return;

            this.editor.layout({
                height: this.isInFullScreen ? window.innerHeight : designerArea.offsetHeight - 2,
                width: customizationPaneArea.offsetWidth
            });
        });

        this.resizeObserver.observe(DomService.getRightFilesPane());
        customizationPaneArea.style.overflow = 'hidden';

        // don't wait cause it's event-based
        VscodeService.instance.connect();
    }

    private addInsertFieldOption(): void {
        this.editor.addAction({
            id: 'insert-sp-field',
            label: 'Insert list field',
            keybindings: [
                monaco.KeyMod.CtrlCmd | monaco.KeyCode.F10,
                monaco.KeyMod.chord(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KEY_I, monaco.KeyMod.CtrlCmd | monaco.KeyCode.KEY_F)
            ],
            contextMenuGroupId: 'navigation',
            contextMenuOrder: 1.5,
            run: (editor) => {
                const container = document.createElement('div');
                container.id = DomService.InsertFieldSelector.substr(1);
                container.style.position = 'relative';

                const domElement = DomService.getCustomizationPaneArea();

                domElement.appendChild(container);

                render(<FieldSelector useFullScreen={this.isInFullScreen} width={editor.getScrollWidth()} />, container);

                return null;
            }
        });
    }

    private async createSchemas(fileUri: string): Promise<any[]> {
        const viewType = DomService.getInjectionType();

        if (viewType === ViewType.Column) {

            return [{
                uri: this.spFormatterSchemaUri,
                fileMatch: [fileUri],
                schema: this.columnSchema
            }];
        }

        return [{
            uri: this.spFormatterSchemaUri,
            fileMatch: [fileUri],
            schema: this.viewSchema.view
        }, {
            uri: ColumnSchemaUrl,
            schema: this.columnSchema
        }, {
            uri: TileSchemaUrl,
            schema: this.viewSchema.tile
        },
        {
            uri: RowSchemaUrl,
            schema: this.viewSchema.row
        }];
    }

    private async ensureSchemas(): Promise<void> {
        if (!this.columnSchema) {
            this.columnSchema = await this.contentService.getColumnFormatterSchema();
        }
        if (!this.viewSchema) {
            this.viewSchema = await this.contentService.getViewFormatterSchema();
        }
    }

    private async syncWithDefaultFormatter(): Promise<void> {

        if (!(await this.ensureSchemaRemoved(this.editor.getValue()))) {
            return;
        }

        const value = this.getDefaultEditorValue(this.editor.getValue());
        this.dispatchDefaultReactFormatterValue(value);
    }

    private dispatchDefaultReactFormatterValue(value: string) {
        const designerArea = DomService.getEditableTextArea();
        designerArea.value = value;
        const event = new Event('input', { bubbles: true });
        designerArea.dispatchEvent(event);

        // hack
        const reactHandler = Object.keys(designerArea).filter(k => k.startsWith('__reactEventHandlers'))[0];
        designerArea[reactHandler]['onFocus']();
        designerArea[reactHandler]['onBlur']();
        // end hack

        const previewButton = DomService.resolvePreviewButton();
        previewButton.click();
    }

    private getDefaultEditorValue(initialValue): string {
        if (!initialValue) return initialValue;

        let objectValue: any;
        try {
            objectValue = JSON.parse(initialValue);
        } catch (error) {
            // schema is being edited, most likely it's not a valid JSON at the moment
            // so just skip schema removal and return initial value
            return initialValue;
        }

        if (!objectValue[this.schemaProperty]) {
            const type = DomService.getInjectionType();
            if (type === ViewType.Column) {
                objectValue = {
                    [this.schemaProperty]: ColumnSchemaUrl,
                    ...objectValue
                };
            } else {
                objectValue = {
                    [this.schemaProperty]: ViewSchemaUrl,
                    ...objectValue
                };
            }

            return JSON.stringify(objectValue, null, 2);
        }

        return initialValue;
    }

    private async ensureSchemaRemoved(value: string): Promise<boolean> {
        if (!value) return true;

        const monacoValue = this.getMonacoJsonValue(value);

        if (monacoValue !== value) {
            this.editor.setValue(monacoValue);
            await this.editor.getAction('editor.action.formatDocument').run();
            return false;
        }

        return true;
    }

    private getMonacoJsonValue(initialValue: string): string {
        if (!initialValue) return initialValue;

        let objectValue: any;
        try {
            objectValue = JSON.parse(initialValue);
        } catch (error) {
            // schema is being edited, most likely it's not a valid JSON at the moment
            // so just skip schema removal and return true
            return initialValue;
        }

        if (objectValue[this.schemaProperty]) {
            delete objectValue[this.schemaProperty];

            return JSON.stringify(objectValue, null, 2);
        }

        return initialValue;
    }
}