import { useEffect, useMemo, useRef, useState } from 'react';
import { Bold, Italic, Link as LinkIcon, List, ListOrdered, Package, Underline } from 'lucide-react';
import { appPrompt } from '../../utils/appDialog';
import {
  htmlToPlainText,
  looksLikeHtmlFragment,
  sanitizeStoreDescriptionHtml,
} from '../../utils/sanitizeCommunicationHtml';
import type { StoreAdminListing } from '../../api/onlineStore';
import './StoreDescriptionEditor.css';

type Props = {
  value: string | null;
  listings: StoreAdminListing[];
  currentListingId: string;
  disabled?: boolean;
  placeholder?: string;
  showSave?: boolean;
  onHtmlChange?: (html: string | null) => void;
  onSave: (html: string | null) => void;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function toEditorHtml(value: string | null): string {
  const raw = value ?? '';
  if (!raw.trim()) return '';
  if (looksLikeHtmlFragment(raw)) return sanitizeStoreDescriptionHtml(raw);
  return sanitizeStoreDescriptionHtml(escapeHtml(raw).replace(/\n/g, '<br>'));
}

function normalizeStoredHtml(html: string): string | null {
  const sanitized = sanitizeStoreDescriptionHtml(html);
  return htmlToPlainText(sanitized) ? sanitized : null;
}

export default function StoreDescriptionEditor({
  value,
  listings,
  currentListingId,
  disabled,
  placeholder = 'Product description shoppers see',
  showSave = true,
  onHtmlChange,
  onSave,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const savedRange = useRef<Range | null>(null);
  const pendingHtml = useRef<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState('');
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (dirty) return;
    const el = rootRef.current;
    if (!el) return;
    const next = toEditorHtml(value);
    if (pendingHtml.current != null) {
      if (normalizeStoredHtml(next) === normalizeStoredHtml(pendingHtml.current)) {
        pendingHtml.current = null;
      } else {
        return;
      }
    }
    if (el.innerHTML !== next) el.innerHTML = next;
  }, [dirty, value]);

  useEffect(() => {
    if (!pickerOpen) return;
    const onDoc = (event: MouseEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) {
        setPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [pickerOpen]);

  const matches = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase();
    return listings
      .filter((listing) => listing.listingId !== currentListingId)
      .filter((listing) => {
        if (!q) return true;
        const hay = [
          listing.name,
          listing.description,
          ...listing.variants.map((variant) => `${variant.name} ${variant.code || ''}`),
        ]
          .join(' ')
          .toLowerCase();
        return hay.includes(q);
      })
      .slice(0, 12);
  }, [currentListingId, listings, pickerQuery]);

  function rememberSelection() {
    const el = rootRef.current;
    const selection = window.getSelection();
    if (!el || !selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    if (el.contains(range.commonAncestorContainer)) {
      savedRange.current = range.cloneRange();
    }
  }

  function restoreSelection() {
    const el = rootRef.current;
    const range = savedRange.current;
    if (!el || !range) return false;
    el.focus();
    const selection = window.getSelection();
    selection?.removeAllRanges();
    try {
      selection?.addRange(range);
      return true;
    } catch {
      return false;
    }
  }

  function emitFromDom() {
    const el = rootRef.current;
    if (!el) return;
    el.innerHTML = sanitizeStoreDescriptionHtml(el.innerHTML);
    setDirty(true);
    onHtmlChange?.(normalizeStoredHtml(el.innerHTML));
  }

  function saveFromDom() {
    const el = rootRef.current;
    if (!el) return;
    const next = normalizeStoredHtml(el.innerHTML);
    const prev = normalizeStoredHtml(toEditorHtml(value));
    if (next === prev) {
      pendingHtml.current = null;
      setDirty(false);
      return;
    }
    pendingHtml.current = next;
    onSave(next);
    setDirty(false);
  }

  function run(command: string, arg?: string) {
    if (disabled) return;
    restoreSelection();
    rootRef.current?.focus();
    document.execCommand(command, false, arg);
    emitFromDom();
    rememberSelection();
  }

  async function addLink() {
    const url = await appPrompt({
      title: 'Add link',
      message: 'Web address or store path',
      placeholder: 'https:// or /store/…',
      confirmLabel: 'Add',
    });
    if (!url?.trim()) return;
    let href = url.trim();
    if (!/^(https?:|mailto:|tel:|\/|#)/i.test(href)) href = `https://${href}`;
    run('createLink', href);
  }

  function insertStoreItem(listing: StoreAdminListing) {
    const el = rootRef.current;
    if (!el || disabled) return;
    restoreSelection();
    const href = `/store/${listing.listingId}`;
    const selection = window.getSelection();
    const hasSelection =
      !!selection &&
      !selection.isCollapsed &&
      !!selection.anchorNode &&
      el.contains(selection.anchorNode);
    if (hasSelection) {
      document.execCommand('createLink', false, href);
    } else {
      document.execCommand(
        'insertHTML',
        false,
        `<a href="${escapeHtml(href)}">${escapeHtml(listing.name)}</a>`
      );
    }
    emitFromDom();
    rememberSelection();
    setPickerOpen(false);
    setPickerQuery('');
  }

  return (
    <div className={`store-desc${disabled ? ' is-disabled' : ''}`}>
      <div className="store-desc__bar" role="toolbar" aria-label="Description formatting">
        <button type="button" disabled={disabled} title="Bold" onClick={() => run('bold')}>
          <Bold size={14} />
        </button>
        <button type="button" disabled={disabled} title="Italic" onClick={() => run('italic')}>
          <Italic size={14} />
        </button>
        <button type="button" disabled={disabled} title="Underline" onClick={() => run('underline')}>
          <Underline size={14} />
        </button>
        <span className="store-desc__sep" />
        <button type="button" disabled={disabled} title="Bullets" onClick={() => run('insertUnorderedList')}>
          <List size={14} />
        </button>
        <button
          type="button"
          disabled={disabled}
          title="Numbered list"
          onClick={() => run('insertOrderedList')}
        >
          <ListOrdered size={14} />
        </button>
        <button type="button" disabled={disabled} title="Link" onClick={() => void addLink()}>
          <LinkIcon size={14} />
        </button>
        <div className="store-desc__picker" ref={pickerRef}>
          <button
            type="button"
            disabled={disabled}
            title="Link a store item"
            className={`store-desc__item-btn${pickerOpen ? ' is-on' : ''}`}
            onMouseDown={(event) => {
              event.preventDefault();
              rememberSelection();
            }}
            onClick={() => setPickerOpen((open) => !open)}
          >
            <Package size={14} />
            Item
          </button>
          {pickerOpen ? (
            <div className="store-desc__picker-panel">
              <input
                autoFocus
                className="store-desc__picker-search"
                placeholder="Search store items"
                value={pickerQuery}
                onMouseDown={() => rememberSelection()}
                onChange={(e) => setPickerQuery(e.target.value)}
              />
              {matches.length ? (
                <ul>
                  {matches.map((listing) => (
                    <li key={listing.listingId}>
                      <button
                        type="button"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => insertStoreItem(listing)}
                      >
                        {listing.name}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>No other store items match.</p>
              )}
            </div>
          ) : null}
        </div>
      </div>
      <div
        ref={rootRef}
        className="store-desc__edit"
        contentEditable={disabled ? 'false' : 'true'}
        role="textbox"
        aria-multiline="true"
        aria-label="Product description"
        data-placeholder={placeholder}
        suppressContentEditableWarning
        onMouseUp={rememberSelection}
        onKeyUp={rememberSelection}
        onInput={() => {
          setDirty(true);
          const el = rootRef.current;
          if (el) onHtmlChange?.(normalizeStoredHtml(el.innerHTML));
        }}
      />
      {showSave ? (
      <div className="store-desc__footer">
        <button
          type="button"
          className="store-desc__save"
          disabled={disabled || !dirty}
          onClick={saveFromDom}
        >
          Save
        </button>
      </div>
      ) : null}
    </div>
  );
}
