import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  ImageList,
  ImageListItem,
  Menu,
  MenuItem,
  Paper,
  Slider,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDown,
  ArrowUp,
  Bold,
  Braces,
  CopyPlus,
  Image as ImageIcon,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Plus,
  Trash2,
  Underline,
  Upload,
} from 'lucide-react';
import {
  CampaignAsset,
  errorMessage,
  listEmailCampaignAssets,
  uploadEmailCampaignAsset,
} from '../../api/emailCampaigns';
import {
  Align,
  createBlock,
  EmailBlock,
  EmailBlockType,
  EmailDesign,
  FONT_OPTIONS,
  isValidLink,
  MERGE_TAG_OPTIONS,
  newBlockId,
  stripUnsafeHtml,
} from './emailDesign';

const BLOCK_LABELS: Record<EmailBlockType, string> = {
  heading: 'Heading',
  text: 'Text',
  image: 'Image',
  button: 'Button',
  divider: 'Divider',
  spacer: 'Spacer',
  html: 'Custom HTML',
};

type Props = {
  design: EmailDesign;
  onChange: (design: EmailDesign) => void;
  readOnly: boolean;
};

export default function DesignBlocksEditor({ design, onChange, readOnly }: Props) {
  const [addMenu, setAddMenu] = useState<{ anchor: HTMLElement; index: number } | null>(null);

  const setBlocks = (blocks: EmailBlock[]) => onChange({ ...design, blocks });
  const updateBlock = (id: string, patch: Partial<EmailBlock>) =>
    setBlocks(design.blocks.map((b) => (b.id === id ? ({ ...b, ...patch } as EmailBlock) : b)));
  const move = (index: number, delta: number) => {
    const next = [...design.blocks];
    const [item] = next.splice(index, 1);
    next.splice(Math.max(0, Math.min(next.length, index + delta)), 0, item);
    setBlocks(next);
  };
  const insert = (index: number, type: EmailBlockType) => {
    const next = [...design.blocks];
    next.splice(index, 0, createBlock(type));
    setBlocks(next);
    setAddMenu(null);
  };

  return (
    <Stack spacing={1.5}>
      <DesignSettingsPanel design={design} onChange={onChange} readOnly={readOnly} />
      {design.blocks.map((block, index) => (
        <Paper key={block.id} variant="outlined" sx={{ p: 1.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 1 }}>
            <Typography variant="overline" sx={{ flex: 1, lineHeight: 1.5 }}>
              {BLOCK_LABELS[block.type]}
            </Typography>
            {!readOnly ? (
              <>
                <Tooltip title="Add a block above">
                  <IconButton
                    size="small"
                    onClick={(e) => setAddMenu({ anchor: e.currentTarget, index })}
                  >
                    <Plus size={16} />
                  </IconButton>
                </Tooltip>
                <Tooltip title="Move up">
                  <span>
                    <IconButton size="small" disabled={index === 0} onClick={() => move(index, -1)}>
                      <ArrowUp size={16} />
                    </IconButton>
                  </span>
                </Tooltip>
                <Tooltip title="Move down">
                  <span>
                    <IconButton
                      size="small"
                      disabled={index === design.blocks.length - 1}
                      onClick={() => move(index, 1)}
                    >
                      <ArrowDown size={16} />
                    </IconButton>
                  </span>
                </Tooltip>
                <Tooltip title="Duplicate">
                  <IconButton
                    size="small"
                    onClick={() => {
                      const next = [...design.blocks];
                      next.splice(index + 1, 0, { ...block, id: newBlockId() } as EmailBlock);
                      setBlocks(next);
                    }}
                  >
                    <CopyPlus size={16} />
                  </IconButton>
                </Tooltip>
                <Tooltip title="Remove">
                  <IconButton
                    size="small"
                    onClick={() => setBlocks(design.blocks.filter((b) => b.id !== block.id))}
                  >
                    <Trash2 size={16} />
                  </IconButton>
                </Tooltip>
              </>
            ) : null}
          </Box>
          <BlockForm
            block={block}
            onChange={(patch) => updateBlock(block.id, patch)}
            readOnly={readOnly}
          />
        </Paper>
      ))}
      {!readOnly ? (
        <Button
          variant="outlined"
          startIcon={<Plus size={18} />}
          onClick={(e) => setAddMenu({ anchor: e.currentTarget, index: design.blocks.length })}
        >
          Add block
        </Button>
      ) : null}
      <Menu anchorEl={addMenu?.anchor} open={!!addMenu} onClose={() => setAddMenu(null)}>
        {(Object.keys(BLOCK_LABELS) as EmailBlockType[]).map((type) => (
          <MenuItem key={type} onClick={() => addMenu && insert(addMenu.index, type)}>
            {BLOCK_LABELS[type]}
          </MenuItem>
        ))}
      </Menu>
    </Stack>
  );
}

function DesignSettingsPanel({ design, onChange, readOnly }: Props) {
  const s = design.settings;
  const set = (patch: Partial<EmailDesign['settings']>) =>
    onChange({ ...design, settings: { ...s, ...patch } });
  return (
    <Paper variant="outlined" sx={{ p: 1.5 }}>
      <Typography variant="overline">Email style</Typography>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(4, 1fr)' },
          gap: 1.5,
          mt: 1,
        }}
      >
        <ColorField
          label="Background"
          value={s.backgroundColor}
          onChange={(v) => set({ backgroundColor: v })}
          disabled={readOnly}
        />
        <ColorField
          label="Content"
          value={s.contentBackgroundColor}
          onChange={(v) => set({ contentBackgroundColor: v })}
          disabled={readOnly}
        />
        <ColorField
          label="Text"
          value={s.textColor}
          onChange={(v) => set({ textColor: v })}
          disabled={readOnly}
        />
        <ColorField
          label="Links"
          value={s.linkColor}
          onChange={(v) => set({ linkColor: v })}
          disabled={readOnly}
        />
      </Box>
      <TextField
        select
        fullWidth
        size="small"
        label="Font"
        value={s.fontFamily}
        onChange={(e) => set({ fontFamily: e.target.value })}
        disabled={readOnly}
        sx={{ mt: 1.5 }}
      >
        {FONT_OPTIONS.map((f) => (
          <MenuItem key={f.value} value={f.value} style={{ fontFamily: f.value }}>
            {f.label}
          </MenuItem>
        ))}
      </TextField>
      <TextField
        fullWidth
        size="small"
        label="Footer (HTML allowed; the unsubscribe link is added automatically)"
        value={s.footerHtml}
        onChange={(e) => set({ footerHtml: e.target.value })}
        disabled={readOnly}
        multiline
        minRows={1}
        sx={{ mt: 1.5 }}
      />
    </Paper>
  );
}

function ColorField({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <TextField
      size="small"
      label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      InputProps={{
        startAdornment: (
          <input
            type="color"
            aria-label={`${label} color`}
            value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#ffffff'}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
            style={{
              width: 24,
              height: 24,
              border: 0,
              padding: 0,
              marginRight: 8,
              background: 'none',
            }}
          />
        ),
      }}
    />
  );
}

function AlignPicker({
  value,
  onChange,
  disabled,
}: {
  value: Align;
  onChange: (a: Align) => void;
  disabled?: boolean;
}) {
  return (
    <ToggleButtonGroup
      size="small"
      exclusive
      value={value}
      onChange={(_e, v) => v && onChange(v)}
      disabled={disabled}
    >
      <ToggleButton value="left" aria-label="Align left">
        <AlignLeft size={16} />
      </ToggleButton>
      <ToggleButton value="center" aria-label="Align center">
        <AlignCenter size={16} />
      </ToggleButton>
      <ToggleButton value="right" aria-label="Align right">
        <AlignRight size={16} />
      </ToggleButton>
    </ToggleButtonGroup>
  );
}

export function MergeTagButton({
  onInsert,
  disabled,
}: {
  onInsert: (tag: string) => void;
  disabled?: boolean;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <>
      <Tooltip title="Insert a merge tag">
        <span>
          <IconButton
            size="small"
            disabled={disabled}
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => setAnchor(e.currentTarget)}
          >
            <Braces size={16} />
          </IconButton>
        </span>
      </Tooltip>
      <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)}>
        {MERGE_TAG_OPTIONS.map((m) => (
          <MenuItem
            key={m.tag}
            onClick={() => {
              setAnchor(null);
              onInsert(m.tag);
            }}
          >
            <Box>
              <Typography variant="body2">{m.label}</Typography>
              <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
                {m.tag}
              </Typography>
            </Box>
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}

function Row({ children }: { children: ReactNode }) {
  return (
    <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>{children}</Box>
  );
}

function BlockForm({
  block,
  onChange,
  readOnly,
}: {
  block: EmailBlock;
  onChange: (patch: Partial<EmailBlock>) => void;
  readOnly: boolean;
}) {
  switch (block.type) {
    case 'heading':
      return (
        <Stack spacing={1}>
          <TextField
            size="small"
            fullWidth
            value={block.text}
            onChange={(e) => onChange({ text: e.target.value })}
            disabled={readOnly}
            InputProps={{
              endAdornment: (
                <MergeTagButton
                  disabled={readOnly}
                  onInsert={(tag) => onChange({ text: `${block.text}${tag}` })}
                />
              ),
            }}
          />
          <Row>
            <ToggleButtonGroup
              size="small"
              exclusive
              value={block.level}
              onChange={(_e, v) => v && onChange({ level: v })}
              disabled={readOnly}
            >
              <ToggleButton value={1}>Large</ToggleButton>
              <ToggleButton value={2}>Small</ToggleButton>
            </ToggleButtonGroup>
            <AlignPicker
              value={block.align}
              onChange={(align) => onChange({ align })}
              disabled={readOnly}
            />
            <ColorField
              label="Color (optional)"
              value={block.color}
              onChange={(color) => onChange({ color })}
              disabled={readOnly}
            />
          </Row>
        </Stack>
      );
    case 'text':
      return (
        <Stack spacing={1}>
          <RichTextEditor
            key={block.id}
            html={block.html}
            onChange={(html) => onChange({ html })}
            readOnly={readOnly}
          />
          <Row>
            <AlignPicker
              value={block.align}
              onChange={(align) => onChange({ align })}
              disabled={readOnly}
            />
          </Row>
        </Stack>
      );
    case 'image':
      return <ImageBlockForm block={block} onChange={onChange} readOnly={readOnly} />;
    case 'button':
      return (
        <Stack spacing={1}>
          <Row>
            <TextField
              size="small"
              label="Label"
              value={block.label}
              onChange={(e) => onChange({ label: e.target.value })}
              disabled={readOnly}
              sx={{ flex: 1, minWidth: 160 }}
            />
            <TextField
              size="small"
              label="Link"
              value={block.href}
              onChange={(e) => onChange({ href: e.target.value })}
              disabled={readOnly}
              error={!isValidLink(block.href)}
              helperText={!isValidLink(block.href) ? 'Enter a full https:// link' : undefined}
              sx={{ flex: 2, minWidth: 220 }}
            />
          </Row>
          <Row>
            <ColorField
              label="Button"
              value={block.backgroundColor}
              onChange={(v) => onChange({ backgroundColor: v })}
              disabled={readOnly}
            />
            <ColorField
              label="Text"
              value={block.textColor}
              onChange={(v) => onChange({ textColor: v })}
              disabled={readOnly}
            />
            <AlignPicker
              value={block.align}
              onChange={(align) => onChange({ align })}
              disabled={readOnly}
            />
          </Row>
        </Stack>
      );
    case 'divider':
      return (
        <ColorField
          label="Line color"
          value={block.color}
          onChange={(color) => onChange({ color })}
          disabled={readOnly}
        />
      );
    case 'spacer':
      return (
        <Box sx={{ px: 1 }}>
          <Typography variant="caption">Height: {block.height}px</Typography>
          <Slider
            size="small"
            min={4}
            max={120}
            value={block.height}
            onChange={(_e, v) => onChange({ height: v as number })}
            disabled={readOnly}
          />
        </Box>
      );
    case 'html':
      return (
        <TextField
          fullWidth
          multiline
          minRows={4}
          value={block.html}
          onChange={(e) => onChange({ html: e.target.value })}
          disabled={readOnly}
          InputProps={{ sx: { fontFamily: 'monospace', fontSize: 13 } }}
          helperText="Placed inside the email's content column. Use tables and inline styles for best results."
        />
      );
  }
}

function ImageBlockForm({
  block,
  onChange,
  readOnly,
}: {
  block: Extract<EmailBlock, { type: 'image' }>;
  onChange: (patch: Partial<EmailBlock>) => void;
  readOnly: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [library, setLibrary] = useState<CampaignAsset[] | null>(null);

  const upload = async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      const asset = await uploadEmailCampaignAsset(file);
      onChange({ src: asset.url, alt: block.alt || file.name.replace(/\.[a-z]+$/i, '') });
    } catch (err) {
      setError(errorMessage(err, 'Upload failed.'));
    } finally {
      setUploading(false);
    }
  };

  const openLibrary = async () => {
    setLibrary([]);
    try {
      setLibrary(await listEmailCampaignAssets());
    } catch (err) {
      setLibrary(null);
      setError(errorMessage(err, 'Could not load images.'));
    }
  };

  return (
    <Stack spacing={1}>
      {block.src ? (
        <Box sx={{ textAlign: block.align }}>
          <img
            src={block.src}
            alt={block.alt}
            style={{ maxWidth: `${block.widthPercent}%`, maxHeight: 180, borderRadius: 4 }}
          />
        </Box>
      ) : null}
      <Row>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void upload(f);
          }}
        />
        <Button
          size="small"
          variant="outlined"
          startIcon={<Upload size={16} />}
          disabled={readOnly || uploading}
          onClick={() => fileRef.current?.click()}
        >
          {uploading ? 'Uploading…' : 'Upload image'}
        </Button>
        <Button
          size="small"
          startIcon={<ImageIcon size={16} />}
          disabled={readOnly}
          onClick={() => void openLibrary()}
        >
          Choose uploaded
        </Button>
      </Row>
      {error ? <Alert severity="error">{error}</Alert> : null}
      <TextField
        size="small"
        label="Image URL"
        value={block.src}
        onChange={(e) => onChange({ src: e.target.value })}
        disabled={readOnly}
      />
      <Row>
        <TextField
          size="small"
          label="Alt text (shown if images are blocked)"
          value={block.alt}
          onChange={(e) => onChange({ alt: e.target.value })}
          disabled={readOnly}
          sx={{ flex: 1, minWidth: 200 }}
        />
        <TextField
          size="small"
          label="Link (optional)"
          value={block.href}
          onChange={(e) => onChange({ href: e.target.value })}
          disabled={readOnly}
          error={!!block.href && !isValidLink(block.href)}
          sx={{ flex: 1, minWidth: 200 }}
        />
      </Row>
      <Row>
        <Box sx={{ flex: 1, minWidth: 180, px: 1 }}>
          <Typography variant="caption">Width: {block.widthPercent}%</Typography>
          <Slider
            size="small"
            min={10}
            max={100}
            step={5}
            value={block.widthPercent}
            onChange={(_e, v) => onChange({ widthPercent: v as number })}
            disabled={readOnly}
          />
        </Box>
        <AlignPicker
          value={block.align}
          onChange={(align) => onChange({ align })}
          disabled={readOnly}
        />
      </Row>
      <Dialog open={library !== null} onClose={() => setLibrary(null)} maxWidth="md" fullWidth>
        <DialogTitle>Uploaded images</DialogTitle>
        <DialogContent>
          {library && library.length === 0 ? (
            <Typography color="text.secondary">No images uploaded yet.</Typography>
          ) : (
            <ImageList cols={4} gap={8}>
              {(library ?? []).map((a) => (
                <ImageListItem
                  key={a.id}
                  sx={{
                    cursor: 'pointer',
                    border: 1,
                    borderColor: 'divider',
                    borderRadius: 1,
                    overflow: 'hidden',
                  }}
                  onClick={() => {
                    onChange({
                      src: a.url,
                      alt: block.alt || a.filename.replace(/\.[a-z]+$/i, ''),
                    });
                    setLibrary(null);
                  }}
                >
                  <img
                    src={a.url}
                    alt={a.filename}
                    loading="lazy"
                    style={{ objectFit: 'cover', height: 120 }}
                  />
                </ImageListItem>
              ))}
            </ImageList>
          )}
        </DialogContent>
      </Dialog>
    </Stack>
  );
}

function RichTextEditor({
  html,
  onChange,
  readOnly,
}: {
  html: string;
  onChange: (html: string) => void;
  readOnly: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const savedRange = useRef<Range | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (el && el.innerHTML !== html && document.activeElement !== el)
      el.innerHTML = stripUnsafeHtml(html);
  }, [html]);

  const emit = () => {
    if (ref.current) onChange(ref.current.innerHTML);
  };

  const saveSelection = () => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount && ref.current?.contains(sel.anchorNode))
      savedRange.current = sel.getRangeAt(0).cloneRange();
  };

  const restoreSelection = () => {
    ref.current?.focus();
    const sel = window.getSelection();
    if (sel && savedRange.current) {
      sel.removeAllRanges();
      sel.addRange(savedRange.current);
    }
  };

  const exec = (command: string, value?: string) => {
    restoreSelection();
    document.execCommand(command, false, value);
    emit();
  };

  const tool = (label: string, icon: ReactNode, onClick: () => void) => (
    <Tooltip title={label}>
      <span>
        <IconButton
          size="small"
          disabled={readOnly}
          onMouseDown={(e) => e.preventDefault()}
          onClick={onClick}
        >
          {icon}
        </IconButton>
      </span>
    </Tooltip>
  );

  return (
    <Paper variant="outlined">
      <Box
        sx={{
          display: 'flex',
          gap: 0.25,
          px: 0.5,
          py: 0.25,
          borderBottom: 1,
          borderColor: 'divider',
          flexWrap: 'wrap',
        }}
      >
        {tool('Bold', <Bold size={16} />, () => exec('bold'))}
        {tool('Italic', <Italic size={16} />, () => exec('italic'))}
        {tool('Underline', <Underline size={16} />, () => exec('underline'))}
        {tool('Link', <LinkIcon size={16} />, () => {
          saveSelection();
          const url = window.prompt('Link address (https://…)', 'https://');
          if (!url) return;
          if (!isValidLink(url)) {
            window.alert('Enter a full link starting with https://');
            return;
          }
          exec('createLink', url);
        })}
        {tool('Bulleted list', <List size={16} />, () => exec('insertUnorderedList'))}
        {tool('Numbered list', <ListOrdered size={16} />, () => exec('insertOrderedList'))}
        <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />
        <MergeTagButton disabled={readOnly} onInsert={(tag) => exec('insertText', tag)} />
      </Box>
      <Box
        ref={ref}
        contentEditable={!readOnly}
        suppressContentEditableWarning
        onInput={emit}
        onFocus={() => document.execCommand('defaultParagraphSeparator', false, 'p')}
        onBlur={() => {
          saveSelection();
          emit();
        }}
        onKeyUp={saveSelection}
        onMouseUp={saveSelection}
        onPaste={(e) => {
          e.preventDefault();
          const text = e.clipboardData.getData('text/plain');
          document.execCommand('insertText', false, text);
          emit();
        }}
        sx={{
          minHeight: 96,
          p: 1.5,
          outline: 'none',
          fontSize: 15,
          lineHeight: 1.6,
          '& p': { m: 0, mb: 1.5 },
          '& a': { color: 'primary.main' },
        }}
      />
    </Paper>
  );
}
