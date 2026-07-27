import { useMemo, useState } from 'react';
import { useAuth } from '../auth/useAuth';
import { createMailOrder } from '../api/mailOrder';
import './MailOrderForm.css';

const STAFF_EMAILS = [
  'karen@vetatyourdoor.com',
  'deanna@vetatyourdoor.com',
  'sara@vetatyourdoor.com',
  'meredith@vetatyourdoor.com',
  'holly@vetatyourdoor.com',
  'mel@vetatyourdoor.com',
  'betsy@vetatyourdoor.com',
  'maggie@vetatyourdoor.com',
  'morgan@vetatyourdoor.com',
  'mariah@vetatyourdoor.com',
  'amessina@vetatyourdoor.com',
  'julie@vetatyourdoor.com',
  'heather@vetatyourdoor.com',
  'hailey@vetatyourdoor.com',
  'deirdre@vetatyourdoor.com',
  'jackie@vetatyourdoor.com',
  'bquinn@vetatyourdoor.com',
  'kate@vetatyourdoor.com',
  'lindsey@vetatyourdoor.com',
  'lbenson@vetatyourdoor.com',
  'hlloyd@vetatyourdoor.com',
  'tina@vetatyourdoor.com',
];

const DOCTOR_APPROVAL = [
  'No approval needed / Already Approved',
  'Messina, Abigail',
  'Crispell, Heather',
  'Greenlaw, Julie',
  'Quinn, Brian',
  'Cheeseman, Kate',
  'Benson, Lisa',
  'Petersen, Nina',
];

const SHIPPING = [
  'Shipping already charged',
  'Appointment Courtesy Shipping',
  'Pick-up In Brunswick',
];

type FormState = {
  staffFirstName: string;
  staffLastName: string;
  staffEmail: string;
  clientFirstName: string;
  clientLastName: string;
  clientEmail: string;
  shippingAddress: string;
  petNames: string;
  orderDetails: string;
  weight: string;
  scriptInEvet: string;
  paymentFollowUp: string;
  doctorApproval: string;
  shippingOption: string;
  otherInfo: string;
  takePaymentNow: string;
  paymentAmount: string;
};

const empty = (): FormState => ({
  staffFirstName: '',
  staffLastName: '',
  staffEmail: '',
  clientFirstName: '',
  clientLastName: '',
  clientEmail: '',
  shippingAddress: '',
  petNames: '',
  orderDetails: '',
  weight: '',
  scriptInEvet: '',
  paymentFollowUp: '',
  doctorApproval: '',
  shippingOption: '',
  otherInfo: '',
  takePaymentNow: 'No',
  paymentAmount: '',
});

export default function MailOrderFormPage() {
  const { user } = useAuth() as { user?: { firstName?: string; lastName?: string; email?: string } };
  const [form, setForm] = useState<FormState>(() => {
    const base = empty();
    return {
      ...base,
      staffFirstName: user?.firstName?.trim() || '',
      staffLastName: user?.lastName?.trim() || '',
      staffEmail: user?.email?.trim() || '',
    };
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [submittedId, setSubmittedId] = useState<number | null>(null);

  const title = useMemo(() => 'Staff Mail Order Form', []);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setError(null);
  }

  function validate(): string | null {
    if (!form.staffFirstName.trim() || !form.staffLastName.trim()) return 'Enter your name.';
    if (!form.clientFirstName.trim() || !form.clientLastName.trim()) return 'Enter the client name.';
    if (!form.clientEmail.trim() || !form.clientEmail.includes('@')) return 'Enter a valid client email.';
    if (!form.shippingAddress.trim()) return 'Enter the eVet shipping address.';
    if (!form.petNames.trim()) return 'Enter pet name(s).';
    if (!form.orderDetails.trim()) return 'Enter what you are ordering.';
    if (!form.weight.trim()) return 'Enter most current weight.';
    if (!form.scriptInEvet) return 'Is the script in eVet yet?';
    if (!form.paymentFollowUp) return 'Select payment follow-up.';
    if (!form.doctorApproval) return 'Select doctor approval.';
    if (!form.shippingOption) return 'Select shipping option.';
    if (!form.takePaymentNow) return 'Select whether to take payment now.';
    if (form.takePaymentNow === 'Yes' && !form.paymentAmount.trim()) {
      return 'Enter the amount to charge (including shipping).';
    }
    return null;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const err = validate();
    if (err) {
      setError(err);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const amountCents =
        form.takePaymentNow === 'Yes'
          ? Math.round(parseFloat(form.paymentAmount.replace(/[^0-9.]/g, '')) * 100)
          : undefined;
      const { id } = await createMailOrder({
        clientEmail: form.clientEmail.trim(),
        paymentAmountCents: Number.isFinite(amountCents) ? amountCents : undefined,
        formData: {
          ...form,
          note:
            'Ecwid order creation + eVet inventory pick will be wired next. Submission is saved for the mail-order team.',
        },
      });
      setSubmittedId(id);
      setForm((f) => ({
        ...empty(),
        staffFirstName: f.staffFirstName,
        staffLastName: f.staffLastName,
        staffEmail: f.staffEmail,
      }));
    } catch (ex: unknown) {
      const msg =
        (ex as { response?: { data?: { message?: string | string[] } } })?.response?.data
          ?.message || 'Could not submit mail order.';
      setError(Array.isArray(msg) ? msg.join(', ') : String(msg));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mail-order-page">
      <header className="mail-order-page__header">
        <h1>{title}</h1>
        <p>
          Staff use this to request a mail order for a client. Submissions are saved in-app (replacing
          JotForm). Ecwid shipping-label creation will replace the Zapier step next.
        </p>
      </header>

      {submittedId != null ? (
        <p className="mail-order-page__success" role="status">
          Mail order #{submittedId} submitted. You can enter another below.
        </p>
      ) : null}
      {error ? (
        <p className="mail-order-page__error" role="alert">
          {error}
        </p>
      ) : null}

      <form className="mail-order-form" onSubmit={(e) => void onSubmit(e)}>
        <fieldset>
          <legend>Staff</legend>
          <label>
            First name
            <input value={form.staffFirstName} onChange={(e) => set('staffFirstName', e.target.value)} />
          </label>
          <label>
            Last name
            <input value={form.staffLastName} onChange={(e) => set('staffLastName', e.target.value)} />
          </label>
          <label>
            Your email
            <select value={form.staffEmail} onChange={(e) => set('staffEmail', e.target.value)}>
              <option value="">Please select</option>
              {STAFF_EMAILS.map((em) => (
                <option key={em} value={em}>
                  {em}
                </option>
              ))}
            </select>
          </label>
        </fieldset>

        <fieldset>
          <legend>Client</legend>
          <label>
            Client first name
            <input value={form.clientFirstName} onChange={(e) => set('clientFirstName', e.target.value)} />
          </label>
          <label>
            Client last name
            <input value={form.clientLastName} onChange={(e) => set('clientLastName', e.target.value)} />
          </label>
          <label>
            Client email
            <input
              type="email"
              value={form.clientEmail}
              onChange={(e) => set('clientEmail', e.target.value)}
            />
          </label>
          <label>
            eVet SHIPPING address
            <textarea
              rows={3}
              value={form.shippingAddress}
              onChange={(e) => set('shippingAddress', e.target.value)}
              placeholder="Confirm this is the shipping address (PO Boxes ok)."
            />
          </label>
        </fieldset>

        <fieldset>
          <legend>Order</legend>
          <label>
            Pet name(s)
            <input value={form.petNames} onChange={(e) => set('petNames', e.target.value)} />
          </label>
          <label>
            What are you ordering?
            <textarea
              rows={4}
              value={form.orderDetails}
              onChange={(e) => set('orderDetails', e.target.value)}
            />
          </label>
          <label>
            Most current weight
            <input value={form.weight} onChange={(e) => set('weight', e.target.value)} />
          </label>
          <label>
            Is the script in eVet yet?
            <select value={form.scriptInEvet} onChange={(e) => set('scriptInEvet', e.target.value)}>
              <option value="">Please select</option>
              <option value="Yes">Yes</option>
              <option value="No">No</option>
            </select>
          </label>
          <label>
            Payment follow-up
            <select
              value={form.paymentFollowUp}
              onChange={(e) => set('paymentFollowUp', e.target.value)}
            >
              <option value="">Please select</option>
              <option value="No - already paid">No - already paid</option>
              <option value="Client Liaison Team">Client Liaison Team</option>
            </select>
          </label>
          <label>
            Doctor approval
            <select
              value={form.doctorApproval}
              onChange={(e) => set('doctorApproval', e.target.value)}
            >
              <option value="">Please select</option>
              {DOCTOR_APPROVAL.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
          <label>
            Shipping options
            <select
              value={form.shippingOption}
              onChange={(e) => set('shippingOption', e.target.value)}
            >
              <option value="">Please select</option>
              {SHIPPING.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label>
            Other info for mail-order team (not seen by client)
            <textarea rows={3} value={form.otherInfo} onChange={(e) => set('otherInfo', e.target.value)} />
          </label>
        </fieldset>

        <fieldset>
          <legend>Payment</legend>
          <label>
            Take payment now for the client?
            <select value={form.takePaymentNow} onChange={(e) => set('takePaymentNow', e.target.value)}>
              <option value="No">No</option>
              <option value="Yes">Yes</option>
            </select>
          </label>
          {form.takePaymentNow === 'Yes' ? (
            <label>
              Amount including shipping ($)
              <input
                value={form.paymentAmount}
                onChange={(e) => set('paymentAmount', e.target.value)}
                placeholder="Mirror what you entered in eVet"
              />
              <span className="mail-order-form__hint">
                On-form Stripe card charge can be wired next; amount is recorded on the submission.
                Enter the payment in eVet too.
              </span>
            </label>
          ) : null}
        </fieldset>

        <button type="submit" className="mail-order-form__submit" disabled={busy}>
          {busy ? 'Submitting…' : 'Submit mail order'}
        </button>
      </form>
    </div>
  );
}
