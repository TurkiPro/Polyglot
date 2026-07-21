/**
 * Settings: study limits, theme, and the data the user owns (§9).
 */
import { config } from '../../../config/app.config.js';
import { exportData, importData, store, updateSettings, wipeLocal } from '../store.js';
import { button, div, el, h, p, panel, replace, slider } from '../ui/components.js';
import { strings } from '../ui/strings.js';

const s = strings.settings;

export function renderSettings(root, ctx) {
  const view = div({ class: 'settings' }, [
    h(1, s.title, 'title'),
    studyPanel(),
    appearancePanel(),
    dataPanel(),
    accountPanel(),
    dangerPanel(ctx),
  ]);
  replace(root, view);
}

function studyPanel() {
  return panel(s.study, [
    slider({
      label: s.newPerDay,
      min: 0,
      max: 50,
      value: store.settings.newPerDay,
      onChange: (newPerDay) => updateSettings({ newPerDay }),
    }),
    slider({
      label: s.maxPerDay,
      min: 10,
      max: 500,
      step: 10,
      value: store.settings.maxPerDay,
      onChange: (maxPerDay) => updateSettings({ maxPerDay }),
    }),
  ]);
}

function appearancePanel() {
  const options = [
    { value: 'dark', label: s.themeDark },
    { value: 'light', label: s.themeLight },
  ];

  const group = div({ class: 'segmented', attrs: { role: 'radiogroup', 'aria-label': s.theme } });
  for (const option of options) {
    const active = store.settings.theme === option.value;
    group.append(
      button(option.label, () => {
        applyTheme(option.value);
        updateSettings({ theme: option.value });
        for (const child of group.children) child.setAttribute('aria-checked', 'false');
        const target = [...group.children].find((c) => c.textContent === option.label);
        target?.setAttribute('aria-checked', 'true');
      }, {
        variant: `btn-quiet${active ? ' active' : ''}`,
        role: 'radio',
        'aria-checked': String(active),
      }),
    );
  }

  return panel(s.appearance, [el('div', { class: 'field' }, [
    el('span', { class: 'field-label', text: s.theme }),
    group,
  ])]);
}

/** Theme is a data attribute; all colours live in the stylesheet (§9). */
export function applyTheme(theme) {
  document.documentElement.dataset.theme = theme === 'light' ? 'light' : 'dark';
}

function dataPanel() {
  const status = p('', 'muted');

  const download = async () => {
    const payload = await exportData();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = el('a', {
      href: url,
      download: `${config.identity.projectName}-export-${new Date().toISOString().slice(0, 10)}.json`,
    });
    link.click();
    URL.revokeObjectURL(url);
  };

  const picker = el('input', {
    class: 'sr-only',
    attrs: { type: 'file', accept: 'application/json,.json' },
    on: {
      change: async (event) => {
        const file = event.target.files?.[0];
        if (!file) return;
        status.textContent = s.importing;
        try {
          const result = await importData(JSON.parse(await file.text()));
          status.textContent = s.imported(result.total);
        } catch {
          status.textContent = s.importFailed;
        }
        event.target.value = '';
      },
    },
  });

  return panel(s.data, [
    p(s.dataBody, 'muted'),
    div({ class: 'row' }, [
      button(s.export, download, { variant: 'btn-quiet' }),
      button(s.import, () => picker.click(), { variant: 'btn-quiet' }),
    ]),
    picker,
    status,
  ]);
}

/** Sign-in arrives in Phase 6; the section exists so the shape is visible. */
function accountPanel() {
  return panel(s.account, [p(s.accountBody, 'muted')]);
}

function dangerPanel(ctx) {
  const input = el('input', {
    class: 'answer',
    attrs: { type: 'text', placeholder: s.wipeConfirm(s.wipeWord), 'aria-label': s.wipeConfirm(s.wipeWord) },
  });

  const confirm = button(s.wipe, async () => {
    if (input.value.trim() !== s.wipeWord) return;
    await wipeLocal();
    ctx.navigate('#home');
  }, { variant: 'btn-danger' });

  confirm.disabled = true;
  input.addEventListener('input', () => {
    confirm.disabled = input.value.trim() !== s.wipeWord;
  });

  return panel(s.danger, [p(s.dangerBody, 'muted'), input, confirm]);
}
