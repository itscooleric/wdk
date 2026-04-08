/**
 * SPFx Web Part Packaging Helper
 * Manifest generation, config templates, and interactive packaging guide.
 * Zero external dependencies.
 */

/**
 * Generate a UUID v4 for component IDs.
 * @returns {string}
 */
function _spfxUuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    var r = Math.random() * 16 | 0;
    var v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

/**
 * Generate an SPFx web part manifest JSON object.
 *
 * @param {object} [options]
 * @param {string} [options.title='WDK'] - Web part title
 * @param {string} [options.description='Wizard Data Engineering Kit'] - Description
 * @param {string} [options.version='1.0.0'] - Version
 * @param {string} [options.componentId] - Component UUID (auto-generated if omitted)
 * @returns {object} SPFx manifest object
 */
export function spfxGetManifest(options) {
  options = options || {};
  var componentId = options.componentId || _spfxUuid();

  return {
    '$schema': 'https://developer.microsoft.com/json-schemas/spfx/client-side-web-part-manifest.schema.json',
    'id': componentId,
    'alias': (options.title || 'WDK').replace(/\s+/g, '') + 'WebPart',
    'componentType': 'WebPart',
    'version': '*',
    'manifestVersion': 2,
    'requiresCustomScript': false,
    'supportedHosts': ['SharePointWebPart', 'SharePointFullPage'],
    'preconfiguredEntries': [{
      'groupId': '5c03119e-3074-46fd-976b-c60198311f70',
      'group': { 'default': 'Other' },
      'title': { 'default': options.title || 'WDK' },
      'description': { 'default': options.description || "Wizard's Data Engineering Kit — browser-based data toolkit" },
      'officeFabricIconFontName': 'Database',
      'properties': {}
    }]
  };
}

/**
 * Get SPFx configuration files content.
 *
 * @returns {{packageSolution: object, serveJson: object, configJson: object}}
 */
export function spfxGetWebPartConfig() {
  return {
    packageSolution: {
      '$schema': 'https://developer.microsoft.com/json-schemas/spfx-build/package-solution.schema.json',
      'solution': {
        'name': 'wdk-webpart',
        'id': _spfxUuid(),
        'version': '1.0.0.0',
        'includeClientSideAssets': true,
        'isDomainIsolated': false,
        'developer': {
          'name': 'WDK',
          'websiteUrl': '',
          'privacyUrl': '',
          'termsOfUseUrl': '',
          'mpnId': 'Undefined-1.0.0'
        }
      },
      'paths': {
        'zippedPackage': 'solution/wdk-webpart.sppkg'
      }
    },
    serveJson: {
      '$schema': 'https://developer.microsoft.com/json-schemas/core-build/serve.schema.json',
      'port': 4321,
      'https': true,
      'initialPage': 'https://enter-your-SharePoint-site/_layouts/15/workbench.aspx'
    },
    configJson: {
      '$schema': 'https://developer.microsoft.com/json-schemas/spfx-build/config.2.0.schema.json',
      'version': '2.0',
      'bundles': {
        'wdk-web-part': {
          'components': [{
            'entrypoint': './lib/webparts/wdk/WdkWebPart.js',
            'manifest': './src/webparts/wdk/WdkWebPart.manifest.json'
          }]
        }
      },
      'externals': {},
      'localizedResources': {
        'WdkWebPartStrings': 'lib/webparts/wdk/loc/{locale}.js'
      }
    }
  };
}

/**
 * Render an interactive SPFx packaging guide.
 *
 * @param {HTMLElement} container
 */
export function spfxCreatePackagingGuide(container) {
  var cyan = '#00e5ff';
  var pink = '#ff2975';
  var purple = '#b967ff';
  var bg = '#12122a';
  var bgDark = '#0a0a1a';
  var border = '#2a2a4a';
  var text = '#e0e0f0';
  var textDim = '#8888aa';

  var wrapper = document.createElement('div');
  wrapper.style.cssText = 'padding:16px;';

  var title = document.createElement('div');
  title.style.cssText = 'font-size:14px;font-weight:700;color:' + cyan + ';margin-bottom:16px;letter-spacing:1px;';
  title.textContent = 'SPFx Web Part Packaging Guide';
  wrapper.appendChild(title);

  var steps = [
    {
      title: '1. Prerequisites',
      content: 'Install Node.js 18 LTS, Yeoman, and SPFx generator.\nFor air-gapped environments, use the Docker build instead (step 5).',
      code: 'npm install -g yo @microsoft/generator-sharepoint'
    },
    {
      title: '2. Scaffold SPFx Project',
      content: 'Create a new SPFx project that will wrap the WDK bundle.',
      code: 'yo @microsoft/sharepoint --solution-name wdk-webpart --component-type webpart --component-name WDK --framework none --skip-feature-deployment'
    },
    {
      title: '3. Inject WDK Bundle',
      content: 'Copy the built wiz.js into the web part render method. The web part\'s render() should create a container div and inject the WDK IIFE.',
      code: '// In WdkWebPart.ts render():\npublic render(): void {\n  this.domElement.innerHTML = \'<div id="wdk-root"></div>\';\n  // Inject wiz.js content here or load via require\n  const script = document.createElement(\'script\');\n  script.textContent = WDK_BUNDLE; // inlined at build\n  this.domElement.appendChild(script);\n}'
    },
    {
      title: '4. Configure for Air-Gapped Deployment',
      content: 'Set includeClientSideAssets: true in package-solution.json.\nThis bundles all assets inside the .sppkg file — no CDN needed.',
      code: '// config/package-solution.json\n{\n  "solution": {\n    "includeClientSideAssets": true,\n    "skipFeatureDeployment": true\n  }\n}'
    },
    {
      title: '5. Docker Build (Air-Gapped)',
      content: 'Use the provided Dockerfile for consistent builds without local Node.js setup.',
      code: 'docker build -t wdk-spfx .\ndocker run -v $(pwd)/dist:/out wdk-spfx\n# Output: dist/wdk-webpart.sppkg'
    },
    {
      title: '6. Deploy to SharePoint',
      content: 'SP 2019: Upload .sppkg to App Catalog → Site Contents → Add an App.\nSPO: Upload to tenant App Catalog or site-level App Catalog.',
      code: null
    },
    {
      title: 'SP 2019 vs SPO Differences',
      content: '• SP 2019: SPFx 1.4.1 max, no modern pages in some configs, use skipFeatureDeployment\n• SPO: Latest SPFx supported, modern pages, tenant-scoped deployment available\n• Both: includeClientSideAssets=true works for air-gapped',
      code: null
    }
  ];

  steps.forEach(function(step) {
    var section = document.createElement('div');
    section.style.cssText = 'margin-bottom:16px;padding:12px;background:' + bg + ';border:1px solid ' + border + ';border-radius:6px;';

    var stepTitle = document.createElement('div');
    stepTitle.style.cssText = 'font-size:12px;font-weight:700;color:' + purple + ';margin-bottom:6px;';
    stepTitle.textContent = step.title;
    section.appendChild(stepTitle);

    var desc = document.createElement('div');
    desc.style.cssText = 'font-size:11px;color:' + text + ';white-space:pre-wrap;line-height:1.5;';
    desc.textContent = step.content;
    section.appendChild(desc);

    if (step.code) {
      var codeBlock = document.createElement('div');
      codeBlock.style.cssText = 'margin-top:8px;position:relative;';

      var pre = document.createElement('pre');
      pre.style.cssText = 'background:' + bgDark + ';border:1px solid ' + border + ';border-radius:4px;padding:8px 12px;font-size:11px;color:' + cyan + ';overflow-x:auto;margin:0;white-space:pre-wrap;';
      pre.textContent = step.code;
      codeBlock.appendChild(pre);

      var copyBtn = document.createElement('button');
      copyBtn.textContent = 'Copy';
      copyBtn.style.cssText = 'position:absolute;top:4px;right:4px;padding:2px 8px;background:transparent;border:1px solid ' + border + ';border-radius:3px;color:' + textDim + ';font-size:9px;cursor:pointer;';
      copyBtn.addEventListener('click', function() {
        var codeText = pre.textContent;
        if (navigator.clipboard) {
          navigator.clipboard.writeText(codeText).then(function() {
            copyBtn.textContent = 'Copied!';
            setTimeout(function() { copyBtn.textContent = 'Copy'; }, 1500);
          });
        } else {
          // Fallback
          var ta = document.createElement('textarea');
          ta.value = codeText;
          ta.style.cssText = 'position:fixed;left:-9999px;';
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
          copyBtn.textContent = 'Copied!';
          setTimeout(function() { copyBtn.textContent = 'Copy'; }, 1500);
        }
      });
      codeBlock.appendChild(copyBtn);
      section.appendChild(codeBlock);
    }

    wrapper.appendChild(section);
  });

  // Generated manifest preview
  var manifestSection = document.createElement('div');
  manifestSection.style.cssText = 'margin-top:16px;padding:12px;background:' + bg + ';border:1px solid ' + border + ';border-radius:6px;';

  var manifestTitle = document.createElement('div');
  manifestTitle.style.cssText = 'font-size:12px;font-weight:700;color:' + purple + ';margin-bottom:6px;';
  manifestTitle.textContent = 'Generated Manifest';
  manifestSection.appendChild(manifestTitle);

  var manifest = spfxGetManifest();
  var manifestPre = document.createElement('pre');
  manifestPre.style.cssText = 'background:' + bgDark + ';border:1px solid ' + border + ';border-radius:4px;padding:8px 12px;font-size:10px;color:' + text + ';overflow-x:auto;margin:0;max-height:200px;overflow-y:auto;';
  manifestPre.textContent = JSON.stringify(manifest, null, 2);
  manifestSection.appendChild(manifestPre);
  wrapper.appendChild(manifestSection);

  container.appendChild(wrapper);
}
