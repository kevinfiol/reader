import Parser from 'rss-parser';
import { resolve } from '@std/path';
import { parse as jsonParse } from '@std/jsonc';
import { template } from './template.js';
import { glob } from './globrex.js';

const WRITE = Deno.args.includes('--write');
const USE_CACHE = !WRITE && Deno.args.includes('--cached');
const TODAY = new Date();
const SCRIPT_TIMEOUT = 5; // minutes
const FETCH_TIMEOUT = 1; // minutes

const CACHE_PATH = './src/cache.json';
const OUTFILE_PATH = './output/index.html';
const CONTENT_TYPES = [
  'application/json',
  'application/atom+xml',
  'application/rss+xml',
  'application/x-rss+xml',
  'application/xml',
  'application/octet-stream',
  'text/xml',
  'text/html',
];

const config = readCfg('./src/config.jsonc');
const feeds = USE_CACHE ? {} : readCfg('./src/feeds.jsonc');
const cache = USE_CACHE ? readCfg(CACHE_PATH) : {};

// compile ignore expressions
const ignores = config.ignore.map((pattern) => glob(pattern).regex);
const checkIfIgnored = (url = '') => ignores.some((regex) => regex.test(url));

// script timeout
const scriptTimer = setTimeout(() => {
  console.error(`Timed out after ${TIMEOUT} minutes`);
  Deno.exit(1);
}, SCRIPT_TIMEOUT * 60 * 1000);

await build({ config, feeds, cache, writeCache: WRITE })
  .then(() => {
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => clearTimeout(scriptTimer));

async function build({ config, feeds, cache, writeCache = false }) {
  let allItems = cache.allItems || [];
  const parser = new Parser();
  const errors = [];
  const groupContents = {};

  for (const groupName in feeds) {
    groupContents[groupName] = [];

    const results = await Promise.allSettled(
      Object.values(feeds[groupName]).map((url) =>
        fetch(url, {
          method: 'GET',
          signal: AbortSignal.timeout(FETCH_TIMEOUT * 60 * 1000),
        })
          .then((res) => [url, res])
          .catch((e) => {
            throw [url, e];
          })
      ),
    );

    for (const result of results) {
      if (result.status === 'rejected') {
        const [url, error] = result.reason;
        errors.push(url);
        console.error(`Error fetching ${url}:\n`, error);
        continue;
      }

      const [url, response] = result.value;

      try {
        // e.g., `application/xml; charset=utf-8` -> `application/xml`
        const contentType = response.headers.get('content-type').split(';')[0];

        if (!CONTENT_TYPES.includes(contentType)) {
          throw Error(
            `Feed at ${url} has invalid content-type: ${contentType}`,
          );
        }

        const body = await response.text();
        const contents = typeof body === 'string'
          ? await parser.parseString(body)
          : body;
        const isRedditRSS = contents.feedUrl &&
          contents.feedUrl.includes('reddit.com/r/');

        if (!contents.items.length === 0) {
          throw Error(`Feed at ${url} contains no items.`);
        }

        contents.feed = url;
        contents.title = contents.title || contents.link;
        groupContents[groupName].push(contents);

        // item sort & normalization
        contents.items.sort(byDateSort);
        contents.items.forEach((item) => {
          item.feedUrl = contents.feedUrl;

          // try to normalize date
          const itemDate = new Date(
            item.pubDate || item.isoDate || item.date || item.published,
          );
          const date = itemDate > TODAY ? TODAY : itemDate;
          item.timestamp = date.toLocaleDateString();

          // correct link url if it lacks the hostname
          if (item.link && item.link.split('http').length === 1) {
            item.link =
              // if the hostname ends with a /, and the item link begins with a /
              contents.link.slice(-1) === '/' && item.link.slice(0, 1) === '/'
                ? contents.link + item.link.slice(1)
                : contents.link + item.link;
          }

          // parse subreddit feed comments
          if (
            isRedditRSS && item.contentSnippet &&
            item.contentSnippet.startsWith('submitted by    ')
          ) {
            // matches anything between double quotes, like `<a href="matches this">foo</a>`
            const quotesContentMatch = /(?<=")(?:\\.|[^"\\])*(?=")/g;
            const [_submittedBy, _userLink, contentLink, commentsLink] = item
              .content.split('<a href=');
            item.link = contentLink.match(quotesContentMatch)[0];
            item.comments = commentsLink.match(quotesContentMatch)[0];
          }

          // create url object, and ignore if user configured host to be ignored
          const url = new URL(item.link);

          if (checkIfIgnored(url.hostname)) {
            item.ignored = true;
            return;
          }

          // apply redirects
          if (config.redirects) {
            const tokens = url.hostname.split('.');
            const host = tokens[tokens.length - 2];
            const redirect = config.redirects[host];
            if (redirect) {
              item.link = `https://${redirect}${url.pathname}${url.search}`;
            }
          }

          if (config.embedYoutubeLinks && isYouTube(url)) {
            item.link = embedYoutubeLink(url);
          }

          // escape any html in the title
          item.title = escapeHtml(item.title || item.link);

          // turn comments prop into array
          // for links with comments on multiple feeds
          item.comments = item.comments ? [item.comments] : [];
        });

        // filter out ignored items
        contents.items = contents.items.filter((item) => !item.ignored);

        // add to allItems
        allItems = [...allItems, ...contents.items];
      } catch (e) {
        console.error(e);
        errors.push(url);
      }
    }
  }

  const groups = cache.groups || Object.entries(groupContents);

  if (writeCache) {
    Deno.writeTextFileSync(
      resolve(CACHE_PATH),
      JSON.stringify({ groups, allItems }),
    );
  }

  // for each group, sort the feeds
  // sort the feeds by comparing the isoDate of the first items of each feed
  groups.forEach(([_groupName, feeds]) => {
    feeds.sort((a, b) => byDateSort(a.items[0], b.items[0]));
  });

  // remove dupes from all articles
  const exists = {};
  const temp = [];
  for (const item of allItems) {
    if (exists[item.link]) {
      // append alternative containing feed in comma-delimited string
      // for when multiple feeds contain the same link
      // ex: `hnrss.org, reddit.com`
      if (!exists[item.link].feedUrl.includes(item.feedUrl)) {
        exists[item.link].feedUrl += `, ${item.feedUrl}`;
      }

      // append extra comment links if they exist
      exists[item.link].comments.push(...item.comments);
      const unique = new Set(exists[item.link].comments);
      exists[item.link].comments = Array.from(unique);
      continue;
    }

    temp.push(item);
    exists[item.link] = item;
  }

  // sort `all articles` view
  allItems = temp.toSorted((a, b) => byDateSort(a, b));

  // group all articles by date
  const datedItems = {};
  const dates = [];
  for (const item of allItems) {
    if (!datedItems[item.timestamp]) {
      dates.push(item.timestamp);
      datedItems[item.timestamp] = [];
    }

    datedItems[item.timestamp].push(item);
  }

  const now = getNowDate(config.timezone_offset).toString();
  const html = template({ datedItems, dates, groups, now, errors });

  Deno.writeTextFileSync(resolve(OUTFILE_PATH), html);
  console.log(`Reader built successfully at: ${OUTFILE_PATH}`);
}

/**
 * utils
 */
function parseDate(item) {
  const date = item ? (item.isoDate || item.pubDate) : undefined;
  return date ? new Date(date) : undefined;
}

function byDateSort(dateStrA, dateStrB) {
  const [aDate, bDate] = [parseDate(dateStrA), parseDate(dateStrB)];
  if (!aDate || !bDate) return 0;
  return bDate - aDate;
}

function getNowDate(offset = 0) {
  let d = new Date();
  const utc = d.getTime() + (d.getTimezoneOffset() * 60000);
  d = new Date(utc + (3600000 * offset));
  return d;
}

function readCfg(path) {
  let contents, json;

  try {
    contents = Deno.readTextFileSync(resolve(path));
  } catch (_e) {
    console.warn(`Warning: Config at ${path} does not exist`);
    return {};
  }

  try {
    json = jsonParse(contents);
  } catch (_e) {
    console.error('Error: Config is Invalid JSON: ' + path);
    process.exit(1);
  }

  return json;
}

function escapeHtml(html) {
  return html.replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll("'", '&apos;')
    .replaceAll('"', '&quot;');
}

function isYouTube(url) {
  const { hostname } = url;
  return hostname === 'youtube.com' ||
    hostname === 'www.youtube.com' ||
    hostname === 'youtu.be' ||
    hostname === 'www.youtu.be';
}

function embedYoutubeLink(url) {
  return `https://youtube.com/embed/${
    url.hostname.includes('youtu.be')
      ? url.pathname.slice(1)
      : url.searchParams.get('v')
  }`;
}
