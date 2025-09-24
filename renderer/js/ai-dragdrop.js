window.addEventListener('DOMContentLoaded', () => {
  const aiContext = document.getElementById('ai-context');
  if (!aiContext) return;

  aiContext.addEventListener('dragover', (e) => {
    e.preventDefault();
    aiContext.classList.add('dragover');
    console.log('dragover');
  });

  aiContext.addEventListener('dragleave', (e) => {
    aiContext.classList.remove('dragover');
  });

  aiContext.addEventListener('drop', (e) => {
    e.preventDefault();
    aiContext.classList.remove('dragover');
    console.log('drop事件触发');
    // 打印所有类型
    for (const type of e.dataTransfer.types) {
      const val = e.dataTransfer.getData(type);
      console.log(`[${type}]:`, val);
    }
    console.log('files:', e.dataTransfer.files);
    // 支持拖 txt 文件
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      if (file.type.startsWith('text/') || file.name.endsWith('.txt')) {
        const reader = new FileReader();
        reader.onload = function(evt) {
          aiContext.value = evt.target.result;
        };
        reader.readAsText(file);
      }
    }
  });
});