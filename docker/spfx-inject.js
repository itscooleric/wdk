/**
 * Inject wdk.js into the SPFx web part's render() method.
 * Reads the scaffolded WdkWebPart.ts and replaces the render body
 * with code that loads wdk.js into the web part's DOM element.
 */

var fs = require('fs');
var path = require('path');

var wpDir = '/build/wdk-webpart/src/webparts/wdk';
var wizJs = fs.readFileSync('/build/wdk.js', 'utf8');

// Find the web part TypeScript file
var wpFile = path.join(wpDir, 'WdkWebPart.ts');
if (!fs.existsSync(wpFile)) {
  // Try module variant
  wpFile = path.join(wpDir, 'WdkWebPart.module.ts');
}

if (fs.existsSync(wpFile)) {
  var src = fs.readFileSync(wpFile, 'utf8');

  // Replace the render method to inject wdk.js
  var renderCode = [
    '  public render(): void {',
    '    this.domElement.innerHTML = `<div id="wdk-spfx-root" style="width:100%;height:100%;"></div>`;',
    '    const script = document.createElement("script");',
    '    script.textContent = ' + JSON.stringify(wizJs) + ';',
    '    this.domElement.appendChild(script);',
    '  }',
  ].join('\n');

  // Replace existing render method
  src = src.replace(
    /public render\(\): void \{[\s\S]*?\n  \}/,
    renderCode
  );

  fs.writeFileSync(wpFile, src, 'utf8');
  console.log('Injected wdk.js into ' + wpFile);
} else {
  console.error('Web part file not found at ' + wpDir);
  // Fallback: create a minimal web part
  var fallback = [
    'import { Version } from "@microsoft/sp-core-library";',
    'import { BaseClientSideWebPart } from "@microsoft/sp-webpart-base";',
    '',
    'export default class WdkWebPart extends BaseClientSideWebPart<{}> {',
    '  public render(): void {',
    '    this.domElement.innerHTML = `<div id="wdk-spfx-root"></div>`;',
    '    const s = document.createElement("script");',
    '    s.textContent = ' + JSON.stringify(wizJs) + ';',
    '    this.domElement.appendChild(s);',
    '  }',
    '',
    '  protected get dataVersion(): Version {',
    '    return Version.parse("1.0");',
    '  }',
    '}',
  ].join('\n');

  fs.mkdirSync(wpDir, { recursive: true });
  fs.writeFileSync(path.join(wpDir, 'WdkWebPart.ts'), fallback, 'utf8');
  console.log('Created fallback web part at ' + wpDir);
}
