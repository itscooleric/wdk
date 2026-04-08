/**
 * SharePoint Document Library Browser
 * Browse doc libraries, navigate folders, preview metadata, download files.
 * Zero external dependencies.
 */

/* global spFetch, spFetchWithRetry, spParseError, spCreateErrorDisplay */

/**
 * Get all document libraries from a SharePoint site.
 *
 * @param {string} siteUrl
 * @returns {Promise<Array<{title: string, id: string, itemCount: number, rootFolder: string}>>}
 */
export async function spGetDocLibraries(siteUrl) {
  var resp = await spFetchWithRetry(
    siteUrl + "/_api/web/lists?$filter=BaseTemplate eq 101 and Hidden eq false&$select=Title,Id,ItemCount,RootFolder/ServerRelativeUrl&$expand=RootFolder",
    { siteUrl: siteUrl }
  );

  if (!resp.ok) {
    var err = await spParseError(resp);
    throw new Error(err.message);
  }

  var data = await resp.json();
  var results = data.d ? data.d.results : data.value;

  return results.map(function(lib) {
    return {
      title: lib.Title,
      id: lib.Id || lib.ID,
      itemCount: lib.ItemCount,
      rootFolder: lib.RootFolder ? (lib.RootFolder.ServerRelativeUrl || lib.RootFolder.serverRelativeUrl) : ''
    };
  });
}

/**
 * Get contents of a folder (subfolders and files).
 *
 * @param {string} siteUrl
 * @param {string} folderPath - Server-relative folder path
 * @returns {Promise<{folders: object[], files: object[]}>}
 */
export async function spGetFolderContents(siteUrl, folderPath) {
  var encodedPath = encodeURIComponent(folderPath);

  var foldersResp = await spFetchWithRetry(
    siteUrl + "/_api/web/GetFolderByServerRelativeUrl('" + encodedPath + "')/Folders?$select=Name,ServerRelativeUrl,ItemCount,TimeLastModified&$orderby=Name",
    { siteUrl: siteUrl }
  );

  var filesResp = await spFetchWithRetry(
    siteUrl + "/_api/web/GetFolderByServerRelativeUrl('" + encodedPath + "')/Files?$select=Name,ServerRelativeUrl,Length,TimeLastModified,Author/Title&$expand=Author&$orderby=Name",
    { siteUrl: siteUrl }
  );

  var folders = [];
  var files = [];

  if (foldersResp.ok) {
    var fData = await foldersResp.json();
    var fResults = fData.d ? fData.d.results : fData.value;
    folders = fResults
      .filter(function(f) { return f.Name !== 'Forms'; })
      .map(function(f) {
        return {
          name: f.Name,
          path: f.ServerRelativeUrl,
          itemCount: f.ItemCount,
          modified: f.TimeLastModified
        };
      });
  }

  if (filesResp.ok) {
    var fileData = await filesResp.json();
    var fileResults = fileData.d ? fileData.d.results : fileData.value;
    files = fileResults.map(function(f) {
      return {
        name: f.Name,
        path: f.ServerRelativeUrl,
        size: parseInt(f.Length, 10) || 0,
        modified: f.TimeLastModified,
        author: f.Author ? f.Author.Title : ''
      };
    });
  }

  return { folders: folders, files: files };
}

/**
 * Get detailed file metadata including version history.
 *
 * @param {string} siteUrl
 * @param {string} fileUrl - Server-relative file URL
 * @returns {Promise<object>}
 */
export async function spGetFileMetadata(siteUrl, fileUrl) {
  var encodedUrl = encodeURIComponent(fileUrl);
  var resp = await spFetchWithRetry(
    siteUrl + "/_api/web/GetFileByServerRelativeUrl('" + encodedUrl + "')?$select=Name,ServerRelativeUrl,Length,TimeCreated,TimeLastModified,CheckOutType,MajorVersion,MinorVersion,UIVersionLabel,Author/Title,ModifiedBy/Title&$expand=Author,ModifiedBy",
    { siteUrl: siteUrl }
  );

  if (!resp.ok) {
    var err = await spParseError(resp);
    throw new Error(err.message);
  }

  var data = await resp.json();
  var file = data.d || data;

  return {
    name: file.Name,
    path: file.ServerRelativeUrl,
    size: parseInt(file.Length, 10) || 0,
    created: file.TimeCreated,
    modified: file.TimeLastModified,
    version: file.UIVersionLabel || (file.MajorVersion + '.' + file.MinorVersion),
    checkedOut: file.CheckOutType !== 2, // 2 = None
    author: file.Author ? file.Author.Title : '',
    modifiedBy: file.ModifiedBy ? file.ModifiedBy.Title : ''
  };
}

/**
 * Download a file from SharePoint.
 *
 * @param {string} siteUrl
 * @param {string} fileUrl - Server-relative file URL
 * @param {string} [fileName] - Override download filename
 */
export async function spDownloadFile(siteUrl, fileUrl, fileName) {
  var encodedUrl = encodeURIComponent(fileUrl);
  var resp = await spFetch(
    siteUrl + "/_api/web/GetFileByServerRelativeUrl('" + encodedUrl + "')/$value",
    { siteUrl: siteUrl }
  );

  if (!resp.ok) {
    var err = await spParseError(resp);
    throw new Error(err.message);
  }

  var blob = await resp.blob();
  var name = fileName || fileUrl.split('/').pop();
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
}

/**
 * Format file size for display.
 * @param {number} bytes
 * @returns {string}
 */
function _formatSize(bytes) {
  if (bytes === 0) return '0 B';
  var units = ['B', 'KB', 'MB', 'GB'];
  var i = Math.floor(Math.log(bytes) / Math.log(1024));
  i = Math.min(i, units.length - 1);
  return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
}

/**
 * Get file extension for icon display.
 * @param {string} name
 * @returns {string}
 */
function _getFileIcon(name) {
  var ext = (name.split('.').pop() || '').toLowerCase();
  var icons = {
    pdf: '\uD83D\uDCC4', doc: '\uD83D\uDCC3', docx: '\uD83D\uDCC3',
    xls: '\uD83D\uDCCA', xlsx: '\uD83D\uDCCA', ppt: '\uD83D\uDCCA', pptx: '\uD83D\uDCCA',
    jpg: '\uD83D\uDDBC', jpeg: '\uD83D\uDDBC', png: '\uD83D\uDDBC', gif: '\uD83D\uDDBC',
    zip: '\uD83D\uDCE6', rar: '\uD83D\uDCE6',
    txt: '\uD83D\uDCC4', csv: '\uD83D\uDCC4', json: '\uD83D\uDCC4'
  };
  return icons[ext] || '\uD83D\uDCC4';
}

/**
 * Render the document library browser UI.
 *
 * @param {HTMLElement} container
 * @param {string} siteUrl
 */
export function spCreateDocBrowserUI(container, siteUrl) {
  var cyan = '#00e5ff';
  var pink = '#ff2975';
  var purple = '#b967ff';
  var bg = '#12122a';
  var bgDark = '#0a0a1a';
  var bgHover = '#1a1a3a';
  var border = '#2a2a4a';
  var text = '#e0e0f0';
  var textDim = '#8888aa';

  var wrapper = document.createElement('div');
  wrapper.style.cssText = 'padding:16px;';

  // Header
  var header = document.createElement('div');
  header.style.cssText = 'font-size:14px;font-weight:700;color:' + cyan + ';margin-bottom:12px;letter-spacing:1px;';
  header.textContent = 'Document Libraries';
  wrapper.appendChild(header);

  // Library selector
  var libRow = document.createElement('div');
  libRow.style.cssText = 'display:flex;gap:8px;align-items:center;margin-bottom:12px;';

  var libSelect = document.createElement('select');
  libSelect.style.cssText = 'flex:1;padding:6px 10px;background:' + bgDark + ';border:1px solid ' + border + ';border-radius:4px;color:' + text + ';font-family:inherit;font-size:12px;';
  libSelect.innerHTML = '<option value="">Loading libraries...</option>';
  libRow.appendChild(libSelect);
  wrapper.appendChild(libRow);

  // Breadcrumb
  var breadcrumb = document.createElement('div');
  breadcrumb.style.cssText = 'display:none;margin-bottom:8px;font-size:11px;color:' + textDim + ';';
  wrapper.appendChild(breadcrumb);

  // Up button
  var upBtn = document.createElement('button');
  upBtn.textContent = '\u2191 Up';
  upBtn.style.cssText = 'display:none;padding:3px 10px;background:transparent;border:1px solid ' + border + ';border-radius:3px;color:' + textDim + ';font-family:inherit;font-size:10px;cursor:pointer;margin-bottom:8px;';
  wrapper.appendChild(upBtn);

  // File list
  var fileList = document.createElement('div');
  fileList.style.cssText = 'border:1px solid ' + border + ';border-radius:6px;overflow:hidden;';
  wrapper.appendChild(fileList);

  // Metadata panel (shown on file click)
  var metaPanel = document.createElement('div');
  metaPanel.style.cssText = 'display:none;margin-top:8px;padding:10px;background:' + bg + ';border:1px solid ' + border + ';border-radius:6px;font-size:11px;';
  wrapper.appendChild(metaPanel);

  // Error container
  var errorContainer = document.createElement('div');
  wrapper.appendChild(errorContainer);

  // State
  var libraries = [];
  var currentPath = '';
  var pathHistory = [];

  // Load libraries
  spGetDocLibraries(siteUrl).then(function(libs) {
    libraries = libs;
    libSelect.innerHTML = '<option value="">— Select library (' + libs.length + ') —</option>';
    libs.forEach(function(lib) {
      var opt = document.createElement('option');
      opt.value = lib.rootFolder;
      opt.textContent = lib.title + ' (' + lib.itemCount + ' items)';
      libSelect.appendChild(opt);
    });
  }).catch(function(err) {
    libSelect.innerHTML = '<option value="">Error loading libraries</option>';
    spCreateErrorDisplay(errorContainer, { message: err.message });
  });

  function updateBreadcrumb(path) {
    breadcrumb.style.display = 'block';
    var parts = path.split('/').filter(function(p) { return p; });
    breadcrumb.innerHTML = '';

    parts.forEach(function(part, idx) {
      if (idx > 0) {
        var sep = document.createElement('span');
        sep.textContent = ' / ';
        sep.style.color = textDim;
        breadcrumb.appendChild(sep);
      }
      var link = document.createElement('span');
      link.textContent = part;
      link.style.cssText = 'cursor:pointer;color:' + (idx === parts.length - 1 ? text : cyan) + ';';
      if (idx < parts.length - 1) {
        var targetPath = '/' + parts.slice(0, idx + 1).join('/');
        link.addEventListener('click', function() { navigateTo(targetPath); });
      }
      breadcrumb.appendChild(link);
    });
  }

  function navigateTo(folderPath) {
    currentPath = folderPath;
    upBtn.style.display = 'inline-block';
    updateBreadcrumb(folderPath);
    metaPanel.style.display = 'none';

    fileList.innerHTML = '<div style="padding:10px;color:' + textDim + ';font-size:11px;">Loading...</div>';

    spGetFolderContents(siteUrl, folderPath).then(function(contents) {
      renderContents(contents);
    }).catch(function(err) {
      fileList.innerHTML = '';
      spCreateErrorDisplay(errorContainer, { message: err.message });
    });
  }

  function renderContents(contents) {
    fileList.innerHTML = '';

    // Header row
    var headerRow = document.createElement('div');
    headerRow.style.cssText = 'display:grid;grid-template-columns:1fr 80px 140px 120px 40px;padding:6px 10px;background:' + bgDark + ';border-bottom:1px solid ' + border + ';font-size:10px;color:' + textDim + ';font-weight:600;';
    headerRow.innerHTML = '<div>Name</div><div>Size</div><div>Modified</div><div>Author</div><div></div>';
    fileList.appendChild(headerRow);

    if (contents.folders.length === 0 && contents.files.length === 0) {
      var empty = document.createElement('div');
      empty.style.cssText = 'padding:20px;text-align:center;color:' + textDim + ';font-size:11px;';
      empty.textContent = 'Empty folder';
      fileList.appendChild(empty);
      return;
    }

    // Folders
    contents.folders.forEach(function(folder) {
      var row = document.createElement('div');
      row.style.cssText = 'display:grid;grid-template-columns:1fr 80px 140px 120px 40px;padding:5px 10px;border-bottom:1px solid ' + border + ';font-size:11px;cursor:pointer;align-items:center;';
      row.addEventListener('mouseenter', function() { row.style.background = bgHover; });
      row.addEventListener('mouseleave', function() { row.style.background = 'transparent'; });

      row.innerHTML = '<div style="color:' + cyan + ';">\uD83D\uDCC1 ' + folder.name + '</div>'
        + '<div style="color:' + textDim + ';">' + (folder.itemCount || '') + ' items</div>'
        + '<div style="color:' + textDim + ';">' + _formatDate(folder.modified) + '</div>'
        + '<div></div><div></div>';

      row.addEventListener('click', function() {
        pathHistory.push(currentPath);
        navigateTo(folder.path);
      });

      fileList.appendChild(row);
    });

    // Files
    contents.files.forEach(function(file) {
      var row = document.createElement('div');
      row.style.cssText = 'display:grid;grid-template-columns:1fr 80px 140px 120px 40px;padding:5px 10px;border-bottom:1px solid ' + border + ';font-size:11px;align-items:center;';
      row.addEventListener('mouseenter', function() { row.style.background = bgHover; });
      row.addEventListener('mouseleave', function() { row.style.background = 'transparent'; });

      var nameCell = document.createElement('div');
      nameCell.style.cssText = 'color:' + text + ';cursor:pointer;';
      nameCell.textContent = _getFileIcon(file.name) + ' ' + file.name;
      nameCell.addEventListener('click', function() { showMetadata(file); });

      var sizeCell = document.createElement('div');
      sizeCell.style.cssText = 'color:' + textDim + ';';
      sizeCell.textContent = _formatSize(file.size);

      var modCell = document.createElement('div');
      modCell.style.cssText = 'color:' + textDim + ';';
      modCell.textContent = _formatDate(file.modified);

      var authorCell = document.createElement('div');
      authorCell.style.cssText = 'color:' + textDim + ';';
      authorCell.textContent = file.author;

      var dlCell = document.createElement('div');
      var dlBtn = document.createElement('button');
      dlBtn.textContent = '\u2B07';
      dlBtn.title = 'Download';
      dlBtn.style.cssText = 'padding:2px 6px;background:transparent;border:1px solid ' + border + ';border-radius:3px;color:' + cyan + ';font-size:12px;cursor:pointer;';
      dlBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        spDownloadFile(siteUrl, file.path, file.name).catch(function(err) {
          spCreateErrorDisplay(errorContainer, { message: err.message });
        });
      });
      dlCell.appendChild(dlBtn);

      row.appendChild(nameCell);
      row.appendChild(sizeCell);
      row.appendChild(modCell);
      row.appendChild(authorCell);
      row.appendChild(dlCell);
      fileList.appendChild(row);
    });
  }

  function showMetadata(file) {
    metaPanel.style.display = 'block';
    metaPanel.innerHTML = '<div style="color:' + textDim + ';">Loading metadata...</div>';

    spGetFileMetadata(siteUrl, file.path).then(function(meta) {
      metaPanel.innerHTML = '<div style="font-weight:600;color:' + purple + ';margin-bottom:6px;">' + meta.name + '</div>'
        + '<div style="display:grid;grid-template-columns:100px 1fr;gap:2px 8px;">'
        + '<span style="color:' + textDim + ';">Size</span><span style="color:' + text + ';">' + _formatSize(meta.size) + '</span>'
        + '<span style="color:' + textDim + ';">Version</span><span style="color:' + text + ';">' + meta.version + '</span>'
        + '<span style="color:' + textDim + ';">Created</span><span style="color:' + text + ';">' + _formatDate(meta.created) + '</span>'
        + '<span style="color:' + textDim + ';">Modified</span><span style="color:' + text + ';">' + _formatDate(meta.modified) + '</span>'
        + '<span style="color:' + textDim + ';">Author</span><span style="color:' + text + ';">' + meta.author + '</span>'
        + '<span style="color:' + textDim + ';">Modified by</span><span style="color:' + text + ';">' + meta.modifiedBy + '</span>'
        + '<span style="color:' + textDim + ';">Checked out</span><span style="color:' + (meta.checkedOut ? pink : text) + ';">' + (meta.checkedOut ? 'Yes' : 'No') + '</span>'
        + '</div>';
    }).catch(function(err) {
      metaPanel.innerHTML = '<div style="color:' + pink + ';">' + err.message + '</div>';
    });
  }

  // Library select handler
  libSelect.addEventListener('change', function() {
    var rootFolder = libSelect.value;
    if (!rootFolder) return;
    pathHistory = [];
    navigateTo(rootFolder);
  });

  // Up button
  upBtn.addEventListener('click', function() {
    if (pathHistory.length > 0) {
      var prev = pathHistory.pop();
      navigateTo(prev);
    } else {
      // Go up by trimming last path segment
      var parent = currentPath.replace(/\/[^\/]+$/, '');
      if (parent && parent !== currentPath) {
        navigateTo(parent);
      }
    }
  });

  container.appendChild(wrapper);
}

/**
 * Format ISO date for display.
 * @param {string} dateStr
 * @returns {string}
 */
function _formatDate(dateStr) {
  if (!dateStr) return '';
  try {
    var d = new Date(dateStr);
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch (e) {
    return dateStr;
  }
}
