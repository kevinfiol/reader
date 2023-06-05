/**
 * 🦉 Bubo RSS Reader
 * ====
 * Dead, dead simple feed reader that renders an HTML
 * page with links to content from feeds organized by site
 *
 */

import { resolve } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import Parser from 'rss-parser';
import { template } from './template.js';
import feeds from './feeds.json' assert { type: 'json' };

const DEV = process.argv.includes('-d');
const TIMEZONE_OFFSET = -4.0; // Default to EST

const REDIRECTS = {
  'twitter': 'notabird.site',
  'medium': 'scribe.rip',
  'youtube': 'youtube.com',
  'youtu': 'youtu.be'
};

const FEED_CONTENT_TYPES = [
  'application/json',
  'application/atom+xml',
  'application/rss+xml',
  'application/xml',
  'text/xml'
];

const parser = new Parser();
const contentFromAllFeeds = {};
const errors = [];

if (!DEV) {
  for (const group in feeds) {
    contentFromAllFeeds[group] = [];

    for (let index = 0; index < feeds[group].length; index++) {
      try {
        const url = feeds[group][index];
        const response = await fetch(url, { method: 'GET' });
        const contentType = response.headers.get('content-type').split(';')[0]; // e.g., `application/xml; charset=utf-8` -> `application/xml`

        if (!FEED_CONTENT_TYPES.includes(contentType)) {
          // invalid content type
          continue;
        }

        const body = await response.text();
        const contents = typeof body === "string" ? await parser.parseString(body) : body;
        const isRedditRSS = contents.feedUrl && contents.feedUrl.startsWith("https://www.reddit.com/r/");

        if (!contents.items.length) {
          errors.push(url);
          continue; // don't add feeds without items
        }

        contents.feed = feeds[group][index];
        contents.title = contents.title ? contents.title : contents.link;
        contentFromAllFeeds[group].push(contents);

        // try to normalize date attribute naming
        contents.items.forEach(item => {
          const timestamp = new Date(item.pubDate || item.isoDate || item.date || item.published).getTime();
          item.timestamp = isNaN(timestamp) ? (item.pubDate || item.isoDate || item.date || item.published) : timestamp;

          const formattedDate = new Date(item.timestamp).toLocaleDateString()
          item.timestamp = formattedDate !== 'Invalid Date' ? formattedDate : dateString;

          // correct link url if lacks hostname
          if (item.link && item.link.split('http').length == 1) {
            let newLink;

            if (contents.link.slice(-1) == '/' && item.link.slice(0, 1) == '/') {
              newLink = contents.link + item.link.slice(1);
            } else {
              newLink = contents.link + item.link;
            }

            item.link = newLink;
          }

          // if it's a link submission, let's parse the link to the content and rewrite item.link with it
          // I can tell its a link submission by the beginning of the contentSnippet
          if (isRedditRSS && item.contentSnippet && item.contentSnippet.startsWith('submitted by    ')) {
            // matches anything between double quotes, like `<a href="matches this">foo</a>`
            const quotesContentMatch = /(?<=")(?:\\.|[^"\\])*(?=")/g;
            let [_submittedBy, _userLink, contentLink, commentsLink] = item.content.split('<a href=');
            item.link = contentLink.match(quotesContentMatch)[0];
            item.comments = commentsLink.match(quotesContentMatch)[0];
          }

          // privacy redirects
          const url = new URL(item.link);
          const tokens = url.hostname.split('.');
          const host = tokens[tokens.length - 2];
          const redirect = REDIRECTS[host];

          if (redirect) {
            item.link = `https://${redirect}${url.pathname}${url.search}`;
          }
        });

        // sort items by date
        contents.items.sort(byDateSort);
      } catch (error) {
        console.error(error);
        errors.push(feeds[group][index]);
      }
    }
  }
}

let groups;

if (DEV) {
  const testJson = JSON.parse(readFileSync(resolve('./src/data.json'), { encoding: 'utf8' }));
  groups = Object.entries(testJson);
} else {
  groups = Object.entries(contentFromAllFeeds);
  writeFileSync(resolve('./src/data.json'), JSON.stringify(contentFromAllFeeds), 'utf8');
}

// for each group, sort the feeds
// sort the feeds by comparing the isoDate of the first items of each feed
for (let i = 0, len = groups.length; i < len; i++) {
  groups[i][1].sort((a, b) => byDateSort(a.items[0], b.items[0]));
}

// collect all items for 'all' feed
const allItems = [];
for (let [_groupName, feeds] of groups) {
  for (let feed of feeds) {
    for (let i = 0, len = feed.items.length; i < len; i++) {
      allItems.push({
        ...feed.items[i],
        feedUrl: feed.feedUrl ? new URL(feed.feedUrl).hostname : ''
      });
    }
  }
}

allItems.sort((a, b) => byDateSort(a, b));

const now = getNowDate(TIMEZONE_OFFSET).toString();
const html = template({ allItems, groups, now, errors });
writeFileSync(resolve('./output/index.html'), html, { encoding: 'utf8' });

function byDateSort(dateStrA, dateStrB) {
  const [aDate, bDate] = [parseDate(dateStrA), parseDate(dateStrB)];
  if (!aDate || !bDate) return 0;
  return bDate - aDate;
}

function parseDate(item) {
  if (item) {
    if (item.isoDate) return new Date(item.isoDate);
    else if (item.pubDate) return new Date(item.pubDate);
  }

  return null;
}

function getNowDate(offset) {
  let d = new Date();
  const utc = d.getTime() + (d.getTimezoneOffset() * 60000);
  d = new Date(utc + (3600000 * offset));
  return d;
}
