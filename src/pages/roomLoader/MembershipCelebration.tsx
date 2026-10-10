// src/pages/roomLoader/MembershipCelebration.tsx
// Replaces the membership pitch on the summary once the client enrolls mid-form.
// The star burst fires once on mount; the card itself stays so the client can see
// which pets were enrolled and that the prices below are now member prices.
import { useEffect, useState } from 'react';
import './MembershipCelebration.css';

/** Enough stars to read as a burst without turning into confetti soup on a phone. */
const STAR_COUNT = 14;

type Props = {
  /** Pets enrolled in this session, in enrollment order. */
  petNames: string[];
  /** Plan name to name-drop, when a single plan covers everyone. */
  planName?: string | null;
  /**
   * How much lower the upcoming visit is now, not what the plan "saves" them: the plan
   * fee is paid separately and the visit itself is usually days out.
   */
  visitSavings: number | null;
  formatPrice: (value: number) => string;
};

function petList(names: string[]): string {
  const cleaned = names.map((n) => n.trim()).filter((n) => n !== '');
  if (cleaned.length === 0) return 'your pet';
  if (cleaned.length === 1) return cleaned[0];
  return `${cleaned.slice(0, -1).join(', ')} and ${cleaned[cleaned.length - 1]}`;
}

export default function MembershipCelebration({ petNames, planName, visitSavings, formatPrice }: Props) {
  // Stars are decorative: drop them after the animation so they cannot trap focus
  // or keep repainting while the client works through the rest of the summary.
  const [burstVisible, setBurstVisible] = useState(true);
  useEffect(() => {
    const timer = window.setTimeout(() => setBurstVisible(false), 2600);
    return () => window.clearTimeout(timer);
  }, []);

  const names = petList(petNames);
  const plural = petNames.length > 1;

  return (
    <section className="rl-celebrate" aria-labelledby="rl-celebrate-headline">
      {burstVisible ? (
        <div className="rl-celebrate__burst" aria-hidden>
          {Array.from({ length: STAR_COUNT }, (_, i) => (
            <span className="rl-celebrate__star" key={i} style={{ '--i': i } as React.CSSProperties}>
              ★
            </span>
          ))}
        </div>
      ) : null}

      <p className="rl-celebrate__eyebrow">Welcome to the family</p>
      <h2 className="rl-celebrate__headline" id="rl-celebrate-headline">
        Congratulations on becoming a member!
      </h2>
      <p className="rl-celebrate__body">
        {names} {plural ? 'are' : 'is'} now enrolled
        {planName ? ` in our ${planName} plan` : ''}. We have updated the prices below to{' '}
        {plural ? 'their' : 'the'} member rates.
      </p>

      {visitSavings != null && visitSavings > 0 ? (
        <p className="rl-celebrate__savings">
          {names}
          {'\u2019'}s visit will now be <strong>{formatPrice(visitSavings)}</strong> less.
        </p>
      ) : null}
    </section>
  );
}
