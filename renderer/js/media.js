(function () {
  const { ipcRenderer } = require('electron');
  const fs = require('fs');
  const path = require('path');

  const IMG_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp']);
  function isImg(p) { return IMG_EXT.has(path.extname(p).toLowerCase()); }

  function renderGrid(container, files) {
    container.innerHTML = files.map(f => `
      <div class="media-thumb" title="${f}">
        <img loading="lazy" src="${'file:///' + f.replace(/\\/g,'/')}">
      </div>
    `).join('');
  }

  function loadDir(dir, gridEl, keyForPersist) {
    if (!dir) return;
    try {
      const names = fs.readdirSync(dir);
      const abs = names.map(n => path.join(dir, n)).filter(p => {
        try { const st = fs.statSync(p); return st.isFile() && isImg(p); }
        catch { return false; }
      });
      renderGrid(gridEl, abs);
      try { localStorage.setItem(keyForPersist, dir); } catch {}
    } catch (e) {
      console.error('loadDir failed:', e);
    }
  }

  window.addEventListener('DOMContentLoaded', () => {
    const imgPick = document.getElementById('img-pick');
    const imgFolder = document.getElementById('img-folder');
    const imgGrid = document.getElementById('img-grid');

    const emoPick = document.getElementById('emo-pick');
    const emoFolder = document.getElementById('emo-folder');
    const emoGrid = document.getElementById('emo-grid');

    // 恢复上次目录
    const lastImg = localStorage.getItem('media.img.dir') || '';
    const lastEmo = localStorage.getItem('media.emo.dir') || '';
    if (lastImg) { imgFolder.textContent = lastImg; loadDir(lastImg, imgGrid, 'media.img.dir'); }
    if (lastEmo) { emoFolder.textContent = lastEmo; loadDir(lastEmo, emoGrid, 'media.emo.dir'); }

    // 选择目录
    imgPick && imgPick.addEventListener('click', async () => {
      const dir = await ipcRenderer.invoke('media:choose-dir', { title: '选择图片文件夹' });
      if (dir) { imgFolder.textContent = dir; loadDir(dir, imgGrid, 'media.img.dir'); }
    });
    emoPick && emoPick.addEventListener('click', async () => {
      const dir = await ipcRenderer.invoke('media:choose-dir', { title: '选择表情文件夹' });
      if (dir) { emoFolder.textContent = dir; loadDir(dir, emoGrid, 'media.emo.dir'); }
    });

    // 点击缩略图 -> 粘贴到微信
    function bindGridClick(grid) {
      grid && grid.addEventListener('click', (e) => {
        const thumb = e.target.closest('.media-thumb');
        if (!thumb) return;
        const img = thumb.querySelector('img');
        if (!img) return;
        let p = img.getAttribute('src') || '';
        if (p.startsWith('file:///')) {
          p = p.replace('file:///', '');
          if (process.platform === 'win32') p = p.replace(/\//g, '\\');
        }
        if (p) ipcRenderer.send('media:image-paste', p);
      });
    }
    bindGridClick(imgGrid);
    bindGridClick(emoGrid);
  });
})();