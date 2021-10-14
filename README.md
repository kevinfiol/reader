# 🦉 Bubo Reader (Fork)

This is a personal fork of the excellent [Bubo Reader](https://github.com/georgemandis/bubo-rss) by George Mandis. I've made several opinionated changes to the setup, including replacing dependencies with more compact alternatives. Please see the original repository for deployment instructions.

Original blogpost: [Introducing Bubo RSS: An Absurdly Minimalist RSS Feed Reader](https://george.mand.is/2019/11/introducing-bubo-rss-an-absurdly-minimalist-rss-feed-reader/)

Blogpost about my fork: [A minimal RSS Feed Reader](https://kevinfiol.com/blog/a-minimal-rss-feed-reader/)

Some changes I made:

* Replace `nunjucks` with `yeahjs`
* Replace `node-fetch` with `httpie`
* Many styling changes, including using the `:target` CSS selector to switch between groups (inspired by https://john-doe.neocities.org/)
* The build script now sorts the feeds in each group by which one has the latest updates (this greatly improves the experience, imo).
* Dark mode via `@media (prefers-color-scheme: dark)`
