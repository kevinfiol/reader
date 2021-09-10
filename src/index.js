/**
 * 🦉 Bubo RSS Reader
 * ====
 * Dead, dead simple feed reader that renders an HTML
 * page with links to content from feeds organized by site
 *
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import { get } from 'httpie';
import Parser from 'rss-parser';
import { compile } from 'yeahjs';

const FEEDS_JSON = './feeds.json';
const INPUT_TEMPLATE = './template.html';
const OUTPUT_FILE = '../output/index.html';

const __dirname = dirname(fileURLToPath(import.meta.url));
const feeds = JSON.parse(readFileSync(join(__dirname, FEEDS_JSON), { encoding: 'utf8' }));

const parser = new Parser();
const template = readFileSync(join(__dirname, INPUT_TEMPLATE), { encoding: 'utf8' });
const render = compile(template, { localsName: 'it' });

// parse XML or JSON feeds
function parseFeed(response) {
  const contentType = response.headers['content-type']
    ? response.headers['content-type'].split(";")[0]
    : false;

  if (!contentType) return false;

  const contentTypes = [
    'application/json',
    'application/atom+xml',
    'application/rss+xml',
    'application/xml',
    'text/xml',
    'text/html' // this is kind of a gamble
  ];

  if (contentTypes.includes(contentType)) {
    return response.data;
  }

  return false;
}

(async () => {
  const contentFromAllFeeds = {};
  const errors = [];

  for (const group in feeds) {
    contentFromAllFeeds[group] = [];

    for (let index = 0; index < feeds[group].length; index++) {
      try {
        const response = await get(feeds[group][index]);
        const body = parseFeed(response);
        const contents =
          typeof body === "string" ? await parser.parseString(body) : body;

        contents.feed = feeds[group][index];
        contents.title = contents.title ? contents.title : contents.link;
        contentFromAllFeeds[group].push(contents);
        
        // try to normalize date attribute naming
        contents.items.forEach(item => {
          const timestamp = new Date(item.pubDate || item.isoDate || item.date).getTime();
          item.timestamp = isNaN(timestamp) ? (item.pubDate || item.isoDate || item.date) : timestamp;

          const formattedDate = new Date(item.timestamp).toLocaleDateString()
          item.timestamp = formattedDate !== 'Invalid Date' ? formattedDate : dateString;
        });

      } catch (error) {
        errors.push(feeds[group][index]);
      }
    }
  }

  const now = (new Date()).toUTCString();
  const groups = Object.entries(contentFromAllFeeds);
  const html = render({ groups, now, errors });
  writeFileSync(join(__dirname, OUTPUT_FILE), html, { encoding: 'utf8' });
})();
