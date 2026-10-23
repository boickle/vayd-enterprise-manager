import { Camera, CameraOff, Sparkles } from 'lucide-react';
import './PatientPortalProfileCard.css';

export type StaffPortalProfile = {
  nickname?: string | null;
  favoriteThing?: string | null;
  superpower?: string | null;
  nemesis?: string | null;
  funFact?: string | null;
  keyToMyHeart?: string | null;
  socialMediaConsent?: boolean | null;
  socialMediaConsentAt?: string | null;
  portalProfileUpdatedAt?: string | null;
};

export function readStaffPortalProfile(payload: Record<string, unknown> | null | undefined): StaffPortalProfile | null {
  const raw = payload?.portalProfile;
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  return {
    nickname: str(r.nickname),
    favoriteThing: str(r.favoriteThing),
    superpower: str(r.superpower),
    nemesis: str(r.nemesis),
    funFact: str(r.funFact),
    keyToMyHeart: str(r.keyToMyHeart),
    socialMediaConsent: r.socialMediaConsent === true,
    socialMediaConsentAt: str(r.socialMediaConsentAt),
    portalProfileUpdatedAt: str(r.portalProfileUpdatedAt),
  };
}

const FACTS: Array<{ key: keyof StaffPortalProfile; label: string; emoji: string }> = [
  { key: 'nickname', label: 'Also answers to', emoji: '🏷️' },
  { key: 'superpower', label: 'Superpower', emoji: '⚡' },
  { key: 'favoriteThing', label: 'Favorite thing', emoji: '❤️' },
  { key: 'nemesis', label: 'Nemesis', emoji: '😾' },
  { key: 'keyToMyHeart', label: 'The key to my heart', emoji: '🔑' },
  { key: 'funFact', label: 'Fun fact', emoji: '✨' },
];

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * What the owner wrote about their pet in the client portal, so the team can
 * greet "Noodle" by name and know the vacuum is the enemy. Also surfaces the
 * Pet-of-the-Month / social media consent so marketing doesn't have to ask.
 */
export default function PatientPortalProfileCard({
  profile,
  petName,
}: {
  profile: StaffPortalProfile | null;
  petName: string;
}) {
  if (!profile) return null;
  const facts = FACTS.filter((f) => typeof profile[f.key] === 'string' && profile[f.key]);
  const consent = profile.socialMediaConsent === true;
  if (facts.length === 0 && !consent) return null;

  return (
    <section className="pims-emr-story__card pims-portal-profile" aria-labelledby="pims-portal-profile-title">
      <h3 id="pims-portal-profile-title">
        <Sparkles size={13} aria-hidden /> All about {petName}
        <span className="pims-portal-profile__from">from the owner · client portal</span>
      </h3>
      {facts.length > 0 ? (
        <dl className="pims-portal-profile__facts">
          {facts.map((f) => (
            <div key={f.key} className="pims-portal-profile__fact">
              <dt>
                <span aria-hidden>{f.emoji}</span> {f.label}
              </dt>
              <dd>{f.key === 'nickname' ? `“${profile[f.key]}”` : (profile[f.key] as string)}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      <div className={`pims-portal-profile__consent${consent ? ' is-yes' : ' is-no'}`}>
        {consent ? <Camera size={14} aria-hidden /> : <CameraOff size={14} aria-hidden />}
        {consent ? (
          <span>
            <strong>OK to feature on social media</strong> (Pet of the Month, shout-outs)
            {profile.socialMediaConsentAt ? ` · consented ${fmtDate(profile.socialMediaConsentAt)}` : ''}
          </span>
        ) : (
          <span>No social-media consent on file — ask before sharing photos.</span>
        )}
      </div>
    </section>
  );
}
