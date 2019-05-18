(() => {
    console.log('running content.js');
    let injected = false;

    const port = chrome.runtime.connect(null, { name: 'tab-column-formatting' });

    port.onMessage.addListener(async (message, port) => {
        if (message.type === 'refresh_preview') {
            await refreshPreview(message);
        }
    });

    async function refreshPreview(data: any) {
        console.log('received refresh command');
        if (!injected) {
            injected = true;

            await injectScriptFile('dist/monaco-build.js');
            await injectScriptFile('dist/inject.js');
        }
        executeRefresh(data);
    }

    function executeRefresh(data: any) {
        window.postMessage({ fieldInternalName: data.fieldInternalName, name: 'column_formatting', type: data.type, jsonFormatting: data.jsonFormatting }, location.origin);
    }

    function injectScriptFile(src: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const scriptTag = document.createElement('script');
            scriptTag.src = src.startsWith('http') ? src : chrome.runtime.getURL(src);

            scriptTag.onload = function () {
                console.log('loaded!! ' + src);
                resolve();
            };

            (document.head || document.documentElement).appendChild(scriptTag);
        });
    }
})();
