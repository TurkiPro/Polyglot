/**
 * Credits: the generated attribution from the pack (§7).
 *
 * Read from `credits.json`, which the pipeline writes — never hand-maintained here.
 */
import { config } from '../../../config/app.config.js';
import { div, el, empty, h, p, replace } from '../ui/components.js';
import { strings } from '../ui/strings.js';

const s = strings.credits;
const LANG = config.pack.langPackV1;

export function renderCredits(root) {
  const view = div({ class: 'credits' }, [h(1, s.title, 'title'), p(s.body, 'muted')]);
  replace(root, view);

  fetch(`/assets/packs/${LANG}/credits.json`)
    .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
    .then((credits) => {
      view.append(p(s.packVersion(credits.packVersion), 'muted'));
      for (const source of credits.sources) view.append(sourcePanel(source));
    })
    .catch(() => view.append(empty(strings.common.error)));
}

function sourcePanel(source) {
  const links = el('ul', { class: 'links' }, [
    linkItem(s.home, source.url),
    source.downloadUrl ? linkItem(s.source, source.downloadUrl) : null,
    linkItem(`${s.license}: ${source.license}`, source.licenseUrl),
  ].filter(Boolean));

  return el('section', { class: 'panel' }, [
    h(2, source.name, 'panel-title'),
    p(source.description),
    links,
  ]);
}

function linkItem(label, href) {
  return el('li', {}, [
    el('a', { text: label, href, attrs: { rel: 'noopener noreferrer', target: '_blank' } }),
  ]);
}
