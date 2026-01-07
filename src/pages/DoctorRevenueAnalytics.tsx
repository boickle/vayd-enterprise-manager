// src/pages/DoctorRevenueAnalytics.tsx
import React, { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Card,
  CardHeader,
  CardContent,
  Typography,
  MenuItem,
  Select,
  FormControl,
  InputLabel,
  Alert,
  Grid,
  Backdrop,
  CircularProgress,
  Stack,
  Button,
  Popover,
} from '@mui/material';
import { CalendarMonth, Refresh } from '@mui/icons-material';
import { LocalizationProvider, DatePicker } from '@mui/x-date-pickers';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import dayjs, { Dayjs } from 'dayjs';
import utc from 'dayjs/plugin/utc';
import {
  ResponsiveContainer,
  LineChart,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Line,
  ReferenceLine,
  Legend,
} from 'recharts';

import { useAuth } from '../auth/useAuth';
import { fetchPrimaryProviders, type Provider } from '../api/employee';
import {
  fetchDoctorRevenueSeries,
  fetchOpsStatsAnalytics,
  type DoctorRevenueSeriesResponse,
  type OpsStatPoint,
} from '../api/opsStats';
import { fetchPaymentsAnalytics, type PaymentPoint } from '../api/payments';

dayjs.extend(utc);

// ---------- utils ----------
function toISODate(d: Dayjs) {
  return d.utc().format('YYYY-MM-DD');
}
function fmtUSD(n: number) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(
    Number(n) || 0
  );
}

type DateRange = {
  from: Dayjs;
  to: Dayjs;
};

type ChartDataPoint = {
  date: string;
  total: number;
  payments: number;
};

type PointsChartDataPoint = {
  date: string;
  points: number;
  goal: number;
};

type RevenuePerPointChartDataPoint = {
  date: string;
  revenuePerPoint: number;
};


// Presets
const now = dayjs();
const PRESETS: Record<string, () => DateRange> = {
  '7D': () => ({ from: now.startOf('day').subtract(6, 'day'), to: now.startOf('day') }),
  '30D': () => ({ from: now.startOf('day').subtract(29, 'day'), to: now.startOf('day') }),
  '90D': () => ({ from: now.startOf('day').subtract(89, 'day'), to: now.startOf('day') }),
  YTD: () => ({ from: now.startOf('year'), to: now.startOf('day') }),
};

const toNum = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

const normalizeProvider = (p: any): Provider => {
  const parts: string[] = [];
  if (p?.firstName) parts.push(p.firstName);
  if (p?.middleInitial || p?.middleName) {
    const middle = p.middleInitial || (p.middleName ? p.middleName.charAt(0).toUpperCase() : '');
    if (middle) parts.push(middle);
  }
  if (p?.lastName) parts.push(p.lastName);
  
  const name = parts.length > 0 
    ? parts.join(' ').trim()
    : p?.name || `Provider ${p?.id ?? ''}`;
  
  return {
    id: p?.id ?? p?.pimsId ?? p?.employeeId,
    name,
    email: p?.email ?? '',
    dailyRevenueGoal: toNum(p?.dailyRevenueGoal),
    bonusRevenueGoal: toNum(p?.bonusRevenueGoal),
    dailyPointGoal: toNum(p?.dailyPointGoal),
    weeklyPointGoal: toNum(p?.weeklyPointGoal),
    isProvider: p?.isProvider ?? p?.is_provider ?? true,
    isActive: p?.isActive ?? p?.is_active ?? p?.active ?? true,
  };
};

// Combine multiple series into one by date
function combineSeries(seriesArray: Array<{ date: string; total: number }[]>): ChartDataPoint[] {
  const dateMap = new Map<string, number>();
  
  seriesArray.forEach((series) => {
    series.forEach((point) => {
      const existing = dateMap.get(point.date) || 0;
      dateMap.set(point.date, existing + (Number(point.total) || 0));
    });
  });
  
  return Array.from(dateMap.entries())
    .map(([date, total]) => ({ date, total }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// Calculate linear regression trend line
function calculateTrendLine(data: ChartDataPoint[], field: 'total' | 'payments' = 'total'): number[] {
  if (data.length < 2) {
    return data.map(() => 0);
  }
  
  // Convert dates to numeric values (days since first date)
  const numericData = data.map((point, index) => ({
    x: index,
    y: point[field] || 0,
  }));
  
  const n = numericData.length;
  const sumX = numericData.reduce((sum, p) => sum + p.x, 0);
  const sumY = numericData.reduce((sum, p) => sum + p.y, 0);
  const sumXY = numericData.reduce((sum, p) => sum + p.x * p.y, 0);
  const sumXX = numericData.reduce((sum, p) => sum + p.x * p.x, 0);
  
  // Avoid division by zero
  const denominator = n * sumXX - sumX * sumX;
  if (denominator === 0) {
    return data.map(() => sumY / n); // Return average if denominator is zero
  }
  
  // Calculate slope (m) and intercept (b) for y = mx + b
  const slope = (n * sumXY - sumX * sumY) / denominator;
  const intercept = (sumY - slope * sumX) / n;
  
  // Calculate trend values for each point
  return numericData.map((p) => slope * p.x + intercept);
}

// Count weekdays (Monday-Friday) in a date range
function countWeekdays(from: Dayjs, to: Dayjs): number {
  let count = 0;
  let current = from.startOf('day');
  const end = to.endOf('day');
  
  while (current.isBefore(end) || current.isSame(end, 'day')) {
    const dayOfWeek = current.day(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
    if (dayOfWeek >= 1 && dayOfWeek <= 5) { // Monday to Friday
      count++;
    }
    current = current.add(1, 'day');
  }
  
  return count;
}

// ---------- page ----------
export default function DoctorRevenueAnalyticsPage() {
  const auth: any = useAuth() || {};
  const rawRole = auth?.role;
  const myDoctorId = auth?.doctorId != null ? String(auth.doctorId) : '';
  const isAdmin = Array.isArray(rawRole)
    ? rawRole.some((r: string) =>
        ['admin', 'owner', 'superadmin'].includes(String(r).toLowerCase())
      )
    : typeof rawRole === 'string'
      ? ['admin', 'owner', 'superadmin'].includes(rawRole.toLowerCase())
      : false;

  // Date range (defaults to last 30 days)
  const [range, setRange] = useState<DateRange>(PRESETS['30D']());
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [isSingleDay, setIsSingleDay] = useState(false);

  // Providers - store all providers for revenue calculations
  const [providers, setProviders] = useState<Provider[]>([]);
  const [selectedDoctorId, setSelectedDoctorId] = useState<string>(''); // '' means all doctors
  const [providersLoading, setProvidersLoading] = useState(false);

  // Filtered providers for dropdown - only show active providers with isProvider=true
  const activeProviders = useMemo(() => {
    return providers.filter((p) => p.isProvider === true && p.isActive === true);
  }, [providers]);

  // Revenue data
  const [chartData, setChartData] = useState<ChartDataPoint[]>([]);
  const [totalRevenue, setTotalRevenue] = useState(0);
  const [loading, setLoading] = useState(false);
  const [unauthorized, setUnauthorized] = useState(false);

  // Points data
  const [pointsData, setPointsData] = useState<OpsStatPoint[]>([]);
  const [pointsLoading, setPointsLoading] = useState(false);

  // Payments data
  const [paymentsData, setPaymentsData] = useState<PaymentPoint[]>([]);
  const [paymentsLoading, setPaymentsLoading] = useState(false);

  const blocking = providersLoading || loading || pointsLoading || paymentsLoading;

  // Auto-detect single day mode when from and to are the same
  useEffect(() => {
    if (range.from.isSame(range.to, 'day')) {
      setIsSingleDay(true);
    }
  }, [range.from, range.to]);

  // Calculate goal for the selected time period
  const periodGoal = useMemo(() => {
    // Count only weekdays (Monday-Friday) since doctors typically work weekdays
    const weekdays = countWeekdays(range.from, range.to);
    const totalDays = range.to.diff(range.from, 'day') + 1;
    
    if (selectedDoctorId === '' && isAdmin) {
      // All doctors: sum all daily goals, but only count weekdays
      const totalDailyGoal = providers.reduce((sum, p) => sum + (p.dailyRevenueGoal || 0), 0);
      const goal = totalDailyGoal * weekdays;
      
      // Debug logging
      console.log('All Doctors Goal Calculation:', {
        totalDailyGoal,
        weekdays,
        totalDays,
        calculatedGoal: goal,
        providers: providers.map(p => ({ name: p.name, dailyGoal: p.dailyRevenueGoal }))
      });
      
      return goal;
    } else {
      // Single doctor
      const doctor = selectedDoctorId
        ? providers.find((p) => String(p.id) === selectedDoctorId)
        : providers.find((p) => String(p.id) === myDoctorId);
      
      if (!doctor) return 0;
      
      // Use daily goal if available, otherwise calculate from bonus goal
      if (doctor.dailyRevenueGoal) {
        const goal = doctor.dailyRevenueGoal * weekdays;
        
        // Debug logging
        console.log('Single Doctor Goal Calculation:', {
          doctorName: doctor.name,
          dailyRevenueGoal: doctor.dailyRevenueGoal,
          weekdays,
          totalDays,
          calculatedGoal: goal
        });
        
        return goal;
      } else if (doctor.bonusRevenueGoal) {
        // Bonus goal is for 6 months (approx 130 working days, not 182 calendar days)
        // 6 months = ~26 weeks = ~130 weekdays
        const workingDaysIn6Months = 130;
        const dailyAvg = doctor.bonusRevenueGoal / workingDaysIn6Months;
        const goal = dailyAvg * weekdays;
        
        // Debug logging
        console.log('Single Doctor Goal Calculation (from bonus):', {
          doctorName: doctor.name,
          bonusRevenueGoal: doctor.bonusRevenueGoal,
          workingDaysIn6Months,
          dailyAvg,
          weekdays,
          totalDays,
          calculatedGoal: goal
        });
        
        return goal;
      }
    }
    
    return 0;
  }, [range.from, range.to, selectedDoctorId, isAdmin, providers, myDoctorId]);

  const goalPercentage = useMemo(() => {
    if (periodGoal === 0) return 0;
    return (totalRevenue / periodGoal) * 100;
  }, [totalRevenue, periodGoal]);

  // Calculate daily goal average for reference line
  // Use actual data points (which may include weekends) for the average line
  const dailyGoalAvg = useMemo(() => {
    if (periodGoal === 0 || chartData.length === 0) return 0;
    // Calculate average daily goal based on weekdays, but show it for all days in chart
    const weekdays = countWeekdays(range.from, range.to);
    if (weekdays === 0) return 0;
    return periodGoal / weekdays; // Daily goal per weekday
  }, [periodGoal, chartData.length, range.from, range.to]);

  // Calculate trend line values and add to chart data
  const chartDataWithTrend = useMemo(() => {
    if (chartData.length < 2) {
      return chartData.map((point) => ({ 
        ...point, 
        trend: point.total,
        paymentsTrend: point.payments || 0,
      }));
    }
    
    const revenueTrendValues = calculateTrendLine(chartData, 'total');
    const paymentsTrendValues = calculateTrendLine(chartData, 'payments');
    
    return chartData.map((point, index) => ({
      ...point,
      trend: revenueTrendValues[index] || point.total,
      paymentsTrend: paymentsTrendValues[index] || point.payments || 0,
    }));
  }, [chartData]);

  // ---------- load providers ----------
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setProvidersLoading(true);
        const list = await fetchPrimaryProviders({ includeInactive: true });
        if (!alive) return;

        const raw = Array.isArray(list)
          ? list
          : Array.isArray((list as any)?.data)
            ? (list as any).data
            : Array.isArray((list as any)?.items)
              ? (list as any).items
              : [];

        const normalized = (raw as any[]).map(normalizeProvider);
        setProviders(normalized);
        
        // Debug: Log provider goals to see what we're getting from the API
        console.log('Providers loaded with goals:', normalized.map(p => ({
          name: p.name,
          id: p.id,
          dailyRevenueGoal: p.dailyRevenueGoal,
          bonusRevenueGoal: p.bonusRevenueGoal,
        })));
        
        // Non-admin: default to their own doctor
        if (!isAdmin && myDoctorId) {
          setSelectedDoctorId(myDoctorId);
        }
      } finally {
        if (alive) setProvidersLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [isAdmin, myDoctorId]);

  // ---------- fetch revenue data ----------
  useEffect(() => {
    let alive = true;
    (async () => {
      setUnauthorized(false);
      setLoading(true);
      try {
        const start = toISODate(range.from);
        const end = toISODate(range.to);

        if (selectedDoctorId === '' && isAdmin) {
          // All doctors: fetch all and combine
          const allIds = providers.map((p) => String(p.id));
          if (allIds.length === 0) {
            if (alive) {
              setChartData([]);
              setTotalRevenue(0);
            }
            return;
          }
          
          const responses = await Promise.all(
            allIds.map(async (id) => {
              const resp = await fetchDoctorRevenueSeries({
                start,
                end,
                doctorId: id,
              });
              return Array.isArray(resp?.series) ? resp.series : [];
            })
          );
          
          if (!alive) return;
          
          const combined = combineSeries(responses);
          const total = combined.reduce((sum, point) => sum + point.total, 0);
          
          // Add payments placeholder (will be updated when payments data loads)
          setChartData(combined.map((p) => ({ ...p, payments: 0 })));
          setTotalRevenue(total);
        } else {
          // Single doctor (selectedDoctorId is set, or non-admin)
          // For non-admin, omit doctorId to let backend infer
          const resp: DoctorRevenueSeriesResponse = await fetchDoctorRevenueSeries({
            start,
            end,
            doctorId: isAdmin && selectedDoctorId ? selectedDoctorId : undefined,
          });
          
          if (!alive) return;
          
          const series = Array.isArray(resp?.series) ? resp.series : [];
          // Chart data will be updated after payments are fetched
          setChartData(series.map((p) => ({ date: p.date, total: p.total, payments: 0 })));
          setTotalRevenue(Number(resp?.total ?? 0));
        }
      } catch (e) {
        if (!alive) return;
        console.error('fetchDoctorRevenueSeries failed:', e);
        setUnauthorized(true);
        setChartData([]);
        setTotalRevenue(0);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [range.from, range.to, selectedDoctorId, isAdmin, providers]);

  // ---------- fetch payments data ----------
  useEffect(() => {
    let alive = true;
    (async () => {
      setPaymentsLoading(true);
      try {
        const start = toISODate(range.from);
        const end = toISODate(range.to);

        const payments = await fetchPaymentsAnalytics({
          start,
          end,
        });
        
        if (!alive) return;
        
        setPaymentsData(payments);
      } catch (e) {
        if (!alive) return;
        console.error('fetchPaymentsAnalytics failed:', e);
        setPaymentsData([]);
      } finally {
        if (alive) setPaymentsLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [range.from, range.to]);

  // Merge payments into chart data whenever payments data or chart data structure changes
  useEffect(() => {
    if (chartData.length === 0) {
      return;
    }

    // Create payments map - normalize dates to YYYY-MM-DD format
    const paymentsMap = new Map<string, number>();
    if (paymentsData.length > 0) {
      paymentsData.forEach((p) => {
        // Try multiple normalization approaches to catch all date formats
        const dateStr1 = dayjs.utc(p.date).format('YYYY-MM-DD');
        const dateStr2 = dayjs(p.date).format('YYYY-MM-DD');
        const dateStr3 = String(p.date).substring(0, 10); // Just take YYYY-MM-DD part if it's longer
        
        const revenue = Number(p.revenue) || 0;
        paymentsMap.set(dateStr1, (paymentsMap.get(dateStr1) || 0) + revenue);
        // Also store under alternative formats if different
        if (dateStr2 !== dateStr1) {
          paymentsMap.set(dateStr2, (paymentsMap.get(dateStr2) || 0) + revenue);
        }
        if (dateStr3 !== dateStr1 && dateStr3 !== dateStr2 && dateStr3.length === 10) {
          paymentsMap.set(dateStr3, (paymentsMap.get(dateStr3) || 0) + revenue);
        }
      });
    }

    // Update chart data with payments
    setChartData((prev) => {
      // Normalize chart data dates and match with payments
      const updated = prev.map((point) => {
        // Try multiple date formats to match
        const dateVariations = [
          point.date, // Original format
          dayjs.utc(point.date).format('YYYY-MM-DD'), // UTC normalized
          dayjs(point.date).format('YYYY-MM-DD'), // Local normalized
        ];
        
        let payments = 0;
        for (const dateVar of dateVariations) {
          if (paymentsMap.has(dateVar)) {
            payments = paymentsMap.get(dateVar)!;
            break;
          }
        }
        
        return {
          ...point,
          payments,
        };
      });

      // Check if update is needed (avoid unnecessary re-renders)
      const needsUpdate = prev.some((point, i) => {
        return point.payments !== updated[i].payments;
      });

      if (!needsUpdate) {
        return prev;
      }

      const matchedCount = updated.filter(p => p.payments > 0).length;
      console.log('Merged payments into chart data:', {
        chartDataPoints: prev.length,
        paymentsDataPoints: paymentsData.length,
        paymentsMapSize: paymentsMap.size,
        matchedDates: matchedCount,
        totalPaymentsInChart: updated.reduce((sum, d) => sum + d.payments, 0),
        totalPaymentsFromData: totalPayments,
        sampleChartDates: prev.slice(0, 3).map(p => ({ original: p.date, normalized: dayjs.utc(p.date).format('YYYY-MM-DD') })),
        samplePaymentsDates: paymentsData.slice(0, 3).map(p => ({ original: p.date, normalized: dayjs.utc(p.date).format('YYYY-MM-DD'), revenue: p.revenue })),
        sampleMerged: updated.slice(0, 3),
        paymentsMapSample: Array.from(paymentsMap.entries()).slice(0, 5),
      });

      return updated;
    });
  }, [paymentsData, chartData.length]); // Trigger when payments data changes or chart data structure changes

  // Calculate total payments
  const totalPayments = useMemo(() => {
    return paymentsData.reduce((sum, p) => sum + (Number(p.revenue) || 0), 0);
  }, [paymentsData]);

  // ---------- fetch points data ----------
  useEffect(() => {
    let alive = true;
    (async () => {
      // Wait for providers to load if we need them
      if ((selectedDoctorId === '' && isAdmin && providers.length === 0) || providersLoading) {
        setPointsData([]);
        return;
      }

      setPointsLoading(true);
      try {
        const start = toISODate(range.from);
        const end = toISODate(range.to);

        let providerIds: string[] | undefined = undefined;
        
        if (selectedDoctorId === '' && isAdmin) {
          // All doctors: explicitly pass all provider IDs (like we do for revenue)
          const allIds = providers.map((p) => String(p.id));
          providerIds = allIds.length > 0 ? allIds : undefined;
        } else if (selectedDoctorId && isAdmin) {
          // Single doctor selected
          providerIds = [selectedDoctorId];
        } else if (!isAdmin && myDoctorId) {
          // Non-admin: use their doctor ID
          providerIds = [String(myDoctorId)];
        }

        if (!providerIds && (selectedDoctorId === '' && isAdmin)) {
          // No providers loaded yet, skip fetch
          if (alive) setPointsData([]);
          return;
        }

        const data = await fetchOpsStatsAnalytics({
          start,
          end,
          providerIds,
        });
        
        if (!alive) return;
        
        setPointsData(data);
      } catch (e) {
        if (!alive) return;
        console.error('fetchOpsStatsAnalytics failed:', e);
        setPointsData([]);
      } finally {
        if (alive) setPointsLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [range.from, range.to, selectedDoctorId, isAdmin, myDoctorId, providers, providersLoading]);

  // Calculate total points and revenue per point
  const totalPoints = useMemo(() => {
    return pointsData.reduce((sum, p) => sum + (Number(p.points) || 0), 0);
  }, [pointsData]);

  const revenuePerPoint = useMemo(() => {
    if (totalPoints === 0) return 0;
    return totalRevenue / totalPoints;
  }, [totalRevenue, totalPoints]);

  // Calculate point goal for the selected time period
  const periodPointGoal = useMemo(() => {
    const weekdays = countWeekdays(range.from, range.to);
    
    if (selectedDoctorId === '' && isAdmin) {
      // All doctors: sum all daily point goals
      const totalDailyPointGoal = providers.reduce((sum, p) => sum + (p.dailyPointGoal || 0), 0);
      return totalDailyPointGoal * weekdays;
    } else {
      // Single doctor
      const doctor = selectedDoctorId
        ? providers.find((p) => String(p.id) === selectedDoctorId)
        : providers.find((p) => String(p.id) === myDoctorId);
      
      if (!doctor) return 0;
      
      // Use daily point goal if available, otherwise calculate from weekly goal
      if (doctor.dailyPointGoal) {
        return doctor.dailyPointGoal * weekdays;
      } else if (doctor.weeklyPointGoal) {
        // Weekly goal / 5 weekdays = daily goal
        const dailyAvg = doctor.weeklyPointGoal / 5;
        return dailyAvg * weekdays;
      }
    }
    
    return 0;
  }, [range.from, range.to, selectedDoctorId, isAdmin, providers, myDoctorId]);

  // Create points chart data with goals
  const pointsChartData = useMemo(() => {
    if (pointsData.length === 0) {
      return [];
    }
    
    const weekdays = countWeekdays(range.from, range.to);
    const dailyPointGoal = periodPointGoal > 0 && weekdays > 0 ? periodPointGoal / weekdays : 0;
    
    // Create a map of date -> points from the data
    const pointsMap = new Map<string, number>();
    pointsData.forEach((p) => {
      // Normalize date format (ensure YYYY-MM-DD)
      const dateStr = dayjs(p.date).format('YYYY-MM-DD');
      const existing = pointsMap.get(dateStr) || 0;
      pointsMap.set(dateStr, existing + (Number(p.points) || 0));
    });
    
    // Create chart data for all days in range, filling in missing days with 0
    const result: PointsChartDataPoint[] = [];
    let current = range.from.startOf('day');
    const end = range.to.endOf('day');
    
    while (current.isBefore(end) || current.isSame(end, 'day')) {
      const dateStr = current.format('YYYY-MM-DD');
      const points = pointsMap.get(dateStr) || 0;
      result.push({
        date: dateStr,
        points,
        goal: dailyPointGoal,
      });
      current = current.add(1, 'day');
    }
    
    return result;
  }, [pointsData, range.from, range.to, periodPointGoal]);

  // Create revenue per point chart data
  const revenuePerPointChartData = useMemo(() => {
    if (chartData.length === 0 || pointsChartData.length === 0) {
      console.log('Revenue per point chart: Missing data', {
        chartDataLength: chartData.length,
        pointsChartDataLength: pointsChartData.length,
      });
      return [];
    }

    // Create a map of date -> points (normalize dates for matching)
    const pointsMap = new Map<string, number>();
    pointsChartData.forEach((p) => {
      // Normalize date to ensure consistent format
      const normalizedDate = dayjs.utc(p.date).format('YYYY-MM-DD');
      pointsMap.set(normalizedDate, p.points);
      // Also store under original format in case it's different
      if (p.date !== normalizedDate) {
        pointsMap.set(p.date, p.points);
      }
    });

    // Combine revenue and points data
    const result: RevenuePerPointChartDataPoint[] = chartData.map((point) => {
      // Try multiple date formats to match
      const dateVariations = [
        point.date,
        dayjs.utc(point.date).format('YYYY-MM-DD'),
        dayjs(point.date).format('YYYY-MM-DD'),
      ];
      
      let points = 0;
      for (const dateVar of dateVariations) {
        if (pointsMap.has(dateVar)) {
          points = pointsMap.get(dateVar)!;
          break;
        }
      }
      
      const revenuePerPoint = points > 0 ? point.total / points : 0;
      return {
        date: point.date,
        revenuePerPoint,
      };
    });

    const nonZeroCount = result.filter((r) => r.revenuePerPoint > 0).length;
    console.log('Revenue per point chart data:', {
      totalDays: result.length,
      daysWithData: nonZeroCount,
      sampleData: result.slice(0, 5),
      totalRevenuePerPoint: result.reduce((sum, d) => sum + d.revenuePerPoint, 0),
    });

    return result;
  }, [chartData, pointsChartData]);

  if (unauthorized) {
    return (
      <LocalizationProvider dateAdapter={AdapterDayjs}>
        <Box p={3}>
          <Alert severity="error">Unauthorized</Alert>
        </Box>
      </LocalizationProvider>
    );
  }

  const selectedDoctor = selectedDoctorId
    ? providers.find((p) => String(p.id) === selectedDoctorId)
    : null;
  const displayName = useMemo(() => {
    if (!isAdmin) {
      return selectedDoctor?.name || 'Your VSD';
    }
    return selectedDoctorId === '' ? 'All Doctors' : selectedDoctor?.name || 'Unknown';
  }, [isAdmin, selectedDoctorId, selectedDoctor]);

  // ---------- render ----------
  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <Backdrop open={blocking} sx={{ color: '#fff', zIndex: (t) => t.zIndex.modal + 1 }}>
        <Stack alignItems="center" spacing={2}>
          <CircularProgress color="inherit" />
          <Typography variant="body2">Loading analytics…</Typography>
        </Stack>
      </Backdrop>

      <Box p={3} display="flex" flexDirection="column" gap={3}>
        {/* Header */}
        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} md={7}>
            <Typography variant="h5" fontWeight={600}>
              VSD by Doctor
            </Typography>
            <Typography variant="body2" color="text.secondary">
              View VSD data for the practice or individual doctors.
            </Typography>
          </Grid>
          <Grid item xs={12} md={5}>
            <Box
              display="flex"
              justifyContent={{ xs: 'flex-start', md: 'flex-end' }}
              gap={1}
              flexWrap="wrap"
            >
              {Object.keys(PRESETS).map((k) => (
                <Button
                  key={k}
                  variant="outlined"
                  size="small"
                  onClick={() => {
                    setRange(PRESETS[k]());
                    setIsSingleDay(false);
                  }}
                >
                  {k}
                </Button>
              ))}
              <Button
                variant="outlined"
                size="small"
                onClick={() => {
                  const today = dayjs().startOf('day');
                  setRange({ from: today, to: today });
                  setIsSingleDay(true);
                }}
              >
                Today
              </Button>
              <Button
                variant="outlined"
                size="small"
                startIcon={<CalendarMonth />}
                onClick={(e) => setAnchorEl(e.currentTarget)}
              >
                {isSingleDay || range.from.isSame(range.to, 'day')
                  ? range.from.format('MMM D, YYYY')
                  : `${range.from.format('MMM D, YYYY')} – ${range.to.format('MMM D, YYYY')}`}
              </Button>
              <Button
                variant="outlined"
                size="small"
                title="Refresh"
                onClick={() => setRange({ ...range })}
              >
                <Refresh fontSize="small" />
              </Button>
            </Box>
          </Grid>
        </Grid>

        {/* Date range picker popover */}
        <Popover
          open={Boolean(anchorEl)}
          anchorEl={anchorEl}
          onClose={() => setAnchorEl(null)}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        >
          <Box p={2} display="flex" flexDirection="column" gap={2} minWidth={300}>
            <Box display="flex" gap={1} alignItems="center">
              <Button
                variant={isSingleDay ? 'contained' : 'outlined'}
                size="small"
                onClick={() => {
                  setIsSingleDay(true);
                  const singleDate = range.from;
                  setRange({ from: singleDate, to: singleDate });
                }}
              >
                Single Day
              </Button>
              <Button
                variant={!isSingleDay ? 'contained' : 'outlined'}
                size="small"
                onClick={() => {
                  setIsSingleDay(false);
                  // If currently single day, extend to a range
                  if (range.from.isSame(range.to, 'day')) {
                    setRange({ from: range.from, to: range.from.add(6, 'day') });
                  }
                }}
              >
                Date Range
              </Button>
            </Box>
            {isSingleDay ? (
              <DatePicker
                label="Select Date"
                value={range.from}
                onChange={(v) => {
                  if (v) {
                    const day = v.startOf('day');
                    setRange({ from: day, to: day });
                  }
                }}
                slotProps={{ textField: { size: 'small', fullWidth: true } }}
              />
            ) : (
              <>
                <DatePicker
                  label="From"
                  value={range.from}
                  onChange={(v) => v && setRange({ ...range, from: v.startOf('day') })}
                  slotProps={{ textField: { size: 'small', fullWidth: true } }}
                />
                <DatePicker
                  label="To"
                  value={range.to}
                  onChange={(v) => v && setRange({ ...range, to: v.startOf('day') })}
                  slotProps={{ textField: { size: 'small', fullWidth: true } }}
                />
              </>
            )}
          </Box>
        </Popover>

        {/* Doctor selector (admin only) */}
        {isAdmin && (
          <Card variant="outlined">
            <CardContent>
              <FormControl fullWidth size="small">
                <InputLabel id="doctor-select-label">Select Doctor</InputLabel>
                <Select
                  labelId="doctor-select-label"
                  label="Select Doctor"
                  value={selectedDoctorId}
                  onChange={(e) => setSelectedDoctorId(e.target.value)}
                >
                  <MenuItem value="">All Doctors</MenuItem>
                  {activeProviders.map((p) => (
                    <MenuItem key={String(p.id)} value={String(p.id)}>
                      {p.name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </CardContent>
          </Card>
        )}

        {/* Total Revenue Card */}
        <Card variant="outlined">
          <CardHeader
            titleTypographyProps={{ variant: 'subtitle2', color: 'text.secondary' }}
            title={`Total VSD — ${displayName}`}
          />
          <CardContent>
            <Box display="flex" gap={3} flexWrap="wrap">
              <Box>
                <Typography variant="body2" color="text.secondary" gutterBottom>
                  VSD
                </Typography>
                <Typography variant="h4" fontWeight={800}>
                  {fmtUSD(totalRevenue)}
                </Typography>
              </Box>
              {/* Only show payments when viewing all doctors */}
              {(selectedDoctorId === '' && isAdmin) && (
                <Box>
                  <Typography variant="body2" color="text.secondary" gutterBottom>
                    Payments
                  </Typography>
                  <Typography variant="h4" fontWeight={800}>
                    {fmtUSD(totalPayments)}
                  </Typography>
                </Box>
              )}
            </Box>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              {isSingleDay || range.from.isSame(range.to, 'day')
                ? range.from.format('MMM D, YYYY')
                : `${range.from.format('MMM D, YYYY')} – ${range.to.format('MMM D, YYYY')} (${chartData.length} days)`}
            </Typography>
            {periodGoal > 0 && (
              <Box mt={2}>
                <Typography variant="body2" color="text.secondary">
                  Goal: {fmtUSD(periodGoal)}
                  {(() => {
                    const weekdays = countWeekdays(range.from, range.to);
                    const totalDays = range.to.diff(range.from, 'day') + 1;
                    if (weekdays !== totalDays) {
                      return ` (${weekdays} weekdays)`;
                    }
                    return '';
                  })()}
                </Typography>
                <Typography 
                  variant="h6" 
                  fontWeight={600}
                  color={goalPercentage >= 100 ? 'success.main' : goalPercentage >= 75 ? 'warning.main' : 'error.main'}
                >
                  {goalPercentage.toFixed(1)}% of goal
                </Typography>
              </Box>
            )}
          </CardContent>
        </Card>

        {/* Chart */}
        <Card variant="outlined">
          <CardHeader title="VSD Trend" />
          <CardContent>
            {chartData.length === 0 ? (
              <Box height={320} display="flex" alignItems="center" justifyContent="center">
                <Typography variant="body2" color="text.secondary">
                  No data available for the selected time period.
                </Typography>
              </Box>
            ) : (
              <Box height={320}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartDataWithTrend} margin={{ left: 8, right: 16, top: 8, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis
                      dataKey="date"
                      tickFormatter={(d) => dayjs(d).format('MM/DD')}
                      minTickGap={24}
                    />
                    <YAxis tickFormatter={(v) => fmtUSD(v)} />
                    <Tooltip
                      formatter={(value: number, name: string) => {
                        if (name === 'payments' || name === 'Payments') return [fmtUSD(value), 'Payments'];
                        if (name === 'paymentsTrend' || name === 'Payments Trend') return [fmtUSD(value), 'Payments Trend'];
                        if (name === 'trend' || name === 'Revenue Trend' || name === 'VSD Trend') return [fmtUSD(value), 'VSD Trend'];
                        return [fmtUSD(value), 'VSD'];
                      }}
                      labelFormatter={(l) => dayjs(l).format('ddd, MMM D, YYYY')}
                    />
                    <Legend />
                    {dailyGoalAvg > 0 && (
                      <ReferenceLine
                        y={dailyGoalAvg}
                        stroke="#ff9800"
                        strokeDasharray="5 5"
                        strokeWidth={2}
                        label={{ 
                          value: `Daily Goal: ${fmtUSD(dailyGoalAvg)}`, 
                          position: 'right', 
                          fill: '#ff9800',
                          fontSize: 12
                        }}
                      />
                    )}
                    <Line
                      type="monotone"
                      dataKey="total"
                      stroke="#1976d2"
                      strokeWidth={2}
                      dot={false}
                      isAnimationActive
                      name="VSD"
                    />
                    {/* VSD trend line */}
                    {chartDataWithTrend.length >= 2 && (
                      <Line
                        type="linear"
                        dataKey="trend"
                        stroke="#9c27b0"
                        strokeWidth={2}
                        strokeDasharray="5 5"
                        dot={false}
                        isAnimationActive={false}
                        name="VSD Trend"
                      />
                    )}
                    {/* Only show payments line when viewing all doctors */}
                    {(selectedDoctorId === '' && isAdmin) && (
                      <>
                        <Line
                          type="monotone"
                          dataKey="payments"
                          stroke="#388e3c"
                          strokeWidth={2}
                          dot={false}
                          isAnimationActive
                          name="Payments"
                          connectNulls={false}
                        />
                        {/* Payments trend line */}
                        {chartDataWithTrend.length >= 2 && chartDataWithTrend.some(p => (p.payments || 0) > 0) && (
                          <Line
                            type="linear"
                            dataKey="paymentsTrend"
                            stroke="#f57c00"
                            strokeWidth={2}
                            strokeDasharray="5 5"
                            dot={false}
                            isAnimationActive={false}
                            name="Payments Trend"
                          />
                        )}
                      </>
                    )}
                  </LineChart>
                </ResponsiveContainer>
              </Box>
            )}
          </CardContent>
        </Card>

        {/* Points Summary Cards */}
        <Grid container spacing={2}>
          <Grid item xs={12} sm={6}>
            <Card variant="outlined">
              <CardHeader
                titleTypographyProps={{ variant: 'subtitle2', color: 'text.secondary' }}
                title={`Total Points — ${displayName}`}
              />
              <CardContent>
                <Typography variant="h4" fontWeight={800}>
                  {totalPoints.toFixed(1)}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {isSingleDay || range.from.isSame(range.to, 'day')
                    ? range.from.format('MMM D, YYYY')
                    : `${range.from.format('MMM D, YYYY')} – ${range.to.format('MMM D, YYYY')} (${pointsData.length} days)`}
                </Typography>
                {periodPointGoal > 0 && (
                  <Box mt={2}>
                    <Typography variant="body2" color="text.secondary">
                      Goal: {periodPointGoal.toFixed(1)} points
                      {(() => {
                        const weekdays = countWeekdays(range.from, range.to);
                        const totalDays = range.to.diff(range.from, 'day') + 1;
                        if (weekdays !== totalDays) {
                          return ` (${weekdays} weekdays)`;
                        }
                        return '';
                      })()}
                    </Typography>
                    <Typography 
                      variant="h6" 
                      fontWeight={600}
                      color={(totalPoints / periodPointGoal) >= 1 ? 'success.main' : (totalPoints / periodPointGoal) >= 0.75 ? 'warning.main' : 'error.main'}
                    >
                      {((totalPoints / periodPointGoal) * 100).toFixed(1)}% of goal
                    </Typography>
                  </Box>
                )}
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} sm={6}>
            <Card variant="outlined">
              <CardHeader
                titleTypographyProps={{ variant: 'subtitle2', color: 'text.secondary' }}
                title={`VSD per Point — ${displayName}`}
              />
              <CardContent>
                <Typography variant="h4" fontWeight={800}>
                  {fmtUSD(revenuePerPoint)}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {totalPoints > 0 
                    ? `${fmtUSD(totalRevenue)} VSD ÷ ${totalPoints.toFixed(1)} points`
                    : 'No points data available'}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        </Grid>

        {/* Points Chart */}
        <Card variant="outlined">
          <CardHeader title="Points Trend" />
          <CardContent>
            {pointsChartData.length === 0 ? (
              <Box height={320} display="flex" alignItems="center" justifyContent="center">
                <Typography variant="body2" color="text.secondary">
                  {pointsLoading
                    ? 'Loading points data...'
                    : pointsData.length === 0
                      ? 'No points data available for the selected time period.'
                      : 'Processing points data...'}
                </Typography>
              </Box>
            ) : (() => {
              const hasNonZeroData = pointsChartData.some((d) => d.points > 0);
              return hasNonZeroData ? (
              <Box height={320}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={pointsChartData} margin={{ left: 8, right: 16, top: 8, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis
                      dataKey="date"
                      tickFormatter={(d) => dayjs(d).format('MM/DD')}
                      minTickGap={24}
                    />
                    <YAxis />
                    <Tooltip
                      formatter={(value: number, name: string) => {
                        if (name === 'goal') return [`Goal: ${value.toFixed(1)}`, 'Daily Goal'];
                        return [value.toFixed(1), 'Points'];
                      }}
                      labelFormatter={(l) => dayjs(l).format('ddd, MMM D, YYYY')}
                    />
                    {periodPointGoal > 0 && (
                      <Line
                        type="monotone"
                        dataKey="goal"
                        stroke="#ff9800"
                        strokeWidth={2}
                        strokeDasharray="5 5"
                        dot={false}
                        isAnimationActive
                        name="Daily Goal"
                      />
                    )}
                    <Line
                      type="monotone"
                      dataKey="points"
                      stroke="#9c27b0"
                      strokeWidth={2}
                      dot={false}
                      isAnimationActive
                      name="Points"
                    />
                  </LineChart>
                </ResponsiveContainer>
              </Box>
              ) : (
                <Box height={320} display="flex" alignItems="center" justifyContent="center">
                  <Typography variant="body2" color="text.secondary">
                    No points recorded for the selected time period.
                  </Typography>
                </Box>
              );
            })()}
          </CardContent>
        </Card>

        {/* Revenue per Point Chart */}
        <Card variant="outlined">
          <CardHeader title="VSD per Point Trend" />
          <CardContent>
            {revenuePerPointChartData.length === 0 ? (
              <Box height={320} display="flex" alignItems="center" justifyContent="center">
                <Typography variant="body2" color="text.secondary">
                  {pointsLoading || loading
                    ? 'Loading data...'
                    : 'No data available for the selected time period.'}
                </Typography>
              </Box>
            ) : (
              <Box height={320}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={revenuePerPointChartData} margin={{ left: 8, right: 16, top: 8, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis
                      dataKey="date"
                      tickFormatter={(d) => dayjs(d).format('MM/DD')}
                      minTickGap={24}
                    />
                    <YAxis tickFormatter={(v) => fmtUSD(v)} />
                    <Tooltip
                      formatter={(value: number) => {
                        if (value === 0 || !Number.isFinite(value)) return ['$0.00', 'VSD per Point'];
                        return [fmtUSD(value), 'VSD per Point'];
                      }}
                      labelFormatter={(l) => dayjs(l).format('ddd, MMM D, YYYY')}
                    />
                    <Line
                      type="monotone"
                      dataKey="revenuePerPoint"
                      stroke="#7b1fa2"
                      strokeWidth={2}
                      dot={false}
                      isAnimationActive
                      name="VSD per Point"
                      connectNulls={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </Box>
            )}
          </CardContent>
        </Card>
      </Box>
    </LocalizationProvider>
  );
}
