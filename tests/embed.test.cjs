const { test } = require('node:test');
const assert = require('node:assert/strict');
const embed = require('../scripts/embed.cjs');

function fixture(newline = '\n', duplicate = false) {
  const lines = ['\uFEFF---', 'title: 妹妹把蓝碗递给我', '---', '雨刚停。', '',
    '妹妹[^1]把蓝碗递给我。', '我把它放回窗台。', '',
    duplicate ? '妹妹把蓝碗递给我。' : '晚饭好了。', '', '[^1]: 妹妹把蓝碗递给我'];
  const section = (type, a, b) => ({type, position: {
    start: {line: a, col: 0}, end: {line: b, col: lines[b].length}
  }});
  const cache = {sections: [section('yaml', 0, 2), section('paragraph', 3, 3),
    section('paragraph', 5, 6), section('paragraph', 8, 8), section('footnoteDefinition', 10, 10)], embeds: []};
  const note = {path: '日记/雨后.md', extension: 'md'};
  const image = {path: '附件/蓝碗.png', extension: 'png'};
  const state = {raw: lines.join(newline), writes: 0};
  const app = {
    vault: {
      getAbstractFileByPath: p => [note, image].find(f => f.path === p),
      read: async () => state.raw,
      process: async (_, transform) => { state.raw = transform(state.raw); state.writes++; }
    },
    metadataCache: {getFileCache: () => cache, getFirstLinkpathDest: () => image}
  };
  const args = {notePath: note.path, imagePath: image.path, anchor: '妹妹把蓝碗递给我', caption: '*《窗边》｜AI 绘制。*'};
  return {state, cache, app, args};
}

for (const nl of ['\n', '\r\n']) {
  test('preserves all original text and locates the end of a multiline paragraph (' + JSON.stringify(nl) + ')', async () => {
    const {state, app, args} = fixture(nl);
    const before = state.raw;
    assert.equal((await embed(app, args)).afterLine, 7);
    assert.equal(state.writes, 0);
    assert.equal((await embed(app, {...args, apply: true})).status, 'inserted');
    const block = [ '', '', '![[' + args.imagePath + ']]', '', args.caption ].join(nl);
    assert.equal(state.raw, before.replace('我把它放回窗台。', '我把它放回窗台。' + block));
    assert.equal((await embed(app, {...args, apply: true})).status, 'already-linked');
    assert.equal(state.writes, 1);
  });
}

test('only Boolean true enables writing', async () => {
  const {app, args, state} = fixture();
  await assert.rejects(embed(app, {...args, apply: 'false'}), /布尔/);
  assert.equal(state.writes, 0);
});

test('rejects ambiguous or missing body paragraphs', async () => {
  const {app, args, state} = fixture('\n', true);
  await assert.rejects(embed(app, {...args, apply: true}), /匹配数为 2/);
  await assert.rejects(embed(app, {...args, anchor: '从未写下', apply: true}), /匹配数为 0/);
  assert.equal(state.writes, 0);
});

test('recognizes an embedded image with an alias', async () => {
  const {app, args, state, cache} = fixture();
  const alias = '![[蓝碗.png|300]]';
  state.raw += '\n\n' + alias;
  cache.embeds = [{link: '蓝碗.png', original: alias}];
  assert.equal((await embed(app, {...args, apply: true})).status, 'already-linked');
  assert.equal(state.writes, 0);
});

test('a removed link in an old cache does not count as an existing embed', async () => {
  const {app, args, cache} = fixture();
  cache.embeds = [{link: '蓝碗.png', original: '![[蓝碗.png]]'}];
  assert.equal((await embed(app, args)).status, 'preview');
});

test('a concurrent edit survives a failed insertion', async () => {
  const {app, args, state} = fixture();
  const newer = state.raw + '\n新写的一行';
  app.vault.process = async (_, transform) => { state.raw = newer; state.raw = transform(state.raw); };
  await assert.rejects(embed(app, {...args, apply: true}), /刚有修改/);
  assert.equal(state.raw, newer);
});
