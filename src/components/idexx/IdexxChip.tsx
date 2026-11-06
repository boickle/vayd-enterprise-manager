import { AlertTriangle, Check, Clock, Send } from 'lucide-react';
import { idexxStatusLabel, type IdexxOrder } from '../../api/idexx';
import './Idexx.css';

type Props = {
  order: Pick<IdexxOrder, 'status' | 'results'> | null;
  className?: string;
};

/** IDEXX status on a lab line or chart row: Not sent → Finish in IDEXX → Not at IDEXX yet → Partial → Final. */
export default function IdexxChip({ order, className }: Props) {
  const { label, tone } = idexxStatusLabel(order);
  const icon =
    tone === 'alert' || tone === 'warn' ? (
      <AlertTriangle size={11} aria-hidden />
    ) : tone === 'done' ? (
      <Check size={11} aria-hidden />
    ) : tone === 'todo' ? (
      <Send size={11} aria-hidden />
    ) : (
      <Clock size={11} aria-hidden />
    );
  return (
    <span className={`idexx-chip idexx-chip--${tone}${className ? ` ${className}` : ''}`}>
      <span className="idexx-chip__brand">IDEXX</span>
      {icon}
      {label}
    </span>
  );
}
