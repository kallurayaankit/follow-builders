import fs from 'fs/promises';

const SOURCES = JSON.parse(await fs.readFile('config/default-sources.json', 'utf-8'));

async function fetchBlogs() {
  const articles = [];
  for (const blog of SOURCES.blogs) {
    try {
      const res = await fetch(blog.url);
      if (!res.ok) throw new Error(`Failed to fetch ${blog.url}: HTTP ${res.status}`);
      const html = await res.text();
      const linkRegex = /<a\b[^>]*?\shref\s*=\s*["']([^"']*)["'][^>]*>/gi;
      const matches = [...html.matchAll(linkRegex)];
      for (const m of matches) {
        const href = m[1];
        // Anthropic also serves engineering posts under /research/ and redirects /blog to /news.
        const isArticle = /^\/(?:engineering|blog|research|news)\/[^/?#]+\/?(?:[?#].*)?$/.test(href);
        if (isArticle) {
          const fullUrl = new URL(href, blog.url).href;
          if (!articles.find(a => a.url === fullUrl)) {
            articles.push({ blog: blog.name, url: fullUrl, scraped_at: new Date().toISOString() });
          }
        }
      }
    } catch (err) {
      console.error(err);
    }
  }
  return articles;
}

const blogs = await fetchBlogs();
if (blogs.length === 0) throw new Error('No blog articles found; leaving the existing feed unchanged.');
const feedBlogs = { generated: new Date().toISOString(), articles: blogs };
await fs.writeFile('feed-blogs.json', JSON.stringify(feedBlogs, null, 2));
console.log('Blog feed generated.');
