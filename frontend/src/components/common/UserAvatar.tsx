/**
 * UserAvatar — shared avatar component used everywhere in the app.
 *
 * Shows <img> when avatarUrl is set. On load error (broken URL, 401, etc.)
 * falls back to gradient initial — same style as Header/Sidebar fallback.
 *
 * All avatar images are served from /api/avatars/:userId with 24h browser
 * cache (Cache-Control: public, max-age=86400). The ?v=N param on the URL
 * busts the cache when the user uploads a new image.
 */

import { useState, useEffect } from 'react';

// Same hash-to-gradient as Header.tsx — keep in sync if palette changes.
const GRADIENTS = [
  'from-ringo-400 to-ringo-600',
  'from-mustard-400 to-mustard-600',
  'from-teal-500 to-teal-700',
  'from-warmgray-500 to-warmgray-700',
];

function nameToGradient(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffff;
  return GRADIENTS[h % GRADIENTS.length];
}

interface UserAvatarProps {
  name: string;
  avatarUrl?: string | null;
  /** Tailwind size unit — e.g. 8 → w-8 h-8. Default 8. */
  size?: number;
  /** Extra classes on the element (both img and fallback div) */
  className?: string;
  /** Ring class — defaults to ring-2 ring-white/60 */
  ring?: string;
  /** Shape — defaults to rounded-full */
  shape?: string;
}

export default function UserAvatar({
  name,
  avatarUrl,
  size = 8,
  className = '',
  ring = 'ring-2 ring-white/60',
  shape = 'rounded-full',
}: UserAvatarProps) {
  const [imgError, setImgError] = useState(false);
  // Reset error flag when URL changes — new upload/delete gives new URL
  useEffect(() => { setImgError(false); }, [avatarUrl]);

  const baseClass = `w-${size} h-${size} ${shape} shrink-0 object-cover ${ring} ${className}`.trim();
  const initial = (name ?? '').trim().slice(0, 1).toUpperCase() || '?';
  const gradient = nameToGradient(name ?? '');

  if (avatarUrl && !imgError) {
    return (
      <img
        src={avatarUrl}
        alt={name}
        className={baseClass}
        onError={() => setImgError(true)}
        loading="lazy"
        decoding="async"
      />
    );
  }

  // Font size scales with avatar size: size 8 → text-sm, size 10 → text-base, etc.
  const fontSize = size <= 7 ? 'text-xs' : size <= 9 ? 'text-sm' : size <= 11 ? 'text-base' : 'text-lg';

  return (
    <div
      className={`${baseClass} bg-gradient-to-br ${gradient} flex items-center justify-center text-white font-bold ${fontSize}`}
      aria-label={name}
    >
      {initial}
    </div>
  );
}
