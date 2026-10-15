// Network names as the server stores them (src/normalize/networks.ts), and a short form for tight spaces.
const SHORT: Record<string, string> = {
  'ACC Network Extra': 'ACCNX', 'ACC Network': 'ACCN', 'SEC Network+': 'SECN+', 'SEC Network': 'SECN', 'Big Ten Network': 'BTN',
  'CBS Sports Network': 'CBSSN', 'Big 12 Now on ESPN+': 'ESPN+', 'Big East Digital Network': 'BEDN', 'Mountain West Network': 'MWN',
  'Pac-12 Network': 'P12N', 'SoCon Digital Network': 'SDN', 'Summit League Network': 'SLN', 'Horizon League Network': 'HLN', 'NEC Front Row': 'NEC FR',
};
export const networkShort = (n: string | null | undefined): string | null => {
  if (!n) return null;
  const first = n.split(' / ')[0]!;
  return SHORT[first] ?? (first.length <= 9 ? first : `${first.slice(0, 8)}…`);
};
export interface Broadcast { network: string | null; url: string | null }
