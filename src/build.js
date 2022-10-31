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

const DEV = false;
const FEEDS_JSON = './feeds.json';
const INPUT_TEMPLATE = './template.html';
const OUTPUT_FILE = '../output/index.html';

const REDIRECTS = {
    'twitter': 'notabird.site',
    'medium': 'scribe.rip',
    'youtube': 'yewtu.be',
    'youtu': 'yewtu.be'
};

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

    if (!DEV) {
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

                        // privacy redirects
                        const url = new URL(item.link);
                        const tokens = url.hostname.split('.');
                        const host = tokens[tokens.length - 2];
                        const redirect = REDIRECTS[host];

                        if (redirect) {
                            item.link = `https://${redirect}${url.pathname}${url.search}`;
                        }
                    });

                    // sort items
                    contents.items.sort((a, b) => {
                        const [aDate, bDate] = [parseDate(a), parseDate(b)];
                        if (!aDate || !bDate) return 0; 
                        return bDate - aDate;
                    });
                } catch (error) {
                  console.error(error);
                  errors.push(feeds[group][index]);
                }
          }
        }
    }

    let groups;

    if (DEV) {
        const testJson = JSON.parse(readFileSync(join(__dirname, './data.json'), { encoding: 'utf8' }));
        groups = Object.entries(testJson);
    } else {
        groups = Object.entries(contentFromAllFeeds);
        writeFileSync(join(__dirname, './data.json'), JSON.stringify(contentFromAllFeeds), 'utf8');
    }

    // sort feeds
    for (let i = 0, len = groups.length; i < len; i++) {
        // for each group, sort the feeds
        // sort the feeds by comparing the isoDate of the first items of each feed
        groups[i][1].sort((a, b) => {
            const [aDate, bDate] = [parseDate(a.items[0]), parseDate(b.items[0])];
            if (!aDate || !bDate) return 0; 
            return bDate - aDate;
        });
    }

    const now = getNowDate().toString();
    const html = render({ groups, now, errors });
    writeFileSync(join(__dirname, OUTPUT_FILE), html, { encoding: 'utf8' });
})();

function parseDate(item) {
    if (item) {
        if (item.isoDate) return new Date(item.isoDate);
        else if (item.pubDate) return new Date(item.pubDate);
    }

    return null;
}

function getNowDate() {
    //EST
    const offset = -4.0

    let d = new Date();
    const utc = d.getTime() + (d.getTimezoneOffset() * 60000);
    d = new Date(utc + (3600000 * offset));
    return d;
}
