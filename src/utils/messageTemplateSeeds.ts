import type { MessageCategory, MessageChannel } from './messageTemplateFields';

export type MessageTemplateSeed = {
  systemKey: string;
  name: string;
  description: string;
  channel: MessageChannel;
  category: MessageCategory;
  subject: string;
  body: string;
};

/** Current Scout auto-messages, as editable templates with merge fields. */
export const SYSTEM_TEMPLATE_SEEDS: MessageTemplateSeed[] = [
  {
    systemKey: 'care_outreach_coming_due',
    name: 'Care outreach — coming due',
    description: 'Automatic text from Care Outreach when reminders are coming due.',
    channel: 'sms',
    category: 'scheduling',
    subject: '',
    body: "Hi {{client_first_name}}, it's Dr. {{doctor_last_name}}'s team at {{clinic_name}}! It looks like {{pets}} {{have_has}} a few things coming due, and Dr. {{doctor_last_name}} is already going to be in your neighborhood on {{date_label}} between {{window_start}} and {{window_end}}. Would it be a good time for the team to stop by then?",
  },
  {
    systemKey: 'care_outreach_past_due',
    name: 'Care outreach — past due',
    description: 'Automatic text from Care Outreach / Fill Day when reminders are past due.',
    channel: 'sms',
    category: 'scheduling',
    subject: '',
    body: "Hi {{client_first_name}}, it's Dr. {{doctor_last_name}}'s team at {{clinic_name}}! It looks like {{pets}} {{have_has}} a few things past due, and Dr. {{doctor_last_name}} is going to be in your neighborhood on {{date_label}} between {{window_start}} and {{window_end}}. Would it be a good time for the team to stop by then to get {{pets}} all up to date?",
  },
  {
    systemKey: 'care_outreach_email_subject',
    name: 'Care outreach — email subject',
    description: 'Subject line when Care Outreach is sent as email.',
    channel: 'email',
    category: 'scheduling',
    subject: "Scheduling visit with Dr. {{doctor_last_name}}'s team at {{clinic_name}}",
    body: '',
  },
  {
    systemKey: 'forward_booking_sms',
    name: 'Forward booking follow-up',
    description: 'Automatic text from Forward Booking when offering a neighborhood slot.',
    channel: 'sms',
    category: 'scheduling',
    subject: '',
    body: 'Hi {{client_first_name}}, following up on the request to schedule {{pets}} visit in {{timeframe}}. Would {{date_label}}, between {{window_start}} and {{window_end}} work for you?',
  },
  {
    systemKey: 'forward_booking_email_subject',
    name: 'Forward booking — email subject',
    description: 'Subject line when Forward Booking is sent as email.',
    channel: 'email',
    category: 'scheduling',
    subject: 'Following up on your {{clinic_name}} visit',
    body: '',
  },
  {
    systemKey: 'waitlist_opening_sms',
    name: 'Waitlist — opening',
    description: 'Automatic text when a cancellation opens a waitlist slot.',
    channel: 'sms',
    category: 'scheduling',
    subject: '',
    body: "Hi {{client_first_name}}, it's {{clinic_name}}. We had a cancellation on {{date_label}} and can get {{pets}} in with Dr. {{doctor_last_name}}. Reply here if you'd like us to hold that visit, or tell us a better day.",
  },
  {
    systemKey: 'waitlist_booked_sms',
    name: 'Waitlist — booked',
    description: 'Confirmation text after a waitlist visit is booked.',
    channel: 'sms',
    category: 'scheduling',
    subject: '',
    body: "Hi {{client_first_name}}, it's {{clinic_name}}. You're all set — we booked {{pets}} on {{date_label}} with Dr. {{doctor_last_name}}. We'll come between {{window_start}} and {{window_end}}. Reply here if you need to change anything.",
  },
  {
    systemKey: 'slot_offer_coming_due',
    name: 'Slot offer — coming due',
    description: 'Automatic text when offering a confirmable neighborhood slot.',
    channel: 'sms',
    category: 'scheduling',
    subject: '',
    body: "Hi {{client_first_name}}, it's {{clinic_name}}. Good news — Dr. {{doctor_last_name}} will be in your area on {{date_label}} and can arrive between {{window_start}} and {{window_end}}. {{pets}} {{have_has}} a few things coming due soon, so this is a great chance to get {{pets}} up to date. Tap the link below to confirm this time",
  },
  {
    systemKey: 'slot_offer_past_due',
    name: 'Slot offer — past due',
    description: 'Automatic text when offering a slot for past-due care.',
    channel: 'sms',
    category: 'scheduling',
    subject: '',
    body: "Hi {{client_first_name}}, it's {{clinic_name}}. Good news — Dr. {{doctor_last_name}} will be in your area on {{date_label}} and can arrive between {{window_start}} and {{window_end}}. It looks like {{pets}} {{have_has}} a few things past due, so this is a great chance to get {{pets}} all caught up. Tap the link below to confirm this time",
  },
  {
    systemKey: 'on_my_way_sms',
    name: 'On my way',
    description: 'Automatic text from the calendar when the team is en route.',
    channel: 'sms',
    category: 'scheduling',
    subject: '',
    body: 'Hi it\'s {{tech_first_name}} with {{clinic_name}}. I wanted to let you know we are {{minutes_away}} minutes away!',
  },
  {
    systemKey: 'appointment_request_fallback',
    name: 'Appointment request — received',
    description: 'Fallback text when a request is received but not yet booked.',
    channel: 'sms',
    category: 'scheduling',
    subject: '',
    body: 'This is {{clinic_name}}. We received your appointment request and will follow up shortly.',
  },
  {
    systemKey: 'hold_release_clause',
    name: 'Hold spot release clause',
    description: 'Appended to hold follow-up texts so the slot is not kept forever.',
    channel: 'sms',
    category: 'scheduling',
    subject: '',
    body: 'We will hold this spot until {{hold_deadline}}. If we do not hear back from you by then, we will release it for another client. If another time works better, let us know.',
  },
  {
    systemKey: 'payment_link_email',
    name: 'Payment link — email',
    description: 'Used when sending a Stripe pay link from the client ledger.',
    channel: 'email',
    category: 'billing',
    subject: 'Payment link from {{clinic_name}}',
    body: 'Hi {{client_first_name}},\n\nHere is a secure Stripe link to pay {{amount}} for {{invoice_labels}}:\n\n{{pay_link}}\n\nThank you.',
  },
  {
    systemKey: 'payment_link_sms',
    name: 'Payment link — text',
    description: 'Used when texting a Stripe pay link from the client ledger.',
    channel: 'sms',
    category: 'billing',
    subject: '',
    body: 'Hi {{client_first_name}}, here is a secure link to pay {{amount}} for {{invoice_labels}}: {{pay_link}}',
  },
  {
    systemKey: 'invoice_email',
    name: 'Invoice — email',
    description: 'Short unpaid-invoice email from the client ledger. Embeds the bill and a pay button.',
    channel: 'email',
    category: 'billing',
    subject: 'Your invoice from {{clinic_name}} — {{amount}} due',
    body: `<p>Hi {{client_first_name}},</p>
<p>Here is your invoice from {{clinic_name}}. The balance due is <strong>{{amount}}</strong>.</p>
{{invoice_html}}
<p>Questions? Just reply here.</p>
<p>{{clinic_name}} · {{clinic_phone}}</p>`,
  },
  {
    systemKey: 'receipt_email',
    name: 'Receipt — email',
    description: 'Used when emailing a paid invoice / receipt from the client ledger.',
    channel: 'email',
    category: 'billing',
    subject: 'Your receipt from {{clinic_name}}',
    body: `<p>Hi {{client_first_name}},</p>
<p>Thank you for your payment. Your receipt from {{clinic_name}} is below and attached.</p>
{{invoice_html}}
<p>Questions? Just reply here.</p>
<p>{{clinic_name}} · {{clinic_phone}}</p>`,
  },
  {
    systemKey: 'ledger_email',
    name: 'Ledger — email',
    description:
      'Household ledger emailed from the client record. Omits deleted and voided invoices.',
    channel: 'email',
    category: 'billing',
    subject: 'Your account ledger from {{clinic_name}}',
    body: `<p>Hi {{client_first_name}},</p>
<p>Here is your account ledger from {{clinic_name}}. Current balance: <strong>{{amount}}</strong>.</p>
{{ledger_html}}
<p>Questions? Just reply here.</p>
<p>{{clinic_name}} · {{clinic_phone}}</p>`,
  },
];

export const STARTER_STAFF_TEMPLATES: Array<
  Omit<MessageTemplateSeed, 'systemKey'> & { starterKey: string }
> = [
  {
    starterKey: 'after_visit_note',
    name: 'After-visit note',
    description: 'Short recap staff can send from the chart after a visit.',
    channel: 'email',
    category: 'clinical',
    subject: '{{patient_name}} — note from {{clinic_name}}',
    body: 'Hi {{client_first_name}},\n\nThank you for trusting us with {{patient_name}} today. {{He_She}} did well, and we are here if you have questions about {{his_her}} care.\n\nPlease reply to this email anytime.\n\n{{clinic_name}}',
  },
  {
    starterKey: 'form_request',
    name: 'Please complete this form',
    description: 'Ask the client to fill out a form before the next visit.',
    channel: 'email',
    category: 'clinical',
    subject: 'Form for {{patient_name}}',
    body: 'Hi {{client_first_name}},\n\nPlease complete the attached form for {{patient_name}} and send it back before {{his_her}} next visit. It helps us prepare and keeps the appointment on time.\n\nThank you,\n{{clinic_name}}',
  },
  {
    starterKey: 'chart_text_checkin',
    name: 'Quick check-in',
    description: 'Short text from the chart when you just need a reply.',
    channel: 'sms',
    category: 'clinical',
    subject: '',
    body: 'Hi {{client_first_name}}, it\'s {{clinic_name}}. Checking in on {{patient_name}} — how is {{he_she}} doing? Reply here anytime.',
  },
];
