// Called from Obsidian Desktop after the finished image has been saved in the vault.
module.exports = async function embed(app, {notePath, imagePath, anchor, caption, apply = false}) {
  if (typeof apply !== 'boolean') throw new TypeError('apply 只接受布尔值 true 或 false');
  const note = app.vault.getAbstractFileByPath(notePath);
  const image = app.vault.getAbstractFileByPath(imagePath);
  if (note?.extension !== 'md') throw new Error('找不到指定的 Markdown 日记');
  if (!image || !/^(png|jpe?g|webp|gif|avif)$/i.test(image.extension || '')) {
    throw new Error('图片尚未被此库识别，请核对库内路径');
  }
  if (/[\[\]|#^\r\n]/.test(image.path)) throw new Error('附件名含 Wiki 链接保留字符');
  if (!anchor?.trim() || !caption?.trim() || /[\r\n]/.test(caption)) {
    throw new Error('需要正文中的定位短句与一行完整图注');
  }

  const original = await app.vault.read(note);
  const cache = app.metadataCache.getFileCache(note);
  if (!cache?.sections) throw new Error('正文仍在索引中，请稍后重试');
  for (const embed of cache.embeds || []) {
    if (!embed.original || !original.includes(embed.original)) continue;
    if (app.metadataCache.getFirstLinkpathDest(embed.link, note.path)?.path === image.path) {
      return {status: 'already-linked', note: note.path, image: image.path};
    }
  }

  // Map line/column to the actual file to preserve BOM, CRLF and the original final newline.
  const lines = original.split('\n');
  const starts = [0];
  for (let i = 0; i < lines.length - 1; i++) starts.push(starts[i] + lines[i].length + 1);
  const plain = s => s.replace(/\[\^[^\]\r\n]+\]/g, '').replace(/\s+/g, ' ').trim();
  const needle = plain(anchor);
  if (!needle) throw new Error('请使用正文文字定位');
  const matches = [];
  for (const section of cache.sections) {
    if (section.type !== 'paragraph') continue;
    const {start, end} = section.position;
    if (start.line >= lines.length || end.line >= lines.length) continue;
    const begin = starts[start.line] + start.col;
    const finish = starts[end.line] + end.col;
    const content = original.slice(begin, finish);
    if (plain(content).includes(needle)) matches.push({endLine: end.line, finish});
  }
  if (matches.length !== 1) throw new Error('正文段落匹配数为 ' + matches.length + '，请换一段可唯一定位的原文');

  const {endLine, finish} = matches[0];
  if (finish !== starts[endLine] + lines[endLine].replace(/\r$/, '').length) {
    throw new Error('段落边界与当前文件不符，请等待重新索引');
  }
  const newline = original.includes('\r\n') ? '\r\n' : '\n';
  const block = [ '', '', '![[' + image.path + ']]', '', caption ].join(newline);
  const report = {note: note.path, image: image.path, afterLine: endLine + 1};
  if (original.startsWith(block, finish)) return {status: 'already-linked', ...report};
  if (!apply) return {status: 'preview', ...report};

  await app.vault.process(note, current => {
    if (current !== original) throw new Error('日记刚有修改，请用最新内容重新定位');
    return current.slice(0, finish) + block + current.slice(finish);
  });
  return {status: 'inserted', ...report};
};
