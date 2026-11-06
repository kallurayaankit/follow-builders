import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const generator = fileURLToPath(new URL('../scripts/generate-feed.js', import.meta.url));

test('generator writes a feed with resolved, deduplicated article links', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'follow-builders-test-'));
  try {
    await mkdir(path.join(directory, 'config'));
    await writeFile(path.join(directory, 'config/default-sources.json'), JSON.stringify({
      blogs: [
        { name: 'Engineering', url: 'https://example.test/engineering' },
        { name: 'Blog', url: 'https://example.test/blog' },
      ],
    }));
    const fixtures = {
      'https://example.test/engineering': `
        <a class="card" href="/engineering/first">First</a>
        <a href="/engineering/first">Duplicate</a>
        <a href="/about">Not an article</a>
        <a href="/research/current-engineering">Current engineering post</a>
        <a href="/research/team/alignment">Research team, not an article</a>
        <a data-href="/blog/not-a-link">No href</a>`,
      'https://example.test/blog': `
        <a href='/blog/second'>Second</a>
        <a href='/news/current-blog'>Current blog post</a>
        <a href="/engineering/first">Cross-source duplicate</a>`,
    };
    const mock = `const fixtures = ${JSON.stringify(fixtures)};
      globalThis.fetch = async (url) => {
        if (!(url in fixtures)) throw new Error('Unexpected URL: ' + url);
        return { ok: true, text: async () => fixtures[url] };
      };`;
    const { stdout, stderr } = await execFileAsync(process.execPath, [
      '--import', `data:text/javascript,${encodeURIComponent(mock)}`, generator,
    ], { cwd: directory });
    assert.match(stdout, /Blog feed generated/);
    assert.equal(stderr, '');
    const feed = JSON.parse(await readFile(path.join(directory, 'feed-blogs.json'), 'utf8'));
    assert.ok(Number.isFinite(Date.parse(feed.generated)));
    assert.deepEqual(feed.articles.map(({ blog, url }) => ({ blog, url })), [
      { blog: 'Engineering', url: 'https://example.test/engineering/first' },
      { blog: 'Engineering', url: 'https://example.test/research/current-engineering' },
      { blog: 'Blog', url: 'https://example.test/blog/second' },
      { blog: 'Blog', url: 'https://example.test/news/current-blog' },
    ]);
    for (const article of feed.articles) {
      assert.ok(Number.isFinite(Date.parse(article.scraped_at)));
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

for (const failure of ['empty page', 'HTTP error']) {
  test(`generator preserves the existing feed on ${failure}`, async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'follow-builders-test-'));
    try {
      await mkdir(path.join(directory, 'config'));
      await writeFile(path.join(directory, 'config/default-sources.json'), JSON.stringify({
        blogs: [{ name: 'Blog', url: 'https://example.test/blog' }],
      }));
      const original = JSON.stringify({ generated: 'previous', articles: [{ url: 'saved' }] });
      await writeFile(path.join(directory, 'feed-blogs.json'), original);
      const mock = `globalThis.fetch = async () => ({
        ok: ${failure === 'empty page'}, status: 503, text: async () => '<a href="/about">About</a>'
      });`;
      await assert.rejects(execFileAsync(process.execPath, [
        '--import', `data:text/javascript,${encodeURIComponent(mock)}`, generator,
      ], { cwd: directory }), error => {
        assert.equal(error.code, 1);
        assert.match(error.stderr, /No blog articles found/);
        if (failure === 'HTTP error') assert.match(error.stderr, /HTTP 503/);
        return true;
      });
      assert.equal(await readFile(path.join(directory, 'feed-blogs.json'), 'utf8'), original);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
}
