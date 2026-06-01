/**
 * SharePoint File Upload
 * Upload via REST with support for special characters and chunked upload for large files.
 * Zero external dependencies.
 */

/* global spFetch, spGetDigest, spParseError, spCreateErrorDisplay */

var SP_CHUNK_SIZE = 10 * 1024 * 1024; // 10 MB chunks
var SP_LARGE_FILE_THRESHOLD = 250 * 1024 * 1024; // 250 MB

/**
 * Upload a file to a SharePoint folder.
 * Uses chunked upload for files > 250 MB.
 * Handles special characters in filenames via ResourcePath API.
 *
 * @param {string} siteUrl
 * @param {string} folderPath - Server-relative folder path
 * @param {string} fileName - Target file name
 * @param {File|ArrayBuffer} fileContent - File data
 * @param {object} [options]
 * @param {boolean} [options.overwrite=true] - Overwrite existing file
 * @param {function} [options.onProgress] - Progress callback: onProgress(loaded, total)
 * @returns {Promise<{name: string, path: string, size: number}>}
 */
export async function spUploadFile(siteUrl, folderPath, fileName, fileContent, options) {
  options = options || {};
  var overwrite = options.overwrite !== false;

  // Convert File to ArrayBuffer if needed
  var buffer;
  var fileSize;
  if (fileContent instanceof ArrayBuffer) {
    buffer = fileContent;
    fileSize = buffer.byteLength;
  } else if (fileContent instanceof File) {
    buffer = await fileContent.arrayBuffer();
    fileSize = buffer.byteLength;
  } else {
    throw new Error('fileContent must be a File or ArrayBuffer');
  }

  // Use chunked upload for large files
  if (fileSize > SP_LARGE_FILE_THRESHOLD) {
    return _chunkedUpload(siteUrl, folderPath, fileName, buffer, fileSize, overwrite, options.onProgress);
  }

  // Check for special characters in filename
  var hasSpecialChars = /[%#]/.test(fileName);
  var encodedFolder = encodeURIComponent(folderPath);

  var url;
  if (hasSpecialChars) {
    // Use ResourcePath API for filenames with % or #
    url = siteUrl + "/_api/web/GetFolderByServerRelativePath(decodedurl='" + encodedFolder + "')/Files/AddUsingPath(decodedurl='" + encodeURIComponent(fileName) + "',overwrite=" + overwrite + ")";
  } else {
    url = siteUrl + "/_api/web/GetFolderByServerRelativeUrl('" + encodedFolder + "')/Files/add(url='" + encodeURIComponent(fileName) + "',overwrite=" + overwrite + ")";
  }

  var digest = await spGetDigest(siteUrl);

  var resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Accept': 'application/json;odata=verbose',
      'X-RequestDigest': digest
    },
    credentials: 'include',
    body: buffer
  });

  if (!resp.ok) {
    var err = await spParseError(resp);
    throw new Error(err.message);
  }

  var data = await resp.json();
  var file = data.d || data;

  if (options.onProgress) {
    options.onProgress(fileSize, fileSize);
  }

  return {
    name: file.Name,
    path: file.ServerRelativeUrl,
    size: parseInt(file.Length, 10) || fileSize
  };
}

/**
 * Chunked upload for large files using StartUpload/ContinueUpload/FinishUpload.
 */
async function _chunkedUpload(siteUrl, folderPath, fileName, buffer, fileSize, overwrite, onProgress) {
  var encodedFolder = encodeURIComponent(folderPath);
  var encodedName = encodeURIComponent(fileName);

  // Generate upload ID
  var uploadId = _generateGuid();

  // Create empty file first
  var createUrl = siteUrl + "/_api/web/GetFolderByServerRelativeUrl('" + encodedFolder + "')/Files/add(url='" + encodedName + "',overwrite=" + overwrite + ")";
  var digest = await spGetDigest(siteUrl);

  var createResp = await fetch(createUrl, {
    method: 'POST',
    headers: {
      'Accept': 'application/json;odata=verbose',
      'X-RequestDigest': digest,
      'Content-Length': '0'
    },
    credentials: 'include',
    body: ''
  });

  if (!createResp.ok) {
    var err = await spParseError(createResp);
    throw new Error('Failed to create file: ' + err.message);
  }

  var createData = await createResp.json();
  var fileUrl = (createData.d || createData).ServerRelativeUrl;
  var encodedFileUrl = encodeURIComponent(fileUrl);

  var offset = 0;
  var chunkIndex = 0;
  var totalChunks = Math.ceil(fileSize / SP_CHUNK_SIZE);

  while (offset < fileSize) {
    var chunkEnd = Math.min(offset + SP_CHUNK_SIZE, fileSize);
    var chunk = buffer.slice(offset, chunkEnd);
    var isFirst = offset === 0;
    var isLast = chunkEnd >= fileSize;

    digest = await spGetDigest(siteUrl);

    var chunkUrl;
    if (isFirst) {
      chunkUrl = siteUrl + "/_api/web/GetFileByServerRelativeUrl('" + encodedFileUrl + "')/StartUpload(uploadId=guid'" + uploadId + "')";
    } else if (isLast) {
      chunkUrl = siteUrl + "/_api/web/GetFileByServerRelativeUrl('" + encodedFileUrl + "')/FinishUpload(uploadId=guid'" + uploadId + "',fileOffset=" + offset + ")";
    } else {
      chunkUrl = siteUrl + "/_api/web/GetFileByServerRelativeUrl('" + encodedFileUrl + "')/ContinueUpload(uploadId=guid'" + uploadId + "',fileOffset=" + offset + ")";
    }

    var chunkResp = await fetch(chunkUrl, {
      method: 'POST',
      headers: {
        'Accept': 'application/json;odata=verbose',
        'X-RequestDigest': digest
      },
      credentials: 'include',
      body: chunk
    });

    if (!chunkResp.ok) {
      var chunkErr = await spParseError(chunkResp);
      throw new Error('Chunk upload failed at offset ' + offset + ': ' + chunkErr.message);
    }

    offset = chunkEnd;
    chunkIndex++;

    if (onProgress) {
      onProgress(offset, fileSize);
    }
  }

  return {
    name: fileName,
    path: fileUrl,
    size: fileSize
  };
}

/**
 * Generate a GUID for upload ID.
 * @returns {string}
 */
function _generateGuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    var r = Math.random() * 16 | 0;
    var v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

/**
 * Format file size for display.
 * @param {number} bytes
 * @returns {string}
 */
function _uploadFormatSize(bytes) {
  if (bytes === 0) return '0 B';
  var units = ['B', 'KB', 'MB', 'GB'];
  var i = Math.floor(Math.log(bytes) / Math.log(1024));
  i = Math.min(i, units.length - 1);
  return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
}

/**
 * Render the file upload UI with drag-and-drop.
 *
 * @param {HTMLElement} container
 * @param {string} siteUrl
 * @param {string} currentFolderPath - Server-relative folder path
 */
export function spCreateUploadUI(container, siteUrl, currentFolderPath) {
  var cyan = '#00e5ff';
  var pink = '#ff2975';
  var purple = '#b967ff';
  var bg = '#12122a';
  var bgDark = '#0a0a1a';
  var border = '#2a2a4a';
  var text = '#e0e0f0';
  var textDim = '#8888aa';

  var wrapper = document.createElement('div');
  wrapper.style.cssText = 'padding:16px;background:' + bg + ';border:1px solid ' + border + ';border-radius:6px;';

  var title = document.createElement('div');
  title.style.cssText = 'font-size:14px;font-weight:700;color:' + purple + ';margin-bottom:12px;';
  title.textContent = 'Upload Files';
  wrapper.appendChild(title);

  var folderInfo = document.createElement('div');
  folderInfo.style.cssText = 'font-size:11px;color:' + textDim + ';margin-bottom:12px;';
  folderInfo.textContent = 'Target: ' + currentFolderPath;
  wrapper.appendChild(folderInfo);

  // Drop zone
  var dropZone = document.createElement('div');
  dropZone.style.cssText = 'border:2px dashed ' + border + ';border-radius:8px;padding:32px;text-align:center;margin-bottom:12px;transition:border-color 0.2s,background 0.2s;cursor:pointer;';

  var dropLabel = document.createElement('div');
  dropLabel.style.cssText = 'color:' + textDim + ';font-size:12px;margin-bottom:8px;';
  dropLabel.textContent = 'Drag files here or click to browse';
  dropZone.appendChild(dropLabel);

  var fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.multiple = true;
  fileInput.style.display = 'none';
  dropZone.appendChild(fileInput);

  dropZone.addEventListener('click', function() { fileInput.click(); });
  dropZone.addEventListener('dragover', function(e) {
    e.preventDefault();
    dropZone.style.borderColor = cyan;
    dropZone.style.background = 'rgba(0,229,255,0.05)';
  });
  dropZone.addEventListener('dragleave', function() {
    dropZone.style.borderColor = border;
    dropZone.style.background = 'transparent';
  });
  dropZone.addEventListener('drop', function(e) {
    e.preventDefault();
    dropZone.style.borderColor = border;
    dropZone.style.background = 'transparent';
    addFiles(e.dataTransfer.files);
  });

  wrapper.appendChild(dropZone);

  // File queue
  var queueContainer = document.createElement('div');
  wrapper.appendChild(queueContainer);

  // Upload button
  var uploadBtn = document.createElement('button');
  uploadBtn.textContent = 'Upload All';
  uploadBtn.style.cssText = 'display:none;padding:6px 20px;background:linear-gradient(135deg,' + cyan + ',' + purple + ');border:none;border-radius:4px;color:#000;font-family:inherit;font-size:12px;font-weight:700;cursor:pointer;margin-top:8px;';
  wrapper.appendChild(uploadBtn);

  // Overall progress
  var overallProgress = document.createElement('div');
  overallProgress.style.cssText = 'display:none;margin-top:8px;font-size:11px;color:' + textDim + ';';
  wrapper.appendChild(overallProgress);

  // Error container
  var errorContainer = document.createElement('div');
  wrapper.appendChild(errorContainer);

  // State
  var fileQueue = [];
  var uploading = false;

  fileInput.addEventListener('change', function() {
    addFiles(fileInput.files);
    fileInput.value = '';
  });

  function addFiles(fileList) {
    for (var i = 0; i < fileList.length; i++) {
      fileQueue.push({
        file: fileList[i],
        status: 'pending', // pending, uploading, done, error
        progress: 0,
        error: null,
        el: null
      });
    }
    renderQueue();
  }

  function renderQueue() {
    queueContainer.innerHTML = '';
    if (fileQueue.length === 0) {
      uploadBtn.style.display = 'none';
      return;
    }

    uploadBtn.style.display = 'inline-block';

    fileQueue.forEach(function(item, idx) {
      var row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid ' + border + ';font-size:11px;';

      // Status indicator
      var statusDot = document.createElement('span');
      var colors = { pending: textDim, uploading: cyan, done: '#4caf50', error: pink };
      statusDot.style.cssText = 'width:6px;height:6px;border-radius:50%;background:' + (colors[item.status] || textDim) + ';flex-shrink:0;';
      row.appendChild(statusDot);

      // File info
      var info = document.createElement('div');
      info.style.cssText = 'flex:1;min-width:0;';
      var nameSpan = document.createElement('div');
      nameSpan.style.cssText = 'color:' + text + ';overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
      nameSpan.textContent = item.file.name;
      info.appendChild(nameSpan);

      var sizeSpan = document.createElement('div');
      sizeSpan.style.cssText = 'color:' + textDim + ';font-size:10px;';
      sizeSpan.textContent = _uploadFormatSize(item.file.size);
      if (item.error) {
        sizeSpan.style.color = pink;
        sizeSpan.textContent = item.error;
      }
      info.appendChild(sizeSpan);
      row.appendChild(info);

      // Progress bar (shown during upload)
      if (item.status === 'uploading') {
        var progBar = document.createElement('div');
        progBar.style.cssText = 'width:80px;height:3px;background:' + border + ';border-radius:2px;overflow:hidden;';
        var progFill = document.createElement('div');
        progFill.style.cssText = 'height:100%;width:' + item.progress + '%;background:' + cyan + ';transition:width 0.3s;';
        progBar.appendChild(progFill);
        row.appendChild(progBar);
      }

      // Remove button (only when pending)
      if (item.status === 'pending') {
        var removeBtn = document.createElement('button');
        removeBtn.textContent = '✕';
        removeBtn.style.cssText = 'background:transparent;border:none;color:' + pink + ';font-size:12px;cursor:pointer;padding:2px 4px;flex-shrink:0;';
        removeBtn.addEventListener('click', function() {
          fileQueue.splice(idx, 1);
          renderQueue();
        });
        row.appendChild(removeBtn);
      }

      // Done checkmark
      if (item.status === 'done') {
        var check = document.createElement('span');
        check.textContent = '✓';
        check.style.cssText = 'color:#4caf50;font-size:14px;flex-shrink:0;';
        row.appendChild(check);
      }

      item.el = row;
      queueContainer.appendChild(row);
    });
  }

  uploadBtn.addEventListener('click', async function() {
    if (uploading) return;
    uploading = true;
    uploadBtn.disabled = true;
    overallProgress.style.display = 'block';

    var total = fileQueue.length;
    var completed = 0;
    var failed = 0;

    for (var i = 0; i < fileQueue.length; i++) {
      var item = fileQueue[i];
      if (item.status !== 'pending') continue;

      item.status = 'uploading';
      renderQueue();

      try {
        await spUploadFile(siteUrl, currentFolderPath, item.file.name, item.file, {
          onProgress: function(loaded, fileTotal) {
            item.progress = Math.round((loaded / fileTotal) * 100);
            renderQueue();
          }
        });
        item.status = 'done';
        item.progress = 100;
        completed++;
      } catch (err) {
        item.status = 'error';
        item.error = err.message;
        failed++;
      }

      renderQueue();
      overallProgress.textContent = (completed + failed) + ' / ' + total + ' files processed'
        + (failed > 0 ? ' (' + failed + ' failed)' : '');
    }

    uploading = false;
    uploadBtn.disabled = false;
    overallProgress.textContent = 'Done: ' + completed + ' uploaded'
      + (failed > 0 ? ', ' + failed + ' failed' : '');
  });

  container.appendChild(wrapper);
}
