/**
 * Inspiration Notes — the browser half of the bundle.
 *
 * Two registrations, one identity:
 *   - the notes page on the layout's root keyed `main` slot, under the panel
 *     key — the shell's center column renders it whenever the panel is
 *     selected (keyed entry switching mounts it on entry and unmounts it on
 *     leave, so the page's mount IS its open);
 *   - the sidebar entry on the root list `sidebar.panellist` under the same id
 *     — the shell owns the row (button, label, active state, and the click that
 *     selects the panel); this module contributes only the glyph and the
 *     localized label thunk.
 *
 * Notes are browser state: they live in localStorage, keyed per origin, so the
 * panel works with no session selected and never writes the session log. A
 * separate draft key keeps unsaved composer text across panel switches and
 * reloads.
 */
window.__ModuleLoader__.load({
  id: '@local/inspiration-notes',
  factory(require) {
    const React = require('react');
    const { useCallback, useEffect, useMemo, useRef, useState } = React;
    const h = React.createElement;

    /** Locale namespace and panel key share one name; the shell addresses the page by it. */
    const NS = 'inspiration-notes';
    const PANEL_ID = 'inspiration-notes';

    const STORE_KEY = 'dsh.inspiration-notes.v1';
    const DRAFT_KEY = 'dsh.inspiration-notes.v1:draft';
    const MAX_TEXT = 20000;

    const MINUTE = 60 * 1000;
    const HOUR = 60 * MINUTE;
    const DAY = 24 * HOUR;

    //#region dictionaries
    const DICT_ZH = {
      title: '灵感便签',
      search: '搜索便签',
      placeholder: '此刻想到什么？随手记下来…',
      save: '保存',
      saveHint: '⌘ / Ctrl + Enter 保存',
      count: '共 {n} 条',
      empty: '还没有便签。把第一个灵感留在这里。',
      emptySearch: '没有找到匹配的便签。',
      pin: '置顶',
      unpin: '取消置顶',
      pinnedBadge: '已置顶',
      filterByTag: '只看 #{tag}',
      tagFilterLabel: '标签筛选',
      clearFilter: '清除筛选',
      copy: '复制',
      copyMenu: '更多复制方式',
      copyFull: '复制原文',
      copyNoTags: '复制正文（不含 #标签）',
      copied: '已复制',
      edit: '编辑',
      delete: '删除',
      confirmDelete: '确认删除',
      cancel: '取消',
      'time.now': '刚刚',
      'time.minutes': '{n} 分钟前',
      'time.hours': '{n} 小时前',
      'time.days': '{n} 天前',
    };

    const DICT_EN = {
      title: 'Inspiration Notes',
      search: 'Search notes',
      placeholder: 'What is on your mind? Jot it down…',
      save: 'Save',
      saveHint: '⌘ / Ctrl + Enter to save',
      count: '{n} notes',
      empty: 'No notes yet. Keep your first spark here.',
      emptySearch: 'No notes match that search.',
      pin: 'Pin',
      unpin: 'Unpin',
      pinnedBadge: 'Pinned',
      filterByTag: 'Show only #{tag}',
      tagFilterLabel: 'Tag filter',
      clearFilter: 'Clear filter',
      copy: 'Copy',
      copyMenu: 'More copy options',
      copyFull: 'Copy as written',
      copyNoTags: 'Copy without #tags',
      copied: 'Copied',
      edit: 'Edit',
      delete: 'Delete',
      confirmDelete: 'Delete?',
      cancel: 'Cancel',
      'time.now': 'just now',
      'time.minutes': '{n} min ago',
      'time.hours': '{n} h ago',
      'time.days': '{n} d ago',
    };
    //#endregion

    //#region storage
    function makeId() {
      return 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    }

    /** Accept only well-formed entries; unknown fields from older or newer readers are dropped. */
    function cleanNote(value) {
      if (value === null || typeof value !== 'object') return null;
      const text = typeof value.text === 'string' ? value.text.slice(0, MAX_TEXT) : '';
      if (text.trim() === '') return null;
      const createdAt = Number.isFinite(value.createdAt) ? value.createdAt : Date.now();
      const updatedAt = Number.isFinite(value.updatedAt) ? value.updatedAt : createdAt;
      return {
        id: typeof value.id === 'string' && value.id !== '' ? value.id : makeId(),
        text,
        createdAt,
        updatedAt,
        pinned: value.pinned === true,
      };
    }

    function readNotes() {
      try {
        const raw = window.localStorage.getItem(STORE_KEY);
        if (raw === null) return [];
        const parsed = JSON.parse(raw);
        const list = Array.isArray(parsed)
          ? parsed
          : parsed !== null && typeof parsed === 'object' && Array.isArray(parsed.notes)
            ? parsed.notes
            : [];
        return list.map(cleanNote).filter((note) => note !== null);
      } catch (error) {
        return [];
      }
    }

    function writeNotes(notes) {
      try {
        window.localStorage.setItem(STORE_KEY, JSON.stringify({ v: 1, notes }));
      } catch (error) {
        /* Storage unavailable (quota, private mode): the panel keeps working in memory. */
      }
    }

    function readDraft() {
      try {
        const raw = window.localStorage.getItem(DRAFT_KEY);
        return typeof raw === 'string' ? raw : '';
      } catch (error) {
        return '';
      }
    }

    function writeDraft(text) {
      try {
        if (text === '') window.localStorage.removeItem(DRAFT_KEY);
        else window.localStorage.setItem(DRAFT_KEY, text);
      } catch (error) {
        /* See writeNotes. */
      }
    }
    //#endregion

    //#region helpers
    /** Inline `#tags` become chips; the note text itself stays untouched. */
    function tagsOf(text) {
      const tags = [];
      const re = /(?:^|\s)[#＃]([\p{L}\p{N}_-]{1,24})/gu;
      let match = re.exec(text);
      while (match !== null && tags.length < 6) {
        if (!tags.includes(match[1])) tags.push(match[1]);
        match = re.exec(text);
      }
      return tags;
    }

    /**
     * The note text as written, minus the inline `#tags` the chips stand for.
     * Mirrors `tagsOf`'s rule (line start or after a space), so `C#` survives.
     */
    function stripTags(text) {
      return text
        .replace(/^[ \t]*(?:[#＃][\p{L}\p{N}_-]{1,24}[ \t]*)+$\n?/gmu, '')
        .replace(/(^|[ \t])[#＃][\p{L}\p{N}_-]{1,24}/gmu, '$1')
        .replace(/[ \t]+$/gm, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    }

    function timeLabel(ms, t, active) {
      const diff = Date.now() - ms;
      if (diff < MINUTE) return t('time.now');
      if (diff < HOUR) return t('time.minutes', { n: Math.floor(diff / MINUTE) });
      if (diff < DAY) return t('time.hours', { n: Math.floor(diff / HOUR) });
      if (diff < 7 * DAY) return t('time.days', { n: Math.floor(diff / DAY) });
      const date = new Date(ms);
      try {
        return new Intl.DateTimeFormat(active === 'zh' ? 'zh-CN' : active, {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        }).format(date);
      } catch (error) {
        return date.toLocaleDateString();
      }
    }
    //#endregion

    //#region glyphs
    /** The sticky-note glyph in `currentColor`, so the shell's row paints it on hover and active. */
    function NotesGlyph(props) {
      const size = typeof props.size === 'number' ? props.size : 18;
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.7,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
          focusable: 'false',
        },
        h('path', { d: 'M6.5 3.5h11a2 2 0 0 1 2 2v8.1L13.6 20H6.5a2 2 0 0 1-2-2V5.5a2 2 0 0 1 2-2Z' }),
        h('path', { d: 'M19.5 13.6h-3.8a2 2 0 0 0-2 2V20' }),
        h('path', { d: 'M8 8.2h7M8 11.6h4.6' }),
      );
    }

    const GLYPH_PROPS = {
      viewBox: '0 0 16 16',
      width: 14,
      height: 14,
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.4,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      'aria-hidden': true,
      focusable: 'false',
    };

    const pinGlyph = h(
      'svg',
      GLYPH_PROPS,
      h('path', { d: 'M6.2 2.6h3.6l-.6 3.1 2 2v.9H4.8v-.9l2-2-.6-3.1Z' }),
      h('path', { d: 'M8 8.6v5.2' }),
    );

    const copyGlyph = h(
      'svg',
      GLYPH_PROPS,
      h('rect', { x: 5.6, y: 5.6, width: 7, height: 7, rx: 1.3 }),
      h('path', { d: 'M3.4 10.3V4.4a1.4 1.4 0 0 1 1.4-1.4h5.4' }),
    );

    const checkGlyph = h('svg', GLYPH_PROPS, h('path', { d: 'M3.2 8.5l3 3 6.6-6.8' }));

    const caretGlyph = h(
      'svg',
      GLYPH_PROPS,
      h('path', { d: 'M4.2 6.4 8 10.2l3.8-3.8' }),
    );

    const editGlyph = h(
      'svg',
      GLYPH_PROPS,
      h('path', { d: 'M10.4 2.9l2.7 2.7-7.2 7.2-3.4.7.7-3.4 7.2-7.2Z' }),
      h('path', { d: 'M9.2 4.1l2.7 2.7' }),
    );

    const trashGlyph = h(
      'svg',
      GLYPH_PROPS,
      h('path', { d: 'M2.9 4.4h10.2M6.3 4.4V3.1h3.4v1.3M4.5 4.4l.6 8.3h5.8l.6-8.3' }),
    );
    //#endregion

    //#region styles
    /** Component-local styles: rendered inside the page, so unmounting removes them. */
    const PAGE_CSS = `
.in-page{box-sizing:border-box;display:flex;flex-direction:column;width:100%;height:100%;min-height:0;overflow:hidden;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:13px}
.in-scroll{flex:auto;min-height:0;overflow-y:auto;scrollbar-gutter:stable}
.in-content{max-width:960px;margin:0 auto;padding:0 clamp(24px,4vw,48px) 48px}
.in-head{display:flex;flex-wrap:wrap;align-items:center;gap:12px;margin-bottom:20px;padding-top:28px}
[data-platform=darwin] .in-head{padding-top:calc(28px + var(--dsh-frame-top-clearance,0px))}
.in-title{flex:auto;min-width:0;margin:0;font-size:20px;font-weight:500;line-height:28px}
.in-count{flex:none;padding:1px 9px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:11px;line-height:18px;font-variant-numeric:tabular-nums}
.in-search{flex:none;width:200px;max-width:46vw;padding:5px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:18px;outline:none;transition:border-color .18s ease}
.in-search:focus{border-color:var(--dsw-alias-label-secondary)}
.in-search::placeholder{color:var(--dsw-alias-label-secondary)}
.in-composer{display:flex;flex-direction:column;gap:8px;box-sizing:border-box;margin-bottom:16px;padding:12px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-1);transition:border-color .18s ease}
.in-composer:focus-within{border-color:color-mix(in srgb, var(--dsw-alias-brand-primary) 50%, var(--dsw-alias-border-l2))}
.in-input{box-sizing:border-box;width:100%;min-height:74px;max-height:320px;padding:2px;border:0;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;line-height:1.65;resize:vertical;outline:none}
.in-input::placeholder{color:var(--dsw-alias-label-secondary)}
.in-composer-foot{display:flex;align-items:center;gap:10px}
.in-hint{flex:auto;min-width:0;overflow:hidden;color:var(--dsw-alias-label-secondary);font-size:11px;white-space:nowrap;text-overflow:ellipsis}
.in-primary{flex:none;padding:5px 14px;border:1px solid transparent;border-radius:8px;background:var(--dsw-alias-button-primary-fill,var(--dsw-alias-brand-primary));color:var(--dsw-alias-label-primary-foreground,#fff);font:inherit;font-size:12px;line-height:18px;font-weight:500;cursor:pointer;transition:opacity .18s ease}
.in-primary:hover:enabled{opacity:.88}
.in-primary:disabled{opacity:.45;cursor:default}
.in-primary-sm{padding:3px 12px;font-size:11px}
.in-ghost{flex:none;padding:3px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;line-height:18px;cursor:pointer}
.in-ghost:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-secondary)}
.in-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(260px,100%),1fr));gap:10px;align-items:start}
.in-card{--in-card-bg:var(--dsw-alias-bg-layer-1);display:flex;flex-direction:column;gap:8px;box-sizing:border-box;min-width:0;padding:12px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--in-card-bg);transition:border-color .18s ease}
.in-card:hover{border-color:color-mix(in srgb, var(--dsw-alias-label-secondary) 55%, var(--dsw-alias-border-l2))}
.in-card-pinned{--in-card-bg:var(--dsw-alias-bg-layer-2);box-shadow:inset 3px 0 0 var(--dsw-alias-brand-primary)}
.in-card-top{display:flex;align-items:flex-start;gap:8px;min-width:0}
.in-tags{display:flex;flex:auto;flex-wrap:wrap;gap:4px;min-width:0}
.in-tag{flex:none;padding:0 7px;border:1px solid var(--dsw-alias-border-l1);border-radius:999px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font:inherit;font-size:10px;line-height:17px;cursor:pointer;transition:color .15s ease,border-color .15s ease,background-color .15s ease}
.in-tag:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-secondary)}
.in-tag-on,.in-tag-on:hover{background:color-mix(in srgb, var(--dsw-alias-brand-primary) 14%, transparent);border-color:color-mix(in srgb, var(--dsw-alias-brand-primary) 50%, transparent);color:var(--dsw-alias-brand-primary)}
.in-pin{display:inline-flex;flex:none;align-items:center;gap:4px;height:24px;padding:0 5px;border:1px solid transparent;border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;line-height:1;cursor:pointer;transition:background-color .15s ease,color .15s ease,border-color .15s ease}
.in-pin:hover{background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-2));color:var(--dsw-alias-label-primary)}
.in-pin-on,.in-pin-on:hover{background:color-mix(in srgb, var(--dsw-alias-brand-primary) 14%, transparent);border-color:color-mix(in srgb, var(--dsw-alias-brand-primary) 50%, transparent);color:var(--dsw-alias-brand-primary)}
.in-pin-label{white-space:nowrap;font-size:11px}
.in-filters{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:-6px 0 12px}
.in-filters-label{color:var(--dsw-alias-label-secondary);font-size:11px;white-space:nowrap}
.in-filter-chip{display:inline-flex;align-items:center;gap:6px;padding:1px 8px;border:1px solid color-mix(in srgb, var(--dsw-alias-brand-primary) 50%, transparent);border-radius:999px;background:color-mix(in srgb, var(--dsw-alias-brand-primary) 14%, transparent);color:var(--dsw-alias-brand-primary);font:inherit;font-size:11px;line-height:17px;cursor:pointer}
.in-filter-chip:hover{background:color-mix(in srgb, var(--dsw-alias-brand-primary) 22%, transparent)}
.in-filter-x{font-size:12px;line-height:1;opacity:.75}
.in-text-wrap{position:relative;min-width:0}
.in-text{max-height:320px;margin:0;overflow-y:auto;overflow-wrap:anywhere;white-space:pre-wrap;font-size:13px;line-height:1.65;scrollbar-width:thin;scrollbar-color:color-mix(in srgb, var(--dsw-alias-label-secondary) 40%, transparent) transparent}
.in-text-scroll .in-text{padding-right:8px}
.in-text::-webkit-scrollbar{width:8px}
.in-text::-webkit-scrollbar-track{background:transparent}
.in-text::-webkit-scrollbar-thumb{background:color-mix(in srgb, var(--dsw-alias-label-secondary) 35%, transparent);border:2px solid transparent;border-radius:8px;background-clip:padding-box}
.in-text:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:3px;border-radius:4px}
.in-text-fade{position:absolute;left:0;right:0;bottom:0;height:26px;pointer-events:none;background:linear-gradient(to bottom, transparent, var(--in-card-bg, var(--dsw-alias-bg-layer-1)))}
.in-edit{display:flex;flex-direction:column;gap:8px}
.in-input-edit{min-height:96px;font-size:13px}
.in-edit-actions{display:flex;justify-content:flex-end;gap:8px}
.in-card-foot{display:flex;align-items:center;gap:6px;margin-top:auto;padding-top:2px}
.in-time{flex:auto;min-width:0;overflow:hidden;color:var(--dsw-alias-label-secondary);font-size:11px;font-variant-numeric:tabular-nums;white-space:nowrap;text-overflow:ellipsis}
.in-card-actions{display:flex;flex:none;align-items:center;gap:2px}
.in-icon{display:inline-flex;flex:none;align-items:center;justify-content:center;width:24px;height:24px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;transition:background-color .15s ease,color .15s ease}
.in-icon:hover{background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-2));color:var(--dsw-alias-label-primary)}
.in-icon-on,.in-icon-on:hover{color:var(--dsw-alias-brand-primary)}
.in-copy{position:relative;display:inline-flex;flex:none;align-items:center}
.in-caret{width:16px}
.in-menu{position:absolute;right:0;bottom:calc(100% + 6px);z-index:30;display:flex;flex-direction:column;gap:2px;min-width:168px;padding:4px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-overlay);box-shadow:var(--dsw-shadow-lv3,0 6px 20px rgba(0,0,0,.18))}
.in-menu-item{display:block;width:100%;padding:6px 10px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:18px;text-align:left;white-space:nowrap;cursor:pointer}
.in-menu-item:hover{background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-2))}
.in-confirm{flex:none;padding:2px 8px;border:1px solid color-mix(in srgb, var(--dsw-alias-state-error-primary) 55%, transparent);border-radius:6px;background:transparent;color:var(--dsw-alias-state-error-primary);font:inherit;font-size:11px;line-height:18px;cursor:pointer}
.in-confirm:hover{background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 12%, transparent)}
.in-empty{margin-top:8px;padding:52px 20px;border:1px dashed var(--dsw-alias-border-l2);border-radius:14px;color:var(--dsw-alias-label-secondary);text-align:center;font-size:13px;line-height:1.7}
.in-sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
`;
    //#endregion

    /**
     * A saved note's body. Long text keeps a capped height and scrolls inside
     * the card, with a fade at the bottom while more text remains below; the
     * fade disappears once the reader reaches the end.
     */
    function NoteText(props) {
      const text = props.text;
      const ref = useRef(null);
      const [scrollable, setScrollable] = useState(false);
      const [atEnd, setAtEnd] = useState(false);

      useEffect(() => {
        const el = ref.current;
        if (el === null) return undefined;
        const measure = () => {
          const overflows = el.scrollHeight > el.clientHeight + 2;
          setScrollable(overflows);
          setAtEnd(overflows ? el.scrollTop + el.clientHeight >= el.scrollHeight - 2 : false);
        };
        measure();
        if (typeof ResizeObserver !== 'function') return undefined;
        const observer = new ResizeObserver(measure);
        observer.observe(el);
        return () => observer.disconnect();
      }, [text]);

      const onScroll = () => {
        const el = ref.current;
        if (el === null) return;
        setAtEnd(el.scrollTop + el.clientHeight >= el.scrollHeight - 2);
      };

      return h(
        'div',
        { className: 'in-text-wrap' + (scrollable ? ' in-text-scroll' : '') },
        h('p', { ref, className: 'in-text', tabIndex: scrollable ? 0 : undefined, onScroll }, text),
        scrollable && !atEnd ? h('span', { className: 'in-text-fade', 'aria-hidden': true }) : null,
      );
    }

    function makePage(ctx, t) {
      /** Read per render: the slot outlet re-renders on a locale switch. */
      function activeLocale() {
        try {
          return ctx.locale.getLocale().active;
        } catch (error) {
          return 'en';
        }
      }

      return function NotesPage() {
        const [notes, setNotes] = useState(readNotes);
        const [draft, setDraft] = useState(readDraft);
        const [query, setQuery] = useState('');
        const [activeTag, setActiveTag] = useState(null);
        const [editingId, setEditingId] = useState(null);
        const [editText, setEditText] = useState('');
        const [confirmId, setConfirmId] = useState(null);
        const [copyMenuId, setCopyMenuId] = useState(null);
        const [copiedId, setCopiedId] = useState(null);
        const [, setTick] = useState(0);
        const inputRef = useRef(null);
        const firstWrite = useRef(true);

        // Persist after the first render: the initial state already came from storage.
        useEffect(() => {
          if (firstWrite.current) {
            firstWrite.current = false;
            return;
          }
          writeNotes(notes);
        }, [notes]);

        useEffect(() => {
          writeDraft(draft);
        }, [draft]);

        // Another window or tab edits the same origin's notes: follow it.
        useEffect(() => {
          const onStorage = (event) => {
            if (event.key === STORE_KEY) setNotes(readNotes());
            if (event.key === DRAFT_KEY && event.newValue !== null) setDraft(event.newValue);
          };
          window.addEventListener('storage', onStorage);
          return () => window.removeEventListener('storage', onStorage);
        }, []);

        useEffect(() => {
          if (confirmId === null) return undefined;
          const timer = window.setTimeout(() => setConfirmId(null), 3200);
          return () => window.clearTimeout(timer);
        }, [confirmId]);

        useEffect(() => {
          if (copiedId === null) return undefined;
          const timer = window.setTimeout(() => setCopiedId(null), 1600);
          return () => window.clearTimeout(timer);
        }, [copiedId]);

        // The copy menu closes on an outside press or Escape.
        useEffect(() => {
          if (copyMenuId === null) return undefined;
          const onPointer = (event) => {
            const target = event.target;
            if (target instanceof Element && target.closest('[data-copy-menu]') !== null) return;
            setCopyMenuId(null);
          };
          const onKey = (event) => {
            if (event.key === 'Escape') setCopyMenuId(null);
          };
          document.addEventListener('pointerdown', onPointer, true);
          document.addEventListener('keydown', onKey);
          return () => {
            document.removeEventListener('pointerdown', onPointer, true);
            document.removeEventListener('keydown', onKey);
          };
        }, [copyMenuId]);

        // A filter no note satisfies any more would hide everything: drop it.
        useEffect(() => {
          if (activeTag === null) return;
          if (!notes.some((note) => tagsOf(note.text).includes(activeTag))) setActiveTag(null);
        }, [notes, activeTag]);

        // Relative timestamps stay honest while the panel stays open.
        useEffect(() => {
          const timer = window.setInterval(() => setTick((n) => n + 1), 60000);
          return () => window.clearInterval(timer);
        }, []);

        const add = useCallback(() => {
          const text = draft.trim();
          if (text === '') {
            if (inputRef.current !== null) inputRef.current.focus();
            return;
          }
          const at = Date.now();
          setNotes((prev) => [{ id: makeId(), text, createdAt: at, updatedAt: at, pinned: false }, ...prev]);
          setDraft('');
          setQuery('');
          setActiveTag(null);
          if (inputRef.current !== null) inputRef.current.focus();
        }, [draft]);

        const patch = useCallback((id, fields) => {
          setNotes((prev) => prev.map((note) => (note.id === id ? { ...note, ...fields } : note)));
        }, []);

        const togglePin = (id) => {
          setNotes((prev) => prev.map((note) => (note.id === id ? { ...note, pinned: !note.pinned } : note)));
        };

        const remove = (id) => {
          setNotes((prev) => prev.filter((note) => note.id !== id));
          setConfirmId(null);
          setCopyMenuId(null);
          setEditingId((current) => (current === id ? null : current));
        };

        const startEdit = (note) => {
          setEditingId(note.id);
          setEditText(note.text);
          setConfirmId(null);
          setCopyMenuId(null);
        };

        const cancelEdit = () => {
          setEditingId(null);
          setEditText('');
        };

        const commitEdit = (id) => {
          const text = editText.trim();
          if (text === '') return;
          patch(id, { text, updatedAt: Date.now() });
          cancelEdit();
        };

        const copy = async (note, withoutTags) => {
          const stripped = withoutTags ? stripTags(note.text) : note.text;
          const payload = stripped.trim() === '' ? note.text : stripped;
          const done = () => setCopiedId(note.id);
          try {
            await navigator.clipboard.writeText(payload);
            done();
            return;
          } catch (error) {
            /* Fall through to the selection-based copy. */
          }
          const area = document.createElement('textarea');
          area.value = payload;
          area.setAttribute('readonly', '');
          area.style.position = 'fixed';
          area.style.top = '-1000px';
          area.style.opacity = '0';
          document.body.appendChild(area);
          area.select();
          try {
            document.execCommand('copy');
            done();
          } catch (error) {
            /* Clipboard is unavailable; leave the note untouched. */
          }
          document.body.removeChild(area);
        };

        const toggleTag = (tag) => {
          setActiveTag((current) => (current === tag ? null : tag));
        };

        const visible = useMemo(() => {
          const needle = query.trim().toLowerCase();
          let filtered =
            needle === '' ? notes : notes.filter((note) => note.text.toLowerCase().includes(needle));
          if (activeTag !== null) {
            filtered = filtered.filter((note) => tagsOf(note.text).includes(activeTag));
          }
          return filtered.slice().sort((a, b) => {
            const pinned = (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0);
            return pinned !== 0 ? pinned : b.updatedAt - a.updatedAt;
          });
        }, [notes, query, activeTag]);

        const active = activeLocale();

        const onComposeKey = (event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            add();
          }
        };

        const onEditKey = (id) => (event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            commitEdit(id);
          } else if (event.key === 'Escape') {
            event.preventDefault();
            cancelEdit();
          }
        };

        const renderCard = (note) => {
          const editing = editingId === note.id;
          const armed = confirmId === note.id;
          const tags = tagsOf(note.text);
          return h(
            'article',
            { className: 'in-card' + (note.pinned ? ' in-card-pinned' : ''), key: note.id },
            h(
              'div',
              { className: 'in-card-top' },
              h(
                'div',
                { className: 'in-tags' },
                tags.map((tag) =>
                  h(
                    'button',
                    {
                      type: 'button',
                      key: tag,
                      className: 'in-tag' + (activeTag === tag ? ' in-tag-on' : ''),
                      title: t('filterByTag', { tag }),
                      'aria-label': t('filterByTag', { tag }),
                      'aria-pressed': activeTag === tag,
                      onClick: () => toggleTag(tag),
                    },
                    '#' + tag,
                  ),
                ),
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'in-pin' + (note.pinned ? ' in-pin-on' : ''),
                  title: note.pinned ? t('unpin') : t('pin'),
                  'aria-label': note.pinned ? t('unpin') : t('pin'),
                  'aria-pressed': note.pinned,
                  onClick: () => togglePin(note.id),
                },
                pinGlyph,
                note.pinned ? h('span', { className: 'in-pin-label' }, t('pinnedBadge')) : null,
              ),
            ),
            editing
              ? h(
                  'div',
                  { className: 'in-edit' },
                  h('textarea', {
                    className: 'in-input in-input-edit',
                    value: editText,
                    autoFocus: true,
                    spellCheck: false,
                    'aria-label': t('edit'),
                    onChange: (event) => setEditText(event.target.value),
                    onKeyDown: onEditKey(note.id),
                  }),
                  h(
                    'div',
                    { className: 'in-edit-actions' },
                    h('button', { type: 'button', className: 'in-ghost', onClick: cancelEdit }, t('cancel')),
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'in-primary in-primary-sm',
                        disabled: editText.trim() === '',
                        onClick: () => commitEdit(note.id),
                      },
                      t('save'),
                    ),
                  ),
                )
              : h(NoteText, { text: note.text }),
            h(
              'div',
              { className: 'in-card-foot' },
              h(
                'time',
                { className: 'in-time', dateTime: new Date(note.updatedAt).toISOString() },
                timeLabel(note.updatedAt, t, active),
              ),
              h(
                'div',
                { className: 'in-card-actions' },
                h(
                  'div',
                  { className: 'in-copy', 'data-copy-menu': '' },
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'in-icon' + (copiedId === note.id ? ' in-icon-on' : ''),
                      title: copiedId === note.id ? t('copied') : t('copy'),
                      'aria-label': copiedId === note.id ? t('copied') : t('copy'),
                      onClick: () => {
                        setCopyMenuId(null);
                        void copy(note, false);
                      },
                    },
                    copiedId === note.id ? checkGlyph : copyGlyph,
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'in-icon in-caret',
                      title: t('copyMenu'),
                      'aria-label': t('copyMenu'),
                      'aria-haspopup': 'menu',
                      'aria-expanded': copyMenuId === note.id,
                      onClick: () => setCopyMenuId((current) => (current === note.id ? null : note.id)),
                    },
                    caretGlyph,
                  ),
                  copyMenuId === note.id
                    ? h(
                        'div',
                        { className: 'in-menu', role: 'menu', 'aria-label': t('copyMenu') },
                        h(
                          'button',
                          {
                            type: 'button',
                            role: 'menuitem',
                            className: 'in-menu-item',
                            onClick: () => {
                              setCopyMenuId(null);
                              void copy(note, false);
                            },
                          },
                          t('copyFull'),
                        ),
                        h(
                          'button',
                          {
                            type: 'button',
                            role: 'menuitem',
                            className: 'in-menu-item',
                            onClick: () => {
                              setCopyMenuId(null);
                              void copy(note, true);
                            },
                          },
                          t('copyNoTags'),
                        ),
                      )
                    : null,
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'in-icon',
                    title: t('edit'),
                    'aria-label': t('edit'),
                    onClick: () => startEdit(note),
                  },
                  editGlyph,
                ),
                armed
                  ? h('button', { type: 'button', className: 'in-confirm', onClick: () => remove(note.id) }, t('confirmDelete'))
                  : h(
                      'button',
                      {
                        type: 'button',
                        className: 'in-icon',
                        title: t('delete'),
                        'aria-label': t('delete'),
                        onClick: () => setConfirmId(note.id),
                      },
                      trashGlyph,
                    ),
              ),
            ),
          );
        };

        return h(
          'section',
          { className: 'in-page', 'aria-label': t('title') },
          h('style', { dangerouslySetInnerHTML: { __html: PAGE_CSS } }),
          h(
            'div',
            { className: 'in-scroll' },
            h(
              'div',
              { className: 'in-content' },
              h(
                'div',
                { className: 'in-head' },
                h('h1', { className: 'in-title' }, t('title')),
                h('span', { className: 'in-count' }, t('count', { n: notes.length })),
                h('input', {
                  className: 'in-search',
                  type: 'search',
                  value: query,
                  placeholder: t('search'),
                  'aria-label': t('search'),
                  onChange: (event) => setQuery(event.target.value),
                }),
              ),
              h(
                'div',
                { className: 'in-composer' },
                h('textarea', {
                  ref: inputRef,
                  className: 'in-input',
                  value: draft,
                  rows: 3,
                  autoFocus: true,
                  spellCheck: false,
                  placeholder: t('placeholder'),
                  'aria-label': t('placeholder'),
                  onChange: (event) => setDraft(event.target.value),
                  onKeyDown: onComposeKey,
                }),
                h(
                  'div',
                  { className: 'in-composer-foot' },
                  h('span', { className: 'in-hint' }, t('saveHint')),
                  h(
                    'button',
                    { type: 'button', className: 'in-primary', disabled: draft.trim() === '', onClick: add },
                    t('save'),
                  ),
                ),
              ),
              activeTag === null
                ? null
                : h(
                    'div',
                    { className: 'in-filters' },
                    h('span', { className: 'in-filters-label' }, t('tagFilterLabel')),
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'in-filter-chip',
                        title: t('clearFilter'),
                        'aria-label': t('clearFilter'),
                        onClick: () => setActiveTag(null),
                      },
                      '#' + activeTag,
                      h('span', { className: 'in-filter-x', 'aria-hidden': true }, '×'),
                    ),
                  ),
              visible.length === 0
                ? h('div', { className: 'in-empty' }, notes.length === 0 ? t('empty') : t('emptySearch'))
                : h('div', { className: 'in-grid' }, visible.map(renderCard)),
              h('span', { className: 'in-sr', role: 'status', 'aria-live': 'polite' }, copiedId === null ? '' : t('copied')),
            ),
          ),
        );
      };
    }

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh: DICT_ZH, en: DICT_EN }), 'inspiration-notes: dictionaries');
      const t = ctx.locale.bind(NS);
      const NotesPage = makePage(ctx, t);
      ctx.effect(() => {
        const disposers = [
          ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID, locale: NS }, NotesPage)),
          ctx.slots.inject('sidebar.panellist', () =>
            ctx.slots.register(
              {
                name: 'sidebar.panellist',
                id: PANEL_ID,
                order: 30,
                label: () => t('title'),
                locale: NS,
              },
              NotesGlyph,
            ),
          ),
        ];
        return () => {
          for (const dispose of disposers) {
            if (typeof dispose === 'function') dispose();
          }
        };
      }, 'inspiration-notes: panel');
    }

    return { name: '@local/inspiration-notes', inject: ['slots', 'locale'], apply };
  },
});
