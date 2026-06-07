import { buildPhoneDialHref, buildPhoneSmsHref } from '../utils/quoContact';

export type PreviewPopoverClientContact = {
  phone: string;
  /** Visit doctor Quo line (`from` on deep links). */
  fromLine?: string | null;
};

type Props = {
  contact: PreviewPopoverClientContact | null | undefined;
};

/** Call / text client row on scheduler placement preview popovers. */
export function PreviewPopoverClientContact({ contact }: Props) {
  const phone = contact?.phone?.trim() || '';
  if (!phone) return null;
  const fromLine = contact?.fromLine ?? null;

  return (
    <div className="scheduler-edit-preview-popover-contact">
      <span className="scheduler-edit-preview-popover-contact-phone">{phone}</span>
      <div className="scheduler-edit-preview-popover-contact-actions">
        <a
          className="scheduler-edit-preview-popover-contact-btn"
          href={buildPhoneDialHref(phone, { fromLine })}
        >
          Call client
        </a>
        <a
          className="scheduler-edit-preview-popover-contact-btn"
          href={buildPhoneSmsHref(phone, { fromLine })}
        >
          Text client
        </a>
      </div>
    </div>
  );
}
