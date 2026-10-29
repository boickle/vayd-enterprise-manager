// Analytics reports: path is relative to /analytics. Reports are grouped into categories
// (top row); the reports in the selected category show as a second row.
// Most pages are lazy-loaded so the spinner shows immediately when switching tabs.
import React, { type JSX } from 'react';
import PaymentsAnalyticsPage from './pages/PaymentAnalytics';
import RoutingAnalyticsPage from './pages/RoutingAnalytics';

const VeterinaryServicesDeliveredPage = React.lazy(
  () => import('./pages/VeterinaryServicesDelivered')
);
const ProjectedRevenueAnalyticsPage = React.lazy(
  () => import('./pages/ProjectedRevenueAnalytics')
);
const TimeSpentAnalyticsPage = React.lazy(() => import('./pages/TimeSpentAnalytics'));
const SquareReconciliationPage = React.lazy(() => import('./pages/SquareReconciliation'));
const OpenPhoneCallsAnalyticsPage = React.lazy(() => import('./pages/OpenPhoneCallsAnalytics'));
const MembershipPurchasesAnalyticsPage = React.lazy(
  () => import('./pages/MembershipPurchasesAnalytics')
);
const CancellationsAnalyticsPage = React.lazy(() => import('./pages/CancellationsAnalytics'));
const PatientDormancyAnalyticsPage = React.lazy(() => import('./pages/PatientDormancyAnalytics'));
const EmailTrackingAnalyticsPage = React.lazy(() => import('./pages/EmailTrackingAnalytics'));
const CLPerformanceAnalyticsPage = React.lazy(() => import('./pages/CLPerformanceAnalytics'));
const VsdPaymentsMatchAnalyticsPage = React.lazy(
  () => import('./pages/VsdPaymentsMatchAnalytics')
);
const BookingCalendarAnalyticsPage = React.lazy(() => import('./pages/BookingCalendarAnalytics'));
const ForwardBookingAnalyticsPage = React.lazy(() => import('./pages/ForwardBookingAnalytics'));
const ProductionIncentiveAnalyticsPage = React.lazy(
  () => import('./pages/ProductionIncentiveAnalytics')
);
const RoomLoaderDeclinesReportPage = React.lazy(
  () => import('./pages/RoomLoaderDeclinesReportPage')
);
const ProductionOverridesReportPage = React.lazy(
  () => import('./pages/ProductionOverridesReportPage')
);
const CreditsDiscountsReportPage = React.lazy(() => import('./pages/CreditsDiscountsReportPage'));
const SalesTaxReportPage = React.lazy(() => import('./pages/SalesTaxReportPage'));
const SurveyResultsPage = React.lazy(() => import('./pages/SurveyResults'));
const InventoryShrinkReportPage = React.lazy(() => import('./pages/InventoryShrinkReportPage'));
const InventoryCountReportPage = React.lazy(() => import('./pages/InventoryCountReportPage'));
const InventoryExpiringReportPage = React.lazy(() => import('./pages/InventoryExpiringReportPage'));
const InventoryControlledReportPage = React.lazy(
  () => import('./pages/InventoryControlledReportPage')
);
const InventoryActivityPage = React.lazy(() => import('./pages/InventoryActivityPage'));
const InventoryTotalsPage = React.lazy(() => import('./pages/InventoryTotalsPage'));
const InventoryCostReviewsPage = React.lazy(() => import('./pages/InventoryCostReviewsPage'));

export type AnalyticsCategory = {
  id: string;
  label: string;
  description: string;
};

export const ANALYTICS_CATEGORIES: AnalyticsCategory[] = [
  { id: 'financial', label: 'Financial', description: 'Revenue, payments, production, and adjustments.' },
  { id: 'appointments', label: 'Appointments', description: 'Booking, cancellations, and time on the road.' },
  { id: 'communication', label: 'Communication', description: 'Email and phone activity with clients.' },
  { id: 'memberships', label: 'Memberships', description: 'Membership sales and renewals.' },
  { id: 'inventory', label: 'Inventory', description: 'Shrink, counts, expiring stock, and costs.' },
  { id: 'patients', label: 'Patients', description: 'Patients who are slipping away.' },
  { id: 'nps', label: 'NPS', description: 'Client survey results.' },
];

export type AnalyticsTabPage = {
  path: string;
  label: string;
  element: JSX.Element;
  category: string;
  /** One line shown under the report tabs so people know what they're looking at. */
  description?: string;
  role?: string | string[];
  /** Any one of these permissions shows the report; admin logins always see it. */
  permissions?: string[];
};

const STAFF = ['employee', 'admin', 'superadmin'];
const ADMIN = ['admin', 'superadmin'];

export const ANALYTICS_TAB_PAGES: AnalyticsTabPage[] = [
  // Financial
  {
    path: 'payments',
    label: 'Payments',
    category: 'financial',
    description: 'Payments collected by day, method, and doctor.',
    element: <PaymentsAnalyticsPage />,
    role: STAFF,
  },
  {
    path: 'sales-tax',
    label: 'Sales & Tax',
    category: 'financial',
    description: 'Taxable and exempt sales, and the sales and use tax to file.',
    element: <SalesTaxReportPage />,
    role: ADMIN,
  },
  {
    path: 'vsd',
    label: 'Veterinary Services Delivered',
    category: 'financial',
    description: 'Services delivered (production) by doctor and type.',
    element: <VeterinaryServicesDeliveredPage />,
    role: STAFF,
  },
  {
    path: 'vsd-payments',
    label: 'VSD vs Payments',
    category: 'financial',
    description: 'Services delivered compared with money collected.',
    element: <VsdPaymentsMatchAnalyticsPage />,
    role: ADMIN,
  },
  {
    path: 'production-incentive',
    label: 'Production Incentive',
    category: 'financial',
    description: 'Production toward each doctor’s incentive.',
    element: <ProductionIncentiveAnalyticsPage />,
    role: ADMIN,
  },
  {
    path: 'projected-revenue',
    label: 'Projected Revenue',
    category: 'financial',
    description: 'Expected revenue from booked appointments.',
    element: <ProjectedRevenueAnalyticsPage />,
    role: STAFF,
  },
  {
    path: 'room-loader-declines',
    label: 'Room Loader Declines',
    category: 'financial',
    description: 'Recommended items clients declined in Room Loader.',
    element: <RoomLoaderDeclinesReportPage />,
    role: ADMIN,
  },
  {
    path: 'production-overrides',
    label: 'Production Overrides',
    category: 'financial',
    description: 'Charges where production was moved to a different provider.',
    element: <ProductionOverridesReportPage />,
    role: ADMIN,
  },
  {
    path: 'credits-discounts',
    label: 'Credits & Discounts',
    category: 'financial',
    description: 'Credits and discounts given, and by whom.',
    element: <CreditsDiscountsReportPage />,
    role: ADMIN,
  },
  {
    path: 'square-reconciliation',
    label: 'Square Reconciliation',
    category: 'financial',
    description: 'Square deposits matched to payments.',
    element: <SquareReconciliationPage />,
    role: ['superadmin'],
  },

  // Appointments
  {
    path: 'booking-calendar',
    label: 'Booking Calendar',
    category: 'appointments',
    description: 'How full each day is against booking goals.',
    element: <BookingCalendarAnalyticsPage />,
    role: STAFF,
  },
  {
    path: 'appointments',
    label: 'Appointments',
    category: 'appointments',
    description: 'Appointment volume, types, and routing.',
    element: <RoutingAnalyticsPage />,
    role: STAFF,
  },
  {
    path: 'cancellations',
    label: 'Cancellations',
    category: 'appointments',
    description: 'Cancellations and no-shows, with reasons.',
    element: <CancellationsAnalyticsPage />,
    role: STAFF,
  },
  {
    path: 'forward-booking',
    label: 'Forward Booking',
    category: 'appointments',
    description: 'Clients who booked their next visit before leaving.',
    element: <ForwardBookingAnalyticsPage />,
    role: STAFF,
  },
  {
    path: 'time-spent',
    label: 'Time Spent',
    category: 'appointments',
    description: 'Time in appointments versus driving.',
    element: <TimeSpentAnalyticsPage />,
    role: STAFF,
  },
  {
    path: 'cl-performance',
    label: 'CL Performance',
    category: 'appointments',
    description: 'Client liaison bookings and conversions.',
    element: <CLPerformanceAnalyticsPage />,
    role: STAFF,
  },

  // Communication
  {
    path: 'email-tracking',
    label: 'Email Tracking',
    category: 'communication',
    description: 'Emails sent, opened, and clicked.',
    element: <EmailTrackingAnalyticsPage />,
    role: STAFF,
  },
  {
    path: 'openphone-calls',
    label: 'OpenPhone Calls',
    category: 'communication',
    description: 'Call volume, answer rate, and receptionist activity.',
    element: <OpenPhoneCallsAnalyticsPage />,
    role: STAFF,
  },

  // Memberships
  {
    path: 'memberships',
    label: 'Memberships',
    category: 'memberships',
    element: <MembershipPurchasesAnalyticsPage />,
    role: STAFF,
  },

  // Inventory
  {
    path: 'inventory/shrink',
    label: 'Shrink & Accuracy',
    category: 'inventory',
    description: 'What went missing and how reliable counts are.',
    element: <InventoryShrinkReportPage />,
    role: STAFF,
    permissions: ['inventory.count.review'],
  },
  {
    path: 'inventory/counts',
    label: 'Count Report',
    category: 'inventory',
    description: 'Every posted count: expected vs counted, $ off, and who counted.',
    element: <InventoryCountReportPage />,
    role: STAFF,
    permissions: ['inventory.count.review'],
  },
  {
    path: 'inventory/expiring',
    label: 'Expiring',
    category: 'inventory',
    description: 'Lots expiring soon, by office and location.',
    element: <InventoryExpiringReportPage />,
    role: STAFF,
    permissions: ['inventory.expiring.view'],
  },
  {
    path: 'inventory/controlled',
    label: 'Controlled Drugs',
    category: 'inventory',
    description: 'Controlled drugs dispensed, returned and wasted under each doctor.',
    element: <InventoryControlledReportPage />,
    role: STAFF,
    permissions: ['inventory.controlled_report.view'],
  },
  {
    path: 'inventory/activity',
    label: 'Activity',
    category: 'inventory',
    description: 'Every stock movement: received, moved, wasted, sold, counted.',
    element: <InventoryActivityPage />,
    role: STAFF,
    permissions: ['inventory.activity_log.view'],
  },
  {
    path: 'inventory/totals',
    label: 'Inventory Totals',
    category: 'inventory',
    description: 'What’s on hand and what it’s worth.',
    element: <InventoryTotalsPage />,
    role: STAFF,
  },
  {
    path: 'inventory/cost-reviews',
    label: 'Cost Reviews',
    category: 'inventory',
    description: 'Invoice costs that changed and need a price decision.',
    element: <InventoryCostReviewsPage />,
    role: STAFF,
    permissions: ['inventory.cost_review.manage'],
  },

  // Patients
  {
    path: 'patient-dormancy',
    label: 'Patient Dormancy',
    category: 'patients',
    element: <PatientDormancyAnalyticsPage />,
    role: STAFF,
  },

  // NPS
  {
    path: 'survey-results',
    label: 'Survey Results',
    category: 'nps',
    element: <SurveyResultsPage />,
    role: ADMIN,
  },
];

export function getAnalyticsTabPages(): AnalyticsTabPage[] {
  return ANALYTICS_TAB_PAGES;
}

/** Old analytics paths that moved; key and value are relative to the analytics base. */
export const ANALYTICS_LEGACY_REDIRECTS: Record<string, string> = {
  routing: 'appointments',
  'inventory-totals': 'inventory/totals',
  inventory: 'inventory/shrink',
};
