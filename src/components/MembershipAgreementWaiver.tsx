import SignaturePad from './SignaturePad';
import {
  buildMembershipAgreementText,
  defaultChatHoursOfOperation,
  type ChatHoursOfOperation,
} from '../utils/chatHours';
import './MembershipAgreementWaiver.css';

export const MEMBERSHIP_AGREEMENT_CHECKBOX_LABEL =
  'I have read and agree to the Vet At Your Door Membership Plan terms. I understand this membership bills monthly or annually, renews automatically, and that you will charge the card on file on an ongoing basis. If I cancel early, I am responsible for services used that exceed payments made.';

export function hasDrawnMembershipSignature(dataUrl: string | null | undefined): boolean {
  return Boolean(dataUrl?.startsWith('data:image/'));
}

type Props = {
  hours?: ChatHoursOfOperation | null;
  accepted: boolean;
  signature: string;
  signatureDrawing: string;
  onAcceptedChange: (accepted: boolean) => void;
  onSignatureChange: (signature: string) => void;
  onSignatureDrawingChange: (dataUrl: string) => void;
  disabled?: boolean;
};

export default function MembershipAgreementWaiver({
  hours,
  accepted,
  signature,
  signatureDrawing,
  onAcceptedChange,
  onSignatureChange,
  onSignatureDrawingChange,
  disabled = false,
}: Props) {
  const text = buildMembershipAgreementText(hours ?? defaultChatHoursOfOperation());
  const paragraphs = text.split('\n\n').filter((p) => p.trim());

  return (
    <section className="membership-waiver" aria-labelledby="membership-waiver-title">
      <h3 id="membership-waiver-title">Membership agreement — client must sign</h3>
      <p className="membership-waiver__hint">
        Hand this screen to the owner. They need to read the waiver, check the box, draw their
        signature, and type their name before we can enroll and charge them ongoing.
      </p>
      <div className="membership-waiver__scroll" tabIndex={0}>
        {paragraphs.map((paragraph, index) => {
          const isHeading =
            paragraph === 'Vet At Your Door Membership Agreement' ||
            paragraph === 'Membership Plans' ||
            paragraph === 'Priority 7-Day Support' ||
            paragraph === 'VCPR Requirements and Limitations for New or Lapsed Patients' ||
            paragraph === 'Membership Rules' ||
            paragraph === 'Plan Change and Upgrade Limitations' ||
            paragraph === 'Scheduling and Availability' ||
            paragraph === 'Access and Technology Requirements' ||
            paragraph === 'Client Conduct' ||
            paragraph === 'Membership Scope';
          return isHeading ? (
            <p key={index} className="membership-waiver__heading">
              {paragraph}
            </p>
          ) : (
            <p key={index}>{paragraph}</p>
          );
        })}
      </div>
      <label className="membership-waiver__check">
        <input
          type="checkbox"
          checked={accepted}
          onChange={(e) => onAcceptedChange(e.target.checked)}
          disabled={disabled}
        />
        <span>{MEMBERSHIP_AGREEMENT_CHECKBOX_LABEL}</span>
      </label>
      <div className="membership-waiver__draw">
        <span>Draw your signature</span>
        <SignaturePad onChange={onSignatureDrawingChange} disabled={disabled} />
        {hasDrawnMembershipSignature(signatureDrawing) ? null : (
          <em>Sign in the box with a finger or stylus.</em>
        )}
      </div>
      <label className="membership-waiver__sign">
        <span>Type your full legal name</span>
        <input
          type="text"
          value={signature}
          onChange={(e) => onSignatureChange(e.target.value)}
          placeholder="Owner types their full legal name"
          disabled={disabled}
          autoComplete="name"
        />
        <em>The drawing and typed name together are their electronic signature.</em>
      </label>
    </section>
  );
}
