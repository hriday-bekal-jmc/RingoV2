/**
 * Sk — skeleton shimmer primitives.
 *
 * Use inside table/list loading states so the page shape is visible
 * before data arrives. All variants use animate-pulse + warmgray-100.
 *
 * Usage:
 *   <Sk.Line />              // text line (default w-24 h-3)
 *   <Sk.Line w="w-40" h="h-3.5" />
 *   <Sk.Badge />             // rounded-full pill (w-16 h-5)
 *   <Sk.Badge w="w-24" />
 *   <Sk.Circle />            // avatar circle (w-8 h-8)
 *   <Sk.Circle size="sm" />  // w-6 h-6
 *   <Sk.Dot />               // tiny status dot (w-2 h-2)
 *   <Sk.Box w="w-4" h="h-4" className="rounded" />  // generic block
 */

const P = 'animate-pulse bg-warmgray-100';

function Line({
  w = 'w-24',
  h = 'h-3',
  className = '',
}: {
  w?: string;
  h?: string;
  className?: string;
}) {
  return <div className={`${P} rounded ${w} ${h} ${className}`} />;
}

function Badge({ w = 'w-16' }: { w?: string }) {
  return <div className={`${P} rounded-full h-5 ${w}`} />;
}

// size: 'sm'=w-6 h-6  'md'=w-8 h-8 (default)  'lg'=w-10 h-10
const circleSize = { sm: 'w-6 h-6', md: 'w-8 h-8', lg: 'w-10 h-10' } as const;
function Circle({ size = 'md' }: { size?: keyof typeof circleSize }) {
  return <div className={`${P} rounded-full shrink-0 ${circleSize[size]}`} />;
}

function Dot() {
  return <div className={`${P} w-2 h-2 rounded-full shrink-0`} />;
}

function Box({
  w = 'w-4',
  h = 'h-4',
  className = '',
}: {
  w?: string;
  h?: string;
  className?: string;
}) {
  return <div className={`${P} ${w} ${h} ${className}`} />;
}

export const Sk = { Line, Badge, Circle, Dot, Box };
