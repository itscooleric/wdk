/**
 * ASPX Application Page Template Generator
 * For on-prem SharePoint 2013+ farm admin deployment via _layouts.
 * Zero external dependencies.
 */

/**
 * Generate an ASPX application page template.
 *
 * @param {object} [options]
 * @param {string} [options.title='WDK'] - Page title
 * @param {string} [options.masterPage='~masterurl/default.master'] - Master page reference
 * @param {boolean} [options.includeRibbon=false] - Include ribbon placeholder
 * @param {boolean} [options.includeCodeBehind=true] - Include code-behind reference
 * @returns {string} Complete .aspx file content
 */
export function aspxGetTemplate(options) {
  options = options || {};
  var pageTitle = options.title || 'WDK';
  var masterPage = options.masterPage || '~masterurl/default.master';
  var includeRibbon = options.includeRibbon || false;
  var includeCodeBehind = options.includeCodeBehind !== false;

  var lines = [];

  // Page directive
  if (includeCodeBehind) {
    lines.push('<%@ Page Language="C#" AutoEventWireup="true"');
    lines.push('    CodeBehind="' + pageTitle.replace(/\s+/g, '') + '.aspx.cs"');
    lines.push('    Inherits="WDK.Layouts.' + pageTitle.replace(/\s+/g, '') + 'Page"');
    lines.push('    MasterPageFile="' + masterPage + '"');
    lines.push('    DynamicMasterPageFile="' + masterPage + '" %>');
  } else {
    lines.push('<%@ Page Language="C#" AutoEventWireup="true"');
    lines.push('    MasterPageFile="' + masterPage + '"');
    lines.push('    DynamicMasterPageFile="' + masterPage + '" %>');
  }

  lines.push('');
  lines.push('<%@ Assembly Name="Microsoft.SharePoint, Version=15.0.0.0, Culture=neutral, PublicKeyToken=71e9bce111e9429c" %>');
  lines.push('<%@ Import Namespace="Microsoft.SharePoint" %>');
  lines.push('<%@ Import Namespace="Microsoft.SharePoint.WebControls" %>');
  lines.push('');

  // Page title
  lines.push('<asp:Content ID="PageTitle" ContentPlaceHolderID="PlaceHolderPageTitle" runat="server">');
  lines.push('    ' + pageTitle);
  lines.push('</asp:Content>');
  lines.push('');

  // Page title in title area
  lines.push('<asp:Content ID="PageTitleInTitleArea" ContentPlaceHolderID="PlaceHolderPageTitleInTitleArea" runat="server">');
  lines.push('    ' + pageTitle);
  lines.push('</asp:Content>');
  lines.push('');

  // Ribbon (optional)
  if (includeRibbon) {
    lines.push('<asp:Content ID="PageRibbon" ContentPlaceHolderID="PlaceHolderAdditionalPageHead" runat="server">');
    lines.push('    <!-- Additional page head content (scripts, styles) -->');
    lines.push('</asp:Content>');
    lines.push('');
  }

  // Main content
  lines.push('<asp:Content ID="Main" ContentPlaceHolderID="PlaceHolderMain" runat="server">');
  lines.push('');
  lines.push('    <!-- WDK Application Container -->');
  lines.push('    <div id="wdk-root" style="width:100%;min-height:600px;"></div>');
  lines.push('');

  if (includeCodeBehind) {
    lines.push('    <!-- Server-side data injection (populated by code-behind) -->');
    lines.push('    <asp:HiddenField ID="hdnSiteUrl" runat="server" />');
    lines.push('    <asp:HiddenField ID="hdnUserName" runat="server" />');
    lines.push('    <asp:HiddenField ID="hdnListData" runat="server" />');
    lines.push('');
  }

  lines.push('    <!-- Inline WDK bundle -->');
  lines.push('    <script type="text/javascript">');
  lines.push('        // Paste the contents of dist/wiz.js here');
  lines.push('        // Or reference as: <script src="/_layouts/15/WDK/wiz.js"><\/' + 'script>');
  lines.push('    <\/' + 'script>');
  lines.push('');

  if (includeCodeBehind) {
    lines.push('    <script type="text/javascript">');
    lines.push('        // Read server-side injected data');
    lines.push('        (function() {');
    lines.push('            var siteUrl = document.getElementById("<%= hdnSiteUrl.ClientID %>").value;');
    lines.push('            var userName = document.getElementById("<%= hdnUserName.ClientID %>").value;');
    lines.push('            var listData = document.getElementById("<%= hdnListData.ClientID %>").value;');
    lines.push('            if (listData) {');
    lines.push('                try { window.__wdkServerData = JSON.parse(listData); }');
    lines.push('                catch(e) { console.warn("WDK: Could not parse server data"); }');
    lines.push('            }');
    lines.push('            window.__wdkSiteUrl = siteUrl;');
    lines.push('            window.__wdkUserName = userName;');
    lines.push('        })();');
    lines.push('    <\/' + 'script>');
    lines.push('');
  }

  lines.push('    <!--');
  lines.push('    DEPLOYMENT:');
  lines.push('    1. Build the WDK bundle: node build.js');
  lines.push('    2. Copy this .aspx (and .aspx.cs if using code-behind) to:');
  lines.push('       C:\\Program Files\\Common Files\\microsoft shared\\Web Server Extensions\\15\\TEMPLATE\\LAYOUTS\\WDK\\');
  lines.push('    3. For SP 2016/2019, use "16" instead of "15" in the path');
  lines.push('    4. Run iisreset');
  lines.push('    5. Access at: https://your-site/_layouts/15/WDK/' + pageTitle.replace(/\s+/g, '') + '.aspx');
  lines.push('    -->');
  lines.push('');
  lines.push('</asp:Content>');

  return lines.join('\n');
}

/**
 * Generate a C# code-behind template.
 *
 * @param {object} [options]
 * @param {string} [options.title='WDK'] - Page title (used for class name)
 * @param {boolean} [options.includeListRead=true] - Include example list data read
 * @returns {string} Complete .aspx.cs file content
 */
export function aspxGetCodeBehind(options) {
  options = options || {};
  var className = (options.title || 'WDK').replace(/\s+/g, '') + 'Page';
  var includeListRead = options.includeListRead !== false;

  var lines = [];

  lines.push('using System;');
  lines.push('using System.Web.Script.Serialization;');
  lines.push('using Microsoft.SharePoint;');
  lines.push('using Microsoft.SharePoint.WebControls;');
  lines.push('');
  lines.push('namespace WDK.Layouts');
  lines.push('{');
  lines.push('    /// <summary>');
  lines.push('    /// WDK application page code-behind.');
  lines.push('    /// Provides server-side data injection for the client-side WDK toolkit.');
  lines.push('    /// </summary>');
  lines.push('    public partial class ' + className + ' : LayoutsPageBase');
  lines.push('    {');
  lines.push('        protected void Page_Load(object sender, EventArgs e)');
  lines.push('        {');
  lines.push('            if (!IsPostBack)');
  lines.push('            {');
  lines.push('                // Inject site URL and current user');
  lines.push('                hdnSiteUrl.Value = SPContext.Current.Web.Url;');
  lines.push('                hdnUserName.Value = SPContext.Current.Web.CurrentUser.Name;');

  if (includeListRead) {
    lines.push('');
    lines.push('                // Example: pre-load list data server-side');
    lines.push('                // This runs with elevated privileges for full API access');
    lines.push('                SPSecurity.RunWithElevatedPrivileges(delegate()');
    lines.push('                {');
    lines.push('                    using (SPSite site = new SPSite(SPContext.Current.Site.ID))');
    lines.push('                    using (SPWeb web = site.OpenWeb(SPContext.Current.Web.ID))');
    lines.push('                    {');
    lines.push('                        // Example: read a list and serialize to JSON');
    lines.push('                        SPList list = web.Lists.TryGetList("YourListName");');
    lines.push('                        if (list != null)');
    lines.push('                        {');
    lines.push('                            var items = new System.Collections.Generic.List<object>();');
    lines.push('                            foreach (SPListItem item in list.Items)');
    lines.push('                            {');
    lines.push('                                items.Add(new');
    lines.push('                                {');
    lines.push('                                    Id = item.ID,');
    lines.push('                                    Title = item.Title,');
    lines.push('                                    // Add more fields as needed');
    lines.push('                                });');
    lines.push('                            }');
    lines.push('');
    lines.push('                            var serializer = new JavaScriptSerializer();');
    lines.push('                            hdnListData.Value = serializer.Serialize(items);');
    lines.push('                        }');
    lines.push('                    }');
    lines.push('                });');
  }

  lines.push('            }');
  lines.push('        }');
  lines.push('    }');
  lines.push('}');

  return lines.join('\n');
}

/**
 * Render the ASPX template generator UI.
 *
 * @param {HTMLElement} container
 */
export function aspxCreateTemplateUI(container) {
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
  title.textContent = 'ASPX Application Page Generator';
  wrapper.appendChild(title);

  // Options form
  var form = document.createElement('div');
  form.style.cssText = 'display:grid;grid-template-columns:120px 1fr;gap:8px 12px;align-items:center;margin-bottom:16px;padding:12px;background:' + bg + ';border:1px solid ' + border + ';border-radius:6px;';

  // Page title
  var titleLabel = document.createElement('label');
  titleLabel.style.cssText = 'font-size:12px;color:' + textDim + ';';
  titleLabel.textContent = 'Page Title';
  form.appendChild(titleLabel);

  var titleInput = document.createElement('input');
  titleInput.type = 'text';
  titleInput.value = 'WDK';
  titleInput.style.cssText = 'padding:5px 10px;background:' + bgDark + ';border:1px solid ' + border + ';border-radius:4px;color:' + text + ';font-family:inherit;font-size:12px;';
  form.appendChild(titleInput);

  // Master page
  var masterLabel = document.createElement('label');
  masterLabel.style.cssText = 'font-size:12px;color:' + textDim + ';';
  masterLabel.textContent = 'Master Page';
  form.appendChild(masterLabel);

  var masterSelect = document.createElement('select');
  masterSelect.style.cssText = 'padding:5px 10px;background:' + bgDark + ';border:1px solid ' + border + ';border-radius:4px;color:' + text + ';font-family:inherit;font-size:12px;';
  var masterPages = [
    { value: '~masterurl/default.master', label: 'default.master (SP 2013)' },
    { value: '~masterurl/custom.master', label: 'seattle.master (SP 2013)' },
    { value: '~site/_catalogs/masterpage/seattle.master', label: 'seattle.master (direct)' },
    { value: '~site/_catalogs/masterpage/oslo.master', label: 'oslo.master' },
    { value: '~masterurl/default.master', label: 'v4.master (SP 2010 compat)' }
  ];
  masterPages.forEach(function(mp) {
    var opt = document.createElement('option');
    opt.value = mp.value;
    opt.textContent = mp.label;
    masterSelect.appendChild(opt);
  });
  form.appendChild(masterSelect);

  // Include ribbon
  var ribbonLabel = document.createElement('label');
  ribbonLabel.style.cssText = 'font-size:12px;color:' + textDim + ';';
  ribbonLabel.textContent = 'Include Ribbon';
  form.appendChild(ribbonLabel);

  var ribbonCheck = document.createElement('input');
  ribbonCheck.type = 'checkbox';
  ribbonCheck.checked = false;
  form.appendChild(ribbonCheck);

  // Include code-behind
  var cbLabel = document.createElement('label');
  cbLabel.style.cssText = 'font-size:12px;color:' + textDim + ';';
  cbLabel.textContent = 'Code-Behind';
  form.appendChild(cbLabel);

  var cbCheck = document.createElement('input');
  cbCheck.type = 'checkbox';
  cbCheck.checked = true;
  form.appendChild(cbCheck);

  wrapper.appendChild(form);

  // Generate button
  var genBtn = document.createElement('button');
  genBtn.textContent = 'Generate';
  genBtn.style.cssText = 'padding:6px 20px;background:linear-gradient(135deg,' + cyan + ',' + purple + ');border:none;border-radius:4px;color:#000;font-family:inherit;font-size:12px;font-weight:700;cursor:pointer;margin-bottom:16px;';
  wrapper.appendChild(genBtn);

  // Preview area
  var previewSection = document.createElement('div');
  previewSection.style.cssText = 'margin-bottom:12px;';

  var previewLabel = document.createElement('div');
  previewLabel.style.cssText = 'font-size:12px;font-weight:600;color:' + purple + ';margin-bottom:6px;';
  previewLabel.textContent = '.aspx Preview';
  previewSection.appendChild(previewLabel);

  var aspxPreview = document.createElement('pre');
  aspxPreview.style.cssText = 'background:' + bgDark + ';border:1px solid ' + border + ';border-radius:4px;padding:10px;font-size:10px;color:' + text + ';overflow:auto;max-height:300px;margin:0;white-space:pre-wrap;';
  previewSection.appendChild(aspxPreview);
  wrapper.appendChild(previewSection);

  // Code-behind preview
  var cbSection = document.createElement('div');
  cbSection.style.cssText = 'margin-bottom:12px;';

  var cbPreviewLabel = document.createElement('div');
  cbPreviewLabel.style.cssText = 'font-size:12px;font-weight:600;color:' + purple + ';margin-bottom:6px;';
  cbPreviewLabel.textContent = '.aspx.cs Preview';
  cbSection.appendChild(cbPreviewLabel);

  var cbPreview = document.createElement('pre');
  cbPreview.style.cssText = aspxPreview.style.cssText;
  cbSection.appendChild(cbPreview);
  wrapper.appendChild(cbSection);

  // Download buttons
  var downloadRow = document.createElement('div');
  downloadRow.style.cssText = 'display:flex;gap:8px;margin-bottom:16px;';

  var dlAspxBtn = document.createElement('button');
  dlAspxBtn.textContent = 'Download .aspx';
  dlAspxBtn.style.cssText = 'padding:5px 14px;background:transparent;border:1px solid ' + cyan + ';border-radius:4px;color:' + cyan + ';font-family:inherit;font-size:11px;cursor:pointer;';
  downloadRow.appendChild(dlAspxBtn);

  var dlCsBtn = document.createElement('button');
  dlCsBtn.textContent = 'Download .aspx.cs';
  dlCsBtn.style.cssText = dlAspxBtn.style.cssText;
  downloadRow.appendChild(dlCsBtn);
  wrapper.appendChild(downloadRow);

  // Deployment instructions
  var deploySection = document.createElement('div');
  deploySection.style.cssText = 'padding:12px;background:' + bg + ';border:1px solid ' + border + ';border-radius:6px;';

  var deployTitle = document.createElement('div');
  deployTitle.style.cssText = 'font-size:12px;font-weight:700;color:' + purple + ';margin-bottom:6px;';
  deployTitle.textContent = 'Deployment Instructions';
  deploySection.appendChild(deployTitle);

  var deployContent = document.createElement('div');
  deployContent.style.cssText = 'font-size:11px;color:' + text + ';line-height:1.6;white-space:pre-wrap;';
  deployContent.textContent = '1. Build WDK: node build.js\n'
    + '2. Copy .aspx and .aspx.cs to:\n'
    + '   SP 2013: C:\\...\\Web Server Extensions\\15\\TEMPLATE\\LAYOUTS\\WDK\\\n'
    + '   SP 2016+: C:\\...\\Web Server Extensions\\16\\TEMPLATE\\LAYOUTS\\WDK\\\n'
    + '3. Run: iisreset\n'
    + '4. Access: https://your-site/_layouts/15/WDK/YourPage.aspx\n'
    + '\n'
    + 'Requirements:\n'
    + '• Farm administrator access\n'
    + '• Server filesystem access (RDP or mapped drive)\n'
    + '• Application page runs with full trust\n'
    + '• SPSecurity.RunWithElevatedPrivileges available';
  deploySection.appendChild(deployContent);
  wrapper.appendChild(deploySection);

  // State
  var currentAspx = '';
  var currentCs = '';

  function generate() {
    var opts = {
      title: titleInput.value || 'WDK',
      masterPage: masterSelect.value,
      includeRibbon: ribbonCheck.checked,
      includeCodeBehind: cbCheck.checked
    };

    currentAspx = aspxGetTemplate(opts);
    aspxPreview.textContent = currentAspx;

    if (cbCheck.checked) {
      currentCs = aspxGetCodeBehind({ title: opts.title });
      cbPreview.textContent = currentCs;
      cbSection.style.display = 'block';
      dlCsBtn.style.display = 'inline-block';
    } else {
      cbSection.style.display = 'none';
      dlCsBtn.style.display = 'none';
      currentCs = '';
    }
  }

  genBtn.addEventListener('click', generate);

  // Auto-generate on load
  generate();

  // Download handlers
  dlAspxBtn.addEventListener('click', function() {
    var name = (titleInput.value || 'WDK').replace(/\s+/g, '') + '.aspx';
    _downloadText(currentAspx, name, 'text/plain');
  });

  dlCsBtn.addEventListener('click', function() {
    var name = (titleInput.value || 'WDK').replace(/\s+/g, '') + '.aspx.cs';
    _downloadText(currentCs, name, 'text/plain');
  });

  container.appendChild(wrapper);
}

/**
 * Download text content as a file.
 * @param {string} content
 * @param {string} filename
 * @param {string} mimeType
 */
function _downloadText(content, filename, mimeType) {
  var blob = new Blob([content], { type: mimeType });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
}
