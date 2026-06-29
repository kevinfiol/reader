const _ = {
  if: (condition, template) => condition ? template : '',
  forEach: (arr, fn) => {
    let i, str = '';
    for (i = 0; i < arr.length; i++) str += fn(arr[i], i);
    return str;
  },
};

const article = (item, showFeedUrl = false) => `
  <article class="item">
    <header class="item__header">
      <a href="${item.link}" target='_blank' rel='noopener norefferer nofollow'>
        ${item.title}
      </a>
    </header>

    <small>
      ${_.if(showFeedUrl && item.feedUrl, `
        <span class="item__feed-url monospace">${item.feedUrl}</span>
      `)}

      <ul class="article-links">
        <li class="monospace">${item.timestamp || ''}</li>

        ${_.forEach(item.comments, (link, i) => `
          <li>
            <a href="${link}" target='_blank' rel='noopener norefferer nofollow'>
              comments${i > 0 ? ` (${i})` : ''}
            </a>
          </li>
        `)}

        <li><a href="https://archive.md/${item.link}" target='_blank' rel='noopener norefferer nofollow'>archive.md</a></li>
      </ul>
    </small>
  </article>
`;

export const template = ({ datedItems, dates, groups, errors, now }) => (`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="ie=edge">
  <title>🦉 reader</title>
  <link rel="stylesheet" href="./style.css">
</head>
<body>
  <div class="app">
    <input type="checkbox" class="menu-btn" id="menu-btn" />
    <label class="menu-label" for="menu-btn"></label>

    <div class="sidebar">
      <header>
        <h1 class="inline" style="user-select: none;">🦉</h1>
        <ul class="group-selector">
          <li><a href="#all-articles">all articles</a></li>
          ${_.forEach(groups, group => `
            <li><a href="#${group[0]}">${group[0]}</a></li>
          `)}
        </ul>
      </header>

      <footer>
        ${_.if(errors.length > 0, `
          <h2>Errors</h2>
          <p>There were errors trying to parse these feeds:</p>
          <ul>
          ${_.forEach(errors, error => `
            <li>${error}</li>
          `)}
          </ul>
        `)
        }

        <p>
          Last updated ${now}. Powered by <a href="https://github.com/kevinfiol/rss-reader">Bubo Reader</a>, a project by <a href="https://george.mand.is">George Mandis</a> and <a href="https://kevinfiol.com">Kevin Fiol</a>.
        </p>
      </footer>
    </div>

    <main>
      <section id="all-articles">
        <h2>all articles</h2>
        ${_.forEach(dates, date => {
          const items = datedItems[date];

          return `
            <details open>
              <summary>
                <span class="feed-title">${(new Date(date)).toDateString()}</span> 
              </summary>
              ${_.forEach(items, item => article(item, true))}
            </details>
          `;
        })}
      </section>

      ${_.forEach(groups, ([groupName, feeds]) => `
        <section id="${groupName}">
          <h2>${groupName}</h2>

          ${_.forEach(feeds, feed => `
            <details>
              <summary>
                <span class="feed-title">${feed.title}</span> 
                <span class="feed-url">
                  <small>
                    (${feed.feed})
                  </small>
                </span>
                <div class="feed-timestamp">
                  <small>Latest: ${feed.items[0] && feed.items[0].timestamp || ''}</small>
                </div>
              </summary>
              ${_.forEach(feed.items, item => article(item))}
            </details>
          `)}
        </section>
      `)}

        <div class="default-text">
          <p>🦉📚 welcome to bubo reader</p>
          <p>select a feed group to get started</p>
        </div>
    </main>
  </div>
</body>
</html>
`);
